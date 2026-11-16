import { z } from 'zod';

/**
 * Every editable Founder Portal record type. Each entry whitelists the table, the writable fields
 * (validated with Zod — anything else is rejected), the filters a list may use, and the default order.
 */

const text = (max = 2000) => z.string().trim().max(max);
const optText = (max = 2000) => text(max).nullable().optional();
const name = (max = 200) => z.string().trim().min(1).max(max);
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'date');
const optDate = date.nullable().optional();
const money = z.coerce.number().min(0).max(1e12);
const optMoney = money.nullable().optional();
const pct = z.coerce.number().int().min(0).max(100);
const ref = z.uuid().nullable().optional();
const optEmail = z.union([z.email().max(200), z.literal('')]).nullable().optional();

const categories = ['hardware', 'facility', 'servers', 'apis', 'marketing', 'agencies', 'development', 'salaries', 'reserve', 'operations', 'legal', 'subscriptions', 'services', 'equity', 'loan', 'grant', 'founder', 'other'] as const;
const category = z.enum(categories);

export interface CollectionDef {
  table: string;
  schema: z.ZodObject<z.ZodRawShape>;
  /** Columns a list request may filter on with ?col=value. */
  filters: string[];
  order: { column: string; ascending: boolean };
  /** Column used by the ?q= search. */
  search?: string;
  /** Read/update only (rows are created by the system or seed). */
  noCreate?: boolean;
  /** Human-readable label column for audit summaries. */
  label: string;
}

const def = (d: CollectionDef) => d;

export const COLLECTIONS = {
  projects: def({
    table: 'founder_projects', label: 'name', search: 'name', filters: ['status', 'area'], order: { column: 'created_at', ascending: false },
    schema: z.object({ name: name(), area: text(60).default('other'), status: z.enum(['planned', 'in_progress', 'on_hold', 'done', 'cancelled']).default('planned'), owner: optText(120), start_on: optDate, due_on: optDate, budget: optMoney, progress: pct.default(0), description: optText(4000) }),
  }),
  plans: def({
    table: 'founder_plans', label: 'name', search: 'name', filters: ['kind', 'status'], order: { column: 'created_at', ascending: true },
    schema: z.object({ name: name(), kind: z.enum(['growth', 'strategic', 'technology', 'financial', 'other']).default('strategic'), description: optText(4000), period_start: optDate, period_end: optDate, status: z.enum(['draft', 'active', 'archived']).default('active'), owner: optText(120) }),
  }),
  goals: def({
    table: 'founder_goals', label: 'title', search: 'title', filters: ['plan_id', 'area', 'status', 'period', 'project_id'], order: { column: 'created_at', ascending: true },
    schema: z.object({
      plan_id: ref, title: name(300),
      area: z.enum(['companies', 'revenue', 'customers', 'marketing', 'partnerships', 'hiring', 'markets', 'operations', 'product', 'technology', 'funding', 'other']).default('other'),
      period: z.enum(['monthly', 'quarterly', 'yearly', 'custom']).default('custom'), period_start: optDate, period_end: optDate,
      metric: z.enum(['manual', 'won_companies', 'revenue', 'funding', 'dev_progress', 'leads', 'team_size']).default('manual'),
      target_value: z.coerce.number().min(0).max(1e13).default(0), current_value: z.coerce.number().min(0).max(1e13).default(0), unit: optText(40),
      priority: z.enum(['low', 'medium', 'high', 'urgent']).default('medium'), owner: optText(120), budget: optMoney, project_id: ref,
      status: z.enum(['not_started', 'on_track', 'at_risk', 'off_track', 'achieved', 'cancelled']).default('on_track'), notes: optText(4000),
    }),
  }),
  phases: def({
    table: 'founder_ti_phases', label: 'name', filters: ['status'], order: { column: 'ord', ascending: true },
    schema: z.object({
      ord: z.coerce.number().int().min(1).max(99), code: z.string().regex(/^[a-z0-9_]{1,30}$/), name: name(300), goal: optText(4000),
      status: z.enum(['not_started', 'current', 'completed']).default('not_started'), planned_start: optDate, planned_end: optDate, actual_start: optDate, actual_end: optDate,
      budget_total: optMoney, annual_opex: optMoney, notes: optText(4000),
    }),
  }),
  budgets: def({
    table: 'founder_budgets', label: 'name', search: 'name', filters: ['phase_id', 'category', 'recurring'], order: { column: 'created_at', ascending: true },
    schema: z.object({ name: name(), category: category.default('other'), group_label: optText(120), phase_id: ref, period_start: optDate, period_end: optDate, planned_amount: money.default(0), recurring: z.enum(['once', 'monthly', 'yearly']).default('once'), notes: optText(2000) }),
  }),
  rounds: def({
    table: 'founder_rounds', label: 'name', filters: ['status'], order: { column: 'created_at', ascending: true },
    schema: z.object({ name: name(), target_amount: money.default(0), pre_money_valuation: optMoney, status: z.enum(['planned', 'open', 'closed', 'cancelled']).default('planned'), opened_on: optDate, closed_on: optDate, notes: optText(4000) }),
  }),
  shareholders: def({
    table: 'founder_shareholders', label: 'name', search: 'name', filters: ['kind'], order: { column: 'created_at', ascending: true },
    schema: z.object({ name: name(), kind: z.enum(['founder', 'investor', 'employee_pool', 'advisor', 'other']).default('investor'), shares: z.coerce.number().min(0).max(1e15).default(0), joined_on: optDate, email: optEmail, phone: optText(40), notes: optText(4000) }),
  }),
  team: def({
    table: 'founder_team', label: 'name', search: 'name', filters: ['kind', 'status'], order: { column: 'created_at', ascending: true },
    schema: z.object({ name: name(), role: optText(120), kind: z.enum(['employee', 'contractor', 'agency', 'advisor']).default('employee'), status: z.enum(['planned', 'offer', 'active', 'left']).default('active'), monthly_cost: optMoney, start_on: optDate, end_on: optDate, email: optEmail, phone: optText(40), notes: optText(4000) }),
  }),
  campaigns: def({
    table: 'founder_campaigns', label: 'name', search: 'name', filters: ['status', 'channel'], order: { column: 'created_at', ascending: false },
    schema: z.object({ name: name(), channel: text(60).default('other'), status: z.enum(['planned', 'active', 'paused', 'done', 'cancelled']).default('planned'), start_on: optDate, end_on: optDate, budget: optMoney, leads_generated: z.coerce.number().int().min(0).max(1e9).default(0), agency: optText(200), notes: optText(4000) }),
  }),
  documents: def({
    table: 'founder_documents', label: 'title', search: 'title', filters: ['category'], order: { column: 'created_at', ascending: false },
    schema: z.object({ title: name(300), category: text(60).default('other'), notes: optText(4000) }),
  }),
  deals: def({
    table: 'founder_deals', label: 'company_name', search: 'company_name', filters: ['stage', 'plan_code', 'campaign_id'], order: { column: 'updated_at', ascending: false },
    schema: z.object({
      company_name: name(), contact_name: optText(120), contact_role: optText(120), contact_email: optEmail, contact_phone: optText(40), plan_code: optText(40),
      value: money.default(0), stage: z.enum(['lead', 'contacted', 'meeting', 'proposal', 'negotiation', 'won', 'lost']).default('lead'),
      probability: pct.nullable().optional(), source: optText(120), campaign_id: ref, owner: optText(120), expected_close_on: optDate, next_followup_on: optDate,
      won_on: optDate, lost_reason: optText(1000), contract_document_id: ref, notes: optText(4000),
    }),
  }),
  deal_activities: def({
    table: 'founder_deal_activities', label: 'title', filters: ['deal_id', 'kind'], order: { column: 'due_at', ascending: true },
    schema: z.object({ deal_id: z.uuid(), kind: z.enum(['meeting', 'call', 'email', 'followup', 'note']).default('followup'), title: name(300), due_at: z.iso.datetime({ offset: true }).nullable().optional(), done_at: z.iso.datetime({ offset: true }).nullable().optional(), notes: optText(4000) }),
  }),
  assets: def({
    table: 'founder_ti_assets', label: 'name', search: 'name', filters: ['phase_id', 'budget_id'], order: { column: 'created_at', ascending: true },
    schema: z.object({ phase_id: ref, budget_id: ref, name: name(), spec: optText(500), purpose: optText(500), models: optText(500), quantity: z.coerce.number().int().min(0).max(10000).default(1), unit_cost: optMoney, purchased_qty: z.coerce.number().int().min(0).max(10000).default(0), installed_qty: z.coerce.number().int().min(0).max(10000).default(0), notes: optText(4000) }),
  }),
  models: def({
    table: 'founder_ti_models', label: 'name', search: 'name', filters: ['phase_id', 'status', 'host'], order: { column: 'created_at', ascending: true },
    schema: z.object({ phase_id: ref, name: name(), role: optText(200), host: z.enum(['external_api', 'mac', 'datacenter', 'other']).default('external_api'), status: z.enum(['planned', 'testing', 'in_use', 'retired']).default('planned'), quality_score: z.coerce.number().min(0).max(200).nullable().optional(), last_tested_on: optDate, notes: optText(4000) }),
  }),
  services: def({
    table: 'founder_ti_services', label: 'capability', search: 'capability', filters: ['ownership', 'status', 'target_phase_id'], order: { column: 'created_at', ascending: true },
    schema: z.object({ capability: name(120), provider: name(200), ownership: z.enum(['external', 'owned']).default('external'), status: z.enum(['planned', 'active', 'retired']).default('planned'), target_phase_id: ref, replaced_by: optText(200), monthly_cost: optMoney, weight: z.coerce.number().int().min(1).max(10).default(1), verified: z.boolean().default(false), evidence: optText(2000), notes: optText(2000) }),
  }),
  ti_tasks: def({
    table: 'founder_ti_tasks', label: 'title', search: 'title', filters: ['phase_id', 'kind', 'status'], order: { column: 'ord', ascending: true },
    schema: z.object({ phase_id: z.uuid(), kind: z.enum(['task', 'exit_condition']).default('task'), ord: z.coerce.number().int().min(0).max(10000).default(0), title: name(400), description: optText(4000), status: z.enum(['not_started', 'in_progress', 'blocked', 'done', 'cancelled']).default('not_started'), progress: pct.default(0), due_on: optDate, completed_on: optDate, evidence: optText(4000), evidence_document_id: ref, note: optText(4000), needs_decision: z.boolean().default(false), needs_budget: z.boolean().default(false), budget_amount: optMoney }),
  }),
  releases: def({
    table: 'founder_releases', label: 'version', filters: ['status'], order: { column: 'target_on', ascending: true },
    schema: z.object({ version: name(40), title: optText(200), status: z.enum(['planned', 'in_progress', 'released', 'cancelled']).default('planned'), target_on: optDate, released_on: optDate, notes: optText(4000) }),
  }),
  dev_items: def({
    table: 'founder_dev_items', label: 'title', search: 'title', filters: ['kind', 'status', 'priority', 'release_id', 'project_id', 'roadmap_quarter'], order: { column: 'created_at', ascending: false },
    schema: z.object({ kind: z.enum(['feature', 'task', 'bug', 'infra']).default('task'), title: name(300), description: optText(4000), status: z.enum(['backlog', 'todo', 'in_progress', 'review', 'done', 'cancelled']).default('todo'), priority: z.enum(['low', 'medium', 'high', 'urgent']).default('medium'), severity: z.enum(['low', 'medium', 'high', 'critical']).nullable().optional(), release_id: ref, project_id: ref, roadmap_quarter: z.string().regex(/^\d{4}-Q[1-4]$/).nullable().optional(), progress: pct.default(0), due_on: optDate, completed_on: optDate, estimated_cost: optMoney, owner: optText(120) }),
  }),
  transactions: def({
    table: 'founder_transactions', label: 'description', search: 'description', filters: ['kind', 'category', 'budget_id', 'phase_id', 'asset_id', 'deal_id', 'round_id', 'shareholder_id', 'team_member_id', 'campaign_id', 'project_id', 'source'], order: { column: 'occurred_on', ascending: false },
    schema: z.object({ kind: z.enum(['funding', 'expense', 'revenue']), category: category.default('other'), amount: z.coerce.number().positive().max(1e12), occurred_on: date, description: optText(500), counterparty: optText(200), budget_id: ref, phase_id: ref, deal_id: ref, round_id: ref, shareholder_id: ref, team_member_id: ref, campaign_id: ref, project_id: ref, document_id: ref, notes: optText(4000) }),
  }),
  commitments: def({
    table: 'founder_commitments', label: 'name', search: 'name', filters: ['status', 'category', 'frequency'], order: { column: 'created_at', ascending: true },
    schema: z.object({ name: name(), category: category.default('other'), amount: money, frequency: z.enum(['monthly', 'quarterly', 'yearly', 'once']).default('monthly'), starts_on: optDate, ends_on: optDate, counterparty: optText(200), status: z.enum(['planned', 'active', 'ended']).default('active'), notes: optText(4000) }),
  }),
  risks: def({
    table: 'founder_risks', label: 'title', search: 'title', filters: ['area', 'status', 'phase_id'], order: { column: 'created_at', ascending: true },
    schema: z.object({ area: z.enum(['technology', 'finance', 'sales', 'legal', 'operations', 'market', 'team', 'security', 'other']).default('technology'), title: name(300), description: optText(4000), likelihood: z.coerce.number().int().min(1).max(5).default(3), impact: z.coerce.number().int().min(1).max(5).default(3), status: z.enum(['open', 'mitigating', 'closed']).default('open'), mitigation: optText(4000), owner: optText(120), phase_id: ref, due_on: optDate }),
  }),
  decisions: def({
    table: 'founder_decisions', label: 'title', search: 'title', filters: ['status', 'area'], order: { column: 'created_at', ascending: false },
    schema: z.object({ title: name(300), area: text(60).default('other'), context: optText(4000), decision: optText(4000), alternatives: optText(4000), impact: optText(4000), status: z.enum(['proposed', 'decided', 'reverted']).default('proposed'), decided_on: optDate, due_on: optDate }),
  }),
  legal: def({
    table: 'founder_legal_items', label: 'title', search: 'title', filters: ['kind', 'status'], order: { column: 'created_at', ascending: true },
    schema: z.object({ title: name(300), kind: z.enum(['registration', 'license', 'contract', 'policy', 'compliance', 'privacy', 'ip', 'tax', 'other']).default('compliance'), status: z.enum(['todo', 'in_progress', 'done', 'expired', 'not_applicable']).default('todo'), authority: optText(200), owner: optText(120), due_on: optDate, expires_on: optDate, document_id: ref, notes: optText(4000) }),
  }),
  competitors: def({
    table: 'founder_competitors', label: 'name', search: 'name', filters: ['threat'], order: { column: 'created_at', ascending: true },
    schema: z.object({ name: name(), website: optText(300), country: optText(80), segment: optText(200), pricing: optText(1000), strengths: optText(4000), weaknesses: optText(4000), threat: z.enum(['low', 'medium', 'high']).default('medium'), notes: optText(4000) }),
  }),
  scenarios: def({
    table: 'founder_scenarios', label: 'name', filters: [], order: { column: 'created_at', ascending: false },
    schema: z.object({ name: name(), inputs: z.record(z.string().max(60), z.number().min(0).max(1e13)), notes: optText(2000) }),
  }),
} as const satisfies Record<string, CollectionDef>;

export type CollectionName = keyof typeof COLLECTIONS;

export function isCollection(name: string): name is CollectionName {
  return Object.hasOwn(COLLECTIONS, name);
}
