import { Avatar, Badge, Button, EmptyState, Input, NativeSelect, PageHeader, Section, Tabs, TabsList, TabsTrigger, Textarea, cn } from '@nexus/ui';
import { PRIORITIES, TASK_STATUSES } from '@nexus/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Bot, Kanban, List, ListChecks, Paperclip, Pencil, Plus, Send, Trash2 } from 'lucide-react';
import { useMemo, useState, type DragEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { toast } from 'sonner';
import { LoadingBlock, Markdown, StatusBadge, useAction } from '@/components/common';
import { NoAccess } from '@/components/guards';
import { SessionViewer } from '@/features/ai/session-viewer';
import { FilePickerDialog, LinkedFiles } from '@/features/files/attachments';
import { api, apiDelete, apiPatch, apiPost } from '@/lib/api';
import { formatDate, formatDateTime, formatRelative } from '@/lib/format';
import { useSession } from '@/providers/session';
import { EntityDialog, useOptions, type FieldDef } from './shared';

export interface Task {
  id: string;
  title: string;
  description: string;
  status: string;
  priority: string;
  due_date: string | null;
  project_id: string | null;
  mission_id: string | null;
  parent_task_id: string | null;
  assignee_member_id: string | null;
  assignee_ai_employee_id: string | null;
  creator_user_id: string | null;
  creator_ai_employee_id: string | null;
  tags: string[];
  requires_approval: boolean;
  created_at: string;
}

export function useTaskFields(): FieldDef[] {
  const { t } = useTranslation();
  const o = useOptions();
  return [
    { name: 'title', label: t('fields.title'), type: 'text', required: true, full: true },
    { name: 'description', label: t('fields.description'), type: 'textarea' },
    { name: 'assignee_ai_employee_id', label: t('fields.aiAssignee'), type: 'select', options: o.ais, hint: t('tasks.aiAssigneeHint') },
    { name: 'assignee_member_id', label: t('fields.humanAssignee'), type: 'select', options: o.members },
    { name: 'project_id', label: t('fields.project'), type: 'select', options: o.projects },
    { name: 'mission_id', label: t('fields.mission'), type: 'select', options: o.missions },
    { name: 'priority', label: t('fields.priority'), type: 'select', options: o.enumOpts('priority', PRIORITIES), required: true },
    { name: 'status', label: t('fields.status'), type: 'select', options: o.enumOpts('status', TASK_STATUSES), required: true },
    { name: 'due_date', label: t('fields.dueDate'), type: 'datetime' },
    { name: 'tags', label: t('fields.tags'), type: 'tags', hint: t('fields.tagsHint') },
    { name: 'requires_approval', label: t('fields.requiresApproval'), type: 'switch', full: true },
  ];
}

function Assignee({ task }: { task: Task }) {
  const o = useOptions();
  const { t } = useTranslation();
  if (task.assignee_ai_employee_id) {
    const n = o.aiName(task.assignee_ai_employee_id) ?? 'AI';
    return <span className="flex items-center gap-1.5 text-xs"><Avatar name={n} square className="size-5" /><Bot className="size-3 text-primary" />{n}</span>;
  }
  if (task.assignee_member_id) {
    const n = o.memberName(task.assignee_member_id) ?? '—';
    return <span className="flex items-center gap-1.5 text-xs"><Avatar name={n} className="size-5" />{n}</span>;
  }
  return <span className="text-xs text-muted-foreground">{t('tasks.unassigned')}</span>;
}

export function TaskBoard({ tasks, onMove }: { tasks: Task[]; onMove: (id: string, status: string) => void }) {
  const { t } = useTranslation();
  const [over, setOver] = useState<string | null>(null);
  const drop = (status: string) => (e: DragEvent) => {
    e.preventDefault();
    setOver(null);
    const id = e.dataTransfer.getData('text/task');
    if (id) onMove(id, status);
  };
  return (
    <div className="flex gap-3 overflow-x-auto pb-4">
      {TASK_STATUSES.map((s) => {
        const col = tasks.filter((x) => x.status === s);
        return (
          <div key={s} onDragOver={(e) => { e.preventDefault(); setOver(s); }} onDragLeave={() => setOver(null)} onDrop={drop(s)} className={cn('flex w-72 shrink-0 flex-col rounded-xl border bg-muted/30 p-2', over === s && 'border-primary bg-primary/5')}>
            <div className="flex items-center justify-between px-2 py-1.5"><StatusBadge value={s} /><span className="text-xs text-muted-foreground">{col.length}</span></div>
            <div className="grid min-h-24 gap-2">
              {col.map((task) => (
                <Link key={task.id} to={`/app/tasks/${task.id}`} draggable onDragStart={(e) => e.dataTransfer.setData('text/task', task.id)} className="rounded-lg border bg-card p-3 shadow-xs transition-shadow hover:shadow-md">
                  <p className="text-sm font-medium" dir="auto">{task.title}</p>
                  <div className="mt-2 flex items-center justify-between gap-2"><Assignee task={task} /><StatusBadge value={task.priority} /></div>
                  {task.due_date && <p className={cn('mt-1.5 text-xs', new Date(task.due_date) < new Date() && task.status !== 'done' ? 'text-destructive' : 'text-muted-foreground')}>{formatDate(task.due_date)}</p>}
                </Link>
              ))}
            </div>
            {col.length === 0 && <p className="py-4 text-center text-xs text-muted-foreground">{t('tasks.dropHere')}</p>}
          </div>
        );
      })}
    </div>
  );
}

export function TaskList({ tasks }: { tasks: Task[] }) {
  const { t } = useTranslation();
  return (
    <div className="overflow-hidden rounded-xl border bg-card">
      <table className="w-full text-sm">
        <thead className="bg-muted/50 text-xs text-muted-foreground"><tr><th className="px-4 py-2 text-start">{t('fields.title')}</th><th className="px-4 py-2 text-start">{t('fields.status')}</th><th className="hidden px-4 py-2 text-start md:table-cell">{t('fields.assignee')}</th><th className="hidden px-4 py-2 text-start sm:table-cell">{t('fields.priority')}</th><th className="hidden px-4 py-2 text-start md:table-cell">{t('fields.dueDate')}</th></tr></thead>
        <tbody>
          {tasks.map((task) => (
            <tr key={task.id} className="border-t hover:bg-muted/40">
              <td className="px-4 py-2.5"><Link to={`/app/tasks/${task.id}`} className="font-medium hover:underline" dir="auto">{task.title}</Link></td>
              <td className="px-4 py-2.5"><StatusBadge value={task.status} /></td>
              <td className="hidden px-4 py-2.5 md:table-cell"><Assignee task={task} /></td>
              <td className="hidden px-4 py-2.5 sm:table-cell"><StatusBadge value={task.priority} /></td>
              <td className="hidden px-4 py-2.5 text-muted-foreground md:table-cell">{formatDate(task.due_date)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function TasksPage() {
  const { t } = useTranslation();
  const { can } = useSession();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [view, setView] = useState(params.get('view') ?? 'board');
  const [q, setQ] = useState('');
  const [assignee, setAssignee] = useState('');
  const o = useOptions();
  const fields = useTaskFields();
  const { data, isLoading } = useQuery({ queryKey: ['work', 'tasks', { assignee }], queryFn: () => api<Task[]>('/work/tasks', { query: assignee.startsWith('ai:') ? { assignee_ai_employee_id: assignee.slice(3) } : assignee ? { assignee_member_id: assignee } : {} }), refetchInterval: 20_000 });
  const tasks = useMemo(() => (data ?? []).filter((x) => !x.parent_task_id && (!q || x.title.toLowerCase().includes(q.toLowerCase()))), [data, q]);
  const move = useAction(({ id, status }: { id: string; status: string }) => apiPatch(`/work/tasks/${id}`, { status }), { invalidate: [['work', 'tasks']] });
  const aiPreset = params.get('ai');

  return (
    <>
      <PageHeader title={t('nav.tasks')} description={t('tasks.description')} icon={<ListChecks />} actions={can('work.create') && <Button onClick={() => setParams({ new: '1' })}><Plus /> {t('command.newTask')}</Button>} />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Input className="max-w-xs" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('common.search')} />
        <NativeSelect className="w-auto" value={assignee} onChange={(e) => setAssignee(e.target.value)}>
          <option value="">{t('tasks.allAssignees')}</option>
          {o.ais.map((a) => <option key={a.value} value={`ai:${a.value}`}>🤖 {a.label}</option>)}
          {o.members.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
        </NativeSelect>
        <Tabs value={view} onValueChange={setView} className="ms-auto"><TabsList><TabsTrigger value="board"><Kanban /> {t('views.kanban')}</TabsTrigger><TabsTrigger value="list"><List /> {t('views.list')}</TabsTrigger></TabsList></Tabs>
      </div>
      {isLoading ? <LoadingBlock /> : tasks.length === 0 ? (
        <EmptyState icon={<ListChecks />} title={t('tasks.empty')} action={can('work.create') ? <Button onClick={() => setParams({ new: '1' })}><Plus /> {t('command.newTask')}</Button> : undefined} />
      ) : view === 'board' ? (
        <TaskBoard tasks={tasks} onMove={(id, status) => { qc.setQueryData<Task[]>(['work', 'tasks', { assignee }], (old) => old?.map((x) => (x.id === id ? { ...x, status } : x))); move.mutate({ id, status }); }} />
      ) : (
        <TaskList tasks={tasks} />
      )}
      <EntityDialog
        entity="tasks"
        open={params.get('new') === '1'}
        onOpenChange={(open) => !open && setParams({})}
        title={t('command.newTask')}
        fields={fields}
        initial={{ priority: 'medium', status: 'todo', assignee_ai_employee_id: aiPreset, project_id: params.get('project'), mission_id: params.get('mission') }}
        onSaved={(row) => {
          if (row.ai_session_id) toast.success(t('tasks.aiStarted'));
          navigate(`/app/tasks/${row.id}`);
        }}
      />
    </>
  );
}

interface TaskDetail extends Task {
  depends_on: string[];
  subtasks: Array<{ id: string; title: string; status: string }>;
  comments: Array<{ id: string; body: string; author_user_id: string | null; author_ai_employee_id: string | null; created_at: string }>;
  ai_sessions: Array<{ id: string; status: string; current_step: string | null; ai_employee_id: string; created_at: string }>;
  ai_outputs: Array<{ id: string; title: string; status: string; content: string; document_id: string | null; created_at: string }>;
}

export function TaskPage() {
  const { id } = useParams();
  const { t } = useTranslation();
  const { can, org } = useSession();
  const navigate = useNavigate();
  const o = useOptions();
  const fields = useTaskFields();
  const [edit, setEdit] = useState(false);
  const [comment, setComment] = useState('');
  const [attach, setAttach] = useState<string[]>([]);
  const [picker, setPicker] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const { data: task, isLoading, error } = useQuery({ queryKey: ['work', 'tasks', id], queryFn: () => api<TaskDetail>(`/work/tasks/${id}`), refetchInterval: 10_000 });
  const addComment = useAction(() => apiPost(`/work/tasks/${id}/comments`, { body: comment, file_ids: attach }), { invalidate: [['work', 'tasks', id], ['linked-files', 'task', id]], onSuccess: () => { setComment(''); setAttach([]); } });
  const setStatus = useAction((status: string) => apiPatch(`/work/tasks/${id}`, { status }), { invalidate: [['work', 'tasks']] });
  const assignAi = useAction((aiId: string) => apiPost(`/ai/employees/${aiId}/assign`, { task_id: id }), { success: t('tasks.aiStarted'), invalidate: [['work', 'tasks', id]] });
  const remove = useAction(() => apiDelete(`/work/tasks/${id}`), { success: t('common.deleted'), invalidate: [['work', 'tasks']], onSuccess: () => navigate('/app/tasks') });

  if (isLoading) return <LoadingBlock />;
  if (error || !task) return <NoAccess />;
  const author = (c: TaskDetail['comments'][number]) => (c.author_ai_employee_id ? o.aiName(c.author_ai_employee_id) ?? 'AI' : o.memberNameByUser(c.author_user_id) ?? '');

  return (
    <>
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-start">
        <div className="flex-1">
          <div className="flex flex-wrap items-center gap-2"><StatusBadge value={task.status} /><StatusBadge value={task.priority} />{task.requires_approval && <Badge tone="warning">{t('fields.requiresApproval')}</Badge>}{task.tags.map((x) => <Badge key={x}>{x}</Badge>)}</div>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight" dir="auto">{task.title}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{t('tasks.created', { date: formatDateTime(task.created_at) })}{task.due_date ? ` · ${t('fields.dueDate')}: ${formatDateTime(task.due_date)}` : ''}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <NativeSelect className="w-auto" value={task.status} onChange={(e) => setStatus.mutate(e.target.value)} aria-label={t('fields.status')}>{TASK_STATUSES.map((s) => <option key={s} value={s}>{t(`status.${s}`)}</option>)}</NativeSelect>
          <Button variant="outline" onClick={() => setEdit(true)}><Pencil /> {t('common.edit')}</Button>
          {can('work.manage') && <Button variant="ghost" size="icon" onClick={() => remove.mutate(undefined)} aria-label={t('common.delete')}><Trash2 /></Button>}
        </div>
      </div>
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="grid content-start gap-6 lg:col-span-2">
          <Section title={t('fields.description')}>{task.description ? <Markdown>{task.description}</Markdown> : <p className="text-sm text-muted-foreground">—</p>}</Section>
          {task.ai_outputs.length > 0 && (
            <Section title={<span className="flex items-center gap-2"><Bot className="size-4" /> {t('ai.outputs')}</span>}>
              {task.ai_outputs.map((out) => (
                <div key={out.id} className="rounded-xl border p-4">
                  <div className="flex items-center gap-2"><p className="font-medium">{out.title}</p><StatusBadge value={out.status} />{out.document_id && <Link className="ms-auto text-xs text-primary" to={`/app/documents/${out.document_id}`}>{t('ai.openDocument')}</Link>}</div>
                  <Markdown className="mt-2 max-h-[32rem] overflow-y-auto">{out.content}</Markdown>
                </div>
              ))}
            </Section>
          )}
          <Section title={t('tasks.comments')}>
            <ul className="grid gap-3">
              {task.comments.map((c) => (
                <li key={c.id} className="flex gap-3">
                  <Avatar name={author(c) || '•'} square={Boolean(c.author_ai_employee_id)} className="size-8" />
                  <div className="min-w-0 flex-1 rounded-xl bg-muted/50 px-3 py-2">
                    <p className="text-xs text-muted-foreground">{c.author_ai_employee_id ? <><Bot className="me-1 inline size-3" />{author(c)}</> : author(c) || t('tasks.teamMember')} · {formatRelative(c.created_at)}</p>
                    <Markdown className="mt-1">{c.body}</Markdown>
                  </div>
                </li>
              ))}
              {task.comments.length === 0 && <p className="text-sm text-muted-foreground">{t('tasks.noComments')}</p>}
            </ul>
            {can('work.create') && (
              <div className="mt-4 grid gap-2">
                <Textarea rows={3} value={comment} onChange={(e) => setComment(e.target.value)} placeholder={t('tasks.commentPlaceholder')} />
                <div className="flex flex-wrap items-center gap-2">
                  <Button variant="ghost" size="sm" onClick={() => setPicker(true)}><Paperclip /> {t('files.attachFromCompany')}</Button>
                  {attach.length > 0 && <Badge tone="primary">{t('files.attachSelected', { count: attach.length })}</Badge>}
                  <Button size="sm" className="ms-auto" disabled={!comment.trim()} loading={addComment.isPending} onClick={() => addComment.mutate(undefined)}><Send /> {t('common.send')}</Button>
                </div>
              </div>
            )}
          </Section>
        </div>
        <div className="grid content-start gap-6">
          <Section title={t('fields.assignee')}>
            <Assignee task={task} />
            {can('ai.assign') && (
              <div className="mt-4 grid gap-2">
                <p className="text-xs text-muted-foreground">{t('tasks.assignAiHint')}</p>
                <NativeSelect defaultValue="" onChange={(e) => { if (e.target.value) assignAi.mutate(e.target.value); e.target.value = ''; }} disabled={!org?.billing.active}>
                  <option value="">{t('tasks.assignAi')}</option>
                  {o.ais.map((a) => <option key={a.value} value={a.value}>{a.label}</option>)}
                </NativeSelect>
              </div>
            )}
          </Section>
          {task.ai_sessions.length > 0 && (
            <Section title={t('ai.workSessions')}>
              <ul className="grid gap-2">
                {task.ai_sessions.map((s) => (
                  <li key={s.id}><button onClick={() => setSessionId(s.id)} className="flex w-full items-center gap-2 rounded-lg border p-2.5 text-start text-sm hover:bg-muted/50"><span className="min-w-0 flex-1"><span className="block truncate">{o.aiName(s.ai_employee_id)}</span><span className="block truncate text-xs text-muted-foreground" dir="auto">{s.current_step}</span></span><StatusBadge value={s.status} /></button></li>
                ))}
              </ul>
            </Section>
          )}
          {task.subtasks.length > 0 && (
            <Section title={t('tasks.subtasks')}>
              <ul className="grid gap-1.5">{task.subtasks.map((s) => <li key={s.id} className="flex items-center gap-2 text-sm"><StatusBadge value={s.status} /><Link to={`/app/tasks/${s.id}`} className="truncate hover:underline">{s.title}</Link></li>)}</ul>
            </Section>
          )}
          <Section title={t('tasks.context')}>
            <div className="grid gap-1.5 text-sm">
              {task.project_id && <Link className="text-primary" to={`/app/projects/${task.project_id}`}>{t('fields.project')}: {o.projects.find((p) => p.value === task.project_id)?.label}</Link>}
              {task.mission_id && <Link className="text-primary" to={`/app/missions/${task.mission_id}`}>{t('fields.mission')}: {o.missions.find((p) => p.value === task.mission_id)?.label}</Link>}
              {task.parent_task_id && <Link className="text-primary" to={`/app/tasks/${task.parent_task_id}`}>{t('tasks.parent')}</Link>}
              {!task.project_id && !task.mission_id && !task.parent_task_id && <span className="text-muted-foreground">—</span>}
            </div>
          </Section>
          <LinkedFiles entityType="task" entityId={task.id} />
        </div>
      </div>
      <EntityDialog entity="tasks" id={task.id} open={edit} onOpenChange={setEdit} title={t('common.edit')} fields={fields} initial={task as unknown as Record<string, unknown>} />
      <FilePickerDialog open={picker} onOpenChange={setPicker} onPick={(ids) => { setAttach(ids); toast.message(t('files.attachSelected', { count: ids.length })); }} />
      <SessionViewer sessionId={sessionId} onClose={() => setSessionId(null)} />
    </>
  );
}
