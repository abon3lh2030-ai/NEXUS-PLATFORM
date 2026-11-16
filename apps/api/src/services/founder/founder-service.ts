import type { FastifyBaseLogger } from 'fastify';
import { AppError, badRequest, notFound, unwrap } from '../../lib/errors.js';
import type { Db } from '../../lib/supabase.js';
import { COLLECTIONS, type CollectionName } from './collections.js';

export interface FounderActor {
  userId: string;
  email: string | null;
  ip?: string | undefined;
  userAgent?: string | undefined;
}

type Row = Record<string, unknown> & { id: string };
const BUCKET = 'founder-documents';
const LIST_LIMIT = 2000;

/** Spreads extra fields onto a row while keeping its open record type. */
const ext = <T extends object>(r: Row, extra: T) => ({ ...r, ...extra }) as Row & T;
const n = (v: unknown): number => (v === null || v === undefined || v === '' ? 0 : Number(v));
const today = () => new Date().toISOString().slice(0, 10);
const round2 = (v: number) => Math.round(v * 100) / 100;
const monthKey = (d: string) => d.slice(0, 7);
/** Default win probability per stage when a deal has none. */
export const STAGE_PROBABILITY: Record<string, number> = { lead: 10, contacted: 20, meeting: 35, proposal: 50, negotiation: 70, won: 100, lost: 0 };
const OPEN_STAGES = ['lead', 'contacted', 'meeting', 'proposal', 'negotiation'];

function addYears(d: string, years: number): string {
  const x = new Date(`${d}T00:00:00Z`);
  x.setUTCFullYear(x.getUTCFullYear() + years);
  return x.toISOString().slice(0, 10);
}

function lastMonths(count: number, from = new Date()): string[] {
  const out: string[] = [];
  for (let i = count - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth() - i, 1));
    out.push(d.toISOString().slice(0, 7));
  }
  return out;
}

const within = (d: unknown, start: unknown, end: unknown) => typeof d === 'string' && (!start || d >= String(start)) && (!end || d <= String(end));

/** Technology independence %: share of capability weight served today by NEXUS-owned, active infrastructure. */
export function independencePercent(services: Array<{ capability: string; ownership: string; status: string; weight: number | string }>): number {
  const caps = new Map<string, { weight: number; owned: boolean }>();
  for (const s of services) {
    const c = caps.get(s.capability) ?? { weight: 0, owned: false };
    c.weight = Math.max(c.weight, n(s.weight) || 1);
    if (s.ownership === 'owned' && s.status === 'active') c.owned = true;
    caps.set(s.capability, c);
  }
  let total = 0;
  let owned = 0;
  for (const c of caps.values()) {
    total += c.weight;
    if (c.owned) owned += c.weight;
  }
  return total ? Math.round((owned / total) * 1000) / 10 : 0;
}

/** Cash runway in months from the cash balance and the average net burn of the last 3 full months. */
export function runwayMonths(cash: number, netBurnPerMonth: number): number | null {
  if (netBurnPerMonth <= 0) return null; // not burning cash
  return Math.round((cash / netBurnPerMonth) * 10) / 10;
}

export class FounderService {
  constructor(
    private readonly db: Db,
    private readonly log: FastifyBaseLogger,
  ) {}

  /* ───────────── accounts & audit ───────────── */

  async account(userId: string) {
    const { data } = await this.db.from('founder_accounts').select('*').eq('user_id', userId).maybeSingle();
    return data as { user_id: string; display_name: string; must_change_password: boolean; last_session_id: string | null; last_login_at: string | null; password_changed_at: string | null } | null;
  }

  async audit(actor: FounderActor, action: string, entity: string | null, entityId: string | null, summary: string | null, before?: unknown, after?: unknown): Promise<void> {
    const { error } = await this.db.from('founder_audit_log').insert({
      user_id: actor.userId, action, entity, entity_id: entityId, summary: summary?.slice(0, 500) ?? null,
      before: before ?? null, after: after ?? null, ip: actor.ip ?? null, user_agent: actor.userAgent?.slice(0, 300) ?? null,
    });
    if (error) {
      // An unaudited change is not acceptable: surface the failure.
      this.log.error({ err: error.message }, 'founder_audit_failed');
      throw new AppError(500, 'audit_failed');
    }
  }

  /** Records a login the first time a new Supabase session reaches the portal. */
  async noteSession(actor: FounderActor, sessionId: string | null): Promise<void> {
    if (!sessionId) return;
    const acc = await this.account(actor.userId);
    if (!acc || acc.last_session_id === sessionId) return;
    await this.db.from('founder_accounts').update({ last_session_id: sessionId, last_login_at: new Date().toISOString() }).eq('user_id', actor.userId);
    await this.audit(actor, 'login', 'session', null, actor.email ? `تسجيل دخول ${actor.email}` : 'تسجيل دخول');
  }

  async auditLog(opts: { entity?: string | undefined; entityId?: string | undefined; limit?: number | undefined }) {
    let q = this.db.from('founder_audit_log').select('*').order('created_at', { ascending: false }).limit(Math.min(opts.limit ?? 200, 1000));
    if (opts.entity) q = q.eq('entity', opts.entity);
    if (opts.entityId) q = q.eq('entity_id', opts.entityId);
    const { data } = await q;
    return data ?? [];
  }

  /* ───────────── settings ───────────── */

  async settings(): Promise<Record<string, unknown>> {
    const { data } = await this.db.from('founder_settings').select('key, value');
    return Object.fromEntries((data ?? []).map((r: { key: string; value: unknown }) => [r.key, r.value]));
  }

  async setSetting(actor: FounderActor, key: string, value: unknown) {
    const before = (await this.settings())[key];
    // A cleared setting is stored as "no row" (PostgREST would turn a JSON null into SQL NULL).
    if (value === null) await this.db.from('founder_settings').delete().eq('key', key);
    else unwrap(await this.db.from('founder_settings').upsert({ key, value, updated_at: new Date().toISOString() }).select('key').single());
    await this.audit(actor, 'setting.update', 'setting', null, key, { [key]: before ?? null }, { [key]: value });
    return { key, value };
  }

  /* ───────────── generic CRUD ───────────── */

  async list(name: CollectionName, filters: Record<string, string>, q?: string): Promise<Row[]> {
    const c = COLLECTIONS[name];
    let query = this.db.from(c.table).select('*').order(c.order.column, { ascending: c.order.ascending, nullsFirst: false }).limit(LIST_LIMIT);
    for (const [k, v] of Object.entries(filters)) {
      if (!(c.filters as readonly string[]).includes(k) || !v) continue;
      query = v === 'null' ? query.is(k, null) : query.eq(k, v);
    }
    if (q && 'search' in c && c.search) query = query.ilike(c.search, `%${q.replace(/[%_\\]/g, (m) => `\\${m}`)}%`);
    const { data, error } = await query;
    if (error) throw new AppError(500, 'database_error', error.message);
    return (data ?? []) as Row[];
  }

  async get(name: CollectionName, id: string): Promise<Row> {
    return unwrap(await this.db.from(COLLECTIONS[name].table).select('*').eq('id', id).maybeSingle(), 'not_found') as Row;
  }

  async create(actor: FounderActor, name: CollectionName, input: Record<string, unknown>): Promise<Row> {
    const c = COLLECTIONS[name];
    if ('noCreate' in c && c.noCreate) throw badRequest('create_not_allowed');
    const values = await this.beforeWrite(name, input, null);
    const row = unwrap(await this.db.from(c.table).insert(values).select('*').single()) as Row;
    await this.afterWrite(actor, name, null, row);
    await this.audit(actor, 'create', name, row.id, String(row[c.label] ?? ''), null, row);
    return row;
  }

  async update(actor: FounderActor, name: CollectionName, id: string, patch: Record<string, unknown>): Promise<Row> {
    const c = COLLECTIONS[name];
    const before = await this.get(name, id);
    const values = await this.beforeWrite(name, patch, before);
    const row = unwrap(await this.db.from(c.table).update(values).eq('id', id).select('*').single()) as Row;
    await this.afterWrite(actor, name, before, row);
    await this.audit(actor, 'update', name, id, String(row[c.label] ?? ''), diff(before, row).before, diff(before, row).after);
    return row;
  }

  async remove(actor: FounderActor, name: CollectionName, id: string): Promise<void> {
    const c = COLLECTIONS[name];
    const before = await this.get(name, id);
    if (name === 'transactions' && before.source === 'asset_purchase' && before.asset_id) await this.undoPurchase(before);
    if (name === 'documents' && before.storage_path) await this.db.storage.from(BUCKET).remove([String(before.storage_path)]);
    const { error } = await this.db.from(c.table).delete().eq('id', id);
    if (error) throw new AppError(500, 'database_error', error.message);
    await this.audit(actor, 'delete', name, id, String(before[c.label] ?? ''), before, null);
  }

  /** Normalizes a write and enforces the cross-record rules. */
  private async beforeWrite(name: CollectionName, input: Record<string, unknown>, before: Row | null): Promise<Record<string, unknown>> {
    const v: Record<string, unknown> = { ...input };
    const merged = { ...(before ?? {}), ...v };
    for (const k of Object.keys(v)) if (v[k] === '') v[k] = null;

    if (name === 'ti_tasks') {
      if (merged.status === 'done') {
        // Nothing counts as done without proof or a note from the founder.
        if (!merged.evidence && !merged.evidence_document_id && !merged.note) throw badRequest('evidence_required');
        if (!merged.completed_on) v.completed_on = today();
        v.progress = 100;
      } else if (before?.status === 'done' && v.status) v.completed_on = null;
    }
    if (name === 'dev_items') {
      if (merged.status === 'done') {
        if (!merged.completed_on) v.completed_on = today();
        v.progress = 100;
      } else if (before?.status === 'done' && v.status) v.completed_on = null;
    }
    if (name === 'deals') {
      if (merged.stage === 'won' && !merged.won_on) v.won_on = today();
      if (merged.stage !== 'won' && before?.stage === 'won') v.won_on = null;
    }
    if (name === 'releases' && merged.status === 'released' && !merged.released_on) v.released_on = today();
    if (name === 'transactions') {
      if (before?.source && before.source !== 'manual' && (v.amount !== undefined || v.kind !== undefined)) throw badRequest('linked_transaction_edit_from_source');
      // An expense against a budget line inherits that line's phase.
      if (merged.budget_id && !merged.phase_id) {
        const { data: b } = await this.db.from('founder_budgets').select('phase_id').eq('id', String(merged.budget_id)).maybeSingle();
        if (b?.phase_id) v.phase_id = b.phase_id;
      }
    }
    if (name === 'assets' && n(merged.installed_qty) > n(merged.purchased_qty)) throw badRequest('installed_exceeds_purchased');
    if (name === 'phases' && v.status === 'current' && before?.status !== 'current') {
      const { data: cur } = await this.db.from('founder_ti_phases').select('id, ord, actual_end').eq('status', 'current').maybeSingle();
      if (cur) {
        const forward = before ? n(cur.ord) < n(before.ord) : true;
        await this.db.from('founder_ti_phases').update(forward ? { status: 'completed', actual_end: cur.actual_end ?? today() } : { status: 'not_started' }).eq('id', cur.id);
      }
      if (!merged.actual_start) v.actual_start = today();
    }
    return v;
  }

  /** Keeps linked records in step (a won deal books its revenue, etc.). */
  private async afterWrite(actor: FounderActor, name: CollectionName, before: Row | null, row: Row): Promise<void> {
    if (name !== 'deals') return;
    const { data: tx } = await this.db.from('founder_transactions').select('id, amount').eq('deal_id', row.id).eq('source', 'deal_won').maybeSingle();
    if (row.stage === 'won' && n(row.value) > 0) {
      const values = { kind: 'revenue', category: 'subscriptions', amount: n(row.value), occurred_on: String(row.won_on ?? today()), description: `صفقة: ${String(row.company_name)}`, counterparty: String(row.company_name), deal_id: row.id, campaign_id: row.campaign_id ?? null, source: 'deal_won' };
      if (tx) await this.db.from('founder_transactions').update(values).eq('id', tx.id);
      else {
        const created = unwrap(await this.db.from('founder_transactions').insert(values).select('*').single()) as Row;
        await this.audit(actor, 'create', 'transactions', created.id, `إيراد تلقائي من صفقة ${String(row.company_name)}`, null, created);
      }
    } else if (tx && (before?.stage === 'won' || row.stage !== 'won' || n(row.value) <= 0)) {
      await this.db.from('founder_transactions').delete().eq('id', tx.id);
      await this.audit(actor, 'delete', 'transactions', tx.id, `حذف إيراد صفقة ${String(row.company_name)} بعد تغيير مرحلتها`, tx, null);
    }
  }

  /* ───────────── hardware purchases ───────────── */

  async purchaseAsset(actor: FounderActor, assetId: string, input: { quantity: number; unit_price: number; occurred_on: string; counterparty?: string | null | undefined; notes?: string | null | undefined }) {
    const asset = await this.get('assets', assetId);
    const purchased = n(asset.purchased_qty) + input.quantity;
    if (purchased > n(asset.quantity)) throw badRequest('exceeds_required_quantity');
    const tx = unwrap(await this.db.from('founder_transactions').insert({
      kind: 'expense', category: 'hardware', amount: round2(input.quantity * input.unit_price), quantity: input.quantity, occurred_on: input.occurred_on,
      description: `شراء ${input.quantity} × ${String(asset.name)}`, counterparty: input.counterparty ?? null, notes: input.notes ?? null,
      asset_id: assetId, budget_id: asset.budget_id ?? null, phase_id: asset.phase_id ?? null, source: 'asset_purchase',
    }).select('*').single()) as Row;
    const updated = unwrap(await this.db.from('founder_ti_assets').update({ purchased_qty: purchased }).eq('id', assetId).select('*').single()) as Row;
    await this.audit(actor, 'asset.purchase', 'assets', assetId, `${String(asset.name)}: شراء ${input.quantity}`, { purchased_qty: asset.purchased_qty }, { purchased_qty: purchased, transaction_id: tx.id, amount: tx.amount });
    return { asset: updated, transaction: tx };
  }

  async installAsset(actor: FounderActor, assetId: string, quantity: number) {
    const asset = await this.get('assets', assetId);
    const installed = n(asset.installed_qty) + quantity;
    if (installed > n(asset.purchased_qty)) throw badRequest('installed_exceeds_purchased');
    const updated = unwrap(await this.db.from('founder_ti_assets').update({ installed_qty: installed }).eq('id', assetId).select('*').single()) as Row;
    await this.audit(actor, 'asset.install', 'assets', assetId, `${String(asset.name)}: تركيب ${quantity}`, { installed_qty: asset.installed_qty }, { installed_qty: installed });
    return updated;
  }

  private async undoPurchase(tx: Row) {
    const { data: asset } = await this.db.from('founder_ti_assets').select('purchased_qty, installed_qty').eq('id', String(tx.asset_id)).maybeSingle();
    if (!asset) return;
    const purchased = Math.max(0, n(asset.purchased_qty) - (n(tx.quantity) || 0));
    await this.db.from('founder_ti_assets').update({ purchased_qty: purchased, installed_qty: Math.min(n(asset.installed_qty), purchased) }).eq('id', String(tx.asset_id));
  }

  /* ───────────── documents (private bucket, signed URLs) ───────────── */

  async createUpload(actor: FounderActor, input: { title: string; category: string; file_name: string; mime_type: string; size_bytes: number; notes?: string | null | undefined }) {
    const safe = input.file_name.normalize('NFKC').replace(/[^\p{L}\p{N}._-]+/gu, '_').slice(-120) || 'file';
    const doc = unwrap(await this.db.from('founder_documents').insert({ title: input.title, category: input.category, mime_type: input.mime_type, size_bytes: input.size_bytes, notes: input.notes ?? null }).select('*').single()) as Row;
    const path = `docs/${doc.id}/${safe}`;
    await this.db.from('founder_documents').update({ storage_path: path }).eq('id', doc.id);
    const { data, error } = await this.db.storage.from(BUCKET).createSignedUploadUrl(path);
    if (error || !data) {
      await this.db.from('founder_documents').delete().eq('id', doc.id);
      throw new AppError(500, 'storage_error', error?.message);
    }
    await this.audit(actor, 'document.upload_started', 'documents', doc.id, input.title);
    return { document_id: doc.id, upload_url: data.signedUrl, token: data.token, path };
  }

  async confirmUpload(actor: FounderActor, id: string) {
    const doc = await this.get('documents', id);
    const path = String(doc.storage_path ?? '');
    const folder = path.slice(0, path.lastIndexOf('/'));
    const { data } = await this.db.storage.from(BUCKET).list(folder, { limit: 10 });
    const obj = (data ?? []).find((o) => `${folder}/${o.name}` === path);
    if (!obj) throw badRequest('upload_missing');
    const size = Number((obj.metadata as { size?: number } | null)?.size ?? doc.size_bytes ?? 0);
    const row = unwrap(await this.db.from('founder_documents').update({ uploaded: true, size_bytes: size }).eq('id', id).select('*').single()) as Row;
    await this.audit(actor, 'document.uploaded', 'documents', id, String(doc.title));
    return row;
  }

  async downloadUrl(actor: FounderActor, id: string) {
    const doc = await this.get('documents', id);
    if (!doc.storage_path || !doc.uploaded) throw notFound('file_not_found');
    const { data, error } = await this.db.storage.from(BUCKET).createSignedUrl(String(doc.storage_path), 60, { download: String(doc.title) });
    if (error || !data) throw new AppError(500, 'storage_error', error?.message);
    await this.audit(actor, 'document.download', 'documents', id, String(doc.title));
    return { url: data.signedUrl };
  }

  /* ───────────── aggregates ───────────── */

  private async all() {
    const names: CollectionName[] = ['transactions', 'budgets', 'deals', 'deal_activities', 'dev_items', 'releases', 'goals', 'plans', 'phases', 'assets', 'models', 'services', 'ti_tasks', 'risks', 'decisions', 'legal', 'commitments', 'rounds', 'shareholders', 'team', 'campaigns', 'projects'];
    const [settings, ...lists] = await Promise.all([this.settings(), ...names.map((k) => this.list(k, {}))]);
    const d = Object.fromEntries(names.map((k, i) => [k, lists[i]!])) as Record<CollectionName, Row[]>;
    return { settings, ...d };
  }

  finance(d: Awaited<ReturnType<FounderService['all']>>) {
    const sum = (rows: Row[]) => round2(rows.reduce((a, r) => a + n(r.amount), 0));
    const tx = d.transactions;
    const funding = sum(tx.filter((t) => t.kind === 'funding'));
    const revenue = sum(tx.filter((t) => t.kind === 'revenue'));
    const expenses = sum(tx.filter((t) => t.kind === 'expense'));
    const opening = n(d.settings.opening_cash_balance);
    const cash = round2(opening + funding + revenue - expenses);

    const months = lastMonths(12);
    const byMonth = months.map((m) => {
      const rows = tx.filter((t) => monthKey(String(t.occurred_on)) === m);
      return { month: m, funding: sum(rows.filter((t) => t.kind === 'funding')), revenue: sum(rows.filter((t) => t.kind === 'revenue')), expenses: sum(rows.filter((t) => t.kind === 'expense')) };
    });
    let running = opening + sum(tx.filter((t) => monthKey(String(t.occurred_on)) < months[0]!).map((t) => ({ ...t, amount: t.kind === 'expense' ? -n(t.amount) : n(t.amount) })));
    const cashFlow = byMonth.map((m) => {
      const net = round2(m.funding + m.revenue - m.expenses);
      running = round2(running + net);
      return { ...m, net, balance: running };
    });
    // Net burn = average (expenses − revenue) of the last 3 full months; falls back to active commitments.
    const last3 = byMonth.slice(-4, -1);
    let netBurn = last3.reduce((a, m) => a + m.expenses - m.revenue, 0) / 3;
    const monthlyCommitments = round2(d.commitments.filter((c) => c.status === 'active').reduce((a, c) => a + monthlyOf(c), 0));
    if (netBurn <= 0 && monthlyCommitments > 0 && revenue === 0) netBurn = monthlyCommitments;
    const fundingTarget = d.settings.funding_target != null ? n(d.settings.funding_target) : round2(d.rounds.filter((r) => r.status !== 'cancelled').reduce((a, r) => a + n(r.target_amount), 0));

    const categories = new Map<string, { category: string; expenses: number; revenue: number; funding: number }>();
    for (const t of tx) {
      const c = categories.get(String(t.category)) ?? { category: String(t.category), expenses: 0, revenue: 0, funding: 0 };
      if (t.kind === 'expense') c.expenses += n(t.amount);
      else if (t.kind === 'revenue') c.revenue += n(t.amount);
      else c.funding += n(t.amount);
      categories.set(String(t.category), c);
    }
    const budgets = d.budgets.map((b) => {
      const actual = sum(tx.filter((t) => t.kind === 'expense' && t.budget_id === b.id));
      return { id: b.id, name: b.name, category: b.category, group_label: b.group_label, phase_id: b.phase_id, recurring: b.recurring, planned: n(b.planned_amount), actual, remaining: round2(n(b.planned_amount) - actual), over: actual > n(b.planned_amount) };
    });
    const generalBudgets = budgets.filter((b) => !b.phase_id);
    return {
      opening, funding, funding_target: fundingTarget, revenue, expenses, cash, profit: round2(revenue - expenses),
      net_burn_month: round2(Math.max(0, netBurn)), runway_months: runwayMonths(cash, netBurn), monthly_commitments: monthlyCommitments,
      cash_flow: cashFlow, categories: [...categories.values()].map((c) => ({ ...c, expenses: round2(c.expenses), revenue: round2(c.revenue), funding: round2(c.funding) })),
      budgets,
      budget_totals: {
        planned: round2(budgets.reduce((a, b) => a + b.planned, 0)), actual: round2(budgets.reduce((a, b) => a + b.actual, 0)),
        general_planned: round2(generalBudgets.reduce((a, b) => a + b.planned, 0)), general_actual: round2(generalBudgets.reduce((a, b) => a + b.actual, 0)),
        unbudgeted_expenses: sum(tx.filter((t) => t.kind === 'expense' && !t.budget_id)),
      },
    };
  }

  sales(d: Awaited<ReturnType<FounderService['all']>>) {
    const stages = ['lead', 'contacted', 'meeting', 'proposal', 'negotiation', 'won', 'lost'];
    const by = stages.map((s) => {
      const rows = d.deals.filter((x) => x.stage === s);
      return { stage: s, count: rows.length, value: round2(rows.reduce((a, r) => a + n(r.value), 0)) };
    });
    const won = d.deals.filter((x) => x.stage === 'won');
    const lost = d.deals.filter((x) => x.stage === 'lost');
    const open = d.deals.filter((x) => OPEN_STAGES.includes(String(x.stage)));
    const forecast = round2(open.reduce((a, r) => a + (n(r.value) * (r.probability != null ? n(r.probability) : STAGE_PROBABILITY[String(r.stage)]!)) / 100, 0));
    const now = new Date().toISOString();
    return {
      by_stage: by, leads: open.length, customers: won.length, lost: lost.length, open_deals: open.length,
      pipeline_value: round2(open.reduce((a, r) => a + n(r.value), 0)), won_value: round2(won.reduce((a, r) => a + n(r.value), 0)), forecast,
      conversion_rate: won.length + lost.length ? Math.round((won.length / (won.length + lost.length)) * 1000) / 10 : null,
      overdue_followups: d.deals.filter((x) => OPEN_STAGES.includes(String(x.stage)) && x.next_followup_on && String(x.next_followup_on) < today()).length
        + d.deal_activities.filter((a) => !a.done_at && a.due_at && String(a.due_at) < now).length,
    };
  }

  development(d: Awaited<ReturnType<FounderService['all']>>) {
    const items = d.dev_items.filter((i) => i.status !== 'cancelled');
    const pctOf = (rows: Row[]) => (rows.length ? Math.round(rows.reduce((a, r) => a + (r.status === 'done' ? 100 : n(r.progress)), 0) / rows.length) : 0);
    return {
      progress: pctOf(items), total: items.length, done: items.filter((i) => i.status === 'done').length,
      open_bugs: items.filter((i) => i.kind === 'bug' && i.status !== 'done').length,
      overdue: items.filter((i) => i.status !== 'done' && i.due_on && String(i.due_on) < today()).length,
      estimated_cost: round2(items.reduce((a, i) => a + n(i.estimated_cost), 0)),
      actual_cost: round2(d.transactions.filter((t) => t.kind === 'expense' && t.category === 'development').reduce((a, t) => a + n(t.amount), 0)),
      releases: d.releases.map((r) => {
        const rs = items.filter((i) => i.release_id === r.id);
        return { ...r, items: rs.length, done: rs.filter((i) => i.status === 'done').length, progress: pctOf(rs) };
      }),
    };
  }

  /** Live value of a goal (computed metrics come from portal data inside the goal's period). */
  goalValue(g: Row, d: Awaited<ReturnType<FounderService['all']>>, dev: number): number {
    const inP = (date: unknown) => within(date, g.period_start, g.period_end);
    switch (g.metric) {
      case 'won_companies': return d.deals.filter((x) => x.stage === 'won' && (!g.period_start && !g.period_end ? true : inP(x.won_on))).length;
      case 'revenue': return round2(d.transactions.filter((t) => t.kind === 'revenue' && inP(t.occurred_on)).reduce((a, t) => a + n(t.amount), 0));
      case 'funding': return round2(d.transactions.filter((t) => t.kind === 'funding' && inP(t.occurred_on)).reduce((a, t) => a + n(t.amount), 0));
      case 'leads': return d.deals.filter((x) => inP(String(x.created_at).slice(0, 10))).length;
      case 'team_size': return d.team.filter((m) => m.status === 'active').length;
      case 'dev_progress': return dev;
      default: return n(g.current_value);
    }
  }

  goals(d: Awaited<ReturnType<FounderService['all']>>, dev: number) {
    return d.goals.map((g) => {
      const current = this.goalValue(g, d, dev);
      const target = n(g.target_value);
      const overdue = g.status !== 'achieved' && g.status !== 'cancelled' && g.period_end && String(g.period_end) < today();
      return ext(g, { current_value: current, computed: g.metric !== 'manual', progress: target > 0 ? Math.min(100, Math.round((current / target) * 1000) / 10) : 0, overdue: Boolean(overdue) });
    });
  }

  technology(d: Awaited<ReturnType<FounderService['all']>>) {
    const launch = typeof d.settings.launch_date === 'string' ? d.settings.launch_date : null;
    const expenses = d.transactions.filter((t) => t.kind === 'expense');
    const t0 = today();
    const phases = d.phases.map((p) => {
      const ord = n(p.ord);
      // Planned dates follow the real launch date (year N starts N−1 years after launch) unless set by hand.
      const derivedStart = launch && ord <= 4 ? addYears(launch, ord - 1) : null;
      const derivedEnd = launch && ord <= 3 ? addYears(launch, ord) : null;
      const lines = d.budgets.filter((b) => b.phase_id === p.id);
      const spent = round2(expenses.filter((t) => t.phase_id === p.id).reduce((a, t) => a + n(t.amount), 0));
      const budget = p.budget_total != null ? n(p.budget_total) : round2(lines.reduce((a, b) => a + n(b.planned_amount), 0));
      const tasks = d.ti_tasks.filter((t) => t.phase_id === p.id);
      const conditions = tasks.filter((t) => t.kind === 'exit_condition');
      const work = tasks.filter((t) => t.kind === 'task');
      const assets = d.assets.filter((a) => a.phase_id === p.id);
      const pctOf = (rows: Row[]) => {
        const live = rows.filter((r) => r.status !== 'cancelled');
        return live.length ? Math.round(live.reduce((a, r) => a + (r.status === 'done' ? 100 : n(r.progress)), 0) / live.length) : 0;
      };
      return ext(p, {
        start: p.actual_start ?? p.planned_start ?? derivedStart, end: p.actual_end ?? p.planned_end ?? derivedEnd, dates_estimated: !p.planned_start && !p.actual_start,
        budget, lines_total: round2(lines.reduce((a, b) => a + n(b.planned_amount), 0)), spent, remaining: round2(budget - spent),
        tasks_total: work.length, tasks_done: work.filter((t) => t.status === 'done').length, tasks_overdue: work.filter((t) => t.status !== 'done' && t.status !== 'cancelled' && t.due_on && String(t.due_on) < t0).length,
        conditions_total: conditions.length, conditions_done: conditions.filter((t) => t.status === 'done').length,
        progress: pctOf([...work, ...conditions]),
        assets_required: assets.reduce((a, x) => a + n(x.quantity), 0), assets_purchased: assets.reduce((a, x) => a + n(x.purchased_qty), 0), assets_installed: assets.reduce((a, x) => a + n(x.installed_qty), 0),
      });
    });
    const current = phases.find((p) => p.status === 'current') ?? null;
    const next = current ? phases.find((p) => n(p.ord) > n(current.ord) && p.status !== 'completed') ?? null : phases.find((p) => p.status === 'not_started') ?? null;
    const services = d.services as unknown as Array<{ capability: string; ownership: string; status: string; weight: number }>;
    return {
      launch_date: launch, plan_approved_on: d.settings.plan_approved_on ?? null,
      independence: independencePercent(services),
      current_phase_id: current?.id ?? null, next_phase_id: next?.id ?? null, phases,
      external_active: d.services.filter((s) => s.ownership === 'external' && s.status === 'active'),
      external_planned: d.services.filter((s) => s.ownership === 'external' && s.status === 'planned'),
      replaced: d.services.filter((s) => s.ownership === 'external' && s.status === 'retired'),
      owned_active: d.services.filter((s) => s.ownership === 'owned' && s.status === 'active'),
      models: d.models, assets: d.assets,
      risks: d.risks.filter((r) => r.area === 'technology' && r.status !== 'closed').map((r) => ({ ...r, score: n(r.likelihood) * n(r.impact) })).sort((a, b) => b.score - a.score),
      blocking_conditions: next ? d.ti_tasks.filter((t) => t.phase_id === next.id && t.kind === 'exit_condition' && t.status !== 'done') : [],
    };
  }

  /** Current Progress: what is really done, in progress, not started, late, and what needs the founder. */
  async progress() {
    const d = await this.all();
    const tech = this.technology(d);
    const t0 = today();
    const phaseName = new Map(d.phases.map((p) => [p.id, String(p.name)]));
    const items = d.ti_tasks.map((t) => ext(t, { phase_name: phaseName.get(String(t.phase_id)) ?? null, overdue: t.status !== 'done' && t.status !== 'cancelled' && Boolean(t.due_on) && String(t.due_on) < t0 }));
    return {
      done: items.filter((t) => t.status === 'done'),
      in_progress: items.filter((t) => t.status === 'in_progress' || t.status === 'blocked'),
      not_started: items.filter((t) => t.status === 'not_started'),
      overdue: items.filter((t) => t.overdue),
      needs_decision: [
        ...items.filter((t) => t.needs_decision && t.status !== 'done'),
        ...d.decisions.filter((x) => x.status === 'proposed').map((x) => ({ ...x, kind: 'decision' })),
      ],
      needs_budget: items.filter((t) => t.needs_budget && t.status !== 'done'),
      blocking: tech.blocking_conditions,
      unverified_services: d.services.filter((s) => !s.verified && s.status === 'active'),
      status_table: { services: d.services, assets: d.assets, models: d.models },
      phases: tech.phases, current_phase_id: tech.current_phase_id, next_phase_id: tech.next_phase_id,
    };
  }

  async overview() {
    const d = await this.all();
    const finance = this.finance(d);
    const sales = this.sales(d);
    const dev = this.development(d);
    const goals = this.goals(d, dev.progress);
    const tech = this.technology(d);
    const t0 = today();
    const activePlans = new Set(d.plans.filter((p) => p.status === 'active').map((p) => p.id));
    const growthGoals = goals.filter((g) => g.plan_id && activePlans.has(String(g.plan_id)) && g.status !== 'cancelled');
    const alerts: Array<{ level: 'danger' | 'warning' | 'info'; key: string; params?: Record<string, unknown>; link?: string }> = [];
    if (finance.runway_months !== null && finance.runway_months < 6) alerts.push({ level: finance.runway_months < 3 ? 'danger' : 'warning', key: 'runway', params: { months: finance.runway_months }, link: '/founder/finance' });
    if (finance.cash < 0) alerts.push({ level: 'danger', key: 'negative_cash', params: { cash: finance.cash }, link: '/founder/finance' });
    for (const b of finance.budgets.filter((x) => x.over)) alerts.push({ level: 'warning', key: 'budget_over', params: { name: b.name, over: round2(b.actual - b.planned) }, link: '/founder/finance' });
    const overdueTi = d.ti_tasks.filter((x) => x.status !== 'done' && x.status !== 'cancelled' && x.due_on && String(x.due_on) < t0).length;
    if (overdueTi) alerts.push({ level: 'warning', key: 'ti_overdue', params: { count: overdueTi }, link: '/founder/technology/progress' });
    if (dev.overdue) alerts.push({ level: 'warning', key: 'dev_overdue', params: { count: dev.overdue }, link: '/founder/development' });
    if (sales.overdue_followups) alerts.push({ level: 'info', key: 'followups', params: { count: sales.overdue_followups }, link: '/founder/sales' });
    const legalDue = d.legal.filter((l) => l.status !== 'done' && l.status !== 'not_applicable' && ((l.due_on && String(l.due_on) <= addDays(t0, 14)) || (l.expires_on && String(l.expires_on) <= addDays(t0, 30)))).length;
    if (legalDue) alerts.push({ level: 'warning', key: 'legal_due', params: { count: legalDue }, link: '/founder/legal' });
    for (const g of goals.filter((x) => x.overdue)) alerts.push({ level: 'warning', key: 'goal_overdue', params: { title: g.title }, link: '/founder/strategy' });
    const unverified = d.services.filter((s) => !s.verified && s.status === 'active').length;
    if (unverified) alerts.push({ level: 'info', key: 'unverified', params: { count: unverified }, link: '/founder/technology/progress' });

    const risks = d.risks.filter((r) => r.status !== 'closed').map((r) => ({ ...r, score: n(r.likelihood) * n(r.impact) })).sort((a, b) => b.score - a.score);
    const currentPhase = tech.phases.find((p) => p.id === tech.current_phase_id) ?? null;
    return {
      finance: { funding: finance.funding, funding_target: finance.funding_target, revenue: finance.revenue, expenses: finance.expenses, cash: finance.cash, profit: finance.profit, runway_months: finance.runway_months, net_burn_month: finance.net_burn_month, cash_flow: finance.cash_flow },
      sales,
      development: { progress: dev.progress, total: dev.total, done: dev.done, open_bugs: dev.open_bugs },
      growth: { progress: growthGoals.length ? Math.round(growthGoals.reduce((a, g) => a + g.progress, 0) / growthGoals.length) : 0, goals: growthGoals.slice(0, 6) },
      technology: { independence: tech.independence, current_phase: currentPhase ? { id: currentPhase.id, name: currentPhase.name, progress: currentPhase.progress } : null, next_phase: tech.phases.find((p) => p.id === tech.next_phase_id)?.name ?? null },
      top_tasks: [
        ...d.ti_tasks.filter((x) => x.status !== 'done' && x.status !== 'cancelled' && (x.needs_decision || x.needs_budget || (x.due_on && String(x.due_on) < addDays(t0, 14)))).map((x) => ({ id: x.id, title: x.title, source: 'technology', due_on: x.due_on, status: x.status })),
        ...d.dev_items.filter((x) => x.status !== 'done' && x.status !== 'cancelled' && (x.priority === 'urgent' || x.priority === 'high')).map((x) => ({ id: x.id, title: x.title, source: 'development', due_on: x.due_on, status: x.status })),
      ].slice(0, 8),
      decisions: d.decisions.filter((x) => x.status === 'proposed').slice(0, 5),
      alerts, risks: risks.slice(0, 5),
    };
  }

  async financeSummary() {
    return this.finance(await this.all());
  }
  async salesSummary() {
    return this.sales(await this.all());
  }
  async developmentSummary() {
    return this.development(await this.all());
  }
  async goalsSummary() {
    const d = await this.all();
    return { plans: d.plans, goals: this.goals(d, this.development(d).progress), projects: d.projects };
  }
  async technologySummary() {
    return this.technology(await this.all());
  }
  async investorsSummary() {
    const d = await this.all();
    const totalShares = d.shareholders.reduce((a, s) => a + n(s.shares), 0);
    return {
      total_shares: totalShares,
      shareholders: d.shareholders.map((s) => ({ ...s, ownership_pct: totalShares ? Math.round((n(s.shares) / totalShares) * 10000) / 100 : 0, invested: round2(d.transactions.filter((t) => t.kind === 'funding' && t.shareholder_id === s.id).reduce((a, t) => a + n(t.amount), 0)) })),
      rounds: d.rounds.map((r) => ({ ...r, raised: round2(d.transactions.filter((t) => t.kind === 'funding' && t.round_id === r.id).reduce((a, t) => a + n(t.amount), 0)) })),
    };
  }
  async marketingSummary() {
    const d = await this.all();
    return d.campaigns.map((c) => {
      const deals = d.deals.filter((x) => x.campaign_id === c.id);
      return { ...c, spent: round2(d.transactions.filter((t) => t.kind === 'expense' && t.campaign_id === c.id).reduce((a, t) => a + n(t.amount), 0)), deals: deals.length, won: deals.filter((x) => x.stage === 'won').length, won_value: round2(deals.filter((x) => x.stage === 'won').reduce((a, x) => a + n(x.value), 0)) };
    });
  }
  async teamSummary() {
    const d = await this.all();
    const active = d.team.filter((m) => m.status === 'active');
    return {
      members: d.team.map((m) => ({ ...m, paid: round2(d.transactions.filter((t) => t.kind === 'expense' && t.team_member_id === m.id).reduce((a, t) => a + n(t.amount), 0)) })),
      active: active.length, monthly_cost: round2(active.reduce((a, m) => a + n(m.monthly_cost), 0)),
    };
  }
}

function addDays(d: string, days: number): string {
  const x = new Date(`${d}T00:00:00Z`);
  x.setUTCDate(x.getUTCDate() + days);
  return x.toISOString().slice(0, 10);
}

function monthlyOf(c: Row): number {
  const a = n(c.amount);
  switch (c.frequency) {
    case 'monthly': return a;
    case 'quarterly': return a / 3;
    case 'yearly': return a / 12;
    default: return 0;
  }
}

function diff(before: Row, after: Row) {
  const b: Record<string, unknown> = {};
  const a: Record<string, unknown> = {};
  for (const k of Object.keys(after)) {
    if (k === 'updated_at') continue;
    if (JSON.stringify(before[k]) !== JSON.stringify(after[k])) {
      b[k] = before[k] ?? null;
      a[k] = after[k] ?? null;
    }
  }
  return { before: b, after: a };
}
