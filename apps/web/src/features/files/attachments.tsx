import { Button, Checkbox, Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, Input, Section } from '@nexus/ui';
import { useQuery } from '@tanstack/react-query';
import { Paperclip, Unlink } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAction } from '@/components/common';
import { api, apiDelete, apiPost } from '@/lib/api';
import { formatBytes } from '@/lib/format';
import { useSession } from '@/providers/session';
import { FileIcon } from './file-icon';
import { FilePreviewDialog } from './preview';
import type { CompanyFile } from './types';

type EntityType = 'task' | 'project' | 'mission' | 'department' | 'meeting' | 'ai_output';

/** "Attach from Company Files" — pick existing SHARED files instead of re-uploading. */
export function FilePickerDialog({ open, onOpenChange, onPick, title }: { open: boolean; onOpenChange: (o: boolean) => void; onPick: (ids: string[]) => void; title?: string }) {
  const { t } = useTranslation();
  const [q, setQ] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const { data } = useQuery({ queryKey: ['files-picker', q], queryFn: () => api<{ files: CompanyFile[] }>('/files', { query: { space: 'shared', q: q || undefined, flat: '1' } }), enabled: open });
  const toggle = (id: string) => setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  return (
    <Dialog open={open} onOpenChange={(o) => { onOpenChange(o); if (!o) setSelected([]); }}>
      <DialogContent size="lg" closeLabel={t('common.close')}>
        <DialogHeader>
          <DialogTitle>{title ?? t('files.attachFromCompany')}</DialogTitle>
          <DialogDescription>{t('files.attachHint')}</DialogDescription>
        </DialogHeader>
        <Input placeholder={t('files.search')} value={q} onChange={(e) => setQ(e.target.value)} />
        <div className="grid max-h-80 gap-1 overflow-y-auto rounded-lg border p-1">
          {data?.files.length === 0 && <p className="p-6 text-center text-sm text-muted-foreground">{t('files.empty')}</p>}
          {data?.files.map((f) => (
            <label key={f.id} className="flex cursor-pointer items-center gap-3 rounded-md px-3 py-2 hover:bg-muted">
              <Checkbox checked={selected.includes(f.id)} onCheckedChange={() => toggle(f.id)} />
              <FileIcon category={f.category} className="size-8" />
              <span className="min-w-0 flex-1 truncate text-sm">{f.original_name}</span>
              <span className="text-xs text-muted-foreground">{formatBytes(f.size)}</span>
            </label>
          ))}
        </div>
        <DialogFooter>
          <Button disabled={!selected.length} onClick={() => { onPick(selected); setSelected([]); onOpenChange(false); }}>
            {t('files.attachSelected', { count: selected.length })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function LinkedFiles({ entityType, entityId }: { entityType: EntityType; entityId: string }) {
  const { t } = useTranslation();
  const { can } = useSession();
  const [picker, setPicker] = useState(false);
  const [preview, setPreview] = useState<CompanyFile | null>(null);
  const key = ['linked-files', entityType, entityId];
  const { data = [] } = useQuery({ queryKey: key, queryFn: () => api<CompanyFile[]>(`/files/linked/${entityType}/${entityId}`) });
  const link = useAction(async (ids: string[]) => {
    for (const id of ids) await apiPost(`/files/${id}/links`, { entity_type: entityType, entity_id: entityId });
  }, { success: t('files.attached'), invalidate: [key] });
  const unlink = useAction((id: string) => apiDelete(`/files/${id}/links`, { entity_type: entityType, entity_id: entityId }), { invalidate: [key] });

  return (
    <Section
      title={<span className="flex items-center gap-2"><Paperclip className="size-4" /> {t('files.attachments')}</span>}
      actions={can('files.shared.view') && can('work.create') ? <Button size="sm" variant="outline" onClick={() => setPicker(true)}>{t('files.attach')}</Button> : undefined}
    >
      {data.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('files.noAttachments')}</p>
      ) : (
        <ul className="grid gap-1">
          {data.map((f) => (
            <li key={f.id} className="flex items-center gap-3 rounded-lg px-2 py-1.5 hover:bg-muted/50">
              <FileIcon category={f.category} className="size-8" />
              <button className="min-w-0 flex-1 truncate text-start text-sm font-medium hover:underline" onClick={() => setPreview(f)}>{f.original_name}</button>
              <span className="text-xs text-muted-foreground">{formatBytes(f.size)}</span>
              {can('work.create') && <Button variant="ghost" size="icon-sm" onClick={() => unlink.mutate(f.id)} aria-label={t('files.detach')}><Unlink /></Button>}
            </li>
          ))}
        </ul>
      )}
      <FilePickerDialog open={picker} onOpenChange={setPicker} onPick={(ids) => link.mutate(ids)} />
      <FilePreviewDialog file={preview} onOpenChange={(o) => !o && setPreview(null)} />
    </Section>
  );
}
