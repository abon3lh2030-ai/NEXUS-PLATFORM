import { Avatar, Badge, Button, EmptyState, PageHeader, Progress, Section, StatCard } from '@nexus/ui';
import { useMutation, useQuery } from '@tanstack/react-query';
import { AlertTriangle, Bot, CheckCircle2, Clock, Gauge, Sparkles, UserRound, Users } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { LoadingBlock, Markdown, StatusBadge } from '@/components/common';
import { api, apiPost } from '@/lib/api';
import { formatDate, formatNumber, formatRelative } from '@/lib/format';

interface WorkStats {
  open: number;
  in_progress: number;
  review: number;
  blocked: number;
  overdue: number;
  done_7d: number;
  done_30d: number;
  progress_pct: number | null;
  current: Array<{ id: string; title: string; status: string; due_date: string | null }>;
  last_task_activity_at: string | null;
}

interface TeamOverview {
  generated_at: string;
  summary: { humans_total: number; humans_online: number; ai_total: number; ai_working: number; in_progress: number; overdue: number; blocked: number; done_7d: number };
  humans: Array<{ member_id: string; name: string; role: string; online: boolean; last_seen_at: string | null; work: WorkStats }>;
  ai: Array<{ ai_employee_id: string; name: string; job_title: string; status: string; working: boolean; current_step: string | null; current_task: string | null; work: WorkStats }>;
}

type Filter = 'all' | 'humans' | 'ai' | 'attention';

/** Manager view: every person and AI employee, whether they're working now and how far along their work is. */
export function TeamPage() {
  const { t, i18n } = useTranslation();
  const [filter, setFilter] = useState<Filter>('all');
  const { data, isLoading } = useQuery({ queryKey: ['team-overview'], queryFn: () => api<TeamOverview>('/team/overview'), refetchInterval: 30_000 });
  const report = useMutation({ mutationFn: () => apiPost<{ report: string; generated_at: string }>('/team/ai-report', { language: i18n.language === 'ar' ? 'ar' : 'en' }) });

  if (isLoading || !data) return <LoadingBlock />;
  const s = data.summary;
  const needsAttention = (w: WorkStats) => w.overdue > 0 || w.blocked > 0;
  const humans = data.humans.filter((h) => filter === 'all' || filter === 'humans' || (filter === 'attention' && needsAttention(h.work)));
  const ai = data.ai.filter((a) => filter === 'all' || filter === 'ai' || (filter === 'attention' && needsAttention(a.work)));

  return (
    <>
      <PageHeader
        title={t('nav.team')}
        description={t('team.description')}
        icon={<Users />}
        actions={
          <Button onClick={() => report.mutate()} loading={report.isPending}>
            <Sparkles /> {t('team.aiReport')}
          </Button>
        }
      />

      <div className="mt-4 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label={t('team.onlineNow')} value={t('team.xOfY', { x: formatNumber(s.humans_online), y: formatNumber(s.humans_total) })} icon={<UserRound />} hint={t('team.onlineHint')} />
        <StatCard label={t('team.aiWorking')} value={t('team.xOfY', { x: formatNumber(s.ai_working), y: formatNumber(s.ai_total) })} icon={<Bot />} />
        <StatCard label={t('team.inProgress')} value={formatNumber(s.in_progress)} icon={<Gauge />} hint={t('team.doneWeek', { count: s.done_7d })} />
        <StatCard label={t('team.needsAttention')} value={formatNumber(s.overdue + s.blocked)} icon={<AlertTriangle />} hint={t('team.overdueBlocked', { overdue: s.overdue, blocked: s.blocked })} />
      </div>

      {report.data && (
        <Section className="mt-6" title={<span className="flex items-center gap-2"><Sparkles className="size-4" /> {t('team.aiReport')}</span>}>
          <Markdown>{report.data.report}</Markdown>
          <p className="mt-2 text-xs text-muted-foreground">{formatRelative(report.data.generated_at)}</p>
        </Section>
      )}

      <div className="mt-6 flex flex-wrap gap-2">
        {(['all', 'humans', 'ai', 'attention'] as const).map((f) => (
          <Button key={f} size="sm" variant={filter === f ? 'default' : 'outline'} onClick={() => setFilter(f)}>{t(`team.filters.${f}`)}</Button>
        ))}
      </div>

      {humans.length + ai.length === 0 ? (
        <EmptyState className="mt-6" icon={<CheckCircle2 />} title={t('team.empty')} />
      ) : (
        <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {humans.map((h) => (
            <PersonCard
              key={h.member_id}
              name={h.name}
              subtitle={t(`roles.${h.role}`, h.role)}
              kind="human"
              statusLine={
                h.online ? (
                  <Badge tone="success"><span className="size-1.5 rounded-full bg-current" /> {t('team.online')}</Badge>
                ) : (
                  <Badge tone="neutral">{h.last_seen_at ? t('team.lastSeen', { when: formatRelative(h.last_seen_at) }) : t('team.neverSeen')}</Badge>
                )
              }
              work={h.work}
            />
          ))}
          {ai.map((a) => (
            <PersonCard
              key={a.ai_employee_id}
              name={a.name}
              subtitle={a.job_title}
              kind="ai"
              link={`/app/workforce/${a.ai_employee_id}`}
              statusLine={<StatusBadge value={a.status} />}
              now={a.working && (a.current_task || a.current_step) ? `${a.current_task ?? ''}${a.current_step ? ` — ${a.current_step}` : ''}` : null}
              work={a.work}
            />
          ))}
        </div>
      )}
      <p className="mt-4 text-xs text-muted-foreground">{t('team.progressHint')}</p>
    </>
  );
}

function PersonCard({ name, subtitle, kind, statusLine, now, work, link }: { name: string; subtitle: string; kind: 'human' | 'ai'; statusLine: React.ReactNode; now?: string | null; work: WorkStats; link?: string }) {
  const { t } = useTranslation();
  const title = link ? <Link to={link} className="hover:underline">{name}</Link> : name;
  return (
    <div className="grid content-start gap-3 rounded-xl border bg-card p-4">
      <div className="flex items-center gap-3">
        <Avatar name={name} square={kind === 'ai'} />
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-1.5 truncate font-medium" dir="auto">{kind === 'ai' && <Bot className="size-4 shrink-0 text-primary" />}{title}</p>
          <p className="truncate text-xs text-muted-foreground" dir="auto">{subtitle}</p>
        </div>
        {statusLine}
      </div>

      {now && <p className="rounded-lg bg-primary/5 px-3 py-2 text-xs" dir="auto"><span className="font-medium">{t('team.workingOn')}: </span>{now}</p>}

      <div className="grid gap-1.5">
        <div className="flex items-center justify-between text-xs">
          <span className="text-muted-foreground">{t('team.progress')}</span>
          <span className="tabular-nums font-medium">{work.progress_pct === null ? '—' : `${work.progress_pct}%`}</span>
        </div>
        <Progress value={work.progress_pct ?? 0} />
      </div>

      <div className="flex flex-wrap gap-1.5 text-xs">
        <Badge tone="info">{t('team.badges.inProgress', { count: work.in_progress })}</Badge>
        {work.review > 0 && <Badge>{t('team.badges.review', { count: work.review })}</Badge>}
        {work.overdue > 0 && <Badge tone="danger"><Clock /> {t('team.badges.overdue', { count: work.overdue })}</Badge>}
        {work.blocked > 0 && <Badge tone="warning">{t('team.badges.blocked', { count: work.blocked })}</Badge>}
        <Badge tone="success">{t('team.badges.doneWeek', { count: work.done_7d })}</Badge>
      </div>

      {work.current.length > 0 ? (
        <ul className="grid gap-1 text-sm">
          {work.current.map((task) => (
            <li key={task.id} className="flex items-center gap-2">
              <Link to={`/app/tasks/${task.id}`} className="min-w-0 flex-1 truncate hover:underline" dir="auto">{task.title}</Link>
              {task.due_date && <span className={`shrink-0 text-xs ${Date.parse(task.due_date) < Date.now() ? 'text-destructive' : 'text-muted-foreground'}`}>{formatDate(task.due_date)}</span>}
              <StatusBadge value={task.status} />
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">{t('team.noOpenTasks')}</p>
      )}
      {work.last_task_activity_at && <p className="text-xs text-muted-foreground">{t('team.lastTaskUpdate', { when: formatRelative(work.last_task_activity_at) })}</p>}
    </div>
  );
}
