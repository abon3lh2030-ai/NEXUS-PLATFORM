import { contactSchema, enterpriseRequestSchema } from '@nexus/shared';
import type { FastifyInstance } from 'fastify';
import { parse } from '../lib/errors.js';
import { resolveAuth } from '../plugins/auth.js';
import type { Services } from '../services/container.js';

export async function publicRoutes(app: FastifyInstance, s: Services) {
  app.get('/health', async () => {
    const { error } = await s.db.from('subscription_plans').select('code', { head: true, count: 'exact' });
    return {
      status: error ? 'degraded' : 'ok',
      database: error ? 'unreachable' : 'ok',
      ai_provider: s.ai.name,
      computer_provider: s.computer.name,
      time: new Date().toISOString(),
    };
  });

  // Public pricing — prices come from the database, never hardcoded in the frontend.
  app.get('/plans', async () => {
    const plans = await s.entitlements.listPlans();
    return plans.filter((p) => p.is_public).map(({ is_public: _p, ...rest }) => rest);
  });

  app.post('/public/contact', { config: { rateLimit: { max: 5, timeWindow: '10 minutes' } } }, async (req) => {
    await s.platform.submitContact(parse(contactSchema, req.body));
    return { ok: true };
  });

  app.post('/public/enterprise-requests', { config: { rateLimit: { max: 5, timeWindow: '1 hour' } } }, async (req) => {
    const input = parse(enterpriseRequestSchema, req.body);
    const auth = req.headers.authorization ? await resolveAuth(s, req).catch(() => null) : null;
    return s.platform.submitEnterpriseRequest(auth, input);
  });
}
