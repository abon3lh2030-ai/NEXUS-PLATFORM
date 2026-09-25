import { Badge, Button, Card, EmptyState, PageHeader, Progress, Section, StatCard, Tabs, TabsList, TabsTrigger, cn } from '@nexus/ui';
import { GOAL_STATUSES, PRIORITIES, WORK_STATUSES } from '@nexus/shared';
import { useQuery } from '@tanstack/react-query';
import { Bot, Flag, FolderKanban, GanttChart, Kanban, List, Pencil, Plus, Sparkles, Target, Trash2, Users } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { LoadingBlock, Markdown, StatusBadge, useAction } from '@/components/common';
import { NoAccess } from '@/components/guards';
import { LinkedFiles } from '@/features/files/attachments';
import { api, apiDelete, apiPatch, apiPost } from '@/lib/api';
import { formatDate, formatDateTime, formatNumber } from '@/lib/format';
import { useSession } from '@/providers/session';
import { EntityDialog, useEntityList, useOptions, type FieldDef } from './shared';
import { TaskBoard, TaskList, type Task } from './tasks';

interface Project {
  id: string;
  title: string;
  description: string;
  status: string;
  priority: string;
  progress: number;
  start_date: string | null;
  due_date: string | null;
  mission_id: string | null;
  department_id: string | null;
  owner_member_id: string | null;
  created_by: string | null;
}

function useProjectFields(): FieldDef[] {
  const { t } = useTranslation();
  const o = useOptions();
  return [
    { name: 'title', label: t('fields.title'), type: 'text', required: true, full: true },
    { name: 'description', label: t('fields.description'), type: 'textarea' },
    { name: 'mission_id', label: t('fields.mission'), type: 'select', options: o.missions },
    { name: 'department_id', label: t('fields.department'), type: 'select', options: o.departments },
    { name: 'owner_member_id', label: t('fields.owner'), type: 'select', options: o.members },
    { name: 'status', label: t('fields.status'), type: 'select', options: o.enumOpts('status', WORK_STATUSES), required: true },
    { name: 'priority', label: t('fields.priority'), type: 'select', options: o.enumOpts('priority', PRIORITIES), required: true },
    { name: 'start_date', label: t('fields.startDate'), type: 'date' },
    { name: 'due_date', label: t('fields.dueDate'), type: 'date' },
  ];
}

function Timeline({ items }: { items: Array<{ id: string; title: string; start_date: string | null; due_date: string | null; progress: number; to: string }> }) {
  const { t } = useTranslation();
  const dated = items.filter((i) => i.start_date || i.due_date);
  if (!dated.length) return <EmptyState icon={<GanttChart />} title={t('views.noDates')} />;
  const times = dated.flatMap((i) => [i.start_date, i.due_date].filter(Boolean).map((d) => new Date(d!).getTime()));
  const min = Math.min(...times, Date.now());
  const max = Math.max(...times, Date.now()) + 86400_000;
  const pos = (d: string | null, fallback: number) => ((d ? new Date(d).getTime() : fallback) - min) / (max - min);
  const today = (Date.now() - min) / (max - min);
  return (
    <div className="overflow-x-auto rounded-xl border bg-card p-4">
      <div className="relative min-w-[640px]">
        <div className="mb-3 flex justify-between text-xs text-muted-foreground"><span>{formatDate(new Date(min).toISOString())}</span><span>{formatDate(new Date(max).toISOString())}</span></div>
        <div className="absolute bottom-0 top-6 w-px bg-destructive/60" style={{ insetInlineStart: `${today * 100}%` }} />
        <div className="grid gap-2">
          {dated.map((i) => {
            const start = pos(i.start_date, i.due_date ? new Date(i.due_date).getTime() - 7 * 86400_000 : min);
            const end = pos(i.due_date, max);
            return (
              <div key={i.id} className="grid grid-cols-[180px_1fr] items-center gap-3">
                <Link to={i.to} className="truncate text-sm hover:underline">{i.title}</Link>
                <div className="relative h-7 rounded-md bg-muted/50">
                  <div className="absolute inset-y-1 overflow-hidden rounded bg-primary/25" style={{ insetInlineStart: `${start * 100}%`, width: `${Math.max(2, (end - start) * 100)}%` }}>
                    <div className="h-full bg-primary/70" style={{ width: `${i.progress}%` }} />
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export function ProjectsPage() {
  const { t } = useTranslation();
  const { can } = useSession();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [view, setView] = useState('list');
  const { data, isLoading } = useEntityList<Project>('projects');
  const fields = useProjectFields();
  const o = useOptions();
  return (
    <>
      <PageHeader title={t('nav.projects')} description={t('projects.description')} icon={<FolderKanban />} actions={can('work.create') && <Button onClick={() => setParams({ new: '1' })}><Plus /> {t('command.newProject')}</Button>} />
      <Tabs value={view} onValueChange={setView} className="mb-4"><TabsList><TabsTrigger value="list"><List /> {t('views.list')}</TabsTrigger><TabsTrigger value="kanban"><Kanban /> {t('views.kanban')}</TabsTrigger><TabsTrigger value="timeline"><GanttChart /> {t('views.timeline')}</TabsTrigger></TabsList></Tabs>
      {isLoading ? <LoadingBlock /> : !data?.length ? (
        <EmptyState icon={<FolderKanban />} title={t('projects.empty')} action={can('work.create') ? <Button onClick={() => setParams({ new: '1' })}><Plus /> {t('command.newProject')}</Button> : undefined} />
      ) : view === 'timeline' ? (
        <Timeline items={data.map((p) => ({ ...p, to: `/app/projects/${p.id}` }))} />
      ) : view === 'kanban' ? (
        <div className="flex gap-3 overflow-x-auto pb-4">
          {WORK_STATUSES.map((s) => (
            <div key={s} className="w-72 shrink-0 rounded-xl border bg-muted/30 p-2">
              <div className="px-2 py-1.5"><StatusBadge value={s} /></div>
              <div className="grid gap-2">
                {data.filter((p) => p.status === s).map((p) => (
                  <Link key={p.id} to={`/app/projects/${p.id}`} className="rounded-lg border bg-card p-3 hover:shadow-md">
                    <p className="text-sm font-medium">{p.title}</p>
                    <Progress value={p.progress} className="mt-2" />
                    <p className="mt-1 text-xs text-muted-foreground">{p.progress}% · {formatDate(p.due_date)}</p>
                  </Link>
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {data.map((p) => (
            <Link key={p.id} to={`/app/projects/${p.id}`}>
              <Card className="h-full p-5 hover:shadow-lg">
                <div className="flex items-start gap-2"><p className="flex-1 font-semibold">{p.title}</p><StatusBadge value={p.status} /></div>
                <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">{p.description}</p>
                <Progress value={p.progress} className="mt-4" />
                <div className="mt-2 flex justify-between text-xs text-muted-foreground"><span>{p.progress}%</span><span>{o.departments.find((d) => d.value === p.department_id)?.label ?? ''}</span><span>{formatDate(p.due_date)}</span></div>
              </Card>
            </Link>
          ))}
        </div>
      )}
      <EntityDialog entity="projects" open={params.get('new') === '1'} onOpenChange={(open) => !open && setParams({})} title={t('command.newProject')} fields={fields} initial={{ status: 'planned', priority: 'medium', mission_id: params.get('mission') }} onSaved={(r) => navigate(`/app/projects/${r.id}`)} />
    </>
  );
}

export function ProjectPage() {
  const { id } = useParams();
  const { t } = useTranslation();
  const { can } = useSession();
  const navigate = useNavigate();
  const [edit, setEdit] = useState(false);
  const [view, setView] = useState('board');
  const fields = useProjectFields();
  const o = useOptions();
  const { data: p, isLoading } = useQuery({ queryKey: ['work', 'projects', id], queryFn: () => api<Project & { team: Array<{ member_id: string | null; ai_employee_id: string | null }>; task_counts: Record<string, number> }>(`/work/projects/${id}`) });
  const tasks = useEntityList<Task>('tasks', { project_id: id });
  const remove = useAction(() => apiDelete(`/work/projects/${id}`), { success: t('common.deleted'), invalidate: [['work']], onSuccess: () => navigate('/app/projects') });
  if (isLoading) return <LoadingBlock />;
  if (!p) return <NoAccess />;
  return (
    <>
      <PageHeader
        title={p.title}
        description={p.description}
        icon={<FolderKanban />}
        actions={<>
          <Button asChild><Link to={`/app/tasks?new=1&project=${p.id}`}><Plus /> {t('command.newTask')}</Link></Button>
          <Button variant="outline" onClick={() => setEdit(true)}><Pencil /> {t('common.edit')}</Button>
          {can('work.manage') && <Button variant="ghost" size="icon" onClick={() => remove.mutate(undefined)} aria-label={t('common.delete')}><Trash2 /></Button>}
        </>}
      />
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label={t('fields.status')} value={<StatusBadge value={p.status} />} />
        <StatCard label={t('fields.progress')} value={`${p.progress}%`} />
        <StatCard label={t('fields.dueDate')} value={<span className="text-base">{formatDate(p.due_date)}</span>} />
        <StatCard label={t('nav.tasks')} value={formatNumber(Object.values(p.task_counts).reduce((a, b) => a + b, 0))} hint={t('projects.doneCount', { count: p.task_counts.done ?? 0 })} />
      </div>
      <div className="mt-6 grid gap-6 xl:grid-cols-4">
        <div className="xl:col-span-3">
          <Tabs value={view} onValueChange={setView} className="mb-3"><TabsList><TabsTrigger value="board"><Kanban /> {t('views.kanban')}</TabsTrigger><TabsTrigger value="list"><List /> {t('views.list')}</TabsTrigger></TabsList></Tabs>
          {tasks.data?.length ? (view === 'board' ? <TaskBoard tasks={tasks.data} onMove={(tid, status) => void apiPatch(`/work/tasks/${tid}`, { status }).then(() => tasks.refetch())} /> : <TaskList tasks={tasks.data} />) : <EmptyState icon={<Flag />} title={t('tasks.empty')} />}
        </div>
        <div className="grid content-start gap-6">
          <Section title={<span className="flex items-center gap-2"><Users className="size-4" /> {t('projects.team')}</span>}>
            <ul className="grid gap-1.5 text-sm">
              {p.team.map((m, i) => <li key={i} className="flex items-center gap-2">{m.ai_employee_id ? <><Bot className="size-4 text-primary" />{o.aiName(m.ai_employee_id)}</> : <><Users className="size-4 text-muted-foreground" />{o.memberName(m.member_id)}</>}</li>)}
              {p.team.length === 0 && <li className="text-muted-foreground">—</li>}
            </ul>
          </Section>
          <LinkedFiles entityType="project" entityId={p.id} />
        </div>
      </div>
      <EntityDialog entity="projects" id={p.id} open={edit} onOpenChange={setEdit} title={t('common.edit')} fields={fields} initial={p as unknown as Record<string, unknown>} />
    </>
  );
}

interface Mission extends Project {
  objective: string;
  goal_id: string | null;
  ai_summary: string | null;
  ai_summary_at: string | null;
  milestones: Array<{ title: string; due_date?: string | null; done: boolean }>;
  risks: Array<{ title: string; severity: string }>;
}

function useMissionFields(): FieldDef[] {
  const { t } = useTranslation();
  const o = useOptions();
  return [
    { name: 'title', label: t('fields.title'), type: 'text', required: true, full: true },
    { name: 'objective', label: t('fields.objective'), type: 'textarea' },
    { name: 'description', label: t('fields.description'), type: 'textarea' },
    { name: 'goal_id', label: t('fields.goal'), type: 'select', options: o.goals },
    { name: 'owner_member_id', label: t('fields.owner'), type: 'select', options: o.members },
    { name: 'status', label: t('fields.status'), type: 'select', options: o.enumOpts('status', WORK_STATUSES), required: true },
    { name: 'priority', label: t('fields.priority'), type: 'select', options: o.enumOpts('priority', PRIORITIES), required: true },
    { name: 'start_date', label: t('fields.startDate'), type: 'date' },
    { name: 'due_date', label: t('fields.dueDate'), type: 'date' },
  ];
}

export function MissionsPage() {
  const { t } = useTranslation();
  const { can } = useSession();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const { data, isLoading } = useEntityList<Mission>('missions');
  const fields = useMissionFields();
  return (
    <>
      <PageHeader title={t('nav.missions')} description={t('missions.description')} icon={<Flag />} actions={can('work.manage') && <Button onClick={() => setParams({ new: '1' })}><Plus /> {t('command.newMission')}</Button>} />
      {isLoading ? <LoadingBlock /> : !data?.length ? <EmptyState icon={<Flag />} title={t('missions.empty')} /> : (
        <div className="grid gap-3 lg:grid-cols-2">
          {data.map((m) => (
            <Link key={m.id} to={`/app/missions/${m.id}`}>
              <Card className="h-full p-5 hover:shadow-lg">
                <div className="flex items-center gap-2"><p className="flex-1 font-semibold">{m.title}</p><StatusBadge value={m.priority} /><StatusBadge value={m.status} /></div>
                <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">{m.objective || m.description}</p>
                <Progress value={m.progress} className="mt-4" />
                <p className="mt-2 text-xs text-muted-foreground">{m.progress}% · {formatDate(m.due_date)}</p>
              </Card>
            </Link>
          ))}
        </div>
      )}
      <EntityDialog entity="missions" open={params.get('new') === '1'} onOpenChange={(o) => !o && setParams({})} title={t('command.newMission')} fields={fields} initial={{ status: 'planned', priority: 'medium' }} onSaved={(r) => navigate(`/app/missions/${r.id}`)} />
    </>
  );
}

export function MissionPage() {
  const { id } = useParams();
  const { t, i18n } = useTranslation();
  const { can } = useSession();
  const [edit, setEdit] = useState(false);
  const fields = useMissionFields();
  const o = useOptions();
  const { data: m, isLoading } = useQuery({ queryKey: ['work', 'missions', id], queryFn: () => api<Mission & { department_ids: string[]; employees: Array<{ member_id: string | null; ai_employee_id: string | null }>; projects: Array<{ id: string; title: string; status: string; progress: number }> }>(`/work/missions/${id}`) });
  const summary = useAction(() => apiPost(`/work/missions/${id}/ai/summary?locale=${i18n.language}`), { success: t('missions.summaryReady'), invalidate: [['work', 'missions', id]] });
  if (isLoading) return <LoadingBlock />;
  if (!m) return <NoAccess />;
  return (
    <>
      <PageHeader title={m.title} description={m.objective} icon={<Flag />} actions={<><Button asChild variant="outline"><Link to={`/app/projects?new=1&mission=${m.id}`}><Plus /> {t('command.newProject')}</Link></Button>{can('work.manage') && <Button variant="outline" onClick={() => setEdit(true)}><Pencil /> {t('common.edit')}</Button>}</>} />
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label={t('fields.status')} value={<StatusBadge value={m.status} />} />
        <StatCard label={t('fields.progress')} value={`${m.progress}%`} />
        <StatCard label={t('fields.priority')} value={<StatusBadge value={m.priority} />} />
        <StatCard label={t('fields.dueDate')} value={<span className="text-base">{formatDate(m.due_date)}</span>} />
      </div>
      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <div className="grid content-start gap-6 lg:col-span-2">
          <Section title={<span className="flex items-center gap-2"><Sparkles className="size-4" /> {t('missions.aiSummary')}</span>} actions={<Button size="sm" variant="outline" loading={summary.isPending} onClick={() => summary.mutate(undefined)}>{m.ai_summary ? t('missions.refreshSummary') : t('missions.generateSummary')}</Button>}>
            {m.ai_summary ? <><Markdown>{m.ai_summary}</Markdown><p className="mt-2 text-xs text-muted-foreground">{formatDateTime(m.ai_summary_at)}</p></> : <p className="text-sm text-muted-foreground">{t('missions.noSummary')}</p>}
          </Section>
          <Section title={t('nav.projects')}>
            {m.projects.length === 0 ? <p className="text-sm text-muted-foreground">{t('projects.empty')}</p> : (
              <ul className="grid gap-2">{m.projects.map((p) => <li key={p.id}><Link to={`/app/projects/${p.id}`} className="flex items-center gap-3 rounded-lg border p-3 hover:bg-muted/50"><span className="flex-1 font-medium">{p.title}</span><div className="w-32"><Progress value={p.progress} /></div><StatusBadge value={p.status} /></Link></li>)}</ul>
            )}
          </Section>
          {m.description && <Section title={t('fields.description')}><Markdown>{m.description}</Markdown></Section>}
        </div>
        <div className="grid content-start gap-6">
          <Section title={t('missions.milestones')}>
            {m.milestones.length === 0 ? <p className="text-sm text-muted-foreground">—</p> : <ul className="grid gap-1.5 text-sm">{m.milestones.map((x, i) => <li key={i} className={cn(x.done && 'text-muted-foreground line-through')}>{x.title} {x.due_date && <span className="text-xs">· {formatDate(x.due_date)}</span>}</li>)}</ul>}
          </Section>
          <Section title={t('missions.risks')}>
            {m.risks.length === 0 ? <p className="text-sm text-muted-foreground">—</p> : <ul className="grid gap-1.5 text-sm">{m.risks.map((x, i) => <li key={i} className="flex items-center gap-2"><StatusBadge value={x.severity} />{x.title}</li>)}</ul>}
          </Section>
          <Section title={t('missions.team')}>
            <div className="flex flex-wrap gap-1.5">
              {m.department_ids.map((d) => <Badge key={d}>{o.departments.find((x) => x.value === d)?.label}</Badge>)}
              {m.employees.map((e, i) => <Badge key={i} tone={e.ai_employee_id ? 'primary' : 'neutral'}>{e.ai_employee_id ? o.aiName(e.ai_employee_id) : o.memberName(e.member_id)}</Badge>)}
              {m.department_ids.length + m.employees.length === 0 && <span className="text-sm text-muted-foreground">—</span>}
            </div>
          </Section>
          <LinkedFiles entityType="mission" entityId={m.id} />
        </div>
      </div>
      <EntityDialog entity="missions" id={m.id} open={edit} onOpenChange={setEdit} title={t('common.edit')} fields={fields} initial={m as unknown as Record<string, unknown>} />
    </>
  );
}

interface Goal { id: string; title: string; description: string; metric: string; current_value: number; target_value: number; deadline: string | null; status: string; owner_member_id: string | null }

export function GoalsPage() {
  const { t } = useTranslation();
  const { can } = useSession();
  const o = useOptions();
  const [dialog, setDialog] = useState<{ open: boolean; goal?: Goal }>({ open: false });
  const { data, isLoading } = useEntityList<Goal>('goals');
  const fields: FieldDef[] = [
    { name: 'title', label: t('fields.title'), type: 'text', required: true, full: true },
    { name: 'description', label: t('fields.description'), type: 'textarea' },
    { name: 'metric', label: t('goals.metric'), type: 'text' },
    { name: 'owner_member_id', label: t('fields.owner'), type: 'select', options: o.members },
    { name: 'current_value', label: t('goals.current'), type: 'number' },
    { name: 'target_value', label: t('goals.target'), type: 'number' },
    { name: 'deadline', label: t('goals.deadline'), type: 'date' },
    { name: 'status', label: t('fields.status'), type: 'select', options: o.enumOpts('status', GOAL_STATUSES), required: true },
  ];
  return (
    <>
      <PageHeader title={t('nav.goals')} description={t('goals.description')} icon={<Target />} actions={can('work.manage') && <Button onClick={() => setDialog({ open: true })}><Plus /> {t('goals.new')}</Button>} />
      {isLoading ? <LoadingBlock /> : !data?.length ? <EmptyState icon={<Target />} title={t('goals.empty')} /> : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {data.map((g) => {
            const pct = g.target_value ? Math.round((Number(g.current_value) / Number(g.target_value)) * 100) : 0;
            return (
              <Card key={g.id} className="p-5">
                <div className="flex items-start gap-2"><p className="flex-1 font-semibold">{g.title}</p><StatusBadge value={g.status} />{can('work.manage') && <Button variant="ghost" size="icon-sm" onClick={() => setDialog({ open: true, goal: g })} aria-label={t('common.edit')}><Pencil /></Button>}</div>
                {g.metric && <p className="mt-1 text-sm text-muted-foreground">{g.metric}</p>}
                <div className="mt-4 flex items-baseline gap-1"><span className="text-2xl font-semibold tabular-nums">{formatNumber(Number(g.current_value), 2)}</span><span className="text-sm text-muted-foreground">/ {formatNumber(Number(g.target_value), 2)}</span></div>
                <Progress value={pct} className="mt-2" />
                <p className="mt-2 text-xs text-muted-foreground">{pct}% · {g.deadline ? formatDate(g.deadline) : '—'} · {o.memberName(g.owner_member_id) ?? ''}</p>
              </Card>
            );
          })}
        </div>
      )}
      <EntityDialog entity="goals" id={dialog.goal?.id} open={dialog.open} onOpenChange={(open) => setDialog({ open })} title={dialog.goal ? t('common.edit') : t('goals.new')} fields={fields} initial={(dialog.goal as unknown as Record<string, unknown>) ?? { status: 'on_track', current_value: 0, target_value: 100 }} />
    </>
  );
}

interface Department { id: string; name: string; description: string; objective: string; lead_member_id: string | null; lead_ai_employee_id: string | null; parent_id: string | null; kpis: Array<{ name: string; target: string; current: string }> }

export function DepartmentsPage() {
  const { t } = useTranslation();
  const { can } = useSession();
  const o = useOptions();
  const [dialog, setDialog] = useState<{ open: boolean; dep?: Department }>({ open: false });
  const { data, isLoading } = useEntityList<Department>('departments');
  const members = useQuery({ queryKey: ['members'], queryFn: () => api<Array<{ id: string; department_id: string | null }>>('/org/members') });
  const ais = useQuery({ queryKey: ['ai-employees'], queryFn: () => api<Array<{ id: string; department_id: string | null; status: string }>>('/ai/employees') });
  const projects = useEntityList<{ id: string; department_id: string | null; status: string }>('projects');
  const stats = useMemo(() => (depId: string) => ({
    humans: (members.data ?? []).filter((m) => m.department_id === depId).length,
    ai: (ais.data ?? []).filter((m) => m.department_id === depId).length,
    busy: (ais.data ?? []).filter((m) => m.department_id === depId && !['idle', 'offline'].includes(m.status)).length,
    projects: (projects.data ?? []).filter((p) => p.department_id === depId && p.status !== 'completed').length,
  }), [members.data, ais.data, projects.data]);
  const fields: FieldDef[] = [
    { name: 'name', label: t('fields.name'), type: 'text', required: true },
    { name: 'parent_id', label: t('departments.parent'), type: 'select', options: o.departments.filter((d) => d.value !== dialog.dep?.id) },
    { name: 'objective', label: t('fields.objective'), type: 'textarea' },
    { name: 'description', label: t('fields.description'), type: 'textarea' },
    { name: 'lead_member_id', label: t('departments.leadHuman'), type: 'select', options: o.members },
    { name: 'lead_ai_employee_id', label: t('departments.leadAi'), type: 'select', options: o.ais },
  ];
  return (
    <>
      <PageHeader title={t('nav.departments')} description={t('departments.description')} icon={<Users />} actions={can('departments.manage') && <Button onClick={() => setDialog({ open: true })}><Plus /> {t('departments.new')}</Button>} />
      {isLoading ? <LoadingBlock /> : !data?.length ? <EmptyState icon={<Users />} title={t('departments.empty')} /> : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {data.map((d) => {
            const s = stats(d.id);
            const load = s.ai ? Math.round((s.busy / s.ai) * 100) : 0;
            return (
              <Card key={d.id} className="p-5">
                <div className="flex items-start gap-2"><p className="flex-1 font-semibold">{d.name}</p>{can('departments.manage') && <Button variant="ghost" size="icon-sm" onClick={() => setDialog({ open: true, dep: d })} aria-label={t('common.edit')}><Pencil /></Button>}</div>
                <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">{d.objective || d.description}</p>
                <div className="mt-4 grid grid-cols-3 gap-2 text-center text-xs">
                  <div className="rounded-lg bg-muted/50 p-2"><p className="text-lg font-semibold">{s.humans}</p>{t('departments.humans')}</div>
                  <div className="rounded-lg bg-muted/50 p-2"><p className="text-lg font-semibold">{s.ai}</p>{t('departments.ai')}</div>
                  <div className="rounded-lg bg-muted/50 p-2"><p className="text-lg font-semibold">{s.projects}</p>{t('nav.projects')}</div>
                </div>
                <div className="mt-3"><div className="flex justify-between text-xs text-muted-foreground"><span>{t('departments.workload')}</span><span>{load}%</span></div><Progress value={load} className="mt-1" /></div>
                <p className="mt-3 text-xs text-muted-foreground">{t('departments.lead')}: {o.memberName(d.lead_member_id) ?? o.aiName(d.lead_ai_employee_id) ?? '—'}</p>
              </Card>
            );
          })}
        </div>
      )}
      <EntityDialog entity="departments" id={dialog.dep?.id} open={dialog.open} onOpenChange={(open) => setDialog({ open })} title={dialog.dep ? t('common.edit') : t('departments.new')} fields={fields} initial={dialog.dep as unknown as Record<string, unknown>} />
    </>
  );
}
