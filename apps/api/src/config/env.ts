import { z } from 'zod';

const bool = z
  .enum(['true', 'false', '1', '0'])
  .optional()
  .transform((v) => v === 'true' || v === '1');

const csv = z
  .string()
  .optional()
  .transform((v) => (v ? v.split(',').map((s) => s.trim()).filter(Boolean) : []));

const EnvSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().default(8080),
    HOST: z.string().default('0.0.0.0'),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),

    SUPABASE_URL: z.url(),
    SUPABASE_ANON_KEY: z.string().min(20),
    SUPABASE_SERVICE_ROLE_KEY: z.string().min(20),

    PUBLIC_APP_URL: z.url(),
    API_BASE_URL: z.url(),
    CORS_ALLOWED_ORIGINS: csv,
    AUTH_REDIRECT_URL: z.url(),

    AI_PROVIDER: z.enum(['anthropic', 'mock']).default('anthropic'),
    ANTHROPIC_API_KEY: z.string().optional(),
    AI_DEFAULT_MODEL: z.string().default('claude-opus-5'),
    AI_EFFORT: z.enum(['low', 'medium', 'high', 'xhigh', 'max']).default('medium'),
    USD_TO_SAR_RATE: z.coerce.number().positive().default(3.75),

    COMPUTER_PROVIDER: z.enum(['storage_workspace', 'e2b']).default('storage_workspace'),
    E2B_API_KEY: z.string().optional(),

    MOYASAR_PUBLISHABLE_KEY: z.string().optional(),
    MOYASAR_SECRET_KEY: z.string().optional(),
    MOYASAR_WEBHOOK_SECRET: z.string().optional(),
    MOYASAR_APPLE_PAY_ENABLED: bool,
    MOYASAR_API_BASE: z.url().default('https://api.moyasar.com/v1'),

    EMAIL_PROVIDER: z.enum(['resend', 'console']).default('console'),
    RESEND_API_KEY: z.string().optional(),
    EMAIL_FROM: z.string().default('NEXUS <no-reply@example.com>'),

    PLATFORM_ADMIN_NOTIFICATION_EMAIL: z.email(),
    PLATFORM_COMMERCIAL_REGISTRATION: z.string().regex(/^\d{10}$/),

    MALWARE_SCAN_PROVIDER: z.enum(['none']).default('none'),

    AGENT_WORKER_ENABLED: bool.default(true),
    AGENT_WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(32).default(2),
    AGENT_POLL_INTERVAL_MS: z.coerce.number().int().min(250).default(2000),
    CRON_ENABLED: bool.default(true),
  })
  .superRefine((env, ctx) => {
    if (env.NODE_ENV === 'production') {
      if (env.AI_PROVIDER === 'mock') {
        ctx.addIssue({ code: 'custom', path: ['AI_PROVIDER'], message: 'mock AI provider is not allowed in production' });
      }
      if (env.EMAIL_PROVIDER === 'console') {
        ctx.addIssue({ code: 'custom', path: ['EMAIL_PROVIDER'], message: 'console email provider is not allowed in production' });
      }
      if (!env.PUBLIC_APP_URL.startsWith('https://') || !env.API_BASE_URL.startsWith('https://')) {
        ctx.addIssue({ code: 'custom', path: ['PUBLIC_APP_URL'], message: 'production URLs must use https' });
      }
    }
    if (env.AI_PROVIDER === 'anthropic' && !env.ANTHROPIC_API_KEY) {
      ctx.addIssue({ code: 'custom', path: ['ANTHROPIC_API_KEY'], message: 'required when AI_PROVIDER=anthropic' });
    }
    if (env.EMAIL_PROVIDER === 'resend' && !env.RESEND_API_KEY) {
      ctx.addIssue({ code: 'custom', path: ['RESEND_API_KEY'], message: 'required when EMAIL_PROVIDER=resend' });
    }
    if (env.COMPUTER_PROVIDER === 'e2b' && !env.E2B_API_KEY) {
      ctx.addIssue({ code: 'custom', path: ['E2B_API_KEY'], message: 'required when COMPUTER_PROVIDER=e2b' });
    }
  });

export type Env = z.infer<typeof EnvSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = EnvSchema.safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}\nSee ENV_SETUP.md`);
  }
  return parsed.data;
}

export function isMoyasarConfigured(env: Env): boolean {
  return Boolean(env.MOYASAR_PUBLISHABLE_KEY && env.MOYASAR_SECRET_KEY);
}
