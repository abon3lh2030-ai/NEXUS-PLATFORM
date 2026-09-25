-- NEXUS Platform — 0006: Row Level Security, Storage policies, Realtime
--
-- Model:
--   * The browser uses Supabase only for Auth + Realtime subscriptions + (defense-in-depth) reads.
--   * All writes go through the NEXUS API, which authorizes every request and then writes
--     with the service role. Therefore `authenticated` gets SELECT policies only (plus a few
--     self-service updates), and NO insert/update/delete policies on business tables.
--   * The API ALSO reads files/folders with the caller's JWT so that RLS + Storage policies
--     are enforced a second time for file access.

do $$
declare
  t text;
begin
  foreach t in array array[
    'profiles', 'platform_admins', 'organizations', 'organization_members', 'organization_invitations',
    'organization_role_permissions', 'company_applications', 'departments', 'ai_employee_templates',
    'ai_employees', 'ai_employee_permissions', 'ai_workspaces', 'ai_computers', 'goals', 'missions',
    'mission_dependencies', 'mission_departments', 'mission_employees', 'projects', 'project_members', 'tasks',
    'task_dependencies', 'task_comments', 'meetings', 'meeting_participants', 'documents', 'document_versions',
    'decisions', 'memories', 'knowledge_chunks', 'ai_work_sessions', 'ai_session_events', 'approvals',
    'approval_comments', 'ai_tool_executions', 'ai_computer_sessions', 'ai_outputs', 'ai_employee_inbox',
    'ai_employee_messages', 'nexus_conversations', 'nexus_messages', 'company_file_folders', 'company_files',
    'file_links', 'file_access_rules', 'file_activity_events', 'file_recent_views', 'notifications',
    'activity_events', 'audit_logs', 'subscription_plans', 'subscriptions', 'enterprise_requests',
    'enterprise_offers', 'payment_transactions', 'billing_events', 'usage_counters', 'ai_usage_events',
    'email_outbox', 'contact_messages'
  ]
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
    execute format('revoke insert, update, delete on public.%I from anon, authenticated', t);
  end loop;
end;
$$;

/* ------------------------------ Identity ------------------------------ */

create policy profiles_select on public.profiles for select to authenticated using (
  id = auth.uid()
  or exists (
    select 1 from public.organization_members me
    join public.organization_members them on them.organization_id = me.organization_id
    where me.user_id = auth.uid() and me.status = 'active' and them.user_id = profiles.id and them.status = 'active'
  )
);
grant update (full_name, avatar_url, locale, theme) on public.profiles to authenticated;
create policy profiles_update_own on public.profiles for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

create policy platform_admins_self on public.platform_admins for select to authenticated using (user_id = auth.uid());

create policy organizations_select on public.organizations for select to authenticated
  using (public.is_org_member(id) or public.is_super_admin());

create policy organization_members_select on public.organization_members for select to authenticated
  using (public.is_org_member(organization_id) or user_id = auth.uid());

create policy organization_invitations_select on public.organization_invitations for select to authenticated
  using (public.has_org_role(organization_id, array['owner', 'admin']::public.member_role[]));

create policy organization_role_permissions_select on public.organization_role_permissions for select to authenticated
  using (public.is_org_member(organization_id));

create policy company_applications_select on public.company_applications for select to authenticated
  using (user_id = auth.uid() or public.is_super_admin());

/* ------------------------------ Org-scoped business tables (read for members) ------------------------------ */

do $$
declare
  t text;
begin
  foreach t in array array[
    'departments', 'ai_employees', 'ai_employee_permissions', 'ai_workspaces', 'ai_computers', 'goals', 'missions',
    'mission_dependencies', 'mission_departments', 'mission_employees', 'projects', 'project_members', 'tasks',
    'task_dependencies', 'task_comments', 'meetings', 'meeting_participants', 'documents', 'document_versions',
    'decisions', 'memories', 'knowledge_chunks', 'ai_work_sessions', 'ai_session_events', 'approvals',
    'approval_comments', 'ai_tool_executions', 'ai_computer_sessions', 'ai_outputs', 'ai_employee_inbox',
    'ai_employee_messages', 'file_links', 'activity_events'
  ]
  loop
    execute format(
      'create policy %I on public.%I for select to authenticated using (public.is_org_member(organization_id))',
      t || '_member_select', t
    );
  end loop;
end;
$$;

create policy ai_employee_templates_select on public.ai_employee_templates for select to authenticated using (true);

/* ------------------------------ Private, per-user data ------------------------------ */

create policy nexus_conversations_own on public.nexus_conversations for select to authenticated
  using (user_id = auth.uid() and public.is_org_member(organization_id));
create policy nexus_messages_own on public.nexus_messages for select to authenticated
  using (user_id = auth.uid() and public.is_org_member(organization_id));
create policy notifications_own on public.notifications for select to authenticated using (user_id = auth.uid());
create policy file_recent_views_own on public.file_recent_views for select to authenticated using (user_id = auth.uid());

/* ------------------------------ Company files (critical isolation) ------------------------------ */

-- Folders: shared folders visible to org members; private folders ONLY to their owner.
create policy company_file_folders_select on public.company_file_folders for select to authenticated using (
  public.is_org_member(organization_id)
  and (
    (space = 'shared' and visibility = 'organization_shared')
    or (space = 'shared' and visibility = 'restricted' and (
      public.has_org_role(organization_id, array['owner', 'admin']::public.member_role[])
      or exists (
        select 1 from public.file_access_rules r
        where r.folder_id = company_file_folders.id and r.can_view
          and (r.user_id = auth.uid() or r.member_role = public.org_role(company_file_folders.organization_id))
      )
    ))
    or (space = 'private' and visibility = 'private_owner' and owner_user_id = auth.uid())
    or (space = 'ai_workspace' and public.has_org_role(organization_id, array['owner', 'admin', 'manager']::public.member_role[]))
  )
);

-- Files: identical logic. Private files are visible to NOBODY but owner_user_id — including other admins
-- and the organization owner. AI employees have no auth identity and cannot pass this policy.
create policy company_files_select on public.company_files for select to authenticated using (
  public.is_org_member(organization_id)
  and purged_at is null
  and (
    (space = 'shared' and visibility = 'organization_shared')
    or (space = 'shared' and visibility = 'restricted' and (
      public.has_org_role(organization_id, array['owner', 'admin']::public.member_role[])
      or exists (
        select 1 from public.file_access_rules r
        where (r.file_id = company_files.id or r.folder_id = company_files.folder_id) and r.can_view
          and (r.user_id = auth.uid() or r.member_role = public.org_role(company_files.organization_id))
      )
    ))
    or (space = 'private' and visibility = 'private_owner' and owner_user_id = auth.uid())
    or (space = 'ai_workspace' and public.has_org_role(organization_id, array['owner', 'admin', 'manager']::public.member_role[]))
  )
);

create policy file_access_rules_select on public.file_access_rules for select to authenticated
  using (public.has_org_role(organization_id, array['owner', 'admin']::public.member_role[]));

-- File activity: private activity only to its owner; shared activity to owner/admin/manager.
create policy file_activity_events_select on public.file_activity_events for select to authenticated using (
  public.is_org_member(organization_id)
  and (
    (space = 'private' and owner_user_id = auth.uid())
    or (space <> 'private' and public.has_org_role(organization_id, array['owner', 'admin', 'manager']::public.member_role[]))
  )
);

/* ------------------------------ Governance & billing ------------------------------ */

create policy audit_logs_select on public.audit_logs for select to authenticated
  using (organization_id is not null and public.has_org_role(organization_id, array['owner', 'admin']::public.member_role[]));

create policy subscription_plans_public on public.subscription_plans for select to anon, authenticated using (is_public);

create policy subscriptions_select on public.subscriptions for select to authenticated using (public.is_org_member(organization_id));

create policy payment_transactions_select on public.payment_transactions for select to authenticated
  using (public.has_org_role(organization_id, array['owner', 'admin']::public.member_role[]));
create policy billing_events_select on public.billing_events for select to authenticated
  using (public.has_org_role(organization_id, array['owner', 'admin']::public.member_role[]));
create policy usage_counters_select on public.usage_counters for select to authenticated using (public.is_org_member(organization_id));
create policy ai_usage_events_select on public.ai_usage_events for select to authenticated
  using (public.has_org_role(organization_id, array['owner', 'admin', 'manager']::public.member_role[]));

create policy enterprise_requests_select on public.enterprise_requests for select to authenticated
  using (user_id = auth.uid() or public.is_super_admin());
create policy enterprise_offers_select on public.enterprise_offers for select to authenticated using (
  public.is_super_admin()
  or exists (select 1 from public.enterprise_requests r where r.id = enterprise_offers.request_id and r.user_id = auth.uid())
);
-- email_outbox, contact_messages: no policies → no client access at all.

/* ------------------------------ Storage ------------------------------ */

insert into storage.buckets (id, name, public, file_size_limit)
values ('company-files', 'company-files', false, 262144000) -- hard ceiling 250 MB; per-plan limits enforced by API
on conflict (id) do update set public = false;

-- Object paths:  {org_id}/shared/{file_id}
--                {org_id}/private/{owner_user_id}/{file_id}
--                {org_id}/ai/{ai_employee_id}/{file_id}
-- Reads require BOTH a path match AND a live company_files row the caller may see. Knowing the
-- storage key or file UUID alone grants nothing; soft-deleted files are not readable.
create policy company_files_objects_select on storage.objects for select to authenticated using (
  bucket_id = 'company-files'
  and public.is_org_member_text((storage.foldername(name))[1])
  and exists (
    select 1 from public.company_files f
    where f.storage_key = storage.objects.name
      and f.deleted_at is null
      and f.purged_at is null
      and f.status = 'ready'
      and (
        (f.space = 'shared' and (storage.foldername(name))[2] = 'shared'
          and (f.visibility = 'organization_shared'
               or public.has_org_role(f.organization_id, array['owner', 'admin']::public.member_role[])))
        or (f.space = 'private' and (storage.foldername(name))[2] = 'private'
          and (storage.foldername(name))[3] = auth.uid()::text
          and f.owner_user_id = auth.uid())
        or (f.space = 'ai_workspace' and (storage.foldername(name))[2] = 'ai'
          and public.has_org_role(f.organization_id, array['owner', 'admin', 'manager']::public.member_role[]))
      )
  )
);
-- No INSERT/UPDATE/DELETE policies for clients on storage.objects: uploads use short-lived signed
-- upload URLs minted by the API after authorization, and deletes are performed by the API.

/* ------------------------------ Realtime ------------------------------ */

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table
      public.ai_work_sessions, public.ai_session_events, public.ai_tool_executions,
      public.ai_employees, public.notifications, public.approvals;
  end if;
end;
$$;
