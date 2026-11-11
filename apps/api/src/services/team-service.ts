import { z } from 'zod';
import type { OrgActor } from '../context.js';
import type { Db } from '../lib/supabase.js';
import type { AIProvider } from './ai/provider.js';
import type { EntitlementService } from './entitlements.js';

/** A member counts as "online" if they used NEXUS within this window. */
export const ONLINE_WINDOW_MS = 5 * 60_000;
const DONE_WINDOW_DAYS = 30;
const OPEN_STATUSES = ['backlog', 'todo', 'in_progress', 'review', 'blocked'] as const;
const IDLE_AI_STATUSES = new Set(['offline', 'idle', 'completed', 'failed']);

interface TaskRow {
  id: string;
  title: string;
  status: (typeof OPEN_STATUSES)[number] | 'done';
  due_date: string | null;
  updated_at: string;
  completed_at: string | null;
  assignee_member_id: string | null;
  assignee_ai_employee_id: string | null;
}

export interface WorkStats {
  open: number;
  in_progress: number;
  review: number;
  blocked: number;
  overdue: number;
  done_7d: number;
  done_30d: number;
  /** Share of the last 30 days' work that is done: done_30d / (done_30d + open). null when there is no work. */
  progress_pct: number | null;
  current: Array<{ id: string; title: string; status: string; due_date: string | null }>;
  last_task_activity_at: string | null;
}

function statsFor(tasks: TaskRow[], now: number): WorkStats {
  const open = tasks.filter((t) => t.status !== 'done');
  const done = tasks.filter((t) => t.status === 'done');
  const done7 = done.filter((t) => t.completed_at && now - Date.parse(t.completed_at) <= 7 * 86400_000).length;
  const total = done.length + open.length;
  const lastActivity = tasks.reduce<string | null>((a, t) => (!a || t.updated_at > a ? t.updated_at : a), null);
  const rank: Record<string, number> = { in_progress: 0, review: 1, blocked: 2, todo: 3, backlog: 4 };
  return {
    open: open.length,
    in_progress: open.filter((t) => t.status === 'in_progress').length,
    review: open.filter((t) => t.status === 'review').length,
    blocked: open.filter((t) => t.status === 'blocked').length,
    overdue: open.filter((t) => t.due_date && Date.parse(t.due_date) < now).length,
    done_7d: done7,
    done_30d: done.length,
    progress_pct: total ? Math.round((done.length / total) * 100) : null,
    current: [...open]
      .sort((a, b) => (rank[a.status] ?? 9) - (rank[b.status] ?? 9) || (a.due_date ?? '9').localeCompare(b.due_date ?? '9'))
      .slice(0, 3)
      .map((t) => ({ id: t.id, title: t.title, status: t.status, due_date: t.due_date })),
    last_task_activity_at: lastActivity,
  };
}

const reportSchema = z.object({ report: z.string() });

/** Manager view of the whole team — people and AI employees — and how far along their work is. */
export class TeamService {
  constructor(
    private readonly db: Db,
    private readonly ai: AIProvider,
    private readonly entitlements: EntitlementService,
  ) {}

  async overview(orgId: string) {
    const now = Date.now();
    const since = new Date(now - DONE_WINDOW_DAYS * 86400_000).toISOString();
    const [members, aiEmployees, openTasks, doneTasks, sessions] = await Promise.all([
      this.db.from('organization_members').select('id, user_id, role, last_seen_at').eq('organization_id', orgId).eq('status', 'active'),
      this.db.from('ai_employees').select('id, name, job_title, status').eq('organization_id', orgId).is('deleted_at', null),
      this.db.from('tasks').select('id, title, status, due_date, updated_at, completed_at, assignee_member_id, assignee_ai_employee_id').eq('organization_id', orgId).is('deleted_at', null).in('status', [...OPEN_STATUSES]).limit(3000),
      this.db.from('tasks').select('id, title, status, due_date, updated_at, completed_at, assignee_member_id, assignee_ai_employee_id').eq('organization_id', orgId).is('deleted_at', null).eq('status', 'done').gte('completed_at', since).limit(5000),
      this.db.from('ai_work_sessions').select('ai_employee_id, status, current_step, tasks(title)').eq('organization_id', orgId).in('status', ['queued', 'preparing', 'running', 'paused', 'waiting_approval']),
    ]);
    const memberRows = (members.data ?? []) as Array<{ id: string; user_id: string; role: string; last_seen_at: string | null }>;
    const { data: profiles } = memberRows.length
      ? await this.db.from('profiles').select('id, full_name, email').in('id', memberRows.map((m) => m.user_id))
      : { data: [] };
    const nameOf = new Map(((profiles ?? []) as Array<{ id: string; full_name: string; email: string | null }>).map((p) => [p.id, p.full_name || p.email || '—']));
    const tasks = [...((openTasks.data ?? []) as TaskRow[]), ...((doneTasks.data ?? []) as TaskRow[])];
    const byMember = new Map<string, TaskRow[]>();
    const byAi = new Map<string, TaskRow[]>();
    for (const t of tasks) {
      if (t.assignee_member_id) byMember.set(t.assignee_member_id, [...(byMember.get(t.assignee_member_id) ?? []), t]);
      if (t.assignee_ai_employee_id) byAi.set(t.assignee_ai_employee_id, [...(byAi.get(t.assignee_ai_employee_id) ?? []), t]);
    }
    const sessionOf = new Map(((sessions.data ?? []) as unknown as Array<{ ai_employee_id: string; status: string; current_step: string | null; tasks: { title: string } | null }>).map((s) => [s.ai_employee_id, s]));

    const humans = memberRows.map((m) => {
      const work = statsFor(byMember.get(m.id) ?? [], now);
      return {
        member_id: m.id,
        user_id: m.user_id,
        name: nameOf.get(m.user_id) ?? '—',
        role: m.role,
        online: Boolean(m.last_seen_at && now - Date.parse(m.last_seen_at) <= ONLINE_WINDOW_MS),
        last_seen_at: m.last_seen_at,
        work,
      };
    });
    const ai = ((aiEmployees.data ?? []) as Array<{ id: string; name: string; job_title: string; status: string }>).map((e) => {
      const session = sessionOf.get(e.id);
      return {
        ai_employee_id: e.id,
        name: e.name,
        job_title: e.job_title,
        status: e.status,
        working: !IDLE_AI_STATUSES.has(e.status) || Boolean(session && ['preparing', 'running'].includes(session.status)),
        current_step: session?.current_step ?? null,
        current_task: session?.tasks?.title ?? null,
        work: statsFor(byAi.get(e.id) ?? [], now),
      };
    });
    const all = [...humans.map((h) => h.work), ...ai.map((a) => a.work)];
    return {
      generated_at: new Date(now).toISOString(),
      summary: {
        humans_total: humans.length,
        humans_online: humans.filter((h) => h.online).length,
        ai_total: ai.length,
        ai_working: ai.filter((a) => a.working).length,
        in_progress: all.reduce((n, w) => n + w.in_progress, 0),
        overdue: all.reduce((n, w) => n + w.overdue, 0),
        blocked: all.reduce((n, w) => n + w.blocked, 0),
        done_7d: all.reduce((n, w) => n + w.done_7d, 0),
      },
      humans,
      ai,
    };
  }

  /** NEXUS AI reads the team overview and writes a short status report for the manager. */
  async aiReport(actor: OrgActor, language: 'ar' | 'en') {
    const overview = await this.overview(actor.orgId);
    const compact = {
      summary: overview.summary,
      people: [...overview.humans.map((h) => ({ kind: 'human', name: h.name, online: h.online, ...h.work })), ...overview.ai.map((a) => ({ kind: 'ai', name: a.name, working: a.working, current_task: a.current_task, ...a.work }))],
    };
    const { model } = await this.entitlements.aiGate(actor.orgId);
    const { data, usage } = await this.ai.generateStructured({
      model,
      schema: reportSchema,
      schemaName: 'team_report',
      system: `You are NEXUS AI writing a short team status report for a manager of a Saudi company. Cover: overall progress, who is ahead, who is behind or blocked, overdue work, and 3 concrete next steps. Use only the data given; never invent facts. Markdown, concise. Write in ${language === 'ar' ? 'Arabic' : 'English'}.`,
      messages: [{ role: 'user', content: JSON.stringify(compact).slice(0, 60_000) }],
    });
    await this.db.from('ai_usage_events').insert({ organization_id: actor.orgId, user_id: actor.userId, source: 'nexus_ai', provider: usage.provider, model: usage.model, input_tokens: usage.inputTokens, output_tokens: usage.outputTokens, estimated_cost_usd: usage.estimatedCostUsd });
    return { report: data.report, generated_at: new Date().toISOString() };
  }
}
