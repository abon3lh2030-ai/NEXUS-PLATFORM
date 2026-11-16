import type { FastifyRequest, preHandlerAsyncHookHandler } from 'fastify';
import { AppError, forbidden, notFound } from '../lib/errors.js';
import type { Services } from '../services/container.js';
import type { FounderActor } from '../services/founder/founder-service.js';
import { resolveAuth } from './auth.js';

declare module 'fastify' {
  interface FastifyRequest {
    founder?: FounderActor & { aal: string; sessionId: string | null; mustChangePassword: boolean };
  }
}

/** Claims of a JWT the Auth server has ALREADY verified (resolveAuth calls auth.getUser first). */
function claimsOf(token: string): { aal?: string; session_id?: string } {
  try {
    return JSON.parse(Buffer.from(token.split('.')[1] ?? '', 'base64url').toString('utf8')) as { aal?: string; session_id?: string };
  } catch {
    return {};
  }
}

/**
 * Founder Portal guard, enforced on the server for every /founder route:
 *   1. a valid Supabase session (verified with the Auth server on EVERY request — no cache),
 *   2. a row in founder_accounts (only creatable with the service role — no sign-up path),
 *   3. two-factor authentication completed in this session (JWT aal2),
 *   4. the initial password already replaced.
 * Non-founders get the same 404 as an unknown route, so the portal's API is not discoverable.
 */
export function founderGuard(s: Services, opts: { allowAal1?: boolean; allowInitialPassword?: boolean } = {}): preHandlerAsyncHookHandler {
  return async (req: FastifyRequest) => {
    const auth = await resolveAuth(s, req, { fresh: true });
    const account = await s.founder.account(auth.userId);
    if (!account) throw notFound('route_not_found');
    const claims = claimsOf(auth.token);
    const aal = claims.aal ?? 'aal1';
    req.auth = auth;
    req.founder = {
      userId: auth.userId, email: auth.email, ip: req.ip, userAgent: typeof req.headers['user-agent'] === 'string' ? req.headers['user-agent'] : undefined,
      aal, sessionId: claims.session_id ?? null, mustChangePassword: account.must_change_password,
    };
    if (aal !== 'aal2' && !opts.allowAal1) throw new AppError(403, 'mfa_required');
    if (aal === 'aal2') await s.founder.noteSession(req.founder, req.founder.sessionId);
    if (account.must_change_password && !opts.allowInitialPassword) throw forbidden('password_change_required');
  };
}

export function founderOf(req: FastifyRequest): NonNullable<FastifyRequest['founder']> {
  if (!req.founder) throw notFound('route_not_found');
  return req.founder;
}
