import { Badge, Button, PageHeader, Section, StatCard, cn } from '@nexus/ui';
import { useQuery } from '@tanstack/react-query';
import { Activity, Bot, CheckCircle2, FolderKanban, Gauge, ListChecks, Sparkles, Users } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { LoadingBlock, MockBanner } from '@/components/common';
import { CompanyLogo } from '@/components/company-logo';
import { api } from '@/lib/api';
import { formatNumber, formatRelative } from '@/lib/format';
import { useSession } from '@/providers/session';

export interface HealthReport {
  score: number;
  grade: 'excellent' | 'good' | 'fair' | 'poor';
  reasons: Array<{ key: string; impact: number; detail: Record<string, number> }>;
}

interface Dashboard {
  snapshot: { departments: number; humans: number; ai_employees: number; active_projects: number; open_tasks: number; pending_approvals: number; running_ai_sessions: number };
  health: HealthReport;
  activity: Array<{ id: number; verb: string; entity_type: string; summary: string; created_at: string; actor_ai_employee_id: string | null }>;
}

export function HealthCard({ health }: { health: HealthReport }) {
  const { t } = useTranslation();
  const color = health.score >= 85 ? 'text-success' : health.score >= 70 ? 'text-primary' : health.score >= 50 ? 'text-warning' : 'text-destructive';
  return (
    <Section title={<span className="flex items-center gap-2"><Gauge className="size-4" /> {t('dashboard.health')}</span>}>
      <div className="flex items-center gap-5">
        <div className={cn('text-5xl font-semibold tabular-nums', color)}>{health.score}</div>
        <div>
          <Badge tone={health.score >= 70 ? 'success' : health.score >= 50 ? 'warning' : 'danger'}>{t(`dashboard.grades.${health.grade}`)}</Badge>
          <p className="mt-1 text-xs text-muted-foreground">{t('dashboard.healthHint')}</p>
        </div>
      </div>
      <div className="mt-4 grid gap-2">
        {health.reasons.length === 0 && <p className="text-sm text-muted-foreground">{t('dashboard.noIssues')}</p>}
        {health.reasons.map((r) => (
          <div key={r.key} className="flex items-center justify-between gap-3 rounded-lg bg-muted/50 px-3 py-2 text-sm">
            <span>{t(`dashboard.reasons.${r.key}`, r.detail)}</span>
            <span className="font-mono text-xs text-destructive">−{r.impact}</span>
          </div>
        ))}
      </div>
    </Section>
  );
}

export function DashboardPage() {
  const { t } = useTranslation();
  const { org, me, can } = useSession();
  const { data, isLoading } = useQuery({ queryKey: ['dashboard'], queryFn: () => api<Dashboard>('/dashboard'), refetchInterval: 30_000 });
  const name = me?.profile?.full_name?.split(' ')[0] ?? '';

  return (
    <>
      <PageHeader
        title={t('dashboard.greeting', { name })}
        description={org?.organization.name}
        icon={<CompanyLogo className="size-10 rounded-xl" />}
        actions={
          <>
            {can('nexus_ai.use') && <Button asChild variant="brand"><Link to="/app/nexus"><Sparkles /> {t('command.askNexus')}</Link></Button>}
            {can('work.create') && <Button asChild variant="outline"><Link to="/app/tasks?new=1"><ListChecks /> {t('command.newTask')}</Link></Button>}
          </>
        }
      />
      <MockBanner show={Boolean(org?.ai.is_mock)} />
      {isLoading || !data ? (
        <LoadingBlock className="mt-4" />
      ) : (
        <div className="mt-4 grid gap-6">
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <StatCard label={t('dashboard.aiEmployees')} value={formatNumber(data.snapshot.ai_employees)} icon={<Bot />} hint={t('dashboard.runningNow', { count: data.snapshot.running_ai_sessions })} />
            <StatCard label={t('dashboard.humans')} value={formatNumber(data.snapshot.humans)} icon={<Users />} hint={t('dashboard.departmentsCount', { count: data.snapshot.departments })} />
            <StatCard label={t('dashboard.activeProjects')} value={formatNumber(data.snapshot.active_projects)} icon={<FolderKanban />} hint={t('dashboard.openTasks', { count: data.snapshot.open_tasks })} />
            <StatCard label={t('dashboard.pendingApprovals')} value={formatNumber(data.snapshot.pending_approvals)} icon={<CheckCircle2 />} hint={<Link className="text-primary" to="/app/approvals">{t('common.review')}</Link>} />
          </div>
          <div className="grid gap-6 lg:grid-cols-5">
            <div className="lg:col-span-2"><HealthCard health={data.health} /></div>
            <Section className="lg:col-span-3" title={<span className="flex items-center gap-2"><Activity className="size-4" /> {t('dashboard.activity')}</span>} actions={<Button asChild variant="ghost" size="sm"><Link to="/app/operations">{t('nav.operations')}</Link></Button>}>
              {data.activity.length === 0 ? (
                <p className="py-6 text-center text-sm text-muted-foreground">{t('dashboard.noActivity')}</p>
              ) : (
                <ul className="grid gap-1">
                  {data.activity.map((a) => (
                    <li key={a.id} className="flex items-center gap-3 rounded-lg px-2 py-2 text-sm hover:bg-muted/50">
                      <span className={cn('flex size-7 items-center justify-center rounded-lg', a.actor_ai_employee_id ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground')}>
                        {a.actor_ai_employee_id ? <Bot className="size-3.5" /> : <Users className="size-3.5" />}
                      </span>
                      <span className="min-w-0 flex-1 truncate">{t(`activity.${a.verb}`, a.verb)} · {a.summary}</span>
                      <span className="shrink-0 text-xs text-muted-foreground">{formatRelative(a.created_at)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </Section>
          </div>
          {org && !org.billing.active && (
            <Section title={t('billing.noSubscriptionTitle')}>
              <p className="text-sm text-muted-foreground">{t('billing.lockedDescription')}</p>
              {can('billing.manage') && <Button asChild className="mt-3" variant="brand"><Link to="/app/settings/billing">{t('billing.choosePlan')}</Link></Button>}
            </Section>
          )}
        </div>
      )}
    </>
  );
}
