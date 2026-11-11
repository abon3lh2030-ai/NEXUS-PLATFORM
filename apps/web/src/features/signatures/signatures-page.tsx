import { Badge, Button, Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, EmptyState, Field, Input, NativeSelect, PageHeader, Switch, Tabs, TabsList, TabsTrigger, Textarea } from '@nexus/ui';
import { useQuery } from '@tanstack/react-query';
import { ArrowDown, ArrowUp, FileSignature, Plus, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { LoadingBlock, useAction } from '@/components/common';
import { useOptions } from '@/features/work/shared';
import { api, apiPost } from '@/lib/api';
import { formatDate, formatRelative } from '@/lib/format';
import { useSession } from '@/providers/session';

export interface SignatureListItem {
  id: string;
  title: string;
  status: 'in_progress' | 'completed' | 'declined' | 'cancelled';
  created_at: string;
  due_at: string | null;
  created_by_name: string;
  is_creator: boolean;
  my_turn: boolean;
  my_status: string | null;
  my_role: 'signer' | 'approver' | null;
  progress: { done: number; total: number };
}

export const SIGNATURE_TONES: Record<string, 'info' | 'success' | 'danger' | 'neutral' | 'warning'> = { in_progress: 'info', completed: 'success', declined: 'danger', cancelled: 'neutral' };

type Tab = 'mine' | 'sent' | 'all';

/** Signature and sign-off requests: what's waiting for me, what I sent, and everything else I'm part of. */
export function SignaturesPage() {
  const { t } = useTranslation();
  const { can } = useSession();
  const [params, setParams] = useSearchParams();
  const [tab, setTab] = useState<Tab>('mine');
  const { data, isLoading } = useQuery({ queryKey: ['signatures'], queryFn: () => api<SignatureListItem[]>('/signatures'), refetchInterval: 30_000 });
  const open = params.get('new') === '1';
  const setOpen = (v: boolean) => setParams(v ? { new: '1' } : {});

  const rows = useMemo(() => {
    const all = data ?? [];
    if (tab === 'mine') return all.filter((r) => r.my_turn);
    if (tab === 'sent') return all.filter((r) => r.is_creator);
    return all;
  }, [data, tab]);
  const waiting = (data ?? []).filter((r) => r.my_turn).length;

  return (
    <>
      <PageHeader
        title={t('nav.signatures')}
        description={t('sign.description')}
        icon={<FileSignature />}
        actions={can('documents.create') && <Button onClick={() => setOpen(true)}><Plus /> {t('sign.new')}</Button>}
      />
      <Tabs value={tab} onValueChange={(v) => setTab(v as Tab)} className="mt-4">
        <TabsList>
          <TabsTrigger value="mine">{t('sign.tabs.mine')}{waiting > 0 && <Badge tone="danger" className="ms-1.5">{waiting}</Badge>}</TabsTrigger>
          <TabsTrigger value="sent">{t('sign.tabs.sent')}</TabsTrigger>
          <TabsTrigger value="all">{t('sign.tabs.all')}</TabsTrigger>
        </TabsList>
      </Tabs>
      {isLoading ? (
        <LoadingBlock />
      ) : rows.length === 0 ? (
        <EmptyState className="mt-6" icon={<FileSignature />} title={t(`sign.empty.${tab}`)} />
      ) : (
        <ul className="mt-4 grid gap-2">
          {rows.map((r) => (
            <li key={r.id}>
              <Link to={`/app/signatures/${r.id}`} className="flex flex-wrap items-center gap-3 rounded-xl border bg-card p-4 hover:bg-muted/50">
                <FileSignature className="size-5 text-primary" />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium" dir="auto">{r.title}</p>
                  <p className="text-xs text-muted-foreground">{t('sign.from', { name: r.created_by_name })} · {formatRelative(r.created_at)}{r.due_at ? ` · ${t('sign.dueOn', { date: formatDate(r.due_at) })}` : ''}</p>
                </div>
                {r.my_turn && <Badge tone="warning">{r.my_role === 'approver' ? t('sign.yourApproval') : t('sign.yourSignature')}</Badge>}
                <span className="text-sm tabular-nums text-muted-foreground">{t('sign.progress', { done: r.progress.done, total: r.progress.total })}</span>
                <Badge tone={SIGNATURE_TONES[r.status]}>{t(`sign.status.${r.status}`)}</Badge>
              </Link>
            </li>
          ))}
        </ul>
      )}
      <NewSignatureDialog open={open} onOpenChange={setOpen} />
    </>
  );
}

interface PdfFile {
  id: string;
  original_name: string;
}

function NewSignatureDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const o = useOptions();
  const [title, setTitle] = useState('');
  const [message, setMessage] = useState('');
  const [fileId, setFileId] = useState('');
  const [sequential, setSequential] = useState(true);
  const [due, setDue] = useState('');
  const [signers, setSigners] = useState<Array<{ member_id: string; role: 'signer' | 'approver' }>>([]);
  const [pick, setPick] = useState('');

  const files = useQuery({
    queryKey: ['signature-pdfs'],
    enabled: open,
    queryFn: async () => {
      const [shared, priv] = await Promise.all([
        api<{ files: PdfFile[] }>('/files', { query: { space: 'shared', flat: '1', category: 'pdf' } }).catch(() => ({ files: [] })),
        api<{ files: PdfFile[] }>('/files', { query: { space: 'private', flat: '1', category: 'pdf' } }).catch(() => ({ files: [] })),
      ]);
      return [...shared.files, ...priv.files];
    },
  });

  useEffect(() => {
    if (!open) {
      setTitle('');
      setMessage('');
      setFileId('');
      setSigners([]);
      setDue('');
      setSequential(true);
    }
  }, [open]);

  const create = useAction(
    () => apiPost<{ id: string }>('/signatures', { title, message, file_id: fileId, sequential, due_at: due ? new Date(`${due}T23:59:00+03:00`).toISOString() : null, signers }),
    { success: t('sign.sent'), invalidate: [['signatures']], onSuccess: (r) => { onOpenChange(false); navigate(`/app/signatures/${r.id}`); } },
  );

  const move = (i: number, d: -1 | 1) => setSigners((list) => {
    const next = [...list];
    const j = i + d;
    if (j < 0 || j >= next.length) return list;
    [next[i], next[j]] = [next[j]!, next[i]!];
    return next;
  });

  const available = o.members.filter((m) => !signers.some((s) => s.member_id === m.value));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="lg" closeLabel={t('common.close')}>
        <DialogHeader><DialogTitle>{t('sign.new')}</DialogTitle></DialogHeader>
        <form className="grid gap-4" onSubmit={(e) => { e.preventDefault(); create.mutate(undefined); }}>
          <Field label={t('sign.document')} hint={t('sign.documentHint')}>
            <NativeSelect required value={fileId} onChange={(e) => { setFileId(e.target.value); if (!title) setTitle((files.data ?? []).find((f) => f.id === e.target.value)?.original_name.replace(/\.pdf$/i, '') ?? ''); }}>
              <option value="">{files.isLoading ? t('common.loading') : t('sign.pickPdf')}</option>
              {(files.data ?? []).map((f) => <option key={f.id} value={f.id}>{f.original_name}</option>)}
            </NativeSelect>
          </Field>
          <Field label={t('sign.title')}><Input required maxLength={200} value={title} onChange={(e) => setTitle(e.target.value)} dir="auto" /></Field>
          <Field label={t('sign.message')}><Textarea rows={2} maxLength={4000} value={message} onChange={(e) => setMessage(e.target.value)} dir="auto" /></Field>

          <div className="grid gap-2">
            <p className="text-sm font-medium">{t('sign.signers')}</p>
            {signers.length === 0 && <p className="text-sm text-muted-foreground">{t('sign.noSigners')}</p>}
            <ol className="grid gap-2">
              {signers.map((s, i) => (
                <li key={s.member_id} className="flex items-center gap-2 rounded-lg border p-2">
                  {sequential && <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-muted text-xs tabular-nums">{i + 1}</span>}
                  <span className="min-w-0 flex-1 truncate text-sm" dir="auto">{o.memberName(s.member_id)}</span>
                  <NativeSelect className="w-auto" value={s.role} onChange={(e) => setSigners((list) => list.map((x) => (x.member_id === s.member_id ? { ...x, role: e.target.value as 'signer' | 'approver' } : x)))}>
                    <option value="signer">{t('sign.roles.signer')}</option>
                    <option value="approver">{t('sign.roles.approver')}</option>
                  </NativeSelect>
                  {sequential && (
                    <>
                      <Button type="button" size="icon-sm" variant="ghost" onClick={() => move(i, -1)} aria-label={t('sign.moveUp')}><ArrowUp /></Button>
                      <Button type="button" size="icon-sm" variant="ghost" onClick={() => move(i, 1)} aria-label={t('sign.moveDown')}><ArrowDown /></Button>
                    </>
                  )}
                  <Button type="button" size="icon-sm" variant="ghost" onClick={() => setSigners((list) => list.filter((x) => x.member_id !== s.member_id))} aria-label={t('common.delete')}><Trash2 /></Button>
                </li>
              ))}
            </ol>
            <div className="flex gap-2">
              <NativeSelect value={pick} onChange={(e) => setPick(e.target.value)}>
                <option value="">{t('sign.addPerson')}</option>
                {available.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
              </NativeSelect>
              <Button type="button" variant="outline" disabled={!pick || signers.length >= 20} onClick={() => { setSigners((l) => [...l, { member_id: pick, role: 'signer' }]); setPick(''); }}><Plus /> {t('common.add')}</Button>
            </div>
          </div>

          <label className="flex items-center justify-between gap-3 rounded-lg border p-3 text-sm">
            <span><span className="font-medium">{t('sign.sequential')}</span><span className="block text-xs text-muted-foreground">{sequential ? t('sign.sequentialHint') : t('sign.parallelHint')}</span></span>
            <Switch checked={sequential} onCheckedChange={setSequential} />
          </label>
          <Field label={t('sign.due')}><Input type="date" value={due} onChange={(e) => setDue(e.target.value)} /></Field>

          <DialogFooter><Button type="submit" loading={create.isPending} disabled={!fileId || !title.trim() || signers.length === 0}>{t('sign.send')}</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
