import { Button, Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, Spinner } from '@nexus/ui';
import { findAllowedTypeByExtension } from '@nexus/shared';
import { useQuery } from '@tanstack/react-query';
import { Download } from 'lucide-react';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { KeyValue, Markdown, StatusBadge, useErrorMessage } from '@/components/common';
import { api, apiBlobUrl } from '@/lib/api';
import { formatBytes, formatDateTime } from '@/lib/format';
import { FileIcon } from './file-icon';
import type { CompanyFile } from './types';

export async function downloadFile(id: string): Promise<void> {
  const { url } = await api<{ url: string }>(`/files/${id}/download`);
  // Short-lived signed URL with Content-Disposition: attachment.
  const a = document.createElement('a');
  a.href = url;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
}

function parseCsv(text: string): string[][] {
  return text
    .split(/\r?\n/)
    .filter(Boolean)
    .slice(0, 200)
    .map((line) => line.split(',').map((c) => c.replace(/^"|"$/g, '')));
}

export function PreviewBody({ file }: { file: CompanyFile }) {
  const { t } = useTranslation();
  const msg = useErrorMessage();
  const previewable = findAllowedTypeByExtension(file.original_name)?.previewable ?? false;
  const { data, isLoading, error } = useQuery({ queryKey: ['file-preview', file.id], queryFn: () => apiBlobUrl(`/files/${file.id}/preview`), enabled: previewable, staleTime: 60_000 });

  useEffect(() => () => {
    if (data?.url) URL.revokeObjectURL(data.url);
  }, [data]);

  if (!previewable) return <p className="rounded-lg bg-muted p-6 text-center text-sm text-muted-foreground">{t('files.noPreview')}</p>;
  if (isLoading) return <div className="flex justify-center p-10"><Spinner className="size-6" /></div>;
  if (error || !data) return <p className="p-6 text-center text-sm text-destructive">{msg(error)}</p>;
  if (data.text !== undefined) {
    if (file.extension === 'md' || file.extension === 'markdown') return <div className="max-h-[60dvh] overflow-auto rounded-lg border p-4"><Markdown>{data.text}</Markdown></div>;
    if (file.extension === 'csv') {
      const rows = parseCsv(data.text);
      return (
        <div className="max-h-[60dvh] overflow-auto rounded-lg border">
          <table className="w-full text-xs">
            <tbody>
              {rows.map((r, i) => (
                <tr key={i} className={i === 0 ? 'bg-muted font-medium' : 'border-t'}>
                  {r.map((c, j) => <td key={j} className="px-2 py-1">{c}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    }
    return <pre className="max-h-[60dvh] overflow-auto whitespace-pre-wrap rounded-lg border bg-muted/40 p-4 font-mono text-xs" dir="auto">{data.text}</pre>;
  }
  if (data.type.startsWith('image/')) return <img src={data.url} alt={file.original_name} className="mx-auto max-h-[65dvh] rounded-lg object-contain" />;
  if (data.type === 'application/pdf') return <iframe src={data.url} title={file.original_name} className="h-[65dvh] w-full rounded-lg border" />;
  return null;
}

export function FilePreviewDialog({ file, onOpenChange }: { file: CompanyFile | null; onOpenChange: (o: boolean) => void }) {
  const { t } = useTranslation();
  const msg = useErrorMessage();
  return (
    <Dialog open={Boolean(file)} onOpenChange={onOpenChange}>
      <DialogContent size="xl" closeLabel={t('common.close')}>
        {file && (
          <>
            <DialogHeader>
              <div className="flex items-center gap-3">
                <FileIcon category={file.category} />
                <div className="min-w-0">
                  <DialogTitle className="truncate">{file.original_name}</DialogTitle>
                  <DialogDescription>{formatBytes(file.size)} · {formatDateTime(file.created_at)}</DialogDescription>
                </div>
              </div>
            </DialogHeader>
            <PreviewBody file={file} />
            <div className="grid gap-0 divide-y rounded-lg border px-4 text-sm sm:grid-cols-2 sm:divide-y-0">
              <KeyValue label={t('files.type')}>{file.extension.toUpperCase()}</KeyValue>
              <KeyValue label={t('files.uploadedBy')}>{file.uploader_name || (file.uploaded_by_ai_employee_id ? t('files.aiEmployee') : '—')}</KeyValue>
              <KeyValue label={t('files.scan')}><StatusBadge value={file.scan_status} /></KeyValue>
              <KeyValue label={t('files.visibility')}>{t(`files.visibilities.${file.space}`)}</KeyValue>
            </div>
            <div className="flex justify-end">
              <Button onClick={() => void downloadFile(file.id).catch((e: unknown) => toast.error(msg(e)))}><Download /> {t('files.download')}</Button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
