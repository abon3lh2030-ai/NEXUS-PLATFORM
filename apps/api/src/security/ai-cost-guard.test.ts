import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Db } from '../lib/supabase.js';
import { EntitlementService } from '../services/entitlements.js';
import { aiWeekStart } from '@nexus/shared';
import { createMigratedDb } from '../test-utils/pg-harness.js';

/**
 * AI cost guard: plan budgets + allowed models (migration 0013), the ai_usage_events → usage
 * meter trigger, and EntitlementService.aiGate — all on the REAL migrations (PGlite).
 */

const OWNER = '11111111-1111-4111-8111-111111111111';
const ORG = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ORG_NO_SUB = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

let db: PGlite;

/** Minimal supabase-js-shaped query builder over PGlite, covering the chains EntitlementService uses. */
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
  return { from } as unknown as Db;
}

async function addUsage(org: string, usd: number) {
  await db.query(`insert into ai_usage_events (organization_id, source, provider, model, estimated_cost_usd) values ($1, 'nexus_ai', 'anthropic', 'claude-sonnet-5', $2)`, [org, usd]);
}

beforeAll(async () => {
  db = await createMigratedDb();
  await db.query(`insert into auth.users (id, email) values ($1, 'owner@example.com')`, [OWNER]);
  await db.query(`insert into organizations (id, name, commercial_registration, owner_user_id) values ($1, 'A', '1010000001', $3), ($2, 'B', '1010000002', $3)`, [ORG, ORG_NO_SUB, OWNER]);
  await db.query(
    `insert into subscriptions (organization_id, plan_code, status, started_at, current_period_start, ends_at)
     values ($1, 'starter', 'active', now() - interval '10 days', now() - interval '10 days', now() + interval '355 days')`,
    [ORG],
  );
}, 120_000);

afterAll(async () => {
  await db?.close();
});

describe('plan AI budgets', () => {
  it('every self-serve plan has an AI budget of at most 40% of its price; enterprise is set per offer', async () => {
    const r = await db.query<{ code: string; price: number | null; budget: number | null }>(
      `select code, price_halalas price, (entitlements->>'ai_budget_halalas_per_year')::bigint budget from subscription_plans order by sort_order`,
    );
    const by = Object.fromEntries(r.rows.map((x) => [x.code, x]));
    expect(by.starter).toMatchObject({ budget: 35000 });
    expect(by.pro).toMatchObject({ budget: 75000 });
    expect(by.business).toMatchObject({ budget: 115000 });
    expect(by.enterprise!.budget).toBeNull();
    for (const code of ['starter', 'pro', 'business']) {
      const p = by[code]!;
      expect(Number(p.budget)).toBeLessThanOrEqual(Number(p.price) * 0.4);
    }
  });

  it('customers cannot choose a model: plans carry no model list', async () => {
    const r = await db.query(`select 1 from information_schema.columns where table_name = 'subscription_plans' and column_name = 'ai_models'`);
    expect(r.rows).toHaveLength(0);
  });
});

describe('usage meter trigger', () => {
  it('adds every AI usage event to the current period counter (micro-USD)', async () => {
    await addUsage(ORG, 1.5);
    await addUsage(ORG, 0.25);
    const r = await db.query<{ value: string }>(`select value from usage_counters where organization_id = $1 and metric = 'ai_cost_micro_usd'`, [ORG]);
    expect(Number(r.rows[0]!.value)).toBe(1_750_000);
  });

  it('also counts each event in its Riyadh week (SQL week start matches the shared TS helper)', async () => {
    for (const at of ['2026-09-30T07:00:00Z', '2026-10-03T20:59:00Z', '2026-10-03T21:00:00Z', '2026-12-31T23:30:00Z']) {
      const r = await db.query<{ w: Date }>(`select public.ai_week_start($1::timestamptz) w`, [at]);
      expect(new Date(r.rows[0]!.w).toISOString()).toBe(aiWeekStart(new Date(at)).toISOString());
    }
    const r = await db.query<{ value: string; period_start: Date }>(`select value, period_start from usage_counters where organization_id = $1 and metric = 'ai_cost_micro_usd_week'`, [ORG]);
    expect(Number(r.rows[0]!.value)).toBe(1_750_000);
    expect(new Date(r.rows[0]!.period_start).toISOString()).toBe(aiWeekStart().toISOString());
  });

  it('ignores organizations without a subscription', async () => {
    await addUsage(ORG_NO_SUB, 2);
    const r = await db.query(`select 1 from usage_counters where organization_id = $1`, [ORG_NO_SUB]);
    expect(r.rows).toHaveLength(0);
  });
});

describe('EntitlementService.aiGate', () => {
  const svc = () => new EntitlementService(pgliteDb(db), 3.75);

  it('allows AI while under budget and always uses the single platform model', async () => {
    expect((await svc().aiGate(ORG)).model).toBe('claude-sonnet-5');
    expect((await new EntitlementService(pgliteDb(db), 3.75, 'claude-opus-5').aiGate(ORG)).model).toBe('claude-opus-5');
  });

  it('reports spend in halalas', async () => {
    const s = svc();
    const state = await s.getBillingState(ORG);
    // 1.75 USD × 3.75 = 6.5625 SAR → 657 halalas (rounded up)
    expect(await s.aiSpendHalalas(ORG, state)).toBe(657);
  });

  it("refuses NEW AI work once this week's share is used up, but lets a running task continue", async () => {
    // Starter: 35000 / 53 = 660 halalas per week; 657 already used this week.
    await addUsage(ORG, 0.01);
    await expect(svc().aiGate(ORG)).rejects.toMatchObject({ statusCode: 402, code: 'ai_weekly_limit_reached' });
    await expect(svc().aiGate(ORG, { weekly: false })).resolves.toMatchObject({ model: 'claude-sonnet-5' });
    const usage = await svc().aiUsageSummary(ORG, await svc().getBillingState(ORG));
    expect(usage.week_pct).toBe(100);
    expect(usage.year_pct).toBe(2);
  });

  it('refuses every AI call with 402 once the annual budget is used up', async () => {
    // Starter budget 350 SAR ≈ 93.34 USD
    await addUsage(ORG, 92);
    await expect(svc().aiGate(ORG)).rejects.toMatchObject({ statusCode: 402, code: 'ai_budget_exhausted' });
  });

  it('refuses AI without an active subscription', async () => {
    await expect(svc().aiGate(ORG_NO_SUB)).rejects.toMatchObject({ statusCode: 402, code: 'subscription_required' });
  });
});
