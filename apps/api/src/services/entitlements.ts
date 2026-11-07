import {
  aiWeekResetsAt,
  aiWeekStart,
  isSubscriptionActive,
  usageMonthStart,
  weeklyAiLimit,
  type AiUsageSummary,
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
  ai_budget_halalas_per_year: 0,
  emails_per_month: 0,
  meeting_bot_minutes_per_year: 0,
  voice_characters_per_year: 0,
  download_bytes_per_month: 0,
  features: [],
};

/** Usage that costs the platform money per unit, metered atomically against a plan cap. */
const METERED = {
  emails_per_month: { metric: 'emails_sent', period: 'month' },
  meeting_bot_minutes_per_year: { metric: 'meeting_bot_minutes', period: 'year' },
  voice_characters_per_year: { metric: 'voice_characters', period: 'year' },
  download_bytes_per_month: { metric: 'download_bytes', period: 'month' },
} as const satisfies Partial<Record<EntitlementKey, { metric: string; period: 'month' | 'year' }>>;
export type MeteredKey = keyof typeof METERED;

export interface BillingState {
  subscription: SubscriptionRow | null;
  plan: PlanRow | null;
  active: boolean;
  entitlements: Entitlements;
}

export class EntitlementService {
  private planCache: { at: number; plans: PlanRow[] } | null = null;

  constructor(
    private readonly db: Db,
    private readonly usdToSar = 3.75,
    /** The one AI model used platform-wide (AI_DEFAULT_MODEL). Customers never choose a model. */
    readonly platformModel = 'claude-sonnet-5',
  ) {}

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
    const month = usageMonthStart().toISOString();
    const [members, ai, projects, storage, sessions, counters, monthCounters] = await Promise.all([
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
      this.db.from('usage_counters').select('metric,value').eq('organization_id', orgId).eq('period_start', month),
    ]);
    const toMap = (rows: unknown) => new Map(((rows ?? []) as Array<{ metric: string; value: number }>).map((c) => [c.metric, Number(c.value)]));
    const counterMap = toMap(counters.data);
    const monthMap = toMap(monthCounters.data);
    const storageRow = ((storage.data ?? []) as Array<{ used_bytes: number; file_count: number }>)[0];
    return {
      human_members: members.count ?? 0,
      ai_employees: ai.count ?? 0,
      active_projects: projects.count ?? 0,
      storage_bytes: Number(storageRow?.used_bytes ?? 0),
      concurrent_ai_sessions: sessions.count ?? 0,
      ai_executions_per_year: counterMap.get('ai_executions') ?? 0,
      computer_minutes_per_year: Math.ceil((counterMap.get('computer_seconds') ?? 0) / 60),
      ai_budget_halalas_per_year: this.microUsdToHalalas(counterMap.get('ai_cost_micro_usd') ?? 0),
      emails_per_month: monthMap.get(METERED.emails_per_month.metric) ?? 0,
      meeting_bot_minutes_per_year: counterMap.get(METERED.meeting_bot_minutes_per_year.metric) ?? 0,
      voice_characters_per_year: counterMap.get(METERED.voice_characters_per_year.metric) ?? 0,
      download_bytes_per_month: monthMap.get(METERED.download_bytes_per_month.metric) ?? 0,
    };
  }

  private microUsdToHalalas(microUsd: number): number {
    return Math.ceil((microUsd / 1_000_000) * this.usdToSar * 100);
  }

  private async counterHalalas(orgId: string, metric: string, periodStart: string): Promise<number> {
    const { data } = await this.db
      .from('usage_counters')
      .select('value')
      .eq('organization_id', orgId)
      .eq('metric', metric)
      .eq('period_start', periodStart)
      .maybeSingle<{ value: number }>();
    return this.microUsdToHalalas(Number(data?.value ?? 0));
  }

  /** AI spend so far in the current subscription period (SAR halalas), from the trigger-maintained meter. */
  aiSpendHalalas(orgId: string, state: BillingState): Promise<number> {
    return this.counterHalalas(orgId, 'ai_cost_micro_usd', this.periodStart(state));
  }

  /** AI spend in the current week (Sunday 00:00 Riyadh). */
  aiWeekSpendHalalas(orgId: string, now = new Date()): Promise<number> {
    return this.counterHalalas(orgId, 'ai_cost_micro_usd_week', aiWeekStart(now).toISOString());
  }

  /**
   * Gate in front of EVERY AI call: subscription active, annual AI budget not used up and — when
   * starting new AI work — this week's share not used up either. A running work session only checks
   * the annual cap, so a task isn't cut off halfway (overshoot is bounded by the per-session cost cap).
   */
  async aiGate(orgId: string, opts: { weekly?: boolean } = {}): Promise<{ model: string; state: BillingState }> {
    const state = await this.getBillingState(orgId);
    if (!state.active) throw paymentRequired('subscription_required');
    const annual = state.entitlements.ai_budget_halalas_per_year;
    if (annual !== null && annual !== undefined) {
      const spent = await this.aiSpendHalalas(orgId, state);
      if (spent >= annual) throw paymentRequired('ai_budget_exhausted');
      const weekly = weeklyAiLimit(annual);
      if (opts.weekly !== false && weekly !== null && (await this.aiWeekSpendHalalas(orgId)) >= weekly) {
        throw paymentRequired('ai_weekly_limit_reached', { resets_at: aiWeekResetsAt().toISOString() });
      }
    }
    return { model: this.platformModel, state };
  }

  /** Customer-facing AI usage: percentages only, never money. */
  async aiUsageSummary(orgId: string, state: BillingState): Promise<AiUsageSummary> {
    const annual = state.entitlements.ai_budget_halalas_per_year;
    const weekly = weeklyAiLimit(annual);
    const pct = (used: number, limit: number | null) => (limit === null ? null : limit <= 0 ? 100 : Math.min(100, Math.round((used / limit) * 100)));
    const [year, week] = await Promise.all([this.aiSpendHalalas(orgId, state), this.aiWeekSpendHalalas(orgId)]);
    return { week_pct: pct(week, weekly), week_resets_at: aiWeekResetsAt().toISOString(), year_pct: pct(year, annual ?? null) };
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

  /**
   * Atomically consumes `amount` of a cost-bearing allowance, or throws 402 `plan_limit_reached` and
   * consumes nothing. Fails closed: a plan without the key gets 0, never unlimited.
   */
  async consume(orgId: string, state: BillingState, key: MeteredKey, amount: number): Promise<void> {
    if (!state.active) throw paymentRequired('subscription_required');
    if (amount <= 0) return;
    const { metric, period } = METERED[key];
    const limit = state.entitlements[key] === undefined ? 0 : state.entitlements[key];
    const { data, error } = await this.db.rpc('try_consume_usage_amount', {
      p_org: orgId,
      p_metric: metric,
      p_period_start: period === 'month' ? usageMonthStart().toISOString() : this.periodStart(state),
      p_limit: limit,
      p_amount: Math.ceil(amount),
    });
    if (error) throw new AppError(500, 'usage_error', error.message);
    if (data !== true) throw paymentRequired('plan_limit_reached', { key, limit });
  }

  /** Gives back an allowance consumed for work that then failed before it cost anything. */
  async release(orgId: string, state: BillingState, key: MeteredKey, amount: number): Promise<void> {
    if (amount <= 0) return;
    const { metric, period } = METERED[key];
    await this.db.rpc('increment_usage', {
      p_org: orgId,
      p_metric: metric,
      p_period_start: period === 'month' ? usageMonthStart().toISOString() : this.periodStart(state),
      p_amount: -Math.ceil(amount),
    });
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
