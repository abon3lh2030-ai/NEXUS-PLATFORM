import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Env } from '../config/env.js';

export type Db = SupabaseClient;

/**
 * Service-role client: bypasses RLS. Used ONLY after the API has authorized the request.
 * Never expose this client or its key to the browser or to AI tool code.
 */
export function createServiceClient(env: Env): Db {
  return createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/**
 * Caller-scoped client: runs with the user's JWT so Postgres RLS and Storage policies are
 * enforced a second time (used for all human file reads/downloads).
 */
export function createUserClient(env: Env, accessToken: string): Db {
  return createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
  });
}
