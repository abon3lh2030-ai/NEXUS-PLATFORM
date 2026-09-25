import { timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { AppError } from '../../lib/errors.js';

/** Subset of the Moyasar payment object we rely on (https://docs.moyasar.com/api/payments). */
export const moyasarPaymentSchema = z.object({
  id: z.string(),
  status: z.string(),
  amount: z.number().int(),
  currency: z.string(),
  description: z.string().nullable().optional(),
  metadata: z.record(z.string(), z.unknown()).nullable().optional(),
  source: z
    .object({
      type: z.string().optional(),
      company: z.string().nullable().optional(),
      number: z.string().nullable().optional(),
      message: z.string().nullable().optional(),
    })
    .partial()
    .nullable()
    .optional(),
});
export type MoyasarPayment = z.infer<typeof moyasarPaymentSchema>;

export class MoyasarClient {
  constructor(
    private readonly secretKey: string,
    private readonly apiBase: string,
  ) {}

  /** Fetches the authoritative payment state from Moyasar with the SECRET key (server-side only). */
  async getPayment(paymentId: string): Promise<MoyasarPayment> {
    if (!/^[a-zA-Z0-9_-]{8,100}$/.test(paymentId)) throw new AppError(400, 'invalid_payment_id');
    const res = await fetch(`${this.apiBase}/payments/${encodeURIComponent(paymentId)}`, {
      headers: { Authorization: `Basic ${Buffer.from(`${this.secretKey}:`).toString('base64')}`, Accept: 'application/json' },
      signal: AbortSignal.timeout(15_000),
    });
    if (res.status === 404) throw new AppError(404, 'payment_not_found');
    if (!res.ok) throw new AppError(502, 'payment_provider_error', `moyasar_${res.status}`);
    const parsed = moyasarPaymentSchema.safeParse(await res.json());
    if (!parsed.success) throw new AppError(502, 'payment_provider_invalid_response');
    return parsed.data;
  }
}

export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

/** Extract only non-sensitive fields worth keeping (masked number, brand). Never store full PAN/CVV. */
export function safePaymentMetadata(p: MoyasarPayment): Record<string, unknown> {
  const masked = p.source?.number ? p.source.number.replace(/\d(?=\d{4})/g, 'X') : null;
  return { source_type: p.source?.type ?? null, company: p.source?.company ?? null, masked_number: masked, message: p.source?.message ?? null };
}
