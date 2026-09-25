import { createHash } from 'node:crypto';
import { resolvePermissions, type FeatureKey, type HumanRole, type Permission, type PermissionOverride } from '@nexus/shared';
import type { FastifyReply, FastifyRequest, preHandlerAsyncHookHandler } from 'fastify';
import type { AuthUser, OrgActor } from '../context.js';
import { AppError, forbidden, notFound, paymentRequired, unauthorized } from '../lib/errors.js';
import type { Services } from '../services/container.js';
import type { MemberRow, OrganizationRow } from '../types/db.js';

declare module 'fastify' {
  interface FastifyRequest {
    auth?: AuthUser;
    actor?: OrgActor;
  }
}

const TOKEN_CACHE_TTL_MS = 30_000;
const tokenCache = new Map<string, { user: Omit<AuthUser, 'token'>; at: number }>();

function tokenKey(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** Verifies the Supabase JWT with the Auth server (not just locally decoded). */
export async function resolveAuth(services: Services, req: FastifyRequest): Promise<AuthUser> {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) throw unauthorized();
  const token = header.slice(7).trim();
  if (token.length < 20 || token.length > 4096) throw unauthorized();

  const key = tokenKey(token);
  const cached = tokenCache.get(key);
  if (cached && Date.now() - cached.at < TOKEN_CACHE_TTL_MS) return { ...cached.user, token };

  const { data, error } = await services.db.auth.getUser(token);
  if (error || !data.user) throw unauthorized('invalid_token');
  const { data: admin } = await services.db.from('platform_admins').select('user_id').eq('user_id', data.user.id).maybeSingle();
  const user = { userId: data.user.id, email: data.user.email ?? null, isSuperAdmin: Boolean(admin) };
  if (tokenCache.size > 5000) tokenCache.clear();
  tokenCache.set(key, { user, at: Date.now() });
  return { ...user, token };
}

export function authenticate(services: Services): preHandlerAsyncHookHandler {
  return async (req: FastifyRequest) => {
    req.auth = await resolveAuth(services, req);
  };
}

export function requireSuperAdmin(services: Services): preHandlerAsyncHookHandler {
  return async (req: FastifyRequest) => {
    req.auth = await resolveAuth(services, req);
    // super_admin can only be granted directly in the database (platform_admins); never via the API.
    if (!req.auth.isSuperAdmin) throw forbidden('super_admin_required');
  };
}

export interface OrgGuardOptions {
  permission?: Permission | Permission[];
  /** Require an active paid subscription (default true). Expired → 402 immediately; data is untouched. */
  paid?: boolean;
  feature?: FeatureKey;
  allowSuspended?: boolean;
}

export async function loadActor(services: Services, req: FastifyRequest, auth: AuthUser): Promise<OrgActor> {
  const orgId = req.headers['x-organization-id'];
  if (typeof orgId !== 'string' || !/^[0-9a-f-]{36}$/i.test(orgId)) throw new AppError(400, 'organization_header_required');

  const [{ data: member }, { data: org }, { data: overrides }] = await Promise.all([
    services.db.from('organization_members').select('*').eq('organization_id', orgId).eq('user_id', auth.userId).eq('status', 'active').maybeSingle<MemberRow>(),
    services.db.from('organizations').select('*').eq('id', orgId).maybeSingle<OrganizationRow>(),
    services.db.from('organization_role_permissions').select('role, permission, allowed').eq('organization_id', orgId),
  ]);
  // Not a member (or org doesn't exist) → identical 404, so org IDs can't be probed.
  if (!member || !org) throw notFound('organization_not_found');
  if (org.status === 'closed') throw forbidden('organization_closed');

  const billing = await services.entitlements.getBillingState(orgId);
  let perms = resolvePermissions(member.role as HumanRole, (overrides ?? []) as PermissionOverride[]);
  // Advanced (custom) permissions only apply on plans that include them.
  if (!billing.entitlements.features.includes('advanced_permissions')) perms = resolvePermissions(member.role as HumanRole);

  return {
    ...auth,
    orgId,
    orgName: org.name,
    orgStatus: org.status,
    ownerUserId: org.owner_user_id,
    role: member.role,
    memberId: member.id,
    permissions: perms,
    billing,
    ...(req.ip ? { ip: req.ip } : {}),
    ...(typeof req.headers['user-agent'] === 'string' ? { userAgent: req.headers['user-agent'] } : {}),
  };
}

/** Builds the preHandler chain for an organization-scoped route. */
export function orgGuard(services: Services, opts: OrgGuardOptions = {}): preHandlerAsyncHookHandler {
  return async (req: FastifyRequest, _reply: FastifyReply) => {
    const auth = req.auth ?? (await resolveAuth(services, req));
    req.auth = auth;
    const actor = await loadActor(services, req, auth);
    if (actor.orgStatus === 'suspended' && !opts.allowSuspended) throw forbidden('organization_suspended');
    const required = opts.permission ? (Array.isArray(opts.permission) ? opts.permission : [opts.permission]) : [];
    for (const p of required) if (!actor.permissions.has(p)) throw forbidden(`missing_permission:${p}`);
    if (opts.paid !== false && !actor.billing.active) throw paymentRequired('subscription_required');
    if (opts.feature) services.entitlements.assertFeature(actor.billing, opts.feature);
    req.actor = actor;
  };
}

export function actorOf(req: FastifyRequest): OrgActor {
  if (!req.actor) throw unauthorized();
  return req.actor;
}

export function authOf(req: FastifyRequest): AuthUser {
  if (!req.auth) throw unauthorized();
  return req.auth;
}
