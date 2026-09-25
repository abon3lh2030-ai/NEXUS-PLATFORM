import { approvalDecisionSchema, nexusChatSchema, searchQuerySchema } from '@nexus/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { conflict, notFound, parse } from '../lib/errors.js';
import { actorOf, orgGuard } from '../plugins/auth.js';
import type { Services } from '../services/container.js';
import type { ApprovalRow } from '../types/db.js';
import { idOf } from './helpers.js';

export async function governanceRoutes(app: FastifyInstance, s: Services) {
  /* ------------------------------ Approvals ------------------------------ */
  app.get('/approvals', { preHandler: orgGuard(s, { permission: 'work.view' }) }, async (req) => {
    const a = actorOf(req);
    const q = parse(z.object({ status: z.enum(['pending', 'approved', 'rejected', 'revision_requested']).optional() }), req.query);
    let query = s.db.from('approvals').select('*, ai_employees(name, job_title)').eq('organization_id', a.orgId).order('created_at', { ascending: false }).limit(200);
    if (q.status) query = query.eq('status', q.status);
    return (await query).data ?? [];
  });

  app.get('/approvals/:id', { preHandler: orgGuard(s, { permission: 'work.view' }) }, async (req) => {
    const a = actorOf(req);
    const { data } = await s.db.from('approvals').select('*').eq('id', idOf(req.params)).eq('organization_id', a.orgId).maybeSingle<ApprovalRow>();
    if (!data) throw notFound();
    const { data: comments } = await s.db.from('approval_comments').select('*').eq('approval_id', data.id).order('created_at');
    const { data: output } = data.entity_type === 'ai_output' && data.entity_id ? await s.db.from('ai_outputs').select('*').eq('id', data.entity_id).maybeSingle() : { data: null };
    return { ...data, comments: comments ?? [], output };
  });

  app.post('/approvals/:id/decide', { preHandler: orgGuard(s, { permission: 'approvals.decide' }) }, async (req) => {
    const a = actorOf(req);
    const body = parse(approvalDecisionSchema, req.body);
    const { data: approval } = await s.db.from('approvals').select('*').eq('id', idOf(req.params)).eq('organization_id', a.orgId).maybeSingle<ApprovalRow>();
    if (!approval) throw notFound();
    if (approval.status !== 'pending') throw conflict('already_decided');
    // Atomic transition guard: only one decider wins.
    const { data: updated } = await s.db
      .from('approvals')
      .update({ status: body.decision, decided_by_user_id: a.userId, decided_at: new Date().toISOString(), decision_comment: body.comment })
      .eq('id', approval.id)
      .eq('status', 'pending')
      .select('*')
      .maybeSingle<ApprovalRow>();
    if (!updated) throw conflict('already_decided');
    if (body.comment) await s.db.from('approval_comments').insert({ approval_id: approval.id, organization_id: a.orgId, author_user_id: a.userId, body: body.comment });
    // Digital-office approvals are resolved by their own services; everything else by the agent runtime.
    if (updated.approval_type === 'email_send' && updated.entity_id) {
      await s.mail.onApproval(a, updated.entity_id, body.decision, body.comment);
    } else if (updated.approval_type === 'presentation' && updated.entity_id) {
      if (body.decision === 'approved') await s.presentations.approve(a, updated.entity_id, false);
      else if (body.decision === 'revision_requested') await s.presentations.requestRevision(a, updated.entity_id, body.comment || 'Please revise.');
      else await s.db.from('presentations').update({ status: 'changes_requested' }).eq('id', updated.entity_id).eq('organization_id', a.orgId);
    } else if (updated.approval_type === 'meeting_action' && updated.entity_id && body.decision === 'approved') {
      const emails = Array.isArray(updated.payload.emails) ? (updated.payload.emails as string[]) : [];
      if (emails.length) {
        await s.db.from('meeting_participants').insert(emails.map((e) => ({ meeting_id: updated.entity_id!, organization_id: a.orgId, external_email: e })));
        const { data: ev } = await s.db.from('calendar_events').select('id').eq('meeting_id', updated.entity_id).maybeSingle<{ id: string }>();
        if (ev) await s.db.from('calendar_event_attendees').insert(emails.map((e) => ({ event_id: ev.id, organization_id: a.orgId, external_email: e })));
      }
    } else {
      await s.agents.onApprovalDecided(updated, body.decision, body.comment, a.userId);
    }
    if (approval.requested_by_user_id) {
      await s.notifications.notify({ organizationId: a.orgId, userIds: [approval.requested_by_user_id], type: 'approval_resolved', title: `${approval.title}: ${body.decision}`, link: `/app/approvals?id=${approval.id}` });
    }
    await s.audit.audit({ organizationId: a.orgId, actorType: 'human', actorUserId: a.userId, action: `approval.${body.decision}`, targetType: 'approval', targetId: approval.id });
    return updated;
  });

  app.post('/approvals/:id/comments', { preHandler: orgGuard(s, { permission: 'work.view' }) }, async (req) => {
    const a = actorOf(req);
    const { body } = parse(z.object({ body: z.string().trim().min(1).max(4000) }), req.body);
    const { data: approval } = await s.db.from('approvals').select('id').eq('id', idOf(req.params)).eq('organization_id', a.orgId).maybeSingle();
    if (!approval) throw notFound();
    const { data } = await s.db.from('approval_comments').insert({ approval_id: idOf(req.params), organization_id: a.orgId, author_user_id: a.userId, body }).select('*').single();
    return data;
  });

  /* ------------------------------ Nexus AI ------------------------------ */
  const nexus = { preHandler: orgGuard(s, { permission: 'nexus_ai.use' }), config: { rateLimit: { max: 30, timeWindow: '1 minute' } } };
  app.get('/nexus/conversations', nexus, async (req) => s.nexusAi.listConversations(actorOf(req)));
  app.get('/nexus/conversations/:id', nexus, async (req) => s.nexusAi.getConversation(actorOf(req), idOf(req.params)));
  app.post('/nexus/chat', nexus, async (req) => s.nexusAi.chat(actorOf(req), parse(nexusChatSchema, req.body)));

  /* ------------------------------ Insights ------------------------------ */
  app.get('/analytics', { preHandler: orgGuard(s, { permission: 'analytics.view', feature: 'basic_analytics' }) }, async (req) => {
    const a = actorOf(req);
    const { days } = parse(z.object({ days: z.coerce.number().int().min(1).max(365).optional().default(30) }), req.query);
    const result = await s.insights.analytics(a.orgId, days);
    // Advanced breakdowns only on plans that include them.
    if (!a.billing.entitlements.features.includes('advanced_analytics')) {
      return { ...result, ai_productivity: [], ai_cost_by_day: [], activity_by_day: [], advanced_locked: true };
    }
    return { ...result, advanced_locked: false };
  });

  app.get('/health-score', { preHandler: orgGuard(s, { permission: 'work.view' }) }, async (req) => s.insights.health(actorOf(req).orgId));
  app.get('/dashboard', { preHandler: orgGuard(s, { permission: 'work.view' }) }, async (req) => {
    const a = actorOf(req);
    const [snapshot, health, { data: activity }] = await Promise.all([
      s.insights.companySnapshot(a.orgId),
      s.insights.health(a.orgId),
      s.db.from('activity_events').select('*').eq('organization_id', a.orgId).order('created_at', { ascending: false }).limit(20),
    ]);
    return { snapshot, health, activity: activity ?? [] };
  });

  app.get('/search', { preHandler: orgGuard(s, { permission: 'work.view' }), config: { rateLimit: { max: 60, timeWindow: '1 minute' } } }, async (req) => s.insights.search(actorOf(req), parse(searchQuerySchema, req.query).q));

  app.get('/activity', { preHandler: orgGuard(s, { permission: 'work.view' }) }, async (req) => {
    const a = actorOf(req);
    const { data } = await s.db.from('activity_events').select('*').eq('organization_id', a.orgId).order('created_at', { ascending: false }).limit(200);
    return data ?? [];
  });

  app.get('/audit-logs', { preHandler: orgGuard(s, { permission: 'audit.view', feature: 'audit_logs' }) }, async (req) => {
    const a = actorOf(req);
    const { data } = await s.db.from('audit_logs').select('*').eq('organization_id', a.orgId).order('created_at', { ascending: false }).limit(500);
    return data ?? [];
  });
}
