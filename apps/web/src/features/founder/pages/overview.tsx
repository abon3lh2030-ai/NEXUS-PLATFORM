import { Badge, Section, cn } from '@nexus/ui';
import { AlertTriangle, ArrowLeftRight, Gauge, Info, ShieldAlert } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { Area, AreaChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { LoadingBlock } from '@/components/common';
import { day, num, sar, useFounder, type Row } from '../lib';
import { ExportMenu, Kpi, Meter, Opt, Title, useChartColors } from '../ui';

export interface Overview {
  finance: { funding: number; funding_target: number; revenue: number; expenses: number; cash: number; profit: number; runway_months: number | null; net_burn_month: number; cash_flow: Array<{ month: string; funding: number; revenue: number; expenses: number; net: number; balance: number }> };
  sales: { leads: number; customers: number; open_deals: number; pipeline_value: number; forecast: number; conversion_rate: number | null; won_value: number };
  development: { progress: number; total: number; done: number; open_bugs: number };
  growth: { progress: number; goals: Array<Row & { title: string; progress: number; current_value: number; target_value: number }> };
  technology: { independence: number; current_phase: { id: string; name: string; progress: number } | null; next_phase: string | null };
  top_tasks: Array<{ id: string; title: string; source: string; due_on: string | null; status: string }>;
  decisions: Row[];
  alerts: Array<{ level: 'danger' | 'warning' | 'info'; key: string; params?: Record<string, unknown>; link?: string }>;
  risks: Array<Row & { score: number }>;
}

export function CashFlowChart({ data }: { data: Overview['finance']['cash_flow'] }) {
  const { t } = useTranslation();
  const c = useChartColors();
  const axis = { stroke: c.text, fontSize: 11, tickLine: false, axisLine: false } as const;
  return (
    <div className="h-64" dir="ltr">
      <ResponsiveContainer>
        <AreaChart data={data} margin={{ left: 0, right: 8, top: 8 }}>
          <CartesianGrid stroke={c.grid} vertical={false} />
          <XAxis dataKey="month" {...axis} />
          <YAxis {...axis} width={60} tickFormatter={(v: number) => num(v / 1000) + 'k'} />
          <Tooltip formatter={(v) => sar(v)} />
          <Legend />
          <Area type="monotone" dataKey="revenue" name={t('founder.overview.revenue')} stroke={c.series[1]} fill={c.series[1]} fillOpacity={0.15} />
          <Area type="monotone" dataKey="expenses" name={t('founder.overview.expenses')} stroke={c.series[2]} fill={c.series[2]} fillOpacity={0.12} />
          <Area type="monotone" dataKey="balance" name={t('founder.finance.balance')} stroke={c.series[0]} fill={c.series[0]} fillOpacity={0.08} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

export function OverviewPage() {
  const { t } = useTranslation();
  const { data } = useFounder<Overview>('/founder/overview');
  if (!data) return <LoadingBlock />;
  const f = data.finance;
  const fundingPct = f.funding_target ? (f.funding / f.funding_target) * 100 : 0;
  const sheets = () => [{
    title: t('founder.overview.title'),
    columns: [{ key: 'k', label: t('founder.fields.name') }, { key: 'v', label: t('founder.common.actual') }],
    rows: [
      [t('founder.overview.fundingTarget'), f.funding_target], [t('founder.overview.fundingActual'), f.funding], [t('founder.overview.revenue'), f.revenue], [t('founder.overview.expenses'), f.expenses],
      [t('founder.overview.cash'), f.cash], [t('founder.overview.profit'), f.profit], [t('founder.overview.runway'), f.runway_months], [t('founder.overview.leads'), data.sales.leads], [t('founder.overview.customers'), data.sales.customers],
      [t('founder.overview.openDeals'), data.sales.open_deals], [t('founder.overview.pipeline'), data.sales.pipeline_value], [t('founder.overview.devProgress'), data.development.progress], [t('founder.overview.growthProgress'), data.growth.progress], [t('founder.overview.independence'), data.technology.independence],
    ].map(([k, v]) => ({ k: String(k), v: v === null ? null : Number(v) })),
  }, { title: t('founder.overview.cashFlow'), columns: ['month', 'funding', 'revenue', 'expenses', 'net', 'balance'].map((k) => ({ key: k, label: k })), rows: f.cash_flow }];

  return (
    <>
      <Title title={t('founder.overview.title')} subtitle={t('founder.overview.subtitle')} icon={<Gauge />} actions={<ExportMenu title={t('founder.reports.overview')} sheets={sheets} />} />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Kpi label={t('founder.overview.cash')} value={sar(f.cash, true)} tone={f.cash < 0 ? 'bad' : undefined} />
        <Kpi label={t('founder.overview.revenue')} value={sar(f.revenue, true)} />
        <Kpi label={t('founder.overview.expenses')} value={sar(f.expenses, true)} />
        <Kpi label={t('founder.overview.profit')} value={sar(f.profit, true)} tone={f.profit < 0 ? 'bad' : f.profit > 0 ? 'good' : undefined} />
        <Kpi label={t('founder.overview.fundingActual')} value={sar(f.funding, true)} hint={<>{t('founder.overview.fundingTarget')}: {f.funding_target ? sar(f.funding_target, true) : t('founder.common.notSet')}</>} />
        <Kpi label={t('founder.overview.runway')} value={f.runway_months === null ? t('founder.overview.noBurn') : t('founder.common.months', { count: f.runway_months })} hint={<>{t('founder.overview.burn')}: {sar(f.net_burn_month, true)}</>} tone={f.runway_months !== null && f.runway_months < 6 ? 'warn' : undefined} />
        <Kpi label={t('founder.overview.customers')} value={num(data.sales.customers)} hint={<>{t('founder.overview.leads')}: {num(data.sales.leads)}</>} />
        <Kpi label={t('founder.overview.openDeals')} value={num(data.sales.open_deals)} hint={<>{t('founder.overview.pipeline')}: {sar(data.sales.pipeline_value, true)}</>} />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <Section title={t('founder.overview.cashFlow')} className="lg:col-span-2">
          {f.cash_flow.every((m) => !m.revenue && !m.expenses && !m.funding) ? <p className="py-10 text-center text-sm text-muted-foreground">{t('founder.common.noData')}</p> : <CashFlowChart data={f.cash_flow} />}
        </Section>
        <Section title={t('founder.common.progress')}>
          <div className="grid gap-4">
            <Meter label={t('founder.overview.fundingTarget')} value={fundingPct} />
            <Meter label={t('founder.overview.devProgress')} value={data.development.progress} />
            <Meter label={t('founder.overview.growthProgress')} value={data.growth.progress} />
            <Meter label={t('founder.overview.independence')} value={data.technology.independence} />
            <Link to="/founder/technology" className="rounded-lg border p-3 text-sm hover:bg-muted">
              <p className="text-xs text-muted-foreground">{t('founder.overview.currentPhase')}</p>
              <p className="font-medium">{data.technology.current_phase?.name ?? '—'}</p>
              {data.technology.next_phase && <p className="mt-1 flex items-center gap-1 text-xs text-muted-foreground"><ArrowLeftRight className="size-3" /> {t('founder.overview.nextPhase')}: {data.technology.next_phase}</p>}
            </Link>
          </div>
        </Section>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <Section title={t('founder.overview.alerts')}>
          {data.alerts.length === 0 ? <p className="text-sm text-muted-foreground">{t('founder.overview.noAlerts')}</p> : (
            <ul className="grid gap-2">{data.alerts.map((a, i) => {
              const Icon = a.level === 'info' ? Info : AlertTriangle;
              const body = <><Icon className="mt-0.5 size-4 shrink-0" /><span>{t(`founder.alerts.${a.key}`, { ...a.params, over: a.params?.over !== undefined ? sar(a.params.over) : undefined, cash: a.params?.cash !== undefined ? sar(a.params.cash) : undefined })}</span></>;
              const cls = cn('flex gap-2 rounded-lg px-3 py-2 text-sm', a.level === 'danger' ? 'bg-destructive/10 text-destructive' : a.level === 'warning' ? 'bg-warning/10 text-warning' : 'bg-muted text-muted-foreground');
              return <li key={i}>{a.link ? <Link to={a.link} className={cls}>{body}</Link> : <div className={cls}>{body}</div>}</li>;
            })}</ul>
          )}
        </Section>
        <Section title={t('founder.overview.tasks')}>
          {data.top_tasks.length === 0 ? <p className="text-sm text-muted-foreground">{t('founder.common.empty')}</p> : (
            <ul className="grid gap-2">{data.top_tasks.map((x) => (
              <li key={x.id}><Link to={x.source === 'technology' ? '/founder/technology/progress' : '/founder/development'} className="flex items-start justify-between gap-2 rounded-lg border p-2.5 text-sm hover:bg-muted">
                <span className="line-clamp-2">{x.title}</span><span className="shrink-0 text-end text-xs text-muted-foreground"><Opt group="status" value={x.status} />{x.due_on && <span className="mt-1 block">{day(x.due_on)}</span>}</span>
              </Link></li>
            ))}</ul>
          )}
        </Section>
        <div className="grid gap-4">
          <Section title={t('founder.overview.decisions')}>
            {data.decisions.length === 0 ? <p className="text-sm text-muted-foreground">{t('founder.common.empty')}</p> : <ul className="grid gap-1.5 text-sm">{data.decisions.map((d) => <li key={d.id}><Link to="/founder/decisions" className="hover:text-primary">• {String(d.title)}</Link></li>)}</ul>}
          </Section>
          <Section title={t('founder.overview.risks')}>
            <ul className="grid gap-1.5 text-sm">{data.risks.map((r) => (
              <li key={r.id} className="flex items-center justify-between gap-2"><Link to="/founder/risks" className="line-clamp-1 hover:text-primary"><ShieldAlert className="me-1 inline size-3.5 text-muted-foreground" />{String(r.title)}</Link><Badge tone={r.score >= 15 ? 'danger' : r.score >= 9 ? 'warning' : 'neutral'}>{r.score}</Badge></li>
            ))}</ul>
          </Section>
        </div>
      </div>
    </>
  );
}
