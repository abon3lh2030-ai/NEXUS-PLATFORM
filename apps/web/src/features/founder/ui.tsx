import { Badge, Button, Checkbox, ConfirmDialog, Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, EmptyState, Field as FormField, Input, NativeSelect, PageHeader, Progress, Section, Textarea, cn } from '@nexus/ui';
import { ArrowDownUp, Download, FileSpreadsheet, FileText, Inbox, Pencil, Plus, Search, Trash2 } from 'lucide-react';
import { useMemo, useState, type ReactNode } from 'react';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';
import { useTheme } from '@/providers/theme';
import { FIELDS, type Field } from './fields';
import { dateTime, day, deleteRow, exportFile, num, pct, sar, saveRow, todayIso, useCollection, useFounderAction, type Row, type Sheet } from './lib';

export function useChartColors() {
  const { resolved } = useTheme();
  return resolved === 'dark'
    ? { grid: '#2d3150', text: '#9aa0bd', series: ['#8b7cf6', '#34d399', '#f87171', '#38bdf8', '#fbbf24', '#a3a3a3'] }
    : { grid: '#e6e8f0', text: '#6b7194', series: ['#5b4df0', '#10b981', '#ef4444', '#0ea5e9', '#f59e0b', '#94a3b8'] };
}

export function Title({ title, subtitle, icon, actions }: { title: string; subtitle?: string; icon?: ReactNode; actions?: ReactNode }) {
  return <PageHeader title={title} description={subtitle} icon={icon} actions={actions} />;
}

export function Kpi({ label, value, hint, tone, icon }: { label: ReactNode; value: ReactNode; hint?: ReactNode; tone?: 'good' | 'bad' | 'warn'; icon?: ReactNode }) {
  return (
    <div className="rounded-xl border bg-card p-4 shadow-xs">
      <div className="flex items-center justify-between gap-2 text-muted-foreground"><span className="text-xs font-medium">{label}</span>{icon && <span className="[&_svg]:size-4">{icon}</span>}</div>
      <div className={cn('mt-2 text-xl font-semibold tabular-nums tracking-tight sm:text-2xl', tone === 'good' && 'text-success', tone === 'bad' && 'text-destructive', tone === 'warn' && 'text-warning')} dir="auto">{value}</div>
      {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

export function Meter({ value, label, className }: { value: number; label?: ReactNode; className?: string }) {
  const v = Math.max(0, Math.min(100, value || 0));
  return (
    <div className={cn('grid gap-1', className)}>
      {label !== undefined && <div className="flex justify-between text-xs text-muted-foreground"><span>{label}</span><span className="tabular-nums">{num(v, 1)}%</span></div>}
      <Progress value={v} indicatorClassName={v >= 100 ? 'bg-success' : undefined} />
    </div>
  );
}

const TONE: Record<string, 'neutral' | 'primary' | 'success' | 'warning' | 'danger' | 'info'> = {
  done: 'success', achieved: 'success', completed: 'success', released: 'success', won: 'success', active: 'primary', current: 'primary', in_progress: 'primary', in_use: 'success', decided: 'success',
  on_track: 'success', testing: 'info', review: 'info', open: 'warning', mitigating: 'info', proposed: 'warning', at_risk: 'warning', blocked: 'danger', off_track: 'danger', lost: 'danger', expired: 'danger',
  urgent: 'danger', high: 'warning', critical: 'danger', medium: 'info', owned: 'success', external: 'warning', retired: 'neutral', negotiation: 'primary', proposal: 'info', meeting: 'info',
};

export function Opt({ group, value }: { group: string; value: unknown }) {
  const { t } = useTranslation();
  if (value === null || value === undefined || value === '') return <span className="text-muted-foreground">—</span>;
  const v = String(value);
  return <Badge tone={TONE[v] ?? 'neutral'}>{t(`founder.opt.${group}.${v}`, v)}</Badge>;
}

/** Labels for reference columns (id → name). */
export function useRefLabels(fields: Field[]) {
  const cols = [...new Set(fields.filter((f) => f.type === 'ref' && f.ref).map((f) => f.ref!.col))];
  const q0 = useCollection(cols[0] ?? '__none', {});
  const q1 = useCollection(cols[1] ?? '__none', {});
  const q2 = useCollection(cols[2] ?? '__none', {});
  const q3 = useCollection(cols[3] ?? '__none', {});
  const q4 = useCollection(cols[4] ?? '__none', {});
  const q5 = useCollection(cols[5] ?? '__none', {});
  const q6 = useCollection(cols[6] ?? '__none', {});
  const q7 = useCollection(cols[7] ?? '__none', {});
  const q8 = useCollection(cols[8] ?? '__none', {});
  const results = [q0, q1, q2, q3, q4, q5, q6, q7, q8];
  return useMemo(() => {
    const map: Record<string, { label: string; rows: Row[] }> = {};
    cols.forEach((c, i) => {
      const field = fields.find((f) => f.ref?.col === c)!;
      map[c] = { label: field.ref!.label, rows: results[i]?.data ?? [] };
    });
    return map;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cols.join(','), ...results.map((r) => r.data)]);
}
type RefLabels = ReturnType<typeof useRefLabels>;

function refLabel(refs: RefLabels, f: Field, id: unknown): string {
  if (!id || !f.ref) return '';
  const r = refs[f.ref.col]?.rows.find((x) => x.id === id);
  return r ? String(r[f.ref.label] ?? '') : '…';
}

/** Plain-text value of a field (used for search, sort, export). */
export function textValue(f: Field, row: Row, refs: RefLabels, t: TFunction): string | number | boolean | null {
  const v = row[f.key];
  if (v === null || v === undefined || v === '') return null;
  switch (f.type) {
    case 'money': case 'number': case 'percent': return Number(v);
    case 'select': return t(`founder.opt.${f.optGroup}.${String(v)}`, { defaultValue: String(v) });
    case 'ref': return refLabel(refs, f, v);
    case 'bool': return Boolean(v);
    case 'date': return String(v);
    case 'datetime': return dateTime(v);
    default: return String(v);
  }
}

export function Cell({ f, row, refs }: { f: Field; row: Row; refs: RefLabels }) {
  const { t } = useTranslation();
  const v = row[f.key];
  switch (f.type) {
    case 'money': return <span className="tabular-nums" dir="ltr">{v === null || v === undefined ? '—' : sar(v)}</span>;
    case 'number': return <span className="tabular-nums">{f.key === 'size_bytes' ? (v ? `${num(Number(v) / 1024 / 1024, 2)} MB` : '—') : num(v, 2)}</span>;
    case 'percent': return <span className="tabular-nums">{v === null || v === undefined ? '—' : pct(v)}</span>;
    case 'select': return <Opt group={f.optGroup!} value={v} />;
    case 'ref': return <span>{refLabel(refs, f, v) || '—'}</span>;
    case 'bool': return <span>{v ? '✓' : '—'}</span>;
    case 'date': return <span className="whitespace-nowrap">{day(v)}</span>;
    case 'datetime': return <span className="whitespace-nowrap">{dateTime(v)}</span>;
    default: return <span className="line-clamp-2" dir="auto">{v ? String(v) : <span className="text-muted-foreground">{t('founder.common.none')}</span>}</span>;
  }
}

export function sheetOf(title: string, rows: Row[], fields: Field[], refs: RefLabels, t: TFunction): Sheet {
  const cols = fields.filter((f) => f.table);
  return {
    title,
    columns: cols.map((f) => ({ key: f.key, label: t(`founder.fields.${f.key}`) })),
    rows: rows.map((r) => Object.fromEntries(cols.map((f) => [f.key, textValue(f, r, refs, t)]))),
  };
}

export function ExportMenu({ title, sheets }: { title: string; sheets: () => Sheet[] }) {
  const { t } = useTranslation();
  const run = useFounderAction((format: 'xlsx' | 'pdf') => exportFile(format, title, sheets()), { success: false });
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild><Button size="sm" variant="outline" loading={run.isPending}><Download /> {t('founder.common.export')}</Button></DropdownMenuTrigger>
      <DropdownMenuContent>
        <DropdownMenuItem onSelect={() => run.mutate('xlsx')}><FileSpreadsheet /> {t('founder.common.excel')}</DropdownMenuItem>
        <DropdownMenuItem onSelect={() => run.mutate('pdf')}><FileText /> {t('founder.common.pdf')}</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/* ───────── record dialog ───────── */

function initialValues(fields: Field[], row: Row | null, defaults: Record<string, unknown>) {
  const v: Record<string, unknown> = {};
  for (const f of fields) {
    if (f.readOnly) continue;
    const d = f.default === '__today' ? todayIso() : f.default;
    v[f.key] = row ? row[f.key] ?? null : defaults[f.key] ?? d ?? (f.type === 'bool' ? false : null);
  }
  return v;
}

export function RecordDialog({ col, row, open, onClose, defaults = {}, fields: fieldsOverride, title }: { col: string; row: Row | null; open: boolean; onClose: () => void; defaults?: Record<string, unknown>; fields?: Field[]; title?: string }) {
  const { t } = useTranslation();
  const fields = (fieldsOverride ?? FIELDS[col] ?? []).filter((f) => !f.readOnly);
  const refs = useRefLabels(fields);
  const [values, setValues] = useState<Record<string, unknown>>(() => initialValues(fields, row, defaults));
  const [key, setKey] = useState<string | null>(null);
  const k = `${row?.id ?? 'new'}-${open}`;
  if (key !== k) {
    setKey(k);
    setValues(initialValues(fields, row, defaults));
  }
  const save = useFounderAction(() => {
    const out: Record<string, unknown> = {};
    for (const f of fields) {
      if (row && f.createOnly) continue;
      let v = values[f.key];
      if (v === '' || v === undefined) v = null;
      if (v !== null && (f.type === 'money' || f.type === 'number' || f.type === 'percent')) v = Number(v);
      if (v !== null && f.type === 'datetime') v = new Date(String(v)).toISOString();
      if (row && JSON.stringify(v) === JSON.stringify(row[f.key] ?? null)) continue;
      if (!row && v === null) continue;
      out[f.key] = v;
    }
    return saveRow(col, row?.id ?? null, out);
  }, { onSuccess: onClose });
  const set = (key: string, v: unknown) => setValues((s) => ({ ...s, [key]: v }));

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent size="lg" closeLabel={t('founder.common.cancel')}>
        <DialogHeader><DialogTitle>{title ?? (row ? t('founder.common.edit') : t('founder.common.add'))}</DialogTitle></DialogHeader>
        <form className="grid max-h-[65vh] gap-3 overflow-y-auto px-1 sm:grid-cols-2" onSubmit={(e) => { e.preventDefault(); save.mutate(undefined); }}>
          {fields.map((f) => {
            const v = values[f.key];
            const disabled = Boolean(row && f.createOnly);
            const label = <>{t(`founder.fields.${f.key}`)}{f.required && <span className="text-destructive"> *</span>}</>;
            const id = `fd-${f.key}`;
            let input: ReactNode;
            switch (f.type) {
              case 'textarea': input = <Textarea id={id} rows={3} dir="auto" value={String(v ?? '')} onChange={(e) => set(f.key, e.target.value)} />; break;
              case 'select': input = <NativeSelect id={id} value={String(v ?? '')} required={f.required} onChange={(e) => set(f.key, e.target.value || null)} disabled={disabled}>{!f.required && <option value="">—</option>}{f.options!.map((o) => <option key={o} value={o}>{t(`founder.opt.${f.optGroup}.${o}`, o)}</option>)}</NativeSelect>; break;
              case 'ref': input = <NativeSelect id={id} value={String(v ?? '')} required={f.required} onChange={(e) => set(f.key, e.target.value || null)}><option value="">—</option>{(refs[f.ref!.col]?.rows ?? []).map((r) => <option key={r.id} value={r.id}>{String(r[f.ref!.label] ?? r.id)}</option>)}</NativeSelect>; break;
              case 'bool': input = <label className="flex h-9 items-center gap-2 text-sm"><Checkbox id={id} checked={Boolean(v)} onCheckedChange={(c) => set(f.key, c === true)} /> {t('founder.common.yes')}</label>; break;
              case 'date': input = <Input id={id} type="date" dir="ltr" value={String(v ?? '')} required={f.required} onChange={(e) => set(f.key, e.target.value || null)} disabled={disabled} />; break;
              case 'datetime': input = <Input id={id} type="datetime-local" dir="ltr" value={v ? toLocalInput(String(v)) : ''} onChange={(e) => set(f.key, e.target.value || null)} />; break;
              case 'money': case 'number': case 'percent': input = <Input id={id} type="number" dir="ltr" step="any" min={f.type === 'number' && f.key !== 'likelihood' ? undefined : 0} max={f.type === 'percent' ? 100 : undefined} value={v === null || v === undefined ? '' : String(v)} required={f.required} onChange={(e) => set(f.key, e.target.value)} disabled={disabled} />; break;
              default: input = <Input id={id} dir="auto" value={String(v ?? '')} required={f.required} onChange={(e) => set(f.key, e.target.value)} disabled={disabled} />;
            }
            return <FormField key={f.key} htmlFor={id} label={label} className={f.wide || f.type === 'textarea' ? 'sm:col-span-2' : undefined}>{input}</FormField>;
          })}
          <button type="submit" className="hidden" />
        </form>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{t('founder.common.cancel')}</Button>
          <Button onClick={() => save.mutate(undefined)} loading={save.isPending}>{t('founder.common.save')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function toLocalInput(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const p = (x: number) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

/* ───────── data table ───────── */

export function DataTable({ col, rows, fields: fieldsOverride, title, onEdit, actions, hideFilters, rowExtra, loading }: {
  col: string; rows: Row[]; fields?: Field[]; title: string; onEdit?: (r: Row) => void; actions?: ReactNode; hideFilters?: string[]; rowExtra?: (r: Row) => ReactNode; loading?: boolean;
}) {
  const { t } = useTranslation();
  const fields = useMemo(() => fieldsOverride ?? FIELDS[col] ?? [], [fieldsOverride, col]);
  const cols = useMemo(() => fields.filter((f) => f.table), [fields]);
  const refs = useRefLabels(fields);
  const [q, setQ] = useState('');
  const [sort, setSort] = useState<{ key: string; dir: 1 | -1 } | null>(null);
  const [filters, setFilters] = useState<Record<string, string>>({});
  const [deleting, setDeleting] = useState<Row | null>(null);
  const del = useFounderAction((id: string) => deleteRow(col, id), { success: t('founder.common.deleted') });
  const filterFields = fields.filter((f) => f.filter && (f.type === 'select' || f.type === 'ref') && !hideFilters?.includes(f.key));

  const view = useMemo(() => {
    let out = rows.filter((r) => Object.entries(filters).every(([k, v]) => !v || String(r[k] ?? '') === v));
    if (q.trim()) {
      const needle = q.trim().toLowerCase();
      out = out.filter((r) => cols.some((f) => String(textValue(f, r, refs, t) ?? '').toLowerCase().includes(needle)));
    }
    if (sort) {
      const f = fields.find((x) => x.key === sort.key)!;
      out = [...out].sort((a, b) => {
        const av = textValue(f, a, refs, t);
        const bv = textValue(f, b, refs, t);
        if (av === bv) return 0;
        if (av === null) return 1;
        if (bv === null) return -1;
        return (av > bv ? 1 : -1) * sort.dir;
      });
    }
    return out;
  }, [rows, filters, q, sort, cols, fields, refs, t]);

  return (
    <Section
      title={<span className="flex items-center gap-2">{title}<span className="text-xs font-normal text-muted-foreground">{t('founder.common.records', { count: view.length })}</span></span>}
      actions={<div className="flex flex-wrap items-center gap-2">{actions}<ExportMenu title={title} sheets={() => [sheetOf(title, view, fields, refs, t)]} /></div>}
    >
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="relative min-w-40 flex-1"><Search className="absolute start-2.5 top-2.5 size-4 text-muted-foreground" /><Input className="ps-8" placeholder={t('founder.common.search')} value={q} onChange={(e) => setQ(e.target.value)} /></div>
        {filterFields.map((f) => (
          <NativeSelect key={f.key} className="w-auto min-w-32" aria-label={t(`founder.fields.${f.key}`)} value={filters[f.key] ?? ''} onChange={(e) => setFilters((s) => ({ ...s, [f.key]: e.target.value }))}>
            <option value="">{t(`founder.fields.${f.key}`)}: {t('founder.common.all')}</option>
            {f.type === 'select' ? f.options!.map((o) => <option key={o} value={o}>{t(`founder.opt.${f.optGroup}.${o}`, o)}</option>) : (refs[f.ref!.col]?.rows ?? []).map((r) => <option key={r.id} value={r.id}>{String(r[f.ref!.label] ?? '')}</option>)}
          </NativeSelect>
        ))}
      </div>
      {loading ? <div className="h-24 animate-pulse rounded-lg bg-muted" /> : view.length === 0 ? (
        <EmptyState icon={<Inbox />} title={t('founder.common.empty')} />
      ) : (
        <div className="-mx-4 overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead><tr className="border-b text-xs text-muted-foreground">
              {cols.map((f) => (
                <th key={f.key} className="px-4 py-2 text-start font-medium">
                  <button type="button" className="inline-flex items-center gap-1 hover:text-foreground" onClick={() => setSort((s) => (s?.key === f.key ? { key: f.key, dir: s.dir === 1 ? -1 : 1 } : { key: f.key, dir: 1 }))}>
                    {t(`founder.fields.${f.key}`)} <ArrowDownUp className={cn('size-3', sort?.key === f.key ? 'opacity-100' : 'opacity-30')} />
                  </button>
                </th>
              ))}
              <th className="w-24 px-4 py-2" />
            </tr></thead>
            <tbody>
              {view.map((r) => (
                <tr key={r.id} className="border-b last:border-0 hover:bg-muted/40">
                  {cols.map((f, i) => <td key={f.key} className={cn('px-4 py-2 align-top', i === 0 && 'font-medium')}>{i === 0 && onEdit ? <button type="button" className="text-start hover:text-primary" onClick={() => onEdit(r)}><Cell f={f} row={r} refs={refs} /></button> : <Cell f={f} row={r} refs={refs} />}</td>)}
                  <td className="px-4 py-2 align-top">
                    <div className="flex justify-end gap-1">
                      {rowExtra?.(r)}
                      {onEdit && <Button size="icon-sm" variant="ghost" aria-label={t('founder.common.edit')} onClick={() => onEdit(r)}><Pencil /></Button>}
                      <Button size="icon-sm" variant="ghost" aria-label={t('founder.common.delete')} onClick={() => setDeleting(r)}><Trash2 /></Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <ConfirmDialog open={Boolean(deleting)} onOpenChange={(o) => !o && setDeleting(null)} title={t('founder.common.confirmDelete')} confirmLabel={t('founder.common.delete')} cancelLabel={t('founder.common.cancel')} destructive onConfirm={() => { if (deleting) del.mutate(deleting.id); setDeleting(null); }} />
    </Section>
  );
}

/** A full CRUD section for one record type: list + filters + add/edit dialog + export. */
export function CollectionSection({ col, title, filter = {}, defaults = {}, fields, rowExtra, actions }: { col: string; title: string; filter?: Record<string, string | undefined>; defaults?: Record<string, unknown>; fields?: Field[]; rowExtra?: (r: Row) => ReactNode; actions?: ReactNode }) {
  const { t } = useTranslation();
  const { data, isLoading } = useCollection(col, filter);
  const [editing, setEditing] = useState<Row | null | 'new'>(null);
  return (
    <>
      <DataTable col={col} rows={data ?? []} loading={isLoading} title={title} fields={fields} onEdit={(r) => setEditing(r)} hideFilters={Object.keys(filter)} rowExtra={rowExtra}
        actions={<>{actions}<Button size="sm" onClick={() => setEditing('new')}><Plus /> {t('founder.common.add')}</Button></>} />
      <RecordDialog col={col} fields={fields} row={editing === 'new' ? null : editing} open={editing !== null} onClose={() => setEditing(null)} defaults={{ ...filter, ...defaults }} />
    </>
  );
}
