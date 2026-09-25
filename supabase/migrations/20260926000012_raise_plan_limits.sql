-- NEXUS Platform — 0012: raised plan limits (owner request 2026-09-26). `null` = unlimited.
-- Features are unchanged; only numeric entitlements are raised.

update public.subscription_plans
set entitlements = entitlements || '{
  "human_members": 3, "ai_employees": 5, "ai_executions_per_year": 600, "active_projects": 10,
  "storage_bytes": 53687091200, "max_file_size_bytes": 262144000, "concurrent_ai_sessions": 3, "computer_minutes_per_year": 6000
}'::jsonb
where code = 'starter';

update public.subscription_plans
set entitlements = entitlements || '{
  "human_members": 10, "ai_employees": 15, "ai_executions_per_year": 2500, "active_projects": null,
  "storage_bytes": 214748364800, "max_file_size_bytes": 524288000, "concurrent_ai_sessions": 8, "computer_minutes_per_year": 24000
}'::jsonb
where code = 'pro';

update public.subscription_plans
set entitlements = entitlements || '{
  "human_members": 30, "ai_employees": 40, "ai_executions_per_year": 8000, "active_projects": null,
  "storage_bytes": 1099511627776, "max_file_size_bytes": 1073741824, "concurrent_ai_sessions": 20, "computer_minutes_per_year": 100000
}'::jsonb
where code = 'business';

update public.subscription_plans
set entitlements = entitlements || '{
  "max_file_size_bytes": 2147483648, "concurrent_ai_sessions": 50
}'::jsonb
where code = 'enterprise';

-- Storage bucket hard ceiling follows the largest plan file size (2 GB). Per-plan limits are enforced by the API.
update storage.buckets set file_size_limit = 2147483648 where id = 'company-files';
