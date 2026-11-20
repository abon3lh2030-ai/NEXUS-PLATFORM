-- NEXUS Platform — 0024: meetings move to LiveKit (owner decision 2026-11-20).
-- Replaces Recall.ai (never used in production: 0 sessions) and the in-house peer-to-peer rooms.
-- One LiveKit room per NEXUS meeting; the AI employee joins as a LiveKit Agents participant.
-- Existing columns used by the old meeting-bot flow (meeting_sessions.provider_bot_id, bot_deadline)
-- are KEPT until the owner confirms they can be dropped.

/* ───────── Rooms ───────── */

create table public.meeting_rooms (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  meeting_id uuid not null unique references public.meetings (id) on delete cascade,
  -- LiveKit room name; derived from the meeting id, never from user input.
  room_name text not null unique check (room_name ~ '^m_[0-9a-f-]{36}$'),
  status text not null default 'created' check (status in ('created', 'active', 'ended')),
  livekit_room_sid text,
  started_at timestamptz,
  ended_at timestamptz,
  -- Set when the AI employee is dispatched for the current session (cleared when the room ends).
  agent_dispatched_at timestamptz,
  agent_ai_employee_id uuid references public.ai_employees (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index meeting_rooms_org_idx on public.meeting_rooms (organization_id);

-- Webhook events from LiveKit (room started/finished, participant joined/left, egress). Idempotent on event id.
create table public.meeting_room_events (
  id bigint generated always as identity primary key,
  organization_id uuid not null references public.organizations (id) on delete cascade,
  meeting_id uuid not null references public.meetings (id) on delete cascade,
  event_id text not null unique,
  event text not null,
  participant_identity text,
  participant_name text,
  member_id uuid references public.organization_members (id) on delete set null,
  is_agent boolean not null default false,
  created_at timestamptz not null default now()
);
create index meeting_room_events_meeting_idx on public.meeting_room_events (meeting_id, id);

/* ───────── Recordings (LiveKit Egress → Supabase Storage, private bucket, per-company path) ───────── */

create table public.meeting_recordings (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  meeting_id uuid not null references public.meetings (id) on delete cascade,
  egress_id text not null unique,
  -- Always "<organization_id>/<meeting_id>/<file>" inside the meeting-recordings bucket.
  storage_path text not null check (storage_path ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}/[A-Za-z0-9._-]+$'),
  status text not null default 'recording' check (status in ('recording', 'ready', 'failed', 'deleted')),
  size_bytes bigint check (size_bytes >= 0),
  duration_seconds int check (duration_seconds >= 0),
  failure_reason text,
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  expires_at timestamptz,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  check (split_part(storage_path, '/', 1) = organization_id::text and split_part(storage_path, '/', 2) = meeting_id::text)
);
create index meeting_recordings_meeting_idx on public.meeting_recordings (meeting_id);
create index meeting_recordings_expiry_idx on public.meeting_recordings (expires_at) where status = 'ready';

-- How long recordings are kept, per company (the transcript retention already lives here).
alter table public.communication_policies
  add column if not exists recording_retention_days int not null default 30 check (recording_retention_days between 1 and 3650);

/* ───────── Transcripts: live lines from the meeting agent, linked to the NEXUS member ───────── */

alter table public.meeting_transcripts drop constraint if exists meeting_transcripts_source_check;
alter table public.meeting_transcripts add constraint meeting_transcripts_source_check check (source in ('manual', 'provider', 'live', 'livekit'));
alter table public.meeting_transcripts
  add column if not exists speaker_member_id uuid references public.organization_members (id) on delete set null,
  add column if not exists speaker_ai_employee_id uuid references public.ai_employees (id) on delete set null;

/* ───────── Summary queue: summaries wait here until an AI key is available ───────── */

create table public.meeting_ai_jobs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  meeting_id uuid not null references public.meetings (id) on delete cascade,
  kind text not null default 'summarize' check (kind in ('summarize')),
  status text not null default 'pending' check (status in ('pending', 'running', 'done', 'failed')),
  attempts int not null default 0,
  last_error text,
  ai_employee_id uuid references public.ai_employees (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  done_at timestamptz
);
create unique index meeting_ai_jobs_one_open on public.meeting_ai_jobs (meeting_id, kind) where status in ('pending', 'running');
create index meeting_ai_jobs_pending_idx on public.meeting_ai_jobs (created_at) where status = 'pending';

/* ───────── Data from the old flow ─────────
   Transcripts and summaries already live in meeting_transcripts / meeting_summaries, which stay the
   home for both the old and the new flow. Old provider transcripts (Recall) are linked to the
   member whose display name matches, so the new speaker attribution also covers them.
   On 2026-11-20 there were 0 such rows; the statement is kept for completeness. */
update public.meeting_transcripts t
set speaker_member_id = m.id
from public.organization_members m
join public.profiles p on p.id = m.user_id
where t.source = 'provider' and t.speaker_member_id is null
  and m.organization_id = t.organization_id and t.speaker is not null
  and lower(trim(p.full_name)) = lower(trim(t.speaker));

/* ───────── updated_at, RLS ───────── */

create trigger meeting_rooms_updated_at before update on public.meeting_rooms for each row execute function public.set_updated_at();
create trigger meeting_ai_jobs_updated_at before update on public.meeting_ai_jobs for each row execute function public.set_updated_at();

do $$
declare t text;
begin
  foreach t in array array['meeting_rooms', 'meeting_room_events', 'meeting_recordings', 'meeting_ai_jobs'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
    execute format('revoke insert, update, delete on public.%I from anon, authenticated', t);
    execute format('revoke all on public.%I from anon', t);
  end loop;
end;
$$;
-- Members of the company can see their own rooms and room events; recordings only managers; the AI queue nobody.
create policy meeting_rooms_member_select on public.meeting_rooms for select to authenticated using (public.is_org_member(organization_id));
create policy meeting_room_events_member_select on public.meeting_room_events for select to authenticated using (public.is_org_member(organization_id));
create policy meeting_recordings_manager_select on public.meeting_recordings for select to authenticated
  using (public.has_org_role(organization_id, array['owner', 'admin', 'manager']::public.member_role[]));
revoke all on public.meeting_ai_jobs from authenticated;

-- Private bucket; no storage policies: only the API (service role) reads it, through short-lived signed URLs.
insert into storage.buckets (id, name, public, file_size_limit)
values ('meeting-recordings', 'meeting-recordings', false, 2147483648)
on conflict (id) do update set public = false;

/* ───────── Founder Portal: record the provider change truthfully ───────── */
update public.founder_ti_services
set provider = 'LiveKit Cloud', ownership = 'external', status = 'planned', verified = true,
    evidence = 'الاجتماعات انتقلت إلى LiveKit Cloud بقرار المالك (2026-11-20). مفاتيح LiveKit لم تُضف بعد.',
    notes = 'LiveKit مفتوح المصدر ويمكن استضافته ذاتيًا لاحقًا.', target_phase_id = (select id from public.founder_ti_phases where code = 'y2_mac')
where capability = 'اجتماعات الفيديو' and ownership = 'owned';
insert into public.founder_ti_services (capability, provider, ownership, status, target_phase_id, weight, verified, notes)
select 'اجتماعات الفيديو', 'LiveKit مستضاف ذاتيًا', 'owned', 'planned', id, 1, false, 'نفس الكود، خادم LiveKit على أجهزتنا.'
from public.founder_ti_phases where code = 'y2_mac'
  and not exists (select 1 from public.founder_ti_services where capability = 'اجتماعات الفيديو' and ownership = 'owned');
update public.founder_ti_services
set provider = 'ElevenLabs (Scribe)', status = 'planned', verified = true, evidence = 'اختيار المالك 2026-11-20؛ خلف واجهة STTProvider ويمكن استبداله بالمحلي.'
where capability = 'تحويل الصوت إلى نص' and ownership = 'external';
update public.founder_ti_services
set provider = 'ElevenLabs', status = 'planned', verified = true, evidence = 'اختيار المالك 2026-11-20؛ خلف واجهة TTSProvider ويمكن استبداله بالمحلي (NAMAA).'
where capability = 'توليد الصوت' and ownership = 'external';
