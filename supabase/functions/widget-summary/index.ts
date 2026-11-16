// Supabase Edge Function: widget-summary
// A small JSON for the NEXUS iOS widgets, shaped by the caller's role. It runs with the CALLER's JWT,
// so every read goes through the existing RLS (a person only ever sees their own organization).
import { createClient } from 'npm:@supabase/supabase-js@2';

const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-organization-id, content-type, apikey' };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

type Role = 'owner' | 'admin' | 'manager' | 'member' | 'viewer';
const appRole = (r: Role) => (r === 'owner' ? 'ceo' : r === 'admin' || r === 'manager' ? 'manager' : 'employee');
const sensitive = (a: { risk: string; approval_type: string }) => a.risk === 'high' || a.approval_type === 'email_send' || a.approval_type === 'meeting_action';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  const auth = req.headers.get('Authorization');
  if (!auth?.startsWith('Bearer ')) return json({ error: 'unauthorized' }, 401);
  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: auth } }, auth: { persistSession: false } });
  const { data: user } = await db.auth.getUser(auth.slice(7));
  if (!user.user) return json({ error: 'unauthorized' }, 401);

  const wanted = req.headers.get('x-organization-id');
  const { data: memberships } = await db.from('organization_members').select('organization_id, role').eq('user_id', user.user.id).eq('status', 'active');
  const membership = (memberships ?? []).find((m) => m.organization_id === wanted) ?? (memberships ?? [])[0];
  if (!membership) return json({ error: 'no_organization' }, 404);
  const org = membership.organization_id as string;
  const role = appRole(membership.role as Role);

  const dayStart = new Date(Date.now() + 3 * 3_600_000);
  dayStart.setUTCHours(0, 0, 0, 0);
  const today = new Date(dayStart.getTime() - 3 * 3_600_000).toISOString(); // midnight Riyadh
  const now = new Date().toISOString();

  const [ai, approvals, done, stuck, events] = await Promise.all([
    db.from('ai_employees').select('id, name, status').eq('organization_id', org).is('deleted_at', null),
    db.from('approvals').select('id, title, approval_type, risk, created_at, requested_by_ai_employee_id').eq('organization_id', org).eq('status', 'pending').order('created_at'),
    db.from('tasks').select('id', { count: 'exact', head: true }).eq('organization_id', org).is('deleted_at', null).eq('status', 'done').gte('completed_at', today),
    db.from('tasks').select('id', { count: 'exact', head: true }).eq('organization_id', org).is('deleted_at', null).neq('status', 'done').or(`status.eq.blocked,due_date.lt.${now}`),
    db.from('ai_session_events').select('ai_employee_id, message, created_at').eq('organization_id', org).order('id', { ascending: false }).limit(4),
  ]);
  const names = new Map((ai.data ?? []).map((a) => [a.id, a.name]));
  const pending = approvals.data ?? [];
  const working = (ai.data ?? []).filter((a) => !['offline', 'idle', 'completed', 'failed'].includes(a.status)).length;
  // Newest first for the widget list; the oldest one drives "waiting since".
  const latest = [...pending].reverse().slice(0, 3);

  return json({
    role,
    updatedAt: now,
    pending: role === 'employee' ? 0 : pending.length,
    oldestPendingAt: role === 'employee' ? null : (pending[0]?.created_at ?? null),
    approvals: role === 'employee' ? [] : latest.map((a) => ({ id: a.id, title: a.title, ai: names.get(a.requested_by_ai_employee_id) ?? 'NEXUS', type: a.approval_type, sensitive: sensitive(a) })),
    escalated: pending.filter((a) => a.risk === 'high' || Date.now() - Date.parse(a.created_at) > 24 * 3_600_000).length,
    aiWorking: working,
    doneToday: done.count ?? 0,
    stuck: stuck.count ?? 0,
    events: (events.data ?? []).map((e) => ({ ai: names.get(e.ai_employee_id) ?? '', message: e.message, at: e.created_at })),
  });
});
