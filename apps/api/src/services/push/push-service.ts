import type { FastifyBaseLogger } from 'fastify';
import type { Db } from '../../lib/supabase.js';
import type { NotifyInput } from '../notifications.js';
import { ApnsClient, type ApnsConfig, type ApnsEnvironment } from './apns.js';

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/;

/** Same rule as the app: high risk, or anything that reaches people outside the company. */
export function isSensitiveApproval(a: { risk: string; approval_type: string }): boolean {
  return a.risk === 'high' || a.approval_type === 'email_send' || a.approval_type === 'meeting_action';
}

/** Ids the app needs to open the right screen, taken from the website link on the notification. */
export function pushTargets(link: string | null | undefined): { approval_id?: string; task_id?: string; meeting_id?: string; signature_id?: string } {
  if (!link) return {};
  const id = link.match(UUID)?.[0];
  if (!id) return {};
  if (link.includes('/approvals')) return { approval_id: id };
  if (link.includes('/tasks/')) return { task_id: id };
  if (link.includes('/meetings/')) return { meeting_id: id };
  if (link.includes('/signatures/')) return { signature_id: id };
  return {};
}

/**
 * Phone notifications for the NEXUS iOS app. Every in-app notification is also pushed to the person's
 * devices. Simple approvals get Approve/Reject buttons (category APPROVAL_SIMPLE); sensitive ones just
 * open the app, where Face ID is required. Without APNs keys configured, pushing is skipped.
 */
export class PushService {
  private readonly apns: ApnsClient | null;

  constructor(
    private readonly db: Db,
    private readonly log: FastifyBaseLogger,
    cfg: ApnsConfig | null,
  ) {
    this.apns = cfg ? new ApnsClient(cfg, log) : null;
  }

  get enabled(): boolean {
    return this.apns !== null;
  }

  async register(userId: string, input: { token: string; environment: ApnsEnvironment; app_version?: string | undefined }) {
    await this.db.from('device_push_tokens').upsert(
      { user_id: userId, token: input.token.toLowerCase(), environment: input.environment, app_version: input.app_version ?? null, last_seen_at: new Date().toISOString(), disabled_at: null },
      { onConflict: 'token' },
    );
    return { ok: true, push_enabled: this.enabled };
  }

  async unregister(userId: string, token: string) {
    await this.db.from('device_push_tokens').update({ disabled_at: new Date().toISOString() }).eq('token', token.toLowerCase()).eq('user_id', userId);
  }

  /** Called for every in-app notification (fire-and-forget; never fails the caller). */
  async push(userIds: string[], n: NotifyInput): Promise<void> {
    if (!this.apns || !userIds.length) return;
    const { data } = await this.db.from('device_push_tokens').select('id, token, environment').in('user_id', userIds).is('disabled_at', null);
    const devices = (data ?? []) as Array<{ id: string; token: string; environment: ApnsEnvironment }>;
    if (!devices.length) return;

    const targets = pushTargets(n.link);
    let category: string | undefined;
    if (targets.approval_id) {
      const { data: a } = await this.db.from('approvals').select('risk, approval_type, status').eq('id', targets.approval_id).maybeSingle<{ risk: string; approval_type: string; status: string }>();
      if (a?.status === 'pending') category = isSensitiveApproval(a) ? 'APPROVAL' : 'APPROVAL_SIMPLE';
    }
    const message = { title: n.title, body: n.body ?? '', ...(category ? { category } : {}), data: { type: n.type, link: n.link ?? null, ...targets } };
    const results = await Promise.all(devices.map((d) => this.apns!.send(d.token, d.environment, message).then((r) => ({ d, r }))));
    const invalid = results.filter((x) => x.r === 'invalid_token').map((x) => x.d.id);
    if (invalid.length) await this.db.from('device_push_tokens').update({ disabled_at: new Date().toISOString() }).in('id', invalid);
  }
}
