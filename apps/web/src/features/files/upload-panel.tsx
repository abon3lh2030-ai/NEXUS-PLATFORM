import { Button, Progress, cn } from '@nexus/ui';
import { CheckCircle2, RotateCcw, X, XCircle } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useErrorMessage } from '@/components/common';
import { ApiError } from '@/lib/api';
import { formatBytes } from '@/lib/format';
import type { UploadItem } from '@/lib/upload';
import { FileIcon } from './file-icon';

export function UploadPanel({ items, onCancel, onRetry, onClear }: { items: UploadItem[]; onCancel: (id: string) => void; onRetry: (id: string) => void; onClear: () => void }) {
  const { t } = useTranslation();
  const msg = useErrorMessage();
  if (items.length === 0) return null;
  const active = items.filter((i) => i.status === 'uploading' || i.status === 'processing').length;
  return (
    <div className="fixed bottom-4 right-4 z-40 w-[min(24rem,calc(100vw-2rem))] overflow-hidden rounded-2xl border bg-popover shadow-2xl" role="status" aria-live="polite">
      <div className="flex items-center justify-between border-b px-4 py-3">
        <p className="text-sm font-semibold">{active > 0 ? t('files.uploadingCount', { count: active }) : t('files.uploadsDone')}</p>
        {active === 0 && <Button variant="ghost" size="icon-sm" onClick={onClear} aria-label={t('common.close')}><X /></Button>}
      </div>
      <ul className="max-h-72 overflow-y-auto">
        {items.map((it) => (
          <li key={it.id} className="flex items-center gap-3 border-b px-4 py-3 last:border-0">
            <FileIcon category="text" className="size-8" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{it.file.name}</p>
              <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
                <span>{formatBytes(it.file.size)}</span>
                <span>·</span>
                <span className={cn(it.status === 'failed' && 'text-destructive', it.status === 'ready' && 'text-success')}>
                  {it.status === 'failed' && it.error ? msg(new ApiError(0, it.error)) : t(`files.uploadStatus.${it.status}`)}
                </span>
              </div>
              {(it.status === 'uploading' || it.status === 'processing') && <Progress value={it.status === 'processing' ? 100 : it.progress} className="mt-2" />}
            </div>
            {it.status === 'uploading' && <Button variant="ghost" size="icon-sm" onClick={() => onCancel(it.id)} aria-label={t('common.cancel')}><X /></Button>}
            {(it.status === 'failed' || it.status === 'cancelled') && <Button variant="ghost" size="icon-sm" onClick={() => onRetry(it.id)} aria-label={t('common.retry')}><RotateCcw /></Button>}
            {it.status === 'ready' && <CheckCircle2 className="size-4 text-success" />}
            {it.status === 'failed' && <XCircle className="size-4 text-destructive" />}
          </li>
        ))}
      </ul>
    </div>
  );
}
