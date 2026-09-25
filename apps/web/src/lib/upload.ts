import { findAllowedTypeByExtension } from '@nexus/shared';
import { useCallback, useRef, useState } from 'react';
import { api, ApiError } from './api';
import { env } from './env';

export type UploadStatus = 'queued' | 'uploading' | 'processing' | 'ready' | 'failed' | 'cancelled';

export interface UploadItem {
  id: string;
  file: File;
  status: UploadStatus;
  progress: number;
  error?: string;
  fileId?: string;
}

interface InitResponse {
  file_id: string;
  upload_url: string;
  token: string;
  max_size: number;
}

/**
 * Two-step secure upload:
 *   1. API authorizes and returns a short-lived signed upload URL (server-generated storage key).
 *   2. Browser PUTs the bytes with progress (XHR); 3. API verifies real content & size.
 */
export function useUploader(opts: { space: 'shared' | 'private'; folderId: string | null; onDone?: () => void }) {
  const [items, setItems] = useState<UploadItem[]>([]);
  const xhrs = useRef(new Map<string, XMLHttpRequest>());

  const patch = useCallback((id: string, p: Partial<UploadItem>) => setItems((prev) => prev.map((it) => (it.id === id ? { ...it, ...p } : it))), []);

  const run = useCallback(
    async (item: UploadItem) => {
      patch(item.id, { status: 'uploading', progress: 0, error: undefined });
      if (!findAllowedTypeByExtension(item.file.name)) {
        patch(item.id, { status: 'failed', error: 'unsupported_file_type' });
        return;
      }
      try {
        const init = await api<InitResponse>('/files/uploads', {
          method: 'POST',
          body: { space: opts.space, folder_id: opts.folderId, file_name: item.file.name, size: item.file.size, declared_mime: item.file.type || undefined },
        });
        patch(item.id, { fileId: init.file_id });
        await new Promise<void>((resolve, reject) => {
          const xhr = new XMLHttpRequest();
          xhrs.current.set(item.id, xhr);
          xhr.open('PUT', init.upload_url);
          xhr.setRequestHeader('x-upsert', 'false');
          xhr.setRequestHeader('apikey', env.supabaseAnonKey); // public anon key required by the Supabase gateway
          if (item.file.type) xhr.setRequestHeader('Content-Type', item.file.type);
          xhr.upload.onprogress = (e) => {
            if (e.lengthComputable) patch(item.id, { progress: Math.round((e.loaded / e.total) * 100) });
          };
          xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new ApiError(xhr.status, 'upload_failed')));
          xhr.onerror = () => reject(new ApiError(0, 'network_error'));
          xhr.onabort = () => reject(new ApiError(0, 'cancelled'));
          xhr.send(item.file);
        });
        xhrs.current.delete(item.id);
        patch(item.id, { status: 'processing', progress: 100 });
        await api(`/files/uploads/${init.file_id}/complete`, { method: 'POST', body: {} });
        patch(item.id, { status: 'ready' });
        opts.onDone?.();
      } catch (err) {
        xhrs.current.delete(item.id);
        const code = err instanceof ApiError ? err.code : 'upload_failed';
        patch(item.id, { status: code === 'cancelled' ? 'cancelled' : 'failed', error: code });
      }
    },
    [opts, patch],
  );

  const add = useCallback(
    (files: FileList | File[]) => {
      const created = Array.from(files).map((file) => ({ id: crypto.randomUUID(), file, status: 'queued' as const, progress: 0 }));
      setItems((prev) => [...created, ...prev]);
      // Sequential-ish: start all; browsers cap parallel connections anyway.
      created.forEach((it) => void run(it));
    },
    [run],
  );

  const cancel = useCallback((id: string) => xhrs.current.get(id)?.abort(), []);
  const retry = useCallback((id: string) => setItems((prev) => {
    const it = prev.find((p) => p.id === id);
    if (it) void run(it);
    return prev;
  }), [run]);
  const clearFinished = useCallback(() => setItems((prev) => prev.filter((p) => p.status === 'uploading' || p.status === 'processing')), []);

  return { items, add, cancel, retry, clearFinished };
}
