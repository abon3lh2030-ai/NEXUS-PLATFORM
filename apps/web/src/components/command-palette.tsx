import { Dialog, DialogContent, DialogTitle } from '@nexus/ui';
import { useQuery } from '@tanstack/react-query';
import { Command } from 'cmdk';
import { Bell, Bot, FileText, FolderOpen, ListChecks, Plus, Search, Sparkles, Upload } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';
import { NAV } from '@/layouts/nav';
import { api } from '@/lib/api';
import { useSession } from '@/providers/session';

interface SearchResults {
  tasks: Array<{ id: string; title: string }>;
  projects: Array<{ id: string; title: string }>;
  missions: Array<{ id: string; title: string }>;
  ai_employees: Array<{ id: string; name: string; job_title: string }>;
  documents: Array<{ id: string; title: string }>;
  shared_files: Array<{ id: string; original_name: string }>;
  private_files: Array<{ id: string; original_name: string }>;
  departments: Array<{ id: string; name: string }>;
}

export function CommandPalette({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { can } = useSession();
  const [q, setQ] = useState('');
  const [debounced, setDebounced] = useState('');

  useEffect(() => {
    const id = setTimeout(() => setDebounced(q.trim()), 250);
    return () => clearTimeout(id);
  }, [q]);

  const { data } = useQuery({ queryKey: ['search', debounced], queryFn: () => api<SearchResults>('/search', { query: { q: debounced } }), enabled: open && debounced.length >= 2 });

  const go = (to: string) => {
    onOpenChange(false);
    setQ('');
    navigate(to);
  };

  const item = 'flex cursor-pointer items-center gap-2 rounded-lg px-3 py-2 text-sm aria-selected:bg-muted [&_svg]:size-4 [&_svg]:text-muted-foreground';
  const group = 'px-1 py-1 [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:text-muted-foreground';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="lg" className="overflow-hidden p-0" closeLabel={t('common.close')}>
        <DialogTitle className="sr-only">{t('command.title')}</DialogTitle>
        <Command shouldFilter={false} className="flex max-h-[70dvh] flex-col">
          <div className="flex items-center gap-2 border-b px-4">
            <Search className="size-4 text-muted-foreground" />
            <Command.Input value={q} onValueChange={setQ} placeholder={t('command.placeholder')} className="h-12 w-full bg-transparent text-sm outline-none" />
          </div>
          <Command.List className="overflow-y-auto p-2">
            <Command.Empty className="p-6 text-center text-sm text-muted-foreground">{t('command.empty')}</Command.Empty>
            {!debounced && (
              <>
                <Command.Group heading={t('command.actions')} className={group}>
                  {can('work.create') && <Command.Item className={item} onSelect={() => go('/app/tasks?new=1')}><Plus /> {t('command.newTask')}</Command.Item>}
                  {can('work.manage') && <Command.Item className={item} onSelect={() => go('/app/missions?new=1')}><Plus /> {t('command.newMission')}</Command.Item>}
                  {can('work.create') && <Command.Item className={item} onSelect={() => go('/app/projects?new=1')}><Plus /> {t('command.newProject')}</Command.Item>}
                  {can('files.shared.upload') && <Command.Item className={item} onSelect={() => go('/app/files?upload=1')}><Upload /> {t('command.uploadFile')}</Command.Item>}
                  <Command.Item className={item} onSelect={() => go('/app/files')}><FolderOpen /> {t('nav.companyFiles')}</Command.Item>
                  {can('nexus_ai.use') && <Command.Item className={item} onSelect={() => go('/app/nexus')}><Sparkles /> {t('command.askNexus')}</Command.Item>}
                  <Command.Item className={item} onSelect={() => go('/app/notifications')}><Bell /> {t('nav.notifications')}</Command.Item>
                </Command.Group>
                <Command.Group heading={t('command.navigate')} className={group}>
                  {NAV.flatMap((g) => g.items)
                    .filter((i) => !i.permission || can(i.permission))
                    .map((i) => (
                      <Command.Item key={i.to} className={item} onSelect={() => go(i.to)}>
                        <i.icon /> {t(`nav.${i.key}`)}
                      </Command.Item>
                    ))}
                </Command.Group>
              </>
            )}
            {data && (
              <>
                {data.ai_employees.length > 0 && (
                  <Command.Group heading={t('nav.workforce')} className={group}>
                    {data.ai_employees.map((e) => <Command.Item key={e.id} className={item} onSelect={() => go(`/app/workforce/${e.id}`)}><Bot /> {e.name} · <span className="text-muted-foreground">{e.job_title}</span></Command.Item>)}
                  </Command.Group>
                )}
                {data.tasks.length > 0 && (
                  <Command.Group heading={t('nav.tasks')} className={group}>
                    {data.tasks.map((e) => <Command.Item key={e.id} className={item} onSelect={() => go(`/app/tasks/${e.id}`)}><ListChecks /> {e.title}</Command.Item>)}
                  </Command.Group>
                )}
                {[...data.projects.map((p) => ({ ...p, to: `/app/projects/${p.id}` })), ...data.missions.map((m) => ({ ...m, to: `/app/missions/${m.id}` }))].length > 0 && (
                  <Command.Group heading={t('nav.work')} className={group}>
                    {data.projects.map((e) => <Command.Item key={e.id} className={item} onSelect={() => go(`/app/projects/${e.id}`)}>{e.title}</Command.Item>)}
                    {data.missions.map((e) => <Command.Item key={e.id} className={item} onSelect={() => go(`/app/missions/${e.id}`)}>{e.title}</Command.Item>)}
                  </Command.Group>
                )}
                {data.documents.length > 0 && (
                  <Command.Group heading={t('nav.documents')} className={group}>
                    {data.documents.map((e) => <Command.Item key={e.id} className={item} onSelect={() => go(`/app/documents/${e.id}`)}><FileText /> {e.title}</Command.Item>)}
                  </Command.Group>
                )}
                {data.shared_files.length + data.private_files.length > 0 && (
                  <Command.Group heading={t('nav.companyFiles')} className={group}>
                    {data.shared_files.map((f) => <Command.Item key={f.id} className={item} onSelect={() => go(`/app/files?file=${f.id}`)}><FolderOpen /> {f.original_name}</Command.Item>)}
                    {data.private_files.map((f) => <Command.Item key={f.id} className={item} onSelect={() => go(`/app/files?tab=private&file=${f.id}`)}><FolderOpen /> {f.original_name} · <span className="text-muted-foreground">{t('files.private')}</span></Command.Item>)}
                  </Command.Group>
                )}
              </>
            )}
          </Command.List>
        </Command>
      </DialogContent>
    </Dialog>
  );
}
