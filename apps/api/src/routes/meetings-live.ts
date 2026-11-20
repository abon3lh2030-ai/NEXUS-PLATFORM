import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { parse } from '../lib/errors.js';
import { actorOf, orgGuard } from '../plugins/auth.js';
import type { Services } from '../services/container.js';
import { idOf } from './helpers.js';

const roomParams = z.object({ room: z.string().regex(/^m_[0-9a-f-]{36}$/) });

/** Meetings on LiveKit: room + access token, recordings, the LiveKit webhook and the meeting agent's internal API. */
export async function meetingLiveRoutes(app: FastifyInstance, s: Services) {
  /* Members (their own company only — enforced in the service). */
  app.register(async (r) => {
    r.post('/meetings/:id/room/token', { preHandler: orgGuard(s, { permission: 'work.view', feature: 'meetings' }), config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, async (req) => s.livekit.token(actorOf(req), idOf(req.params)));
    r.get('/meetings/:id/recordings', { preHandler: orgGuard(s, { permission: 'meetings.manage', feature: 'meetings' }) }, async (req) => s.livekit.listRecordings(actorOf(req), idOf(req.params)));
    r.get('/meetings/:id/recordings/:recordingId/download', { preHandler: orgGuard(s, { permission: 'meetings.manage', feature: 'meetings' }) }, async (req) => {
      const p = parse(z.object({ id: z.uuid(), recordingId: z.uuid() }), req.params);
      return s.livekit.recordingUrl(actorOf(req), p.id, p.recordingId);
    });
  });

  /* LiveKit webhook: signed JWT over the raw body (Authorization header). */
  app.register(async (w) => {
    w.addContentTypeParser(['application/webhook+json', 'application/json'], { parseAs: 'string', bodyLimit: 256 * 1024 }, (_req, body, done) => done(null, body));
    w.post('/webhooks/livekit', { config: { rateLimit: { max: 600, timeWindow: '1 minute' } } }, async (req) => s.livekit.handleWebhook(String(req.body ?? ''), req.headers.authorization));
  });

  /* Meeting agent worker (shared secret MEETING_AGENT_TOKEN). */
  app.register(async (a) => {
    a.addHook('preHandler', async (req) => s.livekit.assertAgent(req.headers.authorization));
    a.get('/internal/meeting-agent/rooms/:room/context', async (req) => s.livekit.agentContext(parse(roomParams, req.params).room));
    a.post('/internal/meeting-agent/rooms/:room/transcript', { config: { rateLimit: { max: 1200, timeWindow: '1 minute' } } }, async (req) => {
      const b = parse(z.object({ lines: z.array(z.object({ identity: z.string().max(200), text: z.string().max(4000), start_ms: z.number().int().min(0).nullable().optional() })).min(1).max(50) }), req.body);
      return s.livekit.agentTranscript(parse(roomParams, req.params).room, b.lines);
    });
    a.post('/internal/meeting-agent/rooms/:room/ask', { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } }, async (req) => {
      const b = parse(z.object({ question: z.string().trim().min(1).max(2000), asked_by: z.string().max(200).default('') }), req.body);
      return s.livekit.agentAsk(parse(roomParams, req.params).room, b.question, b.asked_by);
    });
  });
}
