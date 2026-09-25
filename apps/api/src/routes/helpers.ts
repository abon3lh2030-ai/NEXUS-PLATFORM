import { z } from 'zod';
import { parse } from '../lib/errors.js';

export const idParams = z.object({ id: z.uuid() });
export const localeQuery = z.object({ locale: z.enum(['ar', 'en']).optional().default('ar') });

export function params<T extends z.ZodType>(schema: T, value: unknown): z.infer<T> {
  return parse(schema, value) as z.infer<T>;
}

export function idOf(value: unknown): string {
  return params(idParams, value).id;
}
