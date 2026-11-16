import { simulateTechCost, type SimInputs } from '@nexus/shared';
import { Badge, Button, Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, Field, Input, Section, Tabs, TabsContent, TabsList, TabsTrigger, cn } from '@nexus/ui';
import { Activity, ArrowLeft, ArrowRight, Calculator, CheckCircle2, CircleDashed, Cpu, Map as MapIcon, PackageCheck, Pencil, RotateCcw, Save, ShoppingCart, Wrench } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { LoadingBlock } from '@/components/common';
import { FIELDS, type Field as FieldDef } from '../fields';
import { day, fsend, num, pct, sar, todayIso, useCollection, useFounder, useFounderAction, type Row } from '../lib';
import { CollectionSection, DataTable, ExportMenu, Kpi, Meter, Opt, RecordDialog, Title, useChartColors } from '../ui';

type Phase = Row & { ord: number; name: string; goal: string | null; status: string; start: string | null; end: string | null; dates_estimated: boolean; budget: number; lines_total: number; spent: number; remaining: number; tasks_total: number; tasks_done: number; tasks_overdue: number; conditions_total: number; conditions_done: number; progress: number; assets_required: number; assets_purchased: number; assets_installed: number; annual_opex: string | null; notes: string | null; details: Record<string, unknown> };
interface Tech { launch_date: string | null; plan_approved_on: string | null; independence: number; current_phase_id: string | null; next_phase_id: string | null; phases: Phase[]; external_active: Row[]; external_planned: Row[]; replaced: Row[]; owned_active: Row[]; models: Row[]; assets: Row[]; risks: Array<Row & { score: number }>; blocking_conditions: Row[] }

function useDir() {
  const { i18n } = useTranslation();
  return i18n.language === 'ar' ? ArrowLeft : ArrowRight;
}

function Flow({ current }: { current: number }) {
  const { t } = useTranslation();
  const Arrow = useDir();
  const steps = t('founder.tech.flowSteps', { returnObjects: true }) as string[];
  return (
    <div className="flex flex-col items-stretch gap-2 md:flex-row md:items-center">
      {steps.map((s, i) => (
        <div key={s} className="contents">
          <div className={cn('flex-1 rounded-xl border p-3 text-center text-sm', i + 1 === current ? 'border-primary bg-primary/10 font-semibold text-primary' : i + 1 < current ? 'bg-success/10 text-success' : 'text-muted-foreground')} dir="ltr">
            <span className="block text-[11px] opacity-70">{i + 1}</span>{s}
          </div>
          {i < steps.length - 1 && <Arrow className="mx-auto size-4 shrink-0 rotate-90 text-muted-foreground md:rotate-0" />}
        </div>
      ))}
    </div>
  );
}

function Timeline({ phases, selected, onSelect }: { phases: Phase[]; selected: string | null; onSelect: (id: string) => void }) {
  const { t } = useTranslation();
  return (
    <div className="grid gap-2 md:grid-cols-4">
      {phases.map((p) => (
        <button key={p.id} type="button" onClick={() => onSelect(p.id)} className={cn('relative rounded-xl border p-3 text-start transition-colors hover:bg-muted', selected === p.id && 'ring-2 ring-primary')}>
          <div className="mb-2 flex items-center justify-between gap-2"><span className="text-xs text-muted-foreground">{p.ord}</span><Opt group="status" value={p.status} /></div>
          <p className="line-clamp-2 text-sm font-semibold">{p.name}</p>
          <p className="mt-1 text-xs text-muted-foreground">{p.start ? `${day(p.start)} → ${p.end ? day(p.end) : '…'}` : t('founder.common.notSet')}{p.dates_estimated && p.start ? ` · ${t('founder.common.estimated')}` : ''}</p>
          <Meter className="mt-3" value={p.progress} label={t('founder.common.progress')} />
        </button>
      ))}
    </div>
  );
}

function PhaseCard({ p }: { p: Phase }) {
  const { t } = useTranslation();
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <Kpi label={t('founder.tech.budget')} value={p.budget ? sar(p.budget, true) : '—'} hint={p.lines_total && p.lines_total !== p.budget ? `${t('founder.tech.budgetLines')}: ${sar(p.lines_total, true)}` : undefined} />
      <Kpi label={t('founder.tech.spent')} value={sar(p.spent, true)} />
      <Kpi label={t('founder.tech.remaining')} value={p.budget ? sar(p.remaining, true) : '—'} tone={p.remaining < 0 ? 'bad' : undefined} />
      <Kpi label={t('founder.tech.assets')} value={`${num(p.assets_installed)} / ${num(p.assets_purchased)} / ${num(p.assets_required)}`} hint={`${t('founder.tech.installed')} / ${t('founder.tech.purchased')} / ${t('founder.tech.required')}`} />
      <Kpi label={t('founder.tech.tasksDone')} value={`${p.tasks_done} / ${p.tasks_total}`} />
      <Kpi label={t('founder.tech.tasksOverdue')} value={num(p.tasks_overdue)} tone={p.tasks_overdue ? 'warn' : undefined} />
      <Kpi label={t('founder.tech.conditions')} value={`${p.conditions_done} / ${p.conditions_total}`} />
      <Kpi label={t('founder.tech.start')} value={<span className="text-base">{p.start ? day(p.start) : '—'} → {p.end ? day(p.end) : '—'}</span>} hint={p.dates_estimated ? t('founder.common.estimated') : undefined} />
    </div>
  );
}

function ServiceList({ title, rows, empty }: { title: string; rows: Row[]; empty?: string }) {
  const { t } = useTranslation();
  return (
    <Section title={<span className="flex items-center gap-2">{title}<Badge>{rows.length}</Badge></span>}>
      {rows.length === 0 ? <p className="text-sm text-muted-foreground">{empty ?? t('founder.common.empty')}</p> : (
        <ul className="grid gap-2 text-sm">{rows.map((s) => (
          <li key={s.id} className="flex items-start justify-between gap-2"><span><span className="font-medium">{String(s.capability)}</span><span className="block text-xs text-muted-foreground" dir="auto">{String(s.provider)}</span></span>{s.verified ? <Badge tone="success">{t('founder.tech.verified')}</Badge> : <Badge tone="warning">{t('founder.tech.unverified')}</Badge>}</li>
        ))}</ul>
      )}
    </Section>
  );
}

export function TechnologyPage() {
  const { t } = useTranslation();
  const { data } = useFounder<Tech>('/founder/technology');
  const [sel, setSel] = useState<string | null>(null);
  const c = useChartColors();
  if (!data) return <LoadingBlock />;
  const selected = data.phases.find((p) => p.id === (sel ?? data.current_phase_id)) ?? data.phases[0];
  const current = data.phases.find((p) => p.id === data.current_phase_id);
  const next = data.phases.find((p) => p.id === data.next_phase_id);
  const axis = { stroke: c.text, fontSize: 11, tickLine: false, axisLine: false } as const;
  const sheets = () => [
    { title: t('founder.tech.timeline'), columns: ['ord', 'name', 'status', 'start', 'end', 'budget', 'spent', 'remaining', 'progress'].map((k) => ({ key: k, label: k === 'start' ? t('founder.tech.start') : k === 'end' ? t('founder.tech.end') : k === 'spent' ? t('founder.tech.spent') : k === 'remaining' ? t('founder.tech.remaining') : t(`founder.fields.${k === 'budget' ? 'budget_total' : k}`) })), rows: data.phases.map((p) => ({ ord: p.ord, name: p.name, status: t(`founder.opt.status.${p.status}`), start: p.start, end: p.end, budget: p.budget, spent: p.spent, remaining: p.remaining, progress: p.progress })) },
    { title: t('founder.tech.externalActive'), columns: [{ key: 'capability', label: t('founder.fields.capability') }, { key: 'provider', label: t('founder.fields.provider') }], rows: data.external_active.map((s) => ({ capability: String(s.capability), provider: String(s.provider) })) },
    { title: t('founder.tech.models'), columns: [{ key: 'name', label: t('founder.fields.name') }, { key: 'role', label: t('founder.fields.role') }, { key: 'status', label: t('founder.fields.status') }], rows: data.models.map((m) => ({ name: String(m.name), role: String(m.role ?? ''), status: t(`founder.opt.status.${String(m.status)}`) })) },
  ];

  return (
    <>
      <Title title={t('founder.tech.title')} subtitle={data.plan_approved_on ? `${t('founder.tech.subtitle')} ${t('founder.tech.planApproved', { date: day(data.plan_approved_on) })}` : t('founder.tech.subtitle')} icon={<Cpu />} actions={<ExportMenu title={t('founder.reports.technology')} sheets={sheets} />} />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Kpi label={t('founder.tech.independence')} value={pct(data.independence)} hint={t('founder.tech.independenceHint')} />
        <Kpi label={t('founder.tech.current')} value={<span className="text-base">{current?.name ?? '—'}</span>} />
        <Kpi label={t('founder.tech.next')} value={<span className="text-base">{next?.name ?? '—'}</span>} />
        <Kpi label={t('founder.tech.externalActive')} value={num(data.external_active.length)} hint={`${t('founder.tech.replaced')}: ${data.replaced.length}`} />
      </div>
      {!data.launch_date && <p className="mt-3 rounded-lg bg-warning/10 px-3 py-2 text-sm text-warning">{t('founder.tech.datesFromLaunch')}</p>}

      <Section className="mt-4" title={t('founder.tech.flow')}><Flow current={current?.ord ?? 1} /></Section>

      <Section className="mt-4" title={t('founder.tech.timeline')}>
        <Timeline phases={data.phases} selected={selected?.id ?? null} onSelect={setSel} />
        {selected && <div className="mt-4"><p className="mb-3 text-sm text-muted-foreground">{selected.goal}</p><PhaseCard p={selected} /></div>}
      </Section>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Section title={`${t('founder.tech.budget')} / ${t('founder.tech.spent')}`}>
          <div className="h-60" dir="ltr">
            <ResponsiveContainer><BarChart data={data.phases.map((p) => ({ name: String(p.ord), budget: p.budget, spent: p.spent }))}>
              <CartesianGrid stroke={c.grid} vertical={false} /><XAxis dataKey="name" {...axis} /><YAxis {...axis} width={60} tickFormatter={(v: number) => num(v / 1000) + 'k'} /><Tooltip formatter={(v) => sar(v)} /><Legend />
              <Bar dataKey="budget" name={t('founder.tech.budget')} fill={c.series[0]} radius={[4, 4, 0, 0]} /><Bar dataKey="spent" name={t('founder.tech.spent')} fill={c.series[2]} radius={[4, 4, 0, 0]} />
            </BarChart></ResponsiveContainer>
          </div>
        </Section>
        <Section title={next ? t('founder.tech.conditionsOf', { name: next.name }) : t('founder.tech.conditions')}>
          {data.blocking_conditions.length === 0 ? <p className="text-sm text-muted-foreground">{t('founder.common.empty')}</p> : (
            <ul className="grid gap-1.5 text-sm">{data.blocking_conditions.map((x) => <li key={x.id} className="flex items-start gap-2"><CircleDashed className="mt-0.5 size-4 shrink-0 text-muted-foreground" />{String(x.title)}</li>)}</ul>
          )}
        </Section>
      </div>

      <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <ServiceList title={t('founder.tech.externalActive')} rows={data.external_active} />
        <ServiceList title={t('founder.tech.externalPlanned')} rows={data.external_planned} />
        <ServiceList title={t('founder.tech.replaced')} rows={data.replaced} />
        <ServiceList title={t('founder.tech.owned')} rows={data.owned_active} />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Section title={t('founder.tech.models')}>
          <ul className="grid gap-2 text-sm">{data.models.map((m) => (
            <li key={m.id} className="flex items-start justify-between gap-2"><span><span className="font-medium" dir="ltr">{String(m.name)}</span><span className="block text-xs text-muted-foreground">{String(m.role ?? '')}{m.quality_score != null ? ` · ${t('founder.tech.quality')}: ${num(m.quality_score, 1)}` : ''}</span></span><span className="flex gap-1"><Opt group="host" value={m.host} /><Opt group="status" value={m.status} /></span></li>
          ))}</ul>
        </Section>
        <Section title={t('founder.tech.risks')}>
          <ul className="grid gap-2 text-sm">{data.risks.map((r) => (
            <li key={r.id} className="flex items-start justify-between gap-2"><span>{String(r.title)}<span className="block text-xs text-muted-foreground">{String(r.mitigation ?? '')}</span></span><Badge tone={r.score >= 15 ? 'danger' : r.score >= 9 ? 'warning' : 'neutral'}>{r.score}</Badge></li>
          ))}</ul>
        </Section>
      </div>
      <Section className="mt-4" title={t('founder.tech.assets')}>
        <div className="-mx-4 overflow-x-auto"><table className="w-full min-w-[560px] text-sm"><thead><tr className="border-b text-xs text-muted-foreground"><th className="px-4 py-2 text-start">{t('founder.fields.name')}</th><th className="px-4 py-2 text-start">{t('founder.fields.phase_id')}</th><th className="px-4 py-2">{t('founder.tech.required')}</th><th className="px-4 py-2">{t('founder.tech.purchased')}</th><th className="px-4 py-2">{t('founder.tech.installed')}</th></tr></thead>
          <tbody>{data.assets.map((a) => <tr key={a.id} className="border-b last:border-0"><td className="px-4 py-2">{String(a.name)}</td><td className="px-4 py-2 text-muted-foreground">{data.phases.find((p) => p.id === a.phase_id)?.ord ?? '—'}</td><td className="px-4 py-2 text-center tabular-nums">{num(a.quantity)}</td><td className="px-4 py-2 text-center tabular-nums">{num(a.purchased_qty)}</td><td className="px-4 py-2 text-center tabular-nums">{num(a.installed_qty)}</td></tr>)}</tbody></table></div>
      </Section>
    </>
  );
}

/* ───────── plan (per phase, fully editable) ───────── */

function AssetActions({ row }: { row: Row }) {
  const { t } = useTranslation();
  const [mode, setMode] = useState<'buy' | 'install' | null>(null);
  const [qty, setQty] = useState('1');
  const [price, setPrice] = useState(String(row.unit_cost ?? ''));
  const [date, setDate] = useState(todayIso());
  const [who, setWho] = useState('');
  const act = useFounderAction(() => (mode === 'buy'
    ? fsend('POST', `/founder/assets/${row.id}/purchase`, { quantity: Number(qty), unit_price: Number(price), occurred_on: date, counterparty: who || null })
    : fsend('POST', `/founder/assets/${row.id}/install`, { quantity: Number(qty) })), { onSuccess: () => setMode(null) });
  const canBuy = Number(row.purchased_qty) < Number(row.quantity);
  const canInstall = Number(row.installed_qty) < Number(row.purchased_qty);
  return (
    <>
      <Button size="icon-sm" variant="ghost" disabled={!canBuy} aria-label={t('founder.tech.buy')} title={t('founder.tech.buy')} onClick={() => { setQty('1'); setMode('buy'); }}><ShoppingCart /></Button>
      <Button size="icon-sm" variant="ghost" disabled={!canInstall} aria-label={t('founder.tech.install')} title={t('founder.tech.install')} onClick={() => { setQty('1'); setMode('install'); }}><Wrench /></Button>
      <Dialog open={mode !== null} onOpenChange={(o) => !o && setMode(null)}>
        <DialogContent size="sm" closeLabel={t('founder.common.cancel')}>
          <DialogHeader><DialogTitle>{mode === 'buy' ? t('founder.tech.buy') : t('founder.tech.install')} — {String(row.name)}</DialogTitle></DialogHeader>
          <div className="grid gap-3">
            <Field label={t('founder.tech.quantity')} htmlFor="aq"><Input id="aq" type="number" dir="ltr" min={1} value={qty} onChange={(e) => setQty(e.target.value)} /></Field>
            {mode === 'buy' && <>
              <Field label={t('founder.tech.unitPrice')} htmlFor="ap"><Input id="ap" type="number" dir="ltr" min={0} value={price} onChange={(e) => setPrice(e.target.value)} /></Field>
              <Field label={t('founder.fields.occurred_on')} htmlFor="ad"><Input id="ad" type="date" dir="ltr" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
              <Field label={t('founder.fields.counterparty')} htmlFor="aw"><Input id="aw" value={who} onChange={(e) => setWho(e.target.value)} /></Field>
              <p className="text-xs text-muted-foreground">{t('founder.tech.buyHint')}</p>
            </>}
          </div>
          <DialogFooter><Button variant="outline" onClick={() => setMode(null)}>{t('founder.common.cancel')}</Button><Button loading={act.isPending} onClick={() => act.mutate(undefined)}>{t('founder.common.save')}</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function PhaseDetails({ p }: { p: Phase }) {
  const { t } = useTranslation();
  const d = p.details ?? {};
  const arch = (d.architecture as string[][] | undefined) ?? [];
  const list = (k: string) => (d[k] as string[] | undefined) ?? [];
  const training = d.training as { goal?: string; cost_year?: number; example?: string; rules?: string[] } | undefined;
  const sections = d.sections as Record<string, string> | undefined;
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {arch.length > 0 && <Section title={t('founder.tech.architecture')}><table className="w-full text-sm"><tbody>{arch.map(([k, v]) => <tr key={k} className="border-b last:border-0"><td className="py-1.5 text-muted-foreground">{k}</td><td className="py-1.5 font-medium" dir="auto">{v}</td></tr>)}</tbody></table></Section>}
      {sections && <Section title={t('founder.tech.budgetLines')}><ul className="grid gap-1 text-sm">{Object.entries(sections).map(([k, v]) => <li key={k}><b>{k}.</b> {v}</li>)}</ul></Section>}
      {list('assumptions').length > 0 && <Section title={t('founder.tech.assumptions')}><ul className="grid list-disc gap-1 ps-5 text-sm">{list('assumptions').map((x) => <li key={x}>{x}</li>)}</ul></Section>}
      {list('notes').length > 0 && <Section title={t('founder.tech.notes')}><ul className="grid list-disc gap-1 ps-5 text-sm">{list('notes').map((x) => <li key={x}>{x}</li>)}</ul></Section>}
      {list('excluded').length > 0 && <Section title={t('founder.tech.excluded')}><ul className="grid list-disc gap-1 ps-5 text-sm">{list('excluded').map((x) => <li key={x}>{x}</li>)}</ul></Section>}
      {training && <Section title={t('founder.tech.training')}><div className="grid gap-2 text-sm"><p>{training.goal}</p>{training.cost_year && <p>{sar(training.cost_year)} / {t('founder.opt.recurring.yearly')}</p>}<p className="text-muted-foreground">{training.example}</p><ul className="grid list-disc gap-1 ps-5 text-warning">{(training.rules ?? []).map((x) => <li key={x}>{x}</li>)}</ul></div></Section>}
      {p.notes && <Section title={t('founder.tech.notes')}><p className="text-sm">{p.notes}</p></Section>}
    </div>
  );
}

export function TechPlanPage() {
  const { t } = useTranslation();
  const { data } = useFounder<Tech>('/founder/technology');
  const [tab, setTab] = useState<string | null>(null);
  const [editing, setEditing] = useState<Phase | null | 'new'>(null);
  const make = useFounderAction((id: string) => fsend('PATCH', `/founder/c/phases/${id}`, { status: 'current' }));
  if (!data) return <LoadingBlock />;
  const active = tab ?? data.current_phase_id ?? data.phases[0]?.id ?? '';
  return (
    <>
      <Title title={t('founder.nav.plan')} subtitle={data.plan_approved_on ? t('founder.tech.planApproved', { date: day(data.plan_approved_on) }) : undefined} icon={<MapIcon />} actions={<Button size="sm" variant="outline" onClick={() => setEditing('new')}>{t('founder.common.add')}</Button>} />
      <Tabs value={active} onValueChange={setTab}>
        <TabsList className="flex h-auto flex-wrap">{data.phases.map((p) => <TabsTrigger key={p.id} value={p.id}>{p.ord}. {p.name.split('—')[0]}</TabsTrigger>)}</TabsList>
        {data.phases.map((p) => (
          <TabsContent key={p.id} value={p.id} className="mt-4 grid gap-4">
            <Section title={p.name} actions={<div className="flex gap-2">{p.status !== 'current' && <Button size="sm" variant="outline" loading={make.isPending} onClick={() => make.mutate(p.id)}>{t('founder.tech.makeCurrent')}</Button>}<Button size="sm" variant="outline" onClick={() => setEditing(p)}><Pencil /> {t('founder.common.edit')}</Button></div>}>
              <p className="mb-4 text-sm">{p.goal}</p>
              <PhaseCard p={p} />
            </Section>
            <PhaseDetails p={p} />
            <CollectionSection col="budgets" title={t('founder.tech.budgetLines')} filter={{ phase_id: p.id }} />
            <CollectionSection col="assets" title={t('founder.tech.assets')} filter={{ phase_id: p.id }} rowExtra={(r) => <AssetActions row={r} />} />
            <CollectionSection col="models" title={t('founder.tech.models')} filter={{ phase_id: p.id }} />
            <CollectionSection col="ti_tasks" title={t('founder.tech.tasks')} filter={{ phase_id: p.id, kind: 'task' }} />
            <CollectionSection col="ti_tasks" title={t('founder.tech.conditionsOf', { name: p.name.split('—')[0] })} filter={{ phase_id: p.id, kind: 'exit_condition' }} />
          </TabsContent>
        ))}
      </Tabs>
      <div className="mt-4 grid gap-4">
        <CollectionSection col="services" title={t('founder.fields.capability')} />
        <CollectionSection col="risks" title={t('founder.tech.risks')} filter={{ area: 'technology' }} />
      </div>
      <RecordDialog col="phases" row={editing === 'new' ? null : editing} open={editing !== null} onClose={() => setEditing(null)} />
    </>
  );
}

/* ───────── current progress ───────── */

interface Progress { done: Row[]; in_progress: Row[]; not_started: Row[]; overdue: Row[]; needs_decision: Row[]; needs_budget: Row[]; blocking: Row[]; unverified_services: Row[]; status_table: { services: Row[]; assets: Row[]; models: Row[] }; phases: Phase[]; current_phase_id: string | null }
const UPDATE_KEYS = ['status', 'progress', 'due_on', 'completed_on', 'evidence', 'evidence_document_id', 'note', 'needs_decision', 'needs_budget', 'budget_amount'];

function ItemList({ title, rows, onOpen, icon, tone }: { title: string; rows: Row[]; onOpen: (r: Row) => void; icon: React.ReactNode; tone?: string }) {
  const { t } = useTranslation();
  return (
    <Section title={<span className="flex items-center gap-2"><span className={cn('[&_svg]:size-4', tone)}>{icon}</span>{title}<Badge>{rows.length}</Badge></span>}>
      {rows.length === 0 ? <p className="text-sm text-muted-foreground">{t('founder.common.empty')}</p> : (
        <ul className="grid max-h-80 gap-1.5 overflow-y-auto text-sm">{rows.map((r) => (
          <li key={`${r.id}-${String(r.kind)}`}><button type="button" onClick={() => r.kind !== 'decision' && onOpen(r)} className="flex w-full items-start justify-between gap-2 rounded-lg px-2 py-1.5 text-start hover:bg-muted">
            <span><span className="line-clamp-2">{String(r.title)}</span>{r.phase_name ? <span className="block text-xs text-muted-foreground">{String(r.phase_name).split('—')[0]}{r.evidence ? ` · ${t('founder.progressPage.evidence')} ✓` : ''}</span> : null}</span>
            <span className="shrink-0">{r.kind === 'decision' ? <Opt group="status" value={r.status} /> : <Opt group="status" value={r.status} />}</span>
          </button></li>
        ))}</ul>
      )}
    </Section>
  );
}

export function ProgressPage() {
  const { t } = useTranslation();
  const { data } = useFounder<Progress>('/founder/technology/progress');
  const [open, setOpen] = useState<Row | null>(null);
  if (!data) return <LoadingBlock />;
  const fields = (FIELDS.ti_tasks ?? []).filter((f) => UPDATE_KEYS.includes(f.key));
  const svcFields: FieldDef[] = (FIELDS.services ?? []).filter((f) => ['capability', 'provider', 'ownership', 'status', 'verified', 'target_phase_id'].includes(f.key)).map((f) => ({ ...f, table: true }));
  const ss = data.status_table.services;
  const planVsReality = [
    { item: 'Supabase', plan: t('founder.progressPage.pv.supabase'), svc: ss.find((s) => String(s.provider).startsWith('Supabase Cloud')) },
    { item: 'Render', plan: t('founder.progressPage.pv.render'), svc: ss.find((s) => s.provider === 'Render') },
    { item: 'Sonnet API', plan: t('founder.progressPage.pv.sonnet'), svc: ss.find((s) => String(s.provider).includes('Sonnet')) },
    { item: 'Cloudflare', plan: t('founder.progressPage.pv.cloudflare'), svc: ss.find((s) => String(s.provider).startsWith('Cloudflare')) },
  ];
  const assetsBought = data.status_table.assets.reduce((a, x) => a + Number(x.purchased_qty), 0);
  return (
    <>
      <Title title={t('founder.progressPage.title')} subtitle={t('founder.progressPage.subtitle')} icon={<Activity />} />
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        <ItemList title={t('founder.progressPage.done')} rows={data.done} onOpen={setOpen} icon={<CheckCircle2 />} tone="text-success" />
        <ItemList title={t('founder.progressPage.inProgress')} rows={data.in_progress} onOpen={setOpen} icon={<Activity />} tone="text-primary" />
        <ItemList title={t('founder.progressPage.notStarted')} rows={data.not_started} onOpen={setOpen} icon={<CircleDashed />} />
        <ItemList title={t('founder.progressPage.overdue')} rows={data.overdue} onOpen={setOpen} icon={<CircleDashed />} tone="text-destructive" />
        <ItemList title={t('founder.progressPage.needsDecision')} rows={data.needs_decision} onOpen={setOpen} icon={<CircleDashed />} tone="text-warning" />
        <ItemList title={t('founder.progressPage.needsBudget')} rows={data.needs_budget} onOpen={setOpen} icon={<CircleDashed />} tone="text-warning" />
      </div>
      <div className="mt-4"><ItemList title={t('founder.progressPage.blocking')} rows={data.blocking} onOpen={setOpen} icon={<PackageCheck />} tone="text-destructive" /></div>

      <Section className="mt-4" title={t('founder.progressPage.planVsReality')}>
        <div className="-mx-4 overflow-x-auto"><table className="w-full min-w-[560px] text-sm">
          <thead><tr className="border-b text-xs text-muted-foreground"><th className="px-4 py-2 text-start">{t('founder.fields.name')}</th><th className="px-4 py-2 text-start">{t('founder.progressPage.planned')}</th><th className="px-4 py-2 text-start">{t('founder.progressPage.reality')}</th></tr></thead>
          <tbody>
            {planVsReality.map((r) => <tr key={r.item} className="border-b"><td className="px-4 py-2 font-medium" dir="ltr">{r.item}</td><td className="px-4 py-2">{r.plan}</td><td className="px-4 py-2">{r.svc ? <span className="flex flex-wrap items-center gap-1.5"><Opt group="svc_status" value={r.svc.status} />{r.svc.verified ? <Badge tone="success">{t('founder.tech.verified')}</Badge> : <Badge tone="warning">{t('founder.tech.unverified')}</Badge>}<span className="text-xs text-muted-foreground">{String(r.svc.evidence ?? '')}</span></span> : '—'}</td></tr>)}
            <tr className="border-b"><td className="px-4 py-2 font-medium">{t('founder.tech.assets')}</td><td className="px-4 py-2">{t('founder.progressPage.pv.assets')}</td><td className="px-4 py-2">{t('founder.tech.purchased')}: {assetsBought}</td></tr>
            {data.phases.slice(1).map((p) => <tr key={p.id} className="border-b last:border-0"><td className="px-4 py-2 font-medium">{p.name.split('—')[1] ?? p.name}</td><td className="px-4 py-2">{t(`founder.progressPage.pv.${p.ord === 2 ? 'y2' : p.ord === 3 ? 'y3' : 'future'}`)}</td><td className="px-4 py-2"><span className="flex items-center gap-2"><Opt group="status" value={p.status} /><span className="text-xs text-muted-foreground">{p.conditions_done}/{p.conditions_total} · {t('founder.tech.spent')}: {sar(p.spent, true)}</span></span></td></tr>)}
          </tbody>
        </table></div>
      </Section>

      <div className="mt-4"><DataTable col="services" title={t('founder.progressPage.statusTable')} rows={ss} fields={svcFields} onEdit={(r) => setOpen({ ...r, __svc: true })} /></div>

      {open && !open.__svc && <RecordDialog col="ti_tasks" fields={fields} row={open} open onClose={() => setOpen(null)} title={`${t('founder.progressPage.update')} — ${String(open.title)}`} />}
      {open && open.__svc && <RecordDialog col="services" row={open} open onClose={() => setOpen(null)} />}
      <p className="mt-3 text-xs text-muted-foreground">{t('founder.tech.evidenceRequired')}</p>
    </>
  );
}

/* ───────── cost simulator ───────── */

const GROUPS: Array<{ key: string; fields: Array<keyof SimInputs> }> = [
  { key: 'usage', fields: ['companies', 'companies_growth_pct', 'requests_per_company_month', 'input_tokens_per_request', 'output_tokens_per_request', 'years'] },
  { key: 'api', fields: ['api_input_usd_per_mtok', 'api_output_usd_per_mtok', 'usd_to_sar', 'cloud_hosting_month'] },
  { key: 'hardware', fields: ['mac_strong_count', 'mac_strong_price', 'mac_medium_count', 'mac_medium_price', 'mac_voice_count', 'mac_voice_price', 'room_setup', 'hardware_life_years'] },
  { key: 'running', fields: ['power_kwh_month', 'power_sar_per_kwh', 'rent_year', 'internet_year', 'maintenance_year', 'salaries_year', 'training_year', 'other_opex_year'] },
];

export function SimulatorPage() {
  const { t } = useTranslation();
  const settings = useFounder<Record<string, unknown>>('/founder/settings');
  const scenarios = useCollection('scenarios');
  const [inputs, setInputs] = useState<Record<string, number> | null>(null);
  const [name, setName] = useState('');
  const c = useChartColors();
  const defaults = (settings.data?.simulator_defaults ?? {}) as Record<string, number>;
  const values = inputs ?? defaults;
  const r = useMemo(() => simulateTechCost(values as unknown as SimInputs), [values]);
  const save = useFounderAction(() => fsend('POST', '/founder/c/scenarios', { name: name.trim() || `${t('founder.sim.title')} ${todayIso()}`, inputs: values }), { onSuccess: () => setName('') });
  if (!settings.data) return <LoadingBlock />;
  const set = (k: string, v: string) => setInputs({ ...values, [k]: Number(v) });
  const axis = { stroke: c.text, fontSize: 11, tickLine: false, axisLine: false } as const;
  const sheets = () => [
    { title: t('founder.sim.inputs'), columns: [{ key: 'k', label: t('founder.fields.name') }, { key: 'v', label: t('founder.common.value') }], rows: GROUPS.flatMap((g) => g.fields.map((f) => ({ k: t(`founder.sim.f.${f}`), v: Number(values[f] ?? 0) }))) },
    { title: t('founder.sim.results'), columns: [{ key: 'k', label: t('founder.fields.name') }, { key: 'v', label: t('founder.common.value') }], rows: [
      [t('founder.sim.cloudYear'), r.cloud_cost_year], [t('founder.sim.ownedYear'), r.owned_cost_year], [t('founder.sim.capex'), r.capex], [t('founder.sim.breakEven'), r.break_even_months], [t('founder.sim.breakEvenCompanies'), r.break_even_companies],
      [t('founder.sim.savings', { years: values.years ?? 3 }), r.savings_total], [`${t('founder.sim.perCompany')} — ${t('founder.sim.cloud')}`, r.cloud_per_company_year], [`${t('founder.sim.perCompany')} — ${t('founder.sim.owned')}`, r.owned_per_company_year],
      [`${t('founder.sim.perRequest')} — ${t('founder.sim.cloud')}`, r.cloud_per_request], [`${t('founder.sim.perRequest')} — ${t('founder.sim.owned')}`, r.owned_per_request], [t('founder.sim.roi'), r.roi_pct],
    ].map(([k, v]) => ({ k: String(k), v: v === null ? null : Number(v) })) },
    { title: t('founder.sim.cumulative'), columns: ['year', 'companies', 'cloud', 'owned', 'cloud_cumulative', 'owned_cumulative'].map((k) => ({ key: k, label: k })), rows: r.years.map((y) => ({ ...y })) },
  ];
  return (
    <>
      <Title title={t('founder.sim.title')} subtitle={t('founder.sim.subtitle')} icon={<Calculator />} actions={<><Button size="sm" variant="outline" onClick={() => setInputs(null)}><RotateCcw /> {t('founder.sim.reset')}</Button><ExportMenu title={t('founder.sim.title')} sheets={sheets} /></>} />
      <div className="grid gap-4 xl:grid-cols-[380px_1fr]">
        <div className="grid content-start gap-4">
          {GROUPS.map((g) => (
            <Section key={g.key} title={t(`founder.sim.groups.${g.key}`)}>
              <div className="grid grid-cols-2 gap-3">{g.fields.map((f) => (
                <Field key={f} label={<span className="text-xs">{t(`founder.sim.f.${f}`)}</span>} htmlFor={`s-${f}`}><Input id={`s-${f}`} type="number" dir="ltr" step="any" min={0} value={String(values[f] ?? 0)} onChange={(e) => set(f, e.target.value)} /></Field>
              ))}</div>
            </Section>
          ))}
          <Section title={t('founder.sim.scenarios')}>
            <div className="flex gap-2"><Input placeholder={t('founder.sim.scenarioName')} value={name} onChange={(e) => setName(e.target.value)} /><Button size="sm" loading={save.isPending} onClick={() => save.mutate(undefined)}><Save /> {t('founder.sim.saveScenario')}</Button></div>
            <ul className="mt-3 grid gap-1 text-sm">{(scenarios.data ?? []).map((s) => <li key={s.id} className="flex items-center justify-between gap-2"><span>{String(s.name)}</span><Button size="sm" variant="ghost" onClick={() => setInputs(s.inputs as Record<string, number>)}>{t('founder.sim.load')}</Button></li>)}</ul>
          </Section>
        </div>
        <div className="grid content-start gap-4">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
            <Kpi label={t('founder.sim.cloudYear')} value={sar(r.cloud_cost_year, true)} />
            <Kpi label={t('founder.sim.ownedYear')} value={sar(r.owned_cost_year, true)} />
            <Kpi label={t('founder.sim.capex')} value={sar(r.capex, true)} />
            <Kpi label={t('founder.sim.breakEven')} value={r.break_even_months === null ? <span className="text-base">{t('founder.sim.breakEvenNone')}</span> : t('founder.common.months', { count: r.break_even_months })} />
            <Kpi label={t('founder.sim.breakEvenCompanies')} value={r.break_even_companies === null ? '—' : num(r.break_even_companies)} />
            <Kpi label={t('founder.sim.savings', { years: values.years ?? 3 })} value={sar(r.savings_total, true)} tone={r.savings_total > 0 ? 'good' : r.savings_total < 0 ? 'bad' : undefined} />
            <Kpi label={`${t('founder.sim.perCompany')}`} value={<span className="text-base">{sar(r.cloud_per_company_year)} ↔ {sar(r.owned_per_company_year)}</span>} hint={`${t('founder.sim.cloud')} ↔ ${t('founder.sim.owned')}`} />
            <Kpi label={`${t('founder.sim.perRequest')}`} value={<span className="text-base">{sar(r.cloud_per_request)} ↔ {sar(r.owned_per_request)}</span>} hint={`${t('founder.sim.cloud')} ↔ ${t('founder.sim.owned')}`} />
            <Kpi label={t('founder.sim.roi')} value={r.roi_pct === null ? '—' : pct(r.roi_pct)} />
          </div>
          <Section title={t('founder.sim.cumulative')}>
            <div className="h-72" dir="ltr">
              <ResponsiveContainer><LineChart data={r.years.map((y) => ({ ...y, name: t('founder.sim.year', { n: y.year }) }))}>
                <CartesianGrid stroke={c.grid} vertical={false} /><XAxis dataKey="name" {...axis} /><YAxis {...axis} width={70} tickFormatter={(v: number) => num(v / 1000) + 'k'} /><Tooltip formatter={(v) => sar(v)} /><Legend />
                <Line type="monotone" dataKey="cloud_cumulative" name={t('founder.sim.cloud')} stroke={c.series[2]} strokeWidth={2} />
                <Line type="monotone" dataKey="owned_cumulative" name={t('founder.sim.owned')} stroke={c.series[1]} strokeWidth={2} />
              </LineChart></ResponsiveContainer>
            </div>
            <p className="mt-2 text-xs text-muted-foreground">{t('founder.sim.capacityNote')}</p>
          </Section>
        </div>
      </div>
    </>
  );
}
