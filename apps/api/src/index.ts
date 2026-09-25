import { buildApp } from './app.js';
import { loadEnv } from './config/env.js';

const env = loadEnv();
const { app, services } = await buildApp(env);

const timers: NodeJS.Timeout[] = [];

if (env.AGENT_WORKER_ENABLED) services.agents.startWorker();

if (env.CRON_ENABLED) {
  // Recover sessions whose worker died, every minute.
  timers.push(
    setInterval(() => {
      void services.db.rpc('requeue_stale_work_sessions', { p_stale_seconds: 300 }).then(({ error }) => {
        if (error) app.log.error({ err: error.message }, 'requeue_stale_failed');
      });
    }, 60_000),
  );
  // Retention & hygiene, hourly: expired meeting transcripts and abandoned uploads (> 3h in 'uploading').
  const hygiene = async () => {
    await services.db.from('meeting_transcripts').delete().lt('expires_at', new Date().toISOString());
    const cutoff = new Date(Date.now() - 3 * 3600_000).toISOString();
    const { data: stale } = await services.db.from('company_files').select('id, storage_key').eq('status', 'uploading').lt('created_at', cutoff).limit(500);
    const rows = (stale ?? []) as Array<{ id: string; storage_key: string }>;
    if (rows.length) {
      await services.db.storage.from('company-files').remove(rows.map((r) => r.storage_key));
      await services.db.from('company_files').update({ status: 'failed', failure_reason: 'upload_abandoned', deleted_at: new Date().toISOString() }).in('id', rows.map((r) => r.id));
    }
  };
  timers.push(setInterval(() => void hygiene().catch((err: unknown) => app.log.error({ err }, 'hygiene_job_failed')), 60 * 60_000));

  // Subscription expiry bookkeeping + notices, hourly (access is already enforced per-request by timestamp).
  const expiry = () => void services.billing.runExpiryJob().catch((err: unknown) => app.log.error({ err }, 'expiry_job_failed'));
  expiry();
  timers.push(setInterval(expiry, 60 * 60_000));
}

const shutdown = async (signal: string) => {
  app.log.info({ signal }, 'shutting down');
  services.agents.stopWorker();
  timers.forEach(clearInterval);
  await app.close();
  process.exit(0);
};
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

await app.listen({ port: env.PORT, host: env.HOST });
