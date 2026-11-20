import { createHash } from 'node:crypto';
import { AccessToken, TokenVerifier } from 'livekit-server-sdk';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../../config/env.js';
import type { OrgActor } from '../../context.js';
import type { Db } from '../../lib/supabase.js';
import { matchOwner, normalizeName } from '../communications/office-service.js';
import { expiryFrom, grantFor, identityForMember, LiveKitService, meetingIdFromRoom, memberIdFromIdentity, recordingPath, roomNameFor, type LiveKitClients } from './livekit-service.js';

/* ───────── a tiny in-memory stand-in for the Supabase query builder (only what the service uses) ───────── */

type Row = Record<string, unknown>;
const UNIQUE: Record<string, (a: Row, b: Row) => boolean> = {
  meeting_room_events: (a, b) => a.event_id === b.event_id,
  meeting_rooms: (a, b) => a.meeting_id === b.meeting_id,
  meeting_ai_jobs: (a, b) => a.meeting_id === b.meeting_id && a.kind === b.kind && ['pending', 'running'].includes(String(a.status)) && ['pending', 'running'].includes(String(b.status)),
};
let seq = 0;
function fakeDb(tables: Record<string, Row[]>, storage: { removed: string[] }) {
  const q = (table: string) => {
    const filters: Array<(r: Row) => boolean> = [];
    let op: 'select' | 'insert' | 'update' | 'delete' = 'select';
    let payload: Row | Row[] = {};
    let mode: 'many' | 'single' | 'maybe' = 'many';
    let returning = false;
    let limitN = Infinity;
    const rows = () => (tables[table] ??= []);
    const b = {
      select() { returning = true; return b; },
      insert(p: Row | Row[]) { op = 'insert'; payload = p; return b; },
      update(p: Row) { op = 'update'; payload = p; return b; },
      delete() { op = 'delete'; return b; },
      upsert(p: Row) { op = 'insert'; payload = p; return b; },
      eq(c: string, v: unknown) { filters.push((r) => r[c] === v); return b; },
      neq(c: string, v: unknown) { filters.push((r) => r[c] !== v); return b; },
      in(c: string, v: unknown[]) { filters.push((r) => v.includes(r[c])); return b; },
      is(c: string, v: unknown) { filters.push((r) => (r[c] ?? null) === v); return b; },
      not(c: string, _o: string, v: unknown) { filters.push((r) => (r[c] ?? null) !== v); return b; },
      lt(c: string, v: string) { filters.push((r) => typeof r[c] === 'string' && (r[c] as string) < v); return b; },
      order() { return b; },
      limit(n: number) { limitN = n; return b; },
      single() { mode = 'single'; return b; },
      maybeSingle() { mode = 'maybe'; return b; },
      then(res: (v: { data: unknown; error: { code: string; message: string } | null }) => void) {
        res(run());
      },
    };
    const run = () => {
      const match = (r: Row) => filters.every((f) => f(r));
      let out: Row[] = [];
      if (op === 'insert') {
        for (const p of Array.isArray(payload) ? payload : [payload]) {
          const row = { id: (p.id as string) ?? `00000000-0000-4000-8000-${String(++seq).padStart(12, '0')}`, status: undefined, ...p } as Row;
          if (row.status === undefined) delete row.status;
          if (table === 'meeting_ai_jobs') row.status ??= 'pending';
          if (UNIQUE[table] && rows().some((r) => UNIQUE[table]!(r, row))) return { data: null, error: { code: '23505', message: 'duplicate' } };
          rows().push(row);
          out.push(row);
        }
      } else if (op === 'update') {
        out = rows().filter(match);
        for (const r of out) Object.assign(r, payload);
      } else if (op === 'delete') {
        tables[table] = rows().filter((r) => !match(r));
      } else out = rows().filter(match).slice(0, limitN);
      if (op !== 'select' && !returning) return { data: null, error: null };
      if (mode === 'many') return { data: out, error: null };
      return { data: out[0] ?? null, error: mode === 'single' && !out[0] ? { code: 'PGRST116', message: 'none' } : null };
    };
    return b;
  };
  return {
    from: q,
    storage: { from: () => ({ createSignedUrl: async (p: string) => ({ data: { signedUrl: `https://signed/${p}` }, error: null }), remove: async (p: string[]) => { storage.removed.push(...p); return { data: null, error: null }; } }) },
  } as unknown as Db;
}

/* ───────── fixtures ───────── */

const ORG_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ORG_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const MEETING_A = '11111111-1111-4111-8111-111111111111';
const MEMBER_OWNER = '22222222-2222-4222-8222-222222222222';
const MEMBER_VIEWER = '33333333-3333-4333-8333-333333333333';
const MEMBER_B = '44444444-4444-4444-8444-444444444444';
const AI = '55555555-5555-4555-8555-555555555555';
const KEY = 'APItestkey123';
const SECRET = 'test-secret-that-is-long-enough-for-hmac-signing-0123456789';
const AGENT_TOKEN = 'agent-token-0123456789abcdef0123456789abcdef';

const env = {
  LIVEKIT_URL: 'wss://nexus-test.livekit.cloud', LIVEKIT_API_KEY: KEY, LIVEKIT_API_SECRET: SECRET, LIVEKIT_AGENT_NAME: 'nexus-meeting-agent',
  MEETING_AGENT_TOKEN: AGENT_TOKEN, MEETING_AI_MODEL: 'claude-sonnet-5-5', AI_PROVIDER: 'mock', ANTHROPIC_API_KEY: undefined,
  RECORDING_S3_ENDPOINT: 'https://proj.supabase.co/storage/v1/s3', RECORDING_S3_REGION: 'eu-central-1', RECORDING_S3_ACCESS_KEY_ID: 'ak', RECORDING_S3_SECRET_ACCESS_KEY: 'sk', RECORDING_BUCKET: 'meeting-recordings',
} as unknown as Env;

const actor = (over: Partial<OrgActor> & { perms?: string[] } = {}): OrgActor => ({
  userId: 'u-owner', email: 'owner@a.sa', token: 't', isSuperAdmin: false, orgId: ORG_A, orgName: 'A', orgStatus: 'active', ownerUserId: 'u-owner',
  role: 'owner', memberId: MEMBER_OWNER, permissions: new Set(over.perms ?? ['work.view', 'meetings.manage']), billing: {} as never, ...over,
}) as OrgActor;

let tables: Record<string, Row[]>;
let storage: { removed: string[] };
let clients: { room: { createRoom: ReturnType<typeof vi.fn>; removeParticipant: ReturnType<typeof vi.fn> }; egress: { startRoomCompositeEgress: ReturnType<typeof vi.fn> }; dispatch: { createDispatch: ReturnType<typeof vi.fn> } };
let svc: LiveKitService;
const audit = { audit: vi.fn(async () => undefined) };
const entitlements = { getBillingState: vi.fn(async () => ({})), consume: vi.fn(async () => undefined), aiGate: vi.fn(async () => ({ model: 'x' })) };
const log = { warn: vi.fn(), error: vi.fn(), info: vi.fn() };

function make(e: Env = env) {
  return new LiveKitService(e, fakeDb(tables, storage), {} as never, entitlements as never, audit as never, log as never, clients as unknown as LiveKitClients);
}

beforeEach(() => {
  seq = 0;
  storage = { removed: [] };
  tables = {
    meetings: [
      { id: MEETING_A, organization_id: ORG_A, title: 'Weekly', agenda: '', notes: '', recording_policy: 'audio_and_transcript', deleted_at: null },
    ],
    meeting_participants: [{ meeting_id: MEETING_A, member_id: MEMBER_VIEWER, ai_employee_id: null }, { meeting_id: MEETING_A, member_id: null, ai_employee_id: AI }],
    ai_employees: [{ id: AI, organization_id: ORG_A, name: 'ليان' }],
    ai_employee_permissions: [{ ai_employee_id: AI, organization_id: ORG_A, permissions: ['meetings.join', 'meetings.create_tasks'] }],
    profiles: [{ id: 'u-owner', full_name: 'عبدالله' }, { id: 'u-viewer', full_name: 'سارة' }, { id: 'u-b', full_name: 'Other Co' }],
    organization_members: [{ id: MEMBER_OWNER, organization_id: ORG_A, user_id: 'u-owner' }, { id: MEMBER_VIEWER, organization_id: ORG_A, user_id: 'u-viewer' }, { id: MEMBER_B, organization_id: ORG_B, user_id: 'u-b' }],
    communication_policies: [{ organization_id: ORG_A, meeting_recording: 'audio_and_transcript', transcript_retention_days: 90, recording_retention_days: 7 }],
  };
  clients = {
    room: { createRoom: vi.fn(async () => ({})), removeParticipant: vi.fn(async () => undefined) },
    egress: { startRoomCompositeEgress: vi.fn(async () => ({ egressId: 'EG_1' })) },
    dispatch: { createDispatch: vi.fn(async () => ({})) },
  };
  svc = make();
});

async function signed(body: object) {
  const raw = JSON.stringify(body);
  const at = new AccessToken(KEY, SECRET);
  at.sha256 = createHash('sha256').update(raw).digest('base64');
  return { raw, auth: await at.toJwt() };
}

/* ───────── tests ───────── */

describe('room names and identities', () => {
  it('derives the room only from the meeting id and rejects anything else', () => {
    expect(roomNameFor(MEETING_A)).toBe(`m_${MEETING_A}`);
    expect(meetingIdFromRoom(`m_${MEETING_A}`)).toBe(MEETING_A);
    for (const bad of ['m_x', `room_${MEETING_A}`, `m_${MEETING_A}/../x`, '']) expect(meetingIdFromRoom(bad)).toBeNull();
    expect(memberIdFromIdentity(identityForMember(MEMBER_OWNER))).toBe(MEMBER_OWNER);
    expect(memberIdFromIdentity('agent-AJ_123')).toBeNull();
  });

  it('viewers cannot publish; nobody can record or create rooms from the client', () => {
    expect(grantFor('r', 'viewer', false)).toMatchObject({ canPublish: false, canSubscribe: true, roomAdmin: false, roomRecord: false, roomCreate: false });
    expect(grantFor('r', 'manager', true)).toMatchObject({ canPublish: true, roomAdmin: true, roomRecord: false });
  });

  it('recordings live under the company/meeting path and expire per retention', () => {
    expect(recordingPath(ORG_A, MEETING_A, new Date('2026-11-20T10:00:00Z'))).toMatch(new RegExp(`^${ORG_A}/${MEETING_A}/[A-Za-z0-9._-]+\\.ogg$`));
    expect(expiryFrom(new Date('2026-11-20T00:00:00Z'), 7).toISOString()).toBe('2026-11-27T00:00:00.000Z');
  });
});

describe('room creation and tokens', () => {
  it('issues a token for the member’s own company room with the right grants', async () => {
    const res = await svc.token(actor(), MEETING_A);
    expect(res.room).toBe(`m_${MEETING_A}`);
    expect(clients.room.createRoom).toHaveBeenCalledWith(expect.objectContaining({ name: `m_${MEETING_A}` }));
    const claims = await new TokenVerifier(KEY, SECRET).verify(res.token);
    expect(claims.sub).toBe(`member_${MEMBER_OWNER}`);
    expect(claims.name).toBe('عبدالله');
    expect(claims.video).toMatchObject({ room: `m_${MEETING_A}`, roomJoin: true, canPublish: true, roomAdmin: true, roomRecord: false });
    expect(tables.meeting_rooms).toHaveLength(1);
  });

  it('an invited viewer can join but not publish; an uninvited member is refused', async () => {
    const viewer = actor({ role: 'viewer', memberId: MEMBER_VIEWER, userId: 'u-viewer', perms: ['work.view'] });
    const claims = await new TokenVerifier(KEY, SECRET).verify((await svc.token(viewer, MEETING_A)).token);
    expect(claims.video).toMatchObject({ canPublish: false, roomAdmin: false });
    const uninvited = actor({ role: 'member', memberId: '66666666-6666-4666-8666-666666666666', perms: ['work.view'] });
    await expect(svc.token(uninvited, MEETING_A)).rejects.toMatchObject({ code: 'not_invited_to_meeting' });
  });

  it('another company cannot get a room or token for this meeting (same 404 as not found)', async () => {
    const other = actor({ orgId: ORG_B, memberId: MEMBER_B, userId: 'u-b' });
    await expect(svc.token(other, MEETING_A)).rejects.toMatchObject({ statusCode: 404, code: 'meeting_not_found' });
    expect(clients.room.createRoom).not.toHaveBeenCalled();
    expect(tables.meeting_rooms ?? []).toHaveLength(0);
  });

  it('sends the invited AI employee in once per session', async () => {
    await svc.token(actor(), MEETING_A);
    await svc.token(actor(), MEETING_A);
    expect(clients.dispatch.createDispatch).toHaveBeenCalledTimes(1);
    expect(clients.dispatch.createDispatch).toHaveBeenCalledWith(`m_${MEETING_A}`, 'nexus-meeting-agent', expect.objectContaining({ metadata: expect.stringContaining(AI) }));
    expect(entitlements.consume).toHaveBeenCalledWith(ORG_A, expect.anything(), 'meeting_bot_minutes_per_year', 120);
  });

  it('without the meetings.join permission the AI employee is not sent in', async () => {
    tables.ai_employee_permissions = [{ ai_employee_id: AI, organization_id: ORG_A, permissions: [] }];
    await svc.token(actor(), MEETING_A);
    expect(clients.dispatch.createDispatch).not.toHaveBeenCalled();
  });

  it('refuses clearly when LiveKit is not configured', async () => {
    const off = new LiveKitService({ ...env, LIVEKIT_URL: undefined, LIVEKIT_API_KEY: undefined, LIVEKIT_API_SECRET: undefined } as Env, fakeDb(tables, storage), {} as never, entitlements as never, audit as never, log as never);
    await expect(off.token(actor(), MEETING_A)).rejects.toMatchObject({ statusCode: 503, code: 'meetings_not_configured' });
  });
});

describe('LiveKit webhook', () => {
  beforeEach(async () => {
    await svc.token(actor(), MEETING_A);
  });

  it('rejects unsigned or tampered events', async () => {
    const { raw, auth } = await signed({ id: 'EV_1', event: 'room_started', room: { name: `m_${MEETING_A}` } });
    await expect(svc.handleWebhook(raw, undefined)).rejects.toMatchObject({ statusCode: 401 });
    await expect(svc.handleWebhook(raw.replace('room_started', 'room_finished'), auth)).rejects.toMatchObject({ statusCode: 401 });
  });

  it('room start → recording to the company path; events are idempotent', async () => {
    const ev = await signed({ id: 'EV_1', event: 'room_started', room: { name: `m_${MEETING_A}`, sid: 'RM_1' } });
    await svc.handleWebhook(ev.raw, ev.auth);
    expect(await svc.handleWebhook(ev.raw, ev.auth)).toMatchObject({ ignored: 'duplicate' });
    expect(clients.egress.startRoomCompositeEgress).toHaveBeenCalledTimes(1);
    const [room, output, opts] = clients.egress.startRoomCompositeEgress.mock.calls[0]! as [string, { filepath: string; output: { value: { bucket: string; forcePathStyle: boolean } } }, { audioOnly: boolean }];
    expect(room).toBe(`m_${MEETING_A}`);
    expect(output.filepath.startsWith(`${ORG_A}/${MEETING_A}/`)).toBe(true);
    expect(output.output.value).toMatchObject({ bucket: 'meeting-recordings', forcePathStyle: true });
    expect(opts.audioOnly).toBe(true);
    expect(tables.meeting_rooms![0]).toMatchObject({ status: 'active' });
  });

  it('no recording when the company policy is transcript only', async () => {
    tables.communication_policies![0]!.meeting_recording = 'transcript_only';
    const ev = await signed({ id: 'EV_2', event: 'room_started', room: { name: `m_${MEETING_A}` } });
    await svc.handleWebhook(ev.raw, ev.auth);
    expect(clients.egress.startRoomCompositeEgress).not.toHaveBeenCalled();
  });

  it('egress complete → recording ready with the company retention; room finished → summary queued without an AI key', async () => {
    const start = await signed({ id: 'EV_3', event: 'room_started', room: { name: `m_${MEETING_A}` } });
    await svc.handleWebhook(start.raw, start.auth);
    const eg = await signed({ id: 'EV_4', event: 'egress_ended', egressInfo: { egressId: 'EG_1', roomName: `m_${MEETING_A}`, status: 'EGRESS_COMPLETE', fileResults: [{ size: '2048', duration: '60000000000' }] } });
    await svc.handleWebhook(eg.raw, eg.auth);
    const rec = tables.meeting_recordings![0]!;
    expect(rec).toMatchObject({ status: 'ready', size_bytes: 2048, duration_seconds: 60 });
    const days = (new Date(rec.expires_at as string).getTime() - Date.now()) / 86400_000;
    expect(days).toBeGreaterThan(6.9);
    expect(days).toBeLessThan(7.1);

    const agentIn = await signed({ id: 'EV_5', event: 'participant_joined', room: { name: `m_${MEETING_A}` }, participant: { identity: 'agent-AJ_1', name: 'ليان', kind: 'AGENT' } });
    await svc.handleWebhook(agentIn.raw, agentIn.auth);
    expect(tables.meeting_sessions![0]).toMatchObject({ status: 'in_meeting' });

    const fin = await signed({ id: 'EV_6', event: 'room_finished', room: { name: `m_${MEETING_A}` } });
    await svc.handleWebhook(fin.raw, fin.auth);
    expect(tables.meeting_rooms![0]).toMatchObject({ status: 'ended', agent_dispatched_at: null });
    expect(tables.meeting_sessions![0]).toMatchObject({ status: 'left' });
    expect(tables.meeting_ai_jobs).toEqual([expect.objectContaining({ meeting_id: MEETING_A, status: 'pending' })]);
  });

  it('ignores rooms that are not NEXUS meetings', async () => {
    const ev = await signed({ id: 'EV_7', event: 'room_started', room: { name: 'someone-elses-room' } });
    expect(await svc.handleWebhook(ev.raw, ev.auth)).toMatchObject({ ignored: 'not_a_nexus_room' });
  });
});

describe('meeting agent internal API', () => {
  beforeEach(async () => {
    await svc.token(actor(), MEETING_A);
  });

  it('requires the shared agent token', () => {
    expect(() => svc.assertAgent(undefined)).toThrow();
    expect(() => svc.assertAgent('Bearer wrong')).toThrow();
    expect(() => svc.assertAgent(`Bearer ${AGENT_TOKEN}`)).not.toThrow();
  });

  it('stores live lines with the speaker’s NEXUS name, never another company’s member', async () => {
    await svc.agentTranscript(`m_${MEETING_A}`, [
      { identity: `member_${MEMBER_VIEWER}`, text: 'نبدأ بالمبيعات' },
      { identity: `member_${MEMBER_B}`, text: 'line from another company id' },
      { identity: 'agent', text: 'أنا ليان' },
    ]);
    const lines = tables.meeting_transcripts!;
    expect(lines[0]).toMatchObject({ speaker: 'سارة', speaker_member_id: MEMBER_VIEWER, source: 'livekit', organization_id: ORG_A });
    expect(lines[1]).toMatchObject({ speaker: null, speaker_member_id: null });
    expect(lines[2]).toMatchObject({ speaker: 'ليان', speaker_ai_employee_id: AI });
  });

  it('answers “AI not configured” instead of inventing one without a key', async () => {
    expect(await svc.agentAsk(`m_${MEETING_A}`, 'ما القرارات؟', 'سارة')).toEqual({ answer: null, reason: 'ai_not_configured' });
  });
});

describe('queue and retention', () => {
  it('queued summaries run once the AI key exists', async () => {
    tables.meeting_ai_jobs = [{ id: 'job1', organization_id: ORG_A, meeting_id: MEETING_A, ai_employee_id: AI, status: 'pending', attempts: 0, kind: 'summarize' }];
    expect(await svc.processSummaryQueue()).toBe(0);
    const ready = make({ ...env, AI_PROVIDER: 'anthropic', ANTHROPIC_API_KEY: 'sk-ant-test' } as Env);
    const processed = vi.fn(async () => ({}));
    ready.processMeeting = processed;
    expect(await ready.processSummaryQueue()).toBe(1);
    expect(processed).toHaveBeenCalledWith(ORG_A, MEETING_A, AI, 'claude-sonnet-5-5');
    expect(tables.meeting_ai_jobs[0]).toMatchObject({ status: 'done' });
  });

  it('deletes recordings past retention (file + access)', async () => {
    tables.meeting_recordings = [
      { id: 'r1', organization_id: ORG_A, meeting_id: MEETING_A, storage_path: `${ORG_A}/${MEETING_A}/old.ogg`, status: 'ready', expires_at: '2020-01-01T00:00:00Z' },
      { id: 'r2', organization_id: ORG_A, meeting_id: MEETING_A, storage_path: `${ORG_A}/${MEETING_A}/new.ogg`, status: 'ready', expires_at: '2999-01-01T00:00:00Z' },
    ];
    expect(await svc.purgeExpiredRecordings()).toBe(1);
    expect(storage.removed).toEqual([`${ORG_A}/${MEETING_A}/old.ogg`]);
    expect(tables.meeting_recordings[0]).toMatchObject({ status: 'deleted' });
    expect(tables.meeting_recordings[1]).toMatchObject({ status: 'ready' });
  });
});

describe('linking action items to people', () => {
  const people = [{ memberId: 'm1', name: 'عبدالله فهد' }, { memberId: 'm2', name: 'سارة أحمد' }, { memberId: 'm3', name: 'سارة خالد' }, { memberId: 'm4', name: 'Fahad' }];
  it('matches full names and unique first names across Arabic spelling variants', () => {
    expect(normalizeName('أحمد')).toBe(normalizeName('احمد'));
    expect(matchOwner('عبدالله', people)).toBe('m1');
    expect(matchOwner('المسؤول: سارة احمد', people)).toBe('m2');
    expect(matchOwner('fahad', people)).toBe('m4');
  });
  it('never guesses when ambiguous or unknown', () => {
    expect(matchOwner('سارة', people)).toBeNull();
    expect(matchOwner('محمد', people)).toBeNull();
    expect(matchOwner(null, people)).toBeNull();
  });
});
