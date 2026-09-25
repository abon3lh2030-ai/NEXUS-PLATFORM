import { NEXUS_AI_TOOLS, type NexusAiTool } from '@nexus/shared';
import { z } from 'zod';
import type { OrgActor } from '../../context.js';
import { AppError, forbidden, notFound } from '../../lib/errors.js';
import type { Db } from '../../lib/supabase.js';
import type { AIProvider, AIUsage, ChatMessage } from '../ai/provider.js';
import type { AgentRuntime } from '../agent/runtime.js';
import type { InsightsService } from '../insights.js';
import type { WorkService } from '../work-service.js';

const nexusStepSchema = z.object({
  action: z.enum(['tool', 'respond']),
  tool: z.enum(NEXUS_AI_TOOLS).nullable(),
  tool_input: z
    .object({
      id: z.string().nullable(),
      name: z.string().nullable(),
      query: z.string().nullable(),
      title: z.string().nullable(),
      description: z.string().nullable(),
      status: z.string().nullable(),
      assignee_name: z.string().nullable(),
      project_name: z.string().nullable(),
      department_name: z.string().nullable(),
      days: z.number().nullable(),
    })
    .nullable(),
  message: z.string().nullable().describe('Final answer to the manager when action=respond (Markdown).'),
});
type NexusStep = z.infer<typeof nexusStepSchema>;
type ToolInput = NonNullable<NexusStep['tool_input']>;

const MAX_STEPS = 8;
const escLike = (q: string) => q.replace(/[%_\\,()]/g, (m) => `\\${m}`);

/**
 * Nexus AI — the manager's central assistant. It acts strictly AS the calling human:
 * every mutation goes through WorkService/AgentRuntime with the caller's permissions.
 * It has NO access to private manager files (not even the caller's own).
 */
export class NexusAiService {
  constructor(
    private readonly db: Db,
    private readonly ai: AIProvider,
    private readonly work: WorkService,
    private readonly agents: AgentRuntime,
    private readonly insights: InsightsService,
  ) {}

  async listConversations(actor: OrgActor) {
    const { data } = await this.db.from('nexus_conversations').select('id, title, updated_at').eq('organization_id', actor.orgId).eq('user_id', actor.userId).order('updated_at', { ascending: false }).limit(50);
    return data ?? [];
  }

  async getConversation(actor: OrgActor, id: string) {
    const { data: conv } = await this.db.from('nexus_conversations').select('*').eq('id', id).eq('organization_id', actor.orgId).eq('user_id', actor.userId).maybeSingle();
    if (!conv) throw notFound('conversation_not_found');
    const { data: messages } = await this.db.from('nexus_messages').select('id, role, content, tool_calls, created_at').eq('conversation_id', id).order('created_at');
    return { ...conv, messages: messages ?? [] };
  }

  async chat(actor: OrgActor, input: { conversation_id?: string | null | undefined; message: string; locale: 'ar' | 'en' }) {
    let conversationId = input.conversation_id ?? null;
    if (conversationId) {
      await this.getConversation(actor, conversationId);
    } else {
      const { data } = await this.db.from('nexus_conversations').insert({ organization_id: actor.orgId, user_id: actor.userId, title: input.message.slice(0, 80) }).select('id').single<{ id: string }>();
      if (!data) throw new AppError(500, 'conversation_create_failed');
      conversationId = data.id;
    }
    await this.db.from('nexus_messages').insert({ conversation_id: conversationId, organization_id: actor.orgId, user_id: actor.userId, role: 'user', content: input.message });

    const { data: history } = await this.db.from('nexus_messages').select('role, content').eq('conversation_id', conversationId).order('created_at', { ascending: false }).limit(12);
    const messages: ChatMessage[] = ((history ?? []) as ChatMessage[]).reverse();
    const system = await this.systemPrompt(actor, input.locale);

    const trace: Array<{ tool: NexusAiTool; input: ToolInput | null; ok: boolean; summary: string }> = [];
    let answer = '';
    let totalIn = 0;
    let totalOut = 0;
    let lastUsage: AIUsage | null = null;

    for (let step = 0; step < MAX_STEPS; step++) {
      const { data, usage } = await this.ai.generateStructured({ system, messages, schema: nexusStepSchema, schemaName: 'nexus_step' });
      totalIn += usage.inputTokens;
      totalOut += usage.outputTokens;
      lastUsage = usage;
      await this.db.from('ai_usage_events').insert({ organization_id: actor.orgId, user_id: actor.userId, source: 'nexus_ai', provider: usage.provider, model: usage.model, input_tokens: usage.inputTokens, output_tokens: usage.outputTokens, estimated_cost_usd: usage.estimatedCostUsd });

      if (data.action === 'respond' || !data.tool) {
        answer = data.message ?? '';
        break;
      }
      messages.push({ role: 'assistant', content: JSON.stringify(data) });
      let result: string;
      try {
        result = JSON.stringify(await this.runTool(actor, data.tool, data.tool_input ?? emptyInput()));
        trace.push({ tool: data.tool, input: data.tool_input, ok: true, summary: result.slice(0, 200) });
      } catch (err) {
        const code = err instanceof AppError ? err.code : 'tool_failed';
        result = JSON.stringify({ error: code });
        trace.push({ tool: data.tool, input: data.tool_input, ok: false, summary: code });
      }
      messages.push({ role: 'user', content: `TOOL RESULT (${data.tool}):\n${result.slice(0, 15000)}` });
    }
    if (!answer) answer = input.locale === 'ar' ? 'لم أتمكن من إكمال الطلب ضمن الحد المسموح من الخطوات.' : 'I could not complete the request within the step limit.';

    const { data: saved } = await this.db
      .from('nexus_messages')
      .insert({ conversation_id: conversationId, organization_id: actor.orgId, user_id: actor.userId, role: 'assistant', content: answer, tool_calls: trace, input_tokens: totalIn, output_tokens: totalOut })
      .select('id, role, content, tool_calls, created_at')
      .single();
    await this.db.from('nexus_conversations').update({ updated_at: new Date().toISOString() }).eq('id', conversationId);
    return { conversation_id: conversationId, message: saved, provider: lastUsage?.provider ?? this.ai.name, is_mock: this.ai.isMock };
  }

  private async systemPrompt(actor: OrgActor, locale: 'ar' | 'en'): Promise<string> {
    const perms = [...actor.permissions].join(', ');
    return [
      `You are Nexus AI, the central operating assistant of "${actor.orgName}" (a Saudi company) on the NEXUS platform.`,
      `You are speaking with a ${actor.role} of the company. You act on their behalf and ONLY within their permissions: ${perms}.`,
      'Each turn either call ONE tool (action="tool", fill tool_input fields you need, others null) or answer (action="respond", message in Markdown).',
      'Tools: inspect_company, inspect_department(name), inspect_employee(name), inspect_employee_computer(name), inspect_work_session(id), inspect_goal(name), inspect_mission(name), inspect_project(name), inspect_tasks(status?, assignee_name?, project_name?), retrieve_company_files(query) [shared files only], retrieve_documents(query), retrieve_memory(query), retrieve_decisions(query), summarize_activity(days), create_task(title, description, assignee_name?, project_name?), propose_mission(title, description), create_project(title, description, department_name?), assign_employee(id=task id, assignee_name), request_approval(title, description).',
      'To make a team or employee do work: find the AI employees (inspect_department / inspect_employee), then create_task with assignee_name set to the AI employee — this starts real work in their virtual computer.',
      'AI employees have a digital office: they can create real PowerPoint presentations, draft/send emails (subject to company policy and approvals), use the calendar, schedule meetings and process meeting outcomes. For such requests, create a task for the AI employee describing the full workflow (e.g. research → presentation → manager approval → schedule meeting → follow-up).',
      'Never invent data: base answers on tool results. You cannot access private manager files, secrets, or other companies — say so if asked.',
      `Answer in ${locale === 'ar' ? 'Arabic (Saudi-friendly Modern Standard Arabic)' : 'English'}. Be concise and structured.`,
      `Today is ${new Date().toISOString().slice(0, 10)}.`,
    ].join('\n');
  }

  private async findAiEmployee(orgId: string, name: string) {
    const { data } = await this.db.from('ai_employees').select('id, name, job_title, status, department_id').eq('organization_id', orgId).is('deleted_at', null).or(`name.ilike.%${escLike(name)}%,job_title.ilike.%${escLike(name)}%`).limit(1).maybeSingle<{ id: string; name: string; job_title: string; status: string; department_id: string | null }>();
    return data;
  }

  private async findMember(orgId: string, name: string) {
    const { data: members } = await this.db.from('organization_members').select('id, user_id').eq('organization_id', orgId).eq('status', 'active');
    const rows = (members ?? []) as Array<{ id: string; user_id: string }>;
    if (!rows.length) return null;
    const { data: p } = await this.db.from('profiles').select('id, full_name').in('id', rows.map((r) => r.user_id)).ilike('full_name', `%${escLike(name)}%`).limit(1).maybeSingle<{ id: string; full_name: string }>();
    const m = p ? rows.find((r) => r.user_id === p.id) : null;
    return m && p ? { id: m.id, name: p.full_name } : null;
  }

  private async findByTitle(table: string, orgId: string, name: string, col = 'title') {
    const { data } = await this.db.from(table).select('*').eq('organization_id', orgId).is('deleted_at', null).ilike(col, `%${escLike(name)}%`).limit(1).maybeSingle<Record<string, unknown> & { id: string }>();
    if (!data) throw notFound(`${table}_not_found`);
    return data;
  }

  private async runTool(actor: OrgActor, tool: NexusAiTool, i: ToolInput): Promise<unknown> {
    const org = actor.orgId;
    switch (tool) {
      case 'inspect_company':
        return { company: actor.orgName, snapshot: await this.insights.companySnapshot(org), health: await this.insights.health(org) };
      case 'inspect_department': {
        const d = await this.findByTitle('departments', org, i.name ?? i.department_name ?? '', 'name');
        const [ais, members, projects] = await Promise.all([
          this.db.from('ai_employees').select('id, name, job_title, status').eq('department_id', d.id).is('deleted_at', null),
          this.db.from('organization_members').select('id, job_title, role').eq('department_id', d.id).eq('status', 'active'),
          this.db.from('projects').select('id, title, status, progress').eq('department_id', d.id).is('deleted_at', null),
        ]);
        return { department: { id: d.id, name: d.name, objective: d.objective }, ai_employees: ais.data ?? [], human_members: members.data ?? [], projects: projects.data ?? [] };
      }
      case 'inspect_employee': {
        const name = i.name ?? i.assignee_name ?? '';
        const ai = await this.findAiEmployee(org, name);
        if (ai) {
          const { data: sessions } = await this.db.from('ai_work_sessions').select('id, status, current_step, task_id, created_at').eq('ai_employee_id', ai.id).order('created_at', { ascending: false }).limit(5);
          return { type: 'ai_employee', employee: ai, recent_sessions: sessions ?? [] };
        }
        const human = await this.findMember(org, name);
        if (human) {
          const { data: tasks } = await this.db.from('tasks').select('id, title, status, due_date').eq('assignee_member_id', human.id).is('deleted_at', null).neq('status', 'done').limit(10);
          return { type: 'human', employee: human, open_tasks: tasks ?? [] };
        }
        throw notFound('employee_not_found');
      }
      case 'inspect_employee_computer': {
        if (!actor.permissions.has('ai.computer.view')) throw forbidden();
        const ai = await this.findAiEmployee(org, i.name ?? i.assignee_name ?? '');
        if (!ai) throw notFound('employee_not_found');
        const { data: session } = await this.db.from('ai_work_sessions').select('id, status, current_step, started_at, input_tokens, output_tokens, estimated_cost_usd, computer_session_id').eq('ai_employee_id', ai.id).order('created_at', { ascending: false }).limit(1).maybeSingle<{ id: string; computer_session_id: string | null }>();
        const { data: tools } = session ? await this.db.from('ai_tool_executions').select('tool, status, created_at').eq('session_id', session.id).order('created_at', { ascending: false }).limit(10) : { data: [] };
        return { employee: ai, latest_session: session, recent_tool_activity: tools ?? [] };
      }
      case 'inspect_work_session': {
        const { data } = await this.db.from('ai_work_sessions').select('*').eq('id', i.id ?? '').eq('organization_id', org).maybeSingle();
        if (!data) throw notFound('session_not_found');
        const { data: events } = await this.db.from('ai_session_events').select('event_type, message, created_at').eq('session_id', i.id ?? '').order('id').limit(50);
        return { session: data, timeline: events ?? [] };
      }
      case 'inspect_goal':
        return this.findByTitle('goals', org, i.name ?? i.title ?? '');
      case 'inspect_mission': {
        const m = await this.findByTitle('missions', org, i.name ?? i.title ?? '');
        return this.work.get(actor, 'missions', m.id);
      }
      case 'inspect_project': {
        const p = await this.findByTitle('projects', org, i.name ?? i.project_name ?? i.title ?? '');
        return this.work.get(actor, 'projects', p.id);
      }
      case 'inspect_tasks': {
        let q = this.db.from('tasks').select('id, title, status, priority, due_date, assignee_ai_employee_id, assignee_member_id').eq('organization_id', org).is('deleted_at', null).limit(40);
        if (i.status) q = q.eq('status', i.status);
        if (i.assignee_name) {
          const ai = await this.findAiEmployee(org, i.assignee_name);
          if (ai) q = q.eq('assignee_ai_employee_id', ai.id);
        }
        if (i.project_name) {
          const p = await this.findByTitle('projects', org, i.project_name);
          q = q.eq('project_id', p.id);
        }
        return (await q).data ?? [];
      }
      case 'retrieve_company_files': {
        if (!actor.permissions.has('files.shared.view')) throw forbidden();
        // Shared files only — private files are never exposed to Nexus AI.
        let q = this.db.from('company_files').select('id, original_name, category, size, created_at, uploaded_by_ai_employee_id').eq('organization_id', org).eq('space', 'shared').eq('visibility', 'organization_shared').eq('status', 'ready').is('deleted_at', null).order('created_at', { ascending: false }).limit(30);
        if (i.query) q = q.ilike('original_name', `%${escLike(i.query)}%`);
        return (await q).data ?? [];
      }
      case 'retrieve_documents': {
        let q = this.db.from('documents').select('id, title, doc_type, updated_at, created_by_ai_employee_id').eq('organization_id', org).is('deleted_at', null).eq('status', 'published').order('updated_at', { ascending: false }).limit(20);
        if (i.query) q = q.or(`title.ilike.%${escLike(i.query)}%,content.ilike.%${escLike(i.query)}%`);
        if (i.department_name) {
          const d = await this.findByTitle('departments', org, i.department_name, 'name');
          const { data: ais } = await this.db.from('ai_employees').select('id').eq('department_id', d.id);
          const ids = ((ais ?? []) as Array<{ id: string }>).map((a) => a.id);
          if (ids.length) q = q.in('created_by_ai_employee_id', ids);
        }
        return (await q).data ?? [];
      }
      case 'retrieve_memory': {
        let q = this.db.from('memories').select('title, content, memory_type, pinned').eq('organization_id', org).is('archived_at', null).limit(20);
        if (i.query) q = q.or(`title.ilike.%${escLike(i.query)}%,content.ilike.%${escLike(i.query)}%`);
        return (await q).data ?? [];
      }
      case 'retrieve_decisions': {
        let q = this.db.from('decisions').select('title, chosen_option, reasoning, impact, created_at').eq('organization_id', org).is('deleted_at', null).order('created_at', { ascending: false }).limit(20);
        if (i.query) q = q.ilike('title', `%${escLike(i.query)}%`);
        return (await q).data ?? [];
      }
      case 'summarize_activity': {
        const days = Math.min(Math.max(i.days ?? 7, 1), 90);
        const { data } = await this.db.from('activity_events').select('verb, entity_type, summary, created_at, actor_ai_employee_id').eq('organization_id', org).gte('created_at', new Date(Date.now() - days * 86400_000).toISOString()).order('created_at', { ascending: false }).limit(80);
        const { data: running } = await this.db.from('ai_work_sessions').select('ai_employee_id, current_step, status').eq('organization_id', org).in('status', ['running', 'preparing', 'waiting_approval', 'queued']);
        return { recent_activity: data ?? [], active_ai_work: running ?? [] };
      }
      case 'create_task': {
        let assignee_ai_employee_id: string | null = null;
        let assignee_member_id: string | null = null;
        if (i.assignee_name) {
          const ai = await this.findAiEmployee(org, i.assignee_name);
          if (ai) assignee_ai_employee_id = ai.id;
          else assignee_member_id = (await this.findMember(org, i.assignee_name))?.id ?? null;
        }
        const project_id = i.project_name ? (await this.findByTitle('projects', org, i.project_name)).id : null;
        const task = await this.work.create(actor, 'tasks', { title: (i.title ?? 'Task').slice(0, 300), description: i.description ?? '', assignee_ai_employee_id, assignee_member_id, project_id, priority: 'medium' });
        return { created_task: task, ai_work_started: Boolean(assignee_ai_employee_id) };
      }
      case 'propose_mission': {
        const mission = await this.work.create(actor, 'missions', { title: (i.title ?? 'Mission').slice(0, 200), description: i.description ?? '', objective: i.description ?? '', status: 'planned', priority: 'medium' });
        return { proposed_mission: mission };
      }
      case 'create_project': {
        const department_id = i.department_name ? (await this.findByTitle('departments', org, i.department_name, 'name')).id : null;
        return { created_project: await this.work.create(actor, 'projects', { title: (i.title ?? 'Project').slice(0, 200), description: i.description ?? '', department_id, status: 'planned' }) };
      }
      case 'assign_employee': {
        if (!i.id || !i.assignee_name) throw new AppError(400, 'missing_input');
        const ai = await this.findAiEmployee(org, i.assignee_name);
        if (ai) return { session: await this.agents.assignTask(actor, ai.id, i.id) };
        const human = await this.findMember(org, i.assignee_name);
        if (!human) throw notFound('employee_not_found');
        return { task: await this.work.update(actor, 'tasks', i.id, { assignee_member_id: human.id }) };
      }
      case 'request_approval': {
        const { data } = await this.db.from('approvals').insert({ organization_id: org, title: (i.title ?? 'Approval').slice(0, 300), description: i.description ?? '', approval_type: 'custom', requested_by_user_id: actor.userId }).select('id').single();
        return { approval: data };
      }
    }
  }
}

function emptyInput(): ToolInput {
  return { id: null, name: null, query: null, title: null, description: null, status: null, assignee_name: null, project_name: null, department_name: null, days: null };
}
