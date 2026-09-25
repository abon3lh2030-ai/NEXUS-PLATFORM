import {
  closeOrganizationSchema,
  logoUploadSchema,
  inviteMemberSchema,
  rolePermissionOverrideSchema,
  updateMemberSchema,
  updateOrganizationSchema,
} from '@nexus/shared';
import type { Permission } from '@nexus/shared';
import type { FastifyInstance } from 'fastify';
import { parse } from '../lib/errors.js';
import { actorOf, orgGuard } from '../plugins/auth.js';
import type { Services } from '../services/container.js';
import { idOf } from './helpers.js';

export async function organizationRoutes(app: FastifyInstance, s: Services) {
  // Organization info & billing stay reachable after expiry so the owner can renew (data is never deleted).
  const unpaid = (permission?: Permission) => ({ preHandler: orgGuard(s, { paid: false, allowSuspended: true, ...(permission ? { permission } : {}) }) });

  app.get('/org', unpaid('org.view'), async (req) => {
    const a = actorOf(req);
    const org = await s.orgs.get(a);
    return {
      organization: org,
      membership: { role: a.role, member_id: a.memberId, permissions: [...a.permissions] },
      billing: { active: a.billing.active, plan_code: a.billing.subscription?.plan_code ?? null, ends_at: a.billing.subscription?.ends_at ?? null, entitlements: a.billing.entitlements },
      ai: { provider: s.ai.name, is_mock: s.ai.isMock, computer_provider: s.computer.name, computer_capabilities: s.computer.capabilities },
    };
  });

  app.patch('/org', unpaid('org.manage'), async (req) => s.orgs.update(actorOf(req), parse(updateOrganizationSchema, req.body)));

  app.post('/org/close', unpaid('org.close'), async (req) => {
    const body = parse(closeOrganizationSchema, req.body);
    await s.orgs.close(actorOf(req), body.confirm_name, body.reason);
    return { ok: true };
  });

  // Company logo (PNG). Upload/remove: org.manage. View: any member (private storage, streamed by the API).
  app.put('/org/logo', { ...unpaid('org.manage'), bodyLimit: 1_600_000 }, async (req) => s.orgs.setLogo(actorOf(req), parse(logoUploadSchema, req.body).data_base64));
  app.delete('/org/logo', unpaid('org.manage'), async (req) => {
    await s.orgs.removeLogo(actorOf(req));
    return { ok: true };
  });
  app.get('/org/logo', unpaid('org.view'), async (req, reply) => {
    const png = await s.orgs.getLogo(actorOf(req));
    if (!png) return reply.code(404).send({ error: 'no_logo' });
    return reply.header('Content-Type', 'image/png').header('X-Content-Type-Options', 'nosniff').header('Cache-Control', 'private, max-age=300').send(png);
  });

  app.get('/org/members', unpaid('members.view'), async (req) => s.orgs.listMembers(actorOf(req)));

  app.patch('/org/members/:id', { preHandler: orgGuard(s, { permission: 'members.manage' }) }, async (req) => s.orgs.updateMember(actorOf(req), idOf(req.params), parse(updateMemberSchema, req.body)));

  app.delete('/org/members/:id', unpaid('members.manage'), async (req) => {
    await s.orgs.removeMember(actorOf(req), idOf(req.params));
    return { ok: true };
  });

  app.get('/org/invitations', unpaid('members.manage'), async (req) => s.orgs.listInvitations(actorOf(req)));

  app.post('/org/invitations', { preHandler: orgGuard(s, { permission: 'members.manage' }), config: { rateLimit: { max: 30, timeWindow: '1 hour' } } }, async (req) => {
    const body = parse(inviteMemberSchema, req.body);
    return s.orgs.invite(actorOf(req), s.entitlements, body.email, body.role);
  });

  app.delete('/org/invitations/:id', unpaid('members.manage'), async (req) => {
    await s.orgs.revokeInvitation(actorOf(req), idOf(req.params));
    return { ok: true };
  });

  app.get('/org/permissions', { preHandler: orgGuard(s, { permission: 'org.manage' }) }, async (req) => s.orgs.getRolePermissions(actorOf(req)));

  app.put('/org/permissions', { preHandler: orgGuard(s, { permission: 'org.manage', feature: 'advanced_permissions' }) }, async (req) => {
    await s.orgs.setRolePermissions(actorOf(req), parse(rolePermissionOverrideSchema, req.body).overrides);
    return { ok: true };
  });
}
