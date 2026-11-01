-- NEXUS Platform — 0016: repricing + new entry plan "Launch" (owner decision 2026-11-01).
-- Prices are in halalas (SAR × 100). AI budgets stay at or below 40% of each plan's price.
--   launch     999 SAR  (new, cheap entry plan for companies that want to try)
--   starter  2,999 SAR
--   pro      5,999 SAR
--   business 11,999 SAR
--   enterprise custom

insert into public.subscription_plans (code, name_ar, name_en, price_halalas, is_popular, is_custom, entitlements, sort_order) values
('launch', 'الانطلاقة', 'Launch', 99900, false, false, '{
  "human_members": 2, "ai_employees": 2, "ai_executions_per_year": 200, "active_projects": 3,
  "storage_bytes": 10737418240, "max_file_size_bytes": 104857600, "concurrent_ai_sessions": 1, "computer_minutes_per_year": 1500,
  "ai_budget_halalas_per_year": 35000,
  "features": ["basic_memory", "basic_analytics"]
}'::jsonb, 0)
on conflict (code) do update set
  name_ar = excluded.name_ar, name_en = excluded.name_en, price_halalas = excluded.price_halalas,
  entitlements = excluded.entitlements, sort_order = excluded.sort_order;

update public.subscription_plans set price_halalas = 299900,  entitlements = entitlements || '{"ai_budget_halalas_per_year": 100000}'::jsonb where code = 'starter';
update public.subscription_plans set price_halalas = 599900,  entitlements = entitlements || '{"ai_budget_halalas_per_year": 200000}'::jsonb where code = 'pro';
update public.subscription_plans set price_halalas = 1199900, entitlements = entitlements || '{"ai_budget_halalas_per_year": 400000}'::jsonb where code = 'business';

-- Starter now costs 3× Launch, so it gets more than the basics.
update public.subscription_plans
set entitlements = jsonb_set(entitlements, '{features}', '["basic_memory", "full_memory", "knowledge", "decisions", "approvals", "basic_analytics"]'::jsonb)
where code = 'starter';
