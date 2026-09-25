/**
 * Communication safety rules (pure, unit-tested). Used by the email service, meeting tools and
 * the agent runtime. The model can never override these — it only proposes content.
 */

export type EmailSendMode = 'draft_only' | 'approval_required' | 'autonomous';

export interface CommunicationPolicy {
  email_send_mode: EmailSendMode;
  allow_external_email: boolean;
  autonomous_external_domains: string[];
  daily_send_limit_per_employee: number;
}

export const DEFAULT_COMMUNICATION_POLICY: CommunicationPolicy = {
  email_send_mode: 'approval_required',
  allow_external_email: false,
  autonomous_external_domains: [],
  daily_send_limit_per_employee: 50,
};

const EMAIL_RE = /^[^\s@<>()[\]\\,;:"]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+$/;

export function normalizeEmail(v: string): string {
  return v.trim().toLowerCase();
}

export function isValidEmail(v: string): boolean {
  return v.length <= 254 && EMAIL_RE.test(v.trim());
}

export function domainOf(email: string): string {
  return normalizeEmail(email).split('@')[1] ?? '';
}

export interface RecipientClassification {
  valid: string[];
  invalid: string[];
  internal: string[];
  external: string[];
}

/**
 * Internal = an address of an active organization member, an AI employee mailbox of the same
 * organization, or on one of the organization's own verified domains.
 */
export function classifyRecipients(recipients: string[], ctx: { internalAddresses: string[]; orgDomains: string[] }): RecipientClassification {
  const internalSet = new Set(ctx.internalAddresses.map(normalizeEmail));
  const domains = new Set(ctx.orgDomains.map((d) => d.toLowerCase()));
  const out: RecipientClassification = { valid: [], invalid: [], internal: [], external: [] };
  for (const raw of [...new Set(recipients.map(normalizeEmail))]) {
    if (!isValidEmail(raw)) {
      out.invalid.push(raw);
      continue;
    }
    out.valid.push(raw);
    if (internalSet.has(raw) || domains.has(domainOf(raw))) out.internal.push(raw);
    else out.external.push(raw);
  }
  return out;
}

/**
 * Detects statements that would commit the company legally, financially or contractually.
 * These ALWAYS require human approval before leaving the organization.
 */
const COMMITMENT_PATTERNS: RegExp[] = [
  /نوافق\s+على\s+(العقد|الاتفاقية|العرض|الشروط)/,
  /(نعتمد|اعتمدنا)\s+(العقد|الاتفاقية|السعر)/,
  /السعر\s+(النهائي|المعتمد)/,
  /(نضمن|نتعهد|نلتزم)\s/,
  /(ملزم|التزام)\s+(قانوني|تعاقدي|مالي)/,
  /(خصم|تخفيض)\s+(نهائي|بنسبة)/,
  /\bwe\s+(agree|accept)\s+(to\s+)?(the\s+)?(contract|agreement|terms|offer|price)/i,
  /\bfinal\s+price\b/i,
  /\bwe\s+(guarantee|commit|promise)\b/i,
  /\b(legally|contractually)\s+binding\b/i,
  /\bsigned?\s+(the\s+)?(contract|agreement)\b/i,
];

export function detectExternalCommitments(text: string): string[] {
  return COMMITMENT_PATTERNS.filter((re) => re.test(text)).map((re) => re.source);
}

export interface SendEvaluationInput {
  policy: CommunicationPolicy;
  autonomy: 'suggest' | 'draft' | 'execute_internal' | 'autonomous';
  permissions: Set<string>;
  recipients: RecipientClassification;
  body: string;
  subject: string;
  sentToday: number;
  hasAttachments: boolean;
}

export type SendDecision =
  | { decision: 'send'; risk: 'low' | 'medium' | 'high'; reasons: string[] }
  | { decision: 'needs_approval'; risk: 'low' | 'medium' | 'high'; reasons: string[] }
  | { decision: 'deny'; risk: 'low' | 'medium' | 'high'; reasons: string[] };

/** Decides whether an AI-authored email may be sent now, needs approval, or is denied. */
export function evaluateEmailSend(i: SendEvaluationInput): SendDecision {
  const reasons: string[] = [];
  const external = i.recipients.external.length > 0;
  const risk: 'low' | 'medium' | 'high' = external ? 'high' : 'medium';

  if (!i.permissions.has('email.send')) return { decision: 'deny', risk, reasons: ['missing_permission:email.send'] };
  if (i.recipients.invalid.length) return { decision: 'deny', risk, reasons: ['invalid_recipients'] };
  if (i.recipients.valid.length === 0) return { decision: 'deny', risk, reasons: ['no_recipients'] };
  if (i.recipients.valid.length > 25) return { decision: 'deny', risk, reasons: ['too_many_recipients'] };
  if (external && !i.policy.allow_external_email) return { decision: 'deny', risk, reasons: ['external_email_disabled_by_policy'] };
  if (external && !i.permissions.has('email.send_external')) return { decision: 'deny', risk, reasons: ['missing_permission:email.send_external'] };
  if (i.hasAttachments && !i.permissions.has('email.attach_files')) return { decision: 'deny', risk, reasons: ['missing_permission:email.attach_files'] };
  if (i.sentToday >= i.policy.daily_send_limit_per_employee) return { decision: 'deny', risk, reasons: ['daily_send_limit_reached'] };

  if (i.policy.email_send_mode === 'draft_only') reasons.push('policy_draft_only');
  if (i.policy.email_send_mode === 'approval_required') reasons.push('policy_approval_required');
  if (i.autonomy !== 'autonomous') reasons.push(`autonomy_${i.autonomy}`);
  const commitments = detectExternalCommitments(`${i.subject}\n${i.body}`);
  if (commitments.length) reasons.push('external_commitment_detected');
  if (external) {
    const allowed = new Set(i.policy.autonomous_external_domains.map((d) => d.toLowerCase()));
    if (!i.recipients.external.every((r) => allowed.has(domainOf(r)))) reasons.push('external_recipient_requires_approval');
    if (i.hasAttachments) reasons.push('external_attachment');
  }
  return reasons.length ? { decision: 'needs_approval', risk, reasons } : { decision: 'send', risk, reasons };
}

/** Appended to every AI-sent email: the recipient must always know it's an AI employee. */
export function aiDisclosureFooter(opts: { employeeName: string; companyName: string; language: 'ar' | 'en' }): string {
  return opts.language === 'ar'
    ? `\n\n—\nأُرسلت هذه الرسالة بواسطة ${opts.employeeName}، موظف ذكاء اصطناعي لدى ${opts.companyName} عبر منصة NEXUS.`
    : `\n\n—\nThis message was sent by ${opts.employeeName}, an AI employee at ${opts.companyName}, via the NEXUS platform.`;
}

export function aiMeetingDisplayName(employeeName: string, language: 'ar' | 'en'): string {
  return language === 'ar' ? `${employeeName} (مساعد ذكاء اصطناعي)` : `${employeeName} (AI Assistant)`;
}

export interface TimeRange {
  start: Date;
  end: Date;
}

/**
 * Finds the first free slots of `durationMin` within [from, to), considering busy ranges,
 * working hours (Sun–Thu, 09:00–17:00 in the given UTC offset — Saudi Arabia is UTC+3) and
 * a 15-minute grid.
 */
export function findFreeSlots(opts: { from: Date; to: Date; durationMin: number; busy: TimeRange[]; maxResults?: number; utcOffsetHours?: number; workStartHour?: number; workEndHour?: number; workDays?: number[] }): TimeRange[] {
  const offset = (opts.utcOffsetHours ?? 3) * 3600_000;
  const startH = opts.workStartHour ?? 9;
  const endH = opts.workEndHour ?? 17;
  const workDays = opts.workDays ?? [0, 1, 2, 3, 4]; // Sun..Thu
  const step = 15 * 60_000;
  const dur = opts.durationMin * 60_000;
  const busy = [...opts.busy].sort((a, b) => a.start.getTime() - b.start.getTime());
  const results: TimeRange[] = [];
  let t = Math.ceil(opts.from.getTime() / step) * step;
  while (t + dur <= opts.to.getTime() && results.length < (opts.maxResults ?? 5)) {
    const local = new Date(t + offset);
    const day = local.getUTCDay();
    const minutes = local.getUTCHours() * 60 + local.getUTCMinutes();
    const endMinutes = minutes + opts.durationMin;
    const inHours = workDays.includes(day) && minutes >= startH * 60 && endMinutes <= endH * 60;
    const overlaps = busy.some((b) => b.start.getTime() < t + dur && b.end.getTime() > t);
    if (inHours && !overlaps) {
      results.push({ start: new Date(t), end: new Date(t + dur) });
      t += dur;
    } else {
      t += step;
    }
  }
  return results;
}
