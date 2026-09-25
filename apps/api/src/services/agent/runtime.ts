import { hostname } from 'node:os';
import { AI_SAFETY_LIMITS, autonomyAtLeast, type AgentTool } from '@nexus/shared';
import type { FastifyBaseLogger } from 'fastify';
import type { Env } from '../../config/env.js';
import type { AiActor, OrgActor } from '../../context.js';
import { AppError, badRequest, conflict, forbidden, notFound, paymentRequired } from '../../lib/errors.js';
import type { Db } from '../../lib/supabase.js';
import type { AiEmployeeRow, AiPermissionRow, ApprovalRow, OrganizationRow, TaskRow, WorkSessionRow } from '../../types/db.js';
import { AIProviderError, type AIProvider, type AIUsage, type ChatMessage } from '../ai/provider.js';
import type { AuditService } from '../audit.js';
import { ComputerCapabilityError, type ComputerProvider, type ComputerSession } from '../computer/computer-provider.js';
import type { BillingState, EntitlementService } from '../entitlements.js';
import type { FileService } from '../files/file-service.js';
import type { NotificationService } from '../notifications.js';
import { buildAgentSystemPrompt, buildTaskKickoff } from './prompts.js';
import { agentStepSchema, cleanArgs, TOOL_ARG_SCHEMAS, type AgentStep } from './schemas.js';
import { evaluateToolCall, redactForLog } from './tool-guard.js';
import { AgentToolExecutor, type DelegationPort, type ToolContext, type ToolResult } from './tools.js';

interface ResumeState {
  messages: ChatMessage[];
  pending?: { tool: AgentTool; args: Record<string, unknown>; executionId: string; approvalId: string } | undefined;
  voluntaryApprovalId?: string | undefined;
  artifacts: NonNullable<ToolResult['artifact']>[];
}

interface Deps {
  env: Env;
  db: Db;
  ai: AIProvider;
  computer: ComputerProvider;
  files: FileService;
  entitlements: EntitlementService;
  notifications: NotificationService;
  audit: AuditService;
  log: FastifyBaseLogger;
}

const PHASE_TO_STATUS = { thinking: 'thinking', researching: 'researching', reading: 'reading', writing: 'writing', executing: 'executing' } as const;

export class AgentRuntime implements DelegationPort {
  private readonly tools: AgentToolExecutor;
  private readonly workerId = `${hostname()}:${process.pid}`;
  private running = 0;
  private timer: NodeJS.Timeout | null = null;
  private stopped = true;

  constructor(private readonly d: Deps) {
    this.tools = new AgentToolExecutor(d.db, d.files, d.computer, this);
  }

  /* ============================== loading ============================== */

  async loadAiActor(orgId: string, aiEmployeeId: string, sessionId: string): Promise<{ employee: AiEmployeeRow; actor: AiActor }> {
    const [{ data: employee }, { data: perms }] = await Promise.all([
      this.d.db.from('ai_employees').select('*').eq('id', aiEmployeeId).eq('organization_id', orgId).is('deleted_at', null).maybeSingle<AiEmployeeRow>(),
      this.d.db.from('ai_employee_permissions').select('*').eq('ai_employee_id', aiEmployeeId).eq('organization_id', orgId).maybeSingle<AiPermissionRow>(),
    ]);
    if (!employee) throw notFound('ai_employee_not_found');
    return {
      employee,
      actor: {
        kind: 'ai',
        orgId,
        aiEmployeeId,
        name: employee.name,
        permissions: new Set(perms?.permissions ?? []),
        allowedFolderIds: perms?.allowed_folder_ids ?? [],
        autonomy: employee.autonomy,
        sessionId,
      },
    };
  }

  private async event(s: Pick<WorkSessionRow, 'id' | 'organization_id' | 'ai_employee_id'>, type: string, message: string, data: Record<string, unknown> = {}) {
    await this.d.db.from('ai_session_events').insert({ organization_id: s.organization_id, session_id: s.id, ai_employee_id: s.ai_employee_id, event_type: type, message: message.slice(0, 500), data });
  }

  private async setEmployeeStatus(orgId: string, aiEmployeeId: string, status: string) {
    await this.d.db.from('ai_employees').update({ status }).eq('id', aiEmployeeId).eq('organization_id', orgId);
  }

  private async updateSession(id: string, patch: Record<string, unknown>) {
    await this.d.db.from('ai_work_sessions').update(patch).eq('id', id);
  }

  /* ============================== enqueue ============================== */

  async enqueue(p: {
    orgId: string;
    aiEmployeeId: string;
    taskId: string | null;
    billing: BillingState;
    requestedByUserId?: string | null;
    requestedByAiEmployeeId?: string | null;
    parentSessionId?: string | null;
    depth?: number;
    priority?: number;
  }): Promise<WorkSessionRow> {
    if (!p.billing.active) throw paymentRequired('subscription_required');
    const depth = p.depth ?? 0;
    if (depth > AI_SAFETY_LIMITS.maxDelegationDepth) throw forbidden('delegation_depth_exceeded');

    const { data: employee } = await this.d.db
      .from('ai_employees')
      .select('id, name, model, provider, is_active, organization_id')
      .eq('id', p.aiEmployeeId)
      .eq('organization_id', p.orgId)
      .is('deleted_at', null)
      .maybeSingle<Pick<AiEmployeeRow, 'id' | 'name' | 'model' | 'provider' | 'is_active' | 'organization_id'>>();
    if (!employee) throw notFound('ai_employee_not_found');
    if (!employee.is_active) throw conflict('ai_employee_inactive');

    let task: TaskRow | null = null;
    if (p.taskId) {
      const { data } = await this.d.db.from('tasks').select('*').eq('id', p.taskId).eq('organization_id', p.orgId).is('deleted_at', null).maybeSingle<TaskRow>();
      if (!data) throw notFound('task_not_found');
      task = data;
      const { data: active } = await this.d.db
        .from('ai_work_sessions')
        .select('id')
        .eq('task_id', task.id)
        .in('status', ['queued', 'preparing', 'running', 'paused', 'waiting_approval'])
        .limit(1);
      if ((active ?? []).length > 0) throw conflict('task_already_running');
    }

    // Metered: one AI execution per work session (atomic, server-side).
    await this.d.entitlements.consumeExecution(p.orgId, p.billing);

    const { data: session, error } = await this.d.db
      .from('ai_work_sessions')
      .insert({
        organization_id: p.orgId,
        ai_employee_id: employee.id,
        task_id: task?.id ?? null,
        parent_session_id: p.parentSessionId ?? null,
        delegation_depth: depth,
        status: 'queued',
        current_step: 'Task received',
        priority: p.priority ?? 2,
        provider: this.d.ai.name,
        model: this.d.ai.isMock ? this.d.ai.defaultModel : employee.model,
        requested_by_user_id: p.requestedByUserId ?? null,
        requested_by_ai_employee_id: p.requestedByAiEmployeeId ?? null,
      })
      .select('*')
      .single<WorkSessionRow>();
    if (error || !session) throw new AppError(500, 'session_create_failed', error?.message);

    if (task) {
      await this.d.db.from('tasks').update({ assignee_ai_employee_id: employee.id, assignee_member_id: null, status: 'in_progress' }).eq('id', task.id);
      await this.d.db.from('ai_employee_inbox').insert({
        organization_id: p.orgId,
        ai_employee_id: employee.id,
        item_type: 'task',
        title: task.title,
        body: task.description.slice(0, 2000),
        related_type: 'task',
        related_id: task.id,
        from_user_id: p.requestedByUserId ?? null,
        from_ai_employee_id: p.requestedByAiEmployeeId ?? null,
      });
    }
    await this.event(session, 'task_received', task ? `Task received: ${task.title}` : 'Session queued');
    await this.setEmployeeStatus(p.orgId, employee.id, 'queued');
    return session;
  }

  /** AI-to-AI delegation with hard limits (depth, child actions, same org, target active). */
  async delegate(ctx: ToolContext, targetId: string, title: string, description: string): Promise<{ taskId: string; sessionId: string }> {
    const { session, ai } = ctx;
    if (session.delegation_depth + 1 > AI_SAFETY_LIMITS.maxDelegationDepth) throw forbidden('delegation_depth_exceeded');
    if (session.child_action_count + 1 > AI_SAFETY_LIMITS.maxChildActionsPerSession) throw forbidden('child_action_limit_reached');
    const billing = await this.d.entitlements.getBillingState(ai.orgId);
    if (!billing.entitlements.features.includes('agent_orchestration')) throw paymentRequired('feature_not_in_plan', { feature: 'agent_orchestration' });

    const { data: child } = await this.d.db
      .from('tasks')
      .insert({
        organization_id: ai.orgId,
        parent_task_id: ctx.task?.id ?? null,
        project_id: ctx.task?.project_id ?? null,
        mission_id: ctx.task?.mission_id ?? null,
        title,
        description,
        creator_ai_employee_id: ai.aiEmployeeId,
        assignee_ai_employee_id: targetId,
        status: 'todo',
      })
      .select('id')
      .single<{ id: string }>();
    if (!child) throw new AppError(500, 'task_create_failed');
    await this.updateSession(session.id, { child_action_count: session.child_action_count + 1 });
    session.child_action_count += 1;
    const childSession = await this.enqueue({
      orgId: ai.orgId,
      aiEmployeeId: targetId,
      taskId: child.id,
      billing,
      requestedByAiEmployeeId: ai.aiEmployeeId,
      parentSessionId: session.id,
      depth: session.delegation_depth + 1,
    });
    return { taskId: child.id, sessionId: childSession.id };
  }

  /* ============================== manager controls ============================== */

  async control(actor: OrgActor, sessionId: string, action: 'pause' | 'resume' | 'cancel' | 'request_stop', reason?: string): Promise<WorkSessionRow> {
    const { data: s } = await this.d.db.from('ai_work_sessions').select('*').eq('id', sessionId).eq('organization_id', actor.orgId).maybeSingle<WorkSessionRow>();
    if (!s) throw notFound('session_not_found');
    const terminal = ['completed', 'failed', 'cancelled'].includes(s.status);
    if (terminal) throw conflict('session_finished');

    if (action === 'resume') {
      if (s.status !== 'paused') throw conflict('session_not_paused');
      if (!actor.billing.active) throw paymentRequired('subscription_required');
      await this.updateSession(s.id, { status: 'queued', control_request: null, queued_at: new Date().toISOString() });
      await this.event(s, 'resumed', 'Resumed by manager');
    } else if (action === 'pause') {
      if (s.status === 'queued' || s.status === 'waiting_approval') {
        await this.updateSession(s.id, { status: 'paused', control_request: null });
        await this.setEmployeeStatus(s.organization_id, s.ai_employee_id, 'waiting');
      } else {
        await this.updateSession(s.id, { control_request: 'pause' });
      }
      await this.event(s, 'pause_requested', 'Pause requested by manager');
    } else {
      if (['queued', 'paused', 'waiting_approval'].includes(s.status)) {
        await this.finalizeCancelled(s, reason ?? action);
      } else {
        await this.updateSession(s.id, { control_request: action === 'cancel' ? 'cancel' : 'request_stop' });
        await this.event(s, 'stop_requested', action === 'cancel' ? 'Cancellation requested by manager' : 'Stop requested by manager');
      }
    }
    await this.d.audit.audit({ organizationId: actor.orgId, actorType: 'human', actorUserId: actor.userId, action: `ai_session.${action}`, targetType: 'ai_work_session', targetId: s.id });
    const { data } = await this.d.db.from('ai_work_sessions').select('*').eq('id', s.id).single<WorkSessionRow>();
    return data!;
  }

  private async finalizeCancelled(s: WorkSessionRow, reason: string) {
    await this.updateSession(s.id, { status: 'cancelled', control_request: null, completed_at: new Date().toISOString(), error: `cancelled: ${reason}`.slice(0, 500), locked_by: null });
    await this.d.db.from('approvals').update({ status: 'rejected', decision_comment: 'Session cancelled' }).eq('session_id', s.id).eq('status', 'pending');
    await this.event(s, 'cancelled', 'Session cancelled');
    await this.refreshEmployeeStatus(s.organization_id, s.ai_employee_id);
  }

  private async refreshEmployeeStatus(orgId: string, aiEmployeeId: string, fallback = 'idle') {
    const { data } = await this.d.db.from('ai_work_sessions').select('status').eq('ai_employee_id', aiEmployeeId).in('status', ['queued', 'preparing', 'running', 'waiting_approval']).limit(1);
    const next = (data ?? []) as Array<{ status: string }>;
    await this.setEmployeeStatus(orgId, aiEmployeeId, next[0] ? (next[0].status === 'waiting_approval' ? 'waiting_approval' : 'queued') : fallback);
  }

  /* ============================== approvals ============================== */

  async onApprovalDecided(approval: ApprovalRow, decision: 'approved' | 'rejected' | 'revision_requested', comment: string, userId: string): Promise<void> {
    if (!approval.session_id) return;
    const { data: s } = await this.d.db.from('ai_work_sessions').select('*').eq('id', approval.session_id).maybeSingle<WorkSessionRow>();
    if (!s) return;

    if (approval.approval_type === 'ai_output') {
      await this.resolveOutputApproval(s, approval, decision, comment, userId);
      return;
    }
    if (s.status !== 'waiting_approval') return;
    const state = (s.resume_state ?? { messages: [], artifacts: [] }) as ResumeState;
    const verdictText = decision === 'approved' ? 'APPROVED' : decision === 'rejected' ? 'REJECTED' : 'REVISION REQUESTED';

    if (state.pending && state.pending.approvalId === approval.id) {
      const pending = state.pending;
      let resultText: string;
      if (decision === 'approved') {
        const { actor } = await this.loadAiActor(s.organization_id, s.ai_employee_id, s.id);
        const task = s.task_id ? ((await this.d.db.from('tasks').select('*').eq('id', s.task_id).maybeSingle<TaskRow>()).data ?? null) : null;
        const computer = await this.d.computer.createSession(actor, s.id);
        try {
          const res = await this.executeGuarded(pending.tool, pending.args, { ai: actor, session: s, computer, task }, { preApproved: true, executionId: pending.executionId });
          if (res.artifact) state.artifacts.push(res.artifact);
          resultText = `Manager ${verdictText} your ${pending.tool} action. Result:\n${res.output}`;
        } finally {
          await this.d.computer.terminateSession(computer);
        }
      } else {
        await this.d.db.from('ai_tool_executions').update({ status: 'failed', error: `manager_${decision}`, completed_at: new Date().toISOString() }).eq('id', pending.executionId);
        resultText = `Manager ${verdictText} your ${pending.tool} action.${comment ? ` Comment: ${comment}` : ''} Adjust your plan.`;
      }
      state.messages.push({ role: 'user', content: resultText });
      state.pending = undefined;
    } else if (state.voluntaryApprovalId === approval.id) {
      state.messages.push({ role: 'user', content: `Manager ${verdictText} your request.${comment ? ` Comment: ${comment}` : ''}` });
      state.voluntaryApprovalId = undefined;
    } else {
      return;
    }

    await this.updateSession(s.id, { status: 'queued', resume_state: state, queued_at: new Date().toISOString(), current_step: `Approval ${decision}` });
    await this.event(s, 'approval_result', `Manager decision: ${decision}`, { approval_id: approval.id });
    await this.d.db.from('ai_employee_inbox').insert({
      organization_id: s.organization_id,
      ai_employee_id: s.ai_employee_id,
      item_type: 'approval_result',
      title: `Approval ${decision}`,
      body: comment,
      related_type: 'approval',
      related_id: approval.id,
      from_user_id: userId,
    });
  }

  private async resolveOutputApproval(s: WorkSessionRow, approval: ApprovalRow, decision: 'approved' | 'rejected' | 'revision_requested', comment: string, userId: string) {
    const outputId = approval.entity_id;
    const docIds = ((approval.payload.document_ids as string[] | undefined) ?? []).filter(Boolean);
    if (decision === 'approved') {
      if (outputId) await this.d.db.from('ai_outputs').update({ status: 'approved' }).eq('id', outputId);
      if (docIds.length) await this.d.db.from('documents').update({ status: 'published' }).in('id', docIds).eq('organization_id', s.organization_id);
      if (s.task_id) await this.d.db.from('tasks').update({ status: 'done', completed_at: new Date().toISOString() }).eq('id', s.task_id);
    } else if (decision === 'rejected') {
      if (outputId) await this.d.db.from('ai_outputs').update({ status: 'rejected' }).eq('id', outputId);
      if (s.task_id) await this.d.db.from('tasks').update({ status: 'todo' }).eq('id', s.task_id);
    } else {
      if (outputId) await this.d.db.from('ai_outputs').update({ status: 'rejected' }).eq('id', outputId);
      await this.d.db.from('ai_employee_inbox').insert({
        organization_id: s.organization_id,
        ai_employee_id: s.ai_employee_id,
        item_type: 'manager_instruction',
        title: 'Revision requested',
        body: comment || 'Please revise the deliverable.',
        related_type: 'task',
        related_id: s.task_id,
        from_user_id: userId,
      });
      if (s.task_id) {
        const billing = await this.d.entitlements.getBillingState(s.organization_id);
        await this.enqueue({ orgId: s.organization_id, aiEmployeeId: s.ai_employee_id, taskId: s.task_id, billing, requestedByUserId: userId });
      }
    }
  }

  /* ============================== worker ============================== */

  startWorker(): void {
    if (!this.stopped) return;
    this.stopped = false;
    const tick = async () => {
      if (this.stopped) return;
      try {
        while (this.running < this.d.env.AGENT_WORKER_CONCURRENCY) {
          const claimed = await this.claim();
          if (!claimed) break;
          this.running++;
          void this.runSession(claimed)
            .catch((err: unknown) => this.d.log.error({ err, sessionId: claimed.id }, 'agent_session_crashed'))
            .finally(() => {
              this.running--;
            });
        }
      } catch (err) {
        this.d.log.error({ err }, 'agent_worker_tick_failed');
      }
      this.timer = setTimeout(() => void tick(), this.d.env.AGENT_POLL_INTERVAL_MS);
    };
    void tick();
    this.d.log.info({ worker: this.workerId, concurrency: this.d.env.AGENT_WORKER_CONCURRENCY, provider: this.d.ai.name }, 'agent worker started');
  }

  stopWorker(): void {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
  }

  private async claim(): Promise<WorkSessionRow | null> {
    const { data, error } = await this.d.db.rpc('claim_next_work_session', { p_worker: this.workerId });
    if (error) throw new Error(error.message);
    const s = ((data ?? []) as WorkSessionRow[])[0];
    if (!s) return null;
    // Per-organization concurrency entitlement.
    const billing = await this.d.entitlements.getBillingState(s.organization_id);
    const limit = billing.entitlements.concurrent_ai_sessions ?? Number.MAX_SAFE_INTEGER;
    const { count } = await this.d.db
      .from('ai_work_sessions')
      .select('id', { count: 'exact', head: true })
      .eq('organization_id', s.organization_id)
      .in('status', ['preparing', 'running'])
      .neq('id', s.id);
    if ((count ?? 0) >= limit) {
      await this.updateSession(s.id, { status: 'queued', locked_by: null, locked_at: null, queued_at: new Date(Date.now() + 15_000).toISOString() });
      return null;
    }
    return s;
  }

  /** Runs (or resumes) one work session until it finishes, pauses, waits for approval, or fails. */
  async runSession(session: WorkSessionRow): Promise<void> {
    const s = session;
    const started = Date.now();
    let computer: ComputerSession | null = null;
    try {
      const billing = await this.d.entitlements.getBillingState(s.organization_id);
      if (!billing.active) throw new AppError(402, 'subscription_inactive');

      const { employee, actor } = await this.loadAiActor(s.organization_id, s.ai_employee_id, s.id);
      const { data: org } = await this.d.db.from('organizations').select('*').eq('id', s.organization_id).single<OrganizationRow>();
      if (!org || org.status !== 'active') throw new AppError(403, 'organization_inactive');
      const task = s.task_id ? ((await this.d.db.from('tasks').select('*').eq('id', s.task_id).maybeSingle<TaskRow>()).data ?? null) : null;

      await this.setEmployeeStatus(s.organization_id, s.ai_employee_id, 'preparing');
      computer = await this.d.computer.createSession(actor, s.id);
      await this.updateSession(s.id, { status: 'running', computer_session_id: computer.id, current_step: 'Context loaded', locked_at: new Date().toISOString() });
      await this.event(s, 'context_loaded', 'Context loaded');

      const [{ data: colleagues }, { data: instructions }] = await Promise.all([
        this.d.db.from('ai_employees').select('id, name, job_title').eq('organization_id', s.organization_id).is('deleted_at', null).eq('is_active', true).neq('id', s.ai_employee_id).limit(30),
        this.d.db.from('ai_employee_inbox').select('id, body').eq('ai_employee_id', s.ai_employee_id).eq('item_type', 'manager_instruction').is('read_at', null).limit(10),
      ]);
      const instructionRows = (instructions ?? []) as Array<{ id: string; body: string }>;
      if (instructionRows.length) await this.d.db.from('ai_employee_inbox').update({ read_at: new Date().toISOString() }).in('id', instructionRows.map((i) => i.id));

      const system = buildAgentSystemPrompt({
        employee,
        ai: actor,
        orgName: org.name,
        locale: org.default_locale,
        caps: this.d.computer.capabilities,
        colleagues: (colleagues ?? []) as Array<{ id: string; name: string; job_title: string }>,
        instructions: instructionRows.map((i) => i.body),
      });
      const state: ResumeState = (s.resume_state as ResumeState | null) ?? { messages: [{ role: 'user', content: buildTaskKickoff(task) }], artifacts: [] };
      const ctx: ToolContext = { ai: actor, session: s, computer, task };

      for (;;) {
        // --- manager control & safety limits ---
        const { data: fresh } = await this.d.db.from('ai_work_sessions').select('control_request, step_count, input_tokens, output_tokens, estimated_cost_usd').eq('id', s.id).single<Pick<WorkSessionRow, 'control_request' | 'step_count' | 'input_tokens' | 'output_tokens' | 'estimated_cost_usd'>>();
        if (fresh?.control_request === 'pause') {
          await this.updateSession(s.id, { status: 'paused', control_request: null, resume_state: state, locked_by: null, current_step: 'Paused by manager' });
          await this.event(s, 'paused', 'Paused by manager');
          await this.setEmployeeStatus(s.organization_id, s.ai_employee_id, 'waiting');
          return;
        }
        if (fresh?.control_request === 'cancel' || fresh?.control_request === 'request_stop') {
          await this.finalizeCancelled({ ...s }, fresh.control_request);
          return;
        }
        const steps = fresh?.step_count ?? s.step_count;
        if (steps >= AI_SAFETY_LIMITS.maxStepsPerSession) throw new AppError(429, 'step_limit_reached');
        if (Date.now() - started > AI_SAFETY_LIMITS.sessionTimeoutMs) throw new AppError(408, 'session_timeout');
        const tokens = Number(fresh?.input_tokens ?? 0) + Number(fresh?.output_tokens ?? 0);
        if (tokens > AI_SAFETY_LIMITS.maxTokensPerSession) throw new AppError(429, 'token_limit_reached');
        const costSarHalalas = Number(fresh?.estimated_cost_usd ?? 0) * this.d.env.USD_TO_SAR_RATE * 100;
        if (costSarHalalas > AI_SAFETY_LIMITS.maxCostHalalasPerSession) throw new AppError(429, 'cost_limit_reached');

        // --- LLM → structured output (Zod-validated) ---
        await this.setEmployeeStatus(s.organization_id, s.ai_employee_id, 'thinking');
        const { data: step, usage } = await this.callModel(s, system, state.messages);
        await this.recordUsage(s, usage, steps + 1);
        state.messages.push({ role: 'assistant', content: JSON.stringify(step) });

        await this.setEmployeeStatus(s.organization_id, s.ai_employee_id, PHASE_TO_STATUS[step.phase]);
        await this.updateSession(s.id, { current_step: step.progress_note.slice(0, 300), locked_at: new Date().toISOString() });
        await this.event(s, 'step', step.progress_note, { tool: step.tool, phase: step.phase });

        // --- per-tool argument validation ---
        const argSchema = TOOL_ARG_SCHEMAS[step.tool];
        const parsed = argSchema.safeParse(cleanArgs(step.args));
        if (!parsed.success) {
          state.messages.push({ role: 'user', content: `Invalid args for ${step.tool}: ${parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}. Try again.` });
          continue;
        }
        const args = parsed.data as Record<string, unknown>;

        // --- permission / autonomy / risk gate ---
        const guard = evaluateToolCall(actor, step.tool, this.d.computer.capabilities);
        if (guard.decision === 'deny') {
          await this.recordToolExecution(s, step.tool, args, 'denied', guard.risk, { denial_reason: guard.reason });
          await this.event(s, 'tool_denied', `Denied: ${step.tool} (${guard.reason})`);
          state.messages.push({ role: 'user', content: `DENIED: ${step.tool} is not permitted (${guard.reason}). Choose another approach.` });
          continue;
        }
        if (guard.decision === 'needs_approval') {
          await this.pauseForToolApproval(s, actor, step, args, guard.risk, state);
          return;
        }

        // --- execution ---
        const result = await this.executeGuarded(step.tool, args, ctx, {});
        if (result.artifact) state.artifacts.push(result.artifact);

        if (result.pauseForApproval) {
          const approval = await this.createApproval(s, { title: result.pauseForApproval.title, description: result.pauseForApproval.body, approval_type: 'custom', risk: 'low', payload: {} });
          state.voluntaryApprovalId = approval.id;
          await this.enterWaitingApproval(s, state, `Waiting for manager approval: ${result.pauseForApproval.title}`);
          return;
        }
        if (result.finish) {
          await this.completeSession(s, actor, task, result.finish, state);
          return;
        }
        state.messages.push({ role: 'user', content: `RESULT of ${step.tool}:\n${result.output}` });
      }
    } catch (err) {
      await this.failSession(s, err);
    } finally {
      if (computer) {
        await this.d.computer.terminateSession(computer).catch(() => undefined);
        const billing = await this.d.entitlements.getBillingState(s.organization_id).catch(() => null);
        if (billing) await this.d.entitlements.addComputerSeconds(s.organization_id, billing, (Date.now() - started) / 1000).catch(() => undefined);
      }
    }
  }

  private async callModel(s: WorkSessionRow, system: string, messages: ChatMessage[]): Promise<{ data: AgentStep; usage: AIUsage }> {
    let attempt = 0;
    for (;;) {
      try {
        return await this.d.ai.generateStructured({ system, messages, schema: agentStepSchema, schemaName: 'agent_step', model: s.model, maxTokens: AI_SAFETY_LIMITS.maxOutputTokensPerStep * 4 });
      } catch (err) {
        const retryable = err instanceof AIProviderError && (err.retryable || err.code === 'invalid_output');
        if (!retryable || attempt >= AI_SAFETY_LIMITS.maxRetries) throw err;
        attempt++;
        await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
      }
    }
  }

  private async recordUsage(s: WorkSessionRow, usage: AIUsage, stepCount: number) {
    const { data } = await this.d.db.from('ai_work_sessions').select('input_tokens, output_tokens, estimated_cost_usd').eq('id', s.id).single<{ input_tokens: number; output_tokens: number; estimated_cost_usd: number }>();
    await this.updateSession(s.id, {
      step_count: stepCount,
      input_tokens: Number(data?.input_tokens ?? 0) + usage.inputTokens,
      output_tokens: Number(data?.output_tokens ?? 0) + usage.outputTokens,
      estimated_cost_usd: Number(data?.estimated_cost_usd ?? 0) + usage.estimatedCostUsd,
    });
    await this.d.db.from('ai_usage_events').insert({
      organization_id: s.organization_id,
      ai_employee_id: s.ai_employee_id,
      session_id: s.id,
      source: 'work_session',
      provider: usage.provider,
      model: usage.model,
      input_tokens: usage.inputTokens,
      output_tokens: usage.outputTokens,
      estimated_cost_usd: usage.estimatedCostUsd,
    });
  }

  private async recordToolExecution(
    s: WorkSessionRow,
    tool: string,
    input: Record<string, unknown>,
    status: 'denied' | 'pending_approval' | 'running' | 'succeeded' | 'failed',
    risk: string,
    extra: Record<string, unknown> = {},
  ): Promise<string> {
    const { data } = await this.d.db
      .from('ai_tool_executions')
      .insert({ organization_id: s.organization_id, session_id: s.id, ai_employee_id: s.ai_employee_id, tool, input: redactForLog(input), status, risk, ...extra })
      .select('id')
      .single<{ id: string }>();
    return data?.id ?? '';
  }

  private async executeGuarded(tool: AgentTool, args: Record<string, unknown>, ctx: ToolContext, opts: { preApproved?: boolean; executionId?: string }): Promise<ToolResult> {
    const s = ctx.session;
    const guard = evaluateToolCall(ctx.ai, tool, this.d.computer.capabilities, { preApproved: opts.preApproved ?? false });
    if (guard.decision !== 'allow') throw forbidden(`tool_not_allowed:${tool}`);
    const execId = opts.executionId ?? (await this.recordToolExecution(s, tool, args, 'running', guard.risk));
    if (opts.executionId) await this.d.db.from('ai_tool_executions').update({ status: 'running' }).eq('id', execId);
    const t0 = Date.now();
    try {
      const result = await this.tools.run(tool, args as never, ctx);
      await this.d.db
        .from('ai_tool_executions')
        .update({ status: 'succeeded', output_summary: result.output.slice(0, 500), duration_ms: Date.now() - t0, completed_at: new Date().toISOString() })
        .eq('id', execId);
      if (result.artifact) {
        await this.event(s, 'artifact', `${result.artifact.kind === 'document' ? 'Document' : result.artifact.kind === 'file' ? 'File' : 'Item'} created: ${result.artifact.title}`, { ...result.artifact });
      }
      return result;
    } catch (err) {
      const message = err instanceof ComputerCapabilityError ? `capability_not_available:${err.capability}` : err instanceof AppError ? err.code : 'tool_failed';
      await this.d.db.from('ai_tool_executions').update({ status: 'failed', error: message, duration_ms: Date.now() - t0, completed_at: new Date().toISOString() }).eq('id', execId);
      await this.event(s, 'tool_failed', `${tool} failed: ${message}`);
      return { output: `ERROR: ${tool} failed (${message}).` };
    }
  }

  private async createApproval(s: WorkSessionRow, a: { title: string; description: string; approval_type: string; risk: string; payload: Record<string, unknown>; entity_type?: string; entity_id?: string }): Promise<ApprovalRow> {
    const { data, error } = await this.d.db
      .from('approvals')
      .insert({
        organization_id: s.organization_id,
        title: a.title.slice(0, 300),
        description: a.description.slice(0, 4000),
        approval_type: a.approval_type,
        requested_by_ai_employee_id: s.ai_employee_id,
        session_id: s.id,
        task_id: s.task_id,
        entity_type: a.entity_type ?? null,
        entity_id: a.entity_id ?? null,
        payload: a.payload,
        risk: a.risk,
      })
      .select('*')
      .single<ApprovalRow>();
    if (error || !data) throw new AppError(500, 'approval_create_failed', error?.message);
    await this.d.notifications.notifyRoles(s.organization_id, ['owner', 'admin', 'manager'], {
      type: 'approval_requested',
      title: a.title,
      body: a.description.slice(0, 300),
      link: `/app/approvals?id=${data.id}`,
      data: { approval_id: data.id, session_id: s.id },
    });
    return data;
  }

  private async pauseForToolApproval(s: WorkSessionRow, ai: AiActor, step: AgentStep, args: Record<string, unknown>, risk: string, state: ResumeState) {
    const approval = await this.createApproval(s, {
      title: `${ai.name}: ${step.tool}`,
      description: step.progress_note,
      approval_type: step.tool === 'publish_file_to_shared' ? 'file_publish' : 'ai_tool_action',
      risk,
      payload: { tool: step.tool, args: redactForLog(args) },
    });
    const executionId = await this.recordToolExecution(s, step.tool, args, 'pending_approval', risk, { approval_id: approval.id });
    state.pending = { tool: step.tool, args, executionId, approvalId: approval.id };
    await this.enterWaitingApproval(s, state, `Waiting for manager approval (${step.tool})`);
  }

  private async enterWaitingApproval(s: WorkSessionRow, state: ResumeState, note: string) {
    await this.updateSession(s.id, { status: 'waiting_approval', resume_state: state, current_step: note, locked_by: null });
    await this.event(s, 'waiting_approval', note);
    await this.setEmployeeStatus(s.organization_id, s.ai_employee_id, 'waiting_approval');
  }

  private async completeSession(s: WorkSessionRow, ai: AiActor, task: TaskRow | null, finish: NonNullable<ToolResult['finish']>, state: ResumeState) {
    const docIds = state.artifacts.filter((a) => a.kind === 'document').map((a) => a.id);
    const needsApproval = Boolean(task?.requires_approval) || !autonomyAtLeast(ai.autonomy, 'execute_internal');

    const { data: output } = await this.d.db
      .from('ai_outputs')
      .insert({
        organization_id: s.organization_id,
        session_id: s.id,
        ai_employee_id: s.ai_employee_id,
        task_id: task?.id ?? null,
        title: finish.title ?? task?.title ?? 'Work summary',
        output_type: docIds.length ? 'document' : 'summary',
        content: finish.content ? `${finish.summary}\n\n---\n\n${finish.content}` : finish.summary,
        document_id: docIds[0] ?? null,
        status: needsApproval ? 'pending_approval' : 'approved',
      })
      .select('id')
      .single<{ id: string }>();

    if (task) {
      await this.d.db.from('task_comments').insert({ organization_id: s.organization_id, task_id: task.id, author_ai_employee_id: s.ai_employee_id, body: finish.summary.slice(0, 10000) });
    }

    if (needsApproval) {
      await this.createApproval(s, {
        title: `${ai.name}: ${finish.title ?? task?.title ?? 'Output review'}`,
        description: finish.summary,
        approval_type: 'ai_output',
        risk: 'medium',
        payload: { document_ids: docIds },
        entity_type: 'ai_output',
        ...(output ? { entity_id: output.id } : {}),
      });
      if (task) await this.d.db.from('tasks').update({ status: 'review' }).eq('id', task.id);
    } else {
      if (docIds.length) await this.d.db.from('documents').update({ status: 'published' }).in('id', docIds);
      if (task) await this.d.db.from('tasks').update({ status: 'done', completed_at: new Date().toISOString() }).eq('id', task.id);
    }

    await this.updateSession(s.id, {
      status: 'completed',
      completed_at: new Date().toISOString(),
      current_step: needsApproval ? 'Completed — waiting for manager approval' : 'Completed',
      outputs: state.artifacts,
      resume_state: null,
      locked_by: null,
    });
    await this.event(s, 'completed', needsApproval ? 'Work completed — waiting for manager approval' : 'Work completed');
    await this.refreshEmployeeStatus(s.organization_id, s.ai_employee_id);

    const recipients = [s.requested_by_user_id].filter((v): v is string => Boolean(v));
    await this.d.notifications.notify({
      organizationId: s.organization_id,
      userIds: recipients,
      type: 'ai_completed',
      title: `${ai.name} completed: ${task?.title ?? 'work session'}`,
      body: finish.summary.slice(0, 300),
      link: `/app/workforce/${s.ai_employee_id}?session=${s.id}`,
    });
    await this.d.audit.activity({ organizationId: s.organization_id, actorAiEmployeeId: s.ai_employee_id, verb: 'completed', entityType: 'task', entityId: task?.id ?? null, summary: `${ai.name} completed ${task?.title ?? 'a work session'}` });
  }

  private async failSession(s: WorkSessionRow, err: unknown) {
    const code = err instanceof AppError ? err.code : err instanceof AIProviderError ? `ai_${err.code}` : 'internal_error';
    this.d.log.warn({ sessionId: s.id, code, err: err instanceof Error ? err.message : err }, 'agent session failed');
    await this.updateSession(s.id, { status: 'failed', error: code, completed_at: new Date().toISOString(), current_step: 'Failed', locked_by: null });
    await this.event(s, 'failed', `Failed: ${code}`);
    await this.refreshEmployeeStatus(s.organization_id, s.ai_employee_id, 'failed');
    if (s.task_id) await this.d.db.from('tasks').update({ status: 'blocked' }).eq('id', s.task_id);
    const recipients = [s.requested_by_user_id].filter((v): v is string => Boolean(v));
    await this.d.notifications.notify({ organizationId: s.organization_id, userIds: recipients, type: 'ai_failed', title: 'AI work session failed', body: code, link: `/app/operations?session=${s.id}` });
    if (recipients.length === 0) {
      await this.d.notifications.notifyRoles(s.organization_id, ['owner', 'admin'], { type: 'ai_failed', title: 'AI work session failed', body: code, link: `/app/operations?session=${s.id}` });
    }
  }

  /** Assign a task to an AI employee on behalf of a human (entry point used by routes & Nexus AI). */
  async assignTask(actor: OrgActor, aiEmployeeId: string, taskId: string): Promise<WorkSessionRow> {
    if (!actor.permissions.has('ai.assign')) throw forbidden();
    if (!aiEmployeeId || !taskId) throw badRequest('missing_ids');
    const session = await this.enqueue({ orgId: actor.orgId, aiEmployeeId, taskId, billing: actor.billing, requestedByUserId: actor.userId });
    await this.d.audit.audit({ organizationId: actor.orgId, actorType: 'human', actorUserId: actor.userId, action: 'ai.task_assigned', targetType: 'task', targetId: taskId, metadata: { ai_employee_id: aiEmployeeId, session_id: session.id } });
    return session;
  }
}
