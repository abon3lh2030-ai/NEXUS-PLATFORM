import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { usageMonthStart } from '@nexus/shared';
import type { Db } from '../lib/supabase.js';
import { EntitlementService, type BillingState } from '../services/entitlements.js';
import { createMigratedDb } from '../test-utils/pg-harness.js';

/**
 * Every usage that costs the platform money per unit has a per-plan cap (migration 0017), metered
 * atomically by try_consume_usage_amount — on the REAL migrations (PGlite).
 */

const OWNER = '11111111-1111-4111-8111-111111111111';
const ORG = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const COST_KEYS = ['emails_per_month', 'meeting_bot_minutes_per_year', 'voice_characters_per_year', 'download_bytes_per_month'] as const;

let db: PGlite;

/** Minimal supabase-js-shaped client over PGlite: the select chains and rpc calls EntitlementService uses. */
function pgliteDb(pg: PGlite): Db {
  const from = (table: string) => {
    const where: Array<[string, unknown]> = [];
    let cols = '*';
    let orderBy = '';
    const run = async () => {
      const params = where.map(([, v]) => v);
      const cond = where.length ? ` where ${where.map(([c], i) => `${c} = $${i + 1}`).join(' and ')}` : '';
      return (await pg.query(`select ${cols} from public.${table}${cond}${orderBy}`, params)).rows;
    };
    const q = {
      select(c: string) { cols = c; return q; },
      eq(c: string, v: unknown) { where.push([c, v]); return q; },
      order(c: string) { orderBy = ` order by ${c}`; return run().then((data) => ({ data, error: null })); },
      maybeSingle() { return run().then((rows) => ({ data: rows[0] ?? null, error: null })); },
    };
    return q;
  };
  const rpc = async (fn: string, args: Record<string, unknown>) => {
    const names = Object.keys(args);
    const sql = `select public.${fn}(${names.map((n, i) => `${n} => $${i + 1}`).join(', ')}) as r`;
    try {
      const r = await pg.query<{ r: unknown }>(sql, names.map((n) => args[n]));
      return { data: r.rows[0]?.r ?? null, error: null };
    } catch (err) {
      return { data: null, error: { message: (err as Error).message } };
    }
  };
  return { from, rpc } as unknown as Db;
}

async function counter(metric: string, period: string): Promise<number> {
  const r = await db.query<{ value: string }>(`select value from usage_counters where organization_id = $1 and metric = $2 and period_start = $3`, [ORG, metric, period]);
  return Number(r.rows[0]?.value ?? 0);
}

beforeAll(async () => {
  db = await createMigratedDb();
  await db.query(`insert into auth.users (id, email) values ($1, 'owner@example.com')`, [OWNER]);
  await db.query(`insert into organizations (id, name, commercial_registration, owner_user_id) values ($1, 'C', '1010000003', $2)`, [ORG, OWNER]);
  await db.query(
    `insert into subscriptions (organization_id, plan_code, status, started_at, current_period_start, ends_at)
     values ($1, 'pro', 'active', now() - interval '10 days', now() - interval '10 days', now() + interval '355 days')`,
    [ORG],
  );
}, 120_000);

afterAll(async () => {
  await db?.close();
});

describe('plan cost caps', () => {
  it('every plan, Enterprise included, has a concrete cap on every cost-bearing usage', async () => {
    const r = await db.query<{ code: string; e: Record<string, unknown> }>(`select code, entitlements e from subscription_plans order by sort_order`);
    for (const { code, e } of r.rows) {
      for (const key of [...COST_KEYS, 'storage_bytes', 'computer_minutes_per_year']) {
        expect(typeof e[key], `${code}.${key}`).toBe('number');
      }
    }
    const by = Object.fromEntries(r.rows.map((x) => [x.code, x.e]));
    // Meeting bots and voice are not part of the cheaper plans.
    for (const code of ['launch', 'starter']) {
      expect(by[code]).toMatchObject({ meeting_bot_minutes_per_year: 0, voice_characters_per_year: 0 });
    }
  });
});

describe('EntitlementService.consume', () => {
  const svc = () => new EntitlementService(pgliteDb(db), 3.75);
  const state = () => svc().getBillingState(ORG);

  it('meters monthly usage in the current Riyadh month and refuses past the cap without consuming', async () => {
    const s = await state();
    const month = usageMonthStart().toISOString();
    await svc().consume(ORG, s, 'emails_per_month', 1499);
    await expect(svc().consume(ORG, s, 'emails_per_month', 2)).rejects.toMatchObject({ statusCode: 402, code: 'plan_limit_reached' });
    expect(await counter('emails_sent', month)).toBe(1499);
    await svc().consume(ORG, s, 'emails_per_month', 1);
    expect(await counter('emails_sent', month)).toBe(1500);
    await expect(svc().consume(ORG, s, 'emails_per_month', 1)).rejects.toMatchObject({ code: 'plan_limit_reached' });
  });

  it('meters yearly usage in the subscription period and gives back released allowance', async () => {
    const s = await state();
    const period = svc().periodStart(s);
    await svc().consume(ORG, s, 'meeting_bot_minutes_per_year', 1200);
    await expect(svc().consume(ORG, s, 'meeting_bot_minutes_per_year', 15)).rejects.toMatchObject({ code: 'plan_limit_reached' });
    await svc().release(ORG, s, 'meeting_bot_minutes_per_year', 60);
    expect(await counter('meeting_bot_minutes', new Date(period).toISOString())).toBe(1140);
    await svc().consume(ORG, s, 'meeting_bot_minutes_per_year', 60);
  });

  it('counts voice characters against the yearly cap', async () => {
    const s = await state();
    await svc().consume(ORG, s, 'voice_characters_per_year', 49_000);
    await expect(svc().consume(ORG, s, 'voice_characters_per_year', 1_001)).rejects.toMatchObject({ code: 'plan_limit_reached' });
    expect(await counter('voice_characters', new Date(svc().periodStart(s)).toISOString())).toBe(49_000);
  });

  it('fails closed: a plan missing a cost key gets nothing, never unlimited', async () => {
    const s = await state();
    const missing: BillingState = { ...s, entitlements: { ...s.entitlements, download_bytes_per_month: undefined as unknown as number } };
    await expect(svc().consume(ORG, missing, 'download_bytes_per_month', 1)).rejects.toMatchObject({ code: 'plan_limit_reached' });
  });

  it('refuses without an active subscription', async () => {
    const s = await state();
    await expect(svc().consume(ORG, { ...s, active: false }, 'emails_per_month', 1)).rejects.toMatchObject({ code: 'subscription_required' });
  });
});
