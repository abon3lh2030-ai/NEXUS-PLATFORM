# NEXUS Platform — منصة NEXUS

**AI-Powered Company Operating Platform** for Saudi companies and establishments.
Humans + AI Employees + Virtual AI Computers + Company Workspace, in Arabic (default, RTL) and English.

---

## Architecture

```
apps/
  api/        Fastify + TypeScript API (authorization, AI runtime, files, billing, digital office)
  web/        React + Vite + Tailwind + shadcn-style UI (Arabic/English, dark/light/system)
packages/
  shared/     Zod schemas, enums, permissions, file & communication policies (shared by api/web)
  ui/         Design-system components
  config/     Design tokens (theme.css)
supabase/
  migrations/ Schema, RLS, Storage policies, functions, reference data
scripts/      i18n check, super-admin grant
```

- **Browser → Supabase:** authentication and Realtime only (anon key; RLS applies).
- **Browser → API:** all data. The API authenticates the Supabase JWT, loads the organization membership, resolves permissions and entitlements on **every** request, then writes with the service role.
- **Defense in depth:** Postgres RLS + Storage policies independently enforce tenant isolation and private-file isolation. The API reads files with the caller's JWT, so RLS applies a second time.

## AI Employees

Each AI employee has a role, responsibilities, skills, permissions, an autonomy level (Suggest → Draft → Execute internal → Autonomous), memory, a workspace and a virtual computer.

**Work loop.** A task assignment creates an **AI Work Session** in a Postgres queue (`FOR UPDATE SKIP LOCKED`). Each step runs this chain:

`LLM → structured output → Zod → permission → capability → autonomy/risk → (approval) → tool → audit`

**Limits.** Every session has hard caps on steps, tokens, cost, time, retries, delegation depth and child actions.

**Everything is visible:**
- **AI Operations Room:** live via Realtime, with pause, resume, cancel and stop controls.
- **Per-session timeline:** each step and tool call is recorded.
- **Manager Computer View:** the employee's workspace, files and activity.

**Nexus AI** is the central assistant. It acts strictly within the caller's permissions, can inspect the company and create or assign real work, and never sees private files.

### Digital Office

AI employees also have Mail, Calendar, Meetings, Presentations and Voice. Each capability is at one of three levels:

- **Implemented and working now:**
  - Presentations: real `.pptx` files with native charts/tables, RTL, company logo and colors, versions and approvals, and publishing to Shared Files.
  - The built-in calendar.
  - Meeting scheduling, transcripts/notes, and post-meeting AI processing (summary, minutes, decisions, tasks, follow-up draft).
  - Email drafting and the send policy engine.
- **Code in place, but needs provider credentials/verification:**
  - Email delivery through Resend with a verified agent domain.
  - Live meeting attendance through Recall.ai.
  - Voice through ElevenLabs.
- **Architecture only:**
  - External calendar sync (Google / Microsoft OAuth).
  - Sandboxed browser/terminal (E2B).

Capabilities are **detected**. Unavailable features are reported as "not connected", never simulated.

**Communication safety:**
- **Always needs human approval:**
  - External recipients, except explicitly allow-listed domains.
  - Attachments sent to outside parties.
  - Contracts, final prices, discounts and guarantees (commitment detection).
- **Always disclosed:** AI identity on every email, meeting bot name and voice intro.
- **Never reachable:** private manager files, through any tool.

## Company Files

- **Shared Files:**
  - Organization-wide, never public.
  - Configurable per-role permissions.
  - Folders, drag & drop, upload progress/cancel/retry, preview (images/PDF/text/Markdown/CSV), gallery, search/filter/sort.
  - Trash/restore/permanent delete, activity log.
  - Linking to tasks, projects, missions, meetings and AI outputs ("Attach from Company Files").
- **Private Files:**
  - Visible **only** to `owner_user_id`. Not to other admins, the organization owner, AI employees, Nexus AI or the super-admin UI.
  - Enforced in the API, RLS and Storage policies.
  - Sharing is an explicit **copy** into Shared Files.
- **Upload security:**
  - The server generates UUID storage keys; the user's filename is never used in the key.
  - Signed upload URLs.
  - Server-side content sniffing, not the extension. Blocked types include executables, HTML, SVG and macro-enabled Office files.
  - Size and quota by plan.
  - SHA-256 checksum.
  - Downloads use 60-second signed URLs with `attachment` disposition.
  - Malware scanning is behind an abstraction and honestly reported as "not scanned" until a scanner is connected.

## Saudi company model, pricing & billing

- **Registration:** only companies registered in Saudi Arabia may register, using the company's **official** data: legal name, 10-digit CR, official email and phone, and an optional PNG logo. The platform admin is emailed.
- **Plans:** annual only. Starter 399 SAR, Pro 599 SAR (most popular), Business 999 SAR, Enterprise custom.
- **Where prices live:** prices and entitlements live in the database (`subscription_plans`), not in the frontend.
- **Moyasar:** Apple Pay and cards.
  1. The server fixes the amount.
  2. The browser submits card data directly to Moyasar.
  3. The server verifies the payment with the secret key: status, amount, currency and transaction id.
  4. Activation is atomic and idempotent (the same result from the callback or the webhook).
- **Renewal:** renewing early extends from the current end date, so no remaining days are lost.
- **Expiry:** paid access is blocked the instant `ends_at` passes. The check is per-request, and data is kept.
- **Enterprise:** request → admin email (buttons only open the secure admin page) → the super admin sets price and limits → customer email → offer page → Moyasar → activation.
- **Closing a company:** available to the owner only. It requires strong confirmation, is a soft close, and emails the platform admin.

## Security

- **Access control:** RBAC (Owner/Admin/Manager/Member/Viewer, plus configurable overrides), RLS on every table, private Storage bucket.
- **Request handling:** Zod on every input, rate limiting, Helmet/CSP/HSTS, strict CORS.
- **Audit:** append-only audit log.
- **Secrets:** isolated from the browser and from AI tools.
- **AI tool surface:** no `eval`, no raw SQL, no shell.

## Setup

See **[ENV_SETUP.md](ENV_SETUP.md)** (Arabic) for every variable and provider.

```bash
npm install
cp .env.example .env
npm run dev          # API :8080, web :5173
```

## Tests

```bash
npm run typecheck && npm run lint
npm run test         # unit + RLS/Storage isolation on a real Postgres engine (PGlite)
npm run test:e2e     # Playwright UI smoke (desktop + mobile); files security E2E against a real deployment
node scripts/check-i18n.mjs
```

- **RLS/Storage suite:** runs the real migrations and verifies the critical guarantees:
  - Company A can't read Company B's files.
  - Members and other admins can't read the owner's private files.
  - Knowing a file UUID or storage key grants nothing.
  - Deleted files can't be downloaded.
  - Clients can't write data or self-grant super admin.
  - Payment activation is idempotent, and renewal keeps remaining days.
- **Files E2E suite:** covers the full upload → share → deny → trash → restore flow against Supabase.

## Deployment (Render)

`render.yaml` defines two services:

- **`nexus-api`:** Node web service, health check `/health`.
- **`nexus-web`:** static site with SPA rewrite and security headers.

Secrets are set in the Render dashboard. HTTPS only.
