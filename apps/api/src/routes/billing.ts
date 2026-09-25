import { checkoutSchema, enterpriseOfferCheckoutSchema, verifyPaymentSchema } from '@nexus/shared';
import type { FastifyInstance } from 'fastify';
import { parse } from '../lib/errors.js';
import { actorOf, authenticate, authOf, orgGuard } from '../plugins/auth.js';
import type { Services } from '../services/container.js';

export async function billingRoutes(app: FastifyInstance, s: Services) {
  const unpaid = { preHandler: orgGuard(s, { paid: false, allowSuspended: false }) };

  app.get('/billing', unpaid, async (req) => s.billing.overview(actorOf(req)));

  app.post('/billing/checkout', { ...unpaid, config: { rateLimit: { max: 20, timeWindow: '10 minutes' } } }, async (req) =>
    s.billing.createPlanCheckout(actorOf(req), parse(checkoutSchema, req.body).plan_code),
  );

  app.post('/billing/offer-checkout', { ...unpaid, config: { rateLimit: { max: 20, timeWindow: '10 minutes' } } }, async (req) =>
    s.billing.createOfferCheckout(actorOf(req), parse(enterpriseOfferCheckoutSchema, req.body).offer_id),
  );

  // Called by the frontend after Moyasar redirects back. Activation happens only after server-to-server verification.
  app.post('/billing/verify', { preHandler: authenticate(s), config: { rateLimit: { max: 30, timeWindow: '10 minutes' } } }, async (req) => {
    const body = parse(verifyPaymentSchema, req.body);
    return s.billing.verifyAndActivate(body.transaction_id, body.payment_id, 'callback', authOf(req).userId);
  });

  // Moyasar webhook (no user auth; authenticated by shared secret + re-verification against Moyasar API).
  app.post('/webhooks/moyasar', { config: { rateLimit: { max: 120, timeWindow: '1 minute' } } }, async (req) => {
    await s.billing.handleWebhook(req.body);
    return { ok: true };
  });
}
