function required(name: string, value: string | undefined): string {
  if (!value) {
    // Fail loudly in the console; the app renders a configuration notice instead of crashing silently.
    console.error(`[NEXUS] Missing environment variable ${name}. See ENV_SETUP.md`);
    return '';
  }
  return value;
}

export const env = {
  supabaseUrl: required('VITE_SUPABASE_URL', import.meta.env.VITE_SUPABASE_URL as string | undefined),
  supabaseAnonKey: required('VITE_SUPABASE_ANON_KEY', import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined),
  apiBaseUrl: required('VITE_API_BASE_URL', import.meta.env.VITE_API_BASE_URL as string | undefined).replace(/\/$/, ''),
  publicAppUrl: (import.meta.env.VITE_PUBLIC_APP_URL as string | undefined) ?? window.location.origin,
};

export const isConfigured = Boolean(env.supabaseUrl && env.supabaseAnonKey && env.apiBaseUrl);
