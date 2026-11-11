import { Badge, Button, Checkbox, Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, PageHeader, Section, Tabs, TabsContent, TabsList, TabsTrigger, Textarea } from '@nexus/ui';
import { useQuery } from '@tanstack/react-query';
import { Ban, BellRing, Check, CheckCircle2, Clock, Download, Eraser, FileSignature, PenLine, RefreshCw, Upload, X, XCircle } from 'lucide-react';
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router';
import { toast } from 'sonner';
import { LoadingBlock, useAction } from '@/components/common';
import { api, apiPost } from '@/lib/api';
import { formatDate, formatDateTime } from '@/lib/format';
import { SIGNATURE_TONES } from './signatures-page';

interface SignatureDetail {
  id: string;
  title: string;
  message: string;
  status: 'in_progress' | 'completed' | 'declined' | 'cancelled';
  sequential: boolean;
  due_at: string | null;
  verification_code: string;
  created_at: string;
  completed_at: string | null;
  signed_file_id: string | null;
  failure_reason: string | null;
  file_name: string;
  created_by_name: string;
  is_creator: boolean;
  can_manage: boolean;
  my_role: 'signer' | 'approver' | null;
  my_turn: boolean;
  signers: Array<{ id: string; name: string; role: 'signer' | 'approver'; sign_order: number; status: string; acted_at: string | null; viewed_at: string | null; decline_reason: string | null }>;
}

const MAX_BYTES = 512 * 1024;

export function SignatureDetailPage() {
  const { id = '' } = useParams();
  const { t } = useTranslation();
  const key = ['signature', id];
  const { data: r, isLoading } = useQuery({ queryKey: key, queryFn: () => api<SignatureDetail>(`/signatures/${id}`), refetchInterval: (q) => (q.state.data?.status === 'in_progress' ? 15_000 : false) });
  const [choice, setWhich] = useState<'original' | 'signed' | null>(null);
  const [signOpen, setSignOpen] = useState(false);
  const [declineOpen, setDeclineOpen] = useState(false);
  // Show the signed copy once it exists, unless the user picked the original.
  const which = choice ?? (r?.signed_file_id ? 'signed' : 'original');
  const pdfUrl = usePdf(r ? id : null, which);

  const approve = useAction(() => apiPost(`/signatures/${id}/approve`), { success: t('sign.approvedToast'), invalidate: [key, ['signatures']] });
  const cancel = useAction(() => apiPost(`/signatures/${id}/cancel`), { invalidate: [key, ['signatures']] });
  const remind = useAction(() => apiPost<{ reminded: number }>(`/signatures/${id}/remind`), { success: t('sign.reminded') });
  const retry = useAction(() => apiPost(`/signatures/${id}/finalize`), { invalidate: [key, ['signatures']] });

  if (isLoading || !r) return <LoadingBlock />;

  const download = async () => {
    const res = await api<Response>(`/signatures/${id}/document`, { query: { which: 'signed' }, raw: true });
    const url = URL.createObjectURL(await res.blob());
    const a = Object.assign(document.createElement('a'), { href: url, download: `${r.file_name.replace(/\.pdf$/i, '')} - ${t('sign.signedSuffix')}.pdf` });
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  };

  return (
    <>
      <PageHeader
        title={r.title}
        description={t('sign.from', { name: r.created_by_name }) + ` · ${formatDateTime(r.created_at)}`}
        icon={<FileSignature />}
        actions={<Badge tone={SIGNATURE_TONES[r.status]}>{t(`sign.status.${r.status}`)}</Badge>}
      />

      {r.my_turn && (
        <div className="mt-4 flex flex-wrap items-center gap-3 rounded-xl border border-amber-300 bg-amber-50 p-4 dark:border-amber-500/30 dark:bg-amber-500/10">
          <PenLine className="size-5 text-amber-600" />
          <p className="min-w-0 flex-1 font-medium">{r.my_role === 'approver' ? t('sign.askApprove') : t('sign.askSign')}</p>
          {r.my_role === 'approver' ? (
            <Button onClick={() => approve.mutate(undefined)} loading={approve.isPending}><Check /> {t('sign.approve')}</Button>
          ) : (
            <Button onClick={() => setSignOpen(true)}><PenLine /> {t('sign.signNow')}</Button>
          )}
          <Button variant="outline" onClick={() => setDeclineOpen(true)}><X /> {t('sign.decline')}</Button>
        </div>
      )}
      {r.failure_reason && r.status === 'in_progress' && (
        <div className="mt-4 flex flex-wrap items-center gap-3 rounded-xl border border-destructive/40 bg-destructive/5 p-4 text-sm">
          <XCircle className="size-5 text-destructive" />
          <p className="flex-1">{t(`sign.failure.${r.failure_reason}`, { defaultValue: t('sign.failure.generic') })}</p>
          {r.can_manage && <Button size="sm" variant="outline" onClick={() => retry.mutate(undefined)} loading={retry.isPending}><RefreshCw /> {t('sign.retry')}</Button>}
        </div>
      )}

      <div className="mt-6 grid gap-6 xl:grid-cols-[1fr_360px]">
        <Section
          title={r.file_name}
          actions={
            <div className="flex gap-2">
              {r.signed_file_id && (
                <Tabs value={which} onValueChange={(v) => setWhich(v as 'original' | 'signed')}>
                  <TabsList><TabsTrigger value="signed">{t('sign.signedCopy')}</TabsTrigger><TabsTrigger value="original">{t('sign.original')}</TabsTrigger></TabsList>
                </Tabs>
              )}
              {r.signed_file_id && <Button size="sm" variant="outline" onClick={() => void download()}><Download /> {t('common.download')}</Button>}
            </div>
          }
        >
          {pdfUrl ? <iframe title={r.file_name} src={pdfUrl} className="h-[75vh] w-full rounded-lg border bg-white" /> : <LoadingBlock />}
        </Section>

        <div className="grid content-start gap-6">
          <Section title={r.sequential ? t('sign.inOrder') : t('sign.allAtOnce')}>
            <ol className="grid gap-3">
              {r.signers.map((s) => (
                <li key={s.id} className="flex items-start gap-3">
                  <SignerIcon status={s.status} />
                  <div className="min-w-0 flex-1 text-sm">
                    <p className="truncate font-medium" dir="auto">{r.sequential && <span className="me-1 text-muted-foreground tabular-nums">{s.sign_order}.</span>}{s.name}</p>
                    <p className="text-xs text-muted-foreground">{t(`sign.roles.${s.role}`)} · {t(`sign.signerStatus.${s.status}`)}{s.acted_at ? ` · ${formatDateTime(s.acted_at)}` : ''}</p>
                    {s.decline_reason && <p className="mt-1 rounded bg-destructive/5 p-2 text-xs" dir="auto">{s.decline_reason}</p>}
                  </div>
                </li>
              ))}
            </ol>
          </Section>
          <Section title={t('sign.details')}>
            <dl className="grid gap-2 text-sm">
              {r.message && <div><dt className="text-xs text-muted-foreground">{t('sign.message')}</dt><dd className="whitespace-pre-wrap" dir="auto">{r.message}</dd></div>}
              {r.due_at && <div><dt className="text-xs text-muted-foreground">{t('sign.due')}</dt><dd>{formatDate(r.due_at)}</dd></div>}
              <div><dt className="text-xs text-muted-foreground">{t('sign.code')}</dt><dd className="font-mono" dir="ltr">{r.verification_code}</dd></div>
              {r.completed_at && <div><dt className="text-xs text-muted-foreground">{t('sign.completedAt')}</dt><dd>{formatDateTime(r.completed_at)}</dd></div>}
            </dl>
            {r.can_manage && r.status === 'in_progress' && (
              <div className="mt-4 flex flex-wrap gap-2">
                <Button size="sm" variant="outline" onClick={() => remind.mutate(undefined)} loading={remind.isPending}><BellRing /> {t('sign.remind')}</Button>
                <Button size="sm" variant="ghost" className="text-destructive" onClick={() => cancel.mutate(undefined)} loading={cancel.isPending}><Ban /> {t('sign.cancel')}</Button>
              </div>
            )}
            <p className="mt-4 text-xs text-muted-foreground">{t('sign.legalNote')}</p>
          </Section>
        </div>
      </div>

      <SignDialog open={signOpen} onOpenChange={setSignOpen} requestId={id} onDone={() => setSignOpen(false)} />
      <DeclineDialog open={declineOpen} onOpenChange={setDeclineOpen} requestId={id} />
    </>
  );
}

function SignerIcon({ status }: { status: string }) {
  if (status === 'signed' || status === 'approved') return <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-emerald-500" />;
  if (status === 'declined') return <XCircle className="mt-0.5 size-5 shrink-0 text-destructive" />;
  if (status === 'pending' || status === 'viewed') return <PenLine className="mt-0.5 size-5 shrink-0 text-amber-500" />;
  return <Clock className="mt-0.5 size-5 shrink-0 text-muted-foreground" />;
}

/** Fetches the PDF with auth and shows it through a blob URL (the browser's own PDF viewer). */
function usePdf(id: string | null, which: 'original' | 'signed'): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!id) return;
    let alive = true;
    let objectUrl: string | null = null;
    setUrl(null);
    void api<Response>(`/signatures/${id}/document`, { query: { which }, raw: true })
      .then((res) => res.blob())
      .then((blob) => {
        if (!alive) return;
        objectUrl = URL.createObjectURL(blob);
        setUrl(objectUrl);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [id, which]);
  return url;
}

/* ------------------------------ signing ------------------------------ */

function SignDialog({ open, onOpenChange, requestId, onDone }: { open: boolean; onOpenChange: (v: boolean) => void; requestId: string; onDone: () => void }) {
  const { t } = useTranslation();
  const saved = useQuery({ queryKey: ['my-signature'], enabled: open, queryFn: () => api<{ saved: boolean; image?: string }>('/signatures/me/saved') });
  const [tab, setTab] = useState<'saved' | 'draw' | 'upload'>('draw');
  const [drawn, setDrawn] = useState<string | null>(null);
  const [uploaded, setUploaded] = useState<string | null>(null);
  const [saveDefault, setSaveDefault] = useState(true);
  const [consent, setConsent] = useState(false);

  useEffect(() => {
    if (open && saved.data?.saved) setTab('saved');
    if (!open) {
      setDrawn(null);
      setUploaded(null);
      setConsent(false);
    }
  }, [open, saved.data?.saved]);

  const image = tab === 'draw' ? drawn : tab === 'upload' ? uploaded : null;
  const sign = useAction(
    () =>
      apiPost(`/signatures/${requestId}/sign`, tab === 'saved'
        ? { method: 'drawn', use_saved: true, consent: true }
        : { method: tab === 'draw' ? 'drawn' : 'uploaded', image_base64: image, save_as_default: saveDefault, consent: true }),
    { success: t('sign.signedToast'), invalidate: [['signature', requestId], ['signatures'], ['my-signature']], onSuccess: onDone },
  );

  const onFile = (file: File | undefined) => {
    if (!file) return;
    if (!['image/png', 'image/jpeg'].includes(file.type)) return toast.error(t('sign.pngOnly'));
    if (file.size > MAX_BYTES) return toast.error(t('sign.tooLarge'));
    const reader = new FileReader();
    reader.onload = () => setUploaded(String(reader.result));
    reader.readAsDataURL(file);
  };

  const ready = consent && (tab === 'saved' ? Boolean(saved.data?.saved) : Boolean(image));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="lg" closeLabel={t('common.close')}>
        <DialogHeader><DialogTitle>{t('sign.signNow')}</DialogTitle></DialogHeader>
        <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)}>
          <TabsList>
            {saved.data?.saved && <TabsTrigger value="saved">{t('sign.useSaved')}</TabsTrigger>}
            <TabsTrigger value="draw"><PenLine /> {t('sign.draw')}</TabsTrigger>
            <TabsTrigger value="upload"><Upload /> {t('sign.upload')}</TabsTrigger>
          </TabsList>
          {saved.data?.saved && (
            <TabsContent value="saved">
              <div className="flex h-44 items-center justify-center rounded-lg border bg-white"><img src={saved.data.image} alt={t('sign.useSaved')} className="max-h-36 max-w-full object-contain" /></div>
            </TabsContent>
          )}
          <TabsContent value="draw"><SignaturePad onChange={setDrawn} /></TabsContent>
          <TabsContent value="upload">
            <label className="flex h-44 cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border border-dashed bg-white text-sm text-muted-foreground hover:bg-muted/30">
              {uploaded ? <img src={uploaded} alt="" className="max-h-36 max-w-full object-contain" /> : <><Upload className="size-6" />{t('sign.uploadHint')}</>}
              <input type="file" accept="image/png,image/jpeg" className="sr-only" onChange={(e) => onFile(e.target.files?.[0])} />
            </label>
          </TabsContent>
        </Tabs>
        {tab !== 'saved' && (
          <label className="flex items-center gap-2 text-sm"><Checkbox checked={saveDefault} onCheckedChange={(v) => setSaveDefault(v === true)} /> {t('sign.saveDefault')}</label>
        )}
        <label className="flex items-start gap-2 rounded-lg bg-muted/50 p-3 text-sm"><Checkbox className="mt-0.5" checked={consent} onCheckedChange={(v) => setConsent(v === true)} /> {t('sign.consent')}</label>
        <DialogFooter><Button onClick={() => sign.mutate(undefined)} disabled={!ready} loading={sign.isPending}><Check /> {t('sign.confirmSign')}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Draw with mouse, finger or pen. Exports a transparent PNG trimmed to the ink. */
function SignaturePad({ onChange }: { onChange: (dataUrl: string | null) => void }) {
  const { t } = useTranslation();
  const canvas = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const inked = useRef(false);
  const last = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    const c = canvas.current!;
    const ratio = window.devicePixelRatio || 1;
    c.width = c.clientWidth * ratio;
    c.height = c.clientHeight * ratio;
    const ctx = c.getContext('2d')!;
    ctx.scale(ratio, ratio);
    ctx.lineWidth = 2.6;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = '#1e3a8a';
  }, []);

  const point = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };
  const down = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    drawing.current = true;
    last.current = point(e);
  };
  const move = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current || !last.current) return;
    const ctx = canvas.current!.getContext('2d')!;
    const p = point(e);
    ctx.beginPath();
    ctx.moveTo(last.current.x, last.current.y);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
    last.current = p;
    inked.current = true;
  };
  const up = () => {
    if (!drawing.current) return;
    drawing.current = false;
    onChange(inked.current ? trimmed(canvas.current!) : null);
  };
  const clear = () => {
    const c = canvas.current!;
    c.getContext('2d')!.clearRect(0, 0, c.width, c.height);
    inked.current = false;
    onChange(null);
  };

  return (
    <div className="grid gap-2">
      <canvas
        ref={canvas}
        data-testid="signature-pad"
        className="h-44 w-full touch-none rounded-lg border bg-white"
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerLeave={up}
        aria-label={t('sign.drawHere')}
      />
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>{t('sign.drawHere')}</span>
        <Button type="button" size="sm" variant="ghost" onClick={clear}><Eraser /> {t('sign.clear')}</Button>
      </div>
    </div>
  );
}

/** Crops the canvas to the drawn strokes (plus padding) so the signature isn't tiny on the PDF. */
function trimmed(c: HTMLCanvasElement): string {
  const ctx = c.getContext('2d')!;
  const { data, width, height } = ctx.getImageData(0, 0, c.width, c.height);
  let minX = width, minY = height, maxX = 0, maxY = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (data[(y * width + x) * 4 + 3]! > 0) {
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
    }
  }
  const pad = 12;
  const sx = Math.max(0, minX - pad), sy = Math.max(0, minY - pad);
  const w = Math.min(width, maxX + pad) - sx, h = Math.min(height, maxY + pad) - sy;
  const out = document.createElement('canvas');
  out.width = Math.max(1, w);
  out.height = Math.max(1, h);
  out.getContext('2d')!.drawImage(c, sx, sy, w, h, 0, 0, w, h);
  return out.toDataURL('image/png');
}

function DeclineDialog({ open, onOpenChange, requestId }: { open: boolean; onOpenChange: (v: boolean) => void; requestId: string }) {
  const { t } = useTranslation();
  const [reason, setReason] = useState('');
  const decline = useAction(() => apiPost(`/signatures/${requestId}/decline`, { reason }), { invalidate: [['signature', requestId], ['signatures']], onSuccess: () => onOpenChange(false) });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="sm" closeLabel={t('common.close')}>
        <DialogHeader><DialogTitle>{t('sign.decline')}</DialogTitle></DialogHeader>
        <Textarea rows={3} maxLength={2000} placeholder={t('sign.declineReason')} value={reason} onChange={(e) => setReason(e.target.value)} dir="auto" />
        <DialogFooter><Button variant="destructive" disabled={reason.trim().length < 2} loading={decline.isPending} onClick={() => decline.mutate(undefined)}>{t('sign.decline')}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
