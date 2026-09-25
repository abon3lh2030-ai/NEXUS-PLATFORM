-- NEXUS Platform — 0007: server-side functions (called only by the API with the service role)

-- Atomically claim the next queued AI work session (SKIP LOCKED queue).
-- Respects per-organization concurrency limits passed in by the worker.
create or replace function public.claim_next_work_session(p_worker text)
returns setof public.ai_work_sessions
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  select s.id into v_id
  from public.ai_work_sessions s
  join public.organizations o on o.id = s.organization_id and o.status = 'active'
  where s.status = 'queued'
    and s.queued_at <= now()
  order by s.priority desc, s.queued_at
  for update of s skip locked
  limit 1;

  if v_id is null then
    return;
  end if;

  return query
  update public.ai_work_sessions
  set status = 'preparing', locked_by = p_worker, locked_at = now(), started_at = coalesce(started_at, now())
  where id = v_id
  returning *;
end;
$$;

-- Re-queue sessions whose worker died (no heartbeat for p_stale_seconds).
create or replace function public.requeue_stale_work_sessions(p_stale_seconds int)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count int;
begin
  update public.ai_work_sessions
  set status = case when retry_count >= 2 then 'failed'::public.work_session_status else 'queued'::public.work_session_status end,
      error = case when retry_count >= 2 then 'worker_lost' else error end,
      retry_count = retry_count + 1,
      locked_by = null,
      locked_at = null,
      completed_at = case when retry_count >= 2 then now() else null end
  where status in ('preparing', 'running')
    and locked_at < now() - make_interval(secs => p_stale_seconds);
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

create or replace function public.increment_usage(p_org uuid, p_metric text, p_period_start timestamptz, p_amount bigint)
returns bigint
language sql
security definer
set search_path = public
as $$
  insert into public.usage_counters (organization_id, metric, period_start, value)
  values (p_org, p_metric, p_period_start, p_amount)
  on conflict (organization_id, metric, period_start)
  do update set value = public.usage_counters.value + excluded.value, updated_at = now()
  returning value;
$$;

-- Reserve one unit of a metered entitlement atomically; returns false if the limit would be exceeded.
create or replace function public.try_consume_usage(p_org uuid, p_metric text, p_period_start timestamptz, p_limit bigint)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_value bigint;
begin
  insert into public.usage_counters (organization_id, metric, period_start, value)
  values (p_org, p_metric, p_period_start, 0)
  on conflict do nothing;

  select value into v_value from public.usage_counters
  where organization_id = p_org and metric = p_metric and period_start = p_period_start
  for update;

  if p_limit is not null and v_value + 1 > p_limit then
    return false;
  end if;

  update public.usage_counters set value = value + 1, updated_at = now()
  where organization_id = p_org and metric = p_metric and period_start = p_period_start;
  return true;
end;
$$;

create or replace function public.organization_storage_usage(p_org uuid)
returns table (used_bytes bigint, file_count bigint)
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(sum(size), 0)::bigint, count(*)::bigint
  from public.company_files
  where organization_id = p_org and purged_at is null and status in ('ready', 'processing', 'uploading');
$$;

-- Idempotently mark a verified Moyasar payment as paid and activate / extend the annual subscription.
-- The caller (API) MUST have already fetched the payment from Moyasar with the secret key and
-- verified status = 'paid', amount and currency. This function re-checks the amount against
-- the server-side transaction and never trusts client input.
create or replace function public.activate_paid_transaction(
  p_transaction_id uuid,
  p_provider_payment_id text,
  p_amount_halalas bigint,
  p_currency text,
  p_method text,
  p_metadata jsonb
)
returns public.subscriptions
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tx public.payment_transactions;
  v_sub public.subscriptions;
  v_now timestamptz := now();
  v_start timestamptz;
  v_end timestamptz;
  v_custom jsonb;
begin
  select * into v_tx from public.payment_transactions where id = p_transaction_id for update;
  if not found then
    raise exception 'transaction_not_found';
  end if;

  if v_tx.status = 'paid' then
    if v_tx.provider_payment_id is distinct from p_provider_payment_id then
      raise exception 'transaction_already_paid_with_other_payment';
    end if;
    select * into v_sub from public.subscriptions where organization_id = v_tx.organization_id;
    return v_sub; -- idempotent replay (callback + webhook)
  end if;

  if v_tx.status <> 'initiated' then
    raise exception 'transaction_not_payable';
  end if;
  if p_amount_halalas <> v_tx.amount_halalas or upper(p_currency) <> v_tx.currency then
    raise exception 'amount_mismatch';
  end if;

  update public.payment_transactions
  set status = 'paid', provider_payment_id = p_provider_payment_id, payment_method = p_method,
      provider_metadata = coalesce(p_metadata, '{}'::jsonb), paid_at = v_now
  where id = v_tx.id;

  if v_tx.enterprise_offer_id is not null then
    select entitlements into v_custom from public.enterprise_offers where id = v_tx.enterprise_offer_id for update;
    update public.enterprise_offers set status = 'paid', paid_organization_id = v_tx.organization_id where id = v_tx.enterprise_offer_id;
    update public.enterprise_requests set status = 'converted'
      where id = (select request_id from public.enterprise_offers where id = v_tx.enterprise_offer_id);
  end if;

  select * into v_sub from public.subscriptions where organization_id = v_tx.organization_id for update;

  -- Renewal before expiry keeps remaining days: extend from current ends_at.
  if found and v_sub.status = 'active' and v_sub.ends_at > v_now then
    v_start := v_sub.ends_at;
  else
    v_start := v_now;
  end if;
  v_end := v_start + interval '1 year';

  insert into public.subscriptions as s (organization_id, plan_code, status, billing_interval, started_at, current_period_start, ends_at, custom_entitlements)
  values (v_tx.organization_id, v_tx.plan_code, 'active', 'yearly', v_now, v_now, v_end, v_custom)
  on conflict (organization_id) do update
    set plan_code = excluded.plan_code,
        status = 'active',
        started_at = coalesce(s.started_at, excluded.started_at),
        current_period_start = case when s.status = 'active' and s.ends_at > v_now then s.current_period_start else v_now end,
        ends_at = v_end,
        custom_entitlements = case when v_tx.enterprise_offer_id is not null then v_custom else null end,
        expiring_notified_at = null,
        expired_notified_at = null
  returning * into v_sub;

  insert into public.billing_events (organization_id, event_type, transaction_id, plan_code, period_start, period_end, metadata)
  values (v_tx.organization_id, 'subscription_activated', v_tx.id, v_tx.plan_code, v_start, v_end,
          jsonb_build_object('renewal_extended_from_existing', v_start <> v_now));

  return v_sub;
end;
$$;

-- Mark overdue subscriptions expired (access is already denied the instant ends_at passes; this is bookkeeping).
create or replace function public.expire_subscriptions()
returns setof public.subscriptions
language sql
security definer
set search_path = public
as $$
  update public.subscriptions set status = 'expired'
  where status = 'active' and ends_at <= now()
  returning *;
$$;

revoke all on function public.claim_next_work_session(text) from public, anon, authenticated;
revoke all on function public.requeue_stale_work_sessions(int) from public, anon, authenticated;
revoke all on function public.increment_usage(uuid, text, timestamptz, bigint) from public, anon, authenticated;
revoke all on function public.try_consume_usage(uuid, text, timestamptz, bigint) from public, anon, authenticated;
revoke all on function public.organization_storage_usage(uuid) from public, anon, authenticated;
revoke all on function public.activate_paid_transaction(uuid, text, bigint, text, text, jsonb) from public, anon, authenticated;
revoke all on function public.expire_subscriptions() from public, anon, authenticated;
grant execute on function public.claim_next_work_session(text) to service_role;
grant execute on function public.requeue_stale_work_sessions(int) to service_role;
grant execute on function public.increment_usage(uuid, text, timestamptz, bigint) to service_role;
grant execute on function public.try_consume_usage(uuid, text, timestamptz, bigint) to service_role;
grant execute on function public.organization_storage_usage(uuid) to service_role;
grant execute on function public.activate_paid_transaction(uuid, text, bigint, text, text, jsonb) to service_role;
grant execute on function public.expire_subscriptions() to service_role;
