import { Badge, Button, EmptyState, Field, Input, NativeSelect, Section, Switch, Tabs, TabsList, TabsTrigger, cn } from '@nexus/ui';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, Archive, Bot, Brain, CalendarDays, CheckCircle2, FileText, FolderOpen, Globe, ListChecks, Mail, Presentation, Send, Users, Volume2 } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { toast } from 'sonner';
import { LoadingBlock, StatusBadge, useAction, useErrorMessage } from '@/components/common';
import { api, apiPost, apiPut } from '@/lib/api';
import { formatDateTime, formatRelative } from '@/lib/format';
import { useSession } from '@/providers/session';
import { PresentationGrid, RequestPresentationDialog, type PresentationListItem } from './presentations';
import { AgendaList, type CalendarData } from './calendar';

export interface OfficeCapabilities {
  calendar: { provider: string; internal: boolean; externalSync: boolean };
  meetings: { provider: string; join: boolean; listen: boolean; speak: boolean; transcript: boolean; createMeeting: boolean };
  voice: { provider: string; tts: boolean; stt: boolean };
  email: { delivery_available: boolean };
  computer: { provider: string; browser: boolean; terminal: boolean };
}

export const useOfficeCapabilities = () => useQuery({ queryKey: ['office-capabilities'], queryFn: () => api<OfficeCapabilities>('/office/capabilities'), staleTime: 5 * 60_000 });

/** "Digital office" launcher: every app with its real connection status. */
export function DigitalOffice({ onOpen }: { onOpen: (tab: string) => void }) {
  const { t } = useTranslation();
  const { data: caps } = useOfficeCapabilities();
  const apps = [
    { key: 'mail', icon: Mail, tab: 'mail', ok: caps?.email.delivery_available, partial: true },
    { key: 'calendar', icon: CalendarDays, tab: 'calendar', ok: true },
    { key: 'meetings', icon: Users, tab: 'meetings', ok: caps?.meetings.join, partial: true },
    { key: 'presentations', icon: Presentation, tab: 'presentations', ok: true },
    { key: 'documents', icon: FileText, tab: 'documents', ok: true },
    { key: 'files', icon: FolderOpen, tab: 'files', ok: true },
    { key: 'tasks', icon: ListChecks, tab: 'tasks', ok: true },
    { key: 'browser', icon: Globe, tab: 'computer', ok: caps?.computer.browser },
    { key: 'memory', icon: Brain, tab: 'memory', ok: true },
    { key: 'approvals', icon: CheckCircle2, tab: 'approvals', ok: true },
  ];
  return (
    <Section title={t('office.title')}>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
        {apps.map((a) => (
          <button key={a.key} onClick={() => (a.tab === 'approvals' ? window.location.assign('/app/approvals') : onOpen(a.tab))} className="flex flex-col items-center gap-2 rounded-xl border bg-surface p-3 text-center transition-colors hover:bg-muted">
            <a.icon className="size-6 text-primary" />
            <span className="text-xs font-medium">{t(`office.apps.${a.key}`)}</span>
            <span className={cn('text-[10px]', a.ok ? 'text-success' : 'text-muted-foreground')}>{a.ok ? t('office.ready') : a.partial ? t('office.limited') : t('ai.notConnected')}</span>
          </button>
        ))}
      </div>
    </Section>
  );
}

interface MailMessage {
  id: string;
  direction: string;
  folder: string;
  status: string;
  from_address: string;
  to_addresses: string[];
  subject: string;
  body_text: string;
  is_external: boolean;
  risk: string;
  failure_reason: string | null;
  task_id: string | null;
  created_at: string;
  sent_at: string | null;
}

export function MailTab({ employeeId }: { employeeId: string }) {
  const { t } = useTranslation();
  const { can } = useSession();
  const [folder, setFolder] = useState('inbox');
  const [open, setOpen] = useState<MailMessage | null>(null);
  const { data, isLoading } = useQuery({ queryKey: ['ai-mail', employeeId, folder], queryFn: () => api<{ mailbox: { address: string | null; status: string }; delivery_available: boolean; messages: MailMessage[] }>(`/ai/employees/${employeeId}/mail`, { query: { folder } }) });
  const send = useAction((id: string) => apiPost(`/mail/messages/${id}/send`), { success: t('mail.sent'), invalidate: [['ai-mail', employeeId]] });
  const archive = useAction((id: string) => apiPost(`/mail/messages/${id}/archive`), { invalidate: [['ai-mail', employeeId]] });
  return (
    <div className="grid gap-4">
      {data && (
        <div className={cn('flex flex-wrap items-center gap-2 rounded-xl border px-4 py-3 text-sm', data.mailbox.status === 'active' ? 'border-success/30 bg-success/5' : 'border-warning/40 bg-warning/10')}>
          <Mail className="size-4" />
          {data.mailbox.status === 'active' ? <span dir="ltr">{data.mailbox.address}</span> : <span>{t('mail.notConnected')}</span>}
        </div>
      )}
      <Tabs value={folder} onValueChange={setFolder}><TabsList>{['inbox', 'sent', 'drafts', 'archived', 'tasks'].map((f) => <TabsTrigger key={f} value={f}>{t(`mail.folders.${f}`)}</TabsTrigger>)}</TabsList></Tabs>
      {isLoading ? <LoadingBlock /> : !data?.messages.length ? <EmptyState icon={<Mail />} title={t('mail.empty')} /> : (
        <div className="grid gap-4 lg:grid-cols-[360px_1fr]">
          <ul className="grid content-start gap-1 rounded-xl border bg-card p-1">
            {data.messages.map((m) => (
              <li key={m.id}>
                <button onClick={() => setOpen(m)} className={cn('w-full rounded-lg px-3 py-2 text-start hover:bg-muted', open?.id === m.id && 'bg-muted')}>
                  <div className="flex items-center gap-2"><span className="flex-1 truncate text-sm font-medium" dir="auto">{m.subject || '—'}</span><StatusBadge value={m.status === 'received' ? 'ready' : m.status} /></div>
                  <p className="truncate text-xs text-muted-foreground" dir="ltr">{m.direction === 'inbound' ? m.from_address : m.to_addresses.join(', ')}</p>
                  <p className="text-[11px] text-muted-foreground">{formatRelative(m.sent_at ?? m.created_at)}{m.is_external ? ` · ${t('mail.external')}` : ''}</p>
                </button>
              </li>
            ))}
          </ul>
          {open ? (
            <Section title={<span dir="auto">{open.subject}</span>}>
              <div className="grid gap-1 text-xs text-muted-foreground" dir="ltr">
                <p>From: {open.from_address}</p>
                <p>To: {open.to_addresses.join(', ')}</p>
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                {open.is_external && <Badge tone="danger">{t('mail.external')}</Badge>}
                <Badge>{t(`risk.${open.risk}`)}</Badge>
                {open.task_id && <Link className="text-xs text-primary" to={`/app/tasks/${open.task_id}`}>{t('mail.relatedTask')}</Link>}
              </div>
              {open.failure_reason && <p className="mt-3 flex items-center gap-2 text-sm text-destructive"><AlertTriangle className="size-4" /> {t(`errors.${open.failure_reason}`, open.failure_reason)}</p>}
              <div className="mt-4 whitespace-pre-wrap rounded-lg bg-muted/40 p-4 text-sm" dir="auto">{open.body_text}</div>
              <div className="mt-4 flex gap-2">
                {can('approvals.decide') && ['draft', 'pending_approval', 'failed'].includes(open.status) && open.direction === 'outbound' && (
                  <Button onClick={() => send.mutate(open.id)} loading={send.isPending} disabled={!data.delivery_available}><Send /> {t('mail.approveSend')}</Button>
                )}
                {can('ai.control') && open.folder !== 'archived' && <Button variant="outline" onClick={() => { archive.mutate(open.id); setOpen(null); }}><Archive /> {t('memory.archive')}</Button>}
              </div>
              {!data.delivery_available && <p className="mt-2 text-xs text-muted-foreground">{t('mail.deliveryUnavailable')}</p>}
            </Section>
          ) : <EmptyState icon={<Mail />} title={t('mail.select')} />}
        </div>
      )}
    </div>
  );
}

export function EmployeeCalendarTab({ employeeId }: { employeeId: string }) {
  const { data } = useQuery({ queryKey: ['calendar', employeeId], queryFn: () => api<CalendarData>('/calendar', { query: { ai_employee_id: employeeId } }) });
  if (!data) return <LoadingBlock />;
  return <AgendaList data={data} />;
}

export function EmployeeMeetingsTab({ employeeId }: { employeeId: string }) {
  const { t } = useTranslation();
  const { data } = useQuery({ queryKey: ['calendar', employeeId, 'meetings'], queryFn: () => api<CalendarData>('/calendar', { query: { ai_employee_id: employeeId, from: new Date(Date.now() - 60 * 86400_000).toISOString() } }) });
  const { data: caps } = useOfficeCapabilities();
  if (!data) return <LoadingBlock />;
  const meetings = data.events.filter((e) => e.event_type === 'meeting');
  return (
    <div className="grid gap-4">
      <div className="rounded-xl border bg-card px-4 py-3 text-sm">
        {caps?.meetings.join ? t('meetings.providerReady', { provider: caps.meetings.provider }) : t('meetings.providerMissing')}
      </div>
      {meetings.length === 0 ? <EmptyState icon={<Users />} title={t('meetings.empty')} /> : (
        <ul className="grid gap-2">
          {meetings.map((m) => (
            <li key={m.id}><Link to={`/app/meetings/${m.meeting_id}`} className="flex items-center gap-3 rounded-xl border bg-card p-3 hover:bg-muted/50"><CalendarDays className="size-4 text-primary" /><span className="flex-1 truncate font-medium">{m.title}</span><span className="text-xs text-muted-foreground">{formatDateTime(m.starts_at)}</span></Link></li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function EmployeePresentationsTab({ employeeId }: { employeeId: string }) {
  const { t } = useTranslation();
  const { can } = useSession();
  const [open, setOpen] = useState(false);
  const { data } = useQuery({ queryKey: ['presentations', employeeId], queryFn: () => api<PresentationListItem[]>('/presentations', { query: { ai_employee_id: employeeId } }) });
  return (
    <div className="grid gap-4">
      {can('ai.assign') && <Button className="justify-self-start" variant="brand" onClick={() => setOpen(true)}><Bot /> {t('presentations.request')}</Button>}
      {!data ? <LoadingBlock /> : data.length === 0 ? <EmptyState icon={<Presentation />} title={t('presentations.empty')} /> : <PresentationGrid items={data} />}
      <RequestPresentationDialog open={open} onOpenChange={setOpen} presetAi={employeeId} onCreated={(taskId) => window.location.assign(`/app/tasks/${taskId}`)} />
    </div>
  );
}

export function VoiceSettings({ employeeId }: { employeeId: string }) {
  const { t } = useTranslation();
  const msg = useErrorMessage();
  const { data } = useQuery({ queryKey: ['ai-voice', employeeId], queryFn: () => api<{ profile: { voice_id: string | null; language: 'ar' | 'en'; speaking_style: string; enabled: boolean }; provider: string; capabilities: { tts: boolean } }>(`/ai/employees/${employeeId}/voice`) });
  const [draft, setDraft] = useState<{ voice_id: string; language: string; speaking_style: string } | null>(null);
  const save = useAction((patch: Record<string, unknown>) => apiPut(`/ai/employees/${employeeId}/voice`, patch), { success: t('common.saved'), invalidate: [['ai-voice', employeeId]] });
  const [testing, setTesting] = useState(false);
  if (!data) return null;
  const v = draft ?? { voice_id: data.profile.voice_id ?? '', language: data.profile.language, speaking_style: data.profile.speaking_style };
  const test = async () => {
    setTesting(true);
    try {
      const res = await api<Response>(`/ai/employees/${employeeId}/voice/test`, { method: 'POST', body: { text: t('voice.sample') }, raw: true });
      const url = URL.createObjectURL(await res.blob());
      await new Audio(url).play();
    } catch (e) {
      toast.error(msg(e));
    } finally {
      setTesting(false);
    }
  };
  return (
    <Section title={<span className="flex items-center gap-2"><Volume2 className="size-4" /> {t('voice.title')}</span>}>
      {!data.capabilities.tts && <p className="mb-3 rounded-lg bg-warning/10 px-3 py-2 text-xs text-warning">{t('voice.notConnected')}</p>}
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label={t('common.language')}><NativeSelect value={v.language} onChange={(e) => setDraft({ ...v, language: e.target.value })}><option value="ar">العربية</option><option value="en">English</option></NativeSelect></Field>
        <Field label={t('voice.style')}><NativeSelect value={v.speaking_style} onChange={(e) => setDraft({ ...v, speaking_style: e.target.value })}>{['professional', 'friendly', 'concise', 'formal'].map((x) => <option key={x} value={x}>{t(`voice.styles.${x}`)}</option>)}</NativeSelect></Field>
        <Field label={t('voice.voiceId')} hint={data.provider}><Input dir="ltr" value={v.voice_id} onChange={(e) => setDraft({ ...v, voice_id: e.target.value })} /></Field>
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 text-sm"><Switch checked={data.profile.enabled} disabled={!data.capabilities.tts} onCheckedChange={(enabled) => save.mutate({ enabled })} /> {t('voice.enabled')}</label>
        <Button variant="outline" size="sm" onClick={() => save.mutate({ voice_id: v.voice_id || null, language: v.language, speaking_style: v.speaking_style })}>{t('common.save')}</Button>
        <Button variant="outline" size="sm" disabled={!data.profile.enabled || !data.capabilities.tts} loading={testing} onClick={() => void test()}><Volume2 /> {t('voice.test')}</Button>
      </div>
      <p className="mt-3 text-xs text-muted-foreground">{t('voice.disclosure')}</p>
    </Section>
  );
}

