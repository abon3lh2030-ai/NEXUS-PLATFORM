import { Badge, Button, Card, EmptyState, Input, NativeSelect, PageHeader, Section, Tabs, TabsList, TabsTrigger, Textarea, cn } from '@nexus/ui';
import { DECISION_STATUSES, DOCUMENT_TYPES, MEMORY_TYPES } from '@nexus/shared';
import { useQuery } from '@tanstack/react-query';
import { Archive, Bot, Brain, CalendarDays, FileText, FolderOpen, History, Library, ListChecks, Pencil, Pin, Plus, Save, Scale, Sparkles } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { FeatureGate, NoAccess } from '@/components/guards';
import { LoadingBlock, Markdown, StatusBadge, useAction } from '@/components/common';
import { LinkedFiles } from '@/features/files/attachments';
import { FileIcon } from '@/features/files/file-icon';
import type { CompanyFile } from '@/features/files/types';
import { api, apiDelete, apiPatch, apiPost } from '@/lib/api';
import { formatDate, formatDateTime, formatRelative } from '@/lib/format';
import { useSession } from '@/providers/session';
import { EntityDialog, useEntityList, useOptions, type FieldDef } from './shared';
import { MeetingOfficePanel } from '@/features/office/meeting-office';

/* ------------------------------ Meetings ------------------------------ */

interface Meeting { id: string; title: string; scheduled_at: string; duration_minutes: number; agenda: string; notes: string; summary: string | null; decisions_extracted: Array<{ title: string; reasoning: string }>; action_items: Array<{ title: string; owner_hint: string | null }>; project_id: string | null; mission_id: string | null }

function useMeetingFields(): FieldDef[] {
  const { t } = useTranslation();
  const o = useOptions();
  return [
    { name: 'title', label: t('fields.title'), type: 'text', required: true, full: true },
    { name: 'scheduled_at', label: t('meetings.date'), type: 'datetime', required: true },
    { name: 'duration_minutes', label: t('meetings.duration'), type: 'number' },
    { name: 'project_id', label: t('fields.project'), type: 'select', options: o.projects },
    { name: 'mission_id', label: t('fields.mission'), type: 'select', options: o.missions },
    { name: 'agenda', label: t('meetings.agenda'), type: 'textarea' },
    { name: 'notes', label: t('meetings.notes'), type: 'markdown' },
  ];
}

export function MeetingsPage() {
  const { t } = useTranslation();
  const { can } = useSession();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const { data, isLoading } = useEntityList<Meeting>('meetings');
  const fields = useMeetingFields();
  return (
    <FeatureGate feature="meetings">
      <PageHeader title={t('nav.meetings')} description={t('meetings.description')} icon={<CalendarDays />} actions={can('meetings.manage') && <Button onClick={() => setOpen(true)}><Plus /> {t('meetings.new')}</Button>} />
      {isLoading ? <LoadingBlock /> : !data?.length ? <EmptyState icon={<CalendarDays />} title={t('meetings.empty')} /> : (
        <ul className="grid gap-2">
          {data.map((m) => (
            <li key={m.id}>
              <Link to={`/app/meetings/${m.id}`} className="flex items-center gap-4 rounded-xl border bg-card p-4 hover:shadow-md">
                <div className="flex w-14 flex-col items-center rounded-lg bg-primary/10 py-1.5 text-primary"><span className="text-lg font-semibold leading-none">{new Date(m.scheduled_at).getDate()}</span><span className="text-[10px]">{formatDate(m.scheduled_at, { month: 'short' })}</span></div>
                <div className="min-w-0 flex-1"><p className="truncate font-medium">{m.title}</p><p className="text-xs text-muted-foreground">{formatDateTime(m.scheduled_at)} · {t('meetings.minutes', { count: m.duration_minutes })}</p></div>
                {m.summary && <Badge tone="primary"><Sparkles /> {t('meetings.summarized')}</Badge>}
              </Link>
            </li>
          ))}
        </ul>
      )}
      <EntityDialog entity="meetings" open={open} onOpenChange={setOpen} title={t('meetings.new')} fields={fields} initial={{ duration_minutes: 60 }} onSaved={(r) => navigate(`/app/meetings/${r.id}`)} />
    </FeatureGate>
  );
}

export function MeetingPage() {
  const { id } = useParams();
  const { t, i18n } = useTranslation();
  const { can } = useSession();
  const [edit, setEdit] = useState(false);
  const fields = useMeetingFields();
  const { data: m, isLoading } = useQuery({ queryKey: ['work', 'meetings', id], queryFn: () => api<Meeting>(`/work/meetings/${id}`) });
  const analyze = useAction(() => apiPost(`/work/meetings/${id}/ai/analyze?locale=${i18n.language}`), { success: t('meetings.analyzed'), invalidate: [['work', 'meetings', id]] });
  const createTasks = useAction(() => apiPost(`/work/meetings/${id}/ai/create-tasks`), { success: t('meetings.tasksCreated'), invalidate: [['work', 'tasks']] });
  const saveDecisions = useAction(() => apiPost(`/work/meetings/${id}/ai/save-decisions`), { success: t('meetings.decisionsSaved'), invalidate: [['work', 'decisions']] });
  if (isLoading) return <LoadingBlock />;
  if (!m) return <NoAccess />;
  return (
    <FeatureGate feature="meetings">
      <PageHeader title={m.title} description={`${formatDateTime(m.scheduled_at)} · ${t('meetings.minutes', { count: m.duration_minutes })}`} icon={<CalendarDays />} actions={<>
        {can('meetings.manage') && <Button variant="brand" loading={analyze.isPending} onClick={() => analyze.mutate(undefined)}><Sparkles /> {t('meetings.analyze')}</Button>}
        {can('meetings.manage') && <Button variant="outline" onClick={() => setEdit(true)}><Pencil /> {t('common.edit')}</Button>}
      </>} />
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="grid content-start gap-6 lg:col-span-2">
          {m.summary && <Section title={<span className="flex items-center gap-2"><Sparkles className="size-4" /> {t('meetings.summary')}</span>}><Markdown>{m.summary}</Markdown></Section>}
          <Section title={t('meetings.agenda')}>{m.agenda ? <Markdown>{m.agenda}</Markdown> : <p className="text-sm text-muted-foreground">—</p>}</Section>
          <Section title={t('meetings.notes')}>{m.notes ? <Markdown>{m.notes}</Markdown> : <p className="text-sm text-muted-foreground">{t('meetings.noNotes')}</p>}</Section>
        </div>
        <div className="grid content-start gap-6">
          <Section title={t('meetings.decisions')} actions={m.decisions_extracted.length > 0 && can('decisions.manage') ? <Button size="sm" variant="outline" loading={saveDecisions.isPending} onClick={() => saveDecisions.mutate(undefined)}><Save /> {t('meetings.saveDecisions')}</Button> : undefined}>
            {m.decisions_extracted.length === 0 ? <p className="text-sm text-muted-foreground">—</p> : <ul className="grid gap-2 text-sm">{m.decisions_extracted.map((d, i) => <li key={i}><p className="font-medium">{d.title}</p><p className="text-xs text-muted-foreground">{d.reasoning}</p></li>)}</ul>}
          </Section>
          <Section title={t('meetings.actionItems')} actions={m.action_items.length > 0 && can('work.create') ? <Button size="sm" variant="outline" loading={createTasks.isPending} onClick={() => createTasks.mutate(undefined)}><ListChecks /> {t('meetings.createTasks')}</Button> : undefined}>
            {m.action_items.length === 0 ? <p className="text-sm text-muted-foreground">—</p> : <ul className="grid list-disc gap-1 ps-5 text-sm">{m.action_items.map((a, i) => <li key={i}>{a.title}{a.owner_hint ? <span className="text-muted-foreground"> · {a.owner_hint}</span> : null}</li>)}</ul>}
          </Section>
          <LinkedFiles entityType="meeting" entityId={m.id} />
        </div>
      </div>
      <div className="mt-6"><MeetingOfficePanel meetingId={m.id} /></div>
      <EntityDialog entity="meetings" id={m.id} open={edit} onOpenChange={setEdit} title={t('common.edit')} fields={fields} initial={m as unknown as Record<string, unknown>} />
    </FeatureGate>
  );
}

/* ------------------------------ Documents ------------------------------ */

interface Doc { id: string; title: string; doc_type: string; content: string; status: string; current_version: number; created_by_ai_employee_id: string | null; updated_at: string; project_id: string | null }

export function DocumentsPage() {
  const { t } = useTranslation();
  const { can } = useSession();
  const navigate = useNavigate();
  const o = useOptions();
  const [type, setType] = useState('');
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const { data, isLoading } = useEntityList<Doc>('documents', { doc_type: type || undefined, q: q || undefined });
  const fields: FieldDef[] = [
    { name: 'title', label: t('fields.title'), type: 'text', required: true, full: true },
    { name: 'doc_type', label: t('documents.type'), type: 'select', options: o.enumOpts('docTypes', DOCUMENT_TYPES), required: true },
    { name: 'project_id', label: t('fields.project'), type: 'select', options: o.projects },
    { name: 'content', label: t('documents.content'), type: 'markdown' },
  ];
  return (
    <>
      <PageHeader title={t('nav.documents')} description={t('documents.description')} icon={<FileText />} actions={can('documents.create') && <Button onClick={() => setOpen(true)}><Plus /> {t('documents.new')}</Button>} />
      <div className="mb-4 flex flex-wrap gap-2">
        <Input className="max-w-xs" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('common.search')} />
        <NativeSelect className="w-auto" value={type} onChange={(e) => setType(e.target.value)}><option value="">{t('documents.allTypes')}</option>{DOCUMENT_TYPES.map((d) => <option key={d} value={d}>{t(`docTypes.${d}`)}</option>)}</NativeSelect>
      </div>
      {isLoading ? <LoadingBlock /> : !data?.length ? <EmptyState icon={<FileText />} title={t('documents.empty')} /> : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {data.map((d) => (
            <Link key={d.id} to={`/app/documents/${d.id}`}>
              <Card className="h-full p-5 hover:shadow-lg">
                <div className="flex items-center gap-2"><Badge>{t(`docTypes.${d.doc_type}`)}</Badge>{d.status !== 'published' && <StatusBadge value={d.status} />}{d.created_by_ai_employee_id && <Badge tone="primary"><Bot /> {o.aiName(d.created_by_ai_employee_id)}</Badge>}</div>
                <p className="mt-3 font-semibold" dir="auto">{d.title}</p>
                <p className="mt-1 line-clamp-3 text-sm text-muted-foreground" dir="auto">{d.content.replace(/[#*_>`-]/g, '').slice(0, 220)}</p>
                <p className="mt-3 text-xs text-muted-foreground">v{d.current_version} · {formatRelative(d.updated_at)}</p>
              </Card>
            </Link>
          ))}
        </div>
      )}
      <EntityDialog entity="documents" open={open} onOpenChange={setOpen} title={t('documents.new')} fields={fields} initial={{ doc_type: 'general' }} onSaved={(r) => navigate(`/app/documents/${r.id}`)} />
    </>
  );
}

export function DocumentPage() {
  const { id } = useParams();
  const { t } = useTranslation();
  const { can } = useSession();
  const o = useOptions();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState({ title: '', content: '', change_summary: '' });
  const [version, setVersion] = useState<number | null>(null);
  const { data: d, isLoading } = useQuery({ queryKey: ['work', 'documents', id], queryFn: () => api<Doc & { versions: Array<{ id: string; version: number; change_summary: string | null; created_at: string; created_by_ai_employee_id: string | null }> }>(`/work/documents/${id}`) });
  const old = useQuery({ queryKey: ['doc-version', id, version], queryFn: () => api<{ title: string; content: string }>(`/work/documents/${id}/versions/${version}`), enabled: version !== null });
  useEffect(() => { if (d) setDraft({ title: d.title, content: d.content, change_summary: '' }); }, [d]);
  const save = useAction(() => apiPatch(`/work/documents/${id}`, draft), { success: t('common.saved'), invalidate: [['work', 'documents', id]], onSuccess: () => setEditing(false) });
  if (isLoading) return <LoadingBlock />;
  if (!d) return <NoAccess />;
  const viewing = version !== null && old.data ? old.data : d;
  return (
    <div className="grid gap-6 lg:grid-cols-4">
      <div className="lg:col-span-3">
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <Badge>{t(`docTypes.${d.doc_type}`)}</Badge><StatusBadge value={d.status} />
          {d.created_by_ai_employee_id && <Badge tone="primary"><Bot /> {o.aiName(d.created_by_ai_employee_id)}</Badge>}
          <div className="ms-auto flex gap-2">
            {editing ? (
              <>
                <Button variant="ghost" onClick={() => setEditing(false)}>{t('common.cancel')}</Button>
                <Button loading={save.isPending} onClick={() => save.mutate(undefined)}><Save /> {t('common.save')}</Button>
              </>
            ) : (can('documents.create') && version === null && <Button variant="outline" onClick={() => setEditing(true)}><Pencil /> {t('common.edit')}</Button>)}
          </div>
        </div>
        {editing ? (
          <div className="grid gap-3">
            <Input value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} className="text-lg font-semibold" dir="auto" />
            <div className="grid gap-3 lg:grid-cols-2">
              <Textarea rows={24} className="font-mono text-xs" value={draft.content} onChange={(e) => setDraft({ ...draft, content: e.target.value })} dir="auto" />
              <div className="max-h-[36rem] overflow-y-auto rounded-lg border p-4"><Markdown>{draft.content}</Markdown></div>
            </div>
            <Input value={draft.change_summary} onChange={(e) => setDraft({ ...draft, change_summary: e.target.value })} placeholder={t('documents.changeSummary')} />
          </div>
        ) : (
          <article className="rounded-xl border bg-card p-6 sm:p-8">
            {version !== null && <p className="mb-4 rounded-lg bg-warning/10 px-3 py-2 text-sm text-warning">{t('documents.viewingVersion', { version })} <button className="underline" onClick={() => setVersion(null)}>{t('documents.backToCurrent')}</button></p>}
            <h1 className="text-2xl font-semibold tracking-tight" dir="auto">{viewing.title}</h1>
            <Markdown className="mt-6 text-[15px]">{viewing.content || '—'}</Markdown>
          </article>
        )}
      </div>
      <div className="grid content-start gap-6">
        <Section title={<span className="flex items-center gap-2"><History className="size-4" /> {t('documents.versions')}</span>}>
          <ul className="grid gap-1">
            {d.versions.map((v) => (
              <li key={v.id}>
                <button onClick={() => setVersion(v.version === d.current_version ? null : v.version)} className={cn('w-full rounded-lg px-2 py-1.5 text-start text-sm hover:bg-muted', (version ?? d.current_version) === v.version && 'bg-muted')}>
                  <span className="font-medium">v{v.version}</span> <span className="text-xs text-muted-foreground">· {formatRelative(v.created_at)}</span>
                  {v.change_summary && <span className="block truncate text-xs text-muted-foreground">{v.change_summary}</span>}
                </button>
              </li>
            ))}
          </ul>
        </Section>
      </div>
    </div>
  );
}

/* ------------------------------ Decisions ------------------------------ */

interface Decision { id: string; title: string; context: string; chosen_option: string; reasoning: string; impact: string; status: string; created_at: string }

export function DecisionsPage() {
  const { t } = useTranslation();
  const { can } = useSession();
  const o = useOptions();
  const [dialog, setDialog] = useState<{ open: boolean; d?: Decision }>({ open: false });
  const { data, isLoading } = useEntityList<Decision>('decisions');
  const fields: FieldDef[] = [
    { name: 'title', label: t('fields.title'), type: 'text', required: true, full: true },
    { name: 'context', label: t('decisions.context'), type: 'textarea' },
    { name: 'chosen_option', label: t('decisions.chosen'), type: 'text', full: true },
    { name: 'reasoning', label: t('decisions.reasoning'), type: 'textarea' },
    { name: 'impact', label: t('decisions.impact'), type: 'select', options: o.enumOpts('risk', ['low', 'medium', 'high']), required: true },
    { name: 'status', label: t('fields.status'), type: 'select', options: o.enumOpts('decisionStatus', DECISION_STATUSES), required: true },
  ];
  return (
    <FeatureGate feature="decisions">
      <PageHeader title={t('nav.decisions')} description={t('decisions.description')} icon={<Scale />} actions={can('decisions.manage') && <Button onClick={() => setDialog({ open: true })}><Plus /> {t('decisions.new')}</Button>} />
      {isLoading ? <LoadingBlock /> : !data?.length ? <EmptyState icon={<Scale />} title={t('decisions.empty')} /> : (
        <div className="grid gap-3">
          {data.map((d) => (
            <Card key={d.id} className="p-5">
              <div className="flex flex-wrap items-center gap-2"><p className="flex-1 font-semibold" dir="auto">{d.title}</p><Badge tone={d.impact === 'high' ? 'danger' : d.impact === 'medium' ? 'warning' : 'neutral'}>{t('decisions.impactLabel', { level: t(`risk.${d.impact}`) })}</Badge><Badge>{t(`decisionStatus.${d.status}`)}</Badge>{can('decisions.manage') && <Button size="icon-sm" variant="ghost" onClick={() => setDialog({ open: true, d })} aria-label={t('common.edit')}><Pencil /></Button>}</div>
              {d.chosen_option && <p className="mt-2 text-sm"><span className="text-muted-foreground">{t('decisions.chosen')}:</span> {d.chosen_option}</p>}
              {d.reasoning && <p className="mt-1 text-sm text-muted-foreground" dir="auto">{d.reasoning}</p>}
              <p className="mt-2 text-xs text-muted-foreground">{formatDate(d.created_at)}</p>
            </Card>
          ))}
        </div>
      )}
      <EntityDialog entity="decisions" id={dialog.d?.id} open={dialog.open} onOpenChange={(open) => setDialog({ open })} title={dialog.d ? t('common.edit') : t('decisions.new')} fields={fields} initial={(dialog.d as unknown as Record<string, unknown>) ?? { impact: 'medium', status: 'decided' }} />
    </FeatureGate>
  );
}

/* ------------------------------ Memory ------------------------------ */

interface Memory { id: string; memory_type: string; title: string; content: string; pinned: boolean; tags: string[]; source: string; ai_employee_id: string | null; updated_at: string }

export function MemoryPage() {
  const { t } = useTranslation();
  const { can } = useSession();
  const o = useOptions();
  const [type, setType] = useState('');
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const { data, isLoading } = useEntityList<Memory>('memories', { memory_type: type || undefined, q: q || undefined });
  const pin = useAction((m: Memory) => apiPatch(`/work/memories/${m.id}`, { pinned: !m.pinned }), { invalidate: [['work', 'memories']] });
  const archive = useAction((id: string) => apiDelete(`/work/memories/${id}`), { success: t('memory.archived'), invalidate: [['work', 'memories']] });
  const fields: FieldDef[] = [
    { name: 'title', label: t('fields.title'), type: 'text', required: true, full: true },
    { name: 'memory_type', label: t('memory.type'), type: 'select', options: o.enumOpts('memoryTypes', MEMORY_TYPES), required: true },
    { name: 'department_id', label: t('fields.department'), type: 'select', options: o.departments },
    { name: 'content', label: t('memory.content'), type: 'textarea' },
    { name: 'tags', label: t('fields.tags'), type: 'tags' },
    { name: 'pinned', label: t('memory.pin'), type: 'switch' },
  ];
  return (
    <FeatureGate feature="basic_memory">
      <PageHeader title={t('nav.memory')} description={t('memory.description')} icon={<Brain />} actions={can('memory.manage') && <Button onClick={() => setOpen(true)}><Plus /> {t('memory.new')}</Button>} />
      <div className="mb-4 flex flex-wrap gap-2">
        <Input className="max-w-xs" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('common.search')} />
        <NativeSelect className="w-auto" value={type} onChange={(e) => setType(e.target.value)}><option value="">{t('memory.allTypes')}</option>{MEMORY_TYPES.map((m) => <option key={m} value={m}>{t(`memoryTypes.${m}`)}</option>)}</NativeSelect>
      </div>
      {isLoading ? <LoadingBlock /> : !data?.length ? <EmptyState icon={<Brain />} title={t('memory.empty')} /> : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {data.map((m) => (
            <Card key={m.id} className={cn('p-5', m.pinned && 'border-primary/40')}>
              <div className="flex items-center gap-2">
                <Badge>{t(`memoryTypes.${m.memory_type}`)}</Badge>
                {m.source === 'ai' && <Badge tone="primary"><Bot /> {o.aiName(m.ai_employee_id) ?? 'AI'}</Badge>}
                {can('memory.manage') && (
                  <div className="ms-auto flex">
                    <Button size="icon-sm" variant="ghost" onClick={() => pin.mutate(m)} aria-label={t('memory.pin')}><Pin className={cn(m.pinned && 'fill-primary text-primary')} /></Button>
                    <Button size="icon-sm" variant="ghost" onClick={() => archive.mutate(m.id)} aria-label={t('memory.archive')}><Archive /></Button>
                  </div>
                )}
              </div>
              <p className="mt-3 font-medium" dir="auto">{m.title}</p>
              <p className="mt-1 line-clamp-5 whitespace-pre-wrap text-sm text-muted-foreground" dir="auto">{m.content}</p>
              {m.tags.length > 0 && <div className="mt-3 flex flex-wrap gap-1">{m.tags.map((x) => <Badge key={x}>#{x}</Badge>)}</div>}
            </Card>
          ))}
        </div>
      )}
      <EntityDialog entity="memories" open={open} onOpenChange={setOpen} title={t('memory.new')} fields={fields} initial={{ memory_type: 'company' }} />
    </FeatureGate>
  );
}

/* ------------------------------ Knowledge Center ------------------------------ */

/** Aggregates documents, SHARED files, memory, decisions and AI outputs. Private files never appear here. */
export function KnowledgePage() {
  const { t } = useTranslation();
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') ?? 'documents';
  const docs = useEntityList<Doc>('documents');
  const mem = useEntityList<Memory>('memories');
  const decisions = useQuery({ queryKey: ['work', 'decisions', {}], queryFn: () => api<Decision[]>('/work/decisions').catch(() => [] as Decision[]) });
  const files = useQuery({ queryKey: ['files-knowledge'], queryFn: () => api<{ files: CompanyFile[] }>('/files', { query: { space: 'shared', flat: '1' } }) });
  const outputs = useQuery({ queryKey: ['ai-outputs'], queryFn: () => api<Array<{ id: string; title: string; status: string; content: string; document_id: string | null; created_at: string; ai_employees: { name: string } | null }>>('/ai/outputs') });
  const counts = useMemo(() => ({ documents: docs.data?.length ?? 0, files: files.data?.files.length ?? 0, memory: mem.data?.length ?? 0, decisions: decisions.data?.length ?? 0, outputs: outputs.data?.length ?? 0 }), [docs.data, files.data, mem.data, decisions.data, outputs.data]);
  return (
    <FeatureGate feature="knowledge">
      <PageHeader title={t('nav.knowledgeCenter')} description={t('knowledge.description')} icon={<Library />} />
      <Tabs value={tab} onValueChange={(v) => setParams({ tab: v })}>
        <TabsList>
          <TabsTrigger value="documents"><FileText /> {t('nav.documents')} ({counts.documents})</TabsTrigger>
          <TabsTrigger value="files"><FolderOpen /> {t('files.shared')} ({counts.files})</TabsTrigger>
          <TabsTrigger value="memory"><Brain /> {t('nav.memory')} ({counts.memory})</TabsTrigger>
          <TabsTrigger value="decisions"><Scale /> {t('nav.decisions')} ({counts.decisions})</TabsTrigger>
          <TabsTrigger value="outputs"><Bot /> {t('ai.outputs')} ({counts.outputs})</TabsTrigger>
        </TabsList>
      </Tabs>
      <p className="mt-3 text-xs text-muted-foreground">{t('knowledge.privateExcluded')}</p>
      <div className="mt-4 grid gap-2">
        {tab === 'documents' && docs.data?.map((d) => <Link key={d.id} to={`/app/documents/${d.id}`} className="flex items-center gap-3 rounded-xl border bg-card p-3 hover:bg-muted/40"><FileText className="size-4 text-muted-foreground" /><span className="flex-1 truncate">{d.title}</span><Badge>{t(`docTypes.${d.doc_type}`)}</Badge></Link>)}
        {tab === 'files' && files.data?.files.map((f) => <Link key={f.id} to={`/app/files?file=${f.id}`} className="flex items-center gap-3 rounded-xl border bg-card p-3 hover:bg-muted/40"><FileIcon category={f.category} className="size-8" /><span className="flex-1 truncate">{f.original_name}</span><span className="text-xs text-muted-foreground">{formatRelative(f.created_at)}</span></Link>)}
        {tab === 'memory' && mem.data?.map((m) => <div key={m.id} className="rounded-xl border bg-card p-3"><p className="font-medium">{m.title}</p><p className="line-clamp-2 text-sm text-muted-foreground">{m.content}</p></div>)}
        {tab === 'decisions' && decisions.data?.map((d) => <div key={d.id} className="rounded-xl border bg-card p-3"><p className="font-medium">{d.title}</p><p className="text-sm text-muted-foreground">{d.chosen_option}</p></div>)}
        {tab === 'outputs' && outputs.data?.map((x) => <div key={x.id} className="flex items-center gap-3 rounded-xl border bg-card p-3"><Bot className="size-4 text-primary" /><span className="flex-1 truncate">{x.title}</span><span className="text-xs text-muted-foreground">{x.ai_employees?.name}</span><StatusBadge value={x.status} />{x.document_id && <Link className="text-xs text-primary" to={`/app/documents/${x.document_id}`}>{t('common.open')}</Link>}</div>)}
      </div>
    </FeatureGate>
  );
}
