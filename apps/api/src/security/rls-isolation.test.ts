import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { asAnon, asUser, createMigratedDb } from '../test-utils/pg-harness.js';

/**
 * Executes the REAL migrations and RLS/Storage policies on a real Postgres engine (PGlite)
 * and verifies the critical isolation guarantees from the security requirements.
 */

const U = {
  ownerA: '11111111-1111-4111-8111-111111111111',
  adminA: '22222222-2222-4222-8222-222222222222',
  memberA: '33333333-3333-4333-8333-333333333333',
  viewerA: '44444444-4444-4444-8444-444444444444',
  ownerB: '55555555-5555-4555-8555-555555555555',
  outsider: '66666666-6666-4666-8666-666666666666',
};
const ORG_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ORG_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const AI_A = 'a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1';
const F = {
  sharedA: 'f0000001-0000-4000-8000-000000000001',
  privateOwnerA: 'f0000002-0000-4000-8000-000000000002',
  privateAdminA: 'f0000003-0000-4000-8000-000000000003',
  sharedB: 'f0000004-0000-4000-8000-000000000004',
  deletedSharedA: 'f0000005-0000-4000-8000-000000000005',
  aiWorkspaceA: 'f0000006-0000-4000-8000-000000000006',
  privateOwnerB: 'f0000007-0000-4000-8000-000000000007',
};
const key = {
  sharedA: `${ORG_A}/shared/${F.sharedA}`,
  privateOwnerA: `${ORG_A}/private/${U.ownerA}/${F.privateOwnerA}`,
  privateAdminA: `${ORG_A}/private/${U.adminA}/${F.privateAdminA}`,
  sharedB: `${ORG_B}/shared/${F.sharedB}`,
  deletedSharedA: `${ORG_A}/shared/${F.deletedSharedA}`,
  aiWorkspaceA: `${ORG_A}/ai/${AI_A}/${F.aiWorkspaceA}`,
  privateOwnerB: `${ORG_B}/private/${U.ownerB}/${F.privateOwnerB}`,
};

let db: PGlite;

async function seed(db: PGlite) {
  for (const [name, id] of Object.entries(U)) await db.query('insert into auth.users (id, email) values ($1, $2)', [id, `${name}@example.com`]);
  await db.query(`insert into organizations (id, name, commercial_registration, owner_user_id) values ($1, 'Company A', '1010000001', $2), ($3, 'Company B', '1010000002', $4)`, [ORG_A, U.ownerA, ORG_B, U.ownerB]);
  await db.query(
    `insert into organization_members (organization_id, user_id, role) values
      ($1, $2, 'owner'), ($1, $3, 'admin'), ($1, $4, 'member'), ($1, $5, 'viewer'), ($6, $7, 'owner')`,
    [ORG_A, U.ownerA, U.adminA, U.memberA, U.viewerA, ORG_B, U.ownerB],
  );
  await db.query(`insert into ai_employees (id, organization_id, name, job_title, model) values ($1, $2, 'Atlas', 'Strategy', 'claude-opus-5')`, [AI_A, ORG_A]);
  const file = (id: string, org: string, space: string, vis: string, owner: string | null, k: string, extra = '') =>
    db.query(
      `insert into company_files (id, organization_id, space, visibility, owner_user_id, uploaded_by_user_id, ai_employee_id, original_name, storage_key, mime_type, category, size, status ${extra ? ', deleted_at' : ''})
       values ($1, $2, $3::file_space, $4::file_visibility, $5, $6, $7, 'doc.pdf', $8, 'application/pdf', 'pdf', 100, 'ready' ${extra ? ', now()' : ''})`,
      [id, org, space, vis, owner, owner ?? U.memberA, space === 'ai_workspace' ? AI_A : null, k],
    );
  await file(F.sharedA, ORG_A, 'shared', 'organization_shared', null, key.sharedA);
  await file(F.privateOwnerA, ORG_A, 'private', 'private_owner', U.ownerA, key.privateOwnerA);
  await file(F.privateAdminA, ORG_A, 'private', 'private_owner', U.adminA, key.privateAdminA);
  await file(F.sharedB, ORG_B, 'shared', 'organization_shared', null, key.sharedB);
  await file(F.deletedSharedA, ORG_A, 'shared', 'organization_shared', null, key.deletedSharedA, 'deleted');
  await file(F.aiWorkspaceA, ORG_A, 'ai_workspace', 'restricted', null, key.aiWorkspaceA);
  await file(F.privateOwnerB, ORG_B, 'private', 'private_owner', U.ownerB, key.privateOwnerB);
  for (const k of Object.values(key)) await db.query(`insert into storage.objects (bucket_id, name) values ('company-files', $1)`, [k]);
  await db.query(`insert into company_file_folders (organization_id, space, visibility, owner_user_id, name) values ($1, 'private', 'private_owner', $2, 'Personal'), ($1, 'shared', 'organization_shared', null, 'Marketing')`, [ORG_A, U.ownerA]);
  await db.query(`insert into audit_logs (organization_id, actor_type, action) values ($1, 'system', 'seed')`, [ORG_A]);
}

const visibleFiles = async (user: string) => (await asUser<{ id: string }>(db, user, 'select id from company_files')).map((r) => r.id).sort();
const visibleObjects = async (user: string) => (await asUser<{ name: string }>(db, user, `select name from storage.objects where bucket_id = 'company-files'`)).map((r) => r.name).sort();

beforeAll(async () => {
  db = await createMigratedDb();
  await seed(db);
}, 120_000);

afterAll(async () => {
  await db?.close();
});

describe('migrations', () => {
  it('create the full schema', async () => {
    const r = await db.query<{ n: number }>(`select count(*)::int n from information_schema.tables where table_schema = 'public'`);
    expect(r.rows[0]!.n).toBeGreaterThanOrEqual(55);
  });
  it('seed plans with trusted annual SAR prices', async () => {
    const r = await db.query<{ code: string; price_halalas: string | null }>('select code, price_halalas from subscription_plans order by sort_order');
    expect(r.rows.map((p) => [p.code, p.price_halalas === null ? null : Number(p.price_halalas)])).toEqual([
      ['starter', 39900],
      ['pro', 59900],
      ['business', 99900],
      ['enterprise', null],
    ]);
  });
  it('seed all AI employee templates', async () => {
    const r = await db.query<{ n: number }>('select count(*)::int n from ai_employee_templates');
    expect(r.rows[0]!.n).toBe(21);
  });
});

describe('company file isolation (database RLS)', () => {
  it('owner sees shared files + ONLY their own private files', async () => {
    expect(await visibleFiles(U.ownerA)).toEqual([F.sharedA, F.privateOwnerA, F.deletedSharedA, F.aiWorkspaceA].sort());
  });
  it('another admin cannot see the owner private file (and vice versa)', async () => {
    const admin = await visibleFiles(U.adminA);
    expect(admin).not.toContain(F.privateOwnerA);
    expect(admin).toContain(F.privateAdminA);
    expect(await visibleFiles(U.ownerA)).not.toContain(F.privateAdminA);
  });
  it('member and viewer see shared files but no private files and no AI workspace files', async () => {
    for (const u of [U.memberA, U.viewerA]) {
      const files = await visibleFiles(u);
      expect(files).toContain(F.sharedA);
      expect(files).not.toContain(F.privateOwnerA);
      expect(files).not.toContain(F.privateAdminA);
      expect(files).not.toContain(F.aiWorkspaceA);
    }
  });
  it('company A cannot see any company B file', async () => {
    const files = await visibleFiles(U.ownerA);
    expect(files).not.toContain(F.sharedB);
    expect(files).not.toContain(F.privateOwnerB);
  });
  it('knowing the file UUID is not enough', async () => {
    const r = await asUser(db, U.memberA, 'select id from company_files where id = $1', [F.privateOwnerA]);
    expect(r).toHaveLength(0);
    const r2 = await asUser(db, U.ownerB, 'select id from company_files where id = $1', [F.sharedA]);
    expect(r2).toHaveLength(0);
  });
  it('outsiders and anonymous users see nothing', async () => {
    expect(await visibleFiles(U.outsider)).toEqual([]);
    expect(await asAnon(db, 'select id from company_files')).toEqual([]);
  });
  it('private folders are visible only to their owner', async () => {
    const own = await asUser<{ name: string }>(db, U.ownerA, `select name from company_file_folders where space = 'private'`);
    const other = await asUser<{ name: string }>(db, U.adminA, `select name from company_file_folders where space = 'private'`);
    expect(own.map((r) => r.name)).toEqual(['Personal']);
    expect(other).toEqual([]);
  });
});

describe('storage object isolation (Storage policies)', () => {
  it('knowing the storage key is not enough: members cannot read private objects', async () => {
    const r = await asUser(db, U.memberA, `select name from storage.objects where name = $1`, [key.privateOwnerA]);
    expect(r).toHaveLength(0);
  });
  it('owner can read own private object; admin cannot', async () => {
    expect(await visibleObjects(U.ownerA)).toContain(key.privateOwnerA);
    expect(await visibleObjects(U.adminA)).not.toContain(key.privateOwnerA);
  });
  it('soft-deleted files are no longer downloadable', async () => {
    expect(await visibleObjects(U.ownerA)).not.toContain(key.deletedSharedA);
    expect(await visibleObjects(U.memberA)).not.toContain(key.deletedSharedA);
  });
  it('cross-organization objects are unreachable', async () => {
    expect(await visibleObjects(U.ownerA)).not.toContain(key.sharedB);
    expect(await visibleObjects(U.ownerB)).not.toContain(key.sharedA);
    expect(await visibleObjects(U.outsider)).toEqual([]);
  });
  it('members can read shared objects of their own org', async () => {
    expect(await visibleObjects(U.memberA)).toEqual([key.sharedA]);
  });
});

describe('write protection', () => {
  it('clients cannot write business tables directly', async () => {
    await expect(asUser(db, U.ownerA, `update company_files set visibility = 'organization_shared' where id = $1`, [F.privateAdminA])).rejects.toThrow();
    await expect(asUser(db, U.memberA, `insert into organization_members (organization_id, user_id, role) values ($1, $2, 'owner')`, [ORG_A, U.outsider])).rejects.toThrow();
  });
  it('users cannot grant themselves super_admin', async () => {
    await expect(asUser(db, U.memberA, `insert into platform_admins (user_id) values ($1)`, [U.memberA])).rejects.toThrow();
  });
  it('clients cannot upload into storage directly', async () => {
    await expect(asUser(db, U.ownerA, `insert into storage.objects (bucket_id, name) values ('company-files', $1)`, [`${ORG_B}/shared/x`])).rejects.toThrow();
  });
  it('audit log is append-only (even for the service role)', async () => {
    await expect(db.query(`update audit_logs set action = 'tampered'`)).rejects.toThrow(/append-only/);
  });
  it('AI employee permissions can never include private file access', async () => {
    await expect(db.query(`insert into ai_employee_permissions (ai_employee_id, organization_id, permissions) values ($1, $2, '{files.private.view}')`, [AI_A, ORG_A])).rejects.toThrow();
  });
  it('a private file row must have an owner and cannot be attributed to an AI uploader', async () => {
    await expect(
      db.query(`insert into company_files (organization_id, space, visibility, original_name, storage_key, mime_type, category, size) values ($1, 'private', 'private_owner', 'x', $2, 'text/plain', 'text', 1)`, [ORG_A, `${ORG_A}/private/x`]),
    ).rejects.toThrow();
  });
  it('storage keys must live under the owning organization prefix', async () => {
    await expect(
      db.query(`insert into company_files (organization_id, space, visibility, original_name, storage_key, mime_type, category, size) values ($1, 'shared', 'organization_shared', 'x', $2, 'text/plain', 'text', 1)`, [ORG_A, `${ORG_B}/shared/evil`]),
    ).rejects.toThrow();
  });
});

describe('tenant data isolation', () => {
  it('members only see their own organization and AI employees', async () => {
    const orgs = await asUser<{ id: string }>(db, U.memberA, 'select id from organizations');
    expect(orgs.map((o) => o.id)).toEqual([ORG_A]);
    expect(await asUser(db, U.ownerB, 'select id from ai_employees')).toEqual([]);
  });
  it('audit logs are limited to owner/admin', async () => {
    expect(await asUser(db, U.ownerA, 'select id from audit_logs')).toHaveLength(1);
    expect(await asUser(db, U.memberA, 'select id from audit_logs')).toHaveLength(0);
  });
  it('closed organizations lose access immediately (data retained)', async () => {
    await db.query(`update organizations set status = 'closed', closed_at = now() where id = $1`, [ORG_B]);
    expect(await asUser(db, U.ownerB, 'select id from company_files')).toEqual([]);
    const retained = await db.query<{ n: number }>('select count(*)::int n from company_files where organization_id = $1', [ORG_B]);
    expect(retained.rows[0]!.n).toBe(2);
    await db.query(`update organizations set status = 'active', closed_at = null where id = $1`, [ORG_B]);
  });
});

describe('payment activation function', () => {
  it('activates once, is idempotent, rejects amount mismatch, and renewal keeps remaining days', async () => {
    const tx = async (amount: number) =>
      (await db.query<{ id: string }>(`insert into payment_transactions (organization_id, user_id, plan_code, amount_halalas) values ($1, $2, 'pro', $3) returning id`, [ORG_A, U.ownerA, amount])).rows[0]!.id;

    const t1 = await tx(59900);
    await expect(db.query(`select * from activate_paid_transaction($1, 'pay_1', 100, 'SAR', 'creditcard', '{}')`, [t1])).rejects.toThrow(/amount_mismatch/);
    const first = await db.query<{ ends_at: string; status: string }>(`select * from activate_paid_transaction($1, 'pay_1', 59900, 'SAR', 'creditcard', '{}')`, [t1]);
    expect(first.rows[0]!.status).toBe('active');
    const replay = await db.query<{ ends_at: string }>(`select * from activate_paid_transaction($1, 'pay_1', 59900, 'SAR', 'creditcard', '{}')`, [t1]);
    expect(replay.rows[0]!.ends_at).toEqual(first.rows[0]!.ends_at);

    const t2 = await tx(59900);
    const renewed = await db.query<{ ends_at: string }>(`select * from activate_paid_transaction($1, 'pay_2', 59900, 'SAR', 'applepay', '{}')`, [t2]);
    const firstEnd = new Date(first.rows[0]!.ends_at);
    const renewedEnd = new Date(renewed.rows[0]!.ends_at);
    const expected = new Date(firstEnd);
    expected.setFullYear(expected.getFullYear() + 1);
    expect(Math.abs(renewedEnd.getTime() - expected.getTime())).toBeLessThan(2 * 86400_000);
  });
  it('expire_subscriptions() marks lapsed subscriptions expired without deleting data', async () => {
    await db.query(`update subscriptions set ends_at = now() - interval '1 minute' where organization_id = $1`, [ORG_A]);
    const r = await db.query<{ status: string }>('select * from expire_subscriptions()');
    expect(r.rows[0]!.status).toBe('expired');
    const files = await db.query<{ n: number }>('select count(*)::int n from company_files where organization_id = $1', [ORG_A]);
    expect(files.rows[0]!.n).toBeGreaterThan(0);
  });
});

describe('AI work queue', () => {
  it('claims queued sessions atomically and respects delayed scheduling', async () => {
    await db.query(`insert into ai_work_sessions (organization_id, ai_employee_id, provider, model, queued_at) values ($1, $2, 'mock', 'm', now() + interval '1 hour')`, [ORG_A, AI_A]);
    expect((await db.query('select * from claim_next_work_session($1)', ['w1'])).rows).toHaveLength(0);
    await db.query(`insert into ai_work_sessions (organization_id, ai_employee_id, provider, model) values ($1, $2, 'mock', 'm')`, [ORG_A, AI_A]);
    const claimed = await db.query<{ status: string; locked_by: string }>('select * from claim_next_work_session($1)', ['w1']);
    expect(claimed.rows[0]).toMatchObject({ status: 'preparing', locked_by: 'w1' });
    expect((await db.query('select * from claim_next_work_session($1)', ['w2'])).rows).toHaveLength(0);
  });
  it('delegation depth is capped in the database', async () => {
    await expect(db.query(`insert into ai_work_sessions (organization_id, ai_employee_id, provider, model, delegation_depth) values ($1, $2, 'mock', 'm', 9)`, [ORG_A, AI_A])).rejects.toThrow();
  });
});
