import type { ZodType } from 'zod';

export class AppError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message?: string,
    public readonly details?: unknown,
  ) {
    super(message ?? code);
    this.name = 'AppError';
  }
}

export const badRequest = (code: string, details?: unknown) => new AppError(400, code, code, details);
export const unauthorized = (code = 'unauthorized') => new AppError(401, code);
export const paymentRequired = (code = 'subscription_required', details?: unknown) => new AppError(402, code, code, details);
export const forbidden = (code = 'forbidden') => new AppError(403, code);
export const notFound = (code = 'not_found') => new AppError(404, code);
export const conflict = (code: string) => new AppError(409, code);
export const tooLarge = (code: string, details?: unknown) => new AppError(413, code, code, details);
export const serviceUnavailable = (code: string) => new AppError(503, code);

/** Validate untrusted input with Zod; throws a 400 with field issues on failure. */
export function parse<T>(schema: ZodType<T>, data: unknown): T {
  const result = schema.safeParse(data);
  if (!result.success) {
    throw new AppError(
      400,
      'validation_failed',
      'validation_failed',
      result.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    );
  }
  return result.data;
}

/** Unwrap a Supabase response, converting DB errors into AppErrors without leaking internals. */
export function unwrap<T>(res: { data: T | null; error: { message: string; code?: string } | null }, notFoundCode?: string): T {
  if (res.error) {
    if (res.error.code === '23505') throw conflict('already_exists');
    if (res.error.code === '23503') throw badRequest('invalid_reference');
    if (res.error.code === '23514') throw badRequest('constraint_violation');
    throw new AppError(500, 'database_error', res.error.message);
  }
  if (res.data === null) {
    if (notFoundCode) throw notFound(notFoundCode);
    throw notFound();
  }
  return res.data;
}
