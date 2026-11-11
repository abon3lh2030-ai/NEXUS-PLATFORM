import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { parse } from '../lib/errors.js';
import { actorOf, orgGuard } from '../plugins/auth.js';
import type { Services } from '../services/container.js';
import { idOf } from './helpers.js';

/** NEXUS internal video meetings: room access tickets, the signaling socket and NEXUS AI in the room. */
export async function meetingRoomRoutes(app: FastifyInstance, s: Services) {
  const guard = { preHandler: orgGuard(s, { permission: 'work.view', feature: 'meetings' }) };

  app.post('/meetings/:id/room/ticket', { ...guard, config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, async (req) => s.meetingRoom.ticket(actorOf(req), idOf(req.params)));

  app.post('/meetings/:id/room/ask', { preHandler: orgGuard(s, { permission: 'nexus_ai.use', feature: 'meetings' }), config: { rateLimit: { max: 20, timeWindow: '10 minutes' } } }, async (req) => {
    const b = parse(z.object({ question: z.string().trim().min(2).max(1000), language: z.enum(['ar', 'en']).default('ar') }), req.body);
    return s.meetingRoom.ask(actorOf(req), idOf(req.params), b.question, b.language);
  });

  /** Browsers can't set headers on a WebSocket, so it authenticates with the one-time ticket from /room/ticket. */
  app.get('/meetings/room/ws', { websocket: true, config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, (socket, req) => {
    const ticketId = (req.query as Record<string, unknown>).ticket;
    const ticket = typeof ticketId === 'string' && ticketId.length <= 128 ? s.meetingRoom.hub.redeem(ticketId) : null;
    if (!ticket) {
      socket.close(4001, 'invalid_ticket');
      return;
    }
    s.meetingRoom.hub.connect(socket, ticket);
  });
}
