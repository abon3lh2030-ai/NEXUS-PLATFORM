import { Badge, Button, ConfirmDialog, Dialog, DialogDescription, DialogTitle, SheetContent, Tabs, TabsContent, TabsList, TabsTrigger, cn } from '@nexus/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Ban, CheckCircle2, CircleStop, Cpu, FileText, Pause, Play, ShieldAlert, Wrench } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { KeyValue, Markdown, StatusBadge, useAction } from '@/components/common';
import { api, apiPost } from '@/lib/api';
import { durationBetween, formatDateTime, formatNumber, formatTime, formatUsd } from '@/lib/format';
import { supabase } from '@/lib/supabase';
import { useSession } from '@/providers/session';
import type { WorkSession } from './types';

type SessionResponse = Omit<WorkSession, 'outputs'> & { outputs: Array<{ id: string; title: string; content: string; status: string; document_id: string | null }> };

/** Live timeline of an AI work session with manager controls (pause / resume / cancel / stop). */
export function useLiveSession(sessionId: string | null) {
  const qc = useQueryClient();
  const query = useQuery({ queryKey: ['session', sessionId], queryFn: () => api<SessionResponse>(`/ai/sessions/${sessionId}`), enabled: Boolean(sessionId), refetchInterval: (q) => (['completed', 'failed', 'cancelled'].includes(q.state.data?.status ?? '') ? false : 5000) });
  useEffect(() => {
    if (!sessionId) return;
    const ch = supabase
      .channel(`session:${sessionId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'ai_session_events', filter: `session_id=eq.${sessionId}` }, () => void qc.invalidateQueries({ queryKey: ['session', sessionId] }))
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'ai_work_sessions', filter: `id=eq.${sessionId}` }, () => void qc.invalidateQueries({ queryKey: ['session', sessionId] }))
      .subscribe();
    return () => void supabase.removeChannel(ch);
  }, [sessionId, qc]);
  return query;
}

export function SessionControls({ session }: { session: Pick<WorkSession, 'id' | 'status'> }) {
  const { t } = useTranslation();
  const { can } = useSession();
  const [confirm, setConfirm] = useState<'cancel' | 'request_stop' | null>(null);
  const control = useAction((action: string) => apiPost(`/ai/sessions/${session.id}/control`, { action }), { success: t('ai.controlSent'), invalidate: [['session', session.id], ['operations']] });
  if (!can('ai.control') || ['completed', 'failed', 'cancelled'].includes(session.status)) return null;
  return (
    <div className="flex flex-wrap gap-2">
      {session.status === 'paused' ? (
        <Button size="sm" variant="outline" onClick={() => control.mutate('resume')} loading={control.isPending}><Play /> {t('ai.resume')}</Button>
      ) : (
        <Button size="sm" variant="outline" onClick={() => control.mutate('pause')} loading={control.isPending}><Pause /> {t('ai.pause')}</Button>
      )}
      <Button size="sm" variant="outline" onClick={() => setConfirm('request_stop')}><CircleStop /> {t('ai.requestStop')}</Button>
      <Button size="sm" variant="destructive" onClick={() => setConfirm('cancel')}><Ban /> {t('common.cancel')}</Button>
      <ConfirmDialog
        open={Boolean(confirm)}
        onOpenChange={(o) => !o && setConfirm(null)}
        title={t('ai.confirmStopTitle')}
        description={t('ai.confirmStopBody')}
        confirmLabel={t('common.confirm')}
        cancelLabel={t('common.back')}
        destructive
        onConfirm={() => {
          if (confirm) control.mutate(confirm);
          setConfirm(null);
        }}
      />
    </div>
  );
}

export function SessionTimeline({ events }: { events: NonNullable<WorkSession['events']> }) {
  const { t } = useTranslation();
  if (!events.length) return <p className="text-sm text-muted-foreground">{t('ai.noEvents')}</p>;
  return (
    <ol className="relative grid gap-3 border-s ps-5">
      {events.map((e) => (
        <li key={e.id} className="relative text-sm">
          <span className={cn('absolute -start-[25px] top-1.5 size-2.5 rounded-full ring-4 ring-background', e.event_type === 'failed' || e.event_type === 'tool_denied' || e.event_type === 'tool_failed' ? 'bg-destructive' : e.event_type === 'completed' ? 'bg-success' : e.event_type === 'waiting_approval' ? 'bg-warning' : 'bg-primary')} />
          <span className="font-mono text-xs text-muted-foreground">{formatTime(e.created_at)}</span> — <span dir="auto">{e.message}</span>
        </li>
      ))}
    </ol>
  );
}

export function SessionViewer({ sessionId, onClose }: { sessionId: string | null; onClose: () => void }) {
  const { t } = useTranslation();
  const { data: s } = useLiveSession(sessionId);
  return (
    <Dialog open={Boolean(sessionId)} onOpenChange={(o) => !o && onClose()}>
      <SheetContent closeLabel={t('common.close')}>
        {s && (
          <div className="grid gap-5 p-6">
            <div className="pe-8">
              <div className="flex flex-wrap items-center gap-2"><StatusBadge value={s.status} />{s.delegation_depth > 0 && <Badge tone="info">{t('ai.delegated', { depth: s.delegation_depth })}</Badge>}</div>
              <DialogTitle className="mt-2 text-lg font-semibold">{s.tasks?.title ?? t('ai.workSession')}</DialogTitle>
              <DialogDescription className="text-sm text-muted-foreground">{s.ai_employees?.name} · {s.ai_employees?.job_title}</DialogDescription>
              {s.current_step && <p className="mt-2 rounded-lg bg-muted px-3 py-2 text-sm" dir="auto"><span className="text-muted-foreground">{t('ai.currentStep')}:</span> {s.current_step}</p>}
            </div>
            <SessionControls session={s} />
            <div className="grid divide-y rounded-xl border px-4 sm:grid-cols-2 sm:divide-y-0">
              <KeyValue label={t('ai.started')}>{formatDateTime(s.started_at)}</KeyValue>
              <KeyValue label={t('ai.duration')}>{durationBetween(s.started_at, s.completed_at)}</KeyValue>
              <KeyValue label={t('ai.model')}><span dir="ltr">{s.model}</span></KeyValue>
              <KeyValue label={t('ai.tokens')}>{formatNumber(Number(s.input_tokens) + Number(s.output_tokens))}</KeyValue>
              <KeyValue label={t('ai.estimatedCost')}>{formatUsd(Number(s.estimated_cost_usd))}</KeyValue>
              {s.error && <KeyValue label={t('ai.error')}><span className="text-destructive">{t(`errors.${s.error}`, s.error)}</span></KeyValue>}
            </div>
            <Tabs defaultValue="timeline">
              <TabsList>
                <TabsTrigger value="timeline">{t('ai.timeline')}</TabsTrigger>
                <TabsTrigger value="tools"><Wrench /> {t('ai.toolActivity')}</TabsTrigger>
                <TabsTrigger value="outputs"><FileText /> {t('ai.outputs')}</TabsTrigger>
                {s.computer_logs && s.computer_logs.length > 0 && <TabsTrigger value="computer"><Cpu /> {t('ai.computerLogs')}</TabsTrigger>}
              </TabsList>
              <TabsContent value="timeline"><SessionTimeline events={s.events ?? []} /></TabsContent>
              <TabsContent value="tools">
                <ul className="grid gap-2">
                  {(s.tool_executions ?? []).map((x) => (
                    <li key={x.id} className="rounded-lg border p-3 text-sm">
                      <div className="flex items-center gap-2">
                        {x.status === 'denied' ? <ShieldAlert className="size-4 text-destructive" /> : x.status === 'succeeded' ? <CheckCircle2 className="size-4 text-success" /> : <Wrench className="size-4 text-muted-foreground" />}
                        <span className="font-mono text-xs">{x.tool}</span>
                        <StatusBadge value={x.status === 'succeeded' ? 'completed' : x.status === 'pending_approval' ? 'waiting_approval' : x.status === 'denied' ? 'rejected' : x.status} />
                        <span className="ms-auto text-xs text-muted-foreground">{formatTime(x.created_at)}{x.duration_ms !== null ? ` · ${x.duration_ms}ms` : ''}</span>
                      </div>
                      {(x.denial_reason || x.error) && <p className="mt-1 text-xs text-destructive">{x.denial_reason ?? x.error}</p>}
                      {x.output_summary && <p className="mt-1 line-clamp-2 text-xs text-muted-foreground" dir="auto">{x.output_summary}</p>}
                    </li>
                  ))}
                  {(s.tool_executions ?? []).length === 0 && <p className="text-sm text-muted-foreground">{t('ai.noTools')}</p>}
                </ul>
              </TabsContent>
              <TabsContent value="outputs">
                {s.outputs.length === 0 ? <p className="text-sm text-muted-foreground">{t('ai.noOutputs')}</p> : (
                  <div className="grid gap-3">
                    {s.outputs.map((o) => (
                      <div key={o.id} className="rounded-xl border p-4">
                        <div className="flex items-center gap-2"><p className="font-medium">{o.title}</p><StatusBadge value={o.status} />{o.document_id && <Link className="ms-auto text-xs text-primary" to={`/app/documents/${o.document_id}`}>{t('ai.openDocument')}</Link>}</div>
                        <Markdown className="mt-2 max-h-96 overflow-y-auto">{o.content}</Markdown>
                      </div>
                    ))}
                  </div>
                )}
              </TabsContent>
              <TabsContent value="computer">
                <ol className="grid gap-1 font-mono text-xs">
                  {(s.computer_logs ?? []).map((l, i) => <li key={i}><span className="text-muted-foreground">{formatTime(l.at)}</span> [{l.kind}] {l.message}</li>)}
                </ol>
              </TabsContent>
            </Tabs>
          </div>
        )}
      </SheetContent>
    </Dialog>
  );
}
