-- NEXUS Platform — 0013: AI cost guard (owner request 2026-09-26).
-- Problem: a customer who uses every allowance of a plan could cost more in AI tokens than the
-- plan's price. Fix, enforced server-side:
--   1. Each plan has an annual AI spend budget (`ai_budget_halalas_per_year`, estimated provider
--      cost in SAR halalas). Every AI call is refused with 402 once the budget is used up.
--   2. Each plan has a list of allowed AI models (`ai_models`, first = default), so lower plans
--      cannot pick the most expensive models.
--   3. Every row in ai_usage_events is added to a per-period counter by trigger, so no AI feature
--      can bypass the meter.

alter table public.subscription_plans add column ai_models text[] not null default array['claude-sonnet-5']::text[];

-- Budget ≈ 35–40% of the plan price. Enterprise offers get a budget set per offer (default 40% of the price).
update public.subscription_plans
set entitlements = entitlements || '{"ai_budget_halalas_per_year": 35000}'::jsonb,
    ai_models = array['claude-sonnet-5', 'claude-haiku-4-5']
where code = 'starter';

update public.subscription_plans
set entitlements = entitlements || '{"ai_budget_halalas_per_year": 75000}'::jsonb,
    ai_models = array['claude-sonnet-5', 'claude-haiku-4-5']
where code = 'pro';

update public.subscription_plans
set entitlements = entitlements || '{"ai_budget_halalas_per_year": 115000}'::jsonb,
    ai_models = array['claude-sonnet-5', 'claude-opus-5', 'claude-haiku-4-5']
where code = 'business';

update public.subscription_plans
set entitlements = entitlements || '{"ai_budget_halalas_per_year": null}'::jsonb,
    ai_models = array['claude-opus-5', 'claude-sonnet-5', 'claude-haiku-4-5', 'claude-opus-5-5', 'claude-fable-5-1']
where code = 'enterprise';

-- Meter: every AI usage event increments `ai_cost_micro_usd` for the organization's current billing period.
create or replace function public.meter_ai_usage_event()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_period timestamptz;
begin
  select coalesce(current_period_start, started_at) into v_period
  from public.subscriptions where organization_id = new.organization_id;
  if v_period is null or new.estimated_cost_usd <= 0 then
    return new;
  end if;
  perform public.increment_usage(new.organization_id, 'ai_cost_micro_usd', v_period, ceil(new.estimated_cost_usd * 1000000)::bigint);
  return new;
end;
$$;

create trigger ai_usage_events_meter after insert on public.ai_usage_events
for each row execute function public.meter_ai_usage_event();

revoke all on function public.meter_ai_usage_event() from public, anon, authenticated;
