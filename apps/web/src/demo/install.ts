/**
 * LOCAL DEMO MODE ONLY (`npm run demo`). Loaded exclusively when `import.meta.env.DEV` and
 * `VITE_DEMO_MODE=true`, so it is never part of a production build.
 *
 * Intercepts `fetch` for the demo Supabase Auth URL and the demo API URL, answering from an
 * in-memory sample company. Realtime is stubbed. A banner makes it obvious this is a demo.
 */
import { supabase } from '@/lib/supabase';
import { handleDemoRequest } from './api';
import { DEMO_CREDENTIALS, DEMO_USER_ID } from './data';

const b64url = (v: unknown) => btoa(unescape(encodeURIComponent(JSON.stringify(v)))).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
const YEAR = 365 * 24 * 3600;

function demoUser() {
  return { id: DEMO_USER_ID, aud: 'authenticated', role: 'authenticated', email: DEMO_CREDENTIALS.email, email_confirmed_at: '2026-01-01T00:00:00Z', app_metadata: { provider: 'email' }, user_metadata: { full_name: 'عبدالله' }, created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z' };
}

function demoSession() {
  const exp = Math.floor(Date.now() / 1000) + YEAR;
  const token = `${b64url({ alg: 'HS256', typ: 'JWT' })}.${b64url({ sub: DEMO_USER_ID, email: DEMO_CREDENTIALS.email, role: 'authenticated', aud: 'authenticated', exp })}.demo`;
  return { access_token: token, token_type: 'bearer', expires_in: YEAR, expires_at: exp, refresh_token: 'demo-refresh', user: demoUser() };
}

const json = (status: number, body: unknown) => new Response(status === 204 ? null : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const authError = (msg: string) => json(400, { code: 400, error_code: 'demo_disabled', msg });

async function readBody(init?: RequestInit): Promise<Record<string, unknown>> {
  if (!init?.body || typeof init.body !== 'string') return {};
  try {
    return JSON.parse(init.body) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function handleAuth(method: string, url: URL, body: Record<string, unknown>): Response {
  const path = url.pathname.replace(/^.*?\/auth\/v1/, '');
  if (path === '/token') {
    if (url.searchParams.get('grant_type') === 'refresh_token') return json(200, demoSession());
    const email = String(body.email ?? '').trim().toLowerCase();
    if (email === DEMO_CREDENTIALS.email && body.password === DEMO_CREDENTIALS.password) return json(200, demoSession());
    return json(400, { error: 'invalid_grant', error_code: 'invalid_credentials', error_description: 'Invalid login credentials', msg: 'Invalid login credentials' });
  }
  if (path === '/user' && method === 'GET') return json(200, demoUser());
  if (path === '/logout') return json(204, null);
  return authError('غير متاح في النسخة التجريبية');
}

function installBanner() {
  const el = document.createElement('div');
  el.textContent = 'نسخة تجريبية على جهازك — البيانات أمثلة ولا تُحفظ';
  el.setAttribute('role', 'status');
  el.style.cssText = 'position:fixed;top:8px;left:50%;transform:translateX(-50%);z-index:9999;background:#f59e0b;color:#111;font:600 12px system-ui;padding:4px 12px;border-radius:999px;box-shadow:0 2px 8px rgba(0,0,0,.2);pointer-events:none;direction:rtl';
  document.body.appendChild(el);
}

export function installDemo() {
  const realFetch = window.fetch.bind(window);
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url, window.location.origin);
    const method = (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase();
    if (url.pathname.includes('/demo-supabase/auth/v1')) return handleAuth(method, url, await readBody(init));
    if (url.pathname.includes('/demo-api')) {
      await new Promise((r) => setTimeout(r, 120)); // feel like a network
      const res = handleDemoRequest(method, url, await readBody(init));
      if (res.contentType && typeof res.body === 'string') return new Response(res.body, { status: res.status, headers: { 'Content-Type': res.contentType } });
      return json(res.status, res.body ?? {});
    }
    return realFetch(input, init);
  };

  // Realtime isn't simulated: pages fall back to their polling intervals.
  const stub = { on: () => stub, subscribe: () => stub, unsubscribe: async () => 'ok' };
  supabase.channel = (() => stub) as unknown as typeof supabase.channel;
  supabase.removeChannel = (async () => 'ok') as unknown as typeof supabase.removeChannel;

  if (document.body) installBanner();
  else window.addEventListener('DOMContentLoaded', installBanner);
  console.info(`[NEXUS demo] Sign in with ${DEMO_CREDENTIALS.email} / ${DEMO_CREDENTIALS.password}`);
}
