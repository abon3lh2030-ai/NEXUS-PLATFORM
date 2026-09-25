-- NEXUS Platform — 0002: identity, organizations & multi-tenancy helpers

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text not null default '' check (char_length(full_name) <= 120),
  email text,
  avatar_url text,
  locale text not null default 'ar' check (locale in ('ar', 'en')),
  theme text not null default 'system' check (theme in ('light', 'dark', 'system')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger profiles_updated_at before update on public.profiles for each row execute function public.set_updated_at();

-- Auto-create a profile for each new auth user.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name, locale)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'full_name', ''),
    case when new.raw_user_meta_data ->> 'locale' in ('ar', 'en') then new.raw_user_meta_data ->> 'locale' else 'ar' end
  )
  on conflict (id) do nothing;
  return new;
end;
$$;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user();

-- Platform super admins. Rows can ONLY be created with the service role / SQL editor.
-- There is no API or policy that lets a user grant themselves this role.
create table public.platform_admins (
  user_id uuid primary key references auth.users (id) on delete cascade,
  granted_by text not null default 'sql',
  created_at timestamptz not null default now()
);

create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 160),
  commercial_registration text not null check (commercial_registration ~ '^[1-7][0-9]{9}$'),
  website text,
  industry text,
  company_size text,
  country text not null default 'SA' check (country = 'SA'),
  status public.organization_status not null default 'active',
  verification_status public.verification_status not null default 'pending',
  owner_user_id uuid not null references auth.users (id),
  default_locale text not null default 'ar' check (default_locale in ('ar', 'en')),
  settings jsonb not null default '{}'::jsonb,
  closed_at timestamptz,
  closed_by uuid references auth.users (id),
  close_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint closed_fields check ((status = 'closed') = (closed_at is not null))
);
-- One live organization per CR number
create unique index organizations_cr_unique on public.organizations (commercial_registration) where status <> 'closed';
create index organizations_owner_idx on public.organizations (owner_user_id);
create trigger organizations_updated_at before update on public.organizations for each row execute function public.set_updated_at();

create table public.organization_members (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role public.member_role not null,
  status public.membership_status not null default 'active',
  department_id uuid,
  job_title text check (char_length(job_title) <= 120),
  invited_by uuid references auth.users (id),
  joined_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, user_id)
);
create index organization_members_user_idx on public.organization_members (user_id) where status = 'active';
create unique index organization_members_single_owner on public.organization_members (organization_id) where role = 'owner' and status = 'active';
create trigger organization_members_updated_at before update on public.organization_members for each row execute function public.set_updated_at();

create table public.organization_invitations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  email text not null,
  role public.member_role not null check (role <> 'owner'),
  token_hash text not null unique,
  invited_by uuid not null references auth.users (id),
  expires_at timestamptz not null,
  accepted_at timestamptz,
  accepted_by uuid references auth.users (id),
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);
create index organization_invitations_org_idx on public.organization_invitations (organization_id);

-- Per-organization configurable role permissions (overrides of the default matrix in @nexus/shared).
create table public.organization_role_permissions (
  organization_id uuid not null references public.organizations (id) on delete cascade,
  role public.member_role not null check (role <> 'owner'),
  permission text not null,
  allowed boolean not null,
  updated_by uuid references auth.users (id),
  updated_at timestamptz not null default now(),
  primary key (organization_id, role, permission)
);

create table public.company_applications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  organization_id uuid references public.organizations (id) on delete set null,
  company_name text not null,
  commercial_registration text not null check (commercial_registration ~ '^[1-7][0-9]{9}$'),
  website text,
  applicant_name text not null,
  work_email text not null,
  applicant_role text not null,
  industry text not null,
  company_size text not null,
  note text not null default '',
  confirmed_saudi_registered boolean not null check (confirmed_saudi_registered),
  status public.verification_status not null default 'pending',
  reviewed_by uuid references auth.users (id),
  reviewed_at timestamptz,
  review_note text,
  created_at timestamptz not null default now()
);
create index company_applications_status_idx on public.company_applications (status, created_at desc);

/* ----------------------------- RLS helpers ----------------------------- */
-- SECURITY DEFINER so they can read membership without recursive RLS evaluation.

create or replace function public.is_super_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.platform_admins where user_id = auth.uid());
$$;

create or replace function public.is_org_member(org uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.organization_members m
    join public.organizations o on o.id = m.organization_id
    where m.organization_id = org
      and m.user_id = auth.uid()
      and m.status = 'active'
      and o.status <> 'closed'
  );
$$;

create or replace function public.org_role(org uuid)
returns public.member_role
language sql
stable
security definer
set search_path = public
as $$
  select m.role from public.organization_members m
  where m.organization_id = org and m.user_id = auth.uid() and m.status = 'active';
$$;

create or replace function public.has_org_role(org uuid, roles public.member_role[])
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(public.org_role(org) = any (roles), false) and public.is_org_member(org);
$$;

/** Text variant for storage paths (avoids cast errors on malformed object names). */
create or replace function public.is_org_member_text(org_text text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.organization_members m
    join public.organizations o on o.id = m.organization_id
    where m.organization_id::text = org_text
      and m.user_id = auth.uid()
      and m.status = 'active'
      and o.status <> 'closed'
  );
$$;

revoke all on function public.is_org_member(uuid) from public;
revoke all on function public.org_role(uuid) from public;
revoke all on function public.has_org_role(uuid, public.member_role[]) from public;
revoke all on function public.is_org_member_text(text) from public;
revoke all on function public.is_super_admin() from public;
grant execute on function public.is_org_member(uuid) to authenticated;
grant execute on function public.org_role(uuid) to authenticated;
grant execute on function public.has_org_role(uuid, public.member_role[]) to authenticated;
grant execute on function public.is_org_member_text(text) to authenticated;
grant execute on function public.is_super_admin() to authenticated;
