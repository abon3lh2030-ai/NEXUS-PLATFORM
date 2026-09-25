import type { OrgActor } from '../context.js';
import type { Db } from '../lib/supabase.js';

export interface HealthReport {
  score: number;
  grade: 'excellent' | 'good' | 'fair' | 'poor';
  reasons: Array<{ key: string; impact: number; detail: Record<string, number> }>;
}

const escLike = (q: string) => q.replace(/[%_\\,()]/g, (m) => `\\${m}`);

/**
 * Pure health scoring (unit tested). Starts at 100 and subtracts explained penalties.
 */
export function computeHealthScore(m: {
  openTasks: number;
  overdueTasks: number;
  blockedTasks: number;
  activeMissions: number;
  missionsBehind: number;
  sessionsLast7d: number;
  failedSessionsLast7d: number;
  pendingApprovals: number;
  staleApprovals: number;
  overloadedEmployees: number;
}): HealthReport {
  const reasons: HealthReport['reasons'] = [];
  const penalize = (key: string, impact: number, detail: Record<string, number>) => {
    const v = Math.round(Math.min(impact, 100));
    if (v > 0) reasons.push({ key, impact: v, detail });
  };
  if (m.openTasks > 0) {
    penalize('overdue_work', (m.overdueTasks / m.openTasks) * 30, { overdue: m.overdueTasks, open: m.openTasks });
    penalize('blocked_work', (m.blockedTasks / m.openTasks) * 20, { blocked: m.blockedTasks, open: m.openTasks });
  }
  if (m.activeMissions > 0) penalize('mission_progress', (m.missionsBehind / m.activeMissions) * 20, { behind: m.missionsBehind, active: m.activeMissions });
  if (m.sessionsLast7d > 0) penalize('failed_executions', (m.failedSessionsLast7d / m.sessionsLast7d) * 15, { failed: m.failedSessionsLast7d, total: m.sessionsLast7d });
  penalize('pending_approvals', Math.min(m.staleApprovals * 3, 10), { pending: m.pendingApprovals, older_than_48h: m.staleApprovals });
  penalize('workload', Math.min(m.overloadedEmployees * 2.5, 5), { overloaded_ai_employees: m.overloadedEmployees });
  const score = Math.max(0, 100 - reasons.reduce((a, r) => a + r.impact, 0));
  const grade = score >= 85 ? 'excellent' : score >= 70 ? 'good' : score >= 50 ? 'fair' : 'poor';
  return { score, grade, reasons: reasons.sort((a, b) => b.impact - a.impact) };
}

export class InsightsService {
  constructor(private readonly db: Db) {}

  async health(orgId: string): Promise<HealthReport> {
    const now = new Date();
    const nowIso = now.toISOString();
    const weekAgo = new Date(now.getTime() - 7 * 86400_000).toISOString();
    const twoDaysAgo = new Date(now.getTime() - 2 * 86400_000).toISOString();
    const today = nowIso.slice(0, 10);
    const count = async (q: PromiseLike<{ count: number | null }>) => (await q).count ?? 0;
    const tasks = () => this.db.from('tasks').select('id', { count: 'exact', head: true }).eq('organization_id', orgId).is('deleted_at', null);

    const [openTasks, overdueTasks, blockedTasks, activeMissions, missionsBehind, sessions, failed, pending, stale, queued] = await Promise.all([
      count(tasks().neq('status', 'done')),
      count(tasks().neq('status', 'done').lt('due_date', nowIso)),
      count(tasks().eq('status', 'blocked')),
      count(this.db.from('missions').select('id', { count: 'exact', head: true }).eq('organization_id', orgId).is('deleted_at', null).in('status', ['planned', 'active', 'blocked'])),
      count(this.db.from('missions').select('id', { count: 'exact', head: true }).eq('organization_id', orgId).is('deleted_at', null).in('status', ['planned', 'active', 'blocked']).lt('due_date', today)),
      count(this.db.from('ai_work_sessions').select('id', { count: 'exact', head: true }).eq('organization_id', orgId).gte('created_at', weekAgo)),
      count(this.db.from('ai_work_sessions').select('id', { count: 'exact', head: true }).eq('organization_id', orgId).eq('status', 'failed').gte('created_at', weekAgo)),
      count(this.db.from('approvals').select('id', { count: 'exact', head: true }).eq('organization_id', orgId).eq('status', 'pending')),
      count(this.db.from('approvals').select('id', { count: 'exact', head: true }).eq('organization_id', orgId).eq('status', 'pending').lt('created_at', twoDaysAgo)),
      this.db.from('ai_work_sessions').select('ai_employee_id').eq('organization_id', orgId).eq('status', 'queued'),
    ]);
    const perEmployee = new Map<string, number>();
    for (const r of (queued.data ?? []) as Array<{ ai_employee_id: string }>) perEmployee.set(r.ai_employee_id, (perEmployee.get(r.ai_employee_id) ?? 0) + 1);
    const overloadedEmployees = [...perEmployee.values()].filter((n) => n > 5).length;
    return computeHealthScore({ openTasks, overdueTasks, blockedTasks, activeMissions, missionsBehind, sessionsLast7d: sessions, failedSessionsLast7d: failed, pendingApprovals: pending, staleApprovals: stale, overloadedEmployees });
  }

  async companySnapshot(orgId: string) {
    const [departments, humans, aiEmployees, activeProjects, openTasks, pendingApprovals, runningSessions] = await Promise.all([
      this.db.from('departments').select('id', { count: 'exact', head: true }).eq('organization_id', orgId).is('deleted_at', null).then((r) => r.count ?? 0),
      this.db.from('organization_members').select('id', { count: 'exact', head: true }).eq('organization_id', orgId).eq('status', 'active').then((r) => r.count ?? 0),
      this.db.from('ai_employees').select('id', { count: 'exact', head: true }).eq('organization_id', orgId).is('deleted_at', null).then((r) => r.count ?? 0),
      this.db.from('projects').select('id', { count: 'exact', head: true }).eq('organization_id', orgId).is('deleted_at', null).in('status', ['planned', 'active', 'on_hold', 'blocked']).then((r) => r.count ?? 0),
      this.db.from('tasks').select('id', { count: 'exact', head: true }).eq('organization_id', orgId).is('deleted_at', null).neq('status', 'done').then((r) => r.count ?? 0),
      this.db.from('approvals').select('id', { count: 'exact', head: true }).eq('organization_id', orgId).eq('status', 'pending').then((r) => r.count ?? 0),
      this.db.from('ai_work_sessions').select('id', { count: 'exact', head: true }).eq('organization_id', orgId).in('status', ['preparing', 'running']).then((r) => r.count ?? 0),
    ]);
    return { departments, humans, ai_employees: aiEmployees, active_projects: activeProjects, open_tasks: openTasks, pending_approvals: pendingApprovals, running_ai_sessions: runningSessions };
  }

  async analytics(orgId: string, days = 30) {
    const since = new Date(Date.now() - days * 86400_000).toISOString();
    const [tasks, missions, projects, sessions, usage, approvals, documents, storage, members, ais, activity] = await Promise.all([
      this.db.from('tasks').select('status, assignee_ai_employee_id, assignee_member_id, completed_at, created_at').eq('organization_id', orgId).is('deleted_at', null),
      this.db.from('missions').select('id, title, progress, status, due_date').eq('organization_id', orgId).is('deleted_at', null),
      this.db.from('projects').select('id, title, progress, status, due_date, department_id').eq('organization_id', orgId).is('deleted_at', null),
      this.db.from('ai_work_sessions').select('ai_employee_id, status, started_at, completed_at, estimated_cost_usd, input_tokens, output_tokens').eq('organization_id', orgId).gte('created_at', since),
      this.db.from('ai_usage_events').select('created_at, estimated_cost_usd, input_tokens, output_tokens, source').eq('organization_id', orgId).gte('created_at', since),
      this.db.from('approvals').select('status, created_at, decided_at').eq('organization_id', orgId).gte('created_at', since),
      this.db.from('documents').select('id, created_at, created_by_ai_employee_id').eq('organization_id', orgId).is('deleted_at', null).gte('created_at', since),
      this.db.rpc('organization_storage_usage', { p_org: orgId }),
      this.db.from('organization_members').select('id, department_id').eq('organization_id', orgId).eq('status', 'active'),
      this.db.from('ai_employees').select('id, name, department_id, status').eq('organization_id', orgId).is('deleted_at', null),
      this.db.from('activity_events').select('created_at').eq('organization_id', orgId).gte('created_at', since),
    ]);

    type T = { status: string; assignee_ai_employee_id: string | null; assignee_member_id: string | null; completed_at: string | null; created_at: string };
    const taskRows = (tasks.data ?? []) as T[];
    const sessionRows = (sessions.data ?? []) as Array<{ ai_employee_id: string; status: string; started_at: string | null; completed_at: string | null; estimated_cost_usd: number }>;
    const usageRows = (usage.data ?? []) as Array<{ created_at: string; estimated_cost_usd: number; input_tokens: number; output_tokens: number; source: string }>;
    const approvalRows = (approvals.data ?? []) as Array<{ status: string; created_at: string; decided_at: string | null }>;
    const aiRows = (ais.data ?? []) as Array<{ id: string; name: string; department_id: string | null; status: string }>;

    const byDay = (rows: Array<{ created_at: string }>, value: (r: never) => number = () => 1) => {
      const map = new Map<string, number>();
      for (const r of rows) map.set(r.created_at.slice(0, 10), (map.get(r.created_at.slice(0, 10)) ?? 0) + value(r as never));
      return [...map.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, v]) => ({ date, value: Math.round(v * 10000) / 10000 }));
    };

    const productivity = aiRows.map((a) => {
      const s = sessionRows.filter((r) => r.ai_employee_id === a.id);
      const done = s.filter((r) => r.status === 'completed');
      const durations = done.filter((r) => r.started_at && r.completed_at).map((r) => new Date(r.completed_at!).getTime() - new Date(r.started_at!).getTime());
      return {
        id: a.id,
        name: a.name,
        completed: done.length,
        failed: s.filter((r) => r.status === 'failed').length,
        avg_minutes: durations.length ? Math.round(durations.reduce((x, y) => x + y, 0) / durations.length / 60000) : null,
        cost_usd: Math.round(s.reduce((x, r) => x + Number(r.estimated_cost_usd), 0) * 100) / 100,
      };
    });
    const decided = approvalRows.filter((a) => a.decided_at);
    const storageRow = ((storage.data ?? []) as Array<{ used_bytes: number; file_count: number }>)[0];

    return {
      range_days: days,
      task_status: taskRows.reduce<Record<string, number>>((acc, t) => ({ ...acc, [t.status]: (acc[t.status] ?? 0) + 1 }), {}),
      tasks_completed_by_day: byDay(taskRows.filter((t) => t.completed_at && t.completed_at >= since).map((t) => ({ created_at: t.completed_at! }))),
      human_ai_distribution: {
        ai: taskRows.filter((t) => t.assignee_ai_employee_id).length,
        human: taskRows.filter((t) => t.assignee_member_id).length,
        unassigned: taskRows.filter((t) => !t.assignee_ai_employee_id && !t.assignee_member_id).length,
      },
      missions: missions.data ?? [],
      projects: projects.data ?? [],
      ai_productivity: productivity,
      ai_cost_by_day: byDay(usageRows, (r: { estimated_cost_usd: number }) => Number(r.estimated_cost_usd)),
      ai_tokens: usageRows.reduce((a, r) => a + r.input_tokens + r.output_tokens, 0),
      ai_cost_usd: Math.round(usageRows.reduce((a, r) => a + Number(r.estimated_cost_usd), 0) * 100) / 100,
      approval_turnaround_hours: decided.length
        ? Math.round((decided.reduce((a, r) => a + (new Date(r.decided_at!).getTime() - new Date(r.created_at).getTime()), 0) / decided.length / 3600000) * 10) / 10
        : null,
      approvals_pending: approvalRows.filter((a) => a.status === 'pending').length,
      documents_created: (documents.data ?? []).length,
      documents_by_ai: ((documents.data ?? []) as Array<{ created_by_ai_employee_id: string | null }>).filter((d) => d.created_by_ai_employee_id).length,
      storage: { used_bytes: Number(storageRow?.used_bytes ?? 0), file_count: Number(storageRow?.file_count ?? 0) },
      headcount: { humans: (members.data ?? []).length, ai: aiRows.length },
      activity_by_day: byDay((activity.data ?? []) as Array<{ created_at: string }>),
    };
  }

  /** Global search. Private files appear only for their owner (RLS-equivalent filter applied explicitly). */
  async search(actor: OrgActor, q: string) {
    const org = actor.orgId;
    const like = `%${escLike(q)}%`;
    const pick = <T>(p: PromiseLike<{ data: T[] | null }>) => p.then((r) => r.data ?? []);
    const [goals, missions, projects, tasks, ais, departments, documents, decisions, memories, sharedFiles, privateFiles, members] = await Promise.all([
      pick(this.db.from('goals').select('id, title').eq('organization_id', org).is('deleted_at', null).ilike('title', like).limit(5)),
      pick(this.db.from('missions').select('id, title').eq('organization_id', org).is('deleted_at', null).ilike('title', like).limit(5)),
      pick(this.db.from('projects').select('id, title').eq('organization_id', org).is('deleted_at', null).ilike('title', like).limit(5)),
      pick(this.db.from('tasks').select('id, title, status').eq('organization_id', org).is('deleted_at', null).ilike('title', like).limit(8)),
      pick(this.db.from('ai_employees').select('id, name, job_title').eq('organization_id', org).is('deleted_at', null).or(`name.ilike.${like},job_title.ilike.${like}`).limit(5)),
      pick(this.db.from('departments').select('id, name').eq('organization_id', org).is('deleted_at', null).ilike('name', like).limit(5)),
      pick(this.db.from('documents').select('id, title, doc_type').eq('organization_id', org).is('deleted_at', null).eq('status', 'published').or(`title.ilike.${like},content.ilike.${like}`).limit(8)),
      actor.billing.entitlements.features.includes('decisions') ? pick(this.db.from('decisions').select('id, title').eq('organization_id', org).is('deleted_at', null).ilike('title', like).limit(5)) : Promise.resolve([]),
      pick(this.db.from('memories').select('id, title, memory_type').eq('organization_id', org).is('archived_at', null).or(`title.ilike.${like},content.ilike.${like}`).limit(5)),
      actor.permissions.has('files.shared.view')
        ? pick(this.db.from('company_files').select('id, original_name, category, folder_id').eq('organization_id', org).eq('space', 'shared').eq('visibility', 'organization_shared').eq('status', 'ready').is('deleted_at', null).ilike('original_name', like).limit(8))
        : Promise.resolve([]),
      // Private files: ONLY the caller's own.
      pick(this.db.from('company_files').select('id, original_name, category, folder_id').eq('organization_id', org).eq('space', 'private').eq('owner_user_id', actor.userId).eq('status', 'ready').is('deleted_at', null).ilike('original_name', like).limit(8)),
      this.searchMembers(org, like),
    ]);
    return { goals, missions, projects, tasks, ai_employees: ais, humans: members, departments, documents, decisions, memories, shared_files: sharedFiles, private_files: privateFiles };
  }

  private async searchMembers(orgId: string, like: string) {
    const { data: members } = await this.db.from('organization_members').select('id, user_id, job_title').eq('organization_id', orgId).eq('status', 'active');
    const rows = (members ?? []) as Array<{ id: string; user_id: string; job_title: string | null }>;
    if (!rows.length) return [];
    const { data: profiles } = await this.db.from('profiles').select('id, full_name').in('id', rows.map((r) => r.user_id)).ilike('full_name', like).limit(5);
    const ids = new Map(((profiles ?? []) as Array<{ id: string; full_name: string }>).map((p) => [p.id, p.full_name]));
    return rows.filter((r) => ids.has(r.user_id)).map((r) => ({ id: r.id, full_name: ids.get(r.user_id), job_title: r.job_title }));
  }
}
