import {
  Badge,
  Button,
  ConfirmDialog,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  EmptyState,
  Field,
  Input,
  NativeSelect,
  PageHeader,
  Progress,
  Tabs,
  TabsList,
  TabsTrigger,
  cn,
} from '@nexus/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ChevronLeft,
  ChevronRight,
  Clock,
  Download,
  Eye,
  Folder as FolderIcon,
  FolderOpen,
  FolderPlus,
  Grid3x3,
  HardDrive,
  List,
  Lock,
  MoreHorizontal,
  MoveRight,
  Pencil,
  RotateCcw,
  Search,
  Share2,
  Trash2,
  Upload,
  Users,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router';
import { toast } from 'sonner';
import { LoadingBlock, useAction, useErrorMessage } from '@/components/common';
import { api, apiBlobUrl, apiDelete, apiPatch, apiPost } from '@/lib/api';
import { formatBytes, formatDate, formatRelative } from '@/lib/format';
import { useUploader } from '@/lib/upload';
import { useSession } from '@/providers/session';
import { FileIcon } from './file-icon';
import { downloadFile, FilePreviewDialog } from './preview';
import type { CompanyFile, FilesTab, Folder } from './types';
import { UploadPanel } from './upload-panel';

function ImageThumb({ file }: { file: CompanyFile }) {
  const { data } = useQuery({ queryKey: ['file-preview', file.id], queryFn: () => apiBlobUrl(`/files/${file.id}/preview`), enabled: file.category === 'image' && file.size < 8 * 1024 * 1024, staleTime: 5 * 60_000 });
  if (data?.url) return <img src={data.url} alt="" className="size-full object-cover" loading="lazy" />;
  return <FileIcon category={file.category} className="size-12" />;
}

function StorageBar() {
  const { t } = useTranslation();
  const { data } = useQuery({ queryKey: ['files-usage'], queryFn: () => api<{ used_bytes: number; file_count: number; limit_bytes: number | null }>('/files/usage') });
  if (!data) return null;
  const pct = data.limit_bytes ? (data.used_bytes / data.limit_bytes) * 100 : 0;
  return (
    <div className="flex min-w-60 items-center gap-3 rounded-xl border bg-card px-4 py-2.5">
      <HardDrive className="size-4 text-muted-foreground" />
      <div className="flex-1">
        <div className="flex justify-between gap-3 text-xs">
          <span>{t('files.storageUsed', { used: formatBytes(data.used_bytes), total: data.limit_bytes === null ? t('pricing.unlimited') : formatBytes(data.limit_bytes) })}</span>
          <span className="text-muted-foreground">{t('files.fileCount', { count: data.file_count })}</span>
        </div>
        {data.limit_bytes !== null && <Progress value={pct} className="mt-1.5" indicatorClassName={pct > 90 ? 'bg-destructive' : undefined} />}
      </div>
    </div>
  );
}

export function FilesPage() {
  const { t, i18n } = useTranslation();
  const { can } = useSession();
  const qc = useQueryClient();
  const msg = useErrorMessage();
  const [params, setParams] = useSearchParams();
  const canPrivate = can('files.private.use');
  const tab = (['shared', 'private', 'recent', 'trash'].includes(params.get('tab') ?? '') ? params.get('tab') : 'shared') as FilesTab;
  const folderId = params.get('folder');
  const [view, setView] = useState<'grid' | 'list'>(() => (localStorage.getItem('nexus.files.view') === 'list' ? 'list' : 'grid'));
  const [q, setQ] = useState('');
  const [debouncedQ, setDebouncedQ] = useState('');
  const [category, setCategory] = useState('');
  const [sort, setSort] = useState('created_at:desc');
  const [preview, setPreview] = useState<CompanyFile | null>(null);
  const [rename, setRename] = useState<CompanyFile | Folder | null>(null);
  const [moveTarget, setMoveTarget] = useState<CompanyFile | null>(null);
  const [confirm, setConfirm] = useState<{ kind: 'delete' | 'purge' | 'folder'; id: string; name: string } | null>(null);
  const [newFolder, setNewFolder] = useState(false);
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const space: 'shared' | 'private' = tab === 'private' ? 'private' : 'shared';
  const canUpload = tab === 'private' ? canPrivate : can('files.shared.upload');

  useEffect(() => {
    const id = setTimeout(() => setDebouncedQ(q.trim()), 250);
    return () => clearTimeout(id);
  }, [q]);

  const setTab = (next: string) => setParams({ tab: next });
  const openFolder = (id: string | null) => setParams(id ? { tab, folder: id } : { tab });
  const [sortCol, order] = sort.split(':') as [string, string];

  const files = useQuery({
    queryKey: ['files', tab, folderId, debouncedQ, category, sort],
    queryFn: () => api<{ files: CompanyFile[] }>('/files', { query: { space: tab, folder_id: tab === 'shared' || tab === 'private' ? folderId : undefined, q: debouncedQ, category, sort: sortCol, order } }),
  });
  const folders = useQuery({
    queryKey: ['folders', space, folderId],
    queryFn: () => api<{ folders: Folder[]; breadcrumbs: Array<{ id: string; name: string }> }>('/files/folders', { query: { space, parent_id: folderId } }),
    enabled: (tab === 'shared' || tab === 'private') && !debouncedQ,
  });
  const recentViewed = useQuery({ queryKey: ['files-recent-viewed'], queryFn: () => api<CompanyFile[]>('/files/recently-viewed'), enabled: tab === 'recent' });

  const refresh = useCallback(() => {
    void qc.invalidateQueries({ queryKey: ['files'] });
    void qc.invalidateQueries({ queryKey: ['folders'] });
    void qc.invalidateQueries({ queryKey: ['files-usage'] });
    void qc.invalidateQueries({ queryKey: ['files-recent-viewed'] });
  }, [qc]);

  const uploader = useUploader({ space, folderId: tab === 'shared' || tab === 'private' ? folderId : null, onDone: refresh });

  // Deep links: ?upload=1 opens the picker, ?file=<id> opens a preview.
  useEffect(() => {
    if (params.get('upload') === '1' && canUpload) {
      inputRef.current?.click();
      params.delete('upload');
      setParams(params, { replace: true });
    }
    const fileId = params.get('file');
    if (fileId) {
      void api<CompanyFile>(`/files/${fileId}`).then(setPreview).catch(() => undefined);
      params.delete('file');
      setParams(params, { replace: true });
    }
  }, [params, setParams, canUpload]);

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    if (!canUpload || tab === 'trash' || tab === 'recent') return;
    if (e.dataTransfer.files.length) uploader.add(e.dataTransfer.files);
  };

  const del = useAction((id: string) => apiDelete(`/files/${id}`), { success: t('files.movedToTrash'), onSuccess: refresh });
  const restore = useAction((id: string) => apiPost(`/files/${id}/restore`), { success: t('files.restored'), onSuccess: refresh });
  const purge = useAction((id: string) => apiDelete(`/files/${id}/permanent`), { success: t('files.purged'), onSuccess: refresh });
  const delFolder = useAction((id: string) => apiDelete(`/files/folders/${id}`), { success: t('files.folderDeleted'), onSuccess: refresh });
  const shareCopy = useAction((id: string) => apiPost(`/files/${id}/share-copy`, { folder_id: null }), { success: t('files.sharedCopyCreated'), onSuccess: refresh });

  const list = tab === 'recent' ? files.data?.files : files.data?.files;
  const images = useMemo(() => (list ?? []).filter((f) => f.category === 'image'), [list]);
  const Chevron = i18n.language === 'ar' ? ChevronLeft : ChevronRight;

  const fileMenu = (f: CompanyFile) => (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label={t('common.actions')} onClick={(e) => e.stopPropagation()}><MoreHorizontal /></Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent onClick={(e) => e.stopPropagation()}>
        {tab === 'trash' ? (
          <>
            <DropdownMenuItem onSelect={() => restore.mutate(f.id)}><RotateCcw /> {t('files.restore')}</DropdownMenuItem>
            <DropdownMenuItem destructive onSelect={() => setConfirm({ kind: 'purge', id: f.id, name: f.original_name })}><Trash2 /> {t('files.deleteForever')}</DropdownMenuItem>
          </>
        ) : (
          <>
            <DropdownMenuItem onSelect={() => setPreview(f)}><Eye /> {t('files.preview')}</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => void downloadFile(f.id).catch((e: unknown) => toast.error(msg(e)))}><Download /> {t('files.download')}</DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => setRename(f)}><Pencil /> {t('files.rename')}</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => setMoveTarget(f)}><MoveRight /> {t('files.move')}</DropdownMenuItem>
            {f.space === 'private' && can('files.shared.upload') && <DropdownMenuItem onSelect={() => shareCopy.mutate(f.id)}><Share2 /> {t('files.shareCopy')}</DropdownMenuItem>}
            <DropdownMenuSeparator />
            <DropdownMenuItem destructive onSelect={() => setConfirm({ kind: 'delete', id: f.id, name: f.original_name })}><Trash2 /> {t('common.delete')}</DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );

  return (
    <div onDragOver={(e) => { e.preventDefault(); if (canUpload && (tab === 'shared' || tab === 'private')) setDragging(true); }} onDragLeave={(e) => { if (e.currentTarget === e.target) setDragging(false); }} onDrop={onDrop} className="relative">
      <PageHeader title={t('files.title')} description={t('files.description')} icon={<FolderOpen />} actions={<StorageBar />} />

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="w-full justify-start sm:w-auto">
          <TabsTrigger value="shared"><Users /> {t('files.shared')}</TabsTrigger>
          {canPrivate && <TabsTrigger value="private"><Lock /> {t('files.private')}</TabsTrigger>}
          <TabsTrigger value="recent"><Clock /> {t('files.recent')}</TabsTrigger>
          <TabsTrigger value="trash"><Trash2 /> {t('files.trash')}</TabsTrigger>
        </TabsList>
      </Tabs>

      {tab === 'private' && (
        <div className="mt-4 flex items-start gap-2 rounded-xl border border-primary/20 bg-primary/5 px-4 py-3 text-sm">
          <Lock className="mt-0.5 size-4 shrink-0 text-primary" />
          <p>{t('files.privateNotice')}</p>
        </div>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-2">
        {canUpload && (tab === 'shared' || tab === 'private') && (
          <>
            <Button onClick={() => inputRef.current?.click()}><Upload /> {t('files.upload')}</Button>
            <Button variant="outline" onClick={() => setNewFolder(true)}><FolderPlus /> {t('files.newFolder')}</Button>
          </>
        )}
        <input ref={inputRef} type="file" multiple hidden onChange={(e) => { if (e.target.files?.length) uploader.add(e.target.files); e.target.value = ''; }} />
        <div className="relative min-w-48 flex-1 sm:max-w-xs">
          <Search className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('files.search')} className="ps-9" />
        </div>
        <NativeSelect value={category} onChange={(e) => setCategory(e.target.value)} className="w-auto" aria-label={t('common.filter')}>
          <option value="">{t('files.allTypes')}</option>
          {['image', 'pdf', 'document', 'spreadsheet', 'presentation', 'text', 'archive'].map((c) => <option key={c} value={c}>{t(`files.categories.${c}`)}</option>)}
        </NativeSelect>
        <NativeSelect value={sort} onChange={(e) => setSort(e.target.value)} className="w-auto" aria-label={t('common.sort')}>
          <option value="created_at:desc">{t('files.sort.newest')}</option>
          <option value="created_at:asc">{t('files.sort.oldest')}</option>
          <option value="name:asc">{t('files.sort.name')}</option>
          <option value="size:desc">{t('files.sort.size')}</option>
          <option value="updated_at:desc">{t('files.sort.modified')}</option>
        </NativeSelect>
        <div className="ms-auto flex rounded-lg border p-0.5">
          {(['grid', 'list'] as const).map((v) => (
            <Button key={v} variant={view === v ? 'secondary' : 'ghost'} size="icon-sm" onClick={() => { setView(v); localStorage.setItem('nexus.files.view', v); }} aria-label={t(`files.view.${v}`)}>
              {v === 'grid' ? <Grid3x3 /> : <List />}
            </Button>
          ))}
        </div>
      </div>

      {(tab === 'shared' || tab === 'private') && !debouncedQ && (
        <nav className="mt-4 flex flex-wrap items-center gap-1 text-sm" aria-label="breadcrumb">
          <button className="rounded px-1.5 py-0.5 text-muted-foreground hover:bg-muted hover:text-foreground" onClick={() => openFolder(null)}>{t('files.title')}</button>
          <Chevron className="size-3.5 text-muted-foreground" />
          <button className={cn('rounded px-1.5 py-0.5 hover:bg-muted', !folderId ? 'font-medium' : 'text-muted-foreground')} onClick={() => openFolder(null)}>{t(tab === 'private' ? 'files.private' : 'files.shared')}</button>
          {folders.data?.breadcrumbs.map((b, i, arr) => (
            <span key={b.id} className="flex items-center gap-1">
              <Chevron className="size-3.5 text-muted-foreground" />
              <button className={cn('rounded px-1.5 py-0.5 hover:bg-muted', i === arr.length - 1 ? 'font-medium' : 'text-muted-foreground')} onClick={() => openFolder(b.id)}>{b.name}</button>
            </span>
          ))}
        </nav>
      )}

      {dragging && (
        <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center rounded-2xl border-2 border-dashed border-primary bg-primary/5 backdrop-blur-[1px]">
          <div className="flex flex-col items-center gap-2 text-primary"><Upload className="size-8" /><p className="font-medium">{t('files.dropHere')}</p></div>
        </div>
      )}

      <div className="mt-4 grid gap-4">
        {(tab === 'shared' || tab === 'private') && !debouncedQ && (folders.data?.folders.length ?? 0) > 0 && (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            {folders.data!.folders.map((f) => (
              <div key={f.id} onDoubleClick={() => openFolder(f.id)} className="group flex items-center gap-3 rounded-xl border bg-card p-3 transition-shadow hover:shadow-md">
                <button className="flex min-w-0 flex-1 items-center gap-3 text-start" onClick={() => openFolder(f.id)}>
                  <FolderIcon className="size-8 shrink-0 fill-primary/15 text-primary" />
                  <span className="truncate text-sm font-medium">{f.name}</span>
                </button>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild><Button variant="ghost" size="icon-sm" className="opacity-60 group-hover:opacity-100" aria-label={t('common.actions')}><MoreHorizontal /></Button></DropdownMenuTrigger>
                  <DropdownMenuContent>
                    <DropdownMenuItem onSelect={() => setRename(f)}><Pencil /> {t('files.rename')}</DropdownMenuItem>
                    <DropdownMenuItem destructive onSelect={() => setConfirm({ kind: 'folder', id: f.id, name: f.name })}><Trash2 /> {t('common.delete')}</DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            ))}
          </div>
        )}

        {tab === 'recent' && (recentViewed.data?.length ?? 0) > 0 && (
          <div>
            <p className="mb-2 text-sm font-medium text-muted-foreground">{t('files.recentlyViewed')}</p>
            <div className="flex gap-3 overflow-x-auto pb-2">
              {recentViewed.data!.map((f) => (
                <button key={f.id} onClick={() => setPreview(f)} className="flex w-52 shrink-0 items-center gap-3 rounded-xl border bg-card p-3 text-start hover:shadow-md">
                  <FileIcon category={f.category} />
                  <span className="min-w-0"><span className="block truncate text-sm font-medium">{f.original_name}</span><span className="text-xs text-muted-foreground">{formatBytes(f.size)}</span></span>
                </button>
              ))}
            </div>
            <p className="mb-2 mt-4 text-sm font-medium text-muted-foreground">{t('files.recentlyChanged')}</p>
          </div>
        )}

        {files.isLoading ? (
          <LoadingBlock />
        ) : !list?.length ? (
          <EmptyState
            icon={tab === 'trash' ? <Trash2 /> : <FolderOpen />}
            title={t(tab === 'trash' ? 'files.trashEmpty' : 'files.empty')}
            description={tab === 'trash' ? t('files.trashHint') : canUpload && tab !== 'recent' ? t('files.emptyHint') : undefined}
            action={canUpload && (tab === 'shared' || tab === 'private') ? <Button onClick={() => inputRef.current?.click()}><Upload /> {t('files.upload')}</Button> : undefined}
          />
        ) : view === 'grid' ? (
          <>
            {images.length > 0 && tab !== 'trash' && <p className="text-xs text-muted-foreground">{t('files.galleryHint', { count: images.length })}</p>}
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
              {list.map((f) => (
                <div key={f.id} className="group relative overflow-hidden rounded-xl border bg-card transition-shadow hover:shadow-md">
                  <button className="flex aspect-[4/3] w-full items-center justify-center overflow-hidden bg-muted/40" onClick={() => tab !== 'trash' && setPreview(f)} aria-label={f.original_name}>
                    <ImageThumb file={f} />
                  </button>
                  <div className="flex items-center gap-2 p-3">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium" title={f.original_name}>{f.original_name}</p>
                      <p className="text-xs text-muted-foreground">{formatBytes(f.size)} · {formatRelative(tab === 'trash' ? f.deleted_at : f.created_at)}</p>
                    </div>
                    {fileMenu(f)}
                  </div>
                  {f.space === 'private' && <Badge tone="primary" className="absolute start-2 top-2"><Lock /> {t('files.privateBadge')}</Badge>}
                </div>
              ))}
            </div>
          </>
        ) : (
          <div className="overflow-hidden rounded-xl border bg-card">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-xs text-muted-foreground">
                <tr>
                  <th className="px-4 py-2.5 text-start font-medium">{t('files.name')}</th>
                  <th className="hidden px-4 py-2.5 text-start font-medium md:table-cell">{t('files.uploadedBy')}</th>
                  <th className="hidden px-4 py-2.5 text-start font-medium sm:table-cell">{t('files.size')}</th>
                  <th className="hidden px-4 py-2.5 text-start font-medium md:table-cell">{tab === 'trash' ? t('files.deletedAt') : t('files.date')}</th>
                  <th className="w-12" />
                </tr>
              </thead>
              <tbody>
                {list.map((f) => (
                  <tr key={f.id} className="cursor-pointer border-t hover:bg-muted/40" onClick={() => tab !== 'trash' && setPreview(f)}>
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-3">
                        <FileIcon category={f.category} className="size-8" />
                        <span className="truncate font-medium">{f.original_name}</span>
                        {f.space === 'private' && <Lock className="size-3.5 text-primary" />}
                      </div>
                    </td>
                    <td className="hidden px-4 py-2.5 text-muted-foreground md:table-cell">{f.uploader_name || (f.uploaded_by_ai_employee_id ? t('files.aiEmployee') : '—')}</td>
                    <td className="hidden px-4 py-2.5 tabular-nums text-muted-foreground sm:table-cell">{formatBytes(f.size)}</td>
                    <td className="hidden px-4 py-2.5 text-muted-foreground md:table-cell">{formatDate(tab === 'trash' ? f.deleted_at : f.created_at)}</td>
                    <td className="px-2" onClick={(e) => e.stopPropagation()}>{fileMenu(f)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <FilePreviewDialog file={preview} onOpenChange={(o) => !o && setPreview(null)} />
      <NewFolderDialog open={newFolder} onOpenChange={setNewFolder} space={space} parentId={folderId} onCreated={refresh} />
      <RenameDialog target={rename} onClose={() => setRename(null)} onDone={refresh} />
      <MoveDialog file={moveTarget} onClose={() => setMoveTarget(null)} onDone={refresh} />
      <ConfirmDialog
        open={Boolean(confirm)}
        onOpenChange={(o) => !o && setConfirm(null)}
        title={confirm?.kind === 'purge' ? t('files.confirmPurgeTitle') : t('files.confirmDeleteTitle')}
        description={confirm ? (confirm.kind === 'purge' ? t('files.confirmPurgeBody', { name: confirm.name }) : t('files.confirmDeleteBody', { name: confirm.name })) : undefined}
        confirmLabel={confirm?.kind === 'purge' ? t('files.deleteForever') : t('common.delete')}
        cancelLabel={t('common.cancel')}
        destructive
        onConfirm={() => {
          if (!confirm) return;
          if (confirm.kind === 'delete') del.mutate(confirm.id);
          if (confirm.kind === 'purge') purge.mutate(confirm.id);
          if (confirm.kind === 'folder') delFolder.mutate(confirm.id);
          setConfirm(null);
        }}
      />
      <UploadPanel items={uploader.items} onCancel={uploader.cancel} onRetry={uploader.retry} onClear={uploader.clearFinished} />
    </div>
  );
}

function NewFolderDialog({ open, onOpenChange, space, parentId, onCreated }: { open: boolean; onOpenChange: (o: boolean) => void; space: 'shared' | 'private'; parentId: string | null; onCreated: () => void }) {
  const { t } = useTranslation();
  const [name, setName] = useState('');
  const create = useAction(() => apiPost('/files/folders', { space, name, parent_id: parentId }), {
    success: t('files.folderCreated'),
    onSuccess: () => {
      setName('');
      onOpenChange(false);
      onCreated();
    },
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="sm" closeLabel={t('common.close')}>
        <DialogHeader><DialogTitle>{t('files.newFolder')}</DialogTitle></DialogHeader>
        <form onSubmit={(e) => { e.preventDefault(); if (name.trim()) create.mutate(undefined); }} className="grid gap-4">
          <Field label={t('files.folderName')}><Input autoFocus value={name} onChange={(e) => setName(e.target.value)} maxLength={120} /></Field>
          <DialogFooter><Button type="submit" loading={create.isPending} disabled={!name.trim()}>{t('common.create')}</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function RenameDialog({ target, onClose, onDone }: { target: CompanyFile | Folder | null; onClose: () => void; onDone: () => void }) {
  const { t } = useTranslation();
  const [name, setName] = useState('');
  const isFile = target && 'original_name' in target;
  useEffect(() => setName(target ? ('original_name' in target ? target.original_name : target.name) : ''), [target]);
  const save = useAction(() => apiPatch(isFile ? `/files/${target!.id}` : `/files/folders/${target!.id}`, { name }), { success: t('files.renamed'), onSuccess: () => { onClose(); onDone(); } });
  return (
    <Dialog open={Boolean(target)} onOpenChange={(o) => !o && onClose()}>
      <DialogContent size="sm" closeLabel={t('common.close')}>
        <DialogHeader><DialogTitle>{t('files.rename')}</DialogTitle></DialogHeader>
        <form onSubmit={(e) => { e.preventDefault(); if (name.trim()) save.mutate(undefined); }} className="grid gap-4">
          <Input autoFocus value={name} onChange={(e) => setName(e.target.value)} maxLength={255} />
          <DialogFooter><Button type="submit" loading={save.isPending}>{t('common.save')}</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function MoveDialog({ file, onClose, onDone }: { file: CompanyFile | null; onClose: () => void; onDone: () => void }) {
  const { t } = useTranslation();
  const [parent, setParent] = useState<string | null>(null);
  const space = file?.space === 'private' ? 'private' : 'shared';
  useEffect(() => setParent(null), [file]);
  const { data } = useQuery({ queryKey: ['folders', space, parent], queryFn: () => api<{ folders: Folder[]; breadcrumbs: Array<{ id: string; name: string }> }>('/files/folders', { query: { space, parent_id: parent } }), enabled: Boolean(file) });
  const move = useAction((folderId: string | null) => apiPost(`/files/${file!.id}/move`, { folder_id: folderId }), { success: t('files.moved'), onSuccess: () => { onClose(); onDone(); } });
  return (
    <Dialog open={Boolean(file)} onOpenChange={(o) => !o && onClose()}>
      <DialogContent size="sm" closeLabel={t('common.close')}>
        <DialogHeader><DialogTitle>{t('files.moveTo')}</DialogTitle></DialogHeader>
        <div className="flex flex-wrap items-center gap-1 text-sm">
          <button className="text-primary" onClick={() => setParent(null)}>{t(space === 'private' ? 'files.private' : 'files.shared')}</button>
          {data?.breadcrumbs.map((b) => <span key={b.id}> / <button className="text-primary" onClick={() => setParent(b.id)}>{b.name}</button></span>)}
        </div>
        <div className="grid max-h-64 gap-1 overflow-y-auto rounded-lg border p-1">
          {data?.folders.length === 0 && <p className="p-4 text-center text-sm text-muted-foreground">{t('files.noSubfolders')}</p>}
          {data?.folders.map((f) => (
            <button key={f.id} className="flex items-center gap-2 rounded-md px-3 py-2 text-start text-sm hover:bg-muted" onClick={() => setParent(f.id)}>
              <FolderIcon className="size-4 text-primary" /> {f.name}
            </button>
          ))}
        </div>
        <DialogFooter><Button loading={move.isPending} onClick={() => move.mutate(parent)}>{t('files.moveHere')}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
