import { Badge, Button, Checkbox, NativeSelect, Section, Textarea } from '@nexus/ui';
import { useQuery } from '@tanstack/react-query';
import { Bot, FileText, Link2, LogOut, Mic, Presentation, RefreshCw, ShieldCheck, Sparkles, Users } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router';
import { Markdown, StatusBadge, useAction } from '@/components/common';
import { useOptions } from '@/features/work/shared';
import { api, apiPost } from '@/lib/api';
import { formatRelative } from '@/lib/format';
import { useSession } from '@/providers/session';

interface OfficeMeeting {
  id: string;
  meeting_link: string | null;
  status: string;
  consent_confirmed: boolean;
  recording_policy: string;
  minutes: string | null;
  provider: string;
  capabilities: { join: boolean; listen: boolean; speak: boolean; transcript: boolean };
  participants: Array<{ id: string; member_id: string | null; ai_employee_id: string | null; external_email: string | null; role: string }>;
  ai_sessions: Array<{ id: string; ai_employee_id: string; status: string; failure_reason: string | null; created_at: string }>;
  summaries: Array<{ id: string; summary: string; minutes: string; created_at: string }>;
  action_item_rows: Array<{ id: string; title: string; owner_hint: string | null; task_id: string | null }>;
  transcript: Array<{ id: number; speaker: string | null; text: string; source: string }> | null;
  presentations: Array<{ id: string; title: string; status: string; current_version: number }>;
}

/** AI-enabled meeting panel: participants, AI attendance, consent, transcript and post-meeting processing. */
export function MeetingOfficePanel({ meetingId }: { meetingId: string }) {
  const { t, i18n } = useTranslation();
  const { can } = useSession();
  const navigate = useNavigate();
  const o = useOptions();
  const key = ['meeting-office', meetingId];
  const { data: m } = useQuery({ queryKey: key, queryFn: () => api<OfficeMeeting>(`/meetings/${meetingId}/office`), refetchInterval: 15_000 });
  const [aiId, setAiId] = useState('');
  const [instructions, setInstructions] = useState('');
  const [transcript, setTranscript] = useState('');
  const [createTasks, setCreateTasks] = useState(true);
  const assign = useAction(() => apiPost<{ id: string }>(`/meetings/${meetingId}/assign-ai`, { ai_employee_id: aiId, instructions, present_presentation_id: m?.presentations[0]?.id ?? null }), { success: t('meetings.aiAssigned'), invalidate: [key], onSuccess: (r) => navigate(`/app/tasks/${r.id}`) });
  const consent = useAction((confirmed: boolean) => apiPost(`/meetings/${meetingId}/consent`, { confirmed }), { invalidate: [key] });
  const addTranscript = useAction(() => apiPost(`/meetings/${meetingId}/transcript`, { text: transcript }), { success: t('common.saved'), invalidate: [key], onSuccess: () => setTranscript('') });
  const process = useAction(() => apiPost<{ tasks_created: number; decisions: number }>(`/meetings/${meetingId}/process`, { create_tasks: createTasks, language: i18n.language }), { success: t('meetings.processed'), invalidate: [key, ['work', 'meetings', meetingId], ['work', 'tasks']] });
  const leave = useAction((sessionId: string) => apiPost(`/meetings/sessions/${sessionId}/leave`), { invalidate: [key] });
  const sync = useAction((sessionId: string) => apiPost(`/meetings/sessions/${sessionId}/sync-transcript`), { success: t('common.saved'), invalidate: [key] });
  if (!m) return null;
  const name = (p: OfficeMeeting['participants'][number]) => (p.ai_employee_id ? o.aiName(p.ai_employee_id) : p.member_id ? o.memberName(p.member_id) : p.external_email) ?? '—';

  return (
    <div className="grid gap-6">
      <Section title={<span className="flex items-center gap-2"><Users className="size-4" /> {t('meetings.participants')}</span>}>
        <ul className="grid gap-1.5 text-sm">
          {m.participants.map((p) => (
            <li key={p.id} className="flex items-center gap-2">
              {p.ai_employee_id ? <Bot className="size-4 text-primary" /> : <Users className="size-4 text-muted-foreground" />}
              <span className="flex-1 truncate" dir="auto">{name(p)}</span>
              {p.external_email && <Badge tone="warning">{t('mail.external')}</Badge>}
              {p.role !== 'attendee' && <Badge>{t(`meetings.roles.${p.role}`)}</Badge>}
            </li>
          ))}
          {m.participants.length === 0 && <li className="text-muted-foreground">—</li>}
        </ul>
        {m.meeting_link && <a className="mt-3 flex items-center gap-2 text-sm text-primary" href={m.meeting_link} target="_blank" rel="noreferrer noopener"><Link2 className="size-4" /> {t('meetings.joinLink')}</a>}
      </Section>

      <Section title={<span className="flex items-center gap-2"><Bot className="size-4" /> {t('meetings.aiAttendance')}</span>}>
        <p className="mb-3 rounded-lg bg-muted px-3 py-2 text-xs">{m.capabilities.join ? t('meetings.providerReady', { provider: m.provider }) : t('meetings.providerMissing')}</p>
        {m.ai_sessions.length > 0 && (
          <ul className="mb-3 grid gap-1.5 text-sm">
            {m.ai_sessions.map((s) => (
              <li key={s.id} className="flex items-center gap-2">
                <span className="flex-1 truncate">{o.aiName(s.ai_employee_id)}</span>
                <Badge tone={s.status === 'in_meeting' ? 'success' : s.status === 'not_supported' || s.status === 'failed' ? 'warning' : 'neutral'}>{t(`meetings.sessionStatus.${s.status}`)}</Badge>
                {can('ai.control') && ['joining', 'in_meeting', 'presenting'].includes(s.status) && <Button size="icon-sm" variant="ghost" onClick={() => leave.mutate(s.id)} aria-label={t('meetings.leave')}><LogOut /></Button>}
                {can('meetings.manage') && m.capabilities.transcript && <Button size="icon-sm" variant="ghost" onClick={() => sync.mutate(s.id)} aria-label={t('meetings.syncTranscript')}><RefreshCw /></Button>}
              </li>
            ))}
          </ul>
        )}
        {can('ai.assign') && (
          <div className="grid gap-2">
            <NativeSelect value={aiId} onChange={(e) => setAiId(e.target.value)}><option value="">{t('meetings.pickAi')}</option>{o.ais.map((a) => <option key={a.value} value={a.value}>{a.label}</option>)}</NativeSelect>
            <Textarea rows={2} value={instructions} onChange={(e) => setInstructions(e.target.value)} placeholder={t('meetings.aiInstructions')} />
            <Button disabled={!aiId} loading={assign.isPending} onClick={() => assign.mutate(undefined)}><Sparkles /> {t('meetings.assignAi')}</Button>
            <p className="text-xs text-muted-foreground">{t('meetings.assignAiHint')}</p>
          </div>
        )}
        {can('meetings.manage') && (
          <label className="mt-4 flex items-start gap-2 text-sm"><Checkbox checked={m.consent_confirmed} onCheckedChange={(v) => consent.mutate(v === true)} className="mt-0.5" /> <span><ShieldCheck className="me-1 inline size-4" />{t('meetings.consent')}</span></label>
        )}
        <p className="mt-2 text-xs text-muted-foreground">{t('meetings.recordingPolicy', { policy: t(`meetings.recording.${m.recording_policy}`) })}</p>
      </Section>

      {m.presentations.length > 0 && (
        <Section title={<span className="flex items-center gap-2"><Presentation className="size-4" /> {t('nav.presentations')}</span>}>
          <ul className="grid gap-1.5 text-sm">{m.presentations.map((p) => <li key={p.id} className="flex items-center gap-2"><Link className="flex-1 truncate text-primary" to={`/app/presentations/${p.id}`}>{p.title}</Link><StatusBadge value={p.status} /></li>)}</ul>
        </Section>
      )}

      {can('meetings.manage') && (
        <Section title={<span className="flex items-center gap-2"><Mic className="size-4" /> {t('meetings.transcript')}</span>}>
          {m.transcript && m.transcript.length > 0 && <div className="mb-3 max-h-56 overflow-y-auto rounded-lg bg-muted/40 p-3 text-xs" dir="auto">{m.transcript.map((l) => <p key={l.id}>{l.speaker ? <strong>{l.speaker}: </strong> : null}{l.text}</p>)}</div>}
          {m.recording_policy === 'none' ? <p className="text-xs text-muted-foreground">{t('meetings.transcriptsDisabled')}</p> : (
            <>
              <Textarea rows={4} value={transcript} onChange={(e) => setTranscript(e.target.value)} placeholder={t('meetings.transcriptPlaceholder')} />
              <Button className="mt-2" size="sm" variant="outline" disabled={!transcript.trim()} loading={addTranscript.isPending} onClick={() => addTranscript.mutate(undefined)}>{t('common.save')}</Button>
            </>
          )}
          <div className="mt-4 grid gap-2 border-t pt-4">
            <label className="flex items-center gap-2 text-sm"><Checkbox checked={createTasks} onCheckedChange={(v) => setCreateTasks(v === true)} /> {t('meetings.createTasks')}</label>
            <Button variant="brand" loading={process.isPending} onClick={() => process.mutate(undefined)}><Sparkles /> {t('meetings.processAi')}</Button>
          </div>
        </Section>
      )}

      {m.summaries[0] && (
        <Section title={<span className="flex items-center gap-2"><FileText className="size-4" /> {t('meetings.minutesTitle')}</span>}>
          <Markdown>{m.summaries[0].minutes || m.summaries[0].summary}</Markdown>
          <p className="mt-2 text-xs text-muted-foreground">{formatRelative(m.summaries[0].created_at)}</p>
        </Section>
      )}
      {m.action_item_rows.length > 0 && (
        <Section title={t('meetings.actionItems')}>
          <ul className="grid gap-1.5 text-sm">{m.action_item_rows.map((a) => <li key={a.id} className="flex items-center gap-2"><span className="flex-1" dir="auto">{a.title}{a.owner_hint ? <span className="text-muted-foreground"> · {a.owner_hint}</span> : null}</span>{a.task_id && <Link className="text-xs text-primary" to={`/app/tasks/${a.task_id}`}>{t('nav.tasks')}</Link>}</li>)}</ul>
        </Section>
      )}
    </div>
  );
}
