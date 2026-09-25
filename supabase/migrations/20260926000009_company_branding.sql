-- NEXUS Platform — 0009: official company contact data, company logo, member display names

-- Official COMPANY contact details (not the applicant's personal data).
alter table public.organizations
  add column company_email text,
  add column company_phone text,
  add column logo_storage_key text,
  add column logo_updated_at timestamptz,
  add constraint organizations_logo_key_scope check (logo_storage_key is null or logo_storage_key like id::text || '/branding/%');

alter table public.company_applications
  add column company_email text,
  add column company_phone text;

-- Organization-level display name for human employees, editable by managers.
alter table public.organization_members
  add column display_name text check (display_name is null or char_length(display_name) between 1 and 120);
