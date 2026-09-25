-- NEXUS Platform — 0004: AI runtime, approvals, company files, activity & audit

create table public.ai_work_sessions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  ai_employee_id uuid not null references public.ai_employees (id) on delete cascade,
  task_id uuid references public.tasks (id) on delete set null,
  parent_session_id uuid references public.ai_work_sessions (id) on delete set null,
  delegation_depth int not null default 0 check (delegation_depth >= 0 and delegation_depth <= 3),
  status public.work_session_status not null default 'queued',
  current_step text,
  priority int not null default 2 check (priority between 0 and 4),
  provider text not null,
  model text not null,
  computer_session_id uuid,
  step_count int not null default 0,
  child_action_count int not null default 0,
  retry_count int not null default 0,
  input_tokens bigint not null default 0,
  output_tokens bigint not null default 0,
  estimated_cost_usd numeric(12, 6) not null default 0,
  control_request text check (control_request in ('pause', 'cancel', 'request_stop')),
  resume_state jsonb,
  outputs jsonb not null default '[]'::jsonb,
  error text,
  requested_by_user_id uuid references auth.users (id),
  requested_by_ai_employee_id uuid references public.ai_employees (id) on delete set null,
  queued_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz,
  locked_by text,
  locked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index ai_work_sessions_queue_idx on public.ai_work_sessions (status, priority desc, queued_at) where status = 'queued';
create index ai_work_sessions_org_idx on public.ai_work_sessions (organization_id, created_at desc);
create index ai_work_sessions_employee_idx on public.ai_work_sessions (ai_employee_id, created_at desc);
create trigger ai_work_sessions_updated_at before update on public.ai_work_sessions for each row execute function public.set_updated_at();

-- Timeline of a work session (Task received → Context loaded → ...)
create table public.ai_session_events (
  id bigint generated always as identity primary key,
  organization_id uuid not null references public.organizations (id) on delete cascade,
  session_id uuid not null references public.ai_work_sessions (id) on delete cascade,
  ai_employee_id uuid not null references public.ai_employees (id) on delete cascade,
  event_type text not null,
  message text not null,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index ai_session_events_session_idx on public.ai_session_events (session_id, id);

create table public.approvals (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  title text not null,
  description text not null default '',
  approval_type text not null check (approval_type in ('ai_tool_action', 'ai_output', 'task_review', 'file_publish', 'document', 'custom')),
  status public.approval_status not null default 'pending',
  requested_by_user_id uuid references auth.users (id),
  requested_by_ai_employee_id uuid references public.ai_employees (id) on delete set null,
  session_id uuid references public.ai_work_sessions (id) on delete set null,
  task_id uuid references public.tasks (id) on delete set null,
  entity_type text,
  entity_id uuid,
  payload jsonb not null default '{}'::jsonb,
  risk public.tool_risk not null default 'medium',
  decided_by_user_id uuid references auth.users (id),
  decided_at timestamptz,
  decision_comment text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index approvals_org_status_idx on public.approvals (organization_id, status, created_at desc);
create trigger approvals_updated_at before update on public.approvals for each row execute function public.set_updated_at();

create table public.approval_comments (
  id uuid primary key default gen_random_uuid(),
  approval_id uuid not null references public.approvals (id) on delete cascade,
  organization_id uuid not null references public.organizations (id) on delete cascade,
  author_user_id uuid not null references auth.users (id),
  body text not null check (char_length(body) between 1 and 4000),
  created_at timestamptz not null default now()
);

create table public.ai_tool_executions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  session_id uuid not null references public.ai_work_sessions (id) on delete cascade,
  ai_employee_id uuid not null references public.ai_employees (id) on delete cascade,
  tool text not null,
  input jsonb not null default '{}'::jsonb,
  status public.tool_execution_status not null,
  risk public.tool_risk not null default 'low',
  denial_reason text,
  output_summary text,
  error text,
  approval_id uuid references public.approvals (id) on delete set null,
  duration_ms int,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);
create index ai_tool_executions_session_idx on public.ai_tool_executions (session_id, created_at);
create index ai_tool_executions_org_idx on public.ai_tool_executions (organization_id, created_at desc);

create table public.ai_computer_sessions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  computer_id uuid not null references public.ai_computers (id) on delete cascade,
  work_session_id uuid references public.ai_work_sessions (id) on delete set null,
  provider text not null,
  provider_session_id text,
  status text not null default 'starting' check (status in ('starting', 'running', 'stopped', 'failed')),
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  usage_seconds int not null default 0,
  logs jsonb not null default '[]'::jsonb
);
alter table public.ai_work_sessions
  add constraint ai_work_sessions_computer_fk foreign key (computer_session_id) references public.ai_computer_sessions (id) on delete set null;

create table public.ai_outputs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  session_id uuid references public.ai_work_sessions (id) on delete set null,
  ai_employee_id uuid not null references public.ai_employees (id) on delete cascade,
  task_id uuid references public.tasks (id) on delete set null,
  title text not null,
  output_type text not null check (output_type in ('document', 'file', 'summary', 'plan', 'analysis', 'message')),
  content text not null default '',
  document_id uuid references public.documents (id) on delete set null,
  file_id uuid,
  status text not null default 'draft' check (status in ('draft', 'pending_approval', 'approved', 'rejected', 'published')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index ai_outputs_org_idx on public.ai_outputs (organization_id, created_at desc);
create trigger ai_outputs_updated_at before update on public.ai_outputs for each row execute function public.set_updated_at();

create table public.ai_employee_inbox (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  ai_employee_id uuid not null references public.ai_employees (id) on delete cascade,
  item_type text not null check (item_type in ('task', 'manager_instruction', 'agent_message', 'approval_result', 'project_update', 'mention')),
  title text not null,
  body text not null default '',
  related_type text,
  related_id uuid,
  from_user_id uuid references auth.users (id),
  from_ai_employee_id uuid references public.ai_employees (id) on delete set null,
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index ai_employee_inbox_idx on public.ai_employee_inbox (ai_employee_id, created_at desc);

create table public.ai_employee_messages (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  from_ai_employee_id uuid references public.ai_employees (id) on delete cascade,
  from_user_id uuid references auth.users (id),
  to_ai_employee_id uuid not null references public.ai_employees (id) on delete cascade,
  session_id uuid references public.ai_work_sessions (id) on delete set null,
  body text not null check (char_length(body) between 1 and 8000),
  created_at timestamptz not null default now(),
  check ((from_ai_employee_id is null) <> (from_user_id is null))
);

create table public.nexus_conversations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  title text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index nexus_conversations_user_idx on public.nexus_conversations (organization_id, user_id, updated_at desc);
create trigger nexus_conversations_updated_at before update on public.nexus_conversations for each row execute function public.set_updated_at();

create table public.nexus_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.nexus_conversations (id) on delete cascade,
  organization_id uuid not null references public.organizations (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null check (role in ('user', 'assistant')),
  content text not null,
  tool_calls jsonb not null default '[]'::jsonb,
  input_tokens int not null default 0,
  output_tokens int not null default 0,
  created_at timestamptz not null default now()
);
create index nexus_messages_conv_idx on public.nexus_messages (conversation_id, created_at);

/* ------------------------------ Company files ------------------------------ */

create table public.company_file_folders (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  space public.file_space not null,
  visibility public.file_visibility not null,
  owner_user_id uuid references auth.users (id) on delete cascade,
  ai_employee_id uuid references public.ai_employees (id) on delete cascade,
  parent_id uuid references public.company_file_folders (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 120),
  created_by_user_id uuid references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  deleted_by uuid references auth.users (id),
  -- Private folders must have an owner; visibility must match the space.
  constraint folder_private_owner check (
    (space = 'private' and visibility = 'private_owner' and owner_user_id is not null)
    or (space = 'shared' and visibility in ('organization_shared', 'restricted'))
    or (space = 'ai_workspace' and ai_employee_id is not null and visibility = 'restricted')
  )
);
create index company_file_folders_idx on public.company_file_folders (organization_id, space, parent_id) where deleted_at is null;
create unique index company_file_folders_name_unique on public.company_file_folders
  (organization_id, space, coalesce(owner_user_id, '00000000-0000-0000-0000-000000000000'::uuid), coalesce(parent_id, '00000000-0000-0000-0000-000000000000'::uuid), lower(name))
  where deleted_at is null;
create trigger company_file_folders_updated_at before update on public.company_file_folders for each row execute function public.set_updated_at();

create table public.company_files (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  space public.file_space not null,
  visibility public.file_visibility not null,
  owner_user_id uuid references auth.users (id) on delete cascade,
  uploaded_by_user_id uuid references auth.users (id),
  uploaded_by_ai_employee_id uuid references public.ai_employees (id) on delete set null,
  ai_employee_id uuid references public.ai_employees (id) on delete cascade,
  folder_id uuid references public.company_file_folders (id) on delete set null,
  original_name text not null check (char_length(original_name) between 1 and 255),
  extension text not null default '',
  -- Server-generated, never derived from the user filename: {org}/{space}/[{owner}/]{uuid}
  storage_key text not null unique,
  mime_type text not null,
  category text not null,
  size bigint not null check (size >= 0),
  checksum_sha256 text,
  status public.file_status not null default 'uploading',
  scan_status public.scan_status not null default 'not_scanned',
  failure_reason text,
  source_file_id uuid references public.company_files (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  deleted_by uuid references auth.users (id),
  purged_at timestamptz,
  constraint file_private_owner check (
    (space = 'private' and visibility = 'private_owner' and owner_user_id is not null and uploaded_by_ai_employee_id is null)
    or (space = 'shared' and visibility in ('organization_shared', 'restricted'))
    or (space = 'ai_workspace' and ai_employee_id is not null and visibility = 'restricted')
  ),
  constraint file_storage_key_scope check (storage_key like organization_id::text || '/%')
);
create index company_files_list_idx on public.company_files (organization_id, space, folder_id, created_at desc) where deleted_at is null and purged_at is null;
create index company_files_owner_idx on public.company_files (owner_user_id) where space = 'private';
create index company_files_name_trgm on public.company_files using gin (original_name gin_trgm_ops);
create trigger company_files_updated_at before update on public.company_files for each row execute function public.set_updated_at();

alter table public.ai_outputs add constraint ai_outputs_file_fk foreign key (file_id) references public.company_files (id) on delete set null;

-- Links shared files to tasks/projects/missions/departments/meetings/AI outputs ("Attach from Company Files").
create table public.file_links (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  file_id uuid not null references public.company_files (id) on delete cascade,
  entity_type text not null check (entity_type in ('task', 'project', 'mission', 'department', 'meeting', 'ai_output', 'task_comment')),
  entity_id uuid not null,
  linked_by_user_id uuid references auth.users (id),
  linked_by_ai_employee_id uuid references public.ai_employees (id) on delete set null,
  created_at timestamptz not null default now(),
  unique (file_id, entity_type, entity_id)
);
create index file_links_entity_idx on public.file_links (entity_type, entity_id);

-- Fine-grained access rules for `restricted` shared folders and AI folder grants.
create table public.file_access_rules (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  folder_id uuid references public.company_file_folders (id) on delete cascade,
  file_id uuid references public.company_files (id) on delete cascade,
  member_role public.member_role,
  user_id uuid references auth.users (id) on delete cascade,
  can_view boolean not null default true,
  can_upload boolean not null default false,
  can_manage boolean not null default false,
  created_by uuid references auth.users (id),
  created_at timestamptz not null default now(),
  check ((folder_id is null) <> (file_id is null)),
  check ((member_role is null) <> (user_id is null))
);

create table public.file_activity_events (
  id bigint generated always as identity primary key,
  organization_id uuid not null references public.organizations (id) on delete cascade,
  file_id uuid references public.company_files (id) on delete cascade,
  folder_id uuid references public.company_file_folders (id) on delete cascade,
  -- Copied from the file so RLS can hide private activity without joins.
  space public.file_space not null,
  owner_user_id uuid,
  action text not null,
  actor_user_id uuid references auth.users (id),
  actor_ai_employee_id uuid references public.ai_employees (id) on delete set null,
  -- Never contains file content; only non-sensitive metadata (e.g. old/new name).
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index file_activity_events_idx on public.file_activity_events (organization_id, created_at desc);
create index file_activity_file_idx on public.file_activity_events (file_id, created_at desc);

create table public.file_recent_views (
  user_id uuid not null references auth.users (id) on delete cascade,
  file_id uuid not null references public.company_files (id) on delete cascade,
  organization_id uuid not null references public.organizations (id) on delete cascade,
  viewed_at timestamptz not null default now(),
  primary key (user_id, file_id)
);

/* ------------------------------ Notifications, activity, audit ------------------------------ */

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  type text not null,
  title text not null,
  body text not null default '',
  link text,
  data jsonb not null default '{}'::jsonb,
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index notifications_user_idx on public.notifications (user_id, created_at desc);

create table public.activity_events (
  id bigint generated always as identity primary key,
  organization_id uuid not null references public.organizations (id) on delete cascade,
  actor_user_id uuid references auth.users (id),
  actor_ai_employee_id uuid references public.ai_employees (id) on delete set null,
  verb text not null,
  entity_type text not null,
  entity_id uuid,
  summary text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index activity_events_org_idx on public.activity_events (organization_id, created_at desc);
create index activity_events_actor_ai_idx on public.activity_events (actor_ai_employee_id, created_at desc);

create table public.audit_logs (
  id bigint generated always as identity primary key,
  organization_id uuid references public.organizations (id) on delete set null,
  actor_type text not null check (actor_type in ('human', 'ai', 'system', 'super_admin')),
  actor_user_id uuid,
  actor_ai_employee_id uuid,
  action text not null,
  target_type text,
  target_id text,
  ip inet,
  user_agent text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index audit_logs_org_idx on public.audit_logs (organization_id, created_at desc);

-- Audit log is append-only.
create or replace function public.prevent_audit_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception 'audit_logs is append-only';
end;
$$;
create trigger audit_logs_no_update before update or delete on public.audit_logs for each row execute function public.prevent_audit_mutation();
