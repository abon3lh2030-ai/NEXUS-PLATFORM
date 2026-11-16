import { Badge, Button, Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, Field, Input, Section, Textarea, cn } from '@nexus/ui';
import { BarChart3, Download, FileText, Gavel, History, Megaphone, PieChart as PieIcon, Scale, Settings, ShieldAlert, Swords, Upload, Users } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip, Legend } from 'recharts';
import { toast } from 'sonner';
import { LoadingBlock } from '@/components/common';
import { PasswordForm } from '../gate';
import { dateTime, exportFile, fget, fsend, num, pct, sar, useCollection, useFounder, useFounderAction, type Row, type Sheet } from '../lib';
import { CollectionSection, Kpi, Title, useChartColors } from '../ui';

export function MarketingPage() {
  const { t } = useTranslation();
  const { data } = useFounder<Array<Row & { spent: number; deals: number; won: number; won_value: number }>>('/founder/marketing');
  const totals = (data ?? []).reduce((a, c) => ({ budget: a.budget + Number(c.budget ?? 0), spent: a.spent + c.spent, leads: a.leads + Number(c.leads_generated ?? 0), won: a.won + c.won, value: a.value + c.won_value }), { budget: 0, spent: 0, leads: 0, won: 0, value: 0 });
  return (
    <>
      <Title title={t('founder.pages.marketing.title')} subtitle={t('founder.pages.marketing.subtitle')} icon={<Megaphone />} />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <Kpi label={t('founder.fields.budget')} value={sar(totals.budget, true)} />
        <Kpi label={t('founder.common.spent')} value={sar(totals.spent, true)} />
        <Kpi label={t('founder.fields.leads_generated')} value={num(totals.leads)} />
        <Kpi label={t('founder.overview.customers')} value={num(totals.won)} />
        <Kpi label={t('founder.sales.won')} value={sar(totals.value, true)} hint={totals.spent ? `ROI ${pct(((totals.value - totals.spent) / totals.spent) * 100)}` : undefined} />
      </div>
      {data && data.length > 0 && (
        <Section className="mt-4" title={t('founder.common.actual')}>
          <div className="grid gap-2 md:grid-cols-2">{data.map((c) => <div key={c.id} className="rounded-lg border p-3 text-sm"><p className="font-medium">{String(c.name)}</p><p className="text-xs text-muted-foreground">{t('founder.common.spent')}: {sar(c.spent)} / {sar(c.budget ?? 0)} · {t('founder.sales.list')}: {c.deals} · {t('founder.opt.stage.won')}: {c.won}</p></div>)}</div>
        </Section>
      )}
      <div className="mt-4"><CollectionSection col="campaigns" title={t('founder.pages.marketing.title')} /></div>
    </>
  );
}

export function InvestorsPage() {
  const { t } = useTranslation();
  const { data } = useFounder<{ total_shares: number; shareholders: Array<Row & { ownership_pct: number; invested: number }>; rounds: Array<Row & { raised: number }> }>('/founder/investors');
  const c = useChartColors();
  if (!data) return <LoadingBlock />;
  const pie = data.shareholders.filter((s) => s.ownership_pct > 0).map((s) => ({ name: String(s.name), value: s.ownership_pct }));
  return (
    <>
      <Title title={t('founder.pages.investors.title')} subtitle={t('founder.pages.investors.subtitle')} icon={<PieIcon />} />
      <div className="grid gap-4 lg:grid-cols-3">
        <Section title={t('founder.pages.investors.ownership')}>
          {pie.length === 0 ? <p className="py-8 text-center text-sm text-muted-foreground">{t('founder.common.noData')}</p> : <div className="h-60" dir="ltr"><ResponsiveContainer><PieChart><Pie data={pie} dataKey="value" nameKey="name" innerRadius={45} outerRadius={80}>{pie.map((_, i) => <Cell key={i} fill={c.series[i % c.series.length]} />)}</Pie><Tooltip formatter={(v) => `${num(v, 2)}%`} /><Legend /></PieChart></ResponsiveContainer></div>}
        </Section>
        <Section className="lg:col-span-2" title={t('founder.pages.investors.shareholders')}>
          <ul className="grid gap-2 text-sm">{data.shareholders.map((s) => <li key={s.id} className="flex items-center justify-between gap-2 border-b pb-2 last:border-0"><span className="font-medium">{String(s.name)}</span><span className="text-muted-foreground">{num(s.shares)} · {num(s.ownership_pct, 2)}% · {t('founder.pages.investors.invested')}: {sar(s.invested)}</span></li>)}</ul>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">{data.rounds.map((r) => <div key={r.id} className="rounded-lg border p-3 text-sm"><p className="font-medium">{String(r.name)}</p><p className="text-xs text-muted-foreground">{sar(r.raised)} / {sar(r.target_amount)}</p></div>)}</div>
        </Section>
      </div>
      <div className="mt-4 grid gap-4">
        <CollectionSection col="shareholders" title={t('founder.pages.investors.shareholders')} />
        <CollectionSection col="rounds" title={t('founder.pages.investors.rounds')} />
        <CollectionSection col="transactions" title={t('founder.opt.tx_kind.funding')} filter={{ kind: 'funding' }} />
      </div>
    </>
  );
}

export function TeamPage() {
  const { t } = useTranslation();
  const { data } = useFounder<{ active: number; monthly_cost: number }>('/founder/team');
  return (
    <>
      <Title title={t('founder.pages.team.title')} subtitle={t('founder.pages.team.subtitle')} icon={<Users />} />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
        <Kpi label={t('founder.pages.team.active')} value={num(data?.active ?? 0)} />
        <Kpi label={t('founder.pages.team.monthly')} value={sar(data?.monthly_cost ?? 0, true)} />
        <Kpi label={t('founder.opt.recurring.yearly')} value={sar((data?.monthly_cost ?? 0) * 12, true)} />
      </div>
      <div className="mt-4 grid gap-4">
        <CollectionSection col="team" title={t('founder.pages.team.title')} />
        <CollectionSection col="transactions" title={t('founder.opt.category.salaries')} filter={{ kind: 'expense', category: 'salaries' }} />
      </div>
    </>
  );
}

export function SimpleCollectionPage({ col, page, icon }: { col: string; page: 'legal' | 'competitors' | 'decisions'; icon: 'legal' | 'competitors' | 'decisions' }) {
  const { t } = useTranslation();
  const Icon = { legal: Scale, competitors: Swords, decisions: Gavel }[icon];
  return (
    <>
      <Title title={t(`founder.pages.${page}.title`)} subtitle={t(`founder.pages.${page}.subtitle`)} icon={<Icon />} />
      <CollectionSection col={col} title={t(`founder.pages.${page}.title`)} />
    </>
  );
}

export function RisksPage() {
  const { t } = useTranslation();
  const { data } = useCollection('risks');
  const open = (data ?? []).filter((r) => r.status !== 'closed');
  const cell = (l: number, i: number) => open.filter((r) => Number(r.likelihood) === l && Number(r.impact) === i);
  return (
    <>
      <Title title={t('founder.pages.risks.title')} subtitle={t('founder.pages.risks.subtitle')} icon={<ShieldAlert />} />
      <Section title={t('founder.pages.risks.matrix')}>
        <div className="overflow-x-auto" dir="ltr">
          <div className="grid min-w-[480px] grid-cols-[auto_repeat(5,1fr)] gap-1 text-xs">
            <div />{[1, 2, 3, 4, 5].map((i) => <div key={i} className="text-center text-muted-foreground">{t('founder.fields.impact').split(' ')[0]} {i}</div>)}
            {[5, 4, 3, 2, 1].map((l) => (
              <div key={l} className="contents">
                <div className="pe-2 text-end text-muted-foreground">{l}</div>
                {[1, 2, 3, 4, 5].map((i) => {
                  const s = l * i;
                  const items = cell(l, i);
                  return <div key={i} title={items.map((r) => String(r.title)).join('\n')} className={cn('flex h-14 items-center justify-center rounded-md font-semibold', s >= 15 ? 'bg-destructive/20 text-destructive' : s >= 9 ? 'bg-warning/20 text-warning' : 'bg-muted text-muted-foreground')}>{items.length || ''}</div>;
                })}
              </div>
            ))}
          </div>
        </div>
      </Section>
      <div className="mt-4"><CollectionSection col="risks" title={t('founder.pages.risks.title')} /></div>
    </>
  );
}

/* ───────── documents (private bucket) ───────── */

export function DocumentsPage() {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState('');
  const [category, setCategory] = useState('');
  const [notes, setNotes] = useState('');
  const upload = useFounderAction(async () => {
    if (!file) throw new Error('no_file');
    if (file.size > 50 * 1024 * 1024) throw new Error(t('founder.docs.tooLarge'));
    const u = await fsend<{ document_id: string; upload_url: string }>('POST', '/founder/documents/upload', { title: title || file.name, category: category || 'other', file_name: file.name, mime_type: file.type || 'application/octet-stream', size_bytes: file.size, notes: notes || null });
    const res = await fetch(u.upload_url, { method: 'PUT', headers: { 'Content-Type': file.type || 'application/octet-stream', 'x-upsert': 'false' }, body: file });
    if (!res.ok) throw new Error('upload_failed');
    await fsend('POST', `/founder/documents/${u.document_id}/confirm`);
  }, { onSuccess: () => { setOpen(false); setFile(null); setTitle(''); setNotes(''); } });
  const download = async (id: string) => {
    try {
      const { url } = await fget<{ url: string }>(`/founder/documents/${id}/download`);
      window.location.assign(url);
    } catch {
      toast.error(t('errors.generic', { code: 'download' }));
    }
  };
  return (
    <>
      <Title title={t('founder.docs.title')} subtitle={t('founder.docs.subtitle')} icon={<FileText />} actions={<Button size="sm" onClick={() => setOpen(true)}><Upload /> {t('founder.docs.upload')}</Button>} />
      <CollectionSection col="documents" title={t('founder.docs.title')} rowExtra={(r) => (r.uploaded ? <Button size="icon-sm" variant="ghost" aria-label={t('founder.docs.download')} onClick={() => void download(r.id)}><Download /></Button> : null)} />
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent closeLabel={t('founder.common.cancel')}>
          <DialogHeader><DialogTitle>{t('founder.docs.upload')}</DialogTitle></DialogHeader>
          <div className="grid gap-3">
            <Field label={t('founder.docs.file')} htmlFor="d-file"><Input id="d-file" type="file" onChange={(e) => setFile(e.target.files?.[0] ?? null)} /></Field>
            <Field label={t('founder.fields.title')} htmlFor="d-title"><Input id="d-title" dir="auto" value={title} placeholder={file?.name} onChange={(e) => setTitle(e.target.value)} /></Field>
            <Field label={t('founder.fields.category')} htmlFor="d-cat"><Input id="d-cat" value={category} onChange={(e) => setCategory(e.target.value)} /></Field>
            <Field label={t('founder.fields.notes')} htmlFor="d-notes"><Textarea id="d-notes" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
          </div>
          <DialogFooter><Button variant="outline" onClick={() => setOpen(false)}>{t('founder.common.cancel')}</Button><Button disabled={!file} loading={upload.isPending} onClick={() => upload.mutate(undefined)}>{upload.isPending ? t('founder.docs.uploading') : t('founder.docs.upload')}</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

/* ───────── reports ───────── */

export function ReportsPage() {
  const { t } = useTranslation();
  const ov = useFounder<{ finance: Record<string, unknown>; sales: Record<string, unknown>; development: Record<string, unknown>; growth: { progress: number }; technology: { independence: number } }>('/founder/overview');
  const kv = (title: string, obj: Record<string, unknown>): Sheet => ({ title, columns: [{ key: 'k', label: t('founder.fields.name') }, { key: 'v', label: t('founder.common.actual') }], rows: Object.entries(obj).filter(([, v]) => typeof v !== 'object' || v === null).map(([k, v]) => ({ k, v: v as number | null })) });
  const build = async (kind: string): Promise<Sheet[]> => {
    if (kind === 'overview' && ov.data) return [kv(t('founder.overview.title'), { ...ov.data.finance, ...ov.data.sales, development_progress: ov.data.development.progress, growth_progress: ov.data.growth.progress, independence: ov.data.technology.independence })];
    if (kind === 'finance') {
      const f = await fget<{ cash_flow: Sheet['rows']; budgets: Array<{ name: string; planned: number; actual: number; remaining: number }> } & Record<string, unknown>>('/founder/finance');
      return [kv(t('founder.finance.title'), f), { title: t('founder.finance.cashFlow'), columns: ['month', 'funding', 'revenue', 'expenses', 'net', 'balance'].map((k) => ({ key: k, label: k })), rows: f.cash_flow }, { title: t('founder.finance.planVsActual'), columns: [{ key: 'name', label: t('founder.fields.name') }, { key: 'planned', label: t('founder.common.planned') }, { key: 'actual', label: t('founder.common.actual') }, { key: 'remaining', label: t('founder.common.remaining') }], rows: f.budgets.map((b) => ({ name: b.name, planned: b.planned, actual: b.actual, remaining: b.remaining })) }];
    }
    if (kind === 'sales') {
      const s = await fget<{ by_stage: Array<{ stage: string; count: number; value: number }> } & Record<string, unknown>>('/founder/sales');
      const deals = await fget<Row[]>('/founder/c/deals');
      return [kv(t('founder.sales.title'), s), { title: t('founder.fields.stage'), columns: [{ key: 'stage', label: t('founder.fields.stage') }, { key: 'count', label: t('founder.common.total') }, { key: 'value', label: t('founder.common.value') }], rows: s.by_stage.map((x) => ({ ...x, stage: t(`founder.opt.stage.${x.stage}`) })) }, { title: t('founder.sales.list'), columns: ['company_name', 'stage', 'value', 'plan_code', 'contact_name'].map((k) => ({ key: k, label: t(`founder.fields.${k}`) })), rows: deals.map((d) => ({ company_name: String(d.company_name), stage: t(`founder.opt.stage.${String(d.stage)}`), value: Number(d.value), plan_code: (d.plan_code as string) ?? null, contact_name: (d.contact_name as string) ?? null })) }];
    }
    if (kind === 'technology') {
      const tech = await fget<{ independence: number; phases: Array<Record<string, unknown>> }>('/founder/technology');
      return [{ title: t('founder.tech.timeline'), columns: ['ord', 'name', 'status', 'budget', 'spent', 'remaining', 'progress', 'conditions_done', 'conditions_total'].map((k) => ({ key: k, label: k })), rows: tech.phases.map((p) => ({ ord: Number(p.ord), name: String(p.name), status: t(`founder.opt.status.${String(p.status)}`), budget: Number(p.budget), spent: Number(p.spent), remaining: Number(p.remaining), progress: Number(p.progress), conditions_done: Number(p.conditions_done), conditions_total: Number(p.conditions_total) })) }];
    }
    if (kind === 'development') {
      const items = await fget<Row[]>('/founder/c/dev_items');
      return [{ title: t('founder.dev.items'), columns: ['title', 'kind', 'status', 'priority', 'due_on'].map((k) => ({ key: k, label: t(`founder.fields.${k}`) })), rows: items.map((i) => ({ title: String(i.title), kind: t(`founder.opt.dev_kind.${String(i.kind)}`), status: t(`founder.opt.status.${String(i.status)}`), priority: t(`founder.opt.priority.${String(i.priority)}`), due_on: (i.due_on as string) ?? null })) }];
    }
    const g = await fget<{ goals: Array<Record<string, unknown>> }>('/founder/strategy');
    return [{ title: t('founder.strategy.goals'), columns: ['title', 'area', 'current_value', 'target_value', 'progress', 'status'].map((k) => ({ key: k, label: k === 'progress' ? t('founder.common.progress') : t(`founder.fields.${k}`) })), rows: g.goals.map((x) => ({ title: String(x.title), area: t(`founder.opt.area.${String(x.area)}`), current_value: Number(x.current_value), target_value: Number(x.target_value), progress: Number(x.progress), status: t(`founder.opt.status.${String(x.status)}`) })) }];
  };
  const run = useFounderAction(async ({ kind, format }: { kind: string; format: 'xlsx' | 'pdf' }) => exportFile(format, t(`founder.reports.${kind}`), await build(kind)), { success: false });
  const kinds = ['overview', 'finance', 'sales', 'technology', 'development', 'growth'];
  return (
    <>
      <Title title={t('founder.reports.title')} subtitle={t('founder.reports.subtitle')} icon={<BarChart3 />} />
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {kinds.map((k) => (
          <div key={k} className="flex items-center justify-between gap-3 rounded-xl border bg-card p-4">
            <span className="font-medium">{t(`founder.reports.${k}`)}</span>
            <span className="flex gap-1"><Button size="sm" variant="outline" disabled={run.isPending} onClick={() => run.mutate({ kind: k, format: 'xlsx' })}>{t('founder.common.excel')}</Button><Button size="sm" variant="outline" disabled={run.isPending} onClick={() => run.mutate({ kind: k, format: 'pdf' })}>{t('founder.common.pdf')}</Button></span>
          </div>
        ))}
      </div>
    </>
  );
}

/* ───────── audit log ───────── */

export function AuditPage() {
  const { t } = useTranslation();
  const { data } = useFounder<Array<{ id: number; created_at: string; action: string; entity: string | null; summary: string | null; ip: string | null; before: unknown; after: unknown }>>('/founder/audit', { query: { limit: '500' } });
  const rows = (data ?? []).map((r) => ({ ...r, id: String(r.id), changes: r.after && typeof r.after === 'object' ? Object.keys(r.after as object).filter((k) => !['id', 'created_at', 'updated_at'].includes(k)).slice(0, 6).join('، ') : '' })) as unknown as Row[];
  const fields = [
    { key: 'created_at', type: 'datetime' as const, table: true }, { key: 'action', type: 'text' as const, table: true }, { key: 'entity', type: 'text' as const, table: true },
    { key: 'summary', type: 'text' as const, table: true }, { key: 'changes', type: 'text' as const, table: true }, { key: 'ip', type: 'text' as const, table: true },
  ];
  return (
    <>
      <Title title={t('founder.audit.title')} subtitle={t('founder.audit.subtitle')} icon={<History />} />
      {!data ? <LoadingBlock /> : <ReadOnlyTable rows={rows} fields={fields} title={t('founder.audit.title')} />}
    </>
  );
}

function ReadOnlyTable({ rows, fields, title }: { rows: Row[]; fields: Array<{ key: string; type: 'text' | 'datetime'; table: boolean }>; title: string }) {
  const { t } = useTranslation();
  return (
    <Section title={title} actions={<Button size="sm" variant="outline" onClick={() => void exportFile('xlsx', title, [{ title, columns: fields.map((f) => ({ key: f.key, label: f.key })), rows: rows.map((r) => Object.fromEntries(fields.map((f) => [f.key, f.type === 'datetime' ? dateTime(r[f.key]) : (r[f.key] as string) ?? null]))) }])}>{t('founder.common.excel')}</Button>}>
      <div className="-mx-4 max-h-[70vh] overflow-auto">
        <table className="w-full min-w-[720px] text-sm">
          <thead className="sticky top-0 bg-card"><tr className="border-b text-xs text-muted-foreground">{[t('founder.audit.when'), t('founder.audit.action'), t('founder.audit.entity'), t('founder.audit.summary'), '', t('founder.audit.ip')].map((h, i) => <th key={i} className="px-4 py-2 text-start font-medium">{h}</th>)}</tr></thead>
          <tbody>{rows.map((r) => (
            <tr key={r.id} className="border-b last:border-0">
              <td className="whitespace-nowrap px-4 py-2 text-xs">{dateTime(r.created_at)}</td>
              <td className="px-4 py-2"><Badge tone={String(r.action).startsWith('login') ? 'info' : r.action === 'delete' ? 'danger' : 'neutral'}>{String(r.action)}</Badge></td>
              <td className="px-4 py-2 text-xs text-muted-foreground">{String(r.entity ?? '')}</td>
              <td className="px-4 py-2" dir="auto">{String(r.summary ?? '')}</td>
              <td className="px-4 py-2 text-xs text-muted-foreground">{String(r.changes ?? '')}</td>
              <td className="px-4 py-2 font-mono text-xs" dir="ltr">{String(r.ip ?? '')}</td>
            </tr>
          ))}</tbody>
        </table>
      </div>
    </Section>
  );
}

/* ───────── settings ───────── */

export function SettingsPage() {
  const { t } = useTranslation();
  const { data } = useFounder<Record<string, unknown>>('/founder/settings');
  const session = useFounder<{ email: string; last_login_at: string | null; password_changed_at: string | null }>('/founder/session');
  const [pw, setPw] = useState(false);
  const save = useFounderAction(({ key, value }: { key: string; value: unknown }) => fsend('PUT', `/founder/settings/${key}`, { value }));
  if (!data) return <LoadingBlock />;
  const item = (key: string, label: string, type: 'date' | 'number', hint?: string, nullable = false) => {
    const v = data[key];
    return (
      <form key={`${key}-${String(v)}`} className="grid gap-1" onSubmit={(e) => { e.preventDefault(); const raw = String(new FormData(e.currentTarget).get('v') ?? ''); save.mutate({ key, value: raw === '' ? (nullable ? null : 0) : type === 'number' ? Number(raw) : raw }); }}>
        <Field label={label} hint={hint} htmlFor={`st-${key}`}>
          <div className="flex gap-2"><Input id={`st-${key}`} name="v" type={type} dir="ltr" step="any" defaultValue={v === null || v === undefined ? '' : String(v)} /><Button type="submit" size="sm" variant="outline" loading={save.isPending}>{t('founder.common.save')}</Button></div>
        </Field>
      </form>
    );
  };
  return (
    <>
      <Title title={t('founder.settings.title')} subtitle={t('founder.settings.subtitle')} icon={<Settings />} />
      <div className="grid gap-4 lg:grid-cols-2">
        <Section title={t('founder.settings.title')}>
          <div className="grid gap-4">
            {item('launch_date', t('founder.settings.launchDate'), 'date', t('founder.settings.launchHint'), true)}
            {item('opening_cash_balance', t('founder.finance.openingBalance'), 'number')}
            {item('funding_target', t('founder.settings.fundingTarget'), 'number', t('founder.settings.fundingHint'), true)}
            {item('reference_plan_price', t('founder.settings.planPrice'), 'number')}
            {item('ai_cost_cap_per_company', t('founder.settings.aiCap'), 'number')}
            {item('ai_cost_cap_pct', t('founder.settings.aiCapPct'), 'number')}
            {item('usd_to_sar', t('founder.settings.usd'), 'number')}
          </div>
        </Section>
        <Section title={t('founder.settings.security')}>
          <p className="text-sm text-muted-foreground">{t('founder.settings.securityBody')}</p>
          <div className="mt-3 grid gap-1 text-sm"><p dir="ltr" className="font-medium">{session.data?.email}</p><p className="text-xs text-muted-foreground">{t('founder.audit.when')}: {dateTime(session.data?.last_login_at)}</p></div>
          <Button className="mt-4" variant="outline" onClick={() => setPw(true)}>{t('founder.settings.password')}</Button>
        </Section>
      </div>
      <Dialog open={pw} onOpenChange={setPw}>
        <DialogContent size="sm" closeLabel={t('founder.common.cancel')}><DialogHeader><DialogTitle>{t('founder.settings.password')}</DialogTitle></DialogHeader><PasswordForm onDone={() => setPw(false)} /></DialogContent>
      </Dialog>
    </>
  );
}
