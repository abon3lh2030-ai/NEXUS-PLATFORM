import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { forbidden, notFound, parse, unauthorized } from '../lib/errors.js';
import { actorOf, orgGuard } from '../plugins/auth.js';
import { safeEqual } from '../services/billing/moyasar.js';
import type { Services } from '../services/container.js';
import { idOf, params } from './helpers.js';

const isoRange = z.object({ from: z.iso.datetime({ offset: true }).optional(), to: z.iso.datetime({ offset: true }).optional(), ai_employee_id: z.uuid().optional() });

const policySchema = z.object({
  email_send_mode: z.enum(['draft_only', 'approval_required', 'autonomous']),
  allow_external_email: z.boolean(),
  autonomous_external_domains: z.array(z.string().trim().toLowerCase().regex(/^[a-z0-9.-]+\.[a-z]{2,}$/)).max(50),
  daily_send_limit_per_employee: z.number().int().min(0).max(1000),
  presentation_publish_requires_approval: z.boolean(),
  meeting_recording: z.enum(['none', 'transcript_only', 'audio_and_transcript']),
  transcript_retention_days: z.number().int().min(1).max(3650),
  require_participant_consent: z.boolean(),
  allow_ai_speaking_external: z.boolean(),
});

export async function officeRoutes(app: FastifyInstance, s: Services) {
  const view = { preHandler: orgGuard(s, { permission: 'work.view' }) };

  /* ------------------------------ Integrations & policy ------------------------------ */

  app.get('/office/capabilities', view, async () => ({
    ...s.office.capabilities(),
    ai: { provider: s.ai.name, is_mock: s.ai.isMock },
    computer: { provider: s.computer.name, ...s.computer.capabilities },
    email_provider: { name: s.email.provider.name, ...s.email.provider.capabilities, agent_domain: s.env.EMAIL_AGENT_DOMAIN ?? null },
  }));

  app.get('/office/policy', view, async (req) => s.mail.policy(actorOf(req).orgId));

  app.put('/office/policy', { preHandler: orgGuard(s, { permission: 'org.manage' }) }, async (req) => {
    const a = actorOf(req);
    const body = parse(policySchema, req.body);
    await s.db.from('communication_policies').upsert({ organization_id: a.orgId, ...body, updated_by: a.userId, updated_at: new Date().toISOString() });
    await s.audit.audit({ organizationId: a.orgId, actorType: 'human', actorUserId: a.userId, action: 'communication_policy.updated', metadata: body });
    return s.mail.policy(a.orgId);
  });

  /* ------------------------------ Presentations ------------------------------ */

  app.get('/presentations', view, async (req) => s.presentations.list(actorOf(req), parse(z.object({ project_id: z.uuid().optional(), ai_employee_id: z.uuid().optional() }), req.query)));
  app.get('/presentations/:id', view, async (req) => s.presentations.get(actorOf(req), idOf(req.params)));
  app.get('/presentations/:id/versions/:version/download', view, async (req) => {
    const p = params(z.object({ id: z.uuid(), version: z.coerce.number().int().min(1) }), req.params);
    return s.presentations.download(actorOf(req), p.id, p.version);
  });
  app.patch('/presentations/:id', view, async (req) =>
    s.presentations.update(actorOf(req), idOf(req.params), parse(z.object({ title: z.string().trim().min(1).max(200).optional(), project_id: z.uuid().nullable().optional(), meeting_id: z.uuid().nullable().optional() }), req.body)),
  );
  app.post('/presentations/:id/duplicate', view, async (req) => s.presentations.duplicate(actorOf(req), idOf(req.params)));
  app.delete('/presentations/:id', view, async (req) => {
    await s.presentations.remove(actorOf(req), idOf(req.params));
    return { ok: true };
  });
  app.post('/presentations/:id/revise', { preHandler: orgGuard(s, { permission: 'approvals.decide' }), config: { rateLimit: { max: 10, timeWindow: '10 minutes' } } }, async (req) =>
    s.presentations.requestRevision(actorOf(req), idOf(req.params), parse(z.object({ feedback: z.string().trim().min(3).max(4000) }), req.body).feedback),
  );
  app.post('/presentations/:id/approve', { preHandler: orgGuard(s, { permission: 'approvals.decide' }) }, async (req) =>
    s.presentations.approve(actorOf(req), idOf(req.params), parse(z.object({ publish: z.boolean().optional().default(false) }), req.body ?? {}).publish),
  );
  app.post('/presentations/:id/publish', { preHandler: orgGuard(s, { permission: 'files.shared.upload' }) }, async (req) => s.presentations.publishById(actorOf(req), idOf(req.params)));

  /* ------------------------------ Mail (manager view of AI mailboxes) ------------------------------ */

  app.get('/ai/employees/:id/mail', { preHandler: orgGuard(s, { permission: 'ai.computer.view' }) }, async (req) => {
    const { folder } = parse(z.object({ folder: z.enum(['inbox', 'sent', 'drafts', 'archived', 'tasks']).optional().default('inbox') }), req.query);
    return s.mail.managerList(actorOf(req), idOf(req.params), folder);
  });
  app.post('/mail/messages/:id/send', { preHandler: orgGuard(s, { permission: 'approvals.decide' }), config: { rateLimit: { max: 30, timeWindow: '10 minutes' } } }, async (req) => s.mail.humanSend(actorOf(req), idOf(req.params)));
  app.post('/mail/messages/:id/archive', { preHandler: orgGuard(s, { permission: 'ai.control' }) }, async (req) => {
    await s.mail.archive(actorOf(req), idOf(req.params));
    return { ok: true };
  });

  /** Inbound email from the provider (normalized). Authenticated with a shared secret header. */
  app.post('/webhooks/email/inbound', { config: { rateLimit: { max: 300, timeWindow: '1 minute' } } }, async (req) => {
    const secret = s.env.INBOUND_EMAIL_WEBHOOK_SECRET;
    const given = req.headers['x-nexus-webhook-secret'];
    if (!secret || typeof given !== 'string' || !safeEqual(given, secret)) throw unauthorized('invalid_webhook_secret');
    const body = parse(z.object({ to: z.email(), from: z.email(), subject: z.string().max(1000).default(''), text: z.string().max(500_000).default(''), message_id: z.string().max(500).nullable().optional() }), req.body);
    return s.mail.receive({ to: body.to, from: body.from, subject: body.subject, text: body.text, providerMessageId: body.message_id ?? null });
  });

  /* ------------------------------ Calendar ------------------------------ */

  app.get('/calendar', view, async (req) => {
    const q = parse(isoRange, req.query);
    const from = q.from ? new Date(q.from) : new Date(Date.now() - 7 * 86400_000);
    const to = q.to ? new Date(q.to) : new Date(from.getTime() + 42 * 86400_000);
    return s.office.events(actorOf(req).orgId, from, to, { aiEmployeeId: q.ai_employee_id });
  });

  app.post('/calendar/free-time', view, async (req) => {
    const b = parse(z.object({ member_ids: z.array(z.uuid()).max(30).default([]), ai_employee_ids: z.array(z.uuid()).max(30).default([]), from: z.iso.datetime({ offset: true }), to: z.iso.datetime({ offset: true }), duration_minutes: z.number().int().min(15).max(480) }), req.body);
    return s.office.findFreeTime(actorOf(req).orgId, { memberIds: b.member_ids, aiEmployeeIds: b.ai_employee_ids, from: new Date(b.from), to: new Date(b.to), durationMin: b.duration_minutes });
  });

  app.post('/calendar/events', { preHandler: orgGuard(s, { permission: 'work.create' }) }, async (req) => {
    const a = actorOf(req);
    const b = parse(z.object({ title: z.string().trim().min(1).max(300), description: z.string().max(4000).default(''), event_type: z.enum(['deadline', 'milestone', 'event']).default('event'), starts_at: z.iso.datetime({ offset: true }), ends_at: z.iso.datetime({ offset: true }) }), req.body);
    if (new Date(b.ends_at) < new Date(b.starts_at)) throw forbidden('invalid_range');
    const { data } = await s.db.from('calendar_events').insert({ organization_id: a.orgId, ...b, owner_user_id: a.userId }).select('*').single();
    return data;
  });

  /* ------------------------------ AI-enabled meetings ------------------------------ */

  app.post('/meetings/schedule', { preHandler: orgGuard(s, { permission: 'meetings.manage', feature: 'meetings' }) }, async (req) => {
    const a = actorOf(req);
    const b = parse(
      z.object({
        title: z.string().trim().min(1).max(200),
        description: z.string().max(4000).default(''),
        starts_at: z.iso.datetime({ offset: true }),
        duration_minutes: z.number().int().min(5).max(480).default(60),
        agenda: z.string().max(10000).default(''),
        member_ids: z.array(z.uuid()).max(100).default([]),
        ai_employee_ids: z.array(z.uuid()).max(50).default([]),
        external_emails: z.array(z.email()).max(50).default([]),
        meeting_link: z.url({ protocol: /^https$/ }).nullable().optional(),
        project_id: z.uuid().nullable().optional(),
        presentation_id: z.uuid().nullable().optional(),
      }),
      req.body,
    );
    // Humans with meetings.manage may invite external guests directly (they are the accountable party).
    return s.office.scheduleMeeting(a.orgId, { userId: a.userId }, { title: b.title, description: b.description, startsAt: new Date(b.starts_at), durationMin: b.duration_minutes, agenda: b.agenda, memberIds: b.member_ids, aiEmployeeIds: b.ai_employee_ids, externalEmails: b.external_emails, meetingLink: b.meeting_link ?? null, projectId: b.project_id ?? null, presentationId: b.presentation_id ?? null });
  });

  app.get('/meetings/:id/office', { preHandler: orgGuard(s, { permission: 'work.view', feature: 'meetings' }) }, async (req) => {
    const a = actorOf(req);
    return s.office.meetingDetail(a.orgId, idOf(req.params), a.permissions.has('meetings.manage'));
  });

  app.post('/meetings/:id/consent', { preHandler: orgGuard(s, { permission: 'meetings.manage', feature: 'meetings' }) }, async (req) => {
    await s.office.setConsent(actorOf(req), idOf(req.params), parse(z.object({ confirmed: z.boolean() }), req.body).confirmed);
    return { ok: true };
  });

  app.post('/meetings/:id/transcript', { preHandler: orgGuard(s, { permission: 'meetings.manage', feature: 'meetings' }) }, async (req) => {
    await s.office.addManualTranscript(actorOf(req), idOf(req.params), parse(z.object({ text: z.string().trim().min(1).max(200_000) }), req.body).text);
    return { ok: true };
  });

  /** Ask an AI employee to attend: creates a real work task so it prepares, joins (if supported) and follows up. */
  app.post('/meetings/:id/assign-ai', { preHandler: orgGuard(s, { permission: ['meetings.manage', 'ai.assign'], feature: 'meetings' }) }, async (req) => {
    const a = actorOf(req);
    const meetingId = idOf(req.params);
    const b = parse(z.object({ ai_employee_id: z.uuid(), instructions: z.string().max(4000).default(''), present_presentation_id: z.uuid().nullable().optional() }), req.body);
    const { data: meeting } = await s.db.from('meetings').select('id, title, scheduled_at').eq('id', meetingId).eq('organization_id', a.orgId).maybeSingle<{ id: string; title: string; scheduled_at: string }>();
    if (!meeting) throw notFound('meeting_not_found');
    const { data: existing } = await s.db.from('meeting_participants').select('id').eq('meeting_id', meetingId).eq('ai_employee_id', b.ai_employee_id).maybeSingle();
    if (!existing) await s.db.from('meeting_participants').insert({ meeting_id: meetingId, organization_id: a.orgId, ai_employee_id: b.ai_employee_id, role: b.present_presentation_id ? 'presenter' : 'attendee' });
    const task = (await s.work.create(a, 'tasks', {
      title: `Meeting: ${meeting.title}`.slice(0, 300),
      description: [`Meeting id: ${meeting.id}`, `Scheduled: ${meeting.scheduled_at}`, b.present_presentation_id ? `Present presentation id: ${b.present_presentation_id}` : '', 'Prepare talking points from the agenda and related project files; join the meeting if possible (join_meeting); afterwards run process_meeting to produce the summary, decisions, tasks and a follow-up email draft.', b.instructions].filter(Boolean).join('\n'),
      assignee_ai_employee_id: b.ai_employee_id,
      priority: 'high',
    })) as { id: string; ai_session_id?: string };
    return task;
  });

  app.post('/meetings/:id/process', { preHandler: orgGuard(s, { permission: 'meetings.manage', feature: 'meetings' }), config: { rateLimit: { max: 10, timeWindow: '10 minutes' } } }, async (req) => {
    const a = actorOf(req);
    const b = parse(z.object({ create_tasks: z.boolean().default(false), language: z.enum(['ar', 'en']).default('ar') }), req.body ?? {});
    return s.office.processMeeting(a.orgId, idOf(req.params), { userId: a.userId }, { createTasks: b.create_tasks, language: b.language }, a);
  });

  app.post('/meetings/sessions/:id/leave', { preHandler: orgGuard(s, { permission: 'ai.control' }) }, async (req) => {
    await s.office.leaveMeeting(actorOf(req), idOf(req.params));
    return { ok: true };
  });

  app.post('/meetings/sessions/:id/sync-transcript', { preHandler: orgGuard(s, { permission: 'meetings.manage' }) }, async (req) => s.office.syncTranscript(actorOf(req).orgId, idOf(req.params)));

  /* ------------------------------ Voice ------------------------------ */

  app.get('/ai/employees/:id/voice', { preHandler: orgGuard(s, { permission: 'ai.view' }) }, async (req) => ({ profile: await s.office.voiceProfile(actorOf(req).orgId, idOf(req.params)), provider: s.office.voice.name, capabilities: s.office.voice.capabilities }));
  app.put('/ai/employees/:id/voice', { preHandler: orgGuard(s, { permission: 'ai.manage' }) }, async (req) =>
    s.office.updateVoiceProfile(actorOf(req), idOf(req.params), parse(z.object({ voice_id: z.string().max(100).nullable().optional(), language: z.enum(['ar', 'en']).optional(), speaking_style: z.enum(['professional', 'friendly', 'concise', 'formal']).optional(), enabled: z.boolean().optional() }), req.body)),
  );
  app.post('/ai/employees/:id/voice/test', { preHandler: orgGuard(s, { permission: 'ai.manage' }), config: { rateLimit: { max: 10, timeWindow: '10 minutes' } } }, async (req, reply) => {
    const a = actorOf(req);
    const { text } = parse(z.object({ text: z.string().trim().min(1).max(500) }), req.body);
    const out = await s.office.speak(a.orgId, idOf(req.params), text, true);
    return reply.header('Content-Type', out.mime).header('Cache-Control', 'no-store').send(out.audio);
  });
}
