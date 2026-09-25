import {
  createFolderSchema,
  fileLinkSchema,
  initUploadSchema,
  listFilesQuerySchema,
  moveSchema,
  renameSchema,
} from '@nexus/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { parse } from '../lib/errors.js';
import { actorOf, orgGuard } from '../plugins/auth.js';
import type { Services } from '../services/container.js';
import { idOf, params } from './helpers.js';

export async function fileRoutes(app: FastifyInstance, s: Services) {
  const guard = { preHandler: orgGuard(s) };

  app.get('/files', guard, async (req) => s.files.list(actorOf(req), parse(listFilesQuerySchema, req.query)));
  app.get('/files/recently-viewed', guard, async (req) => s.files.recentlyViewed(actorOf(req)));
  app.get('/files/usage', guard, async (req) => s.files.storageUsage(actorOf(req)));
  app.get('/files/activity', { preHandler: orgGuard(s) }, async (req) => s.files.activity(actorOf(req)));

  app.get('/files/folders', guard, async (req) => {
    const q = parse(z.object({ space: z.enum(['shared', 'private']), parent_id: z.uuid().optional() }), req.query);
    const actor = actorOf(req);
    const [folders, breadcrumbs] = await Promise.all([
      s.files.listFolders(actor, q.space, q.parent_id ?? null),
      q.parent_id ? s.files.breadcrumbs(actor, q.parent_id) : Promise.resolve([]),
    ]);
    return { folders, breadcrumbs };
  });
  app.post('/files/folders', guard, async (req, reply) => reply.code(201).send(await s.files.createFolder(actorOf(req), parse(createFolderSchema, req.body))));
  app.patch('/files/folders/:id', guard, async (req) => s.files.renameFolder(actorOf(req), idOf(req.params), parse(renameSchema, req.body).name));
  app.delete('/files/folders/:id', guard, async (req) => {
    await s.files.deleteFolder(actorOf(req), idOf(req.params));
    return { ok: true };
  });

  // Two-step upload: server authorizes + mints signed upload URL → browser uploads with progress → server verifies content.
  app.post('/files/uploads', { ...guard, config: { rateLimit: { max: 120, timeWindow: '1 minute' } } }, async (req) => s.files.initUpload(actorOf(req), parse(initUploadSchema, req.body)));
  app.post('/files/uploads/:id/complete', guard, async (req) => s.files.completeUpload(actorOf(req), idOf(req.params)));

  app.get('/files/:id', guard, async (req) => s.files.get(actorOf(req), idOf(req.params)));
  app.get('/files/:id/download', guard, async (req) => s.files.getDownloadUrl(actorOf(req), idOf(req.params)));

  app.get('/files/:id/preview', guard, async (req, reply) => {
    const { body, mime } = await s.files.getPreview(actorOf(req), idOf(req.params));
    return reply
      .header('Content-Type', mime.startsWith('text/') || mime === 'application/json' ? `${mime === 'application/json' ? 'text/plain' : mime}; charset=utf-8` : mime)
      .header('X-Content-Type-Options', 'nosniff')
      .header('Content-Security-Policy', "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; sandbox")
      .header('Cache-Control', 'private, no-store')
      .header('Content-Disposition', 'inline')
      .send(body);
  });

  app.patch('/files/:id', guard, async (req) => s.files.rename(actorOf(req), idOf(req.params), parse(renameSchema, req.body).name));
  app.post('/files/:id/move', guard, async (req) => s.files.move(actorOf(req), idOf(req.params), parse(moveSchema, req.body).folder_id ?? null));
  app.delete('/files/:id', guard, async (req) => {
    await s.files.softDelete(actorOf(req), idOf(req.params));
    return { ok: true };
  });
  app.post('/files/:id/restore', guard, async (req) => s.files.restore(actorOf(req), idOf(req.params)));
  app.delete('/files/:id/permanent', guard, async (req) => {
    await s.files.purge(actorOf(req), idOf(req.params));
    return { ok: true };
  });
  app.post('/files/:id/share-copy', guard, async (req) => s.files.sharePrivateCopy(actorOf(req), idOf(req.params), parse(moveSchema, req.body).folder_id ?? null));

  app.get('/files/:id/activity', guard, async (req) => s.files.activity(actorOf(req), idOf(req.params)));

  app.post('/files/:id/links', guard, async (req) => {
    const body = parse(fileLinkSchema, req.body);
    await s.files.link(actorOf(req), idOf(req.params), body.entity_type, body.entity_id);
    return { ok: true };
  });
  app.delete('/files/:id/links', guard, async (req) => {
    const body = parse(fileLinkSchema, req.body);
    await s.files.unlink(actorOf(req), idOf(req.params), body.entity_type, body.entity_id);
    return { ok: true };
  });
  app.get('/files/linked/:entity_type/:entity_id', guard, async (req) => {
    const p = params(z.object({ entity_type: fileLinkSchema.shape.entity_type, entity_id: z.uuid() }), req.params);
    return s.files.listLinked(actorOf(req), p.entity_type, p.entity_id);
  });
}
