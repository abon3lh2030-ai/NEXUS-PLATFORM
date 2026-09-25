import type { Env } from '../../config/env.js';
import type { Db } from '../../lib/supabase.js';
import type { FastifyBaseLogger } from 'fastify';

export interface EmailMessage {
  to: string;
  subject: string;
  html: string;
  text: string;
  template: string;
}

export interface EmailSendResult {
  status: 'sent' | 'failed' | 'skipped_no_provider';
  providerMessageId?: string;
  error?: string;
}

export interface EmailProvider {
  readonly name: string;
  send(message: EmailMessage): Promise<EmailSendResult>;
}

/** Resend (https://resend.com) REST provider. */
export class ResendEmailProvider implements EmailProvider {
  readonly name = 'resend';
  constructor(
    private readonly apiKey: string,
    private readonly from: string,
  ) {}

  async send(message: EmailMessage): Promise<EmailSendResult> {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: this.from, to: [message.to], subject: message.subject, html: message.html, text: message.text }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      return { status: 'failed', error: `resend_${res.status}: ${body.slice(0, 300)}` };
    }
    const json = (await res.json()) as { id?: string };
    return { status: 'sent', ...(json.id ? { providerMessageId: json.id } : {}) };
  }
}

/**
 * Development-only provider: does NOT send email. It logs the message and records
 * `skipped_no_provider` in the outbox so nobody mistakes it for a delivered email.
 */
export class ConsoleEmailProvider implements EmailProvider {
  readonly name = 'console';
  constructor(private readonly log: FastifyBaseLogger) {}
  async send(message: EmailMessage): Promise<EmailSendResult> {
    this.log.warn({ to: message.to, subject: message.subject, template: message.template }, '[email:console] NOT SENT — no email provider configured');
    return { status: 'skipped_no_provider' };
  }
}

export function createEmailProvider(env: Env, log: FastifyBaseLogger): EmailProvider {
  if (env.EMAIL_PROVIDER === 'resend' && env.RESEND_API_KEY) return new ResendEmailProvider(env.RESEND_API_KEY, env.EMAIL_FROM);
  return new ConsoleEmailProvider(log);
}

export class EmailService {
  constructor(
    private readonly provider: EmailProvider,
    private readonly db: Db,
    private readonly log: FastifyBaseLogger,
  ) {}

  /** Sends and records the attempt in email_outbox. Never throws — email failure must not break business flows. */
  async send(message: EmailMessage): Promise<EmailSendResult> {
    const { data: row } = await this.db
      .from('email_outbox')
      .insert({ to_email: message.to, subject: message.subject, template: message.template })
      .select('id')
      .single<{ id: string }>();
    let result: EmailSendResult;
    try {
      result = await this.provider.send(message);
    } catch (err) {
      result = { status: 'failed', error: err instanceof Error ? err.message : 'unknown_error' };
    }
    if (row) {
      await this.db
        .from('email_outbox')
        .update({
          status: result.status,
          provider_message_id: result.providerMessageId ?? null,
          error: result.error ?? null,
          sent_at: result.status === 'sent' ? new Date().toISOString() : null,
        })
        .eq('id', row.id);
    }
    if (result.status === 'failed') this.log.error({ template: message.template, error: result.error }, 'email_send_failed');
    return result;
  }
}
