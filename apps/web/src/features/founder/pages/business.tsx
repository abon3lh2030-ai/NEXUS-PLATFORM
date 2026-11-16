import { Badge, Button, Section, Tabs, TabsContent, TabsList, TabsTrigger, cn } from '@nexus/ui';
import { Briefcase, Code2, Plus, Target, TrendingUp, Wallet } from 'lucide-react';
import { useState, type DragEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Bar, BarChart, CartesianGrid, Cell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { LoadingBlock } from '@/components/common';
import { day, fsend, num, pct, sar, useCollection, useFounder, useFounderAction, type Row } from '../lib';
import { CollectionSection, ExportMenu, Kpi, Meter, Opt, RecordDialog, Title, useChartColors } from '../ui';
import { CashFlowChart, type Overview } from './overview';

/* ───────── Finance ───────── */

interface Finance { opening: number; funding: number; funding_target: number; revenue: number; expenses: number; cash: number; profit: number; net_burn_month: number; runway_months: number | null; monthly_commitments: number; cash_flow: Overview['finance']['cash_flow']; categories: Array<{ category: string; expenses: number; revenue: number; funding: number }>; budgets: Array<{ id: string; name: string; category: string; group_label: string | null; phase_id: string | null; recurring: string; planned: number; actual: number; remaining: number; over: boolean }>; budget_totals: { planned: number; actual: number; general_planned: number; general_actual: number; unbudgeted_expenses: number } }

export function FinancePage() {
  const { t } = useTranslation();
  const { data } = useFounder<Finance>('/founder/finance');
  const phases = useCollection('phases');
  const c = useChartColors();
  if (!data) return <LoadingBlock />;
  const phaseName = (id: string | null): string => (id ? String(phases.data?.find((p) => p.id === id)?.name ?? '').split('—')[0] ?? '' : t('founder.finance.general'));
  const byCat = data.categories.filter((x) => x.expenses > 0).map((x) => ({ name: t(`founder.opt.category.${x.category}`, x.category), value: x.expenses }));
  const used = data.budgets.filter((b) => b.actual > 0 || !b.phase_id);
  const sheets = () => [
    { title: t('founder.finance.planVsActual'), columns: [{ key: 'name', label: t('founder.fields.name') }, { key: 'phase', label: t('founder.fields.phase_id') }, { key: 'planned', label: t('founder.common.planned') }, { key: 'actual', label: t('founder.common.actual') }, { key: 'remaining', label: t('founder.common.remaining') }], rows: data.budgets.map((b) => ({ name: b.name, phase: phaseName(b.phase_id), planned: b.planned, actual: b.actual, remaining: b.remaining })) },
    { title: t('founder.finance.cashFlow'), columns: ['month', 'funding', 'revenue', 'expenses', 'net', 'balance'].map((k) => ({ key: k, label: k })), rows: data.cash_flow },
    { title: t('founder.finance.byCategory'), columns: [{ key: 'category', label: t('founder.fields.category') }, { key: 'funding', label: t('founder.opt.tx_kind.funding') }, { key: 'revenue', label: t('founder.opt.tx_kind.revenue') }, { key: 'expenses', label: t('founder.opt.tx_kind.expense') }], rows: data.categories.map((x) => ({ ...x, category: t(`founder.opt.category.${x.category}`, x.category) })) },
  ];
  return (
    <>
      <Title title={t('founder.finance.title')} subtitle={t('founder.finance.subtitle')} icon={<Wallet />} actions={<ExportMenu title={t('founder.reports.finance')} sheets={sheets} />} />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Kpi label={t('founder.overview.cash')} value={sar(data.cash, true)} hint={`${t('founder.finance.openingBalance')}: ${sar(data.opening, true)}`} tone={data.cash < 0 ? 'bad' : undefined} />
        <Kpi label={t('founder.overview.fundingActual')} value={sar(data.funding, true)} hint={`${t('founder.overview.fundingTarget')}: ${data.funding_target ? sar(data.funding_target, true) : '—'}`} />
        <Kpi label={t('founder.overview.revenue')} value={sar(data.revenue, true)} />
        <Kpi label={t('founder.overview.expenses')} value={sar(data.expenses, true)} />
        <Kpi label={t('founder.overview.profit')} value={sar(data.profit, true)} tone={data.profit < 0 ? 'bad' : data.profit > 0 ? 'good' : undefined} />
        <Kpi label={t('founder.overview.runway')} value={data.runway_months === null ? t('founder.overview.noBurn') : t('founder.common.months', { count: data.runway_months })} hint={`${t('founder.overview.burn')}: ${sar(data.net_burn_month, true)}`} />
        <Kpi label={t('founder.finance.monthlyCommitments')} value={sar(data.monthly_commitments, true)} />
        <Kpi label={t('founder.finance.unbudgeted')} value={sar(data.budget_totals.unbudgeted_expenses, true)} />
      </div>
      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <Section className="lg:col-span-2" title={t('founder.finance.cashFlow')}>{data.cash_flow.every((m) => !m.revenue && !m.expenses && !m.funding) ? <p className="py-10 text-center text-sm text-muted-foreground">{t('founder.common.noData')}</p> : <CashFlowChart data={data.cash_flow} />}</Section>
        <Section title={t('founder.finance.byCategory')}>
          {byCat.length === 0 ? <p className="py-10 text-center text-sm text-muted-foreground">{t('founder.common.noData')}</p> : <div className="h-64" dir="ltr"><ResponsiveContainer><PieChart><Pie data={byCat} dataKey="value" nameKey="name" innerRadius={50} outerRadius={85} paddingAngle={2}>{byCat.map((_, i) => <Cell key={i} fill={c.series[i % c.series.length]} />)}</Pie><Tooltip formatter={(v) => sar(v)} /><Legend /></PieChart></ResponsiveContainer></div>}
        </Section>
      </div>
      <Section className="mt-4" title={`${t('founder.finance.planVsActual')} — ${sar(data.budget_totals.actual, true)} / ${sar(data.budget_totals.planned, true)}`}>
        <div className="grid gap-3 md:grid-cols-2">
          {used.length === 0 && <p className="text-sm text-muted-foreground">{t('founder.common.noData')}</p>}
          {used.map((b) => (
            <div key={b.id} className="rounded-lg border p-3">
              <div className="mb-1 flex items-start justify-between gap-2 text-sm"><span className="font-medium">{b.name}</span>{b.over && <Badge tone="danger">{t('founder.finance.over')}</Badge>}</div>
              <p className="mb-2 text-xs text-muted-foreground">{phaseName(b.phase_id)} · {sar(b.actual)} / {sar(b.planned)}</p>
              <Meter value={b.planned ? (b.actual / b.planned) * 100 : b.actual ? 100 : 0} />
            </div>
          ))}
        </div>
        <div className="mt-4 h-60" dir="ltr">
          <ResponsiveContainer><BarChart data={(phases.data ?? []).map((p) => ({ name: String(p.ord), planned: data.budgets.filter((b) => b.phase_id === p.id).reduce((a, b) => a + b.planned, 0), actual: data.budgets.filter((b) => b.phase_id === p.id).reduce((a, b) => a + b.actual, 0) })).concat([{ name: t('founder.finance.general'), planned: data.budget_totals.general_planned, actual: data.budget_totals.general_actual }])}>
            <CartesianGrid stroke={c.grid} vertical={false} /><XAxis dataKey="name" stroke={c.text} fontSize={11} tickLine={false} axisLine={false} /><YAxis stroke={c.text} fontSize={11} tickLine={false} axisLine={false} width={60} tickFormatter={(v: number) => num(v / 1000) + 'k'} /><Tooltip formatter={(v) => sar(v)} /><Legend />
            <Bar dataKey="planned" name={t('founder.common.planned')} fill={c.series[0]} radius={[4, 4, 0, 0]} /><Bar dataKey="actual" name={t('founder.common.actual')} fill={c.series[2]} radius={[4, 4, 0, 0]} />
          </BarChart></ResponsiveContainer>
        </div>
      </Section>
      <Tabs defaultValue="tx" className="mt-4">
        <TabsList><TabsTrigger value="tx">{t('founder.finance.transactions')}</TabsTrigger><TabsTrigger value="budgets">{t('founder.finance.budgets')}</TabsTrigger><TabsTrigger value="commitments">{t('founder.finance.commitments')}</TabsTrigger></TabsList>
        <TabsContent value="tx" className="mt-3"><CollectionSection col="transactions" title={t('founder.finance.transactions')} /></TabsContent>
        <TabsContent value="budgets" className="mt-3"><CollectionSection col="budgets" title={t('founder.finance.budgets')} /></TabsContent>
        <TabsContent value="commitments" className="mt-3"><CollectionSection col="commitments" title={t('founder.finance.commitments')} /></TabsContent>
      </Tabs>
    </>
  );
}

/* ───────── Sales & CRM ───────── */

const STAGES = ['lead', 'contacted', 'meeting', 'proposal', 'negotiation', 'won', 'lost'];
interface Sales { by_stage: Array<{ stage: string; count: number; value: number }>; leads: number; customers: number; lost: number; open_deals: number; pipeline_value: number; won_value: number; forecast: number; conversion_rate: number | null; overdue_followups: number }

export function SalesPage() {
  const { t } = useTranslation();
  const { data } = useFounder<Sales>('/founder/sales');
  const deals = useCollection('deals');
  const [editing, setEditing] = useState<Row | null | 'new'>(null);
  const [over, setOver] = useState<string | null>(null);
  const move = useFounderAction(({ id, stage }: { id: string; stage: string }) => fsend('PATCH', `/founder/c/deals/${id}`, { stage }));
  const c = useChartColors();
  if (!data) return <LoadingBlock />;
  const drop = (e: DragEvent, stage: string) => {
    e.preventDefault();
    setOver(null);
    const id = e.dataTransfer.getData('text/plain');
    const deal = deals.data?.find((d) => d.id === id);
    if (deal && deal.stage !== stage) move.mutate({ id, stage });
  };
  const sheets = () => [{ title: t('founder.sales.title'), columns: [{ key: 'stage', label: t('founder.fields.stage') }, { key: 'count', label: t('founder.common.total') }, { key: 'value', label: t('founder.common.value') }], rows: data.by_stage.map((s) => ({ ...s, stage: t(`founder.opt.stage.${s.stage}`) })) }];
  return (
    <>
      <Title title={t('founder.sales.title')} subtitle={t('founder.sales.subtitle')} icon={<Briefcase />} actions={<><ExportMenu title={t('founder.reports.sales')} sheets={sheets} /><Button size="sm" onClick={() => setEditing('new')}><Plus /> {t('founder.common.add')}</Button></>} />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <Kpi label={t('founder.overview.leads')} value={num(data.leads)} />
        <Kpi label={t('founder.overview.customers')} value={num(data.customers)} />
        <Kpi label={t('founder.overview.pipeline')} value={sar(data.pipeline_value, true)} />
        <Kpi label={t('founder.sales.forecast')} value={sar(data.forecast, true)} />
        <Kpi label={t('founder.sales.won')} value={sar(data.won_value, true)} />
        <Kpi label={t('founder.sales.conversion')} value={data.conversion_rate === null ? '—' : pct(data.conversion_rate)} />
      </div>
      <Section className="mt-4" title={t('founder.sales.kanban')} actions={<span className="text-xs text-muted-foreground">{t('founder.sales.dragHint')}</span>}>
        <p className="mb-3 text-xs text-muted-foreground">{t('founder.sales.wonHint')}</p>
        <div className="-mx-4 overflow-x-auto px-4 pb-2">
          <div className="grid min-w-[1100px] grid-cols-7 gap-3">
            {STAGES.map((s) => {
              const rows = (deals.data ?? []).filter((d) => d.stage === s);
              const st = data.by_stage.find((x) => x.stage === s);
              return (
                <div key={s} onDragOver={(e) => { e.preventDefault(); setOver(s); }} onDragLeave={() => setOver(null)} onDrop={(e) => drop(e, s)} className={cn('flex min-h-48 flex-col gap-2 rounded-xl bg-muted/50 p-2', over === s && 'ring-2 ring-primary')}>
                  <div className="flex items-center justify-between px-1 text-xs font-semibold"><Opt group="stage" value={s} /><span className="text-muted-foreground">{st?.count ?? 0}</span></div>
                  <p className="px-1 text-[11px] text-muted-foreground">{sar(st?.value ?? 0, true)}</p>
                  {rows.map((d) => (
                    <button key={d.id} type="button" draggable onDragStart={(e) => e.dataTransfer.setData('text/plain', d.id)} onClick={() => setEditing(d)} className="cursor-grab rounded-lg border bg-card p-2.5 text-start text-sm shadow-xs hover:shadow-md active:cursor-grabbing">
                      <p className="font-medium">{String(d.company_name)}</p>
                      <p className="text-xs text-muted-foreground">{sar(d.value, true)}{d.plan_code ? ` · ${String(d.plan_code)}` : ''}</p>
                      {d.next_followup_on ? <p className={cn('mt-1 text-[11px]', String(d.next_followup_on) < new Date().toISOString().slice(0, 10) ? 'text-destructive' : 'text-muted-foreground')}>↻ {day(d.next_followup_on)}</p> : null}
                    </button>
                  ))}
                </div>
              );
            })}
          </div>
        </div>
      </Section>
      <Section className="mt-4" title={t('founder.fields.stage')}>
        <div className="h-56" dir="ltr"><ResponsiveContainer><BarChart data={data.by_stage.map((s) => ({ name: t(`founder.opt.stage.${s.stage}`), count: s.count }))}><CartesianGrid stroke={c.grid} vertical={false} /><XAxis dataKey="name" stroke={c.text} fontSize={11} tickLine={false} axisLine={false} /><YAxis allowDecimals={false} stroke={c.text} fontSize={11} tickLine={false} axisLine={false} width={30} /><Tooltip /><Bar dataKey="count" fill={c.series[0]} radius={[4, 4, 0, 0]} /></BarChart></ResponsiveContainer></div>
      </Section>
      <Tabs defaultValue="list" className="mt-4">
        <TabsList><TabsTrigger value="list">{t('founder.sales.list')}</TabsTrigger><TabsTrigger value="activities">{t('founder.sales.activities')}</TabsTrigger></TabsList>
        <TabsContent value="list" className="mt-3"><CollectionSection col="deals" title={t('founder.sales.list')} /></TabsContent>
        <TabsContent value="activities" className="mt-3"><CollectionSection col="deal_activities" title={t('founder.sales.activities')} /></TabsContent>
      </Tabs>
      <RecordDialog col="deals" row={editing === 'new' ? null : editing} open={editing !== null} onClose={() => setEditing(null)} />
    </>
  );
}

/* ───────── Development ───────── */

interface Dev { progress: number; total: number; done: number; open_bugs: number; overdue: number; estimated_cost: number; actual_cost: number; releases: Array<Row & { version: string; title: string | null; status: string; target_on: string | null; items: number; done: number; progress: number }> }
const DEV_COLS = ['backlog', 'todo', 'in_progress', 'review', 'done'];

export function DevelopmentPage() {
  const { t } = useTranslation();
  const { data } = useFounder<Dev>('/founder/development');
  const items = useCollection('dev_items');
  const [editing, setEditing] = useState<Row | null | 'new'>(null);
  const move = useFounderAction(({ id, status }: { id: string; status: string }) => fsend('PATCH', `/founder/c/dev_items/${id}`, { status }), { success: false });
  if (!data) return <LoadingBlock />;
  const quarters = [...new Set((items.data ?? []).map((i) => String(i.roadmap_quarter ?? '')))].sort();
  return (
    <>
      <Title title={t('founder.dev.title')} subtitle={t('founder.dev.subtitle')} icon={<Code2 />} actions={<Button size="sm" onClick={() => setEditing('new')}><Plus /> {t('founder.common.add')}</Button>} />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <Kpi label={t('founder.overview.devProgress')} value={pct(data.progress)} hint={`${data.done} / ${data.total}`} />
        <Kpi label={t('founder.dev.bugs')} value={num(data.open_bugs)} tone={data.open_bugs ? 'warn' : undefined} />
        <Kpi label={t('founder.tech.tasksOverdue')} value={num(data.overdue)} tone={data.overdue ? 'warn' : undefined} />
        <Kpi label={`${t('founder.dev.costs')} — ${t('founder.dev.estimated')}`} value={sar(data.estimated_cost, true)} />
        <Kpi label={t('founder.dev.actualCost')} value={sar(data.actual_cost, true)} />
      </div>
      <Tabs defaultValue="board" className="mt-4">
        <TabsList><TabsTrigger value="board">{t('founder.dev.board')}</TabsTrigger><TabsTrigger value="roadmap">{t('founder.dev.roadmap')}</TabsTrigger><TabsTrigger value="releases">{t('founder.dev.releases')}</TabsTrigger><TabsTrigger value="items">{t('founder.dev.items')}</TabsTrigger></TabsList>
        <TabsContent value="board" className="mt-3">
          <div className="-mx-4 overflow-x-auto px-4"><div className="grid min-w-[900px] grid-cols-5 gap-3">
            {DEV_COLS.map((s) => (
              <div key={s} onDragOver={(e) => e.preventDefault()} onDrop={(e) => { const id = e.dataTransfer.getData('text/plain'); if (id) move.mutate({ id, status: s }); }} className="flex min-h-48 flex-col gap-2 rounded-xl bg-muted/50 p-2">
                <div className="flex items-center justify-between px-1"><Opt group="status" value={s} /><span className="text-xs text-muted-foreground">{(items.data ?? []).filter((i) => i.status === s).length}</span></div>
                {(items.data ?? []).filter((i) => i.status === s).map((i) => (
                  <button key={i.id} type="button" draggable onDragStart={(e) => e.dataTransfer.setData('text/plain', i.id)} onClick={() => setEditing(i)} className="cursor-grab rounded-lg border bg-card p-2.5 text-start text-sm shadow-xs hover:shadow-md">
                    <div className="mb-1 flex gap-1"><Opt group="dev_kind" value={i.kind} /><Opt group="priority" value={i.priority} /></div>
                    <p className="font-medium">{String(i.title)}</p>
                    {i.due_on ? <p className="mt-1 text-[11px] text-muted-foreground">{day(i.due_on)}</p> : null}
                  </button>
                ))}
              </div>
            ))}
          </div></div>
        </TabsContent>
        <TabsContent value="roadmap" className="mt-3">
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            {(quarters.length ? quarters : ['']).map((q) => {
              const rows = (items.data ?? []).filter((i) => String(i.roadmap_quarter ?? '') === q && i.kind !== 'bug');
              return (
                <Section key={q || 'none'} title={q || t('founder.dev.noQuarter')}>
                  {rows.length === 0 ? <p className="text-sm text-muted-foreground">{t('founder.common.empty')}</p> : <ul className="grid gap-2 text-sm">{rows.map((i) => <li key={i.id}><button type="button" className="w-full text-start" onClick={() => setEditing(i)}><span className="flex items-center justify-between gap-2"><span>{String(i.title)}</span><Opt group="status" value={i.status} /></span><Meter className="mt-1" value={i.status === 'done' ? 100 : Number(i.progress)} /></button></li>)}</ul>}
                </Section>
              );
            })}
          </div>
        </TabsContent>
        <TabsContent value="releases" className="mt-3 grid gap-4">
          <div className="grid gap-3 md:grid-cols-3">{data.releases.map((r) => <div key={r.id} className="rounded-xl border bg-card p-4"><div className="flex items-center justify-between"><span className="font-semibold" dir="ltr">{r.version}</span><Opt group="status" value={r.status} /></div><p className="text-sm text-muted-foreground">{r.title}</p><p className="mt-1 text-xs text-muted-foreground">{day(r.target_on)} · {r.done}/{r.items}</p><Meter className="mt-2" value={r.progress} /></div>)}</div>
          <CollectionSection col="releases" title={t('founder.dev.releases')} />
        </TabsContent>
        <TabsContent value="items" className="mt-3"><CollectionSection col="dev_items" title={t('founder.dev.items')} /></TabsContent>
      </Tabs>
      <RecordDialog col="dev_items" row={editing === 'new' ? null : editing} open={editing !== null} onClose={() => setEditing(null)} />
    </>
  );
}

/* ───────── Strategy & Growth ───────── */

type Goal = Row & { title: string; plan_id: string | null; area: string; progress: number; current_value: number; target_value: number; computed: boolean; overdue: boolean; unit: string | null; status: string; period: string; period_start: string | null; period_end: string | null; metric: string };
interface Strategy { plans: Row[]; goals: Goal[]; projects: Row[] }

function GoalCard({ g, onEdit }: { g: Goal; onEdit: () => void }) {
  const { t } = useTranslation();
  const money = g.metric === 'revenue' || g.metric === 'funding' || g.area === 'revenue';
  return (
    <button type="button" onClick={onEdit} className="rounded-xl border bg-card p-4 text-start shadow-xs hover:shadow-md">
      <div className="mb-2 flex flex-wrap items-center gap-1"><Opt group="area" value={g.area} /><Opt group="period" value={g.period} /><Opt group="status" value={g.status} />{g.overdue && <Badge tone="danger">!</Badge>}</div>
      <p className="font-medium">{g.title}</p>
      <p className="mt-1 text-sm tabular-nums">{money ? sar(g.current_value, true) : num(g.current_value, 1)} / {money ? sar(g.target_value, true) : num(g.target_value, 1)} {!money && g.unit ? g.unit : ''}</p>
      <Meter className="mt-2" value={g.progress} />
      <p className="mt-2 text-xs text-muted-foreground">{g.computed ? t('founder.common.computed') : t('founder.common.manual')}{g.period_start || g.period_end ? ` · ${day(g.period_start)} → ${day(g.period_end)}` : ` · ${t('founder.common.notSet')}`}</p>
    </button>
  );
}

function GoalsGrid({ goals, planId }: { goals: Goal[]; planId?: string }) {
  const { t } = useTranslation();
  const [editing, setEditing] = useState<Row | null | 'new'>(null);
  return (
    <>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {goals.map((g) => <GoalCard key={g.id} g={g} onEdit={() => setEditing(g)} />)}
        <button type="button" onClick={() => setEditing('new')} className="flex min-h-32 items-center justify-center gap-2 rounded-xl border border-dashed text-sm text-muted-foreground hover:bg-muted"><Plus className="size-4" /> {t('founder.common.add')}</button>
      </div>
      <RecordDialog col="goals" row={editing === 'new' ? null : editing} open={editing !== null} onClose={() => setEditing(null)} defaults={planId ? { plan_id: planId } : {}} />
    </>
  );
}

export function GrowthPage() {
  const { t } = useTranslation();
  const { data } = useFounder<Strategy>('/founder/strategy');
  if (!data) return <LoadingBlock />;
  const growthPlans = data.plans.filter((p) => p.kind === 'growth');
  const ids = new Set(growthPlans.map((p) => p.id));
  const goals = data.goals.filter((g) => (g.plan_id && ids.has(g.plan_id)) || ['companies', 'revenue', 'customers', 'marketing', 'partnerships', 'hiring', 'markets', 'operations'].includes(g.area));
  const sheets = () => [{ title: t('founder.growth.title'), columns: ['title', 'area', 'period', 'current_value', 'target_value', 'progress', 'status'].map((k) => ({ key: k, label: k === 'progress' ? t('founder.common.progress') : t(`founder.fields.${k}`) })), rows: goals.map((g) => ({ title: g.title, area: t(`founder.opt.area.${g.area}`), period: t(`founder.opt.period.${g.period}`), current_value: g.current_value, target_value: g.target_value, progress: g.progress, status: t(`founder.opt.status.${g.status}`) })) }];
  return (
    <>
      <Title title={t('founder.growth.title')} subtitle={t('founder.growth.subtitle')} icon={<TrendingUp />} actions={<ExportMenu title={t('founder.reports.growth')} sheets={sheets} />} />
      <GoalsGrid goals={goals} planId={growthPlans[0]?.id} />
    </>
  );
}

export function StrategyPage() {
  const { t } = useTranslation();
  const { data } = useFounder<Strategy>('/founder/strategy');
  const [editing, setEditing] = useState<Row | null | 'new'>(null);
  if (!data) return <LoadingBlock />;
  const unplanned = data.goals.filter((g) => !g.plan_id);
  return (
    <>
      <Title title={t('founder.strategy.title')} subtitle={t('founder.strategy.subtitle')} icon={<Target />} actions={<Button size="sm" onClick={() => setEditing('new')}><Plus /> {t('founder.strategy.newPlan')}</Button>} />
      <div className="grid gap-4">
        {data.plans.map((p) => {
          const goals = data.goals.filter((g) => g.plan_id === p.id);
          const avg = goals.length ? goals.reduce((a, g) => a + g.progress, 0) / goals.length : 0;
          return (
            <Section key={p.id} title={<span className="flex flex-wrap items-center gap-2">{String(p.name)} <Opt group="plan_kind" value={p.kind} /> <Opt group="status" value={p.status} /></span>} actions={<Button size="sm" variant="outline" onClick={() => setEditing(p)}>{t('founder.common.edit')}</Button>}>
              {p.description ? <p className="mb-3 text-sm text-muted-foreground">{String(p.description)}</p> : null}
              <Meter className="mb-4" label={t('founder.common.progress')} value={avg} />
              <GoalsGrid goals={goals} planId={p.id} />
            </Section>
          );
        })}
        {unplanned.length > 0 && <Section title={t('founder.strategy.goals')}><GoalsGrid goals={unplanned} /></Section>}
        <CollectionSection col="projects" title={t('founder.strategy.projects')} />
        <CollectionSection col="plans" title={t('founder.strategy.plans')} />
      </div>
      <RecordDialog col="plans" row={editing === 'new' ? null : editing} open={editing !== null} onClose={() => setEditing(null)} />
    </>
  );
}
