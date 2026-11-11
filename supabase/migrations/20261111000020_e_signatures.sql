-- NEXUS Platform — 0020: internal e-signatures and sign-off requests (owner request 2026-11-11).
-- A PDF from Company Files is sent to employees/managers to sign (drawn or uploaded PNG/JPEG signature)
-- or approve, in order or all at once. When everyone is done, NEXUS issues a signed copy with a
-- signature page and a verification code. This is a simple electronic signature for internal use;
-- contracts that need a nationally verified signature still go through a licensed platform (e.g. Sadeq).

create table public.signature_requests (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  title text not null check (char_length(title) between 1 and 200),
  message text not null default '' check (char_length(message) <= 4000),
  file_id uuid not null references public.company_files (id),
  -- The document's SHA-256 when it was sent; the signed copy is only issued if it is unchanged.
  file_sha256 text not null check (file_sha256 ~ '^[0-9a-f]{64}$'),
  sequential boolean not null default true,
  status text not null default 'in_progress' check (status in ('in_progress', 'completed', 'declined', 'cancelled')),
  due_at timestamptz,
  verification_code text not null unique,
  created_by uuid not null references auth.users (id),
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  cancelled_at timestamptz,
  signed_file_id uuid references public.company_files (id) on delete set null,
  failure_reason text
);
create index signature_requests_org_idx on public.signature_requests (organization_id, created_at desc);

create table public.signature_request_signers (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  request_id uuid not null references public.signature_requests (id) on delete cascade,
  member_id uuid not null references public.organization_members (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null default 'signer' check (role in ('signer', 'approver')),
  sign_order int not null default 1 check (sign_order between 1 and 50),
  -- waiting: not their turn yet · pending: asked to act · then viewed / signed / approved / declined
  status text not null default 'waiting' check (status in ('waiting', 'pending', 'viewed', 'signed', 'approved', 'declined')),
  signature_key text,
  signature_method text check (signature_method in ('drawn', 'uploaded')),
  notified_at timestamptz,
  viewed_at timestamptz,
  acted_at timestamptz,
  decline_reason text check (char_length(decline_reason) <= 2000),
  ip text,
  user_agent text,
  unique (request_id, member_id)
);
create index signature_signers_user_idx on public.signature_request_signers (user_id, status);
create index signature_signers_request_idx on public.signature_request_signers (request_id, sign_order);

-- A person's saved signature, reusable on later requests. Image lives in private storage (server-only).
create table public.user_signatures (
  user_id uuid primary key references auth.users (id) on delete cascade,
  storage_key text not null,
  updated_at timestamptz not null default now()
);

-- Everything goes through the API (service role); clients get no direct table access.
do $$
declare
  t text;
begin
  foreach t in array array['signature_requests', 'signature_request_signers', 'user_signatures']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
  end loop;
end;
$$;
