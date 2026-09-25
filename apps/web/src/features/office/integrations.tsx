import { Badge, Button, Field, Input, NativeSelect, PageHeader, Section, Switch } from '@nexus/ui';
import { useQuery } from '@tanstack/react-query';
import { Plug } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { LoadingBlock, useAction } from '@/components/common';
import { api, apiPut } from '@/lib/api';
import { useSession } from '@/providers/session';

interface Caps {
  ai: { provider: string; is_mock: boolean };
  computer: { provider: string; files: boolean; documents: boolean; browser: boolean; terminal: boolean };
  email_provider: { name: string; send: boolean; customFrom: boolean; attachments: boolean; agent_domain: string | null };
  email: { delivery_available: boolean };
  calendar: { provider: string; internal: boolean; externalSync: boolean };
  meetings: { provider: string; createMeeting: boolean; join: boolean; listen: boolean; transcript: boolean; speak: boolean };
  voice: { provider: string; tts: boolean; stt: boolean };
}

interface Policy {
  email_send_mode: 'draft_only' | 'approval_required' | 'autonomous';
  allow_external_email: boolean;
  autonomous_external_domains: string[];
  daily_send_limit_per_employee: number;
  presentation_publish_requires_approval: boolean;
  meeting_recording: 'none' | 'transcript_only' | 'audio_and_transcript';
  transcript_retention_days: number;
  require_participant_consent: boolean;
  allow_ai_speaking_external: boolean;
}

function Cap({ ok, label }: { ok: boolean; label: string }) {
  return <Badge tone={ok ? 'success' : 'neutral'}>{label}: {ok ? '✓' : '—'}</Badge>;
}

/** Real provider status (no fake "connected" states) + the organization's communication policy. */
export function IntegrationsSettings() {
  const { t } = useTranslation();
  const { can } = useSession();
  const { data: caps } = useQuery({ queryKey: ['office-capabilities'], queryFn: () => api<Caps>('/office/capabilities') });
  const { data: policy } = useQuery({ queryKey: ['office-policy'], queryFn: () => api<Policy>('/office/policy') });
  const [p, setP] = useState<Policy | null>(null);
  useEffect(() => { if (policy) setP({ ...policy, autonomous_external_domains: policy.autonomous_external_domains ?? [] }); }, [policy]);
  const save = useAction(() => apiPut('/office/policy', p), { success: t('common.saved'), invalidate: [['office-policy']] });
  if (!caps || !p) return <LoadingBlock />;
  const rows: Array<{ key: string; provider: string; ok: boolean; badges: Array<[boolean, string]> }> = [
    { key: 'ai', provider: caps.ai.provider, ok: !caps.ai.is_mock, badges: [] },
    { key: 'computer', provider: caps.computer.provider, ok: true, badges: [[caps.computer.files, t('ai.caps.files')], [caps.computer.browser, t('ai.caps.browser')], [caps.computer.terminal, t('ai.caps.terminal')]] },
    { key: 'email', provider: caps.email_provider.name, ok: caps.email.delivery_available, badges: [[caps.email_provider.send, t('integrations.send')], [caps.email_provider.customFrom, t('integrations.identities')], [Boolean(caps.email_provider.agent_domain), caps.email_provider.agent_domain ?? t('integrations.domain')]] },
    { key: 'calendar', provider: caps.calendar.provider, ok: true, badges: [[caps.calendar.internal, t('integrations.internal')], [caps.calendar.externalSync, t('integrations.externalSync')]] },
    { key: 'meetings', provider: caps.meetings.provider, ok: caps.meetings.join, badges: [[caps.meetings.join, t('integrations.join')], [caps.meetings.transcript, t('meetings.transcript')], [caps.meetings.speak, t('integrations.speak')]] },
    { key: 'voice', provider: caps.voice.provider, ok: caps.voice.tts, badges: [[caps.voice.tts, 'TTS'], [caps.voice.stt, 'STT']] },
  ];
  const editable = can('org.manage');
  return (
    <>
      <PageHeader title={t('settings.integrations')} description={t('integrations.description')} icon={<Plug />} />
      <div className="grid gap-6">
        <Section title={t('integrations.providers')}>
          <ul className="grid gap-3">
            {rows.map((r) => (
              <li key={r.key} className="flex flex-wrap items-center gap-2 rounded-lg border p-3">
                <span className="w-40 font-medium">{t(`integrations.kinds.${r.key}`)}</span>
                <Badge tone={r.ok ? 'success' : 'warning'}>{r.ok ? t('integrations.connected') : t('integrations.notConnected')}</Badge>
                <span className="font-mono text-xs text-muted-foreground" dir="ltr">{r.provider}</span>
                <span className="flex flex-wrap gap-1">{r.badges.map(([ok, label]) => <Cap key={label} ok={ok} label={label} />)}</span>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-xs text-muted-foreground">{t('integrations.setupNote')}</p>
        </Section>
        <Section title={t('integrations.policy')}>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t('integrations.sendMode')} hint={t(`integrations.sendModes.${p.email_send_mode}Hint`)}>
              <NativeSelect disabled={!editable} value={p.email_send_mode} onChange={(e) => setP({ ...p, email_send_mode: e.target.value as Policy['email_send_mode'] })}>{(['draft_only', 'approval_required', 'autonomous'] as const).map((m) => <option key={m} value={m}>{t(`integrations.sendModes.${m}`)}</option>)}</NativeSelect>
            </Field>
            <Field label={t('integrations.dailyLimit')}><Input disabled={!editable} type="number" min={0} max={1000} value={p.daily_send_limit_per_employee} onChange={(e) => setP({ ...p, daily_send_limit_per_employee: Number(e.target.value) })} /></Field>
            <label className="flex items-center gap-3 text-sm"><Switch disabled={!editable} checked={p.allow_external_email} onCheckedChange={(v) => setP({ ...p, allow_external_email: v })} /> {t('integrations.allowExternal')}</label>
            <Field label={t('integrations.autonomousDomains')} hint={t('integrations.autonomousDomainsHint')}><Input disabled={!editable} dir="ltr" value={p.autonomous_external_domains.join(', ')} onChange={(e) => setP({ ...p, autonomous_external_domains: e.target.value.split(/[,\s]+/).filter(Boolean) })} /></Field>
            <label className="flex items-center gap-3 text-sm"><Switch disabled={!editable} checked={p.presentation_publish_requires_approval} onCheckedChange={(v) => setP({ ...p, presentation_publish_requires_approval: v })} /> {t('integrations.presentationApproval')}</label>
            <Field label={t('integrations.recording')}>
              <NativeSelect disabled={!editable} value={p.meeting_recording} onChange={(e) => setP({ ...p, meeting_recording: e.target.value as Policy['meeting_recording'] })}>{(['none', 'transcript_only', 'audio_and_transcript'] as const).map((m) => <option key={m} value={m}>{t(`meetings.recording.${m}`)}</option>)}</NativeSelect>
            </Field>
            <Field label={t('integrations.retention')}><Input disabled={!editable} type="number" min={1} max={3650} value={p.transcript_retention_days} onChange={(e) => setP({ ...p, transcript_retention_days: Number(e.target.value) })} /></Field>
            <label className="flex items-center gap-3 text-sm"><Switch disabled={!editable} checked={p.require_participant_consent} onCheckedChange={(v) => setP({ ...p, require_participant_consent: v })} /> {t('integrations.consent')}</label>
            <label className="flex items-center gap-3 text-sm"><Switch disabled={!editable} checked={p.allow_ai_speaking_external} onCheckedChange={(v) => setP({ ...p, allow_ai_speaking_external: v })} /> {t('integrations.speakExternal')}</label>
          </div>
          <p className="mt-4 rounded-lg bg-muted px-3 py-2 text-xs">{t('integrations.alwaysApproval')}</p>
          {editable && <Button className="mt-4" onClick={() => save.mutate(undefined)} loading={save.isPending}>{t('common.save')}</Button>}
        </Section>
      </div>
    </>
  );
}
