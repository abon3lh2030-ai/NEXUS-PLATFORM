import type { NotificationType, HumanRole } from '@nexus/shared';
import type { Db } from '../lib/supabase.js';

export interface NotifyInput {
  organizationId: string | null;
  userIds: string[];
  type: NotificationType;
  title: string;
  body?: string;
  link?: string;
  data?: Record<string, unknown>;
}

export class NotificationService {
  constructor(private readonly db: Db) {}

  async notify(n: NotifyInput): Promise<void> {
    const unique = [...new Set(n.userIds)];
    if (unique.length === 0) return;
    await this.db.from('notifications').insert(
      unique.map((userId) => ({
        organization_id: n.organizationId,
        user_id: userId,
        type: n.type,
        title: n.title.slice(0, 300),
        body: (n.body ?? '').slice(0, 2000),
        link: n.link ?? null,
        data: n.data ?? {},
      })),
    );
  }

  /** Notify every active member holding one of the given roles. */
  async notifyRoles(orgId: string, roles: HumanRole[], n: Omit<NotifyInput, 'userIds' | 'organizationId'>): Promise<void> {
    const { data } = await this.db
      .from('organization_members')
      .select('user_id')
      .eq('organization_id', orgId)
      .eq('status', 'active')
      .in('role', roles);
    const ids = ((data ?? []) as Array<{ user_id: string }>).map((r) => r.user_id);
    await this.notify({ ...n, organizationId: orgId, userIds: ids });
  }
}
