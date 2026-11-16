import { useMutation, useQuery, useQueryClient, type QueryKey } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { useErrorMessage } from '@/components/common';
import { api, ApiError } from '@/lib/api';
import i18n from '@/i18n';
import './i18n';

/** Founder routes never send the company header. */
export const fget = <T>(path: string, query?: Record<string, string | number | undefined>) => api<T>(path, { org: false, ...(query ? { query } : {}) });
export const fsend = <T>(method: 'POST' | 'PATCH' | 'PUT' | 'DELETE', path: string, body?: unknown) => api<T>(path, { method, org: false, ...(body !== undefined ? { body } : {}) });

export type Row = Record<string, unknown> & { id: string };

export function useFounder<T>(path: string, opts: { enabled?: boolean; query?: Record<string, string | undefined> } = {}) {
  return useQuery({ queryKey: ['founder', path, opts.query ?? {}], queryFn: () => fget<T>(path, opts.query), enabled: opts.enabled ?? true });
}

export function useCollection(col: string, filters: Record<string, string | undefined> = {}) {
  const query = Object.fromEntries(Object.entries(filters).filter(([, v]) => v));
  return useQuery({ queryKey: ['founder', `/founder/c/${col}`, query], queryFn: () => fget<Row[]>(`/founder/c/${col}`, query), enabled: col !== '__none' });
}

/** Any write refreshes every founder query: sections are linked (a won deal changes revenue, goals, overview…). */
export function useFounderAction<V, R>(fn: (v: V) => Promise<R>, opts: { success?: string | false; onSuccess?: (r: R, v: V) => void } = {}) {
  const qc = useQueryClient();
  const msg = useErrorMessage();
  const { t } = useTranslation();
  return useMutation({
    mutationFn: fn,
    onSuccess: (r, v) => {
      if (opts.success !== false) toast.success(opts.success ?? t('founder.common.saved'));
      void qc.invalidateQueries({ queryKey: ['founder'] as QueryKey });
      opts.onSuccess?.(r, v);
    },
    onError: (e) => toast.error(msg(e)),
  });
}

export const saveRow = (col: string, id: string | null, values: Record<string, unknown>) =>
  id ? fsend<Row>('PATCH', `/founder/c/${col}/${id}`, values) : fsend<Row>('POST', `/founder/c/${col}`, values);
export const deleteRow = (col: string, id: string) => fsend('DELETE', `/founder/c/${col}/${id}`);

/* ───────── formatting ───────── */

const locale = () => (i18n.language === 'en' ? 'en-US' : 'ar-SA-u-nu-latn');

export function sar(v: unknown, compact = false): string {
  const num = Number(v ?? 0);
  if (!Number.isFinite(num)) return '—';
  const s = new Intl.NumberFormat(locale(), { maximumFractionDigits: compact ? 1 : 2, notation: compact && Math.abs(num) >= 100000 ? 'compact' : 'standard' }).format(num);
  return `${s} ${i18n.language === 'en' ? 'SAR' : 'ر.س'}`;
}
export const num = (v: unknown, digits = 0) => (v === null || v === undefined || v === '' ? '—' : new Intl.NumberFormat(locale(), { maximumFractionDigits: digits }).format(Number(v)));
export const pct = (v: unknown) => (v === null || v === undefined ? '—' : `${num(v, 1)}%`);
export function day(v: unknown): string {
  if (!v || typeof v !== 'string') return '—';
  const d = new Date(v.length === 10 ? `${v}T00:00:00` : v);
  return Number.isNaN(d.getTime()) ? '—' : new Intl.DateTimeFormat(locale(), { dateStyle: 'medium' }).format(d);
}
export function dateTime(v: unknown): string {
  if (!v || typeof v !== 'string') return '—';
  return new Intl.DateTimeFormat(locale(), { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(v));
}
export const todayIso = () => new Date().toISOString().slice(0, 10);

/* ───────── export ───────── */

export interface Sheet {
  title: string;
  columns: Array<{ key: string; label: string }>;
  rows: Array<Record<string, string | number | boolean | null>>;
}

export async function exportFile(format: 'xlsx' | 'pdf', title: string, sheets: Sheet[]) {
  const res = await api<Response>('/founder/export', { method: 'POST', org: false, raw: true, body: { format, title, locale: i18n.language === 'en' ? 'en' : 'ar', sheets } });
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${title}.${format}`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

export const isApiError = (e: unknown, code?: string) => e instanceof ApiError && (!code || e.code === code);
