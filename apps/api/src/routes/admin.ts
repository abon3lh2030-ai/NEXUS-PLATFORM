import { adminApplicationDecisionSchema, adminEnterpriseDecisionSchema } from '@nexus/shared';
import type { FastifyInstance } from 'fastify';
import { parse } from '../lib/errors.js';
import { authOf, requireSuperAdmin } from '../plugins/auth.js';
import type { Services } from '../services/container.js';
import { idOf } from './helpers.js';

/**
 * Super admin API. Requires login + a row in platform_admins (only grantable via SQL).
 * NOTE: there is intentionally no endpoint here to read organizations' files — private
 * manager files are not accessible through the operational admin surface.
 */
export async function adminRoutes(app: FastifyInstance, s: Services) {
  app.addHook('preHandler', requireSuperAdmin(s));

  app.get('/admin/dashboard', async () => s.platform.dashboard());
  app.get('/admin/organizations', async () => s.platform.listOrganizations());
  app.get('/admin/applications', async () => s.platform.listApplications());
  app.get('/admin/applications/:id', async (req) => s.platform.getApplication(idOf(req.params)));
  app.post('/admin/applications/:id/decide', async (req) => {
    const body = parse(adminApplicationDecisionSchema, req.body);
    await s.platform.decideApplication(authOf(req), idOf(req.params), body.decision, body.note);
    return { ok: true };
  });
  app.get('/admin/enterprise-requests', async () => s.platform.listEnterpriseRequests());
  app.get('/admin/enterprise-requests/:id', async (req) => s.platform.getEnterpriseRequest(idOf(req.params)));
  app.post('/admin/enterprise-requests/:id/decide', async (req) => {
    const body = parse(adminEnterpriseDecisionSchema, req.body);
    return s.platform.decideEnterprise(authOf(req), idOf(req.params), body);
  });
  app.get('/admin/payments', async () => s.platform.listPayments());
}
