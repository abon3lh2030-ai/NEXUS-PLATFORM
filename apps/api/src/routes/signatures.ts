import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { parse } from '../lib/errors.js';
import { actorOf, orgGuard } from '../plugins/auth.js';
import type { Services } from '../services/container.js';
import { MAX_SIGNERS } from '../services/signatures/signature-service.js';
import { idOf } from './helpers.js';

const createSchema = z.object({
  title: z.string().trim().min(1).max(200),
  message: z.string().trim().max(4000).default(''),
  file_id: z.uuid(),
  sequential: z.boolean().default(true),
  due_at: z.iso.datetime({ offset: true }).nullable().optional(),
  signers: z.array(z.object({ member_id: z.uuid(), role: z.enum(['signer', 'approver']).default('signer') })).min(1).max(MAX_SIGNERS),
});

const signSchema = z
  .object({
    method: z.enum(['drawn', 'uploaded']),
    image_base64: z.string().max(800_000).optional(),
    use_saved: z.boolean().optional(),
    save_as_default: z.boolean().optional(),
    consent: z.literal(true),
  })
  .refine((b) => b.use_saved || b.image_base64, { message: 'signature_required' });

const meta = (req: FastifyRequest) => ({ ip: req.ip ?? null, userAgent: typeof req.headers['user-agent'] === 'string' ? req.headers['user-agent'] : null });

/** Internal e-signatures and sign-off requests. */
export async function signatureRoutes(app: FastifyInstance, s: Services) {
  const view = { preHandler: orgGuard(s, { permission: 'work.view' }) };

  app.get('/signatures', view, async (req) => s.signatures.list(actorOf(req)));
  app.post('/signatures', { preHandler: orgGuard(s, { permission: 'documents.create' }), config: { rateLimit: { max: 30, timeWindow: '10 minutes' } } }, async (req, reply) => {
    const b = parse(createSchema, req.body);
    return reply.code(201).send(await s.signatures.create(actorOf(req), { ...b, due_at: b.due_at ?? null }));
  });
  app.get('/signatures/me/saved', view, async (req) => s.signatures.savedSignature(actorOf(req)));
  app.delete('/signatures/me/saved', view, async (req) => {
    await s.signatures.deleteSavedSignature(actorOf(req));
    return { ok: true };
  });
  app.get('/signatures/verify/:code', view, async (req) => s.signatures.verify(actorOf(req), parse(z.object({ code: z.string().trim().min(6).max(20) }), req.params).code));
  app.get('/signatures/:id', view, async (req) => s.signatures.get(actorOf(req), idOf(req.params)));
  app.get('/signatures/:id/document', view, async (req, reply) => {
    const { which } = parse(z.object({ which: z.enum(['original', 'signed']).default('original') }), req.query);
    const doc = await s.signatures.document(actorOf(req), idOf(req.params), which);
    return reply
      .header('Content-Type', 'application/pdf')
      .header('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(doc.name)}`)
      .header('Cache-Control', 'private, no-store')
      .header('X-Content-Type-Options', 'nosniff')
      .send(Buffer.from(doc.bytes));
  });
  app.post('/signatures/:id/sign', { ...view, config: { rateLimit: { max: 20, timeWindow: '10 minutes' } } }, async (req) => s.signatures.sign(actorOf(req), idOf(req.params), parse(signSchema, req.body), meta(req)));
  app.post('/signatures/:id/approve', view, async (req) => s.signatures.approve(actorOf(req), idOf(req.params), meta(req)));
  app.post('/signatures/:id/decline', view, async (req) => s.signatures.decline(actorOf(req), idOf(req.params), parse(z.object({ reason: z.string().trim().min(2).max(2000) }), req.body).reason, meta(req)));
  app.post('/signatures/:id/cancel', view, async (req) => s.signatures.cancel(actorOf(req), idOf(req.params)));
  app.post('/signatures/:id/remind', { ...view, config: { rateLimit: { max: 5, timeWindow: '1 hour' } } }, async (req) => s.signatures.remind(actorOf(req), idOf(req.params)));
  app.post('/signatures/:id/finalize', view, async (req) => s.signatures.finalizeAgain(actorOf(req), idOf(req.params)));
}
