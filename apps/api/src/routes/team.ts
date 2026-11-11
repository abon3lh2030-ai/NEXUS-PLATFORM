import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { parse } from '../lib/errors.js';
import { actorOf, orgGuard } from '../plugins/auth.js';
import type { Services } from '../services/container.js';

/** Manager team overview: people and AI employees, who is working and how far along they are. */
export async function teamRoutes(app: FastifyInstance, s: Services) {
  app.get('/team/overview', { preHandler: orgGuard(s, { permission: 'work.manage' }) }, async (req) => s.team.overview(actorOf(req).orgId));
  app.post('/team/ai-report', { preHandler: orgGuard(s, { permission: 'work.manage' }), config: { rateLimit: { max: 10, timeWindow: '10 minutes' } } }, async (req) => {
    const b = parse(z.object({ language: z.enum(['ar', 'en']).default('ar') }), req.body ?? {});
    return s.team.aiReport(actorOf(req), b.language);
  });
}
