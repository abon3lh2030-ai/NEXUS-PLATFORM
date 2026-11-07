-- NEXUS Platform — 0017: a per-plan cap on every usage that costs the platform money (owner decision 2026-11-07).
-- AI already has annual + weekly budgets (0013/0015). This adds:
--   emails_per_month              AI employee emails sent through the email provider (Resend)
--   meeting_bot_minutes_per_year  minutes a meeting bot (Recall.ai) may spend in calls
--   voice_characters_per_year     text-to-speech characters (ElevenLabs)
--   download_bytes_per_month      file bytes served out of storage (downloads + previews + AI reads)
-- Enterprise gets concrete defaults too, so nothing that costs money is ever unlimited by accident.

-- Atomically add `p_amount` to a metered counter; returns false (and adds nothing) if it would exceed `p_limit`.
create or replace function public.try_consume_usage_amount(p_org uuid, p_metric text, p_period_start timestamptz, p_limit bigint, p_amount bigint)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_value bigint;
begin
  if p_amount is null or p_amount <= 0 then
    return true;
  end if;

  insert into public.usage_counters (organization_id, metric, period_start, value)
  values (p_org, p_metric, p_period_start, 0)
  on conflict do nothing;

  select value into v_value from public.usage_counters
  where organization_id = p_org and metric = p_metric and period_start = p_period_start
  for update;

  if p_limit is not null and v_value + p_amount > p_limit then
    return false;
  end if;

  update public.usage_counters set value = value + p_amount, updated_at = now()
  where organization_id = p_org and metric = p_metric and period_start = p_period_start;
  return true;
end;
$$;

revoke all on function public.try_consume_usage_amount(uuid, text, timestamptz, bigint, bigint) from public, anon, authenticated;
grant execute on function public.try_consume_usage_amount(uuid, text, timestamptz, bigint, bigint) to service_role;

-- A meeting bot is made to leave once its reserved minutes are over.
alter table public.meeting_sessions add column if not exists bot_deadline timestamptz;
create index if not exists meeting_sessions_bot_deadline_idx on public.meeting_sessions (bot_deadline)
  where provider_bot_id is not null and status in ('joining', 'in_meeting', 'presenting');

update public.subscription_plans set entitlements = entitlements || '{
  "emails_per_month": 100, "meeting_bot_minutes_per_year": 0, "voice_characters_per_year": 0, "download_bytes_per_month": 5368709120
}'::jsonb where code = 'launch';

update public.subscription_plans set entitlements = entitlements || '{
  "emails_per_month": 500, "meeting_bot_minutes_per_year": 0, "voice_characters_per_year": 0, "download_bytes_per_month": 21474836480
}'::jsonb where code = 'starter';

update public.subscription_plans set entitlements = entitlements || '{
  "emails_per_month": 1500, "meeting_bot_minutes_per_year": 1200, "voice_characters_per_year": 50000, "download_bytes_per_month": 53687091200
}'::jsonb where code = 'pro';

update public.subscription_plans set entitlements = entitlements || '{
  "emails_per_month": 4000, "meeting_bot_minutes_per_year": 3600, "voice_characters_per_year": 150000, "download_bytes_per_month": 107374182400
}'::jsonb where code = 'business';

update public.subscription_plans set entitlements = entitlements || '{
  "storage_bytes": 2199023255552, "computer_minutes_per_year": 200000,
  "emails_per_month": 10000, "meeting_bot_minutes_per_year": 9000, "voice_characters_per_year": 400000, "download_bytes_per_month": 268435456000
}'::jsonb where code = 'enterprise';
