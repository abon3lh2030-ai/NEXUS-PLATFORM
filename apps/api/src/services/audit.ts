import type { Db } from '../lib/supabase.js';

export interface AuditEntry {
  organizationId: string | null;
  actorType: 'human' | 'ai' | 'system' | 'super_admin';
  actorUserId?: string | null;
  actorAiEmployeeId?: string | null;
  action: string;
  targetType?: string;
  targetId?: string;
  ip?: string;
  userAgent?: string;
  /** Must never contain secrets or file contents. */
  metadata?: Record<string, unknown>;
}

export interface ActivityEntry {
  organizationId: string;
  actorUserId?: string | null;
  actorAiEmployeeId?: string | null;
  verb: string;
  entityType: string;
  entityId?: string | null;
  summary: string;
  metadata?: Record<string, unknown>;
}

export class AuditService {
  constructor(private readonly db: Db) {}

  async audit(e: AuditEntry): Promise<void> {
    const { error } = await this.db.from('audit_logs').insert({
      organization_id: e.organizationId,
      actor_type: e.actorType,
      actor_user_id: e.actorUserId ?? null,
      actor_ai_employee_id: e.actorAiEmployeeId ?? null,
      action: e.action,
      target_type: e.targetType ?? null,
      target_id: e.targetId ?? null,
      ip: e.ip ?? null,
      user_agent: e.userAgent?.slice(0, 400) ?? null,
      metadata: e.metadata ?? {},
    });
    if (error) throw new Error(`audit_write_failed: ${error.message}`);
  }

  async activity(e: ActivityEntry): Promise<void> {
    await this.db.from('activity_events').insert({
      organization_id: e.organizationId,
      actor_user_id: e.actorUserId ?? null,
      actor_ai_employee_id: e.actorAiEmployeeId ?? null,
      verb: e.verb,
      entity_type: e.entityType,
      entity_id: e.entityId ?? null,
      summary: e.summary.slice(0, 500),
      metadata: e.metadata ?? {},
    });
  }
}
