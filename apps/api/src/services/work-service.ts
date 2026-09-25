import type { FeatureKey, Permission } from '@nexus/shared';
import type { OrgActor } from '../context.js';
import { AppError, badRequest, forbidden, notFound, unwrap } from '../lib/errors.js';
import type { Db } from '../lib/supabase.js';
import type { TaskRow } from '../types/db.js';
import type { AgentRuntime } from './agent/runtime.js';
import type { AuditService } from './audit.js';
import type { EntitlementService } from './entitlements.js';
import type { NotificationService } from './notifications.js';

export type EntityName = 'departments' | 'goals' | 'missions' | 'projects' | 'tasks' | 'meetings' | 'documents' | 'decisions' | 'memories';

interface EntityConfig {
  table: EntityName;
  view: Permission;
  create: Permission;
  manage: Permission;
  creatorColumn: string;
  feature?: FeatureKey;
  softDelete: 'deleted_at' | 'archived_at';
  /** Fields that are relations handled separately, not table columns. */
  virtual: string[];
  orderBy: string;
}

export const ENTITY_CONFIG: Record<EntityName, EntityConfig> = {
  departments: { table: 'departments', view: 'work.view', create: 'departments.manage', manage: 'departments.manage', creatorColumn: 'created_by', softDelete: 'deleted_at', virtual: [], orderBy: 'name' },
  goals: { table: 'goals', view: 'work.view', create: 'work.manage', manage: 'work.manage', creatorColumn: 'created_by', softDelete: 'deleted_at', virtual: [], orderBy: 'created_at' },
  missions: { table: 'missions', view: 'work.view', create: 'work.manage', manage: 'work.manage', creatorColumn: 'created_by', softDelete: 'deleted_at', virtual: ['department_ids', 'ai_employee_ids', 'member_ids'], orderBy: 'created_at' },
  projects: { table: 'projects', view: 'work.view', create: 'work.create', manage: 'work.manage', creatorColumn: 'created_by', softDelete: 'deleted_at', virtual: ['member_ids', 'ai_employee_ids'], orderBy: 'created_at' },
  tasks: { table: 'tasks', view: 'work.view', create: 'work.create', manage: 'work.manage', creatorColumn: 'creator_user_id', softDelete: 'deleted_at', virtual: ['depends_on'], orderBy: 'created_at' },
  meetings: { table: 'meetings', view: 'work.view', create: 'meetings.manage', manage: 'meetings.manage', creatorColumn: 'created_by', softDelete: 'deleted_at', virtual: ['participant_member_ids', 'participant_ai_employee_ids'], feature: 'meetings', orderBy: 'scheduled_at' },
  documents: { table: 'documents', view: 'work.view', create: 'documents.create', manage: 'documents.manage', creatorColumn: 'created_by_user_id', softDelete: 'deleted_at', virtual: ['change_summary'], orderBy: 'updated_at' },
  decisions: { table: 'decisions', view: 'work.view', create: 'decisions.manage', manage: 'decisions.manage', creatorColumn: 'decided_by_user_id', softDelete: 'deleted_at', virtual: [], feature: 'decisions', orderBy: 'created_at' },
  memories: { table: 'memories', view: 'work.view', create: 'memory.manage', manage: 'memory.manage', creatorColumn: 'created_by_user_id', softDelete: 'archived_at', virtual: [], feature: 'basic_memory', orderBy: 'updated_at' },
};

/** Columns referencing org-scoped rows → table. Every reference is verified to belong to the caller's organization. */
const REFERENCE_TABLES: Record<string, string> = {
  project_id: 'projects',
  mission_id: 'missions',
  goal_id: 'goals',
  department_id: 'departments',
  parent_task_id: 'tasks',
  parent_id: 'departments',
  assignee_member_id: 'organization_members',
  owner_member_id: 'organization_members',
  lead_member_id: 'organization_members',
  assignee_ai_employee_id: 'ai_employees',
  lead_ai_employee_id: 'ai_employees',
  ai_employee_id: 'ai_employees',
};

export class WorkService {
  constructor(
    private readonly db: Db,
    private readonly entitlements: EntitlementService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationService,
    private readonly agents: AgentRuntime,
  ) {}

  private assertAccess(actor: OrgActor, cfg: EntityConfig, perm: Permission) {
    if (!actor.permissions.has(perm)) throw forbidden(`missing_permission:${perm}`);
    if (cfg.feature) this.entitlements.assertFeature(actor.billing, cfg.feature);
  }

  async assertRefs(orgId: string, input: Record<string, unknown>, parentTable?: string): Promise<void> {
    const checks = Object.entries(input).filter(([k, v]) => typeof v === 'string' && v && k in REFERENCE_TABLES);
    await Promise.all(
      checks.map(async ([k, v]) => {
        const table = k === 'parent_id' && parentTable ? parentTable : REFERENCE_TABLES[k]!;
        const { data } = await this.db.from(table).select('id').eq('id', v as string).eq('organization_id', orgId).maybeSingle();
        if (!data) throw badRequest(`invalid_reference:${k}`);
      }),
    );
  }

  private async assertIdsInOrg(orgId: string, table: string, ids: string[]) {
    if (ids.length === 0) return;
    const { data } = await this.db.from(table).select('id').eq('organization_id', orgId).in('id', ids);
    if ((data ?? []).length !== new Set(ids).size) throw badRequest(`invalid_reference:${table}`);
  }

  private split(cfg: EntityConfig, input: Record<string, unknown>) {
    const columns: Record<string, unknown> = {};
    const virtual: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(input)) (cfg.virtual.includes(k) ? virtual : columns)[k] = v;
    return { columns, virtual };
  }

  async list(actor: OrgActor, entity: EntityName, filters: Record<string, string | undefined> = {}) {
    const cfg = ENTITY_CONFIG[entity];
    this.assertAccess(actor, cfg, cfg.view);
    let q = this.db.from(cfg.table).select('*').eq('organization_id', actor.orgId).is(cfg.softDelete, null);
    for (const key of ['project_id', 'mission_id', 'department_id', 'status', 'assignee_ai_employee_id', 'assignee_member_id', 'memory_type', 'doc_type', 'goal_id', 'parent_task_id', 'ai_employee_id']) {
      const v = filters[key];
      if (v) q = q.eq(key, v);
    }
    if (filters.q) q = q.ilike(entity === 'departments' ? 'name' : 'title', `%${filters.q.replace(/[%_\\]/g, (m) => `\\${m}`)}%`);
    if (entity === 'memories') q = q.order('pinned', { ascending: false });
    if (entity === 'documents') q = q.or(`status.eq.published,created_by_user_id.eq.${actor.userId}`);
    const { data, error } = await q.order(cfg.orderBy, { ascending: entity === 'departments' || entity === 'meetings' }).limit(500);
    if (error) throw new AppError(500, 'database_error', error.message);
    return data ?? [];
  }

  async get(actor: OrgActor, entity: EntityName, id: string) {
    const cfg = ENTITY_CONFIG[entity];
    this.assertAccess(actor, cfg, cfg.view);
    const { data } = await this.db.from(cfg.table).select('*').eq('id', id).eq('organization_id', actor.orgId).is(cfg.softDelete, null).maybeSingle<Record<string, unknown>>();
    if (!data) throw notFound(`${entity}_not_found`);
    const extra: Record<string, unknown> = {};
    if (entity === 'missions') {
      const [deps, emps, projects] = await Promise.all([
        this.db.from('mission_departments').select('department_id').eq('mission_id', id),
        this.db.from('mission_employees').select('member_id, ai_employee_id').eq('mission_id', id),
        this.db.from('projects').select('id, title, status, progress').eq('mission_id', id).is('deleted_at', null),
      ]);
      Object.assign(extra, { department_ids: (deps.data ?? []).map((d: { department_id: string }) => d.department_id), employees: emps.data ?? [], projects: projects.data ?? [] });
    }
    if (entity === 'projects') {
      const [members, tasks] = await Promise.all([
        this.db.from('project_members').select('member_id, ai_employee_id').eq('project_id', id),
        this.db.from('tasks').select('id, status').eq('project_id', id).is('deleted_at', null),
      ]);
      Object.assign(extra, { team: members.data ?? [], task_counts: this.countStatuses((tasks.data ?? []) as Array<{ status: string }>) });
    }
    if (entity === 'tasks') {
      const [deps, subtasks, comments, sessions] = await Promise.all([
        this.db.from('task_dependencies').select('depends_on_task_id').eq('task_id', id),
        this.db.from('tasks').select('id, title, status').eq('parent_task_id', id).is('deleted_at', null),
        this.db.from('task_comments').select('*').eq('task_id', id).is('deleted_at', null).order('created_at'),
        this.db.from('ai_work_sessions').select('id, status, current_step, ai_employee_id, created_at, completed_at').eq('task_id', id).order('created_at', { ascending: false }).limit(10),
      ]);
      const outputs = await this.db.from('ai_outputs').select('id, title, status, content, document_id, created_at').eq('task_id', id).order('created_at', { ascending: false });
      Object.assign(extra, {
        depends_on: (deps.data ?? []).map((d: { depends_on_task_id: string }) => d.depends_on_task_id),
        subtasks: subtasks.data ?? [],
        comments: comments.data ?? [],
        ai_sessions: sessions.data ?? [],
        ai_outputs: outputs.data ?? [],
      });
    }
    if (entity === 'documents') {
      const { data: versions } = await this.db.from('document_versions').select('id, version, title, change_summary, created_at, created_by_user_id, created_by_ai_employee_id').eq('document_id', id).order('version', { ascending: false });
      extra.versions = versions ?? [];
    }
    if (entity === 'meetings') {
      const { data: participants } = await this.db.from('meeting_participants').select('member_id, ai_employee_id').eq('meeting_id', id);
      extra.participants = participants ?? [];
    }
    return { ...data, ...extra };
  }

  private countStatuses(rows: Array<{ status: string }>) {
    return rows.reduce<Record<string, number>>((acc, r) => ({ ...acc, [r.status]: (acc[r.status] ?? 0) + 1 }), {});
  }

  async create(actor: OrgActor, entity: EntityName, input: Record<string, unknown>) {
    const cfg = ENTITY_CONFIG[entity];
    this.assertAccess(actor, cfg, cfg.create);
    if (entity === 'projects') await this.entitlements.assertWithinLimit(actor.orgId, actor.billing, 'active_projects');
    if (entity === 'memories' && ['decision', 'preference'].includes(String(input.memory_type)) && !actor.billing.entitlements.features.includes('full_memory')) {
      throw new AppError(402, 'feature_not_in_plan', 'feature_not_in_plan', { feature: 'full_memory' });
    }
    const { columns, virtual } = this.split(cfg, input);
    await this.assertRefs(actor.orgId, columns, entity === 'departments' ? 'departments' : undefined);
    if (entity === 'tasks' && columns.assignee_ai_employee_id && !actor.permissions.has('ai.assign')) throw forbidden('missing_permission:ai.assign');

    const aiAssignee = entity === 'tasks' ? (columns.assignee_ai_employee_id as string | null | undefined) : undefined;
    if (aiAssignee) columns.status = 'todo'; // becomes in_progress when the AI session is queued

    const row = unwrap(
      await this.db
        .from(cfg.table)
        .insert({ ...columns, organization_id: actor.orgId, [cfg.creatorColumn]: actor.userId })
        .select('*')
        .single<Record<string, unknown> & { id: string; title?: string; name?: string }>(),
    );
    await this.writeRelations(actor, entity, row.id, virtual, true);
    if (entity === 'documents') {
      await this.db.from('document_versions').insert({ document_id: row.id, organization_id: actor.orgId, version: 1, title: row.title, content: columns.content ?? '', change_summary: (virtual.change_summary as string | undefined) ?? 'Created', created_by_user_id: actor.userId });
    }
    await this.audit.activity({ organizationId: actor.orgId, actorUserId: actor.userId, verb: 'created', entityType: entity.replace(/s$/, ''), entityId: row.id, summary: String(row.title ?? row.name ?? entity) });

    if (entity === 'tasks') {
      if (columns.assignee_member_id) await this.notifyAssignee(actor, row as unknown as TaskRow);
      if (aiAssignee) {
        const session = await this.agents.assignTask(actor, aiAssignee, row.id);
        return { ...row, ai_session_id: session.id };
      }
    }
    return row;
  }

  async update(actor: OrgActor, entity: EntityName, id: string, input: Record<string, unknown>) {
    const cfg = ENTITY_CONFIG[entity];
    const existing = (await this.get(actor, entity, id)) as Record<string, unknown>;
    const isCreator = existing[cfg.creatorColumn] === actor.userId;
    const isAssignee = entity === 'tasks' && existing.assignee_member_id === actor.memberId;
    if (!actor.permissions.has(cfg.manage) && !((isCreator || isAssignee) && actor.permissions.has(cfg.create))) throw forbidden(`missing_permission:${cfg.manage}`);
    if (cfg.feature) this.entitlements.assertFeature(actor.billing, cfg.feature);

    const { columns, virtual } = this.split(cfg, input);
    await this.assertRefs(actor.orgId, columns, entity === 'departments' ? 'departments' : undefined);
    if (entity === 'tasks' && columns.parent_task_id === id) throw badRequest('task_cannot_be_own_parent');
    if (entity === 'tasks' && columns.status === 'done' && existing.status !== 'done') columns.completed_at = new Date().toISOString();

    const newAi = entity === 'tasks' ? (columns.assignee_ai_employee_id as string | null | undefined) : undefined;
    if (newAi && newAi !== existing.assignee_ai_employee_id && !actor.permissions.has('ai.assign')) throw forbidden('missing_permission:ai.assign');
    if (newAi) columns.assignee_member_id = null;
    if (entity === 'tasks' && columns.assignee_member_id) columns.assignee_ai_employee_id = null;

    if (entity === 'documents' && (columns.content !== undefined || columns.title !== undefined)) {
      const version = Number(existing.current_version ?? 1) + 1;
      columns.current_version = version;
      await this.db.from('document_versions').insert({
        document_id: id,
        organization_id: actor.orgId,
        version,
        title: (columns.title as string | undefined) ?? existing.title,
        content: (columns.content as string | undefined) ?? existing.content,
        change_summary: (virtual.change_summary as string | undefined) ?? null,
        created_by_user_id: actor.userId,
      });
    }

    const row = Object.keys(columns).length
      ? unwrap(await this.db.from(cfg.table).update(columns).eq('id', id).eq('organization_id', actor.orgId).select('*').single<Record<string, unknown> & { id: string }>())
      : existing;
    await this.writeRelations(actor, entity, id, virtual, false);

    if (entity === 'tasks') {
      if (columns.status || columns.project_id !== undefined) await this.recomputeProgress(actor.orgId, (row.project_id as string | null) ?? (existing.project_id as string | null), (row.mission_id as string | null) ?? null);
      if (columns.assignee_member_id && columns.assignee_member_id !== existing.assignee_member_id) await this.notifyAssignee(actor, row as unknown as TaskRow);
      if (newAi && newAi !== existing.assignee_ai_employee_id) {
        const session = await this.agents.assignTask(actor, newAi, id);
        return { ...row, ai_session_id: session.id };
      }
    }
    return row;
  }

  async remove(actor: OrgActor, entity: EntityName, id: string) {
    const cfg = ENTITY_CONFIG[entity];
    const existing = (await this.get(actor, entity, id)) as Record<string, unknown>;
    const isCreator = existing[cfg.creatorColumn] === actor.userId;
    if (!actor.permissions.has(cfg.manage) && !(isCreator && actor.permissions.has(cfg.create))) throw forbidden(`missing_permission:${cfg.manage}`);
    await this.db.from(cfg.table).update({ [cfg.softDelete]: new Date().toISOString() }).eq('id', id).eq('organization_id', actor.orgId);
    await this.audit.activity({ organizationId: actor.orgId, actorUserId: actor.userId, verb: 'deleted', entityType: entity.replace(/s$/, ''), entityId: id, summary: String(existing.title ?? existing.name ?? entity) });
  }

  private async writeRelations(actor: OrgActor, entity: EntityName, id: string, v: Record<string, unknown>, isCreate: boolean) {
    const org = actor.orgId;
    const ids = (k: string) => (Array.isArray(v[k]) ? (v[k] as string[]) : undefined);
    if (entity === 'missions') {
      const deps = ids('department_ids');
      if (deps) {
        await this.assertIdsInOrg(org, 'departments', deps);
        if (!isCreate) await this.db.from('mission_departments').delete().eq('mission_id', id);
        if (deps.length) await this.db.from('mission_departments').insert(deps.map((d) => ({ mission_id: id, department_id: d, organization_id: org })));
      }
      const members = ids('member_ids');
      const ais = ids('ai_employee_ids');
      if (members || ais) {
        await this.assertIdsInOrg(org, 'organization_members', members ?? []);
        await this.assertIdsInOrg(org, 'ai_employees', ais ?? []);
        if (!isCreate) await this.db.from('mission_employees').delete().eq('mission_id', id);
        const rows = [...(members ?? []).map((m) => ({ mission_id: id, organization_id: org, member_id: m })), ...(ais ?? []).map((a) => ({ mission_id: id, organization_id: org, ai_employee_id: a }))];
        if (rows.length) await this.db.from('mission_employees').insert(rows);
      }
    }
    if (entity === 'projects') {
      const members = ids('member_ids');
      const ais = ids('ai_employee_ids');
      if (members || ais) {
        await this.assertIdsInOrg(org, 'organization_members', members ?? []);
        await this.assertIdsInOrg(org, 'ai_employees', ais ?? []);
        if (!isCreate) await this.db.from('project_members').delete().eq('project_id', id);
        const rows = [...(members ?? []).map((m) => ({ project_id: id, organization_id: org, member_id: m })), ...(ais ?? []).map((a) => ({ project_id: id, organization_id: org, ai_employee_id: a }))];
        if (rows.length) await this.db.from('project_members').insert(rows);
      }
    }
    if (entity === 'tasks') {
      const deps = ids('depends_on');
      if (deps) {
        if (deps.includes(id)) throw badRequest('task_cannot_depend_on_itself');
        await this.assertIdsInOrg(org, 'tasks', deps);
        if (!isCreate) await this.db.from('task_dependencies').delete().eq('task_id', id);
        if (deps.length) await this.db.from('task_dependencies').insert(deps.map((d) => ({ task_id: id, depends_on_task_id: d, organization_id: org })));
      }
    }
    if (entity === 'meetings') {
      const members = ids('participant_member_ids');
      const ais = ids('participant_ai_employee_ids');
      if (members || ais) {
        await this.assertIdsInOrg(org, 'organization_members', members ?? []);
        await this.assertIdsInOrg(org, 'ai_employees', ais ?? []);
        if (!isCreate) await this.db.from('meeting_participants').delete().eq('meeting_id', id);
        const rows = [...(members ?? []).map((m) => ({ meeting_id: id, organization_id: org, member_id: m })), ...(ais ?? []).map((a) => ({ meeting_id: id, organization_id: org, ai_employee_id: a }))];
        if (rows.length) await this.db.from('meeting_participants').insert(rows);
      }
    }
  }

  private async notifyAssignee(actor: OrgActor, task: TaskRow) {
    if (!task.assignee_member_id) return;
    const { data } = await this.db.from('organization_members').select('user_id').eq('id', task.assignee_member_id).maybeSingle<{ user_id: string }>();
    if (data && data.user_id !== actor.userId) {
      await this.notifications.notify({ organizationId: actor.orgId, userIds: [data.user_id], type: 'task_assigned', title: task.title, link: `/app/tasks/${task.id}` });
    }
  }

  async recomputeProgress(orgId: string, projectId: string | null, missionId: string | null) {
    if (projectId) {
      const { data } = await this.db.from('tasks').select('status').eq('project_id', projectId).eq('organization_id', orgId).is('deleted_at', null).is('parent_task_id', null);
      const rows = (data ?? []) as Array<{ status: string }>;
      const progress = rows.length ? Math.round((rows.filter((r) => r.status === 'done').length / rows.length) * 100) : 0;
      const { data: project } = await this.db.from('projects').update({ progress }).eq('id', projectId).select('mission_id').single<{ mission_id: string | null }>();
      missionId = missionId ?? project?.mission_id ?? null;
    }
    if (missionId) {
      const { data } = await this.db.from('projects').select('progress').eq('mission_id', missionId).is('deleted_at', null);
      const rows = (data ?? []) as Array<{ progress: number }>;
      if (rows.length) await this.db.from('missions').update({ progress: Math.round(rows.reduce((a, r) => a + r.progress, 0) / rows.length) }).eq('id', missionId);
    }
  }

  async addComment(actor: OrgActor, taskId: string, body: string, fileIds: string[]) {
    if (!actor.permissions.has('work.create')) throw forbidden();
    const task = (await this.get(actor, 'tasks', taskId)) as unknown as TaskRow;
    const mentions = [...body.matchAll(/@\[([0-9a-f-]{36})\]/gi)].map((m) => m[1]!).slice(0, 20);
    const row = unwrap(
      await this.db.from('task_comments').insert({ organization_id: actor.orgId, task_id: task.id, author_user_id: actor.userId, body, mentions }).select('*').single<{ id: string }>(),
    );
    if (fileIds.length) {
      const { data: files } = await this.db.from('company_files').select('id').in('id', fileIds).eq('organization_id', actor.orgId).eq('space', 'shared').is('deleted_at', null);
      const valid = ((files ?? []) as Array<{ id: string }>).map((f) => f.id);
      if (valid.length) {
        await this.db.from('file_links').upsert(
          valid.flatMap((f) => [
            { organization_id: actor.orgId, file_id: f, entity_type: 'task_comment', entity_id: row.id, linked_by_user_id: actor.userId },
            { organization_id: actor.orgId, file_id: f, entity_type: 'task', entity_id: task.id, linked_by_user_id: actor.userId },
          ]),
          { onConflict: 'file_id,entity_type,entity_id' },
        );
      }
    }
    if (mentions.length) {
      const { data: members } = await this.db.from('organization_members').select('user_id').eq('organization_id', actor.orgId).in('id', mentions);
      await this.notifications.notify({ organizationId: actor.orgId, userIds: ((members ?? []) as Array<{ user_id: string }>).map((m) => m.user_id), type: 'mention', title: task.title, body: body.slice(0, 200), link: `/app/tasks/${task.id}` });
      const { data: ais } = await this.db.from('ai_employees').select('id').eq('organization_id', actor.orgId).in('id', mentions);
      for (const a of (ais ?? []) as Array<{ id: string }>) {
        await this.db.from('ai_employee_inbox').insert({ organization_id: actor.orgId, ai_employee_id: a.id, item_type: 'mention', title: task.title, body: body.slice(0, 2000), related_type: 'task', related_id: task.id, from_user_id: actor.userId });
      }
    }
    return row;
  }
}
