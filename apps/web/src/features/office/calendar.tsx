import { Badge, Button, Checkbox, Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, EmptyState, Field, Input, NativeSelect, PageHeader, Textarea } from '@nexus/ui';
import { useQuery } from '@tanstack/react-query';
import { CalendarDays, ChevronLeft, ChevronRight, Clock, Flag, ListChecks, Plus, Search, Users } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router';
import { FeatureGate } from '@/components/guards';
import { LoadingBlock, useAction } from '@/components/common';
import { useOptions } from '@/features/work/shared';
import { api, apiPost } from '@/lib/api';
import { formatDate, formatTime } from '@/lib/format';
import { useSession } from '@/providers/session';

export interface CalendarData {
  events: Array<{ id: string; title: string; event_type: string; starts_at: string; ends_at: string; meeting_id: string | null; location: string | null }>;
  deadlines: Array<{ id: string; title: string; at: string; kind: string; link: string }>;
  milestones: Array<{ id: string; title: string; at: string; kind: string; link: string }>;
}

type Item = { key: string; title: string; at: string; end?: string; kind: string; link: string };

export function AgendaList({ data }: { data: CalendarData }) {
  const { t } = useTranslation();
  const items: Item[] = useMemo(
    () =>
      [
        ...data.events.map((e) => ({ key: `e${e.id}`, title: e.title, at: e.starts_at, end: e.ends_at, kind: e.event_type, link: e.meeting_id ? `/app/meetings/${e.meeting_id}` : '' })),
        ...data.deadlines.map((d) => ({ key: `d${d.id}`, title: d.title, at: d.at, kind: 'deadline', link: d.link })),
        ...data.milestones.map((m) => ({ key: `m${m.id}`, title: m.title, at: m.at, kind: 'milestone', link: m.link })),
      ].sort((a, b) => a.at.localeCompare(b.at)),
    [data],
  );
  if (!items.length) return <EmptyState icon={<CalendarDays />} title={t('calendar.empty')} />;
  const groups = new Map<string, Item[]>();
  for (const it of items) {
    const day = it.at.slice(0, 10);
    groups.set(day, [...(groups.get(day) ?? []), it]);
  }
  const icon = (k: string) => (k === 'meeting' ? <Users className="size-4 text-primary" /> : k === 'deadline' ? <ListChecks className="size-4 text-warning" /> : k === 'milestone' ? <Flag className="size-4 text-success" /> : <Clock className="size-4 text-muted-foreground" />);
  return (
    <div className="grid gap-4">
      {[...groups.entries()].map(([day, list]) => (
        <section key={day}>
          <p className="mb-2 text-sm font-semibold">{formatDate(day, { weekday: 'long', day: 'numeric', month: 'long' })}</p>
          <ul className="grid gap-1.5">
            {list.map((it) => {
              const row = (
                <div className="flex items-center gap-3 rounded-xl border bg-card px-4 py-3 hover:bg-muted/40">
                  {icon(it.kind)}
                  <span className="w-24 shrink-0 font-mono text-xs text-muted-foreground">{it.kind === 'milestone' ? '—' : `${formatTime(it.at)}${it.end ? `–${formatTime(it.end)}` : ''}`}</span>
                  <span className="min-w-0 flex-1 truncate text-sm font-medium" dir="auto">{it.title}</span>
                  <Badge>{t(`calendar.kinds.${it.kind}`)}</Badge>
                </div>
              );
              return <li key={it.key}>{it.link ? <Link to={it.link}>{row}</Link> : row}</li>;
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}

export function CalendarPage() {
  const { t, i18n } = useTranslation();
  const { can } = useSession();
  const [weekStart, setWeekStart] = useState(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - d.getDay()); // Sunday
    return d;
  });
  const [schedule, setSchedule] = useState(false);
  const [freeTime, setFreeTime] = useState(false);
  const to = new Date(weekStart.getTime() + 14 * 86400_000);
  const { data, isLoading } = useQuery({ queryKey: ['calendar', 'org', weekStart.toISOString()], queryFn: () => api<CalendarData>('/calendar', { query: { from: weekStart.toISOString(), to: to.toISOString() } }) });
  const Prev = i18n.language === 'ar' ? ChevronRight : ChevronLeft;
  const Next = i18n.language === 'ar' ? ChevronLeft : ChevronRight;
  return (
    <>
      <PageHeader
        title={t('nav.calendar')}
        description={t('calendar.description')}
        icon={<CalendarDays />}
        actions={
          <>
            <Button variant="outline" onClick={() => setFreeTime(true)}><Search /> {t('calendar.findTime')}</Button>
            {can('meetings.manage') && <Button onClick={() => setSchedule(true)}><Plus /> {t('calendar.scheduleMeeting')}</Button>}
          </>
        }
      />
      <div className="mb-4 flex items-center gap-2">
        <Button variant="outline" size="icon-sm" onClick={() => setWeekStart(new Date(weekStart.getTime() - 14 * 86400_000))} aria-label={t('calendar.previous')}><Prev /></Button>
        <Button variant="outline" size="sm" onClick={() => { const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - d.getDay()); setWeekStart(d); }}>{t('calendar.today')}</Button>
        <Button variant="outline" size="icon-sm" onClick={() => setWeekStart(new Date(weekStart.getTime() + 14 * 86400_000))} aria-label={t('calendar.next')}><Next /></Button>
        <span className="ms-2 text-sm text-muted-foreground">{formatDate(weekStart.toISOString())} – {formatDate(to.toISOString())}</span>
      </div>
      {isLoading || !data ? <LoadingBlock /> : <AgendaList data={data} />}
      <FeatureGate feature="meetings"><ScheduleMeetingDialog open={schedule} onOpenChange={setSchedule} /></FeatureGate>
      <FreeTimeDialog open={freeTime} onOpenChange={setFreeTime} />
    </>
  );
}

export function ScheduleMeetingDialog({ open, onOpenChange, presetPresentation, projectId }: { open: boolean; onOpenChange: (o: boolean) => void; presetPresentation?: string; projectId?: string | null }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const o = useOptions();
  const [f, setF] = useState({ title: '', starts_at: '', duration: '60', agenda: '', link: '', members: [] as string[], ais: [] as string[], external: '' });
  const toggle = (k: 'members' | 'ais', id: string) => setF((p) => ({ ...p, [k]: p[k].includes(id) ? p[k].filter((x) => x !== id) : [...p[k], id] }));
  const create = useAction(
    () =>
      apiPost<{ id: string }>('/meetings/schedule', {
        title: f.title,
        starts_at: new Date(f.starts_at).toISOString(),
        duration_minutes: Number(f.duration),
        agenda: f.agenda,
        member_ids: f.members,
        ai_employee_ids: f.ais,
        external_emails: f.external.split(/[,\s;]+/).filter(Boolean),
        meeting_link: f.link || null,
        project_id: projectId ?? null,
        presentation_id: presetPresentation ?? null,
      }),
    { success: t('calendar.scheduled'), invalidate: [['calendar'], ['work', 'meetings']], onSuccess: (m) => { onOpenChange(false); navigate(`/app/meetings/${m.id}`); } },
  );
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="lg" closeLabel={t('common.close')}>
        <DialogHeader><DialogTitle>{t('calendar.scheduleMeeting')}</DialogTitle></DialogHeader>
        <form className="grid gap-4 sm:grid-cols-2" onSubmit={(e) => { e.preventDefault(); create.mutate(undefined); }}>
          <Field label={t('fields.title')} className="sm:col-span-2"><Input required value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} /></Field>
          <Field label={t('meetings.date')}><Input required type="datetime-local" value={f.starts_at} onChange={(e) => setF({ ...f, starts_at: e.target.value })} /></Field>
          <Field label={t('meetings.duration')}><Input type="number" min={5} max={480} value={f.duration} onChange={(e) => setF({ ...f, duration: e.target.value })} /></Field>
          <Field label={t('calendar.link')} hint={t('calendar.linkHint')} className="sm:col-span-2"><Input dir="ltr" placeholder="https://meet.google.com/…" value={f.link} onChange={(e) => setF({ ...f, link: e.target.value })} /></Field>
          <Field label={t('meetings.agenda')} className="sm:col-span-2"><Textarea rows={3} value={f.agenda} onChange={(e) => setF({ ...f, agenda: e.target.value })} /></Field>
          <div className="grid max-h-44 content-start gap-1 overflow-y-auto rounded-lg border p-2">
            <p className="text-xs font-medium text-muted-foreground">{t('calendar.humans')}</p>
            {o.members.map((m) => <label key={m.value} className="flex items-center gap-2 text-sm"><Checkbox checked={f.members.includes(m.value)} onCheckedChange={() => toggle('members', m.value)} /> {m.label}</label>)}
          </div>
          <div className="grid max-h-44 content-start gap-1 overflow-y-auto rounded-lg border p-2">
            <p className="text-xs font-medium text-muted-foreground">{t('calendar.aiEmployees')}</p>
            {o.ais.map((m) => <label key={m.value} className="flex items-center gap-2 text-sm"><Checkbox checked={f.ais.includes(m.value)} onCheckedChange={() => toggle('ais', m.value)} /> {m.label}</label>)}
          </div>
          <Field label={t('calendar.external')} hint={t('calendar.externalHint')} className="sm:col-span-2"><Input dir="ltr" value={f.external} onChange={(e) => setF({ ...f, external: e.target.value })} placeholder="name@partner.com" /></Field>
          <DialogFooter className="sm:col-span-2"><Button type="submit" loading={create.isPending} disabled={!f.title || !f.starts_at}>{t('calendar.schedule')}</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function FreeTimeDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const { t } = useTranslation();
  const o = useOptions();
  const [f, setF] = useState({ members: [] as string[], ais: [] as string[], duration: '60', days: '7' });
  const [slots, setSlots] = useState<Array<{ start: string; end: string }> | null>(null);
  const find = useAction(
    () => apiPost<Array<{ start: string; end: string }>>('/calendar/free-time', { member_ids: f.members, ai_employee_ids: f.ais, from: new Date().toISOString(), to: new Date(Date.now() + Number(f.days) * 86400_000).toISOString(), duration_minutes: Number(f.duration) }),
    { onSuccess: (r) => setSlots(r) },
  );
  return (
    <Dialog open={open} onOpenChange={(v) => { onOpenChange(v); if (!v) setSlots(null); }}>
      <DialogContent closeLabel={t('common.close')}>
        <DialogHeader><DialogTitle>{t('calendar.findTime')}</DialogTitle></DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t('calendar.humans')}><NativeSelect multiple className="h-28" value={f.members} onChange={(e) => setF({ ...f, members: Array.from(e.target.selectedOptions).map((x) => x.value) })}>{o.members.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}</NativeSelect></Field>
          <Field label={t('calendar.aiEmployees')}><NativeSelect multiple className="h-28" value={f.ais} onChange={(e) => setF({ ...f, ais: Array.from(e.target.selectedOptions).map((x) => x.value) })}>{o.ais.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}</NativeSelect></Field>
          <Field label={t('meetings.duration')}><Input type="number" value={f.duration} onChange={(e) => setF({ ...f, duration: e.target.value })} /></Field>
          <Field label={t('calendar.withinDays')}><Input type="number" value={f.days} onChange={(e) => setF({ ...f, days: e.target.value })} /></Field>
        </div>
        <p className="text-xs text-muted-foreground">{t('calendar.workHours')}</p>
        <Button onClick={() => find.mutate(undefined)} loading={find.isPending}><Search /> {t('calendar.search')}</Button>
        {slots && (slots.length === 0 ? <p className="text-sm text-muted-foreground">{t('calendar.noSlots')}</p> : <ul className="grid gap-1">{slots.map((s) => <li key={s.start} className="rounded-lg border px-3 py-2 text-sm">{formatDate(s.start, { weekday: 'long', day: 'numeric', month: 'short' })} · {formatTime(s.start)}–{formatTime(s.end)}</li>)}</ul>)}
      </DialogContent>
    </Dialog>
  );
}
