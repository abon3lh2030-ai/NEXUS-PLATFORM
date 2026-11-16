-- NEXUS Platform — 0021: phone notifications for the NEXUS iOS app (owner request 2026-11-16).
-- One row per device. Notifications are sent straight to Apple (APNs) by the API; no third-party push service.
create table public.device_push_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  token text not null unique check (token ~ '^[0-9a-f]{32,200}$'),
  platform text not null default 'ios' check (platform in ('ios')),
  -- APNs sandbox (development builds) or production (TestFlight / App Store).
  environment text not null default 'production' check (environment in ('development', 'production')),
  app_version text,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  disabled_at timestamptz
);
create index device_push_tokens_user_idx on public.device_push_tokens (user_id) where disabled_at is null;

alter table public.device_push_tokens enable row level security;
alter table public.device_push_tokens force row level security;
revoke all on public.device_push_tokens from anon, authenticated;
