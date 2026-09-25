import { Avatar, Badge, Button, EmptyState, PageHeader, Section, StatCard, cn } from '@nexus/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Background, Controls, MiniMap, ReactFlow, type Edge, type Node } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { BarChart3, Bell, Bot, Building2, Lock, Network, Users } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router';
import { Bar, BarChart, CartesianGrid, Cell, Line, LineChart, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { LoadingBlock, StatusBadge } from '@/components/common';
import { HealthCard, type HealthReport } from '@/pages/app/dashboard';
import { api, apiPost } from '@/lib/api';
import { formatBytes, formatNumber, formatRelative, formatUsd } from '@/lib/format';
import { useSession } from '@/providers/session';
import { useTheme } from '@/providers/theme';

/* ------------------------------ Analytics ------------------------------ */

interface Analytics {
  task_status: Record<string, number>;
  tasks_completed_by_day: Array<{ date: string; value: number }>;
  human_ai_distribution: { ai: number; human: number; unassigned: number };
  missions: Array<{ id: string; title: string; progress: number; status: string }>;
  projects: Array<{ id: string; title: string; progress: number; status: string }>;
  ai_productivity: Array<{ id: string; name: string; completed: number; failed: number; avg_minutes: number | null; cost_usd: number }>;
  ai_cost_by_day: Array<{ date: string; value: number }>;
  ai_tokens: number;
  ai_cost_usd: number;
  approval_turnaround_hours: number | null;
  approvals_pending: number;
  documents_created: number;
  documents_by_ai: number;
  storage: { used_bytes: number; file_count: number };
  headcount: { humans: number; ai: number };
  activity_by_day: Array<{ date: string; value: number }>;
  advanced_locked: boolean;
}

function useChartColors() {
  const { resolved } = useTheme();
  return resolved === 'dark'
    ? { grid: '#2d3150', text: '#9aa0bd', series: ['#8b7cf6', '#38bdf8', '#34d399', '#fbbf24', '#f87171', '#a3a3a3'] }
    : { grid: '#e6e8f0', text: '#6b7194', series: ['#5b4df0', '#0ea5e9', '#10b981', '#f59e0b', '#ef4444', '#94a3b8'] };
}

export function AnalyticsPage() {
  const { t } = useTranslation();
  const c = useChartColors();
  const [days, setDays] = useState(30);
  const { data, isLoading } = useQuery({ queryKey: ['analytics', days], queryFn: () => api<Analytics>('/analytics', { query: { days } }) });
  const health = useQuery({ queryKey: ['health'], queryFn: () => api<HealthReport>('/health-score') });
  if (isLoading || !data) return <LoadingBlock />;
  const statusData = Object.entries(data.task_status).map(([k, v]) => ({ name: t(`status.${k}`), value: v }));
  const dist = [
    { name: t('analytics.ai'), value: data.human_ai_distribution.ai },
    { name: t('analytics.human'), value: data.human_ai_distribution.human },
    { name: t('analytics.unassigned'), value: data.human_ai_distribution.unassigned },
  ];
  const axis = { stroke: c.text, fontSize: 11, tickLine: false, axisLine: false };
  return (
    <>
      <PageHeader
        title={t('nav.analytics')}
        description={t('analytics.description')}
        icon={<BarChart3 />}
        actions={<div className="flex rounded-lg border p-0.5">{[7, 30, 90].map((d) => <Button key={d} size="sm" variant={days === d ? 'secondary' : 'ghost'} onClick={() => setDays(d)}>{t('analytics.days', { count: d })}</Button>)}</div>}
      />
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-6">
        <StatCard label={t('analytics.aiCost')} value={formatUsd(data.ai_cost_usd)} hint={t('ops.tokens', { count: data.ai_tokens })} />
        <StatCard label={t('analytics.docs')} value={formatNumber(data.documents_created)} hint={t('analytics.byAi', { count: data.documents_by_ai })} />
        <StatCard label={t('analytics.turnaround')} value={data.approval_turnaround_hours === null ? '—' : t('analytics.hours', { count: data.approval_turnaround_hours })} hint={t('analytics.pending', { count: data.approvals_pending })} />
        <StatCard label={t('analytics.storage')} value={formatBytes(data.storage.used_bytes)} hint={t('files.fileCount', { count: data.storage.file_count })} />
        <StatCard label={t('dashboard.humans')} value={formatNumber(data.headcount.humans)} />
        <StatCard label={t('dashboard.aiEmployees')} value={formatNumber(data.headcount.ai)} />
      </div>
      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <Section className="lg:col-span-2" title={t('analytics.completion')}>
          <div className="h-64">
            <ResponsiveContainer>
              <BarChart data={data.tasks_completed_by_day}><CartesianGrid stroke={c.grid} vertical={false} /><XAxis dataKey="date" {...axis} /><YAxis allowDecimals={false} {...axis} width={30} /><Tooltip /><Bar dataKey="value" name={t('analytics.completed')} fill={c.series[0]} radius={[4, 4, 0, 0]} /></BarChart>
            </ResponsiveContainer>
          </div>
        </Section>
        {health.data && <HealthCard health={health.data} />}
        <Section title={t('analytics.taskStatus')}>
          <div className="h-56"><ResponsiveContainer><PieChart><Pie data={statusData} dataKey="value" nameKey="name" innerRadius={50} outerRadius={80} paddingAngle={2}>{statusData.map((_, i) => <Cell key={i} fill={c.series[i % c.series.length]} />)}</Pie><Tooltip /></PieChart></ResponsiveContainer></div>
        </Section>
        <Section title={t('analytics.distribution')}>
          <div className="h-56"><ResponsiveContainer><PieChart><Pie data={dist} dataKey="value" nameKey="name" innerRadius={50} outerRadius={80} paddingAngle={2}>{dist.map((_, i) => <Cell key={i} fill={c.series[i]} />)}</Pie><Tooltip /></PieChart></ResponsiveContainer></div>
          <div className="flex justify-center gap-4 text-xs">{dist.map((d, i) => <span key={d.name} className="flex items-center gap-1.5"><span className="size-2 rounded-full" style={{ background: c.series[i] }} />{d.name}: {d.value}</span>)}</div>
        </Section>
        <Section title={t('analytics.missionProgress')}>
          <ul className="grid gap-2 text-sm">{data.missions.slice(0, 8).map((m) => <li key={m.id}><div className="flex justify-between"><span className="truncate">{m.title}</span><span className="tabular-nums text-muted-foreground">{m.progress}%</span></div><div className="mt-1 h-1.5 rounded-full bg-muted"><div className="h-full rounded-full bg-primary" style={{ width: `${m.progress}%` }} /></div></li>)}{data.missions.length === 0 && <li className="text-muted-foreground">—</li>}</ul>
        </Section>
        {data.advanced_locked ? (
          <Section className="lg:col-span-3" title={t('analytics.advanced')}><p className="flex items-center gap-2 text-sm text-muted-foreground"><Lock className="size-4" /> {t('billing.featureLockedDescription')}</p></Section>
        ) : (
          <>
            <Section className="lg:col-span-2" title={t('analytics.aiCostTrend')}>
              <div className="h-56"><ResponsiveContainer><LineChart data={data.ai_cost_by_day}><CartesianGrid stroke={c.grid} vertical={false} /><XAxis dataKey="date" {...axis} /><YAxis {...axis} width={40} /><Tooltip /><Line type="monotone" dataKey="value" name="USD" stroke={c.series[1]} strokeWidth={2} dot={false} /></LineChart></ResponsiveContainer></div>
            </Section>
            <Section title={t('analytics.aiProductivity')}>
              <ul className="grid gap-2 text-sm">
                {data.ai_productivity.map((a) => <li key={a.id} className="flex items-center gap-2"><Avatar name={a.name} square className="size-6" /><span className="flex-1 truncate">{a.name}</span><Badge tone="success">{a.completed}</Badge>{a.failed > 0 && <Badge tone="danger">{a.failed}</Badge>}<span className="w-14 text-end text-xs text-muted-foreground">{formatUsd(a.cost_usd)}</span></li>)}
                {data.ai_productivity.length === 0 && <li className="text-muted-foreground">—</li>}
              </ul>
            </Section>
            <Section className="lg:col-span-3" title={t('analytics.activity')}>
              <div className="h-48"><ResponsiveContainer><BarChart data={data.activity_by_day}><CartesianGrid stroke={c.grid} vertical={false} /><XAxis dataKey="date" {...axis} /><YAxis allowDecimals={false} {...axis} width={30} /><Tooltip /><Bar dataKey="value" name={t('analytics.events')} fill={c.series[2]} radius={[4, 4, 0, 0]} /></BarChart></ResponsiveContainer></div>
            </Section>
          </>
        )}
      </div>
    </>
  );
}

/* ------------------------------ Organization Graph ------------------------------ */

interface Graph {
  owner_user_id: string;
  departments: Array<{ id: string; name: string; parent_id: string | null; lead_member_id: string | null; lead_ai_employee_id: string | null; objective: string }>;
  members: Array<{ id: string; user_id: string; full_name: string; role: string; job_title: string | null; department_id: string | null }>;
  ai_employees: Array<{ id: string; name: string; job_title: string; department_id: string | null; status: string; avatar_seed: string }>;
}

type Selected = { kind: 'dept' | 'human' | 'ai' | 'ceo'; id: string } | null;

export function OrgGraphPage() {
  const { t } = useTranslation();
  const { org } = useSession();
  const navigate = useNavigate();
  const { data, isLoading } = useQuery({ queryKey: ['org-graph'], queryFn: () => api<Graph>('/work/org-graph') });
  const [selected, setSelected] = useState<Selected>(null);

  const { nodes, edges } = useMemo(() => {
    if (!data) return { nodes: [] as Node[], edges: [] as Edge[] };
    const nodes: Node[] = [];
    const edges: Edge[] = [];
    const owner = data.members.find((m) => m.user_id === data.owner_user_id);
    const card = (title: string, subtitle: string, tone: string) => (
      <div className={cn('min-w-44 rounded-xl border bg-card px-3 py-2 text-start shadow-sm', tone)}>
        <p className="truncate text-xs font-semibold">{title}</p>
        <p className="truncate text-[10px] text-muted-foreground">{subtitle}</p>
      </div>
    );
    nodes.push({ id: 'ceo', position: { x: 0, y: 0 }, data: { label: card(org?.organization.name ?? '', owner ? `${owner.full_name} · CEO` : 'CEO', 'border-primary') }, type: 'default', style: { background: 'transparent', border: 'none', padding: 0, width: 'auto' } });
    const width = 240;
    const deps = data.departments;
    deps.forEach((d, i) => {
      const x = (i - (deps.length - 1) / 2) * width;
      nodes.push({ id: `d:${d.id}`, position: { x, y: 140 }, data: { label: card(d.name, t('orgGraph.department'), 'border-info/40') }, style: { background: 'transparent', border: 'none', padding: 0, width: 'auto' } });
      edges.push({ id: `e:ceo:${d.id}`, source: d.parent_id ? `d:${d.parent_id}` : 'ceo', target: `d:${d.id}`, type: 'smoothstep' });
      const people = [
        ...data.members.filter((m) => m.department_id === d.id).map((m) => ({ id: `h:${m.id}`, title: m.full_name, sub: m.job_title ?? t(`roles.${m.role}`), tone: '' })),
        ...data.ai_employees.filter((a) => a.department_id === d.id).map((a) => ({ id: `a:${a.id}`, title: `🤖 ${a.name}`, sub: `${a.job_title} · ${t(`status.${a.status}`)}`, tone: 'border-primary/40' })),
      ];
      people.forEach((p, j) => {
        nodes.push({ id: p.id, position: { x: x + (j % 2) * 10, y: 260 + j * 70 }, data: { label: card(p.title, p.sub, p.tone) }, style: { background: 'transparent', border: 'none', padding: 0, width: 'auto' } });
        edges.push({ id: `e:${d.id}:${p.id}`, source: `d:${d.id}`, target: p.id, type: 'smoothstep' });
      });
    });
    const unassigned = [...data.ai_employees.filter((a) => !a.department_id).map((a) => ({ id: `a:${a.id}`, title: `🤖 ${a.name}`, sub: a.job_title })), ...data.members.filter((m) => !m.department_id && m.user_id !== data.owner_user_id).map((m) => ({ id: `h:${m.id}`, title: m.full_name, sub: m.job_title ?? t(`roles.${m.role}`) }))];
    const ux = ((deps.length + 1) / 2) * width + 40;
    unassigned.forEach((p, j) => {
      nodes.push({ id: p.id, position: { x: ux, y: 140 + j * 70 }, data: { label: card(p.title, p.sub, 'border-dashed') }, style: { background: 'transparent', border: 'none', padding: 0, width: 'auto' } });
      edges.push({ id: `e:ceo:${p.id}`, source: 'ceo', target: p.id, type: 'smoothstep', style: { strokeDasharray: 4 } });
    });
    return { nodes, edges };
  }, [data, org, t]);

  if (isLoading || !data) return <LoadingBlock />;
  const detail = selected && selected.kind !== 'ceo' ? (selected.kind === 'dept' ? data.departments.find((d) => d.id === selected.id) : selected.kind === 'ai' ? data.ai_employees.find((a) => a.id === selected.id) : data.members.find((m) => m.id === selected.id)) : null;

  return (
    <>
      <PageHeader title={t('nav.orgGraph')} description={t('orgGraph.description')} icon={<Network />} />
      <div className="grid gap-4 lg:grid-cols-[1fr_300px]">
        <div className="h-[70dvh] overflow-hidden rounded-xl border bg-card" dir="ltr">
          <ReactFlow
            nodes={nodes}
            edges={edges}
            fitView
            nodesDraggable
            proOptions={{ hideAttribution: true }}
            onNodeClick={(_, n) => {
              const [kind, id] = n.id.includes(':') ? (n.id.split(':') as [string, string]) : ['ceo', 'ceo'];
              setSelected({ kind: kind === 'd' ? 'dept' : kind === 'a' ? 'ai' : kind === 'h' ? 'human' : 'ceo', id });
            }}
          >
            <Background gap={24} />
            <Controls showInteractive={false} />
            <MiniMap pannable zoomable className="!bg-surface" />
          </ReactFlow>
        </div>
        <Section title={t('orgGraph.details')}>
          {!detail ? <p className="text-sm text-muted-foreground">{t('orgGraph.selectHint')}</p> : selected?.kind === 'ai' && 'status' in detail ? (
            <div className="grid gap-3">
              <div className="flex items-center gap-3"><Avatar name={detail.name} square className="size-10" /><div><p className="font-semibold">{detail.name}</p><p className="text-xs text-muted-foreground">{detail.job_title}</p></div></div>
              <StatusBadge value={detail.status} />
              <Button size="sm" onClick={() => navigate(`/app/workforce/${detail.id}`)}><Bot /> {t('orgGraph.openProfile')}</Button>
            </div>
          ) : selected?.kind === 'dept' && 'objective' in detail ? (
            <div className="grid gap-2"><p className="flex items-center gap-2 font-semibold"><Building2 className="size-4" /> {detail.name}</p><p className="text-sm text-muted-foreground">{detail.objective || '—'}</p><Link className="text-sm text-primary" to="/app/departments">{t('nav.departments')}</Link></div>
          ) : 'full_name' in detail ? (
            <div className="grid gap-2"><p className="flex items-center gap-2 font-semibold"><Users className="size-4" /> {detail.full_name}</p><p className="text-sm text-muted-foreground">{detail.job_title ?? ''} · {t(`roles.${detail.role}`)}</p></div>
          ) : null}
        </Section>
      </div>
    </>
  );
}

/* ------------------------------ Notifications ------------------------------ */

export function NotificationsPage() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { data, isLoading } = useQuery({ queryKey: ['notifications'], queryFn: () => api<Array<{ id: string; title: string; body: string; link: string | null; type: string; read_at: string | null; created_at: string }>>('/notifications', { org: false }) });
  return (
    <>
      <PageHeader title={t('nav.notifications')} icon={<Bell />} actions={<Button variant="outline" onClick={() => void apiPost('/notifications/read').then(() => qc.invalidateQueries({ queryKey: ['notifications'] }))}>{t('notifications.markAllRead')}</Button>} />
      {isLoading ? <LoadingBlock /> : !data?.length ? <EmptyState icon={<Bell />} title={t('notifications.empty')} /> : (
        <ul className="grid gap-2">
          {data.map((n) => (
            <li key={n.id}>
              <button onClick={() => { void apiPost('/notifications/read', { ids: [n.id] }).then(() => qc.invalidateQueries({ queryKey: ['notifications'] })); if (n.link) navigate(n.link); }} className={cn('flex w-full items-start gap-3 rounded-xl border bg-card p-4 text-start hover:shadow-md', !n.read_at && 'border-primary/30 bg-primary/5')}>
                <Bell className="mt-0.5 size-4 text-muted-foreground" />
                <div className="min-w-0 flex-1"><p className="font-medium">{n.title}</p>{n.body && <p className="text-sm text-muted-foreground">{n.body}</p>}</div>
                <Badge>{t(`notificationTypes.${n.type}`, n.type)}</Badge>
                <span className="text-xs text-muted-foreground">{formatRelative(n.created_at)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
