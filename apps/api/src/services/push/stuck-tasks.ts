import type { Db } from '../../lib/supabase.js';
import type { NotificationService } from '../notifications.js';

/**
 * Cron: tell managers (and the assigned person) about tasks that are blocked or past due — at most once
 * a day per task, so nobody gets the same reminder every hour.
 */
export async function notifyStuckTasks(db: Db, notifications: NotificationService): Promise<number> {
  const now = new Date();
  const { data } = await db
    .from('tasks')
    .select('id, organization_id, title, status, due_date, assignee_member_id')
    .is('deleted_at', null)
    .neq('status', 'done')
    .or(`status.eq.blocked,due_date.lt.${now.toISOString()}`)
    .limit(500);
  const tasks = (data ?? []) as Array<{ id: string; organization_id: string; title: string; status: string; due_date: string | null; assignee_member_id: string | null }>;
  if (!tasks.length) return 0;

  const since = new Date(now.getTime() - 24 * 3_600_000).toISOString();
  const { data: recent } = await db.from('notifications').select('link').eq('type', 'task_overdue').gte('created_at', since).in('link', tasks.map((t) => `/app/tasks/${t.id}`));
  const already = new Set(((recent ?? []) as Array<{ link: string }>).map((r) => r.link));

  let sent = 0;
  for (const t of tasks) {
    const link = `/app/tasks/${t.id}`;
    if (already.has(link)) continue;
    const body = t.status === 'blocked' ? 'blocked' : 'overdue';
    const { data: managers } = await db.from('organization_members').select('user_id').eq('organization_id', t.organization_id).eq('status', 'active').in('role', ['owner', 'admin', 'manager']);
    const ids = ((managers ?? []) as Array<{ user_id: string }>).map((m) => m.user_id);
    if (t.assignee_member_id) {
      const { data: m } = await db.from('organization_members').select('user_id').eq('id', t.assignee_member_id).maybeSingle<{ user_id: string }>();
      if (m) ids.push(m.user_id);
    }
    await notifications.notify({ organizationId: t.organization_id, userIds: ids, type: 'task_overdue', title: t.title, body, link, data: { task_id: t.id, reason: body } });
    sent++;
  }
  return sent;
}
