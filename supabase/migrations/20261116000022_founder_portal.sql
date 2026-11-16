-- NEXUS Platform — 0022: NEXUS Founder Portal (owner request 2026-11-16).
-- The founder's private strategy / finance / sales / technology-independence system.
--
-- Isolation model:
--   * Every founder_* table has RLS enabled AND forced, and all privileges are revoked from anon and
--     authenticated. Browsers can never read or write them, even with a valid company JWT.
--   * The only access path is the NEXUS API (service role) behind the founder guard: valid Supabase
--     session + a row in founder_accounts + MFA (aal2). Founder accounts are created only by SQL /
--     the server-side script scripts/create-founder.mjs — there is no sign-up path.
--   * Founder data has no organization_id and no link to company data.

create table public.founder_accounts (
  user_id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null default 'Founder' check (char_length(display_name) between 1 and 120),
  must_change_password boolean not null default true,
  created_at timestamptz not null default now(),
  password_changed_at timestamptz,
  last_login_at timestamptz,
  last_session_id text
);

-- Append-only log of founder logins and every change made in the portal.
create table public.founder_audit_log (
  id bigint generated always as identity primary key,
  user_id uuid references auth.users (id) on delete set null,
  action text not null check (char_length(action) between 1 and 60),
  entity text,
  entity_id uuid,
  summary text,
  before jsonb,
  after jsonb,
  ip text,
  user_agent text,
  created_at timestamptz not null default now()
);
create index founder_audit_log_created_idx on public.founder_audit_log (created_at desc);
create index founder_audit_log_entity_idx on public.founder_audit_log (entity, entity_id);

create or replace function public.prevent_founder_audit_mutation()
returns trigger
language plpgsql
as $$
begin
  -- The only permitted change: ON DELETE SET NULL of user_id when an auth user is removed.
  if tg_op = 'UPDATE' and new.user_id is null and old.user_id is not null
     and (to_jsonb(new) - 'user_id') = (to_jsonb(old) - 'user_id') then
    return new;
  end if;
  raise exception 'founder_audit_log is append-only';
end;
$$;
create trigger founder_audit_log_no_mutation before update or delete on public.founder_audit_log
  for each row execute function public.prevent_founder_audit_mutation();

-- Key/value settings (launch date, opening cash balance, simulator defaults, …). Nothing is hard-coded.
create table public.founder_settings (
  key text primary key check (key ~ '^[a-z0-9_]{1,60}$'),
  value jsonb not null,
  updated_at timestamptz not null default now()
);

/* ───────────────────────── Strategy: plans, goals, projects ───────────────────────── */

create table public.founder_projects (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 200),
  area text not null default 'other',
  status text not null default 'planned' check (status in ('planned', 'in_progress', 'on_hold', 'done', 'cancelled')),
  owner text,
  start_on date,
  due_on date,
  budget numeric(14, 2) check (budget >= 0),
  progress int not null default 0 check (progress between 0 and 100),
  description text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.founder_plans (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 200),
  kind text not null default 'strategic' check (kind in ('growth', 'strategic', 'technology', 'financial', 'other')),
  description text,
  period_start date,
  period_end date,
  status text not null default 'active' check (status in ('draft', 'active', 'archived')),
  owner text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.founder_goals (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid references public.founder_plans (id) on delete cascade,
  title text not null check (char_length(title) between 1 and 300),
  area text not null default 'other' check (area in ('companies', 'revenue', 'customers', 'marketing', 'partnerships', 'hiring', 'markets', 'operations', 'product', 'technology', 'funding', 'other')),
  period text not null default 'custom' check (period in ('monthly', 'quarterly', 'yearly', 'custom')),
  period_start date,
  period_end date,
  -- How the current value is measured: entered by hand, or computed live from portal data.
  metric text not null default 'manual' check (metric in ('manual', 'won_companies', 'revenue', 'funding', 'dev_progress', 'leads', 'team_size')),
  target_value numeric(16, 2) not null default 0,
  current_value numeric(16, 2) not null default 0,
  unit text,
  priority text not null default 'medium' check (priority in ('low', 'medium', 'high', 'urgent')),
  owner text,
  budget numeric(14, 2) check (budget >= 0),
  project_id uuid references public.founder_projects (id) on delete set null,
  status text not null default 'on_track' check (status in ('not_started', 'on_track', 'at_risk', 'off_track', 'achieved', 'cancelled')),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index founder_goals_plan_idx on public.founder_goals (plan_id);

/* ───────────────────────── Technology independence ───────────────────────── */

create table public.founder_ti_phases (
  id uuid primary key default gen_random_uuid(),
  ord int not null unique,
  code text not null unique check (code ~ '^[a-z0-9_]{1,30}$'),
  name text not null,
  goal text,
  status text not null default 'not_started' check (status in ('not_started', 'current', 'completed')),
  planned_start date,
  planned_end date,
  actual_start date,
  actual_end date,
  budget_total numeric(14, 2) check (budget_total >= 0),
  annual_opex numeric(14, 2) check (annual_opex >= 0),
  notes text,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- At most one phase is "current".
create unique index founder_ti_phases_one_current on public.founder_ti_phases ((status)) where status = 'current';

/* ───────────────────────── Finance ───────────────────────── */

create table public.founder_budgets (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 200),
  category text not null default 'other',
  -- Optional grouping inside a phase, e.g. "A. أجهزة الذكاء الاصطناعي".
  group_label text,
  phase_id uuid references public.founder_ti_phases (id) on delete set null,
  period_start date,
  period_end date,
  planned_amount numeric(14, 2) not null default 0 check (planned_amount >= 0),
  recurring text not null default 'once' check (recurring in ('once', 'monthly', 'yearly')),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index founder_budgets_phase_idx on public.founder_budgets (phase_id);

create table public.founder_rounds (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 200),
  target_amount numeric(14, 2) not null default 0 check (target_amount >= 0),
  pre_money_valuation numeric(16, 2) check (pre_money_valuation >= 0),
  status text not null default 'planned' check (status in ('planned', 'open', 'closed', 'cancelled')),
  opened_on date,
  closed_on date,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.founder_shareholders (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 200),
  kind text not null default 'investor' check (kind in ('founder', 'investor', 'employee_pool', 'advisor', 'other')),
  shares numeric(18, 4) not null default 0 check (shares >= 0),
  joined_on date,
  email text,
  phone text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.founder_team (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 200),
  role text,
  kind text not null default 'employee' check (kind in ('employee', 'contractor', 'agency', 'advisor')),
  status text not null default 'active' check (status in ('planned', 'offer', 'active', 'left')),
  monthly_cost numeric(14, 2) check (monthly_cost >= 0),
  start_on date,
  end_on date,
  email text,
  phone text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.founder_campaigns (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 200),
  channel text not null default 'other',
  status text not null default 'planned' check (status in ('planned', 'active', 'paused', 'done', 'cancelled')),
  start_on date,
  end_on date,
  budget numeric(14, 2) check (budget >= 0),
  leads_generated int not null default 0 check (leads_generated >= 0),
  agency text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.founder_documents (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(title) between 1 and 300),
  category text not null default 'other',
  storage_path text unique,
  mime_type text,
  size_bytes bigint check (size_bytes >= 0),
  uploaded boolean not null default false,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

/* ───────────────────────── Sales & CRM ───────────────────────── */

create table public.founder_deals (
  id uuid primary key default gen_random_uuid(),
  company_name text not null check (char_length(company_name) between 1 and 200),
  contact_name text,
  contact_role text,
  contact_email text,
  contact_phone text,
  plan_code text,
  value numeric(14, 2) not null default 0 check (value >= 0),
  stage text not null default 'lead' check (stage in ('lead', 'contacted', 'meeting', 'proposal', 'negotiation', 'won', 'lost')),
  probability int check (probability between 0 and 100),
  source text,
  campaign_id uuid references public.founder_campaigns (id) on delete set null,
  owner text,
  expected_close_on date,
  next_followup_on date,
  won_on date,
  lost_reason text,
  contract_document_id uuid references public.founder_documents (id) on delete set null,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index founder_deals_stage_idx on public.founder_deals (stage);

create table public.founder_deal_activities (
  id uuid primary key default gen_random_uuid(),
  deal_id uuid not null references public.founder_deals (id) on delete cascade,
  kind text not null default 'followup' check (kind in ('meeting', 'call', 'email', 'followup', 'note')),
  title text not null check (char_length(title) between 1 and 300),
  due_at timestamptz,
  done_at timestamptz,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index founder_deal_activities_deal_idx on public.founder_deal_activities (deal_id);

/* ───────────────────────── Technology independence (cont.) ───────────────────────── */

create table public.founder_ti_assets (
  id uuid primary key default gen_random_uuid(),
  phase_id uuid references public.founder_ti_phases (id) on delete cascade,
  budget_id uuid references public.founder_budgets (id) on delete set null,
  name text not null check (char_length(name) between 1 and 200),
  spec text,
  purpose text,
  models text,
  quantity int not null default 1 check (quantity >= 0),
  unit_cost numeric(14, 2) check (unit_cost >= 0),
  purchased_qty int not null default 0 check (purchased_qty >= 0),
  installed_qty int not null default 0 check (installed_qty >= 0),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (installed_qty <= purchased_qty)
);

create table public.founder_ti_models (
  id uuid primary key default gen_random_uuid(),
  phase_id uuid references public.founder_ti_phases (id) on delete set null,
  name text not null check (char_length(name) between 1 and 200),
  role text,
  host text not null default 'external_api' check (host in ('external_api', 'mac', 'datacenter', 'other')),
  status text not null default 'planned' check (status in ('planned', 'testing', 'in_use', 'retired')),
  -- Measured quality relative to the current reference model (Sonnet = 100).
  quality_score numeric(5, 1) check (quality_score between 0 and 200),
  last_tested_on date,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Each capability NEXUS needs, who provides it today and who should provide it later.
create table public.founder_ti_services (
  id uuid primary key default gen_random_uuid(),
  capability text not null check (char_length(capability) between 1 and 120),
  provider text not null,
  ownership text not null default 'external' check (ownership in ('external', 'owned')),
  status text not null default 'planned' check (status in ('planned', 'active', 'retired')),
  target_phase_id uuid references public.founder_ti_phases (id) on delete set null,
  replaced_by text,
  monthly_cost numeric(14, 2) check (monthly_cost >= 0),
  weight int not null default 1 check (weight between 1 and 10),
  -- true only when the status was confirmed from the real project / by the founder.
  verified boolean not null default false,
  evidence text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.founder_ti_tasks (
  id uuid primary key default gen_random_uuid(),
  phase_id uuid not null references public.founder_ti_phases (id) on delete cascade,
  kind text not null default 'task' check (kind in ('task', 'exit_condition')),
  ord int not null default 0,
  title text not null check (char_length(title) between 1 and 400),
  description text,
  status text not null default 'not_started' check (status in ('not_started', 'in_progress', 'blocked', 'done', 'cancelled')),
  progress int not null default 0 check (progress between 0 and 100),
  due_on date,
  completed_on date,
  evidence text,
  evidence_document_id uuid references public.founder_documents (id) on delete set null,
  note text,
  needs_decision boolean not null default false,
  needs_budget boolean not null default false,
  budget_amount numeric(14, 2) check (budget_amount >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index founder_ti_tasks_phase_idx on public.founder_ti_tasks (phase_id, kind, ord);

/* ───────────────────────── Development center ───────────────────────── */

create table public.founder_releases (
  id uuid primary key default gen_random_uuid(),
  version text not null unique check (char_length(version) between 1 and 40),
  title text,
  status text not null default 'planned' check (status in ('planned', 'in_progress', 'released', 'cancelled')),
  target_on date,
  released_on date,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.founder_dev_items (
  id uuid primary key default gen_random_uuid(),
  kind text not null default 'task' check (kind in ('feature', 'task', 'bug', 'infra')),
  title text not null check (char_length(title) between 1 and 300),
  description text,
  status text not null default 'todo' check (status in ('backlog', 'todo', 'in_progress', 'review', 'done', 'cancelled')),
  priority text not null default 'medium' check (priority in ('low', 'medium', 'high', 'urgent')),
  severity text check (severity in ('low', 'medium', 'high', 'critical')),
  release_id uuid references public.founder_releases (id) on delete set null,
  project_id uuid references public.founder_projects (id) on delete set null,
  roadmap_quarter text check (roadmap_quarter ~ '^\d{4}-Q[1-4]$'),
  progress int not null default 0 check (progress between 0 and 100),
  due_on date,
  completed_on date,
  estimated_cost numeric(14, 2) check (estimated_cost >= 0),
  owner text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index founder_dev_items_status_idx on public.founder_dev_items (status);

/* ───────────────────────── Money movements (links everything) ───────────────────────── */

create table public.founder_transactions (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('funding', 'expense', 'revenue')),
  category text not null default 'other',
  amount numeric(14, 2) not null check (amount > 0),
  -- Units bought, for hardware purchases (kept so deleting the expense can undo the purchase).
  quantity int check (quantity > 0),
  occurred_on date not null default current_date,
  description text,
  counterparty text,
  budget_id uuid references public.founder_budgets (id) on delete set null,
  phase_id uuid references public.founder_ti_phases (id) on delete set null,
  asset_id uuid references public.founder_ti_assets (id) on delete set null,
  deal_id uuid references public.founder_deals (id) on delete set null,
  round_id uuid references public.founder_rounds (id) on delete set null,
  shareholder_id uuid references public.founder_shareholders (id) on delete set null,
  team_member_id uuid references public.founder_team (id) on delete set null,
  campaign_id uuid references public.founder_campaigns (id) on delete set null,
  project_id uuid references public.founder_projects (id) on delete set null,
  -- 'manual', or created automatically by a linked action (e.g. a deal marked Won).
  source text not null default 'manual' check (source in ('manual', 'deal_won', 'asset_purchase')),
  document_id uuid references public.founder_documents (id) on delete set null,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index founder_transactions_kind_idx on public.founder_transactions (kind, occurred_on desc);
create index founder_transactions_budget_idx on public.founder_transactions (budget_id);
create index founder_transactions_phase_idx on public.founder_transactions (phase_id);
create unique index founder_transactions_one_per_won_deal on public.founder_transactions (deal_id) where source = 'deal_won';

create table public.founder_commitments (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 200),
  category text not null default 'other',
  amount numeric(14, 2) not null check (amount >= 0),
  frequency text not null default 'monthly' check (frequency in ('monthly', 'quarterly', 'yearly', 'once')),
  starts_on date,
  ends_on date,
  counterparty text,
  status text not null default 'active' check (status in ('planned', 'active', 'ended')),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

/* ───────────────────────── Governance ───────────────────────── */

create table public.founder_risks (
  id uuid primary key default gen_random_uuid(),
  area text not null default 'technology' check (area in ('technology', 'finance', 'sales', 'legal', 'operations', 'market', 'team', 'security', 'other')),
  title text not null check (char_length(title) between 1 and 300),
  description text,
  likelihood int not null default 3 check (likelihood between 1 and 5),
  impact int not null default 3 check (impact between 1 and 5),
  status text not null default 'open' check (status in ('open', 'mitigating', 'closed')),
  mitigation text,
  owner text,
  phase_id uuid references public.founder_ti_phases (id) on delete set null,
  due_on date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.founder_decisions (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(title) between 1 and 300),
  area text not null default 'other',
  context text,
  decision text,
  alternatives text,
  impact text,
  status text not null default 'proposed' check (status in ('proposed', 'decided', 'reverted')),
  decided_on date,
  due_on date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.founder_legal_items (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(title) between 1 and 300),
  kind text not null default 'compliance' check (kind in ('registration', 'license', 'contract', 'policy', 'compliance', 'privacy', 'ip', 'tax', 'other')),
  status text not null default 'todo' check (status in ('todo', 'in_progress', 'done', 'expired', 'not_applicable')),
  authority text,
  owner text,
  due_on date,
  expires_on date,
  document_id uuid references public.founder_documents (id) on delete set null,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.founder_competitors (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 200),
  website text,
  country text,
  segment text,
  pricing text,
  strengths text,
  weaknesses text,
  threat text not null default 'medium' check (threat in ('low', 'medium', 'high')),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Saved Technology Cost Simulator scenarios.
create table public.founder_scenarios (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 200),
  inputs jsonb not null,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

/* ───────────────────────── updated_at + lockdown ───────────────────────── */

do $$
declare t text;
begin
  foreach t in array array[
    'founder_projects', 'founder_plans', 'founder_goals', 'founder_ti_phases', 'founder_budgets', 'founder_rounds',
    'founder_shareholders', 'founder_team', 'founder_campaigns', 'founder_documents', 'founder_deals', 'founder_deal_activities',
    'founder_ti_assets', 'founder_ti_models', 'founder_ti_services', 'founder_ti_tasks', 'founder_releases', 'founder_dev_items',
    'founder_transactions', 'founder_commitments', 'founder_risks', 'founder_decisions', 'founder_legal_items',
    'founder_competitors', 'founder_scenarios'
  ] loop
    execute format('create trigger %I before update on public.%I for each row execute function public.set_updated_at()', t || '_updated_at', t);
  end loop;

  foreach t in array array[
    'founder_accounts', 'founder_audit_log', 'founder_settings',
    'founder_projects', 'founder_plans', 'founder_goals', 'founder_ti_phases', 'founder_budgets', 'founder_rounds',
    'founder_shareholders', 'founder_team', 'founder_campaigns', 'founder_documents', 'founder_deals', 'founder_deal_activities',
    'founder_ti_assets', 'founder_ti_models', 'founder_ti_services', 'founder_ti_tasks', 'founder_releases', 'founder_dev_items',
    'founder_transactions', 'founder_commitments', 'founder_risks', 'founder_decisions', 'founder_legal_items',
    'founder_competitors', 'founder_scenarios'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
  end loop;
end;
$$;

-- Private bucket for founder documents (contracts, receipts, proofs). No storage policies are created,
-- so only the service role (API, behind the founder guard) can read or write it, via signed URLs.
insert into storage.buckets (id, name, public, file_size_limit)
values ('founder-documents', 'founder-documents', false, 52428800)
on conflict (id) do update set public = false;
