import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import Fastify, { type FastifyInstance } from 'fastify';
import type { Env } from './config/env.js';
import { AppError } from './lib/errors.js';
import { adminRoutes } from './routes/admin.js';
import { aiRoutes } from './routes/ai.js';
import { billingRoutes } from './routes/billing.js';
import { fileRoutes } from './routes/files.js';
import { governanceRoutes } from './routes/governance.js';
import { meRoutes } from './routes/me.js';
import { organizationRoutes } from './routes/organization.js';
import { publicRoutes } from './routes/public.js';
import { workRoutes } from './routes/work.js';
import { createServices, type Services } from './services/container.js';

export async function buildApp(env: Env, overrides: Parameters<typeof createServices>[2] = {}): Promise<{ app: FastifyInstance; services: Services }> {
  const app = Fastify({
    logger: {
      level: env.LOG_LEVEL,
      redact: { paths: ['req.headers.authorization', 'req.headers.cookie', 'req.body.secret_token'], censor: '[redacted]' },
      ...(env.NODE_ENV === 'development' ? { transport: { target: 'pino-pretty' } } : {}),
    },
    trustProxy: true,
    bodyLimit: 2 * 1024 * 1024, // files never pass through the API body; they go straight to storage
  });

  const services = createServices(env, app.log, overrides);

  await app.register(helmet, {
    contentSecurityPolicy: { directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] } },
    crossOriginResourcePolicy: { policy: 'cross-origin' },
    hsts: env.NODE_ENV === 'production' ? { maxAge: 31536000, includeSubDomains: true, preload: true } : false,
  });

  const allowed = new Set([env.PUBLIC_APP_URL, ...env.CORS_ALLOWED_ORIGINS]);
  await app.register(cors, {
    origin: (origin, cb) => cb(null, !origin || allowed.has(origin)),
    credentials: false,
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Authorization', 'Content-Type', 'X-Organization-Id'],
    maxAge: 600,
  });

  await app.register(rateLimit, {
    max: 300,
    timeWindow: '1 minute',
    keyGenerator: (req) => (req.headers.authorization ? `u:${req.headers.authorization.slice(-24)}` : `ip:${req.ip}`),
  });

  if (env.NODE_ENV === 'production') {
    app.addHook('onRequest', async (req, reply) => {
      if (req.headers['x-forwarded-proto'] === 'http') {
        return reply.redirect(`https://${req.headers.host}${req.url}`, 301);
      }
    });
  }

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof AppError) {
      return reply.code(err.statusCode).send({ error: err.code, ...(err.details !== undefined ? { details: err.details } : {}) });
    }
    const status = (err as { statusCode?: number }).statusCode;
    if (status === 429) return reply.code(429).send({ error: 'rate_limited' });
    if (status && status >= 400 && status < 500) return reply.code(status).send({ error: 'bad_request' });
    req.log.error({ err }, 'unhandled_error');
    return reply.code(500).send({ error: 'internal_error' });
  });
  app.setNotFoundHandler((_req, reply) => reply.code(404).send({ error: 'route_not_found' }));

  await app.register(async (scope) => publicRoutes(scope, services));
  await app.register(async (scope) => meRoutes(scope, services));
  await app.register(async (scope) => organizationRoutes(scope, services));
  await app.register(async (scope) => workRoutes(scope, services));
  await app.register(async (scope) => fileRoutes(scope, services));
  await app.register(async (scope) => aiRoutes(scope, services));
  await app.register(async (scope) => governanceRoutes(scope, services));
  await app.register(async (scope) => billingRoutes(scope, services));
  await app.register(async (scope) => adminRoutes(scope, services));

  return { app, services };
}
