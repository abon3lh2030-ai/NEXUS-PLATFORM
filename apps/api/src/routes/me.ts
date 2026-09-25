import { companyApplicationSchema } from '@nexus/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { parse } from '../lib/errors.js';
import { authenticate, authOf } from '../plugins/auth.js';
import type { Services } from '../services/container.js';
import { idOf } from './helpers.js';

const profilePatch = z.object({
  full_name: z.string().trim().max(120).optional(),
  locale: z.enum(['ar', 'en']).optional(),
  theme: z.enum(['light', 'dark', 'system']).optional(),
});

export async function meRoutes(app: FastifyInstance, s: Services) {
  app.addHook('preHandler', authenticate(s));

  app.get('/me', async (req) => {
    const auth = authOf(req);
    const { data: profile } = await s.db.from('profiles').select('*').eq('id', auth.userId).maybeSingle();
    return { user_id: auth.userId, email: auth.email, is_super_admin: auth.isSuperAdmin, profile, organizations: await s.orgs.listForUser(auth) };
  });

  app.patch('/me', async (req) => {
    const auth = authOf(req);
    const patch = parse(profilePatch, req.body);
    const { data } = await s.db.from('profiles').update(patch).eq('id', auth.userId).select('*').single();
    return data;
  });

  // Saudi company registration → creates the organization (caller becomes owner).
  app.post('/organizations', { config: { rateLimit: { max: 5, timeWindow: '1 hour' } } }, async (req, reply) => {
    const org = await s.orgs.registerCompany(authOf(req), parse(companyApplicationSchema, req.body));
    return reply.code(201).send(org);
  });

  app.post('/invitations/accept', async (req) => {
    const { token } = parse(z.object({ token: z.string().min(20).max(200) }), req.body);
    return s.orgs.acceptInvitation(authOf(req), s.entitlements, token);
  });

  app.get('/me/enterprise-requests', async (req) => s.platform.listMyEnterpriseRequests(authOf(req)));
  app.get('/offers/:id', async (req) => s.platform.getOffer(authOf(req), idOf(req.params)));

  app.get('/notifications', async (req) => {
    const auth = authOf(req);
    const { data } = await s.db.from('notifications').select('*').eq('user_id', auth.userId).order('created_at', { ascending: false }).limit(100);
    return data ?? [];
  });

  app.post('/notifications/read', async (req) => {
    const auth = authOf(req);
    const { ids } = parse(z.object({ ids: z.array(z.uuid()).max(200).optional() }), req.body ?? {});
    let q = s.db.from('notifications').update({ read_at: new Date().toISOString() }).eq('user_id', auth.userId).is('read_at', null);
    if (ids?.length) q = q.in('id', ids);
    await q;
    return { ok: true };
  });
}
