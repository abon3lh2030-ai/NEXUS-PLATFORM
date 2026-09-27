-- NEXUS Platform — 0015: weekly AI usage window (owner request 2026-09-27).
-- The annual AI budget (0013) is spread over weekly windows so a customer can't use it all in the
-- first weeks. A week starts Sunday 00:00 Riyadh time (UTC+3, no DST) — must match aiWeekStart()
-- in packages/shared/src/billing.ts. The API enforces weekly limit = floor(annual / 53).

create or replace function public.ai_week_start(p_at timestamptz)
returns timestamptz
language sql
immutable
set search_path = public
as $$
  select ((date_trunc('day', (p_at at time zone 'UTC') + interval '3 hours')
           - make_interval(days => extract(dow from (p_at at time zone 'UTC') + interval '3 hours')::int))
          - interval '3 hours') at time zone 'UTC';
$$;

create or replace function public.meter_ai_usage_event()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_period timestamptz;
  v_amount bigint;
begin
  select coalesce(current_period_start, started_at) into v_period
  from public.subscriptions where organization_id = new.organization_id;
  if v_period is null or new.estimated_cost_usd <= 0 then
    return new;
  end if;
  v_amount := ceil(new.estimated_cost_usd * 1000000)::bigint;
  perform public.increment_usage(new.organization_id, 'ai_cost_micro_usd', v_period, v_amount);
  perform public.increment_usage(new.organization_id, 'ai_cost_micro_usd_week', public.ai_week_start(new.created_at), v_amount);
  return new;
end;
$$;

revoke all on function public.meter_ai_usage_event() from public, anon, authenticated;
