import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';

const here = dirname(fileURLToPath(import.meta.url));
export const MIGRATIONS_DIR = join(here, '../../../../supabase/migrations');

/**
 * Minimal stand-ins for the Supabase-managed schemas (auth, storage) and roles, so the REAL
 * migrations and RLS policies can be executed and tested against a real Postgres engine.
 * auth.uid() reads the `request.jwt.claim.sub` setting exactly like Supabase does.
 */
const SUPABASE_STUBS = `
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
grant usage on schema public to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;

create schema auth;
grant usage on schema auth to anon, authenticated, service_role;
create table auth.users (id uuid primary key, email text, raw_user_meta_data jsonb default '{}'::jsonb);
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
grant execute on function auth.uid() to anon, authenticated, service_role;

create schema storage;
grant usage on schema storage to anon, authenticated, service_role;
create table storage.buckets (id text primary key, name text, public boolean default false, file_size_limit bigint);
create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text references storage.buckets(id), name text not null, owner uuid);
alter table storage.objects enable row level security;
grant select, insert, update, delete on storage.objects to anon, authenticated, service_role;
grant select on storage.buckets to anon, authenticated, service_role;
create function storage.foldername(name text) returns text[] language sql immutable as $$
  select (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1) - 1]
$$;
grant execute on function storage.foldername(text) to anon, authenticated, service_role;
`;

export async function createMigratedDb(): Promise<PGlite> {
  const db = await PGlite.create({ extensions: { pg_trgm, pgcrypto } });
  await db.exec(SUPABASE_STUBS);
  const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort();
  for (const f of files) {
    // pgvector is not available in PGlite; substitute a plain array type for the embedding columns.
    const sql = readFileSync(join(MIGRATIONS_DIR, f), 'utf8')
      .replace(/create extension if not exists vector;/g, '')
      .replace(/vector\(1024\)/g, 'real[]');
    try {
      await db.exec(sql);
    } catch (err) {
      throw new Error(`Migration ${f} failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return db;
}

/** Run a query as an authenticated Supabase user (RLS enforced). */
export async function asUser<T>(db: PGlite, userId: string, sql: string, params: unknown[] = []): Promise<T[]> {
  return db.transaction(async (tx) => {
    await tx.exec(`set local role authenticated; select set_config('request.jwt.claim.sub', '${userId}', true);`);
    const res = await tx.query<T>(sql, params);
    return res.rows;
  });
}

export async function asAnon<T>(db: PGlite, sql: string, params: unknown[] = []): Promise<T[]> {
  return db.transaction(async (tx) => {
    await tx.exec(`set local role anon; select set_config('request.jwt.claim.sub', '', true);`);
    const res = await tx.query<T>(sql, params);
    return res.rows;
  });
}
