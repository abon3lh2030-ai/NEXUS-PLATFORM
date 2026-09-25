import {
  isSubscriptionActive,
  type EntitlementKey,
  type Entitlements,
  type FeatureKey,
  type UsageSnapshot,
} from '@nexus/shared';
import type { Db } from '../lib/supabase.js';
import { AppError, paymentRequired } from '../lib/errors.js';
import type { PlanRow, SubscriptionRow } from '../types/db.js';

const EMPTY: Entitlements = {
  human_members: 0,
  ai_employees: 0,
  ai_executions_per_year: 0,
  active_projects: 0,
  storage_bytes: 0,
  max_file_size_bytes: 0,
  concurrent_ai_sessions: 0,
  computer_minutes_per_year: 0,
  features: [],
};

export interface BillingState {
  subscription: SubscriptionRow | null;
  plan: PlanRow | null;
  active: boolean;
  entitlements: Entitlements;
}

export class EntitlementService {
  private planCache: { at: number; plans: PlanRow[] } | null = null;

  constructor(private readonly db: Db) {}

  async listPlans(): Promise<PlanRow[]> {
    if (this.planCache && Date.now() - this.planCache.at < 60_000) return this.planCache.plans;
    const { data, error } = await this.db.from('subscription_plans').select('*').order('sort_order');
    if (error) throw new AppError(500, 'plans_unavailable', error.message);
    const plans = (data ?? []) as PlanRow[];
    this.planCache = { at: Date.now(), plans };
    return plans;
  }

  async getPlan(code: string): Promise<PlanRow | null> {
    return (await this.listPlans()).find((p) => p.code === code) ?? null;
  }

  async getBillingState(orgId: string): Promise<BillingState> {
    const { data } = await this.db.from('subscriptions').select('*').eq('organization_id', orgId).maybeSingle<SubscriptionRow>();
    const subscription = data ?? null;
    const plan = subscription ? await this.getPlan(subscription.plan_code) : null;
    // Expiry is enforced by timestamp on EVERY request, independent of the expiry cron job.
    const active = isSubscriptionActive(subscription);
    const entitlements: Entitlements =
      active && plan ? { ...plan.entitlements, ...(subscription?.custom_entitlements ?? {}) } : EMPTY;
    return { subscription, plan, active, entitlements };
  }

  hasFeature(state: BillingState, feature: FeatureKey): boolean {
    return state.active && state.entitlements.features.includes(feature);
  }

  assertFeature(state: BillingState, feature: FeatureKey): void {
    if (!state.active) throw paymentRequired('subscription_required');
    if (!this.hasFeature(state, feature)) throw paymentRequired('feature_not_in_plan', { feature });
  }

  periodStart(state: BillingState): string {
    return state.subscription?.current_period_start ?? state.subscription?.started_at ?? new Date(0).toISOString();
  }

  async getUsage(orgId: string, state: BillingState): Promise<UsageSnapshot> {
    const period = this.periodStart(state);
    const [members, ai, projects, storage, sessions, counters] = await Promise.all([
      this.db.from('organization_members').select('id', { count: 'exact', head: true }).eq('organization_id', orgId).eq('status', 'active'),
      this.db.from('ai_employees').select('id', { count: 'exact', head: true }).eq('organization_id', orgId).is('deleted_at', null),
      this.db
        .from('projects')
        .select('id', { count: 'exact', head: true })
        .eq('organization_id', orgId)
        .is('deleted_at', null)
        .in('status', ['planned', 'active', 'on_hold', 'blocked']),
      this.db.rpc('organization_storage_usage', { p_org: orgId }),
      this.db
        .from('ai_work_sessions')
        .select('id', { count: 'exact', head: true })
        .eq('organization_id', orgId)
        .in('status', ['preparing', 'running']),
      this.db.from('usage_counters').select('metric,value').eq('organization_id', orgId).eq('period_start', period),
    ]);
    const counterMap = new Map(((counters.data ?? []) as Array<{ metric: string; value: number }>).map((c) => [c.metric, Number(c.value)]));
    const storageRow = ((storage.data ?? []) as Array<{ used_bytes: number; file_count: number }>)[0];
    return {
      human_members: members.count ?? 0,
      ai_employees: ai.count ?? 0,
      active_projects: projects.count ?? 0,
      storage_bytes: Number(storageRow?.used_bytes ?? 0),
      concurrent_ai_sessions: sessions.count ?? 0,
      ai_executions_per_year: counterMap.get('ai_executions') ?? 0,
      computer_minutes_per_year: Math.ceil((counterMap.get('computer_seconds') ?? 0) / 60),
    };
  }

  /** Throws 402 if adding `increment` would exceed a countable entitlement. */
  async assertWithinLimit(orgId: string, state: BillingState, key: EntitlementKey, increment = 1): Promise<void> {
    if (!state.active) throw paymentRequired('subscription_required');
    const limit = state.entitlements[key];
    if (limit === null) return;
    const usage = await this.getUsage(orgId, state);
    const current = key in usage ? usage[key as keyof UsageSnapshot] : 0;
    if (current + increment > limit) throw paymentRequired('plan_limit_reached', { key, limit, current });
  }

  /** Atomically consumes one AI execution from the annual allowance. */
  async consumeExecution(orgId: string, state: BillingState): Promise<void> {
    if (!state.active) throw paymentRequired('subscription_required');
    const { data, error } = await this.db.rpc('try_consume_usage', {
      p_org: orgId,
      p_metric: 'ai_executions',
      p_period_start: this.periodStart(state),
      p_limit: state.entitlements.ai_executions_per_year,
    });
    if (error) throw new AppError(500, 'usage_error', error.message);
    if (data !== true) throw paymentRequired('plan_limit_reached', { key: 'ai_executions_per_year' });
  }

  async addComputerSeconds(orgId: string, state: BillingState, seconds: number): Promise<void> {
    if (seconds <= 0) return;
    await this.db.rpc('increment_usage', {
      p_org: orgId,
      p_metric: 'computer_seconds',
      p_period_start: this.periodStart(state),
      p_amount: Math.ceil(seconds),
    });
  }
}
