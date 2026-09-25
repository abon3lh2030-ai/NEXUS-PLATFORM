import { Avatar, Badge, Button, EmptyState, PageHeader, Section, StatCard } from '@nexus/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Activity, AlertTriangle, CheckCircle2, Cpu, Radio, Wrench } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useSearchParams } from 'react-router';
import { LoadingBlock, MockBanner, StatusBadge } from '@/components/common';
import { api } from '@/lib/api';
import { durationBetween, formatNumber, formatRelative, formatTime, formatUsd } from '@/lib/format';
import { supabase } from '@/lib/supabase';
import { useSession } from '@/providers/session';
import { SessionViewer } from './session-viewer';

interface Ops {
  employees: Array<{ id: string; name: string; job_title: string; status: string; avatar_seed: string }>;
  active_sessions: Array<{ id: string; ai_employee_id: string; status: string; current_step: string | null; started_at: string | null; queued_at: string; input_tokens: number; output_tokens: number; estimated_cost_usd: number; tasks: { title: string } | null }>;
  recent_sessions: Array<{ id: string; ai_employee_id: string; status: string; current_step: string | null; completed_at: string; error: string | null; tasks: { title: string } | null }>;
  pending_approvals: Array<{ id: string; title: string; risk: string; created_at: string }>;
  tool_activity: Array<{ id: string; session_id: string; ai_employee_id: string; tool: string; status: string; created_at: string }>;
  usage_24h: { tokens: number; estimated_cost_usd: number; estimated_cost_sar: number };
  provider: { ai: string; is_mock: boolean; computer: string };
}

/** Realtime AI Operations Room — Supabase Realtime (RLS-scoped) + polling fallback. */
export function OperationsPage() {
  const { t } = useTranslation();
  const { orgId } = useSession();
  const qc = useQueryClient();
  const [params] = useSearchParams();
  const [sessionId, setSessionId] = useState<string | null>(params.get('session'));
  const [live, setLive] = useState(false);
  const { data, isLoading } = useQuery({ queryKey: ['operations'], queryFn: () => api<Ops>('/ai/operations'), refetchInterval: 10_000 });

  useEffect(() => {
    if (!orgId) return;
    const refresh = () => void qc.invalidateQueries({ queryKey: ['operations'] });
    const ch = supabase
      .channel(`ops:${orgId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'ai_work_sessions', filter: `organization_id=eq.${orgId}` }, refresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'ai_tool_executions', filter: `organization_id=eq.${orgId}` }, refresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'approvals', filter: `organization_id=eq.${orgId}` }, refresh)
      .subscribe((status) => setLive(status === 'SUBSCRIBED'));
    return () => void supabase.removeChannel(ch);
  }, [orgId, qc]);

  if (isLoading || !data) return <LoadingBlock />;
  const emp = (id: string) => data.employees.find((e) => e.id === id);
  const running = data.active_sessions.filter((s) => ['running', 'preparing'].includes(s.status));
  const busyEmployees = data.employees.filter((e) => !['idle', 'offline', 'completed', 'failed'].includes(e.status));

  return (
    <>
      <PageHeader
        title={t('nav.operations')}
        description={t('ops.description')}
        icon={<Activity />}
        actions={<Badge tone={live ? 'success' : 'neutral'}><Radio /> {live ? t('ops.live') : t('ops.polling')}</Badge>}
      />
      <MockBanner show={data.provider.is_mock} />
      <div className="mt-4 grid grid-cols-2 gap-4 lg:grid-cols-5">
        <StatCard label={t('ops.activeEmployees')} value={formatNumber(busyEmployees.length)} icon={<Cpu />} hint={t('ops.ofTotal', { count: data.employees.length })} />
        <StatCard label={t('ops.running')} value={formatNumber(running.length)} icon={<Activity />} hint={t('ops.queued', { count: data.active_sessions.length - running.length })} />
        <StatCard label={t('ops.waitingApprovals')} value={formatNumber(data.pending_approvals.length)} icon={<AlertTriangle />} />
        <StatCard label={t('ops.completed24h')} value={formatNumber(data.recent_sessions.filter((s) => s.status === 'completed').length)} icon={<CheckCircle2 />} hint={t('ops.failed', { count: data.recent_sessions.filter((s) => s.status === 'failed').length })} />
        <StatCard label={t('ops.cost24h')} value={formatUsd(data.usage_24h.estimated_cost_usd)} hint={t('ops.tokens', { count: data.usage_24h.tokens })} />
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-3">
        <Section className="xl:col-span-2" title={t('ops.activeSessions')}>
          {data.active_sessions.length === 0 ? (
            <EmptyState icon={<Cpu />} title={t('ops.noActive')} description={t('ops.noActiveHint')} action={<Button asChild variant="outline"><Link to="/app/tasks?new=1">{t('command.newTask')}</Link></Button>} />
          ) : (
            <ul className="grid gap-2">
              {data.active_sessions.map((s) => {
                const e = emp(s.ai_employee_id);
                return (
                  <li key={s.id}>
                    <button onClick={() => setSessionId(s.id)} className="flex w-full items-center gap-3 rounded-xl border p-3 text-start transition-colors hover:bg-muted/50">
                      <Avatar name={e?.avatar_seed || e?.name || '?'} square className="size-10" />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">{e?.name} · <span className="text-muted-foreground">{s.tasks?.title ?? t('ai.workSession')}</span></p>
                        <p className="truncate text-xs text-muted-foreground" dir="auto">{s.current_step}</p>
                      </div>
                      <div className="hidden text-end text-xs text-muted-foreground sm:block">
                        <p>{durationBetween(s.started_at ?? s.queued_at)}</p>
                        <p>{formatUsd(Number(s.estimated_cost_usd))}</p>
                      </div>
                      <StatusBadge value={s.status} />
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </Section>
        <div className="grid content-start gap-6">
          <Section title={t('ops.waitingApprovals')} actions={<Button asChild size="sm" variant="ghost"><Link to="/app/approvals">{t('common.viewAll')}</Link></Button>}>
            {data.pending_approvals.length === 0 ? <p className="text-sm text-muted-foreground">{t('approvals.none')}</p> : (
              <ul className="grid gap-2">
                {data.pending_approvals.slice(0, 6).map((a) => (
                  <li key={a.id}><Link to={`/app/approvals?id=${a.id}`} className="flex items-center gap-2 rounded-lg border p-2.5 text-sm hover:bg-muted/50"><span className="min-w-0 flex-1 truncate">{a.title}</span><StatusBadge value={a.risk} /></Link></li>
                ))}
              </ul>
            )}
          </Section>
          <Section title={<span className="flex items-center gap-2"><Wrench className="size-4" /> {t('ai.toolActivity')}</span>}>
            <ul className="grid max-h-80 gap-1.5 overflow-y-auto text-sm">
              {data.tool_activity.length === 0 && <li className="text-muted-foreground">{t('ai.noTools')}</li>}
              {data.tool_activity.map((x) => (
                <li key={x.id} className="flex items-center gap-2">
                  <span className="font-mono text-xs text-muted-foreground">{formatTime(x.created_at)}</span>
                  <span className="truncate">{emp(x.ai_employee_id)?.name}</span>
                  <span className="font-mono text-xs">{x.tool}</span>
                  <StatusBadge className="ms-auto" value={x.status === 'succeeded' ? 'completed' : x.status === 'denied' ? 'rejected' : x.status === 'pending_approval' ? 'waiting_approval' : x.status} />
                </li>
              ))}
            </ul>
          </Section>
        </div>
      </div>

      <Section className="mt-6" title={t('ops.recent')}>
        {data.recent_sessions.length === 0 ? <p className="text-sm text-muted-foreground">{t('ops.noRecent')}</p> : (
          <ul className="grid gap-1">
            {data.recent_sessions.map((s) => (
              <li key={s.id}>
                <button onClick={() => setSessionId(s.id)} className="flex w-full items-center gap-3 rounded-lg px-2 py-2 text-start text-sm hover:bg-muted/50">
                  <StatusBadge value={s.status} />
                  <span className="min-w-0 flex-1 truncate">{emp(s.ai_employee_id)?.name} · {s.tasks?.title ?? t('ai.workSession')}</span>
                  {s.error && <span className="hidden truncate text-xs text-destructive sm:inline">{t(`errors.${s.error}`, s.error)}</span>}
                  <span className="text-xs text-muted-foreground">{formatRelative(s.completed_at)}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section className="mt-6" title={t('ops.workforceStatus')}>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {data.employees.map((e) => (
            <Link key={e.id} to={`/app/workforce/${e.id}?tab=computer`} className="flex items-center gap-3 rounded-xl border p-3 hover:bg-muted/50">
              <Avatar name={e.avatar_seed || e.name} square className="size-9" />
              <div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">{e.name}</p><p className="truncate text-xs text-muted-foreground">{e.job_title}</p></div>
              <StatusBadge value={e.status} />
            </Link>
          ))}
        </div>
      </Section>
      <SessionViewer sessionId={sessionId} onClose={() => setSessionId(null)} />
    </>
  );
}
