import { Badge, Button, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, cn } from '@nexus/ui';
import { useMutation, useQueryClient, type QueryKey } from '@tanstack/react-query';
import { AlertTriangle, Languages, Monitor, Moon, Sun } from 'lucide-react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { toast } from 'sonner';
import { setLocale } from '@/i18n';
import { ApiError } from '@/lib/api';
import { useTheme } from '@/providers/theme';

export function Logo({ className, withText = true }: { className?: string; withText?: boolean }) {
  return (
    <span className={cn('inline-flex items-center gap-2 font-display font-semibold tracking-[0.18em]', className)} dir="ltr">
      <svg viewBox="0 0 64 64" className="size-7 shrink-0" aria-hidden>
        <defs>
          <linearGradient id="nx" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="var(--brand-1)" />
            <stop offset="1" stopColor="var(--brand-2)" />
          </linearGradient>
        </defs>
        <rect width="64" height="64" rx="16" className="fill-foreground" />
        <path d="M18 46V18l28 28V18" fill="none" stroke="url(#nx)" strokeWidth="6" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      {withText && <span>NEXUS</span>}
    </span>
  );
}

/** Maps API error codes to localized, human-friendly messages. */
export function useErrorMessage() {
  const { t } = useTranslation();
  return (err: unknown): string => {
    if (err instanceof ApiError) {
      const key = `errors.${err.code.split(':')[0]}`;
      const msg = t(key);
      return msg === key ? t('errors.generic', { code: err.code }) : msg;
    }
    return t('errors.generic', { code: 'unknown' });
  };
}

export function ErrorNotice({ error, className }: { error: unknown; className?: string }) {
  const msg = useErrorMessage();
  if (!error) return null;
  return (
    <div className={cn('flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive', className)}>
      <AlertTriangle className="mt-0.5 size-4 shrink-0" />
      <span>{msg(error)}</span>
    </div>
  );
}

/** Mutation helper: toast on success/error and invalidate queries. */
export function useAction<TVars, TRes>(fn: (v: TVars) => Promise<TRes>, opts: { success?: string; invalidate?: QueryKey[]; onSuccess?: (r: TRes, v: TVars) => void } = {}) {
  const qc = useQueryClient();
  const msg = useErrorMessage();
  return useMutation({
    mutationFn: fn,
    onSuccess: (r, v) => {
      if (opts.success) toast.success(opts.success);
      opts.invalidate?.forEach((k) => void qc.invalidateQueries({ queryKey: k }));
      opts.onSuccess?.(r, v);
    },
    onError: (e) => toast.error(msg(e)),
  });
}

const TONES: Record<string, 'neutral' | 'primary' | 'success' | 'warning' | 'danger' | 'info'> = {
  // tasks
  backlog: 'neutral', todo: 'neutral', in_progress: 'primary', review: 'info', blocked: 'danger', done: 'success',
  // ai / sessions
  offline: 'neutral', idle: 'neutral', queued: 'info', preparing: 'info', thinking: 'primary', researching: 'primary', reading: 'primary', writing: 'primary', executing: 'primary', waiting: 'warning', waiting_approval: 'warning', completed: 'success', failed: 'danger', running: 'primary', paused: 'warning', cancelled: 'neutral',
  // approvals
  pending: 'warning', approved: 'success', rejected: 'danger', revision_requested: 'info',
  // work
  planned: 'neutral', active: 'primary', on_hold: 'warning',
  // goals
  on_track: 'success', at_risk: 'warning', off_track: 'danger', achieved: 'success', archived: 'neutral',
  // priority
  low: 'neutral', medium: 'info', high: 'warning', urgent: 'danger',
  // files
  uploading: 'info', processing: 'info', ready: 'success', not_scanned: 'neutral', clean: 'success', infected: 'danger',
  draft: 'neutral', pending_approval: 'warning', published: 'success', expired: 'danger', verified: 'success',
};

const LIVE = new Set(['thinking', 'researching', 'reading', 'writing', 'executing', 'running', 'preparing']);

export function StatusBadge({ value, className }: { value: string | null | undefined; className?: string }) {
  const { t } = useTranslation();
  if (!value) return null;
  return (
    <Badge tone={TONES[value] ?? 'neutral'} className={className}>
      {LIVE.has(value) && <span className="relative flex size-1.5"><span className="absolute inline-flex size-full animate-ping rounded-full bg-current opacity-60" /><span className="relative inline-flex size-1.5 rounded-full bg-current" /></span>}
      {t(`status.${value}`, value)}
    </Badge>
  );
}

export function Markdown({ children, className }: { children: string; className?: string }) {
  // react-markdown does not render raw HTML by default — safe for AI/user content.
  return (
    <div className={cn('prose-nexus text-sm', className)} dir="auto">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{children}</ReactMarkdown>
    </div>
  );
}

export function ThemeToggle() {
  const { t } = useTranslation();
  const { theme, setTheme } = useTheme();
  const Icon = theme === 'dark' ? Moon : theme === 'light' ? Sun : Monitor;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label={t('common.theme')}>
          <Icon />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        <DropdownMenuItem onSelect={() => setTheme('light')}><Sun /> {t('common.light')}</DropdownMenuItem>
        <DropdownMenuItem onSelect={() => setTheme('dark')}><Moon /> {t('common.dark')}</DropdownMenuItem>
        <DropdownMenuItem onSelect={() => setTheme('system')}><Monitor /> {t('common.system')}</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function LanguageToggle({ compact }: { compact?: boolean }) {
  const { i18n, t } = useTranslation();
  const next = i18n.language === 'ar' ? 'en' : 'ar';
  return (
    <Button variant="ghost" size={compact ? 'icon-sm' : 'sm'} onClick={() => setLocale(next)} aria-label={t('common.language')}>
      <Languages />
      {!compact && <span>{next === 'en' ? 'English' : 'العربية'}</span>}
    </Button>
  );
}

export function MockBanner({ show }: { show: boolean }) {
  const { t } = useTranslation();
  if (!show) return null;
  return (
    <div className="flex items-center gap-2 rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-xs text-warning">
      <AlertTriangle className="size-4" /> {t('ai.mockBanner')}
    </div>
  );
}

export function LoadingBlock({ className }: { className?: string }) {
  return (
    <div className={cn('grid gap-3', className)}>
      {[0, 1, 2].map((i) => (
        <div key={i} className="h-16 animate-pulse rounded-xl bg-muted" />
      ))}
    </div>
  );
}

export function KeyValue({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 py-2 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-end font-medium">{children}</span>
    </div>
  );
}
