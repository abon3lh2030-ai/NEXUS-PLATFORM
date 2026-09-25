import { cn } from '@nexus/ui';
import { File, FileArchive, FileSpreadsheet, FileText, Image, Presentation } from 'lucide-react';
import type { CompanyFile } from './types';

const MAP = {
  image: { icon: Image, cls: 'bg-pink-500/10 text-pink-600 dark:text-pink-400' },
  pdf: { icon: FileText, cls: 'bg-red-500/10 text-red-600 dark:text-red-400' },
  document: { icon: FileText, cls: 'bg-blue-500/10 text-blue-600 dark:text-blue-400' },
  spreadsheet: { icon: FileSpreadsheet, cls: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400' },
  presentation: { icon: Presentation, cls: 'bg-orange-500/10 text-orange-600 dark:text-orange-400' },
  text: { icon: FileText, cls: 'bg-slate-500/10 text-slate-600 dark:text-slate-300' },
  archive: { icon: FileArchive, cls: 'bg-amber-500/10 text-amber-600 dark:text-amber-400' },
} as const;

export function FileIcon({ category, className }: { category: CompanyFile['category'] | string; className?: string }) {
  const m = MAP[category as keyof typeof MAP] ?? { icon: File, cls: 'bg-muted text-muted-foreground' };
  const Icon = m.icon;
  return (
    <span className={cn('flex size-10 shrink-0 items-center justify-center rounded-xl', m.cls, className)}>
      <Icon className="size-5" />
    </span>
  );
}
