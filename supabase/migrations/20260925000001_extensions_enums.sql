-- NEXUS Platform — 0001: extensions & enums
-- Keep enum values in sync with packages/shared/src/enums.ts

create extension if not exists pgcrypto;
create extension if not exists pg_trgm;
create extension if not exists vector;

create type public.member_role as enum ('owner', 'admin', 'manager', 'member', 'viewer');
create type public.organization_status as enum ('active', 'suspended', 'closed');
create type public.verification_status as enum ('pending', 'verified', 'rejected');
create type public.membership_status as enum ('active', 'removed');

create type public.ai_employee_status as enum (
  'offline', 'idle', 'queued', 'preparing', 'thinking', 'researching', 'reading',
  'writing', 'executing', 'waiting', 'waiting_approval', 'blocked', 'completed', 'failed'
);
create type public.work_session_status as enum (
  'queued', 'preparing', 'running', 'paused', 'waiting_approval', 'completed', 'failed', 'cancelled'
);
create type public.autonomy_level as enum ('suggest', 'draft', 'execute_internal', 'autonomous');
create type public.tool_execution_status as enum ('denied', 'pending_approval', 'running', 'succeeded', 'failed');
create type public.tool_risk as enum ('low', 'medium', 'high');

create type public.task_status as enum ('backlog', 'todo', 'in_progress', 'review', 'blocked', 'done');
create type public.priority_level as enum ('low', 'medium', 'high', 'urgent');
create type public.work_status as enum ('planned', 'active', 'on_hold', 'blocked', 'completed', 'cancelled');
create type public.goal_status as enum ('on_track', 'at_risk', 'off_track', 'achieved', 'archived');
create type public.document_type as enum ('strategy', 'research', 'specification', 'report', 'meeting_notes', 'plan', 'general');
create type public.decision_status as enum ('proposed', 'decided', 'superseded', 'reverted');
create type public.memory_type as enum ('company', 'department', 'project', 'employee', 'decision', 'preference', 'lesson');
create type public.approval_status as enum ('pending', 'approved', 'rejected', 'revision_requested');

create type public.file_visibility as enum ('organization_shared', 'private_owner', 'restricted');
create type public.file_space as enum ('shared', 'private', 'ai_workspace');
create type public.file_status as enum ('uploading', 'processing', 'ready', 'failed');
create type public.scan_status as enum ('not_scanned', 'clean', 'infected', 'error');

create type public.subscription_status as enum ('pending', 'active', 'expired', 'cancelled');
create type public.payment_status as enum ('initiated', 'paid', 'failed', 'refunded');
create type public.enterprise_request_status as enum ('pending', 'approved', 'rejected', 'converted');
create type public.offer_status as enum ('offered', 'paid', 'expired', 'withdrawn');

-- Generic updated_at trigger
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;
