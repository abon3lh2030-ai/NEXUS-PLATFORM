import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { asAnon, asUser, createMigratedDb } from '../test-utils/pg-harness.js';

/** The founder portal tables must be unreachable from browsers (anon / authenticated), even for the founder. */
const FOUNDER = '77777777-7777-4777-8777-777777777777';
let db: PGlite;

const TABLES = [
  'founder_accounts', 'founder_audit_log', 'founder_settings', 'founder_projects', 'founder_plans', 'founder_goals', 'founder_ti_phases',
  'founder_budgets', 'founder_rounds', 'founder_shareholders', 'founder_team', 'founder_campaigns', 'founder_documents', 'founder_deals',
  'founder_deal_activities', 'founder_ti_assets', 'founder_ti_models', 'founder_ti_services', 'founder_ti_tasks', 'founder_releases',
  'founder_dev_items', 'founder_transactions', 'founder_commitments', 'founder_risks', 'founder_decisions', 'founder_legal_items',
  'founder_competitors', 'founder_scenarios',
];

beforeAll(async () => {
  db = await createMigratedDb();
  await db.query('insert into auth.users (id, email) values ($1, $2)', [FOUNDER, 'founder@example.com']);
  await db.query('insert into founder_accounts (user_id) values ($1)', [FOUNDER]);
}, 60_000);
afterAll(async () => db?.close());

describe('founder portal isolation', () => {
  it('seeds the approved technology independence plan', async () => {
    const phases = await db.query<{ code: string; status: string; budget_total: string | null }>('select code, status, budget_total from founder_ti_phases order by ord');
    expect(phases.rows.map((p) => p.code)).toEqual(['y1_cloud', 'y2_mac', 'y3_datacenter', 'y4_independent']);
    expect(phases.rows[0]!.status).toBe('current');
    expect(Number(phases.rows[1]!.budget_total)).toBe(752000);
    expect(Number(phases.rows[2]!.budget_total)).toBe(990000);
    const y3 = await db.query<{ total: string }>("select sum(planned_amount) total from founder_budgets b join founder_ti_phases p on p.id = b.phase_id where p.code = 'y3_datacenter'");
    expect(Number(y3.rows[0]!.total)).toBe(990000);
    const done = await db.query<{ n: number }>("select count(*)::int n from founder_ti_tasks where status = 'done'");
    expect(done.rows[0]!.n).toBe(0);
  });

  for (const role of ['anon', 'authenticated'] as const) {
    it(`${role} cannot read or write any founder table`, async () => {
      for (const t of TABLES) {
        const run = role === 'anon' ? asAnon : (d: PGlite, sql: string) => asUser(d, FOUNDER, sql);
        await expect(run(db, `select * from public.${t} limit 1`), t).rejects.toThrow(/permission denied/);
      }
      const run = role === 'anon' ? asAnon : (d: PGlite, sql: string) => asUser(d, FOUNDER, sql);
      await expect(run(db, `insert into public.founder_accounts (user_id) values ('${FOUNDER}')`)).rejects.toThrow(/permission denied/);
    });
  }

  it('the founder audit log is append-only', async () => {
    await db.query("insert into founder_audit_log (user_id, action) values ($1, 'login')", [FOUNDER]);
    await expect(db.query('update founder_audit_log set action = $1', ['x'])).rejects.toThrow(/append-only/);
    await expect(db.query('delete from founder_audit_log')).rejects.toThrow(/append-only/);
    await expect(db.query("update founder_audit_log set user_id = null, summary = 'x'")).rejects.toThrow(/append-only/);
    // Removing the auth user only nulls user_id (FK ON DELETE SET NULL); the entries stay.
    await db.query('delete from founder_accounts where user_id = $1', [FOUNDER]);
    await db.query('delete from auth.users where id = $1', [FOUNDER]);
    const left = await db.query<{ n: number }>("select count(*)::int n from founder_audit_log where action = 'login' and user_id is null");
    expect(left.rows[0]!.n).toBe(1);
  });

  it('only one phase can be current', async () => {
    await expect(db.query("update founder_ti_phases set status = 'current' where code = 'y2_mac'")).rejects.toThrow(/duplicate key/);
  });
});
