import { Badge, Button, Card, ConfirmDialog, Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, EmptyState, Field, Input, NativeSelect, PageHeader, Section, Textarea, cn } from '@nexus/ui';
import type { DeckSpec } from '@nexus/shared';
import { useQuery } from '@tanstack/react-query';
import { Bot, CheckCircle2, Copy, Download, FileText, Pencil, Presentation as PresentationIcon, RotateCcw, Share2, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useParams } from 'react-router';
import { toast } from 'sonner';
import { LoadingBlock, StatusBadge, useAction, useErrorMessage } from '@/components/common';
import { NoAccess } from '@/components/guards';
import { useOptions } from '@/features/work/shared';
import { api, apiDelete, apiPatch, apiPost } from '@/lib/api';
import { formatDateTime, formatRelative } from '@/lib/format';
import { useSession } from '@/providers/session';
import { SlidePreview } from './slide-preview';

export interface PresentationListItem {
  id: string;
  title: string;
  status: string;
  language: 'ar' | 'en';
  current_version: number;
  ai_employee_id: string | null;
  project_id: string | null;
  meeting_id: string | null;
  updated_at: string;
  ai_employees: { name: string } | null;
}

interface PresentationDetail extends PresentationListItem {
  created_at: string;
  published_file_id: string | null;
  versions: Array<{ id: string; version: number; label: string; slide_count: number; change_summary: string | null; created_at: string; created_by_user_id: string | null; created_by_ai_employee_id: string | null; spec: DeckSpec }>;
  approvals: Array<{ id: string; status: string; decision_comment: string | null; created_at: string }>;
}

export async function downloadPresentation(id: string, version: number) {
  const { url } = await api<{ url: string }>(`/presentations/${id}/versions/${version}/download`);
  const a = document.createElement('a');
  a.href = url;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
}

export function PresentationGrid({ items }: { items: PresentationListItem[] }) {
  const { t } = useTranslation();
  return (
    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
      {items.map((p) => (
        <Link key={p.id} to={`/app/presentations/${p.id}`}>
          <Card className="h-full p-5 hover:shadow-lg">
            <div className="flex items-center gap-2"><PresentationIcon className="size-4 text-primary" /><StatusBadge value={p.status} /><Badge>v{p.current_version}</Badge><Badge>{p.language === 'ar' ? 'العربية' : 'English'}</Badge></div>
            <p className="mt-3 font-semibold" dir="auto">{p.title}</p>
            <p className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">{p.ai_employees && <><Bot className="size-3.5" /> {p.ai_employees.name} · </>}{formatRelative(p.updated_at)}</p>
            <p className="sr-only">{t('presentations.open')}</p>
          </Card>
        </Link>
      ))}
    </div>
  );
}

export function PresentationsPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { can } = useSession();
  const [open, setOpen] = useState(false);
  const { data, isLoading } = useQuery({ queryKey: ['presentations'], queryFn: () => api<PresentationListItem[]>('/presentations') });
  return (
    <>
      <PageHeader title={t('nav.presentations')} description={t('presentations.description')} icon={<PresentationIcon />} actions={can('ai.assign') && <Button variant="brand" onClick={() => setOpen(true)}><Bot /> {t('presentations.request')}</Button>} />
      {isLoading ? <LoadingBlock /> : !data?.length ? <EmptyState icon={<PresentationIcon />} title={t('presentations.empty')} description={t('presentations.emptyHint')} /> : <PresentationGrid items={data} />}
      <RequestPresentationDialog open={open} onOpenChange={setOpen} onCreated={(taskId) => navigate(`/app/tasks/${taskId}`)} />
    </>
  );
}

/** Asking for a presentation creates a real task for an AI employee (it researches, builds the PPTX, requests approval). */
export function RequestPresentationDialog({ open, onOpenChange, onCreated, presetAi, projectId }: { open: boolean; onOpenChange: (o: boolean) => void; onCreated?: (taskId: string) => void; presetAi?: string; projectId?: string | null }) {
  const { t } = useTranslation();
  const o = useOptions();
  const [form, setForm] = useState({ ai: presetAi ?? '', title: '', brief: '', language: 'ar', project: projectId ?? '' });
  const create = useAction(
    () =>
      apiPost<{ id: string }>('/work/tasks', {
        title: `${t('presentations.taskPrefix')}: ${form.title}`.slice(0, 300),
        description: `${t('presentations.taskInstruction', { language: form.language === 'ar' ? 'العربية' : 'English' })}\n\n${form.brief}`,
        assignee_ai_employee_id: form.ai,
        project_id: form.project || null,
        priority: 'high',
        status: 'todo',
      }),
    { success: t('tasks.aiStarted'), invalidate: [['work', 'tasks']], onSuccess: (r) => { onOpenChange(false); onCreated?.(r.id); } },
  );
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent closeLabel={t('common.close')}>
        <DialogHeader><DialogTitle>{t('presentations.request')}</DialogTitle></DialogHeader>
        <form className="grid gap-4" onSubmit={(e) => { e.preventDefault(); create.mutate(undefined); }}>
          <Field label={t('fields.aiAssignee')}><NativeSelect required value={form.ai} onChange={(e) => setForm({ ...form, ai: e.target.value })}><option value="">{t('common.none')}</option>{o.ais.map((a) => <option key={a.value} value={a.value}>{a.label}</option>)}</NativeSelect></Field>
          <Field label={t('fields.title')}><Input required value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder={t('presentations.titlePlaceholder')} /></Field>
          <Field label={t('presentations.brief')} hint={t('presentations.briefHint')}><Textarea rows={5} value={form.brief} onChange={(e) => setForm({ ...form, brief: e.target.value })} /></Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t('common.language')}><NativeSelect value={form.language} onChange={(e) => setForm({ ...form, language: e.target.value })}><option value="ar">العربية</option><option value="en">English</option></NativeSelect></Field>
            <Field label={t('fields.project')}><NativeSelect value={form.project} onChange={(e) => setForm({ ...form, project: e.target.value })}><option value="">{t('common.none')}</option>{o.projects.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}</NativeSelect></Field>
          </div>
          <DialogFooter><Button type="submit" variant="brand" disabled={!form.ai || !form.title.trim()} loading={create.isPending}>{t('presentations.startWork')}</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function PresentationPage() {
  const { id } = useParams();
  const { t } = useTranslation();
  const { can, org } = useSession();
  const navigate = useNavigate();
  const msg = useErrorMessage();
  const o = useOptions();
  const [version, setVersion] = useState<number | null>(null);
  const [feedback, setFeedback] = useState('');
  const [rename, setRename] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const { data: p, isLoading } = useQuery({ queryKey: ['presentation', id], queryFn: () => api<PresentationDetail>(`/presentations/${id}`) });
  const inv = [['presentation', id], ['presentations']];
  const approve = useAction((publish: boolean) => apiPost(`/presentations/${id}/approve`, { publish }), { success: t('presentations.approved'), invalidate: inv });
  const revise = useAction(() => apiPost(`/presentations/${id}/revise`, { feedback }), { success: t('presentations.newVersion'), invalidate: inv, onSuccess: () => { setFeedback(''); setVersion(null); } });
  const publish = useAction(() => apiPost(`/presentations/${id}/publish`), { success: t('presentations.published'), invalidate: inv });
  const duplicate = useAction(() => apiPost<{ id: string }>(`/presentations/${id}/duplicate`), { success: t('common.created'), invalidate: [['presentations']], onSuccess: (r) => navigate(`/app/presentations/${r.id}`) });
  const update = useAction((patch: Record<string, unknown>) => apiPatch(`/presentations/${id}`, patch), { success: t('common.saved'), invalidate: inv, onSuccess: () => setRename(null) });
  const remove = useAction(() => apiDelete(`/presentations/${id}`), { success: t('common.deleted'), invalidate: [['presentations']], onSuccess: () => navigate('/app/presentations') });

  if (isLoading) return <LoadingBlock />;
  if (!p) return <NoAccess />;
  const current = p.versions.find((v) => v.version === (version ?? p.current_version)) ?? p.versions[0];
  const company = org?.organization.name ?? '';

  return (
    <>
      <div className="mb-6 flex flex-col gap-3 lg:flex-row lg:items-start">
        <div className="flex-1">
          <div className="flex flex-wrap items-center gap-2"><StatusBadge value={p.status} /><Badge>v{p.current_version}</Badge>{p.ai_employees && <Badge tone="primary"><Bot /> {p.ai_employees.name}</Badge>}</div>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight" dir="auto">{p.title}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{t('presentations.meta', { created: formatDateTime(p.created_at), updated: formatRelative(p.updated_at) })}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {current && <Button onClick={() => void downloadPresentation(p.id, current.version).catch((e: unknown) => toast.error(msg(e)))}><Download /> {t('presentations.downloadPptx')}</Button>}
          <Button variant="outline" onClick={() => setRename(p.title)}><Pencil /> {t('files.rename')}</Button>
          <Button variant="outline" onClick={() => duplicate.mutate(undefined)} loading={duplicate.isPending}><Copy /> {t('presentations.duplicate')}</Button>
          {p.status === 'final' && !p.published_file_id && can('files.shared.upload') && <Button variant="outline" onClick={() => publish.mutate(undefined)} loading={publish.isPending}><Share2 /> {t('presentations.publish')}</Button>}
          {can('documents.manage') && <Button variant="ghost" size="icon" onClick={() => setConfirmDelete(true)} aria-label={t('common.delete')}><Trash2 /></Button>}
        </div>
      </div>

      <div className="grid gap-6 xl:grid-cols-[1fr_320px]">
        <div className="grid content-start gap-4">
          {current ? current.spec.slides.map((s, i) => <SlidePreview key={`${current.version}-${i}`} slide={s} index={i} spec={current.spec} company={company} />) : <EmptyState icon={<FileText />} title={t('presentations.noVersions')} />}
          <p className="text-center text-xs text-muted-foreground">{t('presentations.previewNote')}</p>
        </div>
        <div className="grid content-start gap-6">
          {can('approvals.decide') && (p.status === 'pending_approval' || p.status === 'changes_requested' || p.status === 'draft') && (
            <Section title={t('presentations.review')}>
              <div className="grid gap-2">
                <Button onClick={() => approve.mutate(false)} loading={approve.isPending}><CheckCircle2 /> {t('approvals.approve')}</Button>
                {can('files.shared.upload') && <Button variant="outline" onClick={() => approve.mutate(true)} loading={approve.isPending}><Share2 /> {t('presentations.approvePublish')}</Button>}
              </div>
              <div className="mt-4 grid gap-2">
                <Textarea rows={3} value={feedback} onChange={(e) => setFeedback(e.target.value)} placeholder={t('presentations.feedbackPlaceholder')} />
                <Button variant="outline" disabled={feedback.trim().length < 3} loading={revise.isPending} onClick={() => revise.mutate(undefined)}><RotateCcw /> {t('presentations.requestChanges')}</Button>
                <p className="text-xs text-muted-foreground">{t('presentations.revisionHint')}</p>
              </div>
            </Section>
          )}
          <Section title={t('documents.versions')}>
            <ul className="grid gap-1">
              {p.versions.map((v) => (
                <li key={v.id}>
                  <button onClick={() => setVersion(v.version === p.current_version ? null : v.version)} className={cn('w-full rounded-lg px-2 py-1.5 text-start text-sm hover:bg-muted', current?.version === v.version && 'bg-muted')}>
                    <span className="font-medium">{v.label || `v${v.version}`}</span> <span className="text-xs text-muted-foreground">· {t('presentations.slides', { count: v.slide_count })} · {formatRelative(v.created_at)}</span>
                    {v.change_summary && <span className="block truncate text-xs text-muted-foreground">{v.change_summary}</span>}
                  </button>
                  <button className="ms-2 text-xs text-primary" onClick={() => void downloadPresentation(p.id, v.version).catch((e: unknown) => toast.error(msg(e)))}>{t('files.download')}</button>
                </li>
              ))}
            </ul>
          </Section>
          <Section title={t('presentations.links')}>
            <div className="grid gap-3">
              <Field label={t('fields.project')}><NativeSelect value={p.project_id ?? ''} onChange={(e) => update.mutate({ project_id: e.target.value || null })}><option value="">{t('common.none')}</option>{o.projects.map((x) => <option key={x.value} value={x.value}>{x.label}</option>)}</NativeSelect></Field>
              <MeetingPicker value={p.meeting_id} onChange={(v) => update.mutate({ meeting_id: v })} />
              {p.published_file_id && <Link className="text-sm text-primary" to={`/app/files?file=${p.published_file_id}`}>{t('presentations.inSharedFiles')}</Link>}
            </div>
          </Section>
          {p.approvals.length > 0 && (
            <Section title={t('nav.approvals')}>
              <ul className="grid gap-2 text-sm">{p.approvals.map((a) => <li key={a.id} className="flex items-center gap-2"><StatusBadge value={a.status} /><span className="text-xs text-muted-foreground">{formatRelative(a.created_at)}</span>{a.decision_comment && <span className="truncate text-xs">{a.decision_comment}</span>}</li>)}</ul>
            </Section>
          )}
        </div>
      </div>

      <Dialog open={rename !== null} onOpenChange={(o2) => !o2 && setRename(null)}>
        <DialogContent size="sm" closeLabel={t('common.close')}>
          <DialogHeader><DialogTitle>{t('files.rename')}</DialogTitle></DialogHeader>
          <Input value={rename ?? ''} onChange={(e) => setRename(e.target.value)} />
          <DialogFooter><Button onClick={() => update.mutate({ title: rename })} loading={update.isPending}>{t('common.save')}</Button></DialogFooter>
        </DialogContent>
      </Dialog>
      <ConfirmDialog open={confirmDelete} onOpenChange={setConfirmDelete} title={t('presentations.deleteTitle')} confirmLabel={t('common.delete')} cancelLabel={t('common.cancel')} destructive onConfirm={() => { remove.mutate(undefined); setConfirmDelete(false); }} />
    </>
  );
}

function MeetingPicker({ value, onChange }: { value: string | null; onChange: (v: string | null) => void }) {
  const { t } = useTranslation();
  const { data } = useQuery({ queryKey: ['work', 'meetings', {}], queryFn: () => api<Array<{ id: string; title: string }>>('/work/meetings').catch(() => []) });
  return (
    <Field label={t('nav.meetings')}>
      <NativeSelect value={value ?? ''} onChange={(e) => onChange(e.target.value || null)}><option value="">{t('common.none')}</option>{data?.map((m) => <option key={m.id} value={m.id}>{m.title}</option>)}</NativeSelect>
    </Field>
  );
}
