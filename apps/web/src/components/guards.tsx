import { Button, EmptyState } from '@nexus/ui';
import { CreditCard, Lock, ShieldAlert } from 'lucide-react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, Navigate, useLocation } from 'react-router';
import type { Permission } from '@nexus/shared';
import { useSession } from '@/providers/session';
import { LoadingBlock } from './common';

export function FullPageLoader() {
  return (
    <div className="flex min-h-dvh items-center justify-center">
      <div className="size-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
    </div>
  );
}

export function RequireAuth({ children }: { children: ReactNode }) {
  const { session, loading } = useSession();
  const location = useLocation();
  if (loading) return <FullPageLoader />;
  if (!session) return <Navigate to={`/login?next=${encodeURIComponent(location.pathname + location.search)}`} replace />;
  return <>{children}</>;
}

/** Requires the user to belong to an organization; otherwise routes to company registration. */
export function RequireOrg({ children }: { children: ReactNode }) {
  const { me, meLoading, orgId, org, orgLoading } = useSession();
  if (meLoading || (orgId && orgLoading)) return <FullPageLoader />;
  if (me && me.organizations.length === 0) return <Navigate to="/onboarding" replace />;
  if (!org) return <FullPageLoader />;
  return <>{children}</>;
}

export function RequireSuperAdmin({ children }: { children: ReactNode }) {
  const { me, meLoading } = useSession();
  const { t } = useTranslation();
  if (meLoading) return <FullPageLoader />;
  if (!me?.is_super_admin) return <EmptyState className="m-8" icon={<ShieldAlert />} title={t('errors.super_admin_required')} />;
  return <>{children}</>;
}

/** Shows a paywall when the subscription isn't active (server enforces the same rule). */
export function RequirePaid({ children }: { children: ReactNode }) {
  const { org, can } = useSession();
  const { t } = useTranslation();
  if (!org) return <LoadingBlock />;
  if (!org.billing.active) {
    return (
      <EmptyState
        className="mx-auto mt-10 max-w-xl"
        icon={<CreditCard />}
        title={org.billing.plan_code ? t('billing.expiredTitle') : t('billing.noSubscriptionTitle')}
        description={t('billing.lockedDescription')}
        action={
          can('billing.manage') ? (
            <Button asChild variant="brand">
              <Link to="/app/settings/billing">{t('billing.choosePlan')}</Link>
            </Button>
          ) : (
            <p className="text-sm text-muted-foreground">{t('billing.askOwner')}</p>
          )
        }
      />
    );
  }
  return <>{children}</>;
}

export function Can({ permission, children, fallback = null }: { permission: Permission; children: ReactNode; fallback?: ReactNode }) {
  const { can } = useSession();
  return <>{can(permission) ? children : fallback}</>;
}

export function NoAccess() {
  const { t } = useTranslation();
  return <EmptyState className="mt-10" icon={<Lock />} title={t('errors.forbidden')} />;
}

export function FeatureGate({ feature, children }: { feature: string; children: ReactNode }) {
  const { hasFeature, can } = useSession();
  const { t } = useTranslation();
  if (hasFeature(feature)) return <>{children}</>;
  return (
    <EmptyState
      className="mx-auto mt-10 max-w-xl"
      icon={<Lock />}
      title={t('billing.featureLockedTitle')}
      description={t('billing.featureLockedDescription')}
      action={can('billing.manage') ? <Button asChild variant="outline"><Link to="/app/settings/billing">{t('billing.upgrade')}</Link></Button> : undefined}
    />
  );
}
