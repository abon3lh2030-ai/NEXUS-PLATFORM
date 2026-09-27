/**
 * LOCAL DEMO MODE ONLY — an in-browser stand-in for the NEXUS API so the UI can be explored
 * without Supabase or the API server. Everything is in memory and resets on reload.
 * Actions that need real infrastructure (uploads, downloads, payments, email delivery) are refused
 * with `demo_disabled` instead of pretending to work.
 */
import { DEMO_CREDENTIALS, DEMO_ORG_ID, DEMO_PLAN, DEMO_USER_ID, OWNER_PERMISSIONS, PLANS, db, dayOffset, isoNow, newId, type Row } from './data';

export interface DemoResponse {
  status: number;
  body?: unknown;
  contentType?: string;
}

type Q = URLSearchParams;
type Body = Record<string, unknown>;
type Handler = (m: RegExpMatchArray, q: Q, body: Body) => DemoResponse | unknown;

const ok = (body: unknown): DemoResponse => ({ status: 200, body });
const created = (body: unknown): DemoResponse => ({ status: 201, body });
const fail = (status: number, error: string): DemoResponse => ({ status, body: { error } });
const disabled = () => fail(409, 'demo_disabled');
const notFound = () => fail(404, 'not_found');

const live = <T extends Row>(rows: T[]) => rows.filter((r) => !r.deleted_at);
const byId = <T extends Row>(rows: T[], id: string) => rows.find((r) => r.id === id);
const aiName = (id: unknown) => (byId(db.ai_employees, String(id))?.name as string | undefined) ?? null;
const lastDays = (n: number, f: (i: number) => number) => Array.from({ length: n }, (_, i) => ({ date: dayOffset(i - n + 1).slice(0, 10), value: f(i) }));

/** Simple equality filters from the query string (ignores paging/search keys). */
function filterRows(rows: Row[], q: Q): Row[] {
  let out = live(rows);
  for (const [k, v] of q.entries()) {
    if (['q', 'flat', 'days', 'limit', 'offset', 'locale', 'from', 'to', 'folder'].includes(k) || v === '') continue;
    out = out.filter((r) => !(k in r) || String(r[k]) === v);
  }
  const term = q.get('q')?.trim();
  if (term) out = out.filter((r) => JSON.stringify(r).includes(term));
  return out;
}

const ENTITIES: Record<string, Row[]> = {
  departments: db.departments, goals: db.goals, missions: db.missions, projects: db.projects, tasks: db.tasks,
  meetings: db.meetings, documents: db.documents, decisions: db.decisions, memories: db.memories,
};

function org() {
  return {
    organization: { id: DEMO_ORG_ID, name: 'شركة الأفق للتقنية (تجريبية)', commercial_registration: '1010000000', company_email: 'info@example.com', company_phone: '+966500000000', logo_updated_at: null, website: null, industry: 'technology', company_size: '11-50', status: 'active', verification_status: 'verified', owner_user_id: DEMO_USER_ID, default_locale: 'ar', created_at: dayOffset(-60) },
    membership: { role: 'owner', member_id: 'mem-owner', permissions: OWNER_PERMISSIONS },
    billing: { active: true, plan_code: DEMO_PLAN.code, ends_at: dayOffset(300), entitlements: DEMO_PLAN.entitlements },
    ai: { provider: 'demo', is_mock: true, computer_provider: 'storage_workspace', computer_capabilities: { files: true, documents: true, browser: false, terminal: false } },
  };
}

/** Assigning a task to an AI employee: session runs for ~10 seconds, then completes with a sample output. */
function startSession(aiId: string, taskId: string | null): Row {
  const task = taskId ? byId(db.tasks, taskId) : undefined;
  const s: Row = { id: newId(), ai_employee_id: aiId, task_id: taskId, status: 'running', current_step: 'يقرأ المهمة ويخطط للعمل', provider: 'demo', model: 'claude-sonnet-5', started_at: isoNow(), completed_at: null, queued_at: isoNow(), created_at: isoNow(), input_tokens: 0, output_tokens: 0, estimated_cost_usd: 0, delegation_depth: 0, error: null, outputs: [], tasks: task ? { title: task.title } : null };
  db.sessions.unshift(s);
  const ai = byId(db.ai_employees, aiId);
  if (ai) ai.status = 'thinking';
  if (task) { task.assignee_ai_employee_id = aiId; task.assignee_member_id = null; task.status = 'in_progress'; }
  const steps = ['يجمع المعلومات من ملفات الشركة', 'يكتب المسودة', 'يراجع الناتج'];
  steps.forEach((step, i) => setTimeout(() => { if (s.status === 'running') { s.current_step = step; s.input_tokens = 6000 * (i + 1); s.output_tokens = 900 * (i + 1); if (ai) ai.status = i === 1 ? 'writing' : 'researching'; } }, 3000 * (i + 1)));
  setTimeout(() => {
    if (s.status !== 'running') return;
    const doc: Row = { id: newId(), title: `ناتج: ${String(task?.title ?? 'مهمة')}`, doc_type: 'report', content: `## الناتج (نسخة تجريبية)\nهذا مثال لما يسلّمه الموظف الذكي بعد إنهاء المهمة.\n\n- النقطة الأولى\n- النقطة الثانية\n- التوصية`, status: 'draft', current_version: 1, created_by_ai_employee_id: aiId, updated_at: isoNow(), project_id: task?.project_id ?? null, deleted_at: null };
    db.documents.unshift(doc);
    db.outputs.unshift({ id: newId(), title: doc.title, status: 'pending_review', ai_employee_id: aiId, document_id: doc.id, content: doc.content, created_at: isoNow(), ai_employees: { name: ai?.name } });
    Object.assign(s, { status: 'completed', current_step: 'اكتملت المهمة', completed_at: isoNow(), estimated_cost_usd: 0.08 });
    if (ai) ai.status = 'idle';
    if (task) task.status = 'review';
    db.notifications.unshift({ id: newId(), title: 'اكتملت مهمة', body: `${String(ai?.name)} أنهى: ${String(task?.title ?? '')}`, link: `/app/operations?session=${s.id}`, type: 'ai_completed', read_at: null, created_at: isoNow() });
  }, 12_000);
  return s;
}

const routes: Array<[string, RegExp, Handler]> = [
  // ---------- session / org ----------
  ['GET', /^\/me$/, () => ({ user_id: DEMO_USER_ID, email: DEMO_CREDENTIALS.email, is_super_admin: false, profile: { full_name: 'عبدالله', locale: 'ar', theme: 'system', avatar_url: null }, organizations: [{ id: DEMO_ORG_ID, name: org().organization.name, status: 'active', verification_status: 'verified', role: 'owner' }] })],
  ['PATCH', /^\/me$/, (_m, _q, b) => ({ full_name: b.full_name })],
  ['GET', /^\/org$/, () => org()],
  ['PATCH', /^\/org$/, () => org().organization],
  ['GET', /^\/organizations$/, () => [{ id: DEMO_ORG_ID, name: org().organization.name }]],
  ['GET', /^\/org\/logo$/, () => notFound()],
  ['PUT', /^\/org\/logo$/, disabled],
  ['DELETE', /^\/org\/logo$/, disabled],
  ['GET', /^\/org\/members$/, () => db.members],
  ['PATCH', /^\/org\/members\/([^/]+)$/, (m, _q, b) => Object.assign(byId(db.members, m[1]!) ?? {}, b)],
  ['DELETE', /^\/org\/members\/([^/]+)$/, () => disabled()],
  ['GET', /^\/org\/invitations$/, () => db.invitations],
  ['POST', /^\/org\/invitations$/, (_m, _q, b) => { const inv = { id: newId(), email: b.email, role: b.role, expires_at: dayOffset(7), accepted_at: null, revoked_at: null }; db.invitations.unshift(inv); return created(inv); }],
  ['DELETE', /^\/org\/invitations\/([^/]+)$/, (m) => { const inv = byId(db.invitations, m[1]!); if (inv) inv.revoked_at = isoNow(); return ok({ ok: true }); }],
  ['GET', /^\/org\/permissions$/, () => []],
  ['PUT', /^\/org\/permissions$/, () => ({ ok: true })],
  ['POST', /^\/org\/close$/, disabled],
  ['GET', /^\/audit-logs$/, () => db.audit],
  ['GET', /^\/notifications$/, () => db.notifications],
  ['POST', /^\/notifications\/read$/, (_m, _q, b) => { const ids = (b.ids as string[] | undefined) ?? null; db.notifications.forEach((n) => { if (!ids || ids.includes(n.id)) n.read_at = isoNow(); }); return { ok: true }; }],
  ['GET', /^\/me\/enterprise-requests$/, () => []],
  ['GET', /^\/plans$/, () => PLANS],
  ['POST', /^\/public\/contact$/, () => ({ ok: true })],
  ['POST', /^\/public\/enterprise-requests$/, () => ({ ok: true })],

  // ---------- dashboard / insights ----------
  ['GET', /^\/dashboard$/, () => ({
    snapshot: { departments: db.departments.length, humans: db.members.length, ai_employees: live(db.ai_employees).length, active_projects: live(db.projects).filter((p) => p.status === 'active').length, open_tasks: live(db.tasks).filter((t) => t.status !== 'done').length, pending_approvals: db.approvals.filter((a) => a.status === 'pending').length, running_ai_sessions: db.sessions.filter((s) => s.status === 'running').length },
    health: { score: 82, grade: 'good', reasons: [{ key: 'pending_approvals', impact: 6, detail: { older_than_48h: 0 } }] },
    activity: db.activity,
  })],
  ['GET', /^\/health-score$/, () => ({ score: 82, grade: 'good', reasons: [] })],
  ['GET', /^\/analytics$/, () => ({
    task_status: live(db.tasks).reduce<Record<string, number>>((acc, t) => ({ ...acc, [String(t.status)]: (acc[String(t.status)] ?? 0) + 1 }), {}),
    tasks_completed_by_day: lastDays(14, (i) => (i * 7) % 5),
    human_ai_distribution: { ai: live(db.tasks).filter((t) => t.assignee_ai_employee_id).length, human: live(db.tasks).filter((t) => t.assignee_member_id).length, unassigned: 0 },
    missions: db.missions.map((m) => ({ id: m.id, title: m.title, progress: m.progress, status: m.status })),
    projects: live(db.projects).map((p) => ({ id: p.id, title: p.title, progress: p.progress, status: p.status })),
    ai_productivity: live(db.ai_employees).map((a, i) => ({ id: a.id, name: a.name, completed: 4 + i * 3, failed: i === 2 ? 1 : 0, avg_minutes: 6 + i * 2, cost_usd: 0.4 + i * 0.3 })),
    ai_cost_by_day: lastDays(14, (i) => Math.round(((i * 13) % 7) * 0.05 * 100) / 100),
    ai_tokens: 412_000, ai_cost_usd: 3.7, approval_turnaround_hours: 5, approvals_pending: 2, documents_created: db.documents.length, documents_by_ai: db.documents.filter((d) => d.created_by_ai_employee_id).length,
    storage: { used_bytes: live(db.files).reduce((a, f) => a + Number(f.size), 0), file_count: live(db.files).length }, headcount: { humans: db.members.length, ai: live(db.ai_employees).length },
    activity_by_day: lastDays(14, (i) => 3 + ((i * 5) % 6)), advanced_locked: false,
  })],
  ['GET', /^\/work\/org-graph$/, () => ({ owner_user_id: DEMO_USER_ID, departments: db.departments, members: db.members, ai_employees: live(db.ai_employees) })],
  ['GET', /^\/search$/, (_m, q) => {
    const term = q.get('q') ?? '';
    const has = (v: unknown) => String(v).includes(term);
    return {
      tasks: live(db.tasks).filter((t) => has(t.title)), projects: live(db.projects).filter((p) => has(p.title)), missions: db.missions.filter((p) => has(p.title)),
      ai_employees: live(db.ai_employees).filter((a) => has(a.name) || has(a.job_title)), documents: live(db.documents).filter((d) => has(d.title)),
      shared_files: live(db.files).filter((f) => f.space === 'shared' && has(f.original_name)), private_files: live(db.files).filter((f) => f.space === 'private' && has(f.original_name)), departments: db.departments.filter((d) => has(d.name)),
    };
  }],

  // ---------- AI workforce ----------
  ['GET', /^\/ai\/templates$/, () => db.templates],
  ['GET', /^\/ai\/models$/, () => ({ default: DEMO_PLAN.ai_models[0], models: DEMO_PLAN.ai_models, provider: 'demo', is_mock: true })],
  ['GET', /^\/ai\/employees$/, () => live(db.ai_employees)],
  ['POST', /^\/ai\/employees$/, (_m, _q, b) => { const e: Row = { responsibilities: [], skills: [], goals: [], instructions: '', role_description: '', department_id: null, manager_member_id: null, ...b, id: newId(), organization_id: DEMO_ORG_ID, avatar_seed: String(b.name), status: 'idle', provider: 'anthropic', model: String(b.model ?? DEMO_PLAN.ai_models[0]), is_active: true, created_at: isoNow(), deleted_at: null }; db.ai_employees.push(e); return created(e); }],
  ['GET', /^\/ai\/employees\/([^/]+)$/, (m) => {
    const e = byId(db.ai_employees, m[1]!); if (!e) return notFound();
    return { ...e, permissions: { permissions: ['documents.create', 'documents.read', 'tasks.read', 'tasks.update_own', 'memory.read', 'files.shared.view', 'files.own.modify'], allowed_folder_ids: [] }, workspace: { notes: '' }, computer: { id: `cmp-${e.id}`, provider: 'storage_workspace', status: 'ready', capabilities: { files: true, documents: true, browser: false, terminal: false } },
      queue: db.sessions.filter((s) => s.ai_employee_id === e.id && ['queued', 'running', 'waiting_approval', 'paused'].includes(String(s.status))).map((s) => ({ id: s.id, status: s.status, current_step: s.current_step, task_id: s.task_id, priority: 2, queued_at: s.queued_at, tasks: s.tasks ? { ...(s.tasks as object), due_date: null, priority: 'high' } : null })) };
  }],
  ['PATCH', /^\/ai\/employees\/([^/]+)$/, (m, _q, b) => Object.assign(byId(db.ai_employees, m[1]!) ?? {}, b)],
  ['DELETE', /^\/ai\/employees\/([^/]+)$/, (m) => { const e = byId(db.ai_employees, m[1]!); if (e) e.deleted_at = isoNow(); return ok({ ok: true }); }],
  ['PUT', /^\/ai\/employees\/([^/]+)\/permissions$/, () => ({ ok: true })],
  ['POST', /^\/ai\/employees\/([^/]+)\/instructions$/, () => created({ ok: true })],
  ['POST', /^\/ai\/employees\/([^/]+)\/assign$/, (m, _q, b) => created(startSession(m[1]!, String(b.task_id)))],
  ['GET', /^\/ai\/employees\/([^/]+)\/inbox$/, (m) => db.tasks.filter((t) => t.assignee_ai_employee_id === m[1]).map((t) => ({ id: `inb-${t.id}`, item_type: 'task', title: t.title, body: t.description, created_at: t.created_at, read_at: null }))],
  ['GET', /^\/ai\/employees\/([^/]+)\/sessions$/, (m) => db.sessions.filter((s) => s.ai_employee_id === m[1])],
  ['GET', /^\/ai\/employees\/([^/]+)\/activity$/, (m) => db.activity.filter((a) => a.actor_ai_employee_id === m[1])],
  ['GET', /^\/ai\/employees\/([^/]+)\/performance$/, (m) => { const n = db.sessions.filter((s) => s.ai_employee_id === m[1] && s.status === 'completed').length + 5; return { tasks_completed: n, tasks_failed: 0, success_rate: 100, avg_completion_minutes: 7, current_workload: live(db.tasks).filter((t) => t.assignee_ai_employee_id === m[1] && t.status !== 'done').length, tokens: n * 26_000, estimated_cost_usd: Math.round(n * 0.09 * 100) / 100, approval_rate: 92, documents_created: db.documents.filter((d) => d.created_by_ai_employee_id === m[1]).length }; }],
  ['GET', /^\/ai\/employees\/([^/]+)\/computer$/, (m) => {
    const e = byId(db.ai_employees, m[1]!); if (!e) return notFound();
    const current = db.sessions.find((s) => s.ai_employee_id === e.id) ?? null;
    return { employee: { id: e.id, name: e.name, status: e.status }, computer: { id: `cmp-${e.id}`, provider: 'storage_workspace', status: 'ready' }, capabilities: { files: true, documents: true, browser: false, terminal: false }, provider: 'storage_workspace', current_session: current,
      files: [], documents: db.documents.filter((d) => d.created_by_ai_employee_id === e.id).map((d) => ({ id: d.id, title: d.title, doc_type: d.doc_type, status: d.status, created_at: d.updated_at })),
      logs: current ? [{ at: String(current.started_at), kind: 'session', message: 'بدأت جلسة العمل' }, { at: isoNow(), kind: 'step', message: String(current.current_step) }] : [] };
  }],
  ['GET', /^\/ai\/employees\/([^/]+)\/mail$/, (m, q) => ({ mailbox: { address: `${String(byId(db.ai_employees, m[1]!)?.avatar_seed ?? 'ai')}@agents.example.com`, status: 'active' }, delivery_available: false, messages: db.mail.filter((x) => x.ai_employee_id === m[1] && (!q.get('folder') || x.folder === q.get('folder'))) })],
  ['GET', /^\/ai\/employees\/([^/]+)\/voice$/, () => ({ profile: { voice_id: null, language: 'ar', speaking_style: 'professional', enabled: false }, provider: 'none', capabilities: { tts: false } })],
  ['PUT', /^\/ai\/employees\/([^/]+)\/voice$/, () => ({ ok: true })],
  ['POST', /^\/ai\/employees\/([^/]+)\/voice\/test$/, disabled],
  ['GET', /^\/ai\/operations$/, () => ({
    employees: live(db.ai_employees).map((e) => ({ id: e.id, name: e.name, job_title: e.job_title, status: e.status, avatar_seed: e.avatar_seed })),
    active_sessions: db.sessions.filter((s) => ['queued', 'running', 'waiting_approval', 'paused'].includes(String(s.status))),
    recent_sessions: db.sessions.filter((s) => ['completed', 'failed', 'cancelled'].includes(String(s.status))),
    pending_approvals: db.approvals.filter((a) => a.status === 'pending').map((a) => ({ id: a.id, title: a.title, risk: a.risk, created_at: a.created_at })),
    tool_activity: db.sessions.slice(0, 3).map((s, i) => ({ id: `tool-${i}`, session_id: s.id, ai_employee_id: s.ai_employee_id, tool: ['search_files', 'write_document', 'create_presentation'][i], status: 'succeeded', created_at: s.started_at })),
    usage_24h: { tokens: 67_800, estimated_cost_usd: 0.21, estimated_cost_sar: 0.79 },
    provider: { ai: 'demo', is_mock: true, computer: 'storage_workspace' },
  })],
  ['GET', /^\/ai\/sessions\/([^/]+)$/, (m) => {
    const s = byId(db.sessions, m[1]!); if (!s) return notFound();
    const events = [{ id: 1, event_type: 'started', message: 'بدأت الجلسة', data: {}, created_at: s.started_at }, { id: 2, event_type: 'step', message: String(s.current_step), data: {}, created_at: isoNow() }];
    const outputs = db.outputs.filter((o) => o.ai_employee_id === s.ai_employee_id).slice(0, s.status === 'completed' ? 1 : 0);
    return { ...s, estimated_cost_sar: Math.round(Number(s.estimated_cost_usd) * 3.75 * 100) / 100, ai_employees: { name: aiName(s.ai_employee_id), job_title: '', avatar_seed: aiName(s.ai_employee_id) }, events, tool_executions: [], outputs, computer_logs: [] };
  }],
  ['POST', /^\/ai\/sessions\/([^/]+)\/control$/, (m, _q, b) => { const s = byId(db.sessions, m[1]!); if (s) { s.status = b.action === 'pause' ? 'paused' : b.action === 'resume' ? 'running' : 'cancelled'; } return { ok: true }; }],
  ['GET', /^\/ai\/outputs$/, () => db.outputs],

  // ---------- approvals ----------
  ['GET', /^\/approvals$/, (_m, q) => db.approvals.filter((a) => !q.get('status') || a.status === q.get('status'))],
  ['GET', /^\/approvals\/([^/]+)$/, (m) => byId(db.approvals, m[1]!) ?? notFound()],
  ['POST', /^\/approvals\/([^/]+)\/decide$/, (m, _q, b) => {
    const a = byId(db.approvals, m[1]!); if (!a) return notFound();
    a.status = b.decision === 'approve' ? 'approved' : b.decision === 'reject' ? 'rejected' : 'revision_requested'; a.decided_at = isoNow(); a.decision_comment = b.comment ?? null;
    const s = a.session_id ? byId(db.sessions, String(a.session_id)) : undefined;
    if (s && a.status === 'approved') { Object.assign(s, { status: 'completed', current_step: 'اكتملت المهمة', completed_at: isoNow() }); const ai = byId(db.ai_employees, String(s.ai_employee_id)); if (ai) ai.status = 'idle'; }
    return a;
  }],
  ['POST', /^\/approvals\/([^/]+)\/comments$/, (m, _q, b) => { const a = byId(db.approvals, m[1]!); const c = { id: newId(), body: b.body, created_at: isoNow() }; (a?.comments as unknown[] | undefined)?.push(c); return created(c); }],

  // ---------- Nexus AI ----------
  ['GET', /^\/nexus\/conversations$/, () => db.conversations],
  ['GET', /^\/nexus\/conversations\/([^/]+)$/, (m) => ({ messages: db.messages[m[1]!] ?? [] })],
  ['POST', /^\/nexus\/chat$/, (_m, _q, b) => {
    let id = b.conversation_id as string | null;
    if (!id) { id = newId(); db.conversations.unshift({ id, title: String(b.message).slice(0, 80), updated_at: isoNow() }); db.messages[id] = []; }
    const open = live(db.tasks).filter((t) => t.status !== 'done').length;
    db.messages[id]!.push({ id: newId(), role: 'user', content: b.message, created_at: isoNow() });
    db.messages[id]!.push({ id: newId(), role: 'assistant', content: `هذه نسخة تجريبية، والرد هنا مثال فقط. في النسخة الحقيقية يقرأ Nexus AI بيانات شركتك وينفذ طلبك.\n\nملخص سريع: لديك ${open} مهام مفتوحة، و${db.approvals.filter((a) => a.status === 'pending').length} طلبات اعتماد بانتظارك، و${live(db.ai_employees).length} موظفين أذكياء.`, tool_calls: [{ tool: 'company_snapshot', ok: true, summary: 'قراءة ملخص الشركة' }], created_at: isoNow() });
    return { conversation_id: id };
  }],

  // ---------- work (generic) ----------
  ['GET', /^\/work\/tasks\/([^/]+)$/, (m) => {
    const t = byId(db.tasks, m[1]!); if (!t) return notFound();
    return { ...t, subtasks: [], comments: t.comments ?? [], ai_sessions: db.sessions.filter((s) => s.task_id === t.id).map((s) => ({ id: s.id, status: s.status, current_step: s.current_step, ai_employee_id: s.ai_employee_id, created_at: s.created_at })), ai_outputs: [] };
  }],
  ['POST', /^\/work\/tasks\/([^/]+)\/comments$/, (m, _q, b) => { const t = byId(db.tasks, m[1]!); const c = { id: newId(), body: b.body, author_user_id: DEMO_USER_ID, author_ai_employee_id: null, created_at: isoNow() }; (t?.comments as unknown[] | undefined)?.push(c); return created(c); }],
  ['GET', /^\/work\/projects\/([^/]+)$/, (m) => { const p = byId(db.projects, m[1]!); if (!p) return notFound(); const counts = live(db.tasks).filter((t) => t.project_id === p.id).reduce<Record<string, number>>((a, t) => ({ ...a, [String(t.status)]: (a[String(t.status)] ?? 0) + 1 }), {}); return { ...p, task_counts: counts }; }],
  ['GET', /^\/work\/missions\/([^/]+)$/, (m) => { const x = byId(db.missions, m[1]!); if (!x) return notFound(); return { ...x, projects: live(db.projects).filter((p) => p.mission_id === x.id).map((p) => ({ id: p.id, title: p.title, status: p.status, progress: p.progress })) }; }],
  ['POST', /^\/work\/missions\/([^/]+)\/ai\/summary/, (m) => { const x = byId(db.missions, m[1]!); if (x) { x.ai_summary = 'ملخص تجريبي: المهمة تسير وفق الخطة بنسبة إنجاز 45%. أبرز المخاطر تأخر اعتماد الميزانية. الخطوة القادمة: إطلاق الإعلانات.'; x.ai_summary_at = isoNow(); } return x; }],
  ['GET', /^\/work\/meetings\/([^/]+)$/, (m) => byId(db.meetings, m[1]!) ?? notFound()],
  ['POST', /^\/work\/meetings\/([^/]+)\/ai\/analyze/, (m) => { const x = byId(db.meetings, m[1]!); if (x) Object.assign(x, { summary: 'ملخص تجريبي: ناقش الفريق أداء المبيعات واتفق على زيادة ميزانية الإعلانات 10%.', decisions_extracted: [{ title: 'زيادة ميزانية الإعلانات 10%', reasoning: 'نتائج الحملة الأخيرة إيجابية' }], action_items: [{ title: 'متابعة العملاء الكبار', owner_hint: 'فهد' }] }); return x; }],
  ['POST', /^\/work\/meetings\/([^/]+)\/ai\/create-tasks$/, () => []],
  ['POST', /^\/work\/meetings\/([^/]+)\/ai\/save-decisions$/, () => []],
  ['GET', /^\/work\/documents\/([^/]+)$/, (m) => { const d = byId(db.documents, m[1]!); if (!d) return notFound(); return { ...d, versions: Array.from({ length: Number(d.current_version) }, (_, i) => ({ id: `${d.id}-v${i + 1}`, version: i + 1, change_summary: i === 0 ? 'النسخة الأولى' : 'تحديث', created_at: d.updated_at, created_by_ai_employee_id: d.created_by_ai_employee_id })) }; }],
  ['GET', /^\/work\/documents\/([^/]+)\/versions\/(\d+)$/, (m) => { const d = byId(db.documents, m[1]!); return d ? { title: d.title, content: d.content } : notFound(); }],
  ['GET', /^\/work\/(\w+)$/, (m, q) => { const rows = ENTITIES[m[1]!]; if (!rows) return notFound(); if (m[1] === 'tasks' && q.get('assignee_ai_employee_id')) return live(rows).filter((t) => t.assignee_ai_employee_id === q.get('assignee_ai_employee_id')); return filterRows(rows, q); }],
  ['POST', /^\/work\/(\w+)$/, (m, _q, b) => { const rows = ENTITIES[m[1]!]; if (!rows) return notFound(); const r: Row = { status: m[1] === 'tasks' ? 'todo' : 'active', progress: 0, tags: [], comments: [], depends_on: [], milestones: [], risks: [], kpis: [], pinned: false, current_version: 1, ...b, id: newId(), created_at: isoNow(), updated_at: isoNow(), deleted_at: null }; rows.unshift(r); if (m[1] === 'tasks' && b.assignee_ai_employee_id) { const s = startSession(String(b.assignee_ai_employee_id), r.id); return created({ ...r, ai_session_id: s.id }); } return created(r); }],
  ['PATCH', /^\/work\/(\w+)\/([^/]+)$/, (m, _q, b) => { const r = byId(ENTITIES[m[1]!] ?? [], m[2]!); if (!r) return notFound(); Object.assign(r, b, { updated_at: isoNow() }); if (m[1] === 'documents' && 'content' in b) r.current_version = Number(r.current_version) + 1; return r; }],
  ['DELETE', /^\/work\/(\w+)\/([^/]+)$/, (m) => { const r = byId(ENTITIES[m[1]!] ?? [], m[2]!); if (r) r.deleted_at = isoNow(); return ok({ ok: true }); }],

  // ---------- files ----------
  ['GET', /^\/files\/usage$/, () => ({ used_bytes: live(db.files).reduce((a, f) => a + Number(f.size), 0), file_count: live(db.files).length, limit_bytes: DEMO_PLAN.entitlements.storage_bytes })],
  ['GET', /^\/files\/recently-viewed$/, () => live(db.files).slice(0, 4)],
  ['GET', /^\/files\/folders$/, (_m, q) => { const parent = q.get('parent_id') || null; return { folders: db.folders.filter((f) => f.space === (q.get('space') ?? 'shared') && (q.get('flat') ? true : f.parent_id === parent)), breadcrumbs: parent ? [{ id: parent, name: byId(db.folders, parent)?.name }] : [] }; }],
  ['POST', /^\/files\/folders$/, (_m, _q, b) => { const f = { id: newId(), name: b.name, parent_id: b.parent_id ?? null, space: b.space, created_by_user_id: DEMO_USER_ID, created_at: isoNow() }; db.folders.push(f); return created(f); }],
  ['PATCH', /^\/files\/folders\/([^/]+)$/, (m, _q, b) => Object.assign(byId(db.folders, m[1]!) ?? {}, b)],
  ['DELETE', /^\/files\/folders\/([^/]+)$/, (m) => { const i = db.folders.findIndex((f) => f.id === m[1]); if (i >= 0) db.folders.splice(i, 1); return ok({ ok: true }); }],
  ['GET', /^\/files$/, (_m, q) => {
    const tab = q.get('space') ?? 'shared';
    let rows = tab === 'trash' ? db.files.filter((f) => f.deleted_at) : live(db.files).filter((f) => f.space === (tab === 'recent' ? f.space : tab));
    if (!q.get('flat') && (tab === 'shared' || tab === 'private')) rows = rows.filter((f) => (f.folder_id ?? null) === (q.get('folder_id') || null));
    const term = q.get('q'); if (term) rows = rows.filter((f) => String(f.original_name).includes(term));
    return { files: rows };
  }],
  ['POST', /^\/files\/uploads/, disabled],
  ['GET', /^\/files\/linked\/([^/]+)\/([^/]+)$/, () => []],
  ['GET', /^\/files\/([^/]+)\/preview$/, (m) => ({ status: 200, contentType: 'text/plain; charset=utf-8', body: `معاينة تجريبية للملف: ${String(byId(db.files, m[1]!)?.original_name ?? '')}\n\nفي النسخة الحقيقية تظهر هنا معاينة الملف الفعلية بشكل آمن.` })],
  ['GET', /^\/files\/([^/]+)\/download$/, disabled],
  ['GET', /^\/files\/([^/]+)$/, (m) => byId(db.files, m[1]!) ?? notFound()],
  ['PATCH', /^\/files\/([^/]+)$/, (m, _q, b) => Object.assign(byId(db.files, m[1]!) ?? {}, { original_name: b.name ?? byId(db.files, m[1]!)?.original_name })],
  ['DELETE', /^\/files\/([^/]+)\/permanent$/, (m) => { const i = db.files.findIndex((f) => f.id === m[1]); if (i >= 0) db.files.splice(i, 1); return ok({ ok: true }); }],
  ['DELETE', /^\/files\/([^/]+)\/links$/, () => ({ ok: true })],
  ['DELETE', /^\/files\/([^/]+)$/, (m) => { const f = byId(db.files, m[1]!); if (f) f.deleted_at = isoNow(); return ok({ ok: true }); }],
  ['POST', /^\/files\/([^/]+)\/restore$/, (m) => { const f = byId(db.files, m[1]!); if (f) f.deleted_at = null; return ok({ ok: true }); }],
  ['POST', /^\/files\/([^/]+)\/move$/, (m, _q, b) => Object.assign(byId(db.files, m[1]!) ?? {}, { folder_id: b.folder_id ?? null })],
  ['POST', /^\/files\/([^/]+)\/share-copy$/, (m) => { const f = byId(db.files, m[1]!); if (!f) return notFound(); const c = { ...f, id: newId(), space: 'shared', visibility: 'organization_shared', owner_user_id: null, folder_id: null, created_at: isoNow() }; db.files.unshift(c); return created(c); }],
  ['POST', /^\/files\/([^/]+)\/links$/, () => created({ ok: true })],

  // ---------- digital office ----------
  ['GET', /^\/office\/capabilities$/, () => ({ ai: { provider: 'demo', is_mock: true }, computer: { provider: 'storage_workspace', files: true, documents: true, browser: false, terminal: false }, email_provider: { name: 'console', send: false, customFrom: false, attachments: false, agent_domain: null }, email: { delivery_available: false }, calendar: { provider: 'nexus', internal: true, externalSync: false }, meetings: { provider: 'nexus', createMeeting: false, join: false, listen: false, transcript: false, speak: false }, voice: { provider: 'none', tts: false, stt: false } })],
  ['GET', /^\/office\/policy$/, () => ({ email_send_mode: 'approval_required', allow_external_email: true, autonomous_external_domains: [], daily_send_limit_per_employee: 50, presentation_publish_requires_approval: true, meeting_recording: 'transcript_only', transcript_retention_days: 90, require_participant_consent: true, allow_ai_speaking_external: false })],
  ['PUT', /^\/office\/policy$/, (_m, _q, b) => b],
  ['GET', /^\/calendar$/, (_m, q) => ({
    events: db.calendar_events.filter((e) => !q.get('ai_employee_id') || e.ai_employee_id === q.get('ai_employee_id')),
    deadlines: live(db.tasks).filter((t) => t.status !== 'done' && t.due_date).map((t) => ({ id: t.id, title: t.title, at: `${String(t.due_date)}T12:00:00.000Z`, kind: 'task', link: `/app/tasks?task=${t.id}` })),
    milestones: [],
  })],
  ['POST', /^\/calendar\/free-time$/, () => ({ slots: [{ starts_at: dayOffset(1), ends_at: dayOffset(1) }] })],
  ['GET', /^\/presentations$/, (_m, q) => live(db.presentations).filter((p) => !q.get('ai_employee_id') || p.ai_employee_id === q.get('ai_employee_id'))],
  ['GET', /^\/presentations\/([^/]+)$/, (m) => byId(db.presentations, m[1]!) ?? notFound()],
  ['PATCH', /^\/presentations\/([^/]+)$/, (m, _q, b) => Object.assign(byId(db.presentations, m[1]!) ?? {}, b)],
  ['DELETE', /^\/presentations\/([^/]+)$/, (m) => { const p = byId(db.presentations, m[1]!); if (p) p.deleted_at = isoNow(); return ok({ ok: true }); }],
  ['POST', /^\/presentations\/([^/]+)\/approve$/, (m) => Object.assign(byId(db.presentations, m[1]!) ?? {}, { status: 'final' })],
  ['POST', /^\/presentations\/([^/]+)\/(revise|duplicate)$/, () => disabled()],
  ['POST', /^\/presentations\/([^/]+)\/publish$/, disabled],
  ['GET', /^\/presentations\/([^/]+)\/versions\/(\d+)\/download$/, disabled],
  ['GET', /^\/meetings\/([^/]+)\/office$/, (m) => ({ id: m[1], meeting_link: null, status: String(byId(db.meetings, m[1]!)?.status ?? 'scheduled'), consent_confirmed: false, recording_policy: 'transcript_only', minutes: null, provider: 'nexus', capabilities: { join: false, listen: false, speak: false, transcript: false }, participants: [{ id: 'p1', member_id: 'mem-owner', ai_employee_id: null, external_email: null, role: 'organizer' }, { id: 'p2', member_id: null, ai_employee_id: 'ai-atlas', external_email: null, role: 'attendee' }], ai_sessions: [], summaries: [], action_item_rows: [], transcript: null, presentations: db.presentations.filter((p) => p.meeting_id === m[1]).map((p) => ({ id: p.id, title: p.title, status: p.status, current_version: p.current_version })) })],
  ['POST', /^\/meetings\//, disabled],
  ['POST', /^\/mail\/messages\/([^/]+)\/send$/, disabled],
  ['POST', /^\/mail\/messages\/([^/]+)\/archive$/, (m) => Object.assign(byId(db.mail, m[1]!) ?? {}, { folder: 'archive' })],

  // ---------- billing ----------
  ['GET', /^\/billing$/, () => ({
    subscription: { plan_code: DEMO_PLAN.code, status: 'active', started_at: dayOffset(-65), ends_at: dayOffset(300) }, plan: DEMO_PLAN, active: true, entitlements: DEMO_PLAN.entitlements,
    usage: { human_members: db.members.length, ai_employees: live(db.ai_employees).length, ai_executions_per_year: 37, active_projects: 2, storage_bytes: live(db.files).reduce((a, f) => a + Number(f.size), 0), concurrent_ai_sessions: 1, computer_minutes_per_year: 214, ai_budget_halalas_per_year: 1390 },
    plans: PLANS, transactions: [{ id: 'txn-1', plan_code: DEMO_PLAN.code, amount_halalas: DEMO_PLAN.price_halalas, status: 'paid', payment_method: 'creditcard', provider_metadata: { masked_number: '4111 XXXX XXXX 1111', company: 'visa' }, paid_at: dayOffset(-65), created_at: dayOffset(-65) }],
    payments_enabled: false, apple_pay_enabled: false,
  })],
  ['POST', /^\/billing\//, disabled],
];

export function handleDemoRequest(method: string, url: URL, body: Body): DemoResponse {
  const path = url.pathname.replace(/^.*?\/demo-api/, '');
  for (const [m, re, handler] of routes) {
    if (m !== method) continue;
    const match = path.match(re);
    if (!match) continue;
    const result = handler(match, url.searchParams, body);
    if (result && typeof result === 'object' && 'status' in result && typeof (result as DemoResponse).status === 'number' && Object.keys(result).every((k) => ['status', 'body', 'contentType'].includes(k))) return result as DemoResponse;
    return ok(result);
  }
  // Admin/super-admin and anything else not simulated.
  return fail(404, 'not_found');
}
