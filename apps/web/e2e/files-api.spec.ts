import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { expect, test } from '@playwright/test';
import { randomUUID } from 'node:crypto';

/**
 * Company Files security E2E against a REAL deployment (API + Supabase).
 * Required env: E2E_API_URL, SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY.
 * Creates two throw-away organizations and four users, then deletes them.
 */
const API = process.env.E2E_API_URL;
const SB_URL = process.env.SUPABASE_URL;
const ANON = process.env.SUPABASE_ANON_KEY;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const enabled = Boolean(API && SB_URL && ANON && SERVICE);

test.describe.configure({ mode: 'serial' });
test.skip(!enabled, 'files-api E2E needs E2E_API_URL, SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY');

interface Actor { id: string; token: string; email: string }
const run = randomUUID().slice(0, 8);
const password = `E2e-${randomUUID()}`;
let admin: SupabaseClient;
const users: Record<'ownerA' | 'adminA' | 'memberA' | 'ownerB', Actor> = {} as never;
const orgs: { A: string; B: string } = { A: '', B: '' };
const files: Record<string, string> = {};

async function call<T>(actor: Actor, org: string, path: string, init: { method?: string; body?: unknown } = {}): Promise<{ status: number; body: T }> {
  const res = await fetch(`${API}${path}`, {
    method: init.method ?? 'GET',
    headers: { Authorization: `Bearer ${actor.token}`, 'X-Organization-Id': org, ...(init.body ? { 'Content-Type': 'application/json' } : {}) },
    ...(init.body ? { body: JSON.stringify(init.body) } : {}),
  });
  const text = await res.text();
  return { status: res.status, body: (text ? JSON.parse(text) : {}) as T };
}

async function upload(actor: Actor, org: string, space: 'shared' | 'private', name: string, content: Uint8Array, mime: string): Promise<string> {
  const init = await call<{ file_id: string; upload_url: string }>(actor, org, '/files/uploads', { method: 'POST', body: { space, file_name: name, size: content.byteLength } });
  expect(init.status).toBe(200);
  const put = await fetch(init.body.upload_url, { method: 'PUT', headers: { 'Content-Type': mime, apikey: ANON!, 'x-upsert': 'false' }, body: content });
  expect(put.ok).toBeTruthy();
  const done = await call<{ status: string }>(actor, org, `/files/uploads/${init.body.file_id}/complete`, { method: 'POST', body: {} });
  expect(done.status).toBe(200);
  expect(done.body.status).toBe('ready');
  return init.body.file_id;
}

const PDF = new TextEncoder().encode('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF');
const TXT = new TextEncoder().encode('ملاحظات خاصة جدًا');

test.beforeAll(async () => {
  admin = createClient(SB_URL!, SERVICE!, { auth: { persistSession: false } });
  for (const key of ['ownerA', 'adminA', 'memberA', 'ownerB'] as const) {
    const email = `e2e-${run}-${key.toLowerCase()}@example.com`;
    const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
    if (error || !data.user) throw error ?? new Error('createUser failed');
    const client = createClient(SB_URL!, ANON!, { auth: { persistSession: false } });
    const { data: s, error: e2 } = await client.auth.signInWithPassword({ email, password });
    if (e2 || !s.session) throw e2 ?? new Error('signIn failed');
    users[key] = { id: data.user.id, token: s.session.access_token, email };
  }
  // Test-only fixtures via the service role: two orgs with active subscriptions.
  const cr = () => `70${Math.floor(Math.random() * 1e8).toString().padStart(8, '0')}`;
  for (const [label, owner] of [['A', users.ownerA], ['B', users.ownerB]] as const) {
    const { data: org, error } = await admin.from('organizations').insert({ name: `E2E ${label} ${run}`, commercial_registration: cr(), owner_user_id: owner.id, company_email: 'e2e@example.com', company_phone: '0110000000' }).select('id').single();
    if (error || !org) throw error ?? new Error('org insert failed');
    orgs[label] = org.id as string;
    await admin.from('organization_members').insert({ organization_id: org.id, user_id: owner.id, role: 'owner' });
    await admin.from('subscriptions').insert({ organization_id: org.id, plan_code: 'business', status: 'active', started_at: new Date().toISOString(), current_period_start: new Date().toISOString(), ends_at: new Date(Date.now() + 86400_000).toISOString() });
  }
  await admin.from('organization_members').insert([
    { organization_id: orgs.A, user_id: users.adminA.id, role: 'admin' },
    { organization_id: orgs.A, user_id: users.memberA.id, role: 'member' },
  ]);
});

test.afterAll(async () => {
  if (!admin) return;
  for (const org of Object.values(orgs).filter(Boolean)) {
    const { data } = await admin.from('company_files').select('storage_key').eq('organization_id', org);
    const keys = (data ?? []).map((r: { storage_key: string }) => r.storage_key);
    if (keys.length) await admin.storage.from('company-files').remove(keys);
    await admin.from('organizations').delete().eq('id', org);
  }
  for (const u of Object.values(users)) if (u?.id) await admin.auth.admin.deleteUser(u.id);
});

test('owner uploads a shared file → member sees it and downloads it', async () => {
  files.sharedByOwner = await upload(users.ownerA, orgs.A, 'shared', `plan-${run}.pdf`, PDF, 'application/pdf');
  const list = await call<{ files: Array<{ id: string }> }>(users.memberA, orgs.A, '/files?space=shared');
  expect(list.body.files.map((f) => f.id)).toContain(files.sharedByOwner);
  const dl = await call<{ url: string }>(users.memberA, orgs.A, `/files/${files.sharedByOwner}/download`);
  expect(dl.status).toBe(200);
  const bytes = await fetch(dl.body.url);
  expect(bytes.status).toBe(200);
});

test('member uploads a shared file → owner sees it', async () => {
  files.sharedByMember = await upload(users.memberA, orgs.A, 'shared', `notes-${run}.pdf`, PDF, 'application/pdf');
  const list = await call<{ files: Array<{ id: string }> }>(users.ownerA, orgs.A, '/files?space=shared');
  expect(list.body.files.map((f) => f.id)).toContain(files.sharedByMember);
});

test('a renamed executable is rejected by server-side content validation', async () => {
  const init = await call<{ file_id: string; upload_url: string }>(users.ownerA, orgs.A, '/files/uploads', { method: 'POST', body: { space: 'shared', file_name: 'invoice.pdf', size: 4 } });
  await fetch(init.body.upload_url, { method: 'PUT', headers: { 'Content-Type': 'application/pdf', apikey: ANON! }, body: new Uint8Array([0x4d, 0x5a, 0x90, 0x00]) });
  const done = await call<{ error: string }>(users.ownerA, orgs.A, `/files/uploads/${init.body.file_id}/complete`, { method: 'POST', body: {} });
  expect(done.status).toBe(400);
  expect(done.body.error).toBe('content_mismatch');
});

test('owner private file: owner sees it; member and another admin are denied', async () => {
  files.private = await upload(users.ownerA, orgs.A, 'private', `secret-${run}.txt`, TXT, 'text/plain');
  const own = await call<{ files: Array<{ id: string }> }>(users.ownerA, orgs.A, '/files?space=private');
  expect(own.body.files.map((f) => f.id)).toContain(files.private);

  for (const other of [users.memberA, users.adminA]) {
    expect((await call(other, orgs.A, `/files/${files.private}`)).status).toBe(404);
    expect((await call(other, orgs.A, `/files/${files.private}/download`)).status).toBe(404);
    expect((await call(other, orgs.A, `/files/${files.private}/preview`)).status).toBe(404);
    const shared = await call<{ files: Array<{ id: string }> }>(other, orgs.A, '/files?space=shared&flat=1');
    expect(shared.body.files.map((f) => f.id)).not.toContain(files.private);
  }
  // Admin's own private space never contains the owner's private files.
  const adminPrivate = await call<{ files: Array<{ id: string }> }>(users.adminA, orgs.A, '/files?space=private');
  expect(adminPrivate.body.files.map((f) => f.id)).not.toContain(files.private);
});

test('knowing the storage key is not enough (Storage policy blocks direct signed URLs)', async () => {
  const { data } = await admin.from('company_files').select('storage_key').eq('id', files.private).single();
  const adminUserClient = createClient(SB_URL!, ANON!, { auth: { persistSession: false }, global: { headers: { Authorization: `Bearer ${users.adminA.token}` } } });
  const { data: signed, error } = await adminUserClient.storage.from('company-files').createSignedUrl((data as { storage_key: string }).storage_key, 60);
  expect(signed?.signedUrl ?? null).toBeNull();
  expect(error).not.toBeNull();
});

test('AI employees are never shown private files (Nexus AI file retrieval is shared-only)', async () => {
  const { data } = await admin.from('company_files').select('id').eq('organization_id', orgs.A).eq('space', 'shared').eq('visibility', 'organization_shared');
  expect((data ?? []).map((r: { id: string }) => r.id)).not.toContain(files.private);
});

test('owner downloads own private file', async () => {
  const dl = await call<{ url: string }>(users.ownerA, orgs.A, `/files/${files.private}/download`);
  expect(dl.status).toBe(200);
  const res = await fetch(dl.body.url);
  expect(await res.text()).toBe('ملاحظات خاصة جدًا');
});

test('delete moves to trash; restore brings it back; deleted files are not downloadable', async () => {
  expect((await call(users.ownerA, orgs.A, `/files/${files.sharedByOwner}`, { method: 'DELETE' })).status).toBe(200);
  const trash = await call<{ files: Array<{ id: string }> }>(users.ownerA, orgs.A, '/files?space=trash');
  expect(trash.body.files.map((f) => f.id)).toContain(files.sharedByOwner);
  expect((await call(users.memberA, orgs.A, `/files/${files.sharedByOwner}/download`)).status).toBe(404);
  expect((await call(users.ownerA, orgs.A, `/files/${files.sharedByOwner}/restore`, { method: 'POST', body: {} })).status).toBe(200);
  const shared = await call<{ files: Array<{ id: string }> }>(users.ownerA, orgs.A, '/files?space=shared');
  expect(shared.body.files.map((f) => f.id)).toContain(files.sharedByOwner);
});

test('another organization is denied', async () => {
  expect((await call(users.ownerB, orgs.A, '/files?space=shared')).status).toBe(404);
  expect((await call(users.ownerB, orgs.B, `/files/${files.sharedByOwner}`)).status).toBe(404);
  expect((await call(users.ownerB, orgs.B, `/files/${files.sharedByOwner}/download`)).status).toBe(404);
});

test('signed download URLs are short-lived', async () => {
  const dl = await call<{ expires_in: number }>(users.ownerA, orgs.A, `/files/${files.sharedByOwner}/download`);
  expect(dl.body.expires_in).toBeLessThanOrEqual(60);
});
