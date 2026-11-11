import { randomBytes, randomUUID } from 'node:crypto';
import { z } from 'zod';

/**
 * NEXUS internal video meetings. Audio/video flow directly between participants' browsers (WebRTC,
 * peer-to-peer) — no third-party media service and no per-minute cost. This hub only does signaling:
 * it introduces peers to each other and relays connection offers, chat, hand-raise, reactions and live
 * captions inside one meeting room.
 *
 * Every participant sends media to every other one, so a room is capped at MAX_ROOM_PEERS.
 * Rooms live in memory: run the API as a single instance (it is) or move rooms to a shared bus first.
 */

export const MAX_ROOM_PEERS = 6;
const TICKET_TTL_MS = 30_000;
const MAX_MESSAGE_BYTES = 64 * 1024;
/** Per-socket burst allowance; connection setup sends many small ICE messages at once. */
const MAX_MESSAGES_PER_WINDOW = 400;
const WINDOW_MS = 10_000;
export const ROOM_REACTIONS = ['👍', '👏', '😂', '❤️', '🎉', '🤔'] as const;

export interface RoomTicket {
  orgId: string;
  meetingId: string;
  userId: string;
  name: string;
  /** May mute others or remove them from the room (meetings.manage). */
  canModerate: boolean;
  /** Final captions are saved as transcript lines (meeting recording policy allows it). */
  storeCaptions: boolean;
  retentionDays: number;
}

/** The subset of a `ws` WebSocket the hub uses (keeps it testable). */
export interface RoomSocket {
  readonly readyState: number;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  on(event: 'message', cb: (data: unknown) => void): unknown;
  on(event: 'close', cb: () => void): unknown;
}

interface PeerState {
  audio: boolean;
  video: boolean;
  screen: boolean;
  hand: boolean;
}

interface Peer {
  id: string;
  socket: RoomSocket;
  ticket: RoomTicket;
  state: PeerState;
  window: { start: number; count: number };
}

const OPEN = 1;

const incoming = z.discriminatedUnion('type', [
  z.object({ type: z.literal('signal'), to: z.string().max(64), data: z.unknown() }),
  z.object({ type: z.literal('chat'), text: z.string().trim().min(1).max(2000) }),
  z.object({ type: z.literal('state'), audio: z.boolean(), video: z.boolean(), screen: z.boolean(), hand: z.boolean() }),
  z.object({ type: z.literal('reaction'), emoji: z.enum(ROOM_REACTIONS) }),
  z.object({ type: z.literal('caption'), text: z.string().trim().min(1).max(500), final: z.boolean() }),
  z.object({ type: z.literal('moderate'), action: z.enum(['mute', 'remove']), to: z.string().max(64) }),
  z.object({ type: z.literal('ping') }),
]);

export class MeetingRoomHub {
  private readonly tickets = new Map<string, RoomTicket & { expiresAt: number }>();
  private readonly rooms = new Map<string, Map<string, Peer>>();

  constructor(private readonly onFinalCaption: (ticket: RoomTicket, text: string) => Promise<void>) {}

  /** One-time, short-lived ticket minted after the normal authenticated REST checks. */
  issueTicket(ticket: RoomTicket): string {
    const now = Date.now();
    for (const [k, t] of this.tickets) if (t.expiresAt < now) this.tickets.delete(k);
    const id = randomBytes(32).toString('base64url');
    this.tickets.set(id, { ...ticket, expiresAt: now + TICKET_TTL_MS });
    return id;
  }

  redeem(id: string): RoomTicket | null {
    const t = this.tickets.get(id);
    this.tickets.delete(id);
    if (!t || t.expiresAt < Date.now()) return null;
    const { expiresAt: _expiresAt, ...ticket } = t;
    return ticket;
  }

  size(meetingId: string): number {
    return this.rooms.get(meetingId)?.size ?? 0;
  }

  /** Attaches a socket that presented a valid ticket. */
  connect(socket: RoomSocket, ticket: RoomTicket): void {
    const room = this.rooms.get(ticket.meetingId) ?? new Map<string, Peer>();
    if (room.size >= MAX_ROOM_PEERS) {
      this.sendTo(socket, { type: 'error', code: 'room_full', max: MAX_ROOM_PEERS });
      socket.close(4003, 'room_full');
      return;
    }
    this.rooms.set(ticket.meetingId, room);
    const peer: Peer = { id: randomUUID(), socket, ticket, state: { audio: true, video: true, screen: false, hand: false }, window: { start: Date.now(), count: 0 } };

    this.sendTo(socket, {
      type: 'welcome',
      you: { peerId: peer.id, name: ticket.name, canModerate: ticket.canModerate },
      peers: [...room.values()].map((p) => this.describe(p)),
      max: MAX_ROOM_PEERS,
    });
    room.set(peer.id, peer);
    this.broadcast(ticket.meetingId, { type: 'peer-joined', peer: this.describe(peer) }, peer.id);

    socket.on('message', (raw) => void this.onMessage(peer, raw));
    socket.on('close', () => this.leave(peer));
  }

  /** Sends a message to everyone in the room (e.g. an answer from NEXUS AI). */
  broadcast(meetingId: string, msg: Record<string, unknown>, exceptPeerId?: string): void {
    for (const p of this.rooms.get(meetingId)?.values() ?? []) if (p.id !== exceptPeerId) this.sendTo(p.socket, msg);
  }

  private describe(p: Peer) {
    return { peerId: p.id, userId: p.ticket.userId, name: p.ticket.name, state: p.state };
  }

  private leave(peer: Peer): void {
    const room = this.rooms.get(peer.ticket.meetingId);
    if (!room?.delete(peer.id)) return;
    if (room.size === 0) this.rooms.delete(peer.ticket.meetingId);
    else this.broadcast(peer.ticket.meetingId, { type: 'peer-left', peerId: peer.id });
  }

  private sendTo(socket: RoomSocket, msg: Record<string, unknown>): void {
    if (socket.readyState === OPEN) socket.send(JSON.stringify(msg));
  }

  private async onMessage(peer: Peer, raw: unknown): Promise<void> {
    const now = Date.now();
    if (now - peer.window.start > WINDOW_MS) peer.window = { start: now, count: 0 };
    if (++peer.window.count > MAX_MESSAGES_PER_WINDOW) {
      peer.socket.close(4008, 'rate_limited');
      return;
    }
    const text = typeof raw === 'string' ? raw : Buffer.isBuffer(raw) ? raw.toString('utf8') : String(raw);
    if (text.length > MAX_MESSAGE_BYTES) return;
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      return;
    }
    const parsed = incoming.safeParse(json);
    if (!parsed.success) return;
    const msg = parsed.data;
    const room = this.rooms.get(peer.ticket.meetingId);
    if (!room) return;
    // The server stamps who sent what — clients can't speak for someone else.
    const from = { from: peer.id, name: peer.ticket.name };

    switch (msg.type) {
      case 'signal': {
        const target = room.get(msg.to);
        if (target) this.sendTo(target.socket, { type: 'signal', ...from, data: msg.data });
        return;
      }
      case 'chat':
        this.broadcast(peer.ticket.meetingId, { type: 'chat', id: randomUUID(), ...from, text: msg.text, at: new Date().toISOString() });
        return;
      case 'state':
        peer.state = { audio: msg.audio, video: msg.video, screen: msg.screen, hand: msg.hand };
        this.broadcast(peer.ticket.meetingId, { type: 'state', peerId: peer.id, state: peer.state }, peer.id);
        return;
      case 'reaction':
        this.broadcast(peer.ticket.meetingId, { type: 'reaction', ...from, emoji: msg.emoji });
        return;
      case 'caption':
        this.broadcast(peer.ticket.meetingId, { type: 'caption', ...from, text: msg.text, final: msg.final }, peer.id);
        if (msg.final && peer.ticket.storeCaptions) await this.onFinalCaption(peer.ticket, msg.text).catch(() => undefined);
        return;
      case 'moderate': {
        if (!peer.ticket.canModerate) return;
        const target = room.get(msg.to);
        if (!target) return;
        if (msg.action === 'mute') {
          this.sendTo(target.socket, { type: 'muted-by-host', by: peer.ticket.name });
        } else {
          this.sendTo(target.socket, { type: 'removed', by: peer.ticket.name });
          target.socket.close(4004, 'removed');
          this.leave(target);
        }
        return;
      }
      case 'ping':
        this.sendTo(peer.socket, { type: 'pong' });
    }
  }
}
