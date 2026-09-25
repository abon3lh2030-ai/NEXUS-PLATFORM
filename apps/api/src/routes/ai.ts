import { aiEmployeePermissionsSchema, aiEmployeeSchema, assignAiTaskSchema, DEFAULT_AI_PERMISSIONS, managerInstructionSchema, sessionControlSchema } from '@nexus/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { badRequest, notFound, parse, unwrap } from '../lib/errors.js';
import { actorOf, orgGuard } from '../plugins/auth.js';
import { SUPPORTED_MODELS } from '../services/ai/provider.js';
import type { Services } from '../services/container.js';
import type { AiEmployeeRow, WorkSessionRow } from '../types/db.js';
import { idOf } from './helpers.js';

export async function aiRoutes(app: FastifyInstance, s: Services) {
  const view = { preHandler: orgGuard(s, { permission: 'ai.view' }) };
  const manage = { preHandler: orgGuard(s, { permission: 'ai.manage' }) };

  const loadEmployee = async (orgId: string, id: string) => {
    const { data } = await s.db.from('ai_employees').select('*').eq('id', id).eq('organization_id', orgId).is('deleted_at', null).maybeSingle<AiEmployeeRow>();
    if (!data) throw notFound('ai_employee_not_found');
    return data;
  };

  app.get('/ai/templates', view, async () => {
    const { data } = await s.db.from('ai_employee_templates').select('*').order('sort_order');
    return data ?? [];
  });

  app.get('/ai/models', view, async () => ({ default: s.ai.defaultModel, models: s.ai.isMock ? [s.ai.defaultModel] : SUPPORTED_MODELS, provider: s.ai.name, is_mock: s.ai.isMock }));

  app.get('/ai/employees', view, async (req) => {
    const a = actorOf(req);
    const { data } = await s.db.from('ai_employees').select('*').eq('organization_id', a.orgId).is('deleted_at', null).order('created_at');
    return data ?? [];
  });

  app.post('/ai/employees', manage, async (req, reply) => {
    const a = actorOf(req);
    const input = parse(aiEmployeeSchema, req.body);
    await s.entitlements.assertWithinLimit(a.orgId, a.billing, 'ai_employees');
    await s.work.assertRefs(a.orgId, { department_id: input.department_id, owner_member_id: input.manager_member_id });

    let permissions: string[] = [...DEFAULT_AI_PERMISSIONS];
    let autonomy = input.autonomy;
    if (input.template_id) {
      const { data: t } = await s.db.from('ai_employee_templates').select('default_permissions, default_autonomy').eq('id', input.template_id).maybeSingle<{ default_permissions: string[]; default_autonomy: typeof autonomy }>();
      if (!t) throw badRequest('invalid_template');
      permissions = t.default_permissions;
      if (!(req.body as Record<string, unknown>).autonomy) autonomy = t.default_autonomy;
    }
    const model = input.model && SUPPORTED_MODELS.includes(input.model) ? input.model : s.env.AI_DEFAULT_MODEL;
    const { model: _m, ...rest } = input;
    const employee = unwrap(
      await s.db
        .from('ai_employees')
        .insert({ ...rest, autonomy, organization_id: a.orgId, avatar_seed: input.avatar_seed ?? input.name, provider: s.ai.name === 'mock' ? 'anthropic' : s.ai.name, model, created_by: a.userId })
        .select('*')
        .single<AiEmployeeRow>(),
    );
    await s.db.from('ai_employee_permissions').insert({ ai_employee_id: employee.id, organization_id: a.orgId, permissions, updated_by: a.userId });
    await s.computer.createWorkspace({ orgId: a.orgId, aiEmployeeId: employee.id });
    await s.mail.ensureMailbox(a.orgId, employee.id);
    await s.audit.audit({ organizationId: a.orgId, actorType: 'human', actorUserId: a.userId, action: 'ai_employee.created', targetType: 'ai_employee', targetId: employee.id });
    await s.audit.activity({ organizationId: a.orgId, actorUserId: a.userId, verb: 'hired', entityType: 'ai_employee', entityId: employee.id, summary: `${employee.name} — ${employee.job_title}` });
    return reply.code(201).send(employee);
  });

  app.get('/ai/employees/:id', view, async (req) => {
    const a = actorOf(req);
    const employee = await loadEmployee(a.orgId, idOf(req.params));
    const [{ data: perms }, { data: workspace }, { data: computer }, { data: queue }] = await Promise.all([
      s.db.from('ai_employee_permissions').select('permissions, allowed_folder_ids').eq('ai_employee_id', employee.id).maybeSingle(),
      s.db.from('ai_workspaces').select('notes').eq('ai_employee_id', employee.id).maybeSingle(),
      s.db.from('ai_computers').select('id, provider, status, capabilities').eq('ai_employee_id', employee.id).maybeSingle(),
      s.db.from('ai_work_sessions').select('id, status, current_step, task_id, priority, queued_at, started_at, tasks(title, due_date, priority)').eq('ai_employee_id', employee.id).in('status', ['queued', 'preparing', 'running', 'paused', 'waiting_approval']).order('priority', { ascending: false }).order('queued_at'),
    ]);
    return { ...employee, permissions: perms, workspace, computer, queue: queue ?? [] };
  });

  app.patch('/ai/employees/:id', manage, async (req) => {
    const a = actorOf(req);
    const employee = await loadEmployee(a.orgId, idOf(req.params));
    const raw = (req.body ?? {}) as Record<string, unknown>;
    const parsed = parse(aiEmployeeSchema.partial().extend({ is_active: z.boolean().optional() }), raw) as Record<string, unknown>;
    const patch = Object.fromEntries(Object.entries(parsed).filter(([k]) => k in raw && k !== 'template_id'));
    if (typeof patch.model === 'string' && !SUPPORTED_MODELS.includes(patch.model)) throw badRequest('unsupported_model');
    await s.work.assertRefs(a.orgId, { department_id: patch.department_id, owner_member_id: patch.manager_member_id });
    const row = unwrap(await s.db.from('ai_employees').update(patch).eq('id', employee.id).select('*').single());
    await s.audit.audit({ organizationId: a.orgId, actorType: 'human', actorUserId: a.userId, action: 'ai_employee.updated', targetType: 'ai_employee', targetId: employee.id, metadata: { fields: Object.keys(patch) } });
    return row;
  });

  app.delete('/ai/employees/:id', manage, async (req) => {
    const a = actorOf(req);
    const employee = await loadEmployee(a.orgId, idOf(req.params));
    await s.db.from('ai_work_sessions').update({ status: 'cancelled', error: 'employee_removed', completed_at: new Date().toISOString() }).eq('ai_employee_id', employee.id).in('status', ['queued', 'paused', 'waiting_approval']);
    await s.db.from('ai_employees').update({ deleted_at: new Date().toISOString(), is_active: false, status: 'offline' }).eq('id', employee.id);
    await s.audit.audit({ organizationId: a.orgId, actorType: 'human', actorUserId: a.userId, action: 'ai_employee.removed', targetType: 'ai_employee', targetId: employee.id });
    return { ok: true };
  });

  app.put('/ai/employees/:id/permissions', manage, async (req) => {
    const a = actorOf(req);
    const employee = await loadEmployee(a.orgId, idOf(req.params));
    const body = parse(aiEmployeePermissionsSchema, req.body);
    if (body.allowed_folder_ids.length) {
      // Folder grants may only reference SHARED folders — private folders can never be granted to AI.
      const { data } = await s.db.from('company_file_folders').select('id').eq('organization_id', a.orgId).eq('space', 'shared').in('id', body.allowed_folder_ids);
      if ((data ?? []).length !== new Set(body.allowed_folder_ids).size) throw badRequest('only_shared_folders_allowed');
    }
    await s.db.from('ai_employee_permissions').upsert({ ai_employee_id: employee.id, organization_id: a.orgId, permissions: body.permissions, allowed_folder_ids: body.allowed_folder_ids, updated_by: a.userId, updated_at: new Date().toISOString() });
    await s.audit.audit({ organizationId: a.orgId, actorType: 'human', actorUserId: a.userId, action: 'ai_employee.permissions_updated', targetType: 'ai_employee', targetId: employee.id, metadata: { permissions: body.permissions } });
    return { ok: true };
  });

  app.patch('/ai/employees/:id/workspace', manage, async (req) => {
    const a = actorOf(req);
    const employee = await loadEmployee(a.orgId, idOf(req.params));
    const { notes } = parse(z.object({ notes: z.string().max(20000) }), req.body);
    await s.db.from('ai_workspaces').update({ notes }).eq('ai_employee_id', employee.id);
    return { ok: true };
  });

  app.post('/ai/employees/:id/assign', { preHandler: orgGuard(s, { permission: 'ai.assign' }) }, async (req) => {
    const { task_id } = parse(assignAiTaskSchema, req.body);
    return s.agents.assignTask(actorOf(req), idOf(req.params), task_id);
  });

  app.post('/ai/employees/:id/instructions', { preHandler: orgGuard(s, { permission: 'ai.control' }) }, async (req) => {
    const a = actorOf(req);
    const employee = await loadEmployee(a.orgId, idOf(req.params));
    const { body } = parse(managerInstructionSchema, req.body);
    await s.db.from('ai_employee_inbox').insert({ organization_id: a.orgId, ai_employee_id: employee.id, item_type: 'manager_instruction', title: 'Manager instruction', body, from_user_id: a.userId });
    return { ok: true };
  });

  app.get('/ai/employees/:id/inbox', view, async (req) => {
    const a = actorOf(req);
    const employee = await loadEmployee(a.orgId, idOf(req.params));
    const { data } = await s.db.from('ai_employee_inbox').select('*').eq('ai_employee_id', employee.id).order('created_at', { ascending: false }).limit(100);
    return data ?? [];
  });

  app.get('/ai/employees/:id/sessions', view, async (req) => {
    const a = actorOf(req);
    const employee = await loadEmployee(a.orgId, idOf(req.params));
    const { data } = await s.db.from('ai_work_sessions').select('id, task_id, status, current_step, started_at, completed_at, input_tokens, output_tokens, estimated_cost_usd, error, created_at, tasks(title)').eq('ai_employee_id', employee.id).order('created_at', { ascending: false }).limit(100);
    return data ?? [];
  });

  app.get('/ai/employees/:id/activity', view, async (req) => {
    const a = actorOf(req);
    const employee = await loadEmployee(a.orgId, idOf(req.params));
    const { data } = await s.db.from('activity_events').select('*').eq('organization_id', a.orgId).eq('actor_ai_employee_id', employee.id).order('created_at', { ascending: false }).limit(100);
    return data ?? [];
  });

  app.get('/ai/employees/:id/performance', view, async (req) => {
    const a = actorOf(req);
    const employee = await loadEmployee(a.orgId, idOf(req.params));
    const [{ data: sessions }, { data: approvals }, { count: docs }, { count: open }] = await Promise.all([
      s.db.from('ai_work_sessions').select('status, started_at, completed_at, estimated_cost_usd, input_tokens, output_tokens').eq('ai_employee_id', employee.id),
      s.db.from('approvals').select('status').eq('requested_by_ai_employee_id', employee.id).neq('status', 'pending'),
      s.db.from('documents').select('id', { count: 'exact', head: true }).eq('created_by_ai_employee_id', employee.id).is('deleted_at', null),
      s.db.from('tasks').select('id', { count: 'exact', head: true }).eq('assignee_ai_employee_id', employee.id).is('deleted_at', null).neq('status', 'done'),
    ]);
    const rows = (sessions ?? []) as Array<{ status: string; started_at: string | null; completed_at: string | null; estimated_cost_usd: number; input_tokens: number; output_tokens: number }>;
    const completed = rows.filter((r) => r.status === 'completed');
    const failed = rows.filter((r) => r.status === 'failed').length;
    const durations = completed.filter((r) => r.started_at && r.completed_at).map((r) => new Date(r.completed_at!).getTime() - new Date(r.started_at!).getTime());
    const decided = (approvals ?? []) as Array<{ status: string }>;
    return {
      tasks_completed: completed.length,
      tasks_failed: failed,
      success_rate: completed.length + failed > 0 ? Math.round((completed.length / (completed.length + failed)) * 100) : null,
      avg_completion_minutes: durations.length ? Math.round(durations.reduce((x, y) => x + y, 0) / durations.length / 60000) : null,
      current_workload: open ?? 0,
      tokens: rows.reduce((x, r) => x + Number(r.input_tokens) + Number(r.output_tokens), 0),
      estimated_cost_usd: Math.round(rows.reduce((x, r) => x + Number(r.estimated_cost_usd), 0) * 100) / 100,
      approval_rate: decided.length ? Math.round((decided.filter((d) => d.status === 'approved').length / decided.length) * 100) : null,
      documents_created: docs ?? 0,
    };
  });

  // Manager Computer View
  app.get('/ai/employees/:id/computer', { preHandler: orgGuard(s, { permission: 'ai.computer.view' }) }, async (req) => {
    const a = actorOf(req);
    const employee = await loadEmployee(a.orgId, idOf(req.params));
    const [{ data: computer }, { data: current }, { data: files }, { data: docs }] = await Promise.all([
      s.db.from('ai_computers').select('*').eq('ai_employee_id', employee.id).maybeSingle<{ id: string }>(),
      s.db.from('ai_work_sessions').select('*, tasks(title)').eq('ai_employee_id', employee.id).order('created_at', { ascending: false }).limit(1).maybeSingle<WorkSessionRow>(),
      s.db.from('company_files').select('id, original_name, size, category, created_at').eq('organization_id', a.orgId).eq('space', 'ai_workspace').eq('ai_employee_id', employee.id).is('deleted_at', null).order('created_at', { ascending: false }).limit(100),
      s.db.from('documents').select('id, title, doc_type, status, created_at').eq('organization_id', a.orgId).eq('created_by_ai_employee_id', employee.id).is('deleted_at', null).order('created_at', { ascending: false }).limit(50),
    ]);
    const logs = current?.computer_session_id ? await s.computer.getLogs(current.computer_session_id) : [];
    return { employee: { id: employee.id, name: employee.name, status: employee.status }, computer, capabilities: s.computer.capabilities, provider: s.computer.name, current_session: current, files: files ?? [], documents: docs ?? [], logs };
  });

  app.get('/ai/sessions/:id', view, async (req) => {
    const a = actorOf(req);
    const id = idOf(req.params);
    const { data: session } = await s.db.from('ai_work_sessions').select('*, tasks(title, description), ai_employees(name, job_title, avatar_seed)').eq('id', id).eq('organization_id', a.orgId).maybeSingle<WorkSessionRow>();
    if (!session) throw notFound('session_not_found');
    const [{ data: events }, { data: tools }, { data: outputs }, logs] = await Promise.all([
      s.db.from('ai_session_events').select('*').eq('session_id', id).order('id'),
      s.db.from('ai_tool_executions').select('*').eq('session_id', id).order('created_at'),
      s.db.from('ai_outputs').select('*').eq('session_id', id),
      session.computer_session_id && a.permissions.has('ai.computer.view') ? s.computer.getLogs(session.computer_session_id) : Promise.resolve([]),
    ]);
    const { resume_state: _r, ...safe } = session;
    return { ...safe, estimated_cost_sar: Math.round(Number(session.estimated_cost_usd) * s.env.USD_TO_SAR_RATE * 100) / 100, events: events ?? [], tool_executions: tools ?? [], outputs: outputs ?? [], computer_logs: logs };
  });

  app.post('/ai/sessions/:id/control', { preHandler: orgGuard(s, { permission: 'ai.control', paid: false }) }, async (req) => {
    const body = parse(sessionControlSchema, req.body);
    return s.agents.control(actorOf(req), idOf(req.params), body.action, body.reason);
  });

  app.get('/ai/outputs', view, async (req) => {
    const a = actorOf(req);
    const { data } = await s.db.from('ai_outputs').select('*, ai_employees(name)').eq('organization_id', a.orgId).order('created_at', { ascending: false }).limit(200);
    return data ?? [];
  });

  // AI Operations Room
  app.get('/ai/operations', view, async (req) => {
    const a = actorOf(req);
    const since = new Date(Date.now() - 24 * 3600_000).toISOString();
    const [employees, active, recent, approvals, usage] = await Promise.all([
      s.db.from('ai_employees').select('id, name, job_title, status, avatar_seed, department_id').eq('organization_id', a.orgId).is('deleted_at', null),
      s.db.from('ai_work_sessions').select('id, ai_employee_id, task_id, status, current_step, started_at, queued_at, input_tokens, output_tokens, estimated_cost_usd, tasks(title)').eq('organization_id', a.orgId).in('status', ['queued', 'preparing', 'running', 'paused', 'waiting_approval']).order('queued_at'),
      s.db.from('ai_work_sessions').select('id, ai_employee_id, status, current_step, completed_at, error, tasks(title)').eq('organization_id', a.orgId).in('status', ['completed', 'failed', 'cancelled']).gte('completed_at', since).order('completed_at', { ascending: false }).limit(50),
      s.db.from('approvals').select('id, title, risk, created_at, session_id, requested_by_ai_employee_id').eq('organization_id', a.orgId).eq('status', 'pending').order('created_at').limit(50),
      s.db.from('ai_usage_events').select('input_tokens, output_tokens, estimated_cost_usd').eq('organization_id', a.orgId).gte('created_at', since),
    ]);
    const activeIds = ((active.data ?? []) as Array<{ id: string }>).map((r) => r.id);
    const { data: toolActivity } = activeIds.length
      ? await s.db.from('ai_tool_executions').select('id, session_id, ai_employee_id, tool, status, created_at').in('session_id', activeIds).order('created_at', { ascending: false }).limit(50)
      : { data: [] };
    const u = (usage.data ?? []) as Array<{ input_tokens: number; output_tokens: number; estimated_cost_usd: number }>;
    const costUsd = u.reduce((x, r) => x + Number(r.estimated_cost_usd), 0);
    return {
      employees: employees.data ?? [],
      active_sessions: active.data ?? [],
      recent_sessions: recent.data ?? [],
      pending_approvals: approvals.data ?? [],
      tool_activity: toolActivity ?? [],
      usage_24h: { tokens: u.reduce((x, r) => x + r.input_tokens + r.output_tokens, 0), estimated_cost_usd: Math.round(costUsd * 100) / 100, estimated_cost_sar: Math.round(costUsd * s.env.USD_TO_SAR_RATE * 100) / 100 },
      provider: { ai: s.ai.name, is_mock: s.ai.isMock, computer: s.computer.name, capabilities: s.computer.capabilities },
    };
  });
}
