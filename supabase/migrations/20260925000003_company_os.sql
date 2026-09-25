-- NEXUS Platform — 0003: company operating system (departments, AI workforce, work graph)

create table public.departments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 120),
  description text not null default '',
  objective text not null default '',
  parent_id uuid references public.departments (id) on delete set null,
  lead_member_id uuid references public.organization_members (id) on delete set null,
  lead_ai_employee_id uuid,
  kpis jsonb not null default '[]'::jsonb,
  created_by uuid references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index departments_org_idx on public.departments (organization_id) where deleted_at is null;
create trigger departments_updated_at before update on public.departments for each row execute function public.set_updated_at();

alter table public.organization_members
  add constraint organization_members_department_fk foreign key (department_id) references public.departments (id) on delete set null;

/* ------------------------------ AI workforce ------------------------------ */

create table public.ai_employee_templates (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  category text not null,
  name_ar text not null,
  name_en text not null,
  job_title_ar text not null,
  job_title_en text not null,
  description_ar text not null default '',
  description_en text not null default '',
  responsibilities jsonb not null default '[]'::jsonb,
  skills jsonb not null default '[]'::jsonb,
  default_permissions text[] not null default '{}',
  default_autonomy public.autonomy_level not null default 'draft',
  system_prompt text not null default '',
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);

create table public.ai_employees (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  template_id uuid references public.ai_employee_templates (id) on delete set null,
  name text not null check (char_length(name) between 1 and 80),
  avatar_seed text not null default '',
  job_title text not null check (char_length(job_title) between 1 and 120),
  department_id uuid references public.departments (id) on delete set null,
  manager_member_id uuid references public.organization_members (id) on delete set null,
  role_description text not null default '',
  responsibilities jsonb not null default '[]'::jsonb,
  skills jsonb not null default '[]'::jsonb,
  goals jsonb not null default '[]'::jsonb,
  instructions text not null default '',
  status public.ai_employee_status not null default 'idle',
  autonomy public.autonomy_level not null default 'draft',
  provider text not null default 'anthropic',
  model text not null,
  is_active boolean not null default true,
  created_by uuid references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index ai_employees_org_idx on public.ai_employees (organization_id) where deleted_at is null;
create trigger ai_employees_updated_at before update on public.ai_employees for each row execute function public.set_updated_at();

alter table public.departments
  add constraint departments_lead_ai_fk foreign key (lead_ai_employee_id) references public.ai_employees (id) on delete set null;

-- Explicit capability grants. NOTE: there is deliberately no capability for private files.
create table public.ai_employee_permissions (
  ai_employee_id uuid primary key references public.ai_employees (id) on delete cascade,
  organization_id uuid not null references public.organizations (id) on delete cascade,
  permissions text[] not null default '{}',
  -- Empty = no folder restriction beyond `files.shared.view`; otherwise AI may only read files within these shared folders.
  allowed_folder_ids uuid[] not null default '{}',
  updated_by uuid references auth.users (id),
  updated_at timestamptz not null default now(),
  constraint ai_permissions_no_private check (not (permissions && array['files.private.view', 'files.private.use']::text[]))
);

create table public.ai_workspaces (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  ai_employee_id uuid not null unique references public.ai_employees (id) on delete cascade,
  notes text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger ai_workspaces_updated_at before update on public.ai_workspaces for each row execute function public.set_updated_at();

create table public.ai_computers (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  ai_employee_id uuid not null unique references public.ai_employees (id) on delete cascade,
  provider text not null,
  provider_ref text,
  status text not null default 'ready' check (status in ('ready', 'busy', 'error', 'disabled')),
  capabilities jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger ai_computers_updated_at before update on public.ai_computers for each row execute function public.set_updated_at();

/* ------------------------------ Goals / missions / projects / tasks ------------------------------ */

create table public.goals (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  title text not null check (char_length(title) between 1 and 200),
  description text not null default '',
  metric text not null default '',
  current_value numeric not null default 0,
  target_value numeric not null default 100,
  deadline date,
  owner_member_id uuid references public.organization_members (id) on delete set null,
  status public.goal_status not null default 'on_track',
  created_by uuid references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index goals_org_idx on public.goals (organization_id) where deleted_at is null;
create trigger goals_updated_at before update on public.goals for each row execute function public.set_updated_at();

create table public.missions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  goal_id uuid references public.goals (id) on delete set null,
  title text not null check (char_length(title) between 1 and 200),
  description text not null default '',
  objective text not null default '',
  owner_member_id uuid references public.organization_members (id) on delete set null,
  priority public.priority_level not null default 'medium',
  status public.work_status not null default 'planned',
  progress int not null default 0 check (progress between 0 and 100),
  start_date date,
  due_date date,
  milestones jsonb not null default '[]'::jsonb,
  risks jsonb not null default '[]'::jsonb,
  ai_summary text,
  ai_summary_at timestamptz,
  created_by uuid references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index missions_org_idx on public.missions (organization_id) where deleted_at is null;
create trigger missions_updated_at before update on public.missions for each row execute function public.set_updated_at();

create table public.mission_dependencies (
  mission_id uuid not null references public.missions (id) on delete cascade,
  depends_on_mission_id uuid not null references public.missions (id) on delete cascade,
  organization_id uuid not null references public.organizations (id) on delete cascade,
  primary key (mission_id, depends_on_mission_id),
  check (mission_id <> depends_on_mission_id)
);

create table public.mission_departments (
  mission_id uuid not null references public.missions (id) on delete cascade,
  department_id uuid not null references public.departments (id) on delete cascade,
  organization_id uuid not null references public.organizations (id) on delete cascade,
  primary key (mission_id, department_id)
);

create table public.mission_employees (
  id uuid primary key default gen_random_uuid(),
  mission_id uuid not null references public.missions (id) on delete cascade,
  organization_id uuid not null references public.organizations (id) on delete cascade,
  member_id uuid references public.organization_members (id) on delete cascade,
  ai_employee_id uuid references public.ai_employees (id) on delete cascade,
  check ((member_id is null) <> (ai_employee_id is null))
);
create unique index mission_employees_unique on public.mission_employees (mission_id, coalesce(member_id, ai_employee_id));

create table public.projects (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  mission_id uuid references public.missions (id) on delete set null,
  department_id uuid references public.departments (id) on delete set null,
  title text not null check (char_length(title) between 1 and 200),
  description text not null default '',
  owner_member_id uuid references public.organization_members (id) on delete set null,
  status public.work_status not null default 'planned',
  priority public.priority_level not null default 'medium',
  progress int not null default 0 check (progress between 0 and 100),
  start_date date,
  due_date date,
  milestones jsonb not null default '[]'::jsonb,
  created_by uuid references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index projects_org_idx on public.projects (organization_id, status) where deleted_at is null;
create trigger projects_updated_at before update on public.projects for each row execute function public.set_updated_at();

create table public.project_members (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  organization_id uuid not null references public.organizations (id) on delete cascade,
  member_id uuid references public.organization_members (id) on delete cascade,
  ai_employee_id uuid references public.ai_employees (id) on delete cascade,
  check ((member_id is null) <> (ai_employee_id is null))
);
create unique index project_members_unique on public.project_members (project_id, coalesce(member_id, ai_employee_id));

create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  project_id uuid references public.projects (id) on delete set null,
  mission_id uuid references public.missions (id) on delete set null,
  parent_task_id uuid references public.tasks (id) on delete cascade,
  title text not null check (char_length(title) between 1 and 300),
  description text not null default '',
  assignee_member_id uuid references public.organization_members (id) on delete set null,
  assignee_ai_employee_id uuid references public.ai_employees (id) on delete set null,
  creator_user_id uuid references auth.users (id),
  creator_ai_employee_id uuid references public.ai_employees (id) on delete set null,
  priority public.priority_level not null default 'medium',
  status public.task_status not null default 'todo',
  due_date timestamptz,
  tags text[] not null default '{}',
  requires_approval boolean not null default false,
  sort_order double precision not null default 0,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  check (not (assignee_member_id is not null and assignee_ai_employee_id is not null))
);
create index tasks_org_status_idx on public.tasks (organization_id, status) where deleted_at is null;
create index tasks_project_idx on public.tasks (project_id) where deleted_at is null;
create index tasks_ai_assignee_idx on public.tasks (assignee_ai_employee_id) where deleted_at is null;
create index tasks_title_trgm on public.tasks using gin (title gin_trgm_ops);
create trigger tasks_updated_at before update on public.tasks for each row execute function public.set_updated_at();

create table public.task_dependencies (
  task_id uuid not null references public.tasks (id) on delete cascade,
  depends_on_task_id uuid not null references public.tasks (id) on delete cascade,
  organization_id uuid not null references public.organizations (id) on delete cascade,
  primary key (task_id, depends_on_task_id),
  check (task_id <> depends_on_task_id)
);

create table public.task_comments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  task_id uuid not null references public.tasks (id) on delete cascade,
  author_user_id uuid references auth.users (id),
  author_ai_employee_id uuid references public.ai_employees (id) on delete set null,
  body text not null check (char_length(body) between 1 and 10000),
  mentions uuid[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  check ((author_user_id is null) <> (author_ai_employee_id is null))
);
create index task_comments_task_idx on public.task_comments (task_id, created_at);

create table public.meetings (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  title text not null check (char_length(title) between 1 and 200),
  scheduled_at timestamptz not null,
  duration_minutes int not null default 60,
  agenda text not null default '',
  notes text not null default '',
  summary text,
  decisions_extracted jsonb not null default '[]'::jsonb,
  action_items jsonb not null default '[]'::jsonb,
  project_id uuid references public.projects (id) on delete set null,
  mission_id uuid references public.missions (id) on delete set null,
  created_by uuid references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index meetings_org_idx on public.meetings (organization_id, scheduled_at desc) where deleted_at is null;
create trigger meetings_updated_at before update on public.meetings for each row execute function public.set_updated_at();

create table public.meeting_participants (
  id uuid primary key default gen_random_uuid(),
  meeting_id uuid not null references public.meetings (id) on delete cascade,
  organization_id uuid not null references public.organizations (id) on delete cascade,
  member_id uuid references public.organization_members (id) on delete cascade,
  ai_employee_id uuid references public.ai_employees (id) on delete cascade,
  check ((member_id is null) <> (ai_employee_id is null))
);

create table public.documents (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  title text not null check (char_length(title) between 1 and 300),
  doc_type public.document_type not null default 'general',
  content text not null default '',
  current_version int not null default 1,
  project_id uuid references public.projects (id) on delete set null,
  mission_id uuid references public.missions (id) on delete set null,
  department_id uuid references public.departments (id) on delete set null,
  created_by_user_id uuid references auth.users (id),
  created_by_ai_employee_id uuid references public.ai_employees (id) on delete set null,
  status text not null default 'published' check (status in ('draft', 'pending_approval', 'published', 'archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index documents_org_idx on public.documents (organization_id, updated_at desc) where deleted_at is null;
create index documents_title_trgm on public.documents using gin (title gin_trgm_ops);
create trigger documents_updated_at before update on public.documents for each row execute function public.set_updated_at();

create table public.document_versions (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.documents (id) on delete cascade,
  organization_id uuid not null references public.organizations (id) on delete cascade,
  version int not null,
  title text not null,
  content text not null,
  change_summary text,
  created_by_user_id uuid references auth.users (id),
  created_by_ai_employee_id uuid references public.ai_employees (id) on delete set null,
  created_at timestamptz not null default now(),
  unique (document_id, version)
);

create table public.decisions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  title text not null check (char_length(title) between 1 and 300),
  context text not null default '',
  options jsonb not null default '[]'::jsonb,
  chosen_option text not null default '',
  reasoning text not null default '',
  decided_by_user_id uuid references auth.users (id),
  related_entity_type text,
  related_entity_id uuid,
  impact text not null default 'medium' check (impact in ('low', 'medium', 'high')),
  status public.decision_status not null default 'decided',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index decisions_org_idx on public.decisions (organization_id, created_at desc) where deleted_at is null;
create trigger decisions_updated_at before update on public.decisions for each row execute function public.set_updated_at();

create table public.memories (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  memory_type public.memory_type not null,
  title text not null check (char_length(title) between 1 and 300),
  content text not null,
  department_id uuid references public.departments (id) on delete set null,
  project_id uuid references public.projects (id) on delete set null,
  ai_employee_id uuid references public.ai_employees (id) on delete cascade,
  tags text[] not null default '{}',
  pinned boolean not null default false,
  archived_at timestamptz,
  source text not null default 'human' check (source in ('human', 'ai', 'system')),
  created_by_user_id uuid references auth.users (id),
  embedding vector(1024),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index memories_org_idx on public.memories (organization_id, memory_type) where archived_at is null;
create index memories_title_trgm on public.memories using gin (title gin_trgm_ops);
create trigger memories_updated_at before update on public.memories for each row execute function public.set_updated_at();

-- Knowledge chunks for semantic search (populated only when an embedding provider is configured).
create table public.knowledge_chunks (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  source_type text not null check (source_type in ('document', 'memory', 'decision', 'shared_file', 'ai_output')),
  source_id uuid not null,
  chunk_index int not null,
  content text not null,
  embedding vector(1024),
  created_at timestamptz not null default now(),
  unique (source_type, source_id, chunk_index)
);
create index knowledge_chunks_org_idx on public.knowledge_chunks (organization_id);
