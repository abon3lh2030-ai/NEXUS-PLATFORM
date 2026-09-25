import {
  aiDisclosureFooter,
  classifyRecipients,
  DEFAULT_COMMUNICATION_POLICY,
  evaluateEmailSend,
  normalizeEmail,
  type CommunicationPolicy,
  type SendDecision,
} from '@nexus/shared';
import type { Env } from '../../config/env.js';
import type { AiActor, OrgActor } from '../../context.js';
import { AppError, badRequest, conflict, forbidden, notFound, unwrap } from '../../lib/errors.js';
import type { Db } from '../../lib/supabase.js';
import type { FileRow } from '../../types/db.js';
import type { AuditService } from '../audit.js';
import type { EmailService } from '../email/provider.js';
import { escapeHtml } from '../email/templates.js';
import { aiCanReadFile } from '../files/access-policy.js';
import { FILES_BUCKET } from '../files/storage-keys.js';
import type { NotificationService } from '../notifications.js';

export interface MailboxRow {
  id: string;
  organization_id: string;
  ai_employee_id: string;
  address: string | null;
  display_name: string;
  provider: string;
  status: 'not_connected' | 'active' | 'suspended';
}

export interface EmailMessageRow {
  id: string;
  organization_id: string;
  thread_id: string;
  mailbox_id: string;
  direction: 'inbound' | 'outbound';
  folder: string;
  status: string;
  from_address: string;
  to_addresses: string[];
  cc_addresses: string[];
  subject: string;
  body_text: string;
  is_external: boolean;
  risk: string;
  approval_id: string | null;
  provider_message_id: string | null;
  failure_reason: string | null;
  task_id: string | null;
  created_by_ai_employee_id: string | null;
  sent_at: string | null;
  created_at: string;
}

const MAX_ATTACHMENTS = 5;
const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;

export function slugForMailbox(name: string, id: string): string {
  const ascii = name
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '.')
    .replace(/^\.+|\.+$/g, '');
  return (ascii || 'ai') + '.' + id.slice(0, 6);
}

/**
 * AI employee email. Drafting, policy evaluation, approvals and delivery through the configured
 * EmailProvider. Delivery requires a provider that can send as custom identities AND a verified
 * EMAIL_AGENT_DOMAIN — otherwise messages stay drafts and the UI says the mailbox is not connected.
 */
export class MailService {
  constructor(
    private readonly env: Env,
    private readonly db: Db,
    private readonly email: EmailService,
    private readonly notifications: NotificationService,
    private readonly audit: AuditService,
  ) {}

  get deliveryAvailable(): boolean {
    return Boolean(this.email.provider.capabilities.customFrom && this.env.EMAIL_AGENT_DOMAIN);
  }

  async policy(orgId: string): Promise<CommunicationPolicy & Record<string, unknown>> {
    const { data } = await this.db.from('communication_policies').select('*').eq('organization_id', orgId).maybeSingle<CommunicationPolicy & Record<string, unknown>>();
    return data ?? { ...DEFAULT_COMMUNICATION_POLICY };
  }

  async ensureMailbox(orgId: string, aiEmployeeId: string): Promise<MailboxRow> {
    const { data: existing } = await this.db.from('employee_mailboxes').select('*').eq('ai_employee_id', aiEmployeeId).eq('organization_id', orgId).maybeSingle<MailboxRow>();
    const { data: emp } = await this.db.from('ai_employees').select('name').eq('id', aiEmployeeId).eq('organization_id', orgId).single<{ name: string }>();
    if (!emp) throw notFound('ai_employee_not_found');
    const connected = this.deliveryAvailable;
    const address = connected ? `${slugForMailbox(emp.name, aiEmployeeId)}@${this.env.EMAIL_AGENT_DOMAIN}` : null;
    if (existing) {
      if (connected && existing.status === 'not_connected') {
        return unwrap(await this.db.from('employee_mailboxes').update({ address, provider: this.email.provider.name, status: 'active' }).eq('id', existing.id).select('*').single<MailboxRow>());
      }
      return existing;
    }
    return unwrap(
      await this.db
        .from('employee_mailboxes')
        .insert({ organization_id: orgId, ai_employee_id: aiEmployeeId, display_name: emp.name, address, provider: connected ? this.email.provider.name : 'none', status: connected ? 'active' : 'not_connected' })
        .select('*')
        .single<MailboxRow>(),
    );
  }

  /** Internal addresses: active members' account emails + all AI mailboxes of this organization. */
  private async internalAddresses(orgId: string): Promise<{ internalAddresses: string[]; orgDomains: string[] }> {
    const [{ data: members }, { data: mailboxes }, { data: org }] = await Promise.all([
      this.db.from('organization_members').select('user_id').eq('organization_id', orgId).eq('status', 'active'),
      this.db.from('employee_mailboxes').select('address').eq('organization_id', orgId).not('address', 'is', null),
      this.db.from('organizations').select('company_email').eq('id', orgId).single<{ company_email: string | null }>(),
    ]);
    const ids = ((members ?? []) as Array<{ user_id: string }>).map((m) => m.user_id);
    const { data: profiles } = ids.length ? await this.db.from('profiles').select('email').in('id', ids) : { data: [] };
    const addresses = [
      ...((profiles ?? []) as Array<{ email: string | null }>).map((p) => p.email).filter((e): e is string => Boolean(e)),
      ...((mailboxes ?? []) as Array<{ address: string }>).map((m) => m.address),
    ];
    // The organization's own domain (from its official email) counts as internal, unless it's a public mailbox provider.
    const publicDomains = new Set(['gmail.com', 'hotmail.com', 'outlook.com', 'yahoo.com', 'icloud.com', 'live.com']);
    const orgDomain = org?.company_email?.split('@')[1]?.toLowerCase();
    return { internalAddresses: addresses, orgDomains: orgDomain && !publicDomains.has(orgDomain) ? [orgDomain] : [] };
  }

  /* ----------------------------- AI tools ----------------------------- */

  async aiList(ai: AiActor, query?: string) {
    const mailbox = await this.ensureMailbox(ai.orgId, ai.aiEmployeeId);
    let q = this.db.from('email_messages').select('id, direction, folder, status, from_address, to_addresses, subject, created_at').eq('mailbox_id', mailbox.id).neq('folder', 'archived').order('created_at', { ascending: false }).limit(30);
    if (query) q = q.ilike('subject', `%${query.replace(/[%_\\]/g, (m) => `\\${m}`)}%`);
    return { mailbox: { address: mailbox.address, status: mailbox.status }, messages: (await q).data ?? [] };
  }

  async aiRead(ai: AiActor, messageId: string) {
    const mailbox = await this.ensureMailbox(ai.orgId, ai.aiEmployeeId);
    const { data } = await this.db.from('email_messages').select('*').eq('id', messageId).eq('mailbox_id', mailbox.id).maybeSingle<EmailMessageRow>();
    if (!data) throw notFound('email_not_found');
    return data;
  }

  /** Creates a draft. Attachments must be files the AI employee may read — never private manager files. */
  async aiDraft(ai: AiActor, input: { to: string[]; subject: string; body: string; attachmentIds: string[]; inReplyTo?: string | null; taskId?: string | null; projectId?: string | null }) {
    if (!ai.permissions.has('email.draft')) throw forbidden('ai_permission_denied');
    const mailbox = await this.ensureMailbox(ai.orgId, ai.aiEmployeeId);
    const recipients = classifyRecipients(input.to, await this.internalAddresses(ai.orgId));
    if (recipients.invalid.length) throw badRequest('invalid_recipients');
    const files = await this.validateAttachments(ai, input.attachmentIds);

    let threadId: string | null = null;
    if (input.inReplyTo) {
      const { data: parent } = await this.db.from('email_messages').select('thread_id').eq('id', input.inReplyTo).eq('mailbox_id', mailbox.id).maybeSingle<{ thread_id: string }>();
      if (!parent) throw notFound('email_not_found');
      threadId = parent.thread_id;
    }
    if (!threadId) {
      const thread = unwrap(await this.db.from('email_threads').insert({ organization_id: ai.orgId, mailbox_id: mailbox.id, subject: input.subject.slice(0, 300), task_id: input.taskId ?? null, project_id: input.projectId ?? null }).select('id').single<{ id: string }>());
      threadId = thread.id;
    }
    const msg = unwrap(
      await this.db
        .from('email_messages')
        .insert({
          organization_id: ai.orgId,
          thread_id: threadId,
          mailbox_id: mailbox.id,
          direction: 'outbound',
          folder: 'drafts',
          status: 'draft',
          from_address: mailbox.address ?? `${mailbox.display_name} (not connected)`,
          to_addresses: recipients.valid,
          subject: input.subject.slice(0, 300),
          body_text: input.body.slice(0, 50_000),
          is_external: recipients.external.length > 0,
          risk: recipients.external.length > 0 ? 'high' : 'medium',
          in_reply_to: input.inReplyTo ?? null,
          task_id: input.taskId ?? null,
          project_id: input.projectId ?? null,
          created_by_ai_employee_id: ai.aiEmployeeId,
        })
        .select('*')
        .single<EmailMessageRow>(),
    );
    if (files.length) await this.db.from('email_attachments').insert(files.map((f) => ({ organization_id: ai.orgId, message_id: msg.id, file_id: f.id })));
    await this.audit.audit({ organizationId: ai.orgId, actorType: 'ai', actorAiEmployeeId: ai.aiEmployeeId, action: 'email.drafted', targetType: 'email_message', targetId: msg.id, metadata: { recipients: recipients.valid.length, external: recipients.external.length, attachments: files.length } });
    await this.notifications.notifyRoles(ai.orgId, ['owner', 'admin', 'manager'], { type: 'email_draft_ready', title: `${ai.name}: ${msg.subject}`, link: `/app/workforce/${ai.aiEmployeeId}?tab=mail` });
    return msg;
  }

  private async validateAttachments(ai: AiActor, ids: string[]): Promise<FileRow[]> {
    const unique = [...new Set(ids)];
    if (unique.length === 0) return [];
    if (!ai.permissions.has('email.attach_files')) throw forbidden('missing_permission:email.attach_files');
    if (unique.length > MAX_ATTACHMENTS) throw badRequest('too_many_attachments');
    const { data } = await this.db.from('company_files').select('*').eq('organization_id', ai.orgId).in('id', unique);
    const rows = (data ?? []) as FileRow[];
    // Every attachment must exist in this org AND be readable by this AI (shared or own workspace). Private files: never.
    if (rows.length !== unique.length || rows.some((f) => !aiCanReadFile(ai, f) || f.deleted_at || f.status !== 'ready')) throw forbidden('attachment_not_allowed');
    if (rows.reduce((a, f) => a + Number(f.size), 0) > MAX_ATTACHMENT_BYTES) throw badRequest('attachments_too_large');
    return rows;
  }

  private async sentToday(mailboxId: string): Promise<number> {
    const since = new Date(Date.now() - 86400_000).toISOString();
    const { count } = await this.db.from('email_messages').select('id', { count: 'exact', head: true }).eq('mailbox_id', mailboxId).eq('status', 'sent').gte('sent_at', since);
    return count ?? 0;
  }

  /**
   * AI asks to send a draft. Organization policy decides: send now, require approval, or deny.
   * External recipients, commitments (prices/contracts/guarantees) and attachments to outsiders
   * always go to a human.
   */
  async aiRequestSend(ai: AiActor, messageId: string): Promise<{ decision: SendDecision; message: EmailMessageRow }> {
    const msg = await this.aiRead(ai, messageId);
    if (msg.status !== 'draft') throw conflict('email_not_draft');
    const [policy, internal, { count: attachments }] = await Promise.all([
      this.policy(ai.orgId),
      this.internalAddresses(ai.orgId),
      this.db.from('email_attachments').select('id', { count: 'exact', head: true }).eq('message_id', msg.id),
    ]);
    const recipients = classifyRecipients([...msg.to_addresses, ...msg.cc_addresses], internal);
    const decision = evaluateEmailSend({ policy, autonomy: ai.autonomy, permissions: ai.permissions, recipients, body: msg.body_text, subject: msg.subject, sentToday: await this.sentToday(msg.mailbox_id), hasAttachments: (attachments ?? 0) > 0 });

    if (decision.decision === 'deny') {
      await this.audit.audit({ organizationId: ai.orgId, actorType: 'ai', actorAiEmployeeId: ai.aiEmployeeId, action: 'email.send_denied', targetType: 'email_message', targetId: msg.id, metadata: { reasons: decision.reasons } });
      return { decision, message: msg };
    }
    if (decision.decision === 'needs_approval') {
      const { data: approval } = await this.db
        .from('approvals')
        .insert({ organization_id: ai.orgId, title: `${ai.name}: ${msg.subject}`, description: `To: ${msg.to_addresses.join(', ')}`, approval_type: 'email_send', requested_by_ai_employee_id: ai.aiEmployeeId, session_id: ai.sessionId, task_id: msg.task_id, entity_type: 'email_message', entity_id: msg.id, risk: decision.risk, payload: { reasons: decision.reasons } })
        .select('id')
        .single<{ id: string }>();
      await this.db.from('email_messages').update({ status: 'pending_approval', approval_id: approval?.id ?? null }).eq('id', msg.id);
      await this.db.from('ai_employees').update({ status: 'waiting_email_approval' }).eq('id', ai.aiEmployeeId);
      await this.notifications.notifyRoles(ai.orgId, ['owner', 'admin', 'manager'], { type: 'email_needs_approval', title: `${ai.name}: ${msg.subject}`, body: decision.reasons.join(', '), link: `/app/approvals?id=${approval?.id ?? ''}` });
      return { decision, message: { ...msg, status: 'pending_approval' } };
    }
    const sent = await this.deliver(msg, { aiEmployeeId: ai.aiEmployeeId });
    return { decision, message: sent };
  }

  /** Human sends a draft (Draft-Only mode) or approves a pending email. */
  async humanSend(actor: OrgActor, messageId: string): Promise<EmailMessageRow> {
    if (!actor.permissions.has('approvals.decide')) throw forbidden();
    const { data: msg } = await this.db.from('email_messages').select('*').eq('id', messageId).eq('organization_id', actor.orgId).maybeSingle<EmailMessageRow>();
    if (!msg) throw notFound('email_not_found');
    if (!['draft', 'pending_approval', 'approved', 'failed'].includes(msg.status)) throw conflict('email_not_sendable');
    const policy = await this.policy(actor.orgId);
    if (msg.is_external && !policy.allow_external_email) throw forbidden('external_email_disabled_by_policy');
    await this.audit.audit({ organizationId: actor.orgId, actorType: 'human', actorUserId: actor.userId, action: 'email.approved', targetType: 'email_message', targetId: msg.id });
    return this.deliver(msg, { userId: actor.userId });
  }

  async onApproval(actor: OrgActor, messageId: string, decision: 'approved' | 'rejected' | 'revision_requested', comment: string) {
    if (decision === 'approved') return this.humanSend(actor, messageId);
    await this.db.from('email_messages').update({ status: decision === 'rejected' ? 'rejected' : 'draft', folder: 'drafts', failure_reason: comment || null }).eq('id', messageId).eq('organization_id', actor.orgId);
    return null;
  }

  /** Delivers via the provider with the AI identity disclosure appended. */
  private async deliver(msg: EmailMessageRow, by: { aiEmployeeId?: string; userId?: string }): Promise<EmailMessageRow> {
    const { data: mailbox } = await this.db.from('employee_mailboxes').select('*').eq('id', msg.mailbox_id).single<MailboxRow>();
    if (!mailbox || mailbox.status !== 'active' || !mailbox.address || !this.deliveryAvailable) {
      await this.db.from('email_messages').update({ status: 'failed', failure_reason: 'email_provider_not_connected' }).eq('id', msg.id);
      await this.audit.audit({ organizationId: msg.organization_id, actorType: by.aiEmployeeId ? 'ai' : 'human', actorAiEmployeeId: by.aiEmployeeId ?? null, actorUserId: by.userId ?? null, action: 'email.failed', targetType: 'email_message', targetId: msg.id, metadata: { reason: 'email_provider_not_connected' } });
      throw new AppError(503, 'email_provider_not_connected');
    }
    const [{ data: org }, { data: att }] = await Promise.all([
      this.db.from('organizations').select('name, default_locale').eq('id', msg.organization_id).single<{ name: string; default_locale: 'ar' | 'en' }>(),
      this.db.from('email_attachments').select('file_id, company_files(original_name, storage_key)').eq('message_id', msg.id),
    ]);
    const attachments: Array<{ filename: string; contentBase64: string }> = [];
    for (const a of (att ?? []) as unknown as Array<{ company_files: { original_name: string; storage_key: string } }>) {
      const { data } = await this.db.storage.from(FILES_BUCKET).download(a.company_files.storage_key);
      if (data) attachments.push({ filename: a.company_files.original_name, contentBase64: Buffer.from(await data.arrayBuffer()).toString('base64') });
    }
    const text = msg.body_text + aiDisclosureFooter({ employeeName: mailbox.display_name, companyName: org?.name ?? '', language: org?.default_locale ?? 'ar' });
    await this.db.from('email_messages').update({ status: 'sending' }).eq('id', msg.id);
    const result = await this.email.send({
      to: msg.to_addresses,
      ...(msg.cc_addresses.length ? { cc: msg.cc_addresses } : {}),
      from: `${mailbox.display_name} (AI) <${mailbox.address}>`,
      subject: msg.subject,
      text,
      html: `<div dir="auto" style="font-family:Tahoma,Arial,sans-serif;white-space:pre-wrap">${escapeHtml(text)}</div>`,
      template: 'ai_employee_email',
      ...(attachments.length ? { attachments } : {}),
    });
    const ok = result.status === 'sent';
    const updated = unwrap(
      await this.db
        .from('email_messages')
        .update({ status: ok ? 'sent' : 'failed', folder: ok ? 'sent' : 'drafts', provider_message_id: result.providerMessageId ?? null, failure_reason: ok ? null : (result.error ?? result.status), sent_at: ok ? new Date().toISOString() : null })
        .eq('id', msg.id)
        .select('*')
        .single<EmailMessageRow>(),
    );
    await this.audit.audit({
      organizationId: msg.organization_id,
      actorType: by.aiEmployeeId ? 'ai' : 'human',
      actorAiEmployeeId: by.aiEmployeeId ?? mailbox.ai_employee_id,
      actorUserId: by.userId ?? null,
      action: ok ? 'email.sent' : 'email.failed',
      targetType: 'email_message',
      targetId: msg.id,
      metadata: { sender: mailbox.address, recipients: msg.to_addresses, subject: msg.subject, task_id: msg.task_id, provider_message_id: result.providerMessageId ?? null },
    });
    await this.notifications.notifyRoles(msg.organization_id, ['owner', 'admin', 'manager'], { type: ok ? 'email_sent' : 'email_failed', title: msg.subject, body: ok ? msg.to_addresses.join(', ') : (result.error ?? ''), link: `/app/workforce/${mailbox.ai_employee_id}?tab=mail` });
    if (!ok) throw new AppError(502, 'email_send_failed', result.error);
    return updated;
  }

  /* ----------------------------- manager view ----------------------------- */

  async managerList(actor: OrgActor, aiEmployeeId: string, folder: string) {
    if (!actor.permissions.has('ai.computer.view')) throw forbidden();
    const mailbox = await this.ensureMailbox(actor.orgId, aiEmployeeId);
    let q = this.db.from('email_messages').select('*').eq('mailbox_id', mailbox.id).order('created_at', { ascending: false }).limit(100);
    q = folder === 'tasks' ? q.not('task_id', 'is', null) : q.eq('folder', folder);
    const { data } = await q;
    return { mailbox, delivery_available: this.deliveryAvailable, messages: data ?? [] };
  }

  async archive(actor: OrgActor, messageId: string) {
    if (!actor.permissions.has('ai.control')) throw forbidden();
    await this.db.from('email_messages').update({ folder: 'archived' }).eq('id', messageId).eq('organization_id', actor.orgId);
  }

  /* ----------------------------- inbound ----------------------------- */

  /** Normalized inbound email (from the provider's inbound webhook, authenticated by shared secret). */
  async receive(input: { to: string; from: string; subject: string; text: string; providerMessageId: string | null }) {
    const { data: mailbox } = await this.db.from('employee_mailboxes').select('*').eq('address', normalizeEmail(input.to)).eq('status', 'active').maybeSingle<MailboxRow>();
    if (!mailbox) return { accepted: false };
    const thread = unwrap(await this.db.from('email_threads').insert({ organization_id: mailbox.organization_id, mailbox_id: mailbox.id, subject: input.subject.slice(0, 300) }).select('id').single<{ id: string }>());
    const msg = unwrap(
      await this.db
        .from('email_messages')
        .insert({ organization_id: mailbox.organization_id, thread_id: thread.id, mailbox_id: mailbox.id, direction: 'inbound', folder: 'inbox', status: 'received', from_address: normalizeEmail(input.from), to_addresses: [mailbox.address], subject: input.subject.slice(0, 300), body_text: input.text.slice(0, 100_000), provider_message_id: input.providerMessageId, received_at: new Date().toISOString() })
        .select('id')
        .single<{ id: string }>(),
    );
    await this.db.from('ai_employee_inbox').insert({ organization_id: mailbox.organization_id, ai_employee_id: mailbox.ai_employee_id, item_type: 'agent_message', title: `Email: ${input.subject.slice(0, 200)}`, body: `From ${input.from}`, related_type: 'email_message', related_id: msg.id });
    return { accepted: true, message_id: msg.id };
  }
}
