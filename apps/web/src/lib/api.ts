import { env } from './env';
import { orgStore } from './org-store';
import { getAccessToken } from './supabase';

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    public readonly details?: unknown,
  ) {
    super(code);
    this.name = 'ApiError';
  }
}

type Method = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';

export interface RequestOptions {
  method?: Method;
  body?: unknown;
  query?: Record<string, string | number | boolean | undefined | null>;
  /** Send the current organization header (default true). */
  org?: boolean;
  auth?: boolean;
  signal?: AbortSignal;
  raw?: boolean;
}

export async function api<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const url = new URL(`${env.apiBaseUrl}${path}`);
  for (const [k, v] of Object.entries(opts.query ?? {})) if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v));

  const headers: Record<string, string> = {};
  if (opts.auth !== false) {
    const token = await getAccessToken();
    if (token) headers.Authorization = `Bearer ${token}`;
  }
  const orgId = orgStore.get();
  if (opts.org !== false && orgId) headers['X-Organization-Id'] = orgId;
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json';

  let res: Response;
  try {
    res = await fetch(url, { method: opts.method ?? 'GET', headers, body: opts.body !== undefined ? JSON.stringify(opts.body) : null, signal: opts.signal ?? null });
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') throw err;
    throw new ApiError(0, 'network_error');
  }
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string; details?: unknown };
    throw new ApiError(res.status, body.error ?? `http_${res.status}`, body.details);
  }
  if (opts.raw) return res as unknown as T;
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export const apiGet = <T>(path: string, query?: RequestOptions['query']) => api<T>(path, query ? { query } : {});
export const apiPost = <T>(path: string, body?: unknown) => api<T>(path, { method: 'POST', body: body ?? {} });
export const apiPatch = <T>(path: string, body: unknown) => api<T>(path, { method: 'PATCH', body });
export const apiPut = <T>(path: string, body: unknown) => api<T>(path, { method: 'PUT', body });
export const apiDelete = <T>(path: string, body?: unknown) => api<T>(path, { method: 'DELETE', ...(body !== undefined ? { body } : {}) });

/** Fetch a binary resource with auth headers and return an object URL (used for secure previews). */
export async function apiBlobUrl(path: string): Promise<{ url: string; type: string; text?: string }> {
  const res = await api<Response>(path, { raw: true });
  const blob = await res.blob();
  const type = res.headers.get('Content-Type') ?? blob.type;
  if (type.startsWith('text/')) return { url: '', type, text: await blob.text() };
  return { url: URL.createObjectURL(blob), type };
}
