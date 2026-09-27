import { createClient } from '@supabase/supabase-js';
import { env } from './env';

/**
 * Browser Supabase client — ANON key only. Used for authentication and Realtime subscriptions.
 * All data reads/writes go through the NEXUS API, which enforces authorization.
 */
export const supabase = createClient(env.supabaseUrl || 'http://localhost', env.supabaseAnonKey || 'missing', {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: 'pkce' },
});

export async function getAccessToken(): Promise<string | null> {
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
}
