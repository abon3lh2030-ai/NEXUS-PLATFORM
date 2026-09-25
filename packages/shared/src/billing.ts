/**
 * Entitlement & feature keys. Actual limits and prices live in the database
 * (subscription_plans.entitlements / price_halalas) — never hardcode them in the UI.
 */
export const ENTITLEMENT_KEYS = [
  'human_members',
  'ai_employees',
  'ai_executions_per_year',
  'active_projects',
  'storage_bytes',
  'max_file_size_bytes',
  'concurrent_ai_sessions',
  'computer_minutes_per_year',
] as const;
export type EntitlementKey = (typeof ENTITLEMENT_KEYS)[number];

export const FEATURE_KEYS = [
  'basic_memory',
  'full_memory',
  'knowledge',
  'decisions',
  'meetings',
  'approvals',
  'advanced_approvals',
  'agent_orchestration',
  'advanced_orchestration',
  'basic_analytics',
  'advanced_analytics',
  'advanced_permissions',
  'audit_logs',
  'priority_support',
  'archive_uploads',
] as const;
export type FeatureKey = (typeof FEATURE_KEYS)[number];

/** `null` = unlimited. */
export type Entitlements = Record<EntitlementKey, number | null> & { features: FeatureKey[] };

export interface PublicPlan {
  code: string;
  name_ar: string;
  name_en: string;
  price_halalas: number | null;
  currency: 'SAR';
  billing_interval: 'yearly';
  is_popular: boolean;
  is_custom: boolean;
  entitlements: Entitlements;
  sort_order: number;
}

export interface UsageSnapshot {
  human_members: number;
  ai_employees: number;
  ai_executions_per_year: number;
  active_projects: number;
  storage_bytes: number;
  concurrent_ai_sessions: number;
  computer_minutes_per_year: number;
}

/**
 * Renewal rule: renewing before expiry extends from the current end date, so no remaining
 * days are lost. Renewing after expiry starts from `now`.
 */
export function computeRenewalWindow(now: Date, currentEndsAt: Date | null): { startsAt: Date; endsAt: Date } {
  const base = currentEndsAt && currentEndsAt.getTime() > now.getTime() ? currentEndsAt : now;
  const endsAt = new Date(base.getTime());
  endsAt.setUTCFullYear(endsAt.getUTCFullYear() + 1);
  return { startsAt: currentEndsAt && currentEndsAt > now ? currentEndsAt : now, endsAt };
}

export function isSubscriptionActive(sub: { status: string; ends_at: string | null } | null, now = new Date()): boolean {
  if (!sub || sub.status !== 'active' || !sub.ends_at) return false;
  return new Date(sub.ends_at).getTime() > now.getTime();
}
