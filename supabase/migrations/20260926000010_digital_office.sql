-- NEXUS Platform — 0010: AI Employee Digital Office
-- Presentations (real PPTX), mailboxes & email, calendar, AI-enabled meetings, voice, communication policy.

alter type public.ai_employee_status add value if not exists 'preparing_presentation';
alter type public.ai_employee_status add value if not exists 'writing_email';
alter type public.ai_employee_status add value if not exists 'waiting_email_approval';
alter type public.ai_employee_status add value if not exists 'in_meeting';
alter type public.ai_employee_status add value if not exists 'presenting';
alter type public.ai_employee_status add value if not exists 'processing_meeting';
alter type public.ai_employee_status add value if not exists 'creating_followup';

/* ------------------------------ Organization communication policy ------------------------------ */

create table public.communication_policies (
  organization_id uuid primary key references public.organizations (id) on delete cascade,
  -- draft_only: AI writes drafts, a human sends. approval_required: manager approves each send. autonomous: AI may send within policy.
  email_send_mode text not null default 'approval_required' check (email_send_mode in ('draft_only', 'approval_required', 'autonomous')),
  allow_external_email boolean not null default false,
  -- External sends ALWAYS need approval unless this is true AND the recipient domain is allow-listed.
  autonomous_external_domains text[] not null default '{}',
  daily_send_limit_per_employee int not null default 50 check (daily_send_limit_per_employee between 0 and 1000),
  presentation_publish_requires_approval boolean not null default true,
  meeting_recording text not null default 'transcript_only' check (meeting_recording in ('none', 'transcript_only', 'audio_and_transcript')),
  transcript_retention_days int not null default 90 check (transcript_retention_days between 1 and 3650),
  require_participant_consent boolean not null default true,
  allow_ai_speaking_external boolean not null default false,
  updated_by uuid references auth.users (id),
  updated_at timestamptz not null default now()
);

/* ------------------------------ Presentations ------------------------------ */

create table public.presentations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  title text not null check (char_length(title) between 1 and 200),
  language text not null default 'ar' check (language in ('ar', 'en')),
  status text not null default 'draft' check (status in ('draft', 'pending_approval', 'changes_requested', 'final', 'archived')),
  current_version int not null default 1,
  ai_employee_id uuid references public.ai_employees (id) on delete set null,
  created_by_user_id uuid references auth.users (id),
  project_id uuid references public.projects (id) on delete set null,
  task_id uuid references public.tasks (id) on delete set null,
  meeting_id uuid references public.meetings (id) on delete set null,
  published_file_id uuid references public.company_files (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index presentations_org_idx on public.presentations (organization_id, updated_at desc) where deleted_at is null;
create trigger presentations_updated_at before update on public.presentations for each row execute function public.set_updated_at();

create table public.presentation_versions (
  id uuid primary key default gen_random_uuid(),
  presentation_id uuid not null references public.presentations (id) on delete cascade,
  organization_id uuid not null references public.organizations (id) on delete cascade,
  version int not null,
  label text not null default '',
  -- Structured deck spec: the single source for both the in-app preview and the generated PPTX.
  spec jsonb not null,
  pptx_file_id uuid references public.company_files (id) on delete set null,
  slide_count int not null default 0,
  change_summary text,
  created_by_user_id uuid references auth.users (id),
  created_by_ai_employee_id uuid references public.ai_employees (id) on delete set null,
  created_at timestamptz not null default now(),
  unique (presentation_id, version)
);

create table public.presentation_slides (
  id uuid primary key default gen_random_uuid(),
  version_id uuid not null references public.presentation_versions (id) on delete cascade,
  organization_id uuid not null references public.organizations (id) on delete cascade,
  position int not null,
  kind text not null,
  title text not null default '',
  content jsonb not null default '{}'::jsonb,
  unique (version_id, position)
);

/* ------------------------------ Email ------------------------------ */

create table public.employee_mailboxes (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  ai_employee_id uuid not null unique references public.ai_employees (id) on delete cascade,
  -- Logical identity (e.g. atlas@company.sa). Real delivery only when a provider + verified domain are connected.
  address text,
  display_name text not null,
  provider text not null default 'none',
  status text not null default 'not_connected' check (status in ('not_connected', 'active', 'suspended')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index employee_mailboxes_address_unique on public.employee_mailboxes (lower(address)) where address is not null;
create trigger employee_mailboxes_updated_at before update on public.employee_mailboxes for each row execute function public.set_updated_at();

create table public.email_threads (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  mailbox_id uuid not null references public.employee_mailboxes (id) on delete cascade,
  subject text not null default '',
  task_id uuid references public.tasks (id) on delete set null,
  project_id uuid references public.projects (id) on delete set null,
  last_message_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
create index email_threads_mailbox_idx on public.email_threads (mailbox_id, last_message_at desc);

create table public.email_messages (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  thread_id uuid not null references public.email_threads (id) on delete cascade,
  mailbox_id uuid not null references public.employee_mailboxes (id) on delete cascade,
  direction text not null check (direction in ('inbound', 'outbound')),
  folder text not null check (folder in ('inbox', 'sent', 'drafts', 'archived')),
  status text not null check (status in ('received', 'draft', 'pending_approval', 'approved', 'sending', 'sent', 'failed', 'rejected')),
  from_address text not null,
  to_addresses text[] not null default '{}',
  cc_addresses text[] not null default '{}',
  subject text not null default '',
  body_text text not null default '',
  is_external boolean not null default false,
  risk public.tool_risk not null default 'low',
  in_reply_to uuid references public.email_messages (id) on delete set null,
  approval_id uuid references public.approvals (id) on delete set null,
  provider_message_id text,
  failure_reason text,
  task_id uuid references public.tasks (id) on delete set null,
  project_id uuid references public.projects (id) on delete set null,
  created_by_ai_employee_id uuid references public.ai_employees (id) on delete set null,
  created_by_user_id uuid references auth.users (id),
  received_at timestamptz,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index email_messages_mailbox_idx on public.email_messages (mailbox_id, folder, created_at desc);
create trigger email_messages_updated_at before update on public.email_messages for each row execute function public.set_updated_at();

create table public.email_attachments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  message_id uuid not null references public.email_messages (id) on delete cascade,
  file_id uuid not null references public.company_files (id) on delete cascade,
  unique (message_id, file_id)
);

/* ------------------------------ Calendar ------------------------------ */

create table public.calendar_connections (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  ai_employee_id uuid references public.ai_employees (id) on delete cascade,
  user_id uuid references auth.users (id) on delete cascade,
  provider text not null,
  status text not null default 'not_connected' check (status in ('not_connected', 'active', 'error')),
  external_account text,
  created_at timestamptz not null default now(),
  check ((ai_employee_id is null) <> (user_id is null))
);

create table public.calendar_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  title text not null check (char_length(title) between 1 and 300),
  description text not null default '',
  event_type text not null default 'event' check (event_type in ('meeting', 'deadline', 'milestone', 'task', 'event')),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  location text,
  meeting_id uuid references public.meetings (id) on delete cascade,
  task_id uuid references public.tasks (id) on delete cascade,
  project_id uuid references public.projects (id) on delete set null,
  owner_user_id uuid references auth.users (id),
  owner_ai_employee_id uuid references public.ai_employees (id) on delete set null,
  provider text not null default 'nexus',
  provider_event_id text,
  status text not null default 'confirmed' check (status in ('tentative', 'confirmed', 'cancelled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_at >= starts_at)
);
create index calendar_events_org_range_idx on public.calendar_events (organization_id, starts_at);
create trigger calendar_events_updated_at before update on public.calendar_events for each row execute function public.set_updated_at();

create table public.calendar_event_attendees (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.calendar_events (id) on delete cascade,
  organization_id uuid not null references public.organizations (id) on delete cascade,
  member_id uuid references public.organization_members (id) on delete cascade,
  ai_employee_id uuid references public.ai_employees (id) on delete cascade,
  external_email text,
  response text not null default 'needs_action' check (response in ('needs_action', 'accepted', 'declined', 'tentative')),
  check (num_nonnulls(member_id, ai_employee_id, external_email) = 1)
);
create index calendar_event_attendees_event_idx on public.calendar_event_attendees (event_id);

/* ------------------------------ AI-enabled meetings ------------------------------ */

alter table public.meetings
  add column description text not null default '',
  add column organizer_user_id uuid references auth.users (id),
  add column organizer_ai_employee_id uuid references public.ai_employees (id) on delete set null,
  add column meeting_link text,
  add column provider text not null default 'nexus',
  add column status text not null default 'scheduled' check (status in ('scheduled', 'live', 'completed', 'cancelled')),
  add column recording_policy text not null default 'transcript_only' check (recording_policy in ('none', 'transcript_only', 'audio_and_transcript')),
  add column consent_confirmed boolean not null default false,
  add column minutes text;

alter table public.meeting_participants
  add column external_email text,
  add column role text not null default 'attendee' check (role in ('host', 'presenter', 'attendee')),
  drop constraint meeting_participants_check,
  add constraint meeting_participants_one_identity check (num_nonnulls(member_id, ai_employee_id, external_email) = 1);

create table public.meeting_connections (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  provider text not null,
  status text not null default 'not_connected' check (status in ('not_connected', 'active', 'error')),
  config jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (organization_id, provider)
);

create table public.meeting_sessions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  meeting_id uuid not null references public.meetings (id) on delete cascade,
  ai_employee_id uuid not null references public.ai_employees (id) on delete cascade,
  provider text not null,
  provider_bot_id text,
  status text not null default 'requested' check (status in ('requested', 'joining', 'in_meeting', 'presenting', 'left', 'failed', 'not_supported')),
  capabilities jsonb not null default '{}'::jsonb,
  failure_reason text,
  joined_at timestamptz,
  left_at timestamptz,
  created_at timestamptz not null default now()
);
create index meeting_sessions_meeting_idx on public.meeting_sessions (meeting_id);

create table public.meeting_transcripts (
  id bigint generated always as identity primary key,
  organization_id uuid not null references public.organizations (id) on delete cascade,
  meeting_id uuid not null references public.meetings (id) on delete cascade,
  session_id uuid references public.meeting_sessions (id) on delete set null,
  speaker text,
  text text not null,
  start_ms int,
  source text not null default 'manual' check (source in ('manual', 'provider')),
  expires_at timestamptz,
  created_at timestamptz not null default now()
);
create index meeting_transcripts_meeting_idx on public.meeting_transcripts (meeting_id, id);

create table public.meeting_summaries (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  meeting_id uuid not null references public.meetings (id) on delete cascade,
  summary text not null,
  minutes text not null default '',
  decisions jsonb not null default '[]'::jsonb,
  created_by_ai_employee_id uuid references public.ai_employees (id) on delete set null,
  created_by_user_id uuid references auth.users (id),
  created_at timestamptz not null default now()
);

create table public.meeting_action_items (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  meeting_id uuid not null references public.meetings (id) on delete cascade,
  title text not null,
  owner_hint text,
  due_date date,
  task_id uuid references public.tasks (id) on delete set null,
  created_at timestamptz not null default now()
);

/* ------------------------------ Voice ------------------------------ */

create table public.voice_profiles (
  ai_employee_id uuid primary key references public.ai_employees (id) on delete cascade,
  organization_id uuid not null references public.organizations (id) on delete cascade,
  provider text not null default 'none',
  voice_id text,
  language text not null default 'ar' check (language in ('ar', 'en')),
  speaking_style text not null default 'professional' check (speaking_style in ('professional', 'friendly', 'concise', 'formal')),
  enabled boolean not null default false,
  updated_at timestamptz not null default now()
);

/* ------------------------------ RLS ------------------------------ */

do $$
declare
  t text;
begin
  foreach t in array array[
    'communication_policies', 'presentations', 'presentation_versions', 'presentation_slides', 'employee_mailboxes',
    'email_threads', 'email_messages', 'email_attachments', 'calendar_connections', 'calendar_events', 'calendar_event_attendees',
    'meeting_connections', 'meeting_sessions', 'meeting_transcripts', 'meeting_summaries', 'meeting_action_items', 'voice_profiles'
  ]
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
    execute format('revoke insert, update, delete on public.%I from anon, authenticated', t);
  end loop;
  -- Work artifacts: readable by organization members.
  foreach t in array array['presentations', 'presentation_versions', 'presentation_slides', 'calendar_events', 'calendar_event_attendees', 'meeting_sessions', 'meeting_summaries', 'meeting_action_items', 'communication_policies', 'voice_profiles', 'employee_mailboxes']
  loop
    execute format('create policy %I on public.%I for select to authenticated using (public.is_org_member(organization_id))', t || '_member_select', t);
  end loop;
  -- Email content and transcripts: owner/admin/manager only.
  foreach t in array array['email_threads', 'email_messages', 'email_attachments', 'meeting_transcripts', 'calendar_connections', 'meeting_connections']
  loop
    execute format(
      'create policy %I on public.%I for select to authenticated using (public.has_org_role(organization_id, array[''owner'', ''admin'', ''manager'']::public.member_role[]))',
      t || '_manager_select', t
    );
  end loop;
end;
$$;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.meeting_sessions, public.presentations;
  end if;
end;
$$;

-- New approval types for the digital office.
alter table public.approvals drop constraint approvals_approval_type_check;
alter table public.approvals add constraint approvals_approval_type_check check (
  approval_type in ('ai_tool_action', 'ai_output', 'task_review', 'file_publish', 'document', 'custom', 'presentation', 'email_send', 'meeting_action')
);

-- Brand colors for generated presentations (hex, no '#').
alter table public.organizations
  add column brand_primary_color text not null default '312E81' check (brand_primary_color ~ '^[0-9A-Fa-f]{6}$'),
  add column brand_accent_color text not null default '0EA5E9' check (brand_accent_color ~ '^[0-9A-Fa-f]{6}$');
