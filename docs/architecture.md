# Architecture notes

- **Request path:** Browser (Supabase JWT) → Fastify `orgGuard` (verify JWT with Supabase Auth, load
  membership, resolve permissions + entitlements, enforce subscription) → service → Postgres (service role)
  with explicit organization scoping. File reads use the caller's JWT so RLS/Storage policies apply twice.
- **AI runtime:** `AgentRuntime` claims queued sessions (`claim_next_work_session`, SKIP LOCKED), runs a
  structured-output loop, gates every tool through `evaluateToolCall`, persists a timeline, and pauses for
  human approval when required. Stale sessions are re-queued by cron.
- **Provider abstractions:** `AIProvider`, `ComputerProvider`, `EmailProvider`, `CalendarProvider`,
  `MeetingProvider`, `VoiceProvider` — business logic never imports a vendor SDK directly.
- **Billing:** trusted prices in `subscription_plans`; `activate_paid_transaction()` activates idempotently
  after server-to-server verification with Moyasar; access checks compare `ends_at` on every request.
