-- NEXUS Platform — 0014: one platform-wide AI model (owner decision 2026-09-27).
-- Customers no longer choose or see the AI model; the API uses AI_DEFAULT_MODEL for every call.
-- The per-plan annual AI budget from 0013 stays in place as the internal cost guard.

alter table public.subscription_plans drop column if exists ai_models;
