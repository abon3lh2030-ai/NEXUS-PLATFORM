-- NEXUS Platform — 0019: team overview for managers (owner request 2026-11-11).
-- When a member last used NEXUS, so managers can see who is active now next to their tasks' progress.
alter table public.organization_members add column if not exists last_seen_at timestamptz;
