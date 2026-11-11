-- NEXUS Platform — 0018: internal video meetings inside NEXUS (owner request 2026-11-11).
-- Audio/video go peer-to-peer between browsers (no media service, no per-minute cost); the API only
-- relays signaling. Live captions from the room are saved like any other transcript line.

alter table public.meeting_transcripts drop constraint if exists meeting_transcripts_source_check;
alter table public.meeting_transcripts add constraint meeting_transcripts_source_check check (source in ('manual', 'provider', 'live'));
