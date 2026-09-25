import { formatBytes as sharedFormatBytes } from '@nexus/shared';
import i18n from '@/i18n';

const loc = () => (i18n.language === 'ar' ? 'ar-SA-u-nu-latn' : 'en-GB');

export function formatDate(value: string | null | undefined, opts: Intl.DateTimeFormatOptions = { dateStyle: 'medium' }): string {
  if (!value) return '—';
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? '—' : new Intl.DateTimeFormat(loc(), { calendar: 'gregory', ...opts }).format(d);
}

export function formatDateTime(value: string | null | undefined): string {
  return formatDate(value, { dateStyle: 'medium', timeStyle: 'short' });
}

export function formatTime(value: string | null | undefined): string {
  return formatDate(value, { hour: '2-digit', minute: '2-digit' });
}

export function formatRelative(value: string | null | undefined): string {
  if (!value) return '—';
  const diff = (new Date(value).getTime() - Date.now()) / 1000;
  const rtf = new Intl.RelativeTimeFormat(loc(), { numeric: 'auto' });
  const abs = Math.abs(diff);
  if (abs < 60) return rtf.format(Math.round(diff), 'second');
  if (abs < 3600) return rtf.format(Math.round(diff / 60), 'minute');
  if (abs < 86400) return rtf.format(Math.round(diff / 3600), 'hour');
  if (abs < 86400 * 30) return rtf.format(Math.round(diff / 86400), 'day');
  return formatDate(value);
}

export function formatNumber(n: number | null | undefined, digits = 0): string {
  if (n === null || n === undefined) return '—';
  return new Intl.NumberFormat(loc(), { maximumFractionDigits: digits }).format(n);
}

export function formatBytes(n: number | null | undefined): string {
  if (n === null || n === undefined) return '—';
  return sharedFormatBytes(n, loc());
}

export function formatSar(halalas: number | null | undefined): string {
  if (halalas === null || halalas === undefined) return '—';
  return new Intl.NumberFormat(loc(), { style: 'currency', currency: 'SAR', maximumFractionDigits: 0 }).format(halalas / 100);
}

export function formatUsd(n: number | null | undefined): string {
  if (n === null || n === undefined) return '—';
  return new Intl.NumberFormat(loc(), { style: 'currency', currency: 'USD', maximumFractionDigits: 2 }).format(n);
}

export function durationBetween(start: string | null | undefined, end?: string | null): string {
  if (!start) return '—';
  const ms = (end ? new Date(end).getTime() : Date.now()) - new Date(start).getTime();
  const m = Math.floor(ms / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}
