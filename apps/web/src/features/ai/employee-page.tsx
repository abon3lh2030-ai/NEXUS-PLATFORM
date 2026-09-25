import {
  Avatar,
  Badge,
  Button,
  Checkbox,
  ConfirmDialog,
  EmptyState,
  Field,
  Input,
  Label,
  NativeSelect,
  Section,
  StatCard,
  Switch,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Textarea,
} from '@nexus/ui';
import { AI_PERMISSIONS, AUTONOMY_LEVELS } from '@nexus/shared';
import { useQuery } from '@tanstack/react-query';
import { CalendarDays, Mail, Presentation as PresentationIcon, Users, Activity, BarChart3, Brain, Cpu, Download, FileText, FolderOpen, Globe, Inbox, ListChecks, Lock, Send, Settings, ShieldCheck, Terminal, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { toast } from 'sonner';
import { LoadingBlock, StatusBadge, useAction, useErrorMessage } from '@/components/common';
import { NoAccess } from '@/components/guards';
import { downloadFile } from '@/features/files/preview';
import { api, apiDelete, apiPatch, apiPost, apiPut } from '@/lib/api';
import { durationBetween, formatBytes, formatDateTime, formatNumber, formatRelative, formatUsd } from '@/lib/format';
import { useSession } from '@/providers/session';
import { SessionControls, SessionTimeline, SessionViewer, useLiveSession } from './session-viewer';
import { DigitalOffice, EmployeeCalendarTab, EmployeeMeetingsTab, EmployeePresentationsTab, MailTab, VoiceSettings } from '@/features/office/employee-office';
import type { AiEmployeeDetail, WorkSession } from './types';
import { useDepartments } from './workforce-page';

interface ComputerView {
  employee: { id: string; name: string; status: string };
  computer: { id: string; provider: string; status: string } | null;
  capabilities: { files: boolean; documents: boolean; browser: boolean; terminal: boolean };
  provider: string;
  current_session: (WorkSession & { tasks: { title: string } | null }) | null;
  files: Array<{ id: string; original_name: string; size: number; category: string; created_at: string }>;
  documents: Array<{ id: string; title: string; doc_type: string; status: string; created_at: string }>;
  logs: Array<{ at: string; kind: string; message: string }>;
}

export function EmployeePage() {
  const { id } = useParams();
  const { t } = useTranslation();
  const { can } = useSession();
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') ?? 'overview';
  const [sessionId, setSessionId] = useState<string | null>(params.get('session'));
  const { data: e, isLoading } = useQuery({ queryKey: ['ai-employee', id], queryFn: () => api<AiEmployeeDetail>(`/ai/employees/${id}`), refetchInterval: 10_000 });
  const deps = useDepartments();

  if (isLoading) return <LoadingBlock />;
  if (!e) return <NoAccess />;
  const tabs = [
    { v: 'overview', icon: Activity, label: t('ai.tabs.overview') },
    { v: 'tasks', icon: ListChecks, label: t('ai.tabs.tasks') },
    ...(can('ai.computer.view') ? [{ v: 'computer', icon: Cpu, label: t('ai.tabs.computer') }, { v: 'mail', icon: Mail, label: t('ai.tabs.mail') }] : []),
    { v: 'calendar', icon: CalendarDays, label: t('ai.tabs.calendar') },
    { v: 'meetings', icon: Users, label: t('ai.tabs.meetings') },
    { v: 'presentations', icon: PresentationIcon, label: t('ai.tabs.presentations') },
    ...(can('ai.computer.view') ? [{ v: 'files', icon: FolderOpen, label: t('ai.tabs.files') }] : []),
    { v: 'documents', icon: FileText, label: t('ai.tabs.documents') },
    { v: 'memory', icon: Brain, label: t('ai.tabs.memory') },
    { v: 'activity', icon: Inbox, label: t('ai.tabs.activity') },
    { v: 'performance', icon: BarChart3, label: t('ai.tabs.performance') },
    ...(can('ai.manage') ? [{ v: 'permissions', icon: ShieldCheck, label: t('ai.tabs.permissions') }, { v: 'settings', icon: Settings, label: t('ai.tabs.settings') }] : []),
  ];

  return (
    <>
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center">
        <Avatar name={e.avatar_seed || e.name} square className="size-16 text-xl" />
        <div className="flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-semibold tracking-tight">{e.name}</h1>
            <StatusBadge value={e.is_active ? e.status : 'offline'} />
          </div>
          <p className="text-muted-foreground">{e.job_title}{deps.data?.find((d) => d.id === e.department_id) ? ` · ${deps.data.find((d) => d.id === e.department_id)!.name}` : ''}</p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            <Badge tone="primary">{t(`autonomy.${e.autonomy}`)}</Badge>
            <Badge dir="ltr">{e.provider} · {e.model}</Badge>
          </div>
        </div>
        {can('ai.assign') && <AssignTaskButton employeeId={e.id} />}
      </div>

      <Tabs value={tab} onValueChange={(v) => setParams({ tab: v })}>
        <TabsList className="w-full justify-start">{tabs.map((x) => <TabsTrigger key={x.v} value={x.v}><x.icon /> {x.label}</TabsTrigger>)}</TabsList>
        <TabsContent value="overview"><OverviewTab e={e} onOpenSession={setSessionId} /></TabsContent>
        <TabsContent value="tasks"><TasksTab employeeId={e.id} onOpenSession={setSessionId} /></TabsContent>
        <TabsContent value="computer"><div className="grid gap-6"><DigitalOffice onOpen={(v) => setParams({ tab: v })} /><ComputerTab employeeId={e.id} onOpenSession={setSessionId} /></div></TabsContent>
        <TabsContent value="mail"><MailTab employeeId={e.id} /></TabsContent>
        <TabsContent value="calendar"><EmployeeCalendarTab employeeId={e.id} /></TabsContent>
        <TabsContent value="meetings"><EmployeeMeetingsTab employeeId={e.id} /></TabsContent>
        <TabsContent value="presentations"><EmployeePresentationsTab employeeId={e.id} /></TabsContent>
        <TabsContent value="files"><WorkspaceFilesTab employeeId={e.id} /></TabsContent>
        <TabsContent value="documents"><DocumentsTab employeeId={e.id} /></TabsContent>
        <TabsContent value="memory"><MemoryTab employeeId={e.id} /></TabsContent>
        <TabsContent value="activity"><ActivityTab employeeId={e.id} /></TabsContent>
        <TabsContent value="performance"><PerformanceTab employeeId={e.id} /></TabsContent>
        <TabsContent value="permissions"><PermissionsTab e={e} /></TabsContent>
        <TabsContent value="settings"><SettingsTab e={e} /></TabsContent>
      </Tabs>
      <SessionViewer sessionId={sessionId} onClose={() => setSessionId(null)} />
    </>
  );
}

function AssignTaskButton({ employeeId }: { employeeId: string }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  return <Button variant="brand" onClick={() => navigate(`/app/tasks?new=1&ai=${employeeId}`)}><Send /> {t('ai.assignTask')}</Button>;
}

function OverviewTab({ e, onOpenSession }: { e: AiEmployeeDetail; onOpenSession: (id: string) => void }) {
  const { t } = useTranslation();
  const { can } = useSession();
  const [instruction, setInstruction] = useState('');
  const inbox = useQuery({ queryKey: ['ai-inbox', e.id], queryFn: () => api<Array<{ id: string; item_type: string; title: string; body: string; created_at: string; read_at: string | null }>>(`/ai/employees/${e.id}/inbox`) });
  const send = useAction(() => apiPost(`/ai/employees/${e.id}/instructions`, { body: instruction }), { success: t('ai.instructionSent'), invalidate: [['ai-inbox', e.id]], onSuccess: () => setInstruction('') });
  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <div className="grid content-start gap-6 lg:col-span-2">
        <Section title={t('ai.queue')}>
          {e.queue.length === 0 ? <p className="text-sm text-muted-foreground">{t('ai.queueEmpty')}</p> : (
            <ul className="grid gap-2">
              {e.queue.map((q, i) => (
                <li key={q.id}>
                  <button onClick={() => onOpenSession(q.id)} className="flex w-full items-center gap-3 rounded-lg border p-3 text-start hover:bg-muted/50">
                    <Badge tone={i === 0 ? 'primary' : 'neutral'}>{i === 0 ? t('ai.current') : `#${i + 1}`}</Badge>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{q.tasks?.title ?? t('ai.workSession')}</p>
                      <p className="truncate text-xs text-muted-foreground" dir="auto">{q.current_step}</p>
                    </div>
                    {q.tasks?.due_date && <span className="text-xs text-muted-foreground">{formatRelative(q.tasks.due_date)}</span>}
                    <StatusBadge value={q.status} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Section>
        <Section title={t('ai.role')}>
          <p className="whitespace-pre-wrap text-sm" dir="auto">{e.role_description || '—'}</p>
          {e.responsibilities.length > 0 && <ul className="mt-3 grid list-disc gap-1 ps-5 text-sm">{e.responsibilities.map((r) => <li key={r}>{r}</li>)}</ul>}
          {e.skills.length > 0 && <div className="mt-3 flex flex-wrap gap-1.5">{e.skills.map((s) => <Badge key={s}>{s}</Badge>)}</div>}
        </Section>
      </div>
      <div className="grid content-start gap-6">
        {can('ai.control') && (
          <Section title={t('ai.instruct')}>
            <Textarea rows={3} value={instruction} onChange={(ev) => setInstruction(ev.target.value)} placeholder={t('ai.instructPlaceholder')} />
            <Button className="mt-2 w-full" size="sm" disabled={!instruction.trim()} loading={send.isPending} onClick={() => send.mutate(undefined)}><Send /> {t('common.send')}</Button>
          </Section>
        )}
        <Section title={t('ai.inbox')}>
          <ul className="grid max-h-96 gap-2 overflow-y-auto">
            {(inbox.data ?? []).map((m) => (
              <li key={m.id} className="rounded-lg border p-2.5 text-sm">
                <div className="flex items-center gap-2"><Badge>{t(`inbox.${m.item_type}`)}</Badge><span className="ms-auto text-xs text-muted-foreground">{formatRelative(m.created_at)}</span></div>
                <p className="mt-1 font-medium" dir="auto">{m.title}</p>
                {m.body && <p className="line-clamp-3 text-xs text-muted-foreground" dir="auto">{m.body}</p>}
              </li>
            ))}
            {inbox.data?.length === 0 && <p className="text-sm text-muted-foreground">{t('ai.inboxEmpty')}</p>}
          </ul>
        </Section>
      </div>
    </div>
  );
}

function TasksTab({ employeeId, onOpenSession }: { employeeId: string; onOpenSession: (id: string) => void }) {
  const { t } = useTranslation();
  const { data = [] } = useQuery({ queryKey: ['ai-sessions', employeeId], queryFn: () => api<Array<WorkSession & { created_at: string }>>(`/ai/employees/${employeeId}/sessions`), refetchInterval: 10_000 });
  if (!data.length) return <EmptyState icon={<ListChecks />} title={t('ai.noSessions')} />;
  return (
    <div className="overflow-hidden rounded-xl border bg-card">
      <table className="w-full text-sm">
        <thead className="bg-muted/50 text-xs text-muted-foreground"><tr><th className="px-4 py-2 text-start">{t('nav.tasks')}</th><th className="px-4 py-2 text-start">{t('common.status')}</th><th className="hidden px-4 py-2 text-start md:table-cell">{t('ai.duration')}</th><th className="hidden px-4 py-2 text-start md:table-cell">{t('ai.estimatedCost')}</th><th className="hidden px-4 py-2 text-start sm:table-cell">{t('common.date')}</th></tr></thead>
        <tbody>
          {data.map((s) => (
            <tr key={s.id} className="cursor-pointer border-t hover:bg-muted/40" onClick={() => onOpenSession(s.id)}>
              <td className="px-4 py-2.5 font-medium">{s.tasks?.title ?? t('ai.workSession')}</td>
              <td className="px-4 py-2.5"><StatusBadge value={s.status} /></td>
              <td className="hidden px-4 py-2.5 text-muted-foreground md:table-cell">{durationBetween(s.started_at, s.completed_at)}</td>
              <td className="hidden px-4 py-2.5 text-muted-foreground md:table-cell">{formatUsd(Number(s.estimated_cost_usd))}</td>
              <td className="hidden px-4 py-2.5 text-muted-foreground sm:table-cell">{formatRelative(s.created_at)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function useComputer(employeeId: string) {
  return useQuery({ queryKey: ['ai-computer', employeeId], queryFn: () => api<ComputerView>(`/ai/employees/${employeeId}/computer`), refetchInterval: 8000 });
}

/** Manager Computer View — the AI employee's isolated virtual workspace. */
function ComputerTab({ employeeId, onOpenSession }: { employeeId: string; onOpenSession: (id: string) => void }) {
  const { t } = useTranslation();
  const { data } = useComputer(employeeId);
  const live = useLiveSession(data?.current_session?.id ?? null);
  if (!data) return <LoadingBlock />;
  const s = live.data ?? data.current_session;
  const caps = data.capabilities;
  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <div className="grid content-start gap-6 lg:col-span-2">
        <div className="overflow-hidden rounded-2xl border bg-card shadow-sm">
          <div className="flex items-center gap-2 border-b bg-surface-2/60 px-4 py-2.5">
            <span className="size-2.5 rounded-full bg-destructive/60" /><span className="size-2.5 rounded-full bg-warning/70" /><span className="size-2.5 rounded-full bg-success/70" />
            <span className="ms-2 flex items-center gap-1.5 text-xs text-muted-foreground"><Cpu className="size-3.5" /> {t('ai.computerOf', { name: data.employee.name })}</span>
            <Badge className="ms-auto" tone={data.computer?.status === 'busy' ? 'primary' : 'neutral'}>{t(`ai.computerStatus.${data.computer?.status ?? 'ready'}`)}</Badge>
          </div>
          <div className="p-5">
            {s ? (
              <div className="grid gap-4">
                <div className="flex flex-wrap items-start gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-xs text-muted-foreground">{t('ai.currentTask')}</p>
                    <p className="font-semibold">{s.tasks?.title ?? t('ai.workSession')}</p>
                  </div>
                  <StatusBadge value={s.status} />
                </div>
                {s.current_step && <p className="rounded-lg bg-muted px-3 py-2 text-sm" dir="auto"><span className="text-muted-foreground">{t('ai.currentStep')}:</span> {s.current_step}</p>}
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  <StatCard label={t('ai.started')} value={<span className="text-sm">{formatDateTime(s.started_at)}</span>} />
                  <StatCard label={t('ai.duration')} value={durationBetween(s.started_at, s.completed_at)} />
                  <StatCard label={t('ai.tokens')} value={formatNumber(Number(s.input_tokens) + Number(s.output_tokens))} />
                  <StatCard label={t('ai.estimatedCost')} value={formatUsd(Number(s.estimated_cost_usd))} />
                </div>
                <SessionControls session={s} />
                <Button variant="outline" size="sm" className="justify-self-start" onClick={() => onOpenSession(s.id)}>{t('ai.inspectSession')}</Button>
                {live.data?.events && <div className="max-h-80 overflow-y-auto rounded-lg border p-4"><SessionTimeline events={live.data.events} /></div>}
              </div>
            ) : (
              <p className="py-8 text-center text-sm text-muted-foreground">{t('ai.computerIdle')}</p>
            )}
          </div>
        </div>
        <Section title={t('ai.computerLogs')}>
          <ol className="grid max-h-64 gap-1 overflow-y-auto font-mono text-xs">
            {data.logs.length === 0 && <li className="text-muted-foreground">{t('ai.noLogs')}</li>}
            {data.logs.map((l, i) => <li key={i}><span className="text-muted-foreground">{formatDateTime(l.at)}</span> [{l.kind}] {l.message}</li>)}
          </ol>
        </Section>
      </div>
      <div className="grid content-start gap-6">
        <Section title={t('ai.capabilities')}>
          <p className="mb-3 text-xs text-muted-foreground">{t('ai.providerLabel')}: <span dir="ltr">{data.provider}</span></p>
          {([['files', FolderOpen], ['documents', FileText], ['browser', Globe], ['terminal', Terminal]] as const).map(([k, Icon]) => (
            <div key={k} className="flex items-center justify-between py-1.5 text-sm">
              <span className="flex items-center gap-2"><Icon className="size-4 text-muted-foreground" /> {t(`ai.caps.${k}`)}</span>
              <Badge tone={caps[k] ? 'success' : 'neutral'}>{caps[k] ? t('ai.available') : t('ai.notConnected')}</Badge>
            </div>
          ))}
          {(!caps.browser || !caps.terminal) && <p className="mt-3 text-xs text-muted-foreground">{t('ai.capsNote')}</p>}
        </Section>
        <Section title={t('ai.recentDocuments')}>
          <ul className="grid gap-1 text-sm">
            {data.documents.slice(0, 8).map((d) => <li key={d.id} className="flex items-center gap-2"><FileText className="size-4 text-muted-foreground" /><Link className="min-w-0 flex-1 truncate hover:underline" to={`/app/documents/${d.id}`}>{d.title}</Link><StatusBadge value={d.status} /></li>)}
            {data.documents.length === 0 && <li className="text-muted-foreground">{t('ai.noOutputs')}</li>}
          </ul>
        </Section>
      </div>
    </div>
  );
}

function WorkspaceFilesTab({ employeeId }: { employeeId: string }) {
  const { t } = useTranslation();
  const msg = useErrorMessage();
  const { data } = useComputer(employeeId);
  if (!data) return <LoadingBlock />;
  if (!data.files.length) return <EmptyState icon={<FolderOpen />} title={t('ai.noWorkspaceFiles')} description={t('ai.workspaceHint')} />;
  return (
    <div className="overflow-hidden rounded-xl border bg-card">
      <ul>
        {data.files.map((f) => (
          <li key={f.id} className="flex items-center gap-3 border-b px-4 py-3 last:border-0">
            <FileText className="size-4 text-muted-foreground" />
            <span className="flex-1 truncate text-sm font-medium">{f.original_name}</span>
            <span className="text-xs text-muted-foreground">{formatBytes(f.size)} · {formatRelative(f.created_at)}</span>
            <Button variant="ghost" size="icon-sm" onClick={() => void downloadFile(f.id).catch((e: unknown) => toast.error(msg(e)))} aria-label={t('files.download')}><Download /></Button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function DocumentsTab({ employeeId }: { employeeId: string }) {
  const { t } = useTranslation();
  const { data } = useQuery({ queryKey: ['ai-outputs'], queryFn: () => api<Array<{ id: string; title: string; status: string; ai_employee_id: string; document_id: string | null; created_at: string }>>('/ai/outputs') });
  const list = (data ?? []).filter((o) => o.ai_employee_id === employeeId);
  if (!list.length) return <EmptyState icon={<FileText />} title={t('ai.noOutputs')} />;
  return (
    <div className="grid gap-2">
      {list.map((o) => (
        <div key={o.id} className="flex items-center gap-3 rounded-xl border bg-card p-3">
          <FileText className="size-4 text-muted-foreground" />
          <span className="flex-1 truncate text-sm font-medium">{o.title}</span>
          <StatusBadge value={o.status} />
          {o.document_id && <Button asChild variant="ghost" size="sm"><Link to={`/app/documents/${o.document_id}`}>{t('common.open')}</Link></Button>}
        </div>
      ))}
    </div>
  );
}

function MemoryTab({ employeeId }: { employeeId: string }) {
  const { t } = useTranslation();
  const { data } = useQuery({ queryKey: ['work', 'memories', { ai: employeeId }], queryFn: () => api<Array<{ id: string; title: string; content: string; memory_type: string; created_at: string }>>('/work/memories', { query: { ai_employee_id: employeeId } }) });
  if (!data?.length) return <EmptyState icon={<Brain />} title={t('memory.empty')} />;
  return (
    <div className="grid gap-3 md:grid-cols-2">
      {data.map((m) => (
        <div key={m.id} className="rounded-xl border bg-card p-4">
          <div className="flex items-center gap-2"><Badge>{t(`memoryTypes.${m.memory_type}`)}</Badge><span className="ms-auto text-xs text-muted-foreground">{formatRelative(m.created_at)}</span></div>
          <p className="mt-2 font-medium" dir="auto">{m.title}</p>
          <p className="mt-1 line-clamp-4 text-sm text-muted-foreground" dir="auto">{m.content}</p>
        </div>
      ))}
    </div>
  );
}

function ActivityTab({ employeeId }: { employeeId: string }) {
  const { t } = useTranslation();
  const { data = [] } = useQuery({ queryKey: ['ai-activity', employeeId], queryFn: () => api<Array<{ id: number; verb: string; summary: string; created_at: string }>>(`/ai/employees/${employeeId}/activity`) });
  if (!data.length) return <EmptyState icon={<Activity />} title={t('dashboard.noActivity')} />;
  return (
    <ul className="grid gap-1 rounded-xl border bg-card p-2">
      {data.map((a) => <li key={a.id} className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm"><span className="flex-1">{t(`activity.${a.verb}`, a.verb)} · {a.summary}</span><span className="text-xs text-muted-foreground">{formatRelative(a.created_at)}</span></li>)}
    </ul>
  );
}

function PerformanceTab({ employeeId }: { employeeId: string }) {
  const { t } = useTranslation();
  const { data } = useQuery({ queryKey: ['ai-performance', employeeId], queryFn: () => api<Record<string, number | null>>(`/ai/employees/${employeeId}/performance`) });
  if (!data) return <LoadingBlock />;
  const pct = (v: number | null | undefined) => (v === null || v === undefined ? '—' : `${v}%`);
  return (
    <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
      <StatCard label={t('ai.perf.completed')} value={formatNumber(data.tasks_completed)} />
      <StatCard label={t('ai.perf.failed')} value={formatNumber(data.tasks_failed)} />
      <StatCard label={t('ai.perf.successRate')} value={pct(data.success_rate)} />
      <StatCard label={t('ai.perf.avgTime')} value={data.avg_completion_minutes === null ? '—' : t('ai.perf.minutes', { count: data.avg_completion_minutes ?? 0 })} />
      <StatCard label={t('ai.perf.workload')} value={formatNumber(data.current_workload)} />
      <StatCard label={t('ai.tokens')} value={formatNumber(data.tokens)} />
      <StatCard label={t('ai.estimatedCost')} value={formatUsd(data.estimated_cost_usd)} />
      <StatCard label={t('ai.perf.approvalRate')} value={pct(data.approval_rate)} hint={t('ai.perf.documents', { count: data.documents_created ?? 0 })} />
    </div>
  );
}

function PermissionsTab({ e }: { e: AiEmployeeDetail }) {
  const { t } = useTranslation();
  const [perms, setPerms] = useState<string[]>(e.permissions?.permissions ?? []);
  const [folders, setFolders] = useState<string[]>(e.permissions?.allowed_folder_ids ?? []);
  const sharedFolders = useQuery({ queryKey: ['folders', 'shared', null], queryFn: () => api<{ folders: Array<{ id: string; name: string }> }>('/files/folders', { query: { space: 'shared' } }) });
  const save = useAction(() => apiPut(`/ai/employees/${e.id}/permissions`, { permissions: perms, allowed_folder_ids: folders }), { success: t('common.saved'), invalidate: [['ai-employee', e.id]] });
  const toggle = (list: string[], set: (v: string[]) => void, v: string) => set(list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Section title={t('ai.permissionsTitle')}>
        <div className="grid gap-2">
          {AI_PERMISSIONS.map((p) => (
            <label key={p} className="flex items-start gap-3 rounded-lg p-2 hover:bg-muted/50">
              <Checkbox checked={perms.includes(p)} onCheckedChange={() => toggle(perms, setPerms, p)} className="mt-0.5" />
              <span><span className="text-sm font-medium">{t(`aiPermissions.${p}.title`)}</span><span className="block text-xs text-muted-foreground">{t(`aiPermissions.${p}.body`)}</span></span>
            </label>
          ))}
        </div>
      </Section>
      <div className="grid content-start gap-6">
        <Section title={<span className="flex items-center gap-2"><Lock className="size-4" /> {t('ai.privateFilesRule')}</span>}>
          <p className="text-sm text-muted-foreground">{t('ai.privateFilesRuleBody')}</p>
        </Section>
        <Section title={t('ai.folderAccess')}>
          <p className="mb-3 text-xs text-muted-foreground">{t('ai.folderAccessHint')}</p>
          {sharedFolders.data?.folders.map((f) => (
            <label key={f.id} className="flex items-center gap-3 py-1.5 text-sm"><Checkbox checked={folders.includes(f.id)} onCheckedChange={() => toggle(folders, setFolders, f.id)} /> {f.name}</label>
          ))}
        </Section>
        <Button onClick={() => save.mutate(undefined)} loading={save.isPending}>{t('common.save')}</Button>
      </div>
    </div>
  );
}

function SettingsTab({ e }: { e: AiEmployeeDetail }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const deps = useDepartments();
  const [form, setForm] = useState({ name: e.name, job_title: e.job_title, department_id: e.department_id ?? '', autonomy: e.autonomy, role_description: e.role_description, instructions: e.instructions, skills: e.skills.join(', '), is_active: e.is_active });
  const [confirm, setConfirm] = useState(false);
  useEffect(() => setForm({ name: e.name, job_title: e.job_title, department_id: e.department_id ?? '', autonomy: e.autonomy, role_description: e.role_description, instructions: e.instructions, skills: e.skills.join(', '), is_active: e.is_active }), [e]);
  const save = useAction(() => apiPatch(`/ai/employees/${e.id}`, { ...form, department_id: form.department_id || null, skills: form.skills.split(',').map((s) => s.trim()).filter(Boolean) }), { success: t('common.saved'), invalidate: [['ai-employee', e.id], ['ai-employees']] });
  const remove = useAction(() => apiDelete(`/ai/employees/${e.id}`), { success: t('workforce.removed'), invalidate: [['ai-employees']], onSuccess: () => navigate('/app/workforce') });
  return (
    <div className="grid max-w-3xl gap-6">
      <Section title={t('ai.tabs.settings')}>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t('workforce.name')}><Input value={form.name} onChange={(ev) => setForm({ ...form, name: ev.target.value })} /></Field>
          <Field label={t('workforce.jobTitle')}><Input value={form.job_title} onChange={(ev) => setForm({ ...form, job_title: ev.target.value })} /></Field>
          <Field label={t('nav.departments')}>
            <NativeSelect value={form.department_id} onChange={(ev) => setForm({ ...form, department_id: ev.target.value })}>
              <option value="">{t('common.none')}</option>
              {deps.data?.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </NativeSelect>
          </Field>
          <Field label={t('workforce.autonomy')} hint={t(`autonomyHints.${form.autonomy}`)}>
            <NativeSelect value={form.autonomy} onChange={(ev) => setForm({ ...form, autonomy: ev.target.value as typeof form.autonomy })}>{AUTONOMY_LEVELS.map((a) => <option key={a} value={a}>{t(`autonomy.${a}`)}</option>)}</NativeSelect>
          </Field>
        </div>
        <Field className="mt-4" label={t('workforce.skills')}><Input value={form.skills} onChange={(ev) => setForm({ ...form, skills: ev.target.value })} /></Field>
        <Field className="mt-4" label={t('workforce.role')}><Textarea rows={3} value={form.role_description} onChange={(ev) => setForm({ ...form, role_description: ev.target.value })} /></Field>
        <Field className="mt-4" label={t('ai.standingInstructions')}><Textarea rows={4} value={form.instructions} onChange={(ev) => setForm({ ...form, instructions: ev.target.value })} /></Field>
        <div className="mt-4 flex items-center gap-3"><Switch id="active" checked={form.is_active} onCheckedChange={(v) => setForm({ ...form, is_active: v })} /><Label htmlFor="active">{t('ai.active')}</Label></div>
        <Button className="mt-4" onClick={() => save.mutate(undefined)} loading={save.isPending}>{t('common.save')}</Button>
      </Section>
      <VoiceSettings employeeId={e.id} />
      <Section title={<span className="text-destructive">{t('settings.dangerZone')}</span>}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-muted-foreground">{t('workforce.removeHint')}</p>
          <Button variant="destructive" onClick={() => setConfirm(true)}><Trash2 /> {t('workforce.remove')}</Button>
        </div>
      </Section>
      <ConfirmDialog open={confirm} onOpenChange={setConfirm} title={t('workforce.removeConfirm', { name: e.name })} confirmLabel={t('workforce.remove')} cancelLabel={t('common.cancel')} destructive onConfirm={() => { remove.mutate(undefined); setConfirm(false); }} />
    </div>
  );
}
