import { describe, expect, it, vi } from 'vitest';
import { MAX_ROOM_PEERS, MeetingRoomHub, type RoomSocket, type RoomTicket } from './meeting-room.js';

class FakeSocket implements RoomSocket {
  readyState = 1;
  sent: Array<Record<string, unknown>> = [];
  closed: { code?: number | undefined; reason?: string | undefined } | null = null;
  private handlers: { message: Array<(d: unknown) => void>; close: Array<() => void> } = { message: [], close: [] };
  send(data: string) {
    this.sent.push(JSON.parse(data) as Record<string, unknown>);
  }
  close(code?: number, reason?: string) {
    if (this.closed) return;
    this.closed = { code, reason };
    this.readyState = 3;
    this.handlers.close.forEach((cb) => cb());
  }
  on(event: 'message' | 'close', cb: ((d: unknown) => void) | (() => void)) {
    (this.handlers[event] as Array<typeof cb>).push(cb);
    return this;
  }
  /** Simulates the browser sending a message. */
  emit(msg: Record<string, unknown>) {
    this.handlers.message.forEach((cb) => cb(JSON.stringify(msg)));
  }
  last(type: string) {
    return [...this.sent].reverse().find((m) => m.type === type);
  }
}

const ticket = (over: Partial<RoomTicket> = {}): RoomTicket => ({ orgId: 'org', meetingId: 'm1', userId: 'u1', name: 'Sara', canModerate: false, storeCaptions: true, retentionDays: 90, ...over });

function join(hub: MeetingRoomHub, over: Partial<RoomTicket> = {}) {
  const s = new FakeSocket();
  hub.connect(s, ticket(over));
  const peerId = (s.last('welcome')!.you as { peerId: string }).peerId;
  return { s, peerId };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe('MeetingRoomHub tickets', () => {
  it('a ticket works once and only for a short time', () => {
    const hub = new MeetingRoomHub(async () => undefined);
    const id = hub.issueTicket(ticket());
    expect(hub.redeem(id)).toMatchObject({ meetingId: 'm1', name: 'Sara' });
    expect(hub.redeem(id)).toBeNull();
    vi.useFakeTimers();
    const late = hub.issueTicket(ticket());
    vi.advanceTimersByTime(31_000);
    expect(hub.redeem(late)).toBeNull();
    vi.useRealTimers();
  });
});

describe('MeetingRoomHub room', () => {
  it('introduces peers and relays a connection offer only to its target, stamped with the sender', () => {
    const hub = new MeetingRoomHub(async () => undefined);
    const a = join(hub, { userId: 'ua', name: 'A' });
    const b = join(hub, { userId: 'ub', name: 'B' });
    const c = join(hub, { userId: 'uc', name: 'C' });
    expect((b.s.last('welcome')!.peers as unknown[]).length).toBe(1);
    expect(a.s.last('peer-joined')).toMatchObject({ peer: { name: 'C' } });

    a.s.emit({ type: 'signal', to: b.peerId, data: { sdp: 'offer' } });
    expect(b.s.last('signal')).toMatchObject({ from: a.peerId, name: 'A', data: { sdp: 'offer' } });
    expect(c.s.last('signal')).toBeUndefined();
  });

  it('chat comes from the server with the real sender name, whatever the client claims', () => {
    const hub = new MeetingRoomHub(async () => undefined);
    const a = join(hub, { name: 'A' });
    const b = join(hub, { name: 'B' });
    a.s.emit({ type: 'chat', text: 'hello', name: 'CEO' });
    expect(b.s.last('chat')).toMatchObject({ from: a.peerId, name: 'A', text: 'hello' });
  });

  it(`admits at most ${MAX_ROOM_PEERS} people`, () => {
    const hub = new MeetingRoomHub(async () => undefined);
    for (let i = 0; i < MAX_ROOM_PEERS; i++) join(hub, { userId: `u${i}` });
    const extra = new FakeSocket();
    hub.connect(extra, ticket({ userId: 'late' }));
    expect(extra.last('error')).toMatchObject({ code: 'room_full' });
    expect(extra.closed?.code).toBe(4003);
    expect(hub.size('m1')).toBe(MAX_ROOM_PEERS);
  });

  it('rooms are separate per meeting', () => {
    const hub = new MeetingRoomHub(async () => undefined);
    const a = join(hub, { meetingId: 'm1' });
    const b = join(hub, { meetingId: 'm2' });
    a.s.emit({ type: 'chat', text: 'secret' });
    expect(b.s.last('chat')).toBeUndefined();
  });

  it('only a moderator can mute or remove someone', () => {
    const hub = new MeetingRoomHub(async () => undefined);
    const host = join(hub, { name: 'Host', canModerate: true });
    const a = join(hub, { name: 'A' });
    const b = join(hub, { name: 'B' });
    a.s.emit({ type: 'moderate', action: 'remove', to: b.peerId });
    expect(b.s.closed).toBeNull();
    host.s.emit({ type: 'moderate', action: 'mute', to: a.peerId });
    expect(a.s.last('muted-by-host')).toMatchObject({ by: 'Host' });
    host.s.emit({ type: 'moderate', action: 'remove', to: b.peerId });
    expect(b.s.closed?.code).toBe(4004);
    expect(a.s.last('peer-left')).toMatchObject({ peerId: b.peerId });
    expect(hub.size('m1')).toBe(2);
  });

  it('stores final captions only when the meeting policy allows transcripts', async () => {
    const saved: string[] = [];
    const hub = new MeetingRoomHub(async (_t, text) => void saved.push(text));
    const a = join(hub, { name: 'A' });
    const b = join(hub, { name: 'B' });
    a.s.emit({ type: 'caption', text: 'جاري', final: false });
    a.s.emit({ type: 'caption', text: 'نبدأ الاجتماع', final: true });
    await flush();
    expect(b.s.last('caption')).toMatchObject({ name: 'A', text: 'نبدأ الاجتماع', final: true });
    expect(saved).toEqual(['نبدأ الاجتماع']);

    const quiet = join(hub, { name: 'Q', meetingId: 'm9', storeCaptions: false });
    quiet.s.emit({ type: 'caption', text: 'not stored', final: true });
    await flush();
    expect(saved).toEqual(['نبدأ الاجتماع']);
  });

  it('ignores malformed messages and disconnects a flooding client', () => {
    const hub = new MeetingRoomHub(async () => undefined);
    const a = join(hub);
    const b = join(hub);
    a.s.emit({ type: 'reaction', emoji: '💣' });
    a.s.emit({ type: 'nope' });
    expect(b.s.last('reaction')).toBeUndefined();
    for (let i = 0; i < 401; i++) a.s.emit({ type: 'ping' });
    expect(a.s.closed?.code).toBe(4008);
  });
});
