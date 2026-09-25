-- NEXUS Platform — 0005: plans, subscriptions, payments (Moyasar), usage, enterprise, email outbox

create table public.subscription_plans (
  code text primary key,
  name_ar text not null,
  name_en text not null,
  -- Trusted server-side price in halalas. NULL = custom (enterprise).
  price_halalas bigint check (price_halalas is null or price_halalas > 0),
  currency text not null default 'SAR' check (currency = 'SAR'),
  billing_interval text not null default 'yearly' check (billing_interval = 'yearly'),
  is_popular boolean not null default false,
  is_custom boolean not null default false,
  is_public boolean not null default true,
  entitlements jsonb not null,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger subscription_plans_updated_at before update on public.subscription_plans for each row execute function public.set_updated_at();

-- One subscription row per organization; renewals extend ends_at in place, history lives in billing_events.
create table public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null unique references public.organizations (id) on delete cascade,
  plan_code text not null references public.subscription_plans (code),
  status public.subscription_status not null default 'pending',
  billing_interval text not null default 'yearly' check (billing_interval = 'yearly'),
  started_at timestamptz,
  current_period_start timestamptz,
  ends_at timestamptz,
  -- Enterprise overrides (merged over plan entitlements).
  custom_entitlements jsonb,
  expiring_notified_at timestamptz,
  expired_notified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (status <> 'active' or (ends_at is not null and started_at is not null))
);
create index subscriptions_ends_idx on public.subscriptions (status, ends_at);
create trigger subscriptions_updated_at before update on public.subscriptions for each row execute function public.set_updated_at();

create table public.enterprise_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users (id) on delete set null,
  organization_id uuid references public.organizations (id) on delete set null,
  company_name text not null,
  commercial_registration text not null check (commercial_registration ~ '^[1-7][0-9]{9}$'),
  website text,
  contact_name text not null,
  work_email text not null,
  company_size text not null,
  industry text not null,
  expected_human_members int not null,
  expected_ai_employees int not null,
  expected_ai_usage text not null default '',
  expected_computer_usage text not null default '',
  expected_storage text not null default '',
  requirements text not null default '',
  customer_note text not null default '',
  status public.enterprise_request_status not null default 'pending',
  reviewed_by uuid references auth.users (id),
  reviewed_at timestamptz,
  review_note text,
  created_at timestamptz not null default now()
);
create index enterprise_requests_status_idx on public.enterprise_requests (status, created_at desc);

create table public.enterprise_offers (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.enterprise_requests (id) on delete cascade,
  price_halalas bigint not null check (price_halalas > 0),
  currency text not null default 'SAR' check (currency = 'SAR'),
  entitlements jsonb not null,
  status public.offer_status not null default 'offered',
  offered_by uuid not null references auth.users (id),
  paid_organization_id uuid references public.organizations (id),
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger enterprise_offers_updated_at before update on public.enterprise_offers for each row execute function public.set_updated_at();

create table public.payment_transactions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  user_id uuid not null references auth.users (id),
  plan_code text not null references public.subscription_plans (code),
  enterprise_offer_id uuid references public.enterprise_offers (id),
  -- Amount fixed by the server at checkout creation — the client amount is never trusted.
  amount_halalas bigint not null check (amount_halalas > 0),
  currency text not null default 'SAR' check (currency = 'SAR'),
  provider text not null default 'moyasar' check (provider = 'moyasar'),
  provider_payment_id text unique,
  payment_method text,
  status public.payment_status not null default 'initiated',
  failure_reason text,
  -- Masked/non-sensitive metadata only (e.g. card company, last4). NEVER card number or CVV.
  provider_metadata jsonb not null default '{}'::jsonb,
  paid_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index payment_transactions_org_idx on public.payment_transactions (organization_id, created_at desc);
create trigger payment_transactions_updated_at before update on public.payment_transactions for each row execute function public.set_updated_at();

create table public.billing_events (
  id bigint generated always as identity primary key,
  organization_id uuid not null references public.organizations (id) on delete cascade,
  event_type text not null,
  transaction_id uuid references public.payment_transactions (id),
  plan_code text,
  period_start timestamptz,
  period_end timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index billing_events_org_idx on public.billing_events (organization_id, created_at desc);

-- Metered usage per subscription period.
create table public.usage_counters (
  organization_id uuid not null references public.organizations (id) on delete cascade,
  metric text not null,
  period_start timestamptz not null,
  value bigint not null default 0,
  updated_at timestamptz not null default now(),
  primary key (organization_id, metric, period_start)
);

-- AI token/cost ledger (for AI Usage analytics).
create table public.ai_usage_events (
  id bigint generated always as identity primary key,
  organization_id uuid not null references public.organizations (id) on delete cascade,
  ai_employee_id uuid references public.ai_employees (id) on delete set null,
  session_id uuid references public.ai_work_sessions (id) on delete set null,
  user_id uuid references auth.users (id),
  source text not null check (source in ('work_session', 'nexus_ai', 'meeting_ai', 'mission_ai')),
  provider text not null,
  model text not null,
  input_tokens int not null default 0,
  output_tokens int not null default 0,
  estimated_cost_usd numeric(12, 6) not null default 0,
  created_at timestamptz not null default now()
);
create index ai_usage_events_org_idx on public.ai_usage_events (organization_id, created_at desc);

create table public.email_outbox (
  id uuid primary key default gen_random_uuid(),
  to_email text not null,
  subject text not null,
  template text not null,
  status text not null default 'queued' check (status in ('queued', 'sent', 'failed', 'skipped_no_provider')),
  provider_message_id text,
  error text,
  created_at timestamptz not null default now(),
  sent_at timestamptz
);

create table public.contact_messages (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  email text not null,
  company text not null default '',
  message text not null,
  created_at timestamptz not null default now()
);
