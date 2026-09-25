import { describe, expect, it } from 'vitest';
import {
  aiDisclosureFooter,
  aiMeetingDisplayName,
  classifyRecipients,
  DEFAULT_COMMUNICATION_POLICY,
  detectExternalCommitments,
  evaluateEmailSend,
  findFreeSlots,
  type CommunicationPolicy,
} from './index.js';

const ctx = { internalAddresses: ['owner@company.sa', 'atlas.ab12cd@agents.company.sa'], orgDomains: ['company.sa'] };
const perms = (...p: string[]) => new Set(['email.send', ...p]);
const base = (over: Partial<Parameters<typeof evaluateEmailSend>[0]> = {}) =>
  evaluateEmailSend({
    policy: { ...DEFAULT_COMMUNICATION_POLICY, email_send_mode: 'autonomous', allow_external_email: true },
    autonomy: 'autonomous',
    permissions: perms('email.send_external', 'email.attach_files'),
    recipients: classifyRecipients(['owner@company.sa'], ctx),
    body: 'مرحبا، هذا ملخص الاجتماع.',
    subject: 'ملخص',
    sentToday: 0,
    hasAttachments: false,
    ...over,
  });

describe('recipient classification', () => {
  it('separates internal, external and invalid addresses', () => {
    const r = classifyRecipients(['OWNER@company.sa', 'x@partner.com', 'not-an-email', 'someone@company.sa'], ctx);
    expect(r.internal.sort()).toEqual(['owner@company.sa', 'someone@company.sa']);
    expect(r.external).toEqual(['x@partner.com']);
    expect(r.invalid).toEqual(['not-an-email']);
  });
});

describe('AI email send policy', () => {
  it('autonomous + internal + no commitments → send', () => {
    expect(base().decision).toBe('send');
  });
  it('without email.send permission → deny', () => {
    expect(base({ permissions: new Set() }).decision).toBe('deny');
  });
  it('external recipients → deny when policy disallows, approval when allowed', () => {
    const recipients = classifyRecipients(['ceo@partner.com'], ctx);
    expect(base({ recipients, policy: { ...DEFAULT_COMMUNICATION_POLICY, email_send_mode: 'autonomous', allow_external_email: false } })).toMatchObject({ decision: 'deny', reasons: ['external_email_disabled_by_policy'] });
    expect(base({ recipients })).toMatchObject({ decision: 'needs_approval', risk: 'high' });
    expect(base({ recipients, permissions: perms() })).toMatchObject({ decision: 'deny', reasons: ['missing_permission:email.send_external'] });
  });
  it('allow-listed external domain may be sent autonomously', () => {
    const policy: CommunicationPolicy = { ...DEFAULT_COMMUNICATION_POLICY, email_send_mode: 'autonomous', allow_external_email: true, autonomous_external_domains: ['partner.com'] };
    expect(base({ policy, recipients: classifyRecipients(['ceo@partner.com'], ctx) }).decision).toBe('send');
  });
  it('draft-only and approval-required modes never send directly', () => {
    expect(base({ policy: { ...DEFAULT_COMMUNICATION_POLICY, email_send_mode: 'draft_only' } }).decision).toBe('needs_approval');
    expect(base({ policy: { ...DEFAULT_COMMUNICATION_POLICY, email_send_mode: 'approval_required' } }).decision).toBe('needs_approval');
  });
  it('non-autonomous employees always need approval', () => {
    expect(base({ autonomy: 'execute_internal' }).decision).toBe('needs_approval');
  });
  it('commitments (contract, final price, guarantees) always need approval — even internally', () => {
    for (const body of ['نوافق على العقد المرسل.', 'السعر النهائي 100,000 ريال.', 'نضمن التسليم بهذا التاريخ.', 'We agree to the contract terms.', 'Our final price is 90k.']) {
      expect(base({ body })).toMatchObject({ decision: 'needs_approval' });
      expect(detectExternalCommitments(body).length).toBeGreaterThan(0);
    }
    expect(detectExternalCommitments('مرفق ملخص الاجتماع ونقاط المتابعة.')).toEqual([]);
  });
  it('attachments require permission; attachments to outsiders need approval', () => {
    expect(base({ hasAttachments: true, permissions: perms() })).toMatchObject({ decision: 'deny', reasons: ['missing_permission:email.attach_files'] });
    const policy: CommunicationPolicy = { ...DEFAULT_COMMUNICATION_POLICY, email_send_mode: 'autonomous', allow_external_email: true, autonomous_external_domains: ['partner.com'] };
    expect(base({ policy, hasAttachments: true, recipients: classifyRecipients(['a@partner.com'], ctx) }).reasons).toContain('external_attachment');
  });
  it('enforces daily limits, invalid and excessive recipients', () => {
    expect(base({ sentToday: 50 })).toMatchObject({ decision: 'deny', reasons: ['daily_send_limit_reached'] });
    expect(base({ recipients: classifyRecipients(['bad'], ctx) })).toMatchObject({ decision: 'deny', reasons: ['invalid_recipients'] });
    expect(base({ recipients: classifyRecipients(Array.from({ length: 30 }, (_, i) => `u${i}@company.sa`), ctx) })).toMatchObject({ decision: 'deny', reasons: ['too_many_recipients'] });
  });
});

describe('AI identity disclosure', () => {
  it('emails and meeting names always disclose the AI employee', () => {
    expect(aiDisclosureFooter({ employeeName: 'أطلس', companyName: 'شركة', language: 'ar' })).toContain('موظف ذكاء اصطناعي');
    expect(aiDisclosureFooter({ employeeName: 'Atlas', companyName: 'Co', language: 'en' })).toContain('an AI employee');
    expect(aiMeetingDisplayName('Atlas', 'en')).toBe('Atlas (AI Assistant)');
    expect(aiMeetingDisplayName('أطلس', 'ar')).toContain('مساعد ذكاء اصطناعي');
  });
});

describe('calendar free time', () => {
  it('returns slots inside Saudi working hours (Sun–Thu 09–17, UTC+3) avoiding busy ranges', () => {
    // Sunday 2027-01-03 06:00Z = 09:00 Riyadh
    const from = new Date('2027-01-03T06:00:00Z');
    const to = new Date('2027-01-03T14:00:00Z');
    const busy = [{ start: new Date('2027-01-03T06:00:00Z'), end: new Date('2027-01-03T08:00:00Z') }];
    const slots = findFreeSlots({ from, to, durationMin: 60, busy, maxResults: 3 });
    expect(slots[0]!.start.toISOString()).toBe('2027-01-03T08:00:00.000Z');
    expect(slots).toHaveLength(3);
    for (const s of slots) expect(busy.some((b) => b.start < s.end && b.end > s.start)).toBe(false);
  });
  it('skips Friday and Saturday', () => {
    const fri = new Date('2027-01-08T06:00:00Z');
    const slots = findFreeSlots({ from: fri, to: new Date('2027-01-10T14:00:00Z'), durationMin: 30, busy: [], maxResults: 1 });
    expect(slots[0]!.start.toISOString().slice(0, 10)).toBe('2027-01-10'); // Sunday
  });
});
