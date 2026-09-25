import { Badge, Button, Dialog, DialogContent, DialogHeader, DialogTitle, EmptyState, PageHeader, Tabs, TabsList, TabsTrigger, Textarea } from '@nexus/ui';
import { useQuery } from '@tanstack/react-query';
import { Bot, CheckCircle2, MessageSquare, RotateCcw, XCircle } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router';
import { LoadingBlock, Markdown, StatusBadge, useAction } from '@/components/common';
import { api, apiPost } from '@/lib/api';
import { formatDateTime, formatRelative } from '@/lib/format';
import { useSession } from '@/providers/session';

interface Approval {
  id: string;
  title: string;
  description: string;
  approval_type: string;
  status: string;
  risk: string;
  payload: Record<string, unknown>;
  session_id: string | null;
  task_id: string | null;
  created_at: string;
  decided_at: string | null;
  decision_comment: string | null;
  ai_employees: { name: string; job_title: string } | null;
}

interface ApprovalDetail extends Approval {
  comments: Array<{ id: string; body: string; created_at: string }>;
  output: { title: string; content: string } | null;
}

export function ApprovalsPage() {
  const { t } = useTranslation();
  const [params, setParams] = useSearchParams();
  const [status, setStatus] = useState('pending');
  const { data, isLoading } = useQuery({ queryKey: ['approvals', status], queryFn: () => api<Approval[]>('/approvals', { query: { status: status === 'all' ? undefined : status } }), refetchInterval: 15_000 });
  const openId = params.get('id');
  return (
    <>
      <PageHeader title={t('nav.approvals')} description={t('approvals.description')} icon={<CheckCircle2 />} />
      <Tabs value={status} onValueChange={setStatus}>
        <TabsList>
          {['pending', 'approved', 'rejected', 'revision_requested', 'all'].map((s) => <TabsTrigger key={s} value={s}>{s === 'all' ? t('common.all') : t(`status.${s}`)}</TabsTrigger>)}
        </TabsList>
      </Tabs>
      <div className="mt-4">
        {isLoading ? <LoadingBlock /> : !data?.length ? <EmptyState icon={<CheckCircle2 />} title={t('approvals.none')} /> : (
          <ul className="grid gap-2">
            {data.map((a) => (
              <li key={a.id}>
                <button onClick={() => setParams({ id: a.id })} className="flex w-full items-center gap-3 rounded-xl border bg-card p-4 text-start hover:shadow-md">
                  <span className="flex size-9 items-center justify-center rounded-lg bg-primary/10 text-primary"><Bot className="size-4" /></span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">{a.title}</p>
                    <p className="truncate text-xs text-muted-foreground">{t(`approvalTypes.${a.approval_type}`)} · {a.ai_employees?.name ?? t('approvals.human')} · {formatRelative(a.created_at)}</p>
                  </div>
                  <Badge tone={a.risk === 'high' ? 'danger' : a.risk === 'medium' ? 'warning' : 'neutral'}>{t(`risk.${a.risk}`)}</Badge>
                  <StatusBadge value={a.status} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      <ApprovalDialog id={openId} onClose={() => setParams({})} />
    </>
  );
}

function ApprovalDialog({ id, onClose }: { id: string | null; onClose: () => void }) {
  const { t } = useTranslation();
  const { can } = useSession();
  const [comment, setComment] = useState('');
  const { data } = useQuery({ queryKey: ['approval', id], queryFn: () => api<ApprovalDetail>(`/approvals/${id}`), enabled: Boolean(id) });
  const decide = useAction((decision: string) => apiPost(`/approvals/${id}/decide`, { decision, comment }), { success: t('approvals.decided'), invalidate: [['approvals'], ['approval', id], ['operations']], onSuccess: () => { setComment(''); onClose(); } });
  const addComment = useAction(() => apiPost(`/approvals/${id}/comments`, { body: comment }), { invalidate: [['approval', id]], onSuccess: () => setComment('') });
  return (
    <Dialog open={Boolean(id)} onOpenChange={(o) => !o && onClose()}>
      <DialogContent size="lg" closeLabel={t('common.close')}>
        {data && (
          <>
            <DialogHeader>
              <div className="flex flex-wrap items-center gap-2"><StatusBadge value={data.status} /><Badge>{t(`approvalTypes.${data.approval_type}`)}</Badge><Badge tone={data.risk === 'high' ? 'danger' : 'warning'}>{t(`risk.${data.risk}`)}</Badge></div>
              <DialogTitle className="mt-2">{data.title}</DialogTitle>
            </DialogHeader>
            {data.description && <p className="whitespace-pre-wrap text-sm" dir="auto">{data.description}</p>}
            {typeof data.payload.tool === 'string' && (
              <div className="rounded-lg bg-muted p-3 text-xs">
                <p className="font-medium">{t('approvals.requestedAction')}: <span className="font-mono">{data.payload.tool}</span></p>
                <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap font-mono" dir="ltr">{JSON.stringify(data.payload.args, null, 2)}</pre>
              </div>
            )}
            {data.output && <div className="max-h-96 overflow-y-auto rounded-lg border p-4"><Markdown>{data.output.content}</Markdown></div>}
            {data.comments.length > 0 && (
              <ul className="grid gap-2">
                {data.comments.map((c) => <li key={c.id} className="rounded-lg bg-muted/60 px-3 py-2 text-sm"><MessageSquare className="me-1 inline size-3.5" /> {c.body} <span className="text-xs text-muted-foreground">· {formatDateTime(c.created_at)}</span></li>)}
              </ul>
            )}
            {data.status === 'pending' ? (
              <div className="grid gap-3">
                <Textarea rows={2} value={comment} onChange={(e) => setComment(e.target.value)} placeholder={t('approvals.commentPlaceholder')} />
                {can('approvals.decide') ? (
                  <div className="flex flex-wrap justify-end gap-2">
                    <Button variant="ghost" disabled={!comment.trim()} onClick={() => addComment.mutate(undefined)}><MessageSquare /> {t('approvals.comment')}</Button>
                    <Button variant="outline" onClick={() => decide.mutate('revision_requested')} loading={decide.isPending}><RotateCcw /> {t('approvals.requestChanges')}</Button>
                    <Button variant="destructive" onClick={() => decide.mutate('rejected')} loading={decide.isPending}><XCircle /> {t('approvals.reject')}</Button>
                    <Button onClick={() => decide.mutate('approved')} loading={decide.isPending}><CheckCircle2 /> {t('approvals.approve')}</Button>
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">{t('approvals.noPermission')}</p>
                )}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">{t('approvals.decidedAt', { date: formatDateTime(data.decided_at) })}{data.decision_comment ? ` — ${data.decision_comment}` : ''}</p>
            )}
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
