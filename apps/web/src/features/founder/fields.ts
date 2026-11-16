/**
 * Field definitions for every Founder Portal record type: drives the tables, the filters,
 * the edit dialogs and the exports. Keys match the API whitelist (collections.ts).
 */
export type FieldType = 'text' | 'textarea' | 'number' | 'money' | 'date' | 'datetime' | 'select' | 'bool' | 'ref' | 'percent';

export interface Field {
  key: string;
  type: FieldType;
  /** i18n group under founder.opt.* for select values. */
  options?: string[];
  optGroup?: string;
  /** Collection whose rows a ref points to, and which column labels them. */
  ref?: { col: string; label: string };
  required?: boolean;
  /** Shown as a table column. */
  table?: boolean;
  /** Offered as a list filter. */
  filter?: boolean;
  default?: unknown;
  /** Only editable at creation. */
  createOnly?: boolean;
  readOnly?: boolean;
  wide?: boolean;
}

const STATUS_PROJECT = ['planned', 'in_progress', 'on_hold', 'done', 'cancelled'];
const PRIORITY = ['low', 'medium', 'high', 'urgent'];
const CATEGORY = ['hardware', 'facility', 'servers', 'apis', 'marketing', 'agencies', 'development', 'salaries', 'reserve', 'operations', 'legal', 'subscriptions', 'services', 'equity', 'loan', 'grant', 'founder', 'other'];
const AREAS = ['companies', 'revenue', 'customers', 'marketing', 'partnerships', 'hiring', 'markets', 'operations', 'product', 'technology', 'funding', 'other'];
const RISK_AREAS = ['technology', 'finance', 'sales', 'legal', 'operations', 'market', 'team', 'security', 'other'];

const phaseRef = { col: 'phases', label: 'name' };

export const FIELDS: Record<string, Field[]> = {
  projects: [
    { key: 'name', type: 'text', required: true, table: true, wide: true },
    { key: 'status', type: 'select', options: STATUS_PROJECT, optGroup: 'status', table: true, filter: true, default: 'planned' },
    { key: 'area', type: 'select', options: AREAS, optGroup: 'area', table: true, filter: true, default: 'other' },
    { key: 'owner', type: 'text', table: true },
    { key: 'start_on', type: 'date' }, { key: 'due_on', type: 'date', table: true },
    { key: 'budget', type: 'money', table: true }, { key: 'progress', type: 'percent', table: true, default: 0 },
    { key: 'description', type: 'textarea', wide: true },
  ],
  plans: [
    { key: 'name', type: 'text', required: true, table: true, wide: true },
    { key: 'kind', type: 'select', options: ['growth', 'strategic', 'technology', 'financial', 'other'], optGroup: 'plan_kind', table: true, filter: true, default: 'strategic' },
    { key: 'status', type: 'select', options: ['draft', 'active', 'archived'], optGroup: 'status', table: true, filter: true, default: 'active' },
    { key: 'period_start', type: 'date', table: true }, { key: 'period_end', type: 'date', table: true }, { key: 'owner', type: 'text' },
    { key: 'description', type: 'textarea', wide: true },
  ],
  goals: [
    { key: 'title', type: 'text', required: true, table: true, wide: true },
    { key: 'plan_id', type: 'ref', ref: { col: 'plans', label: 'name' }, table: true, filter: true },
    { key: 'area', type: 'select', options: AREAS, optGroup: 'area', table: true, filter: true, default: 'other' },
    { key: 'period', type: 'select', options: ['monthly', 'quarterly', 'yearly', 'custom'], optGroup: 'period', filter: true, default: 'custom' },
    { key: 'period_start', type: 'date' }, { key: 'period_end', type: 'date', table: true },
    { key: 'metric', type: 'select', options: ['manual', 'won_companies', 'revenue', 'funding', 'dev_progress', 'leads', 'team_size'], optGroup: 'metric', default: 'manual' },
    { key: 'target_value', type: 'number', table: true, default: 0 }, { key: 'current_value', type: 'number', table: true, default: 0 }, { key: 'unit', type: 'text' },
    { key: 'priority', type: 'select', options: PRIORITY, optGroup: 'priority', default: 'medium' },
    { key: 'status', type: 'select', options: ['not_started', 'on_track', 'at_risk', 'off_track', 'achieved', 'cancelled'], optGroup: 'status', table: true, filter: true, default: 'on_track' },
    { key: 'owner', type: 'text' }, { key: 'budget', type: 'money' }, { key: 'project_id', type: 'ref', ref: { col: 'projects', label: 'name' } },
    { key: 'notes', type: 'textarea', wide: true },
  ],
  phases: [
    { key: 'ord', type: 'number', required: true, table: true, createOnly: true }, { key: 'code', type: 'text', required: true, createOnly: true },
    { key: 'name', type: 'text', required: true, table: true, wide: true },
    { key: 'status', type: 'select', options: ['not_started', 'current', 'completed'], optGroup: 'status', table: true, default: 'not_started' },
    { key: 'goal', type: 'textarea', wide: true },
    { key: 'planned_start', type: 'date' }, { key: 'planned_end', type: 'date' }, { key: 'actual_start', type: 'date' }, { key: 'actual_end', type: 'date' },
    { key: 'budget_total', type: 'money', table: true }, { key: 'annual_opex', type: 'money', table: true }, { key: 'notes', type: 'textarea', wide: true },
  ],
  budgets: [
    { key: 'name', type: 'text', required: true, table: true, wide: true },
    { key: 'group_label', type: 'text', table: true },
    { key: 'category', type: 'select', options: CATEGORY, optGroup: 'category', table: true, filter: true, default: 'other' },
    { key: 'phase_id', type: 'ref', ref: phaseRef, table: true, filter: true },
    { key: 'planned_amount', type: 'money', required: true, table: true, default: 0 },
    { key: 'recurring', type: 'select', options: ['once', 'monthly', 'yearly'], optGroup: 'recurring', table: true, default: 'once' },
    { key: 'period_start', type: 'date' }, { key: 'period_end', type: 'date' }, { key: 'notes', type: 'textarea', wide: true },
  ],
  transactions: [
    { key: 'occurred_on', type: 'date', required: true, table: true, default: '__today' },
    { key: 'kind', type: 'select', options: ['funding', 'expense', 'revenue'], optGroup: 'tx_kind', required: true, table: true, filter: true, default: 'expense' },
    { key: 'category', type: 'select', options: CATEGORY, optGroup: 'category', table: true, filter: true, default: 'other' },
    { key: 'amount', type: 'money', required: true, table: true },
    { key: 'description', type: 'text', table: true, wide: true }, { key: 'counterparty', type: 'text', table: true },
    { key: 'budget_id', type: 'ref', ref: { col: 'budgets', label: 'name' }, filter: true },
    { key: 'phase_id', type: 'ref', ref: phaseRef, filter: true },
    { key: 'deal_id', type: 'ref', ref: { col: 'deals', label: 'company_name' } },
    { key: 'round_id', type: 'ref', ref: { col: 'rounds', label: 'name' } },
    { key: 'shareholder_id', type: 'ref', ref: { col: 'shareholders', label: 'name' } },
    { key: 'team_member_id', type: 'ref', ref: { col: 'team', label: 'name' } },
    { key: 'campaign_id', type: 'ref', ref: { col: 'campaigns', label: 'name' } },
    { key: 'project_id', type: 'ref', ref: { col: 'projects', label: 'name' } },
    { key: 'document_id', type: 'ref', ref: { col: 'documents', label: 'title' } },
    { key: 'source', type: 'select', options: ['manual', 'deal_won', 'asset_purchase'], optGroup: 'source', table: true, filter: true, readOnly: true },
    { key: 'notes', type: 'textarea', wide: true },
  ],
  commitments: [
    { key: 'name', type: 'text', required: true, table: true, wide: true },
    { key: 'category', type: 'select', options: CATEGORY, optGroup: 'category', table: true, default: 'other' },
    { key: 'amount', type: 'money', required: true, table: true },
    { key: 'frequency', type: 'select', options: ['monthly', 'quarterly', 'yearly', 'once'], optGroup: 'frequency', table: true, default: 'monthly' },
    { key: 'status', type: 'select', options: ['planned', 'active', 'ended'], optGroup: 'status', table: true, filter: true, default: 'active' },
    { key: 'starts_on', type: 'date' }, { key: 'ends_on', type: 'date' }, { key: 'counterparty', type: 'text', table: true }, { key: 'notes', type: 'textarea', wide: true },
  ],
  deals: [
    { key: 'company_name', type: 'text', required: true, table: true, wide: true },
    { key: 'stage', type: 'select', options: ['lead', 'contacted', 'meeting', 'proposal', 'negotiation', 'won', 'lost'], optGroup: 'stage', table: true, filter: true, default: 'lead' },
    { key: 'value', type: 'money', table: true, default: 0 }, { key: 'probability', type: 'percent' }, { key: 'plan_code', type: 'text', table: true },
    { key: 'contact_name', type: 'text', table: true }, { key: 'contact_role', type: 'text' }, { key: 'contact_email', type: 'text' }, { key: 'contact_phone', type: 'text' },
    { key: 'source', type: 'text' }, { key: 'campaign_id', type: 'ref', ref: { col: 'campaigns', label: 'name' }, filter: true }, { key: 'owner', type: 'text' },
    { key: 'expected_close_on', type: 'date' }, { key: 'next_followup_on', type: 'date', table: true }, { key: 'won_on', type: 'date' }, { key: 'lost_reason', type: 'text' },
    { key: 'contract_document_id', type: 'ref', ref: { col: 'documents', label: 'title' } }, { key: 'notes', type: 'textarea', wide: true },
  ],
  deal_activities: [
    { key: 'deal_id', type: 'ref', ref: { col: 'deals', label: 'company_name' }, required: true, table: true, filter: true },
    { key: 'kind', type: 'select', options: ['meeting', 'call', 'email', 'followup', 'note'], optGroup: 'activity', table: true, filter: true, default: 'followup' },
    { key: 'title', type: 'text', required: true, table: true, wide: true },
    { key: 'due_at', type: 'datetime', table: true }, { key: 'done_at', type: 'datetime', table: true }, { key: 'notes', type: 'textarea', wide: true },
  ],
  assets: [
    { key: 'name', type: 'text', required: true, table: true, wide: true }, { key: 'phase_id', type: 'ref', ref: phaseRef, table: true, filter: true },
    { key: 'spec', type: 'text', wide: true }, { key: 'purpose', type: 'text' }, { key: 'models', type: 'text' },
    { key: 'quantity', type: 'number', table: true, default: 1 }, { key: 'unit_cost', type: 'money', table: true },
    { key: 'purchased_qty', type: 'number', table: true, default: 0 }, { key: 'installed_qty', type: 'number', table: true, default: 0 },
    { key: 'budget_id', type: 'ref', ref: { col: 'budgets', label: 'name' } }, { key: 'notes', type: 'textarea', wide: true },
  ],
  models: [
    { key: 'name', type: 'text', required: true, table: true, wide: true }, { key: 'role', type: 'text', table: true },
    { key: 'phase_id', type: 'ref', ref: phaseRef, table: true, filter: true },
    { key: 'host', type: 'select', options: ['external_api', 'mac', 'datacenter', 'other'], optGroup: 'host', table: true, default: 'external_api' },
    { key: 'status', type: 'select', options: ['planned', 'testing', 'in_use', 'retired'], optGroup: 'status', table: true, filter: true, default: 'planned' },
    { key: 'quality_score', type: 'number', table: true }, { key: 'last_tested_on', type: 'date', table: true }, { key: 'notes', type: 'textarea', wide: true },
  ],
  services: [
    { key: 'capability', type: 'text', required: true, table: true }, { key: 'provider', type: 'text', required: true, table: true, wide: true },
    { key: 'ownership', type: 'select', options: ['external', 'owned'], optGroup: 'ownership', table: true, filter: true, default: 'external' },
    { key: 'status', type: 'select', options: ['planned', 'active', 'retired'], optGroup: 'svc_status', table: true, filter: true, default: 'planned' },
    { key: 'target_phase_id', type: 'ref', ref: phaseRef, table: true }, { key: 'replaced_by', type: 'text' }, { key: 'monthly_cost', type: 'money' },
    { key: 'weight', type: 'number', default: 1 }, { key: 'verified', type: 'bool', table: true, default: false }, { key: 'evidence', type: 'textarea', wide: true }, { key: 'notes', type: 'textarea', wide: true },
  ],
  ti_tasks: [
    { key: 'title', type: 'text', required: true, table: true, wide: true }, { key: 'phase_id', type: 'ref', ref: phaseRef, required: true, table: true, filter: true },
    { key: 'kind', type: 'select', options: ['task', 'exit_condition'], optGroup: 'ti_kind', table: true, filter: true, default: 'task' }, { key: 'ord', type: 'number', default: 0 },
    { key: 'status', type: 'select', options: ['not_started', 'in_progress', 'blocked', 'done', 'cancelled'], optGroup: 'status', table: true, filter: true, default: 'not_started' },
    { key: 'progress', type: 'percent', table: true, default: 0 }, { key: 'due_on', type: 'date', table: true }, { key: 'completed_on', type: 'date' },
    { key: 'evidence', type: 'textarea', wide: true }, { key: 'evidence_document_id', type: 'ref', ref: { col: 'documents', label: 'title' } }, { key: 'note', type: 'textarea', wide: true },
    { key: 'needs_decision', type: 'bool', default: false }, { key: 'needs_budget', type: 'bool', default: false }, { key: 'budget_amount', type: 'money' }, { key: 'description', type: 'textarea', wide: true },
  ],
  releases: [
    { key: 'version', type: 'text', required: true, table: true }, { key: 'title', type: 'text', table: true, wide: true },
    { key: 'status', type: 'select', options: ['planned', 'in_progress', 'released', 'cancelled'], optGroup: 'status', table: true, filter: true, default: 'planned' },
    { key: 'target_on', type: 'date', table: true }, { key: 'released_on', type: 'date', table: true }, { key: 'notes', type: 'textarea', wide: true },
  ],
  dev_items: [
    { key: 'title', type: 'text', required: true, table: true, wide: true },
    { key: 'kind', type: 'select', options: ['feature', 'task', 'bug', 'infra'], optGroup: 'dev_kind', table: true, filter: true, default: 'task' },
    { key: 'status', type: 'select', options: ['backlog', 'todo', 'in_progress', 'review', 'done', 'cancelled'], optGroup: 'status', table: true, filter: true, default: 'todo' },
    { key: 'priority', type: 'select', options: PRIORITY, optGroup: 'priority', table: true, filter: true, default: 'medium' },
    { key: 'severity', type: 'select', options: ['low', 'medium', 'high', 'critical'], optGroup: 'severity' },
    { key: 'release_id', type: 'ref', ref: { col: 'releases', label: 'version' }, table: true, filter: true },
    { key: 'project_id', type: 'ref', ref: { col: 'projects', label: 'name' } }, { key: 'roadmap_quarter', type: 'text', filter: true },
    { key: 'progress', type: 'percent', table: true, default: 0 }, { key: 'due_on', type: 'date', table: true }, { key: 'completed_on', type: 'date' },
    { key: 'estimated_cost', type: 'money' }, { key: 'owner', type: 'text' }, { key: 'description', type: 'textarea', wide: true },
  ],
  rounds: [
    { key: 'name', type: 'text', required: true, table: true, wide: true }, { key: 'target_amount', type: 'money', table: true, default: 0 }, { key: 'pre_money_valuation', type: 'money', table: true },
    { key: 'status', type: 'select', options: ['planned', 'open', 'closed', 'cancelled'], optGroup: 'status', table: true, default: 'planned' },
    { key: 'opened_on', type: 'date' }, { key: 'closed_on', type: 'date' }, { key: 'notes', type: 'textarea', wide: true },
  ],
  shareholders: [
    { key: 'name', type: 'text', required: true, table: true, wide: true },
    { key: 'kind', type: 'select', options: ['founder', 'investor', 'employee_pool', 'advisor', 'other'], optGroup: 'sh_kind', table: true, default: 'investor' },
    { key: 'shares', type: 'number', table: true, default: 0 }, { key: 'joined_on', type: 'date', table: true }, { key: 'email', type: 'text' }, { key: 'phone', type: 'text' }, { key: 'notes', type: 'textarea', wide: true },
  ],
  team: [
    { key: 'name', type: 'text', required: true, table: true, wide: true }, { key: 'role', type: 'text', table: true },
    { key: 'kind', type: 'select', options: ['employee', 'contractor', 'agency', 'advisor'], optGroup: 'team_kind', table: true, filter: true, default: 'employee' },
    { key: 'status', type: 'select', options: ['planned', 'offer', 'active', 'left'], optGroup: 'status', table: true, filter: true, default: 'active' },
    { key: 'monthly_cost', type: 'money', table: true }, { key: 'start_on', type: 'date', table: true }, { key: 'end_on', type: 'date' }, { key: 'email', type: 'text' }, { key: 'phone', type: 'text' }, { key: 'notes', type: 'textarea', wide: true },
  ],
  campaigns: [
    { key: 'name', type: 'text', required: true, table: true, wide: true }, { key: 'channel', type: 'text', table: true },
    { key: 'status', type: 'select', options: ['planned', 'active', 'paused', 'done', 'cancelled'], optGroup: 'status', table: true, filter: true, default: 'planned' },
    { key: 'start_on', type: 'date', table: true }, { key: 'end_on', type: 'date' }, { key: 'budget', type: 'money', table: true }, { key: 'leads_generated', type: 'number', table: true, default: 0 },
    { key: 'agency', type: 'text' }, { key: 'notes', type: 'textarea', wide: true },
  ],
  risks: [
    { key: 'title', type: 'text', required: true, table: true, wide: true },
    { key: 'area', type: 'select', options: RISK_AREAS, optGroup: 'area', table: true, filter: true, default: 'technology' },
    { key: 'likelihood', type: 'number', table: true, default: 3 }, { key: 'impact', type: 'number', table: true, default: 3 },
    { key: 'status', type: 'select', options: ['open', 'mitigating', 'closed'], optGroup: 'status', table: true, filter: true, default: 'open' },
    { key: 'phase_id', type: 'ref', ref: phaseRef }, { key: 'owner', type: 'text' }, { key: 'due_on', type: 'date' },
    { key: 'description', type: 'textarea', wide: true }, { key: 'mitigation', type: 'textarea', wide: true },
  ],
  decisions: [
    { key: 'title', type: 'text', required: true, table: true, wide: true }, { key: 'area', type: 'select', options: [...AREAS], optGroup: 'area', table: true, filter: true, default: 'other' },
    { key: 'status', type: 'select', options: ['proposed', 'decided', 'reverted'], optGroup: 'status', table: true, filter: true, default: 'proposed' },
    { key: 'decided_on', type: 'date', table: true }, { key: 'due_on', type: 'date' },
    { key: 'context', type: 'textarea', wide: true }, { key: 'decision', type: 'textarea', wide: true }, { key: 'alternatives', type: 'textarea', wide: true }, { key: 'impact', type: 'textarea', wide: true },
  ],
  legal: [
    { key: 'title', type: 'text', required: true, table: true, wide: true },
    { key: 'kind', type: 'select', options: ['registration', 'license', 'contract', 'policy', 'compliance', 'privacy', 'ip', 'tax', 'other'], optGroup: 'legal_kind', table: true, filter: true, default: 'compliance' },
    { key: 'status', type: 'select', options: ['todo', 'in_progress', 'done', 'expired', 'not_applicable'], optGroup: 'status', table: true, filter: true, default: 'todo' },
    { key: 'authority', type: 'text', table: true }, { key: 'owner', type: 'text' }, { key: 'due_on', type: 'date', table: true }, { key: 'expires_on', type: 'date', table: true },
    { key: 'document_id', type: 'ref', ref: { col: 'documents', label: 'title' } }, { key: 'notes', type: 'textarea', wide: true },
  ],
  competitors: [
    { key: 'name', type: 'text', required: true, table: true }, { key: 'website', type: 'text', table: true }, { key: 'country', type: 'text', table: true }, { key: 'segment', type: 'text', table: true },
    { key: 'threat', type: 'select', options: ['low', 'medium', 'high'], optGroup: 'threat', table: true, filter: true, default: 'medium' },
    { key: 'pricing', type: 'textarea', wide: true }, { key: 'strengths', type: 'textarea', wide: true }, { key: 'weaknesses', type: 'textarea', wide: true }, { key: 'notes', type: 'textarea', wide: true },
  ],
  documents: [
    { key: 'title', type: 'text', required: true, table: true, wide: true }, { key: 'category', type: 'text', table: true, filter: true },
    { key: 'size_bytes', type: 'number', table: true, readOnly: true }, { key: 'created_at', type: 'datetime', table: true, readOnly: true }, { key: 'notes', type: 'textarea', wide: true },
  ],
};
