import { Button, Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, Field, Input, NativeSelect, Switch, Textarea } from '@nexus/ui';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAction } from '@/components/common';
import { api, apiPatch, apiPost } from '@/lib/api';

export type EntityName = 'departments' | 'goals' | 'missions' | 'projects' | 'tasks' | 'meetings' | 'documents' | 'decisions' | 'memories';

export interface Member {
  id: string;
  user_id: string;
  full_name: string;
  role: string;
  job_title: string | null;
  department_id: string | null;
  email: string | null;
}

export const useMembers = () => useQuery({ queryKey: ['members'], queryFn: () => api<Member[]>('/org/members'), staleTime: 60_000 });
export const useAiList = () => useQuery({ queryKey: ['ai-employees'], queryFn: () => api<Array<{ id: string; name: string; job_title: string; status: string; avatar_seed: string; department_id: string | null }>>('/ai/employees'), staleTime: 30_000 });
export const useEntityList = <T,>(entity: EntityName, query?: Record<string, string | undefined>) =>
  useQuery({ queryKey: ['work', entity, query ?? {}], queryFn: () => api<T[]>(`/work/${entity}`, query ? { query } : {}) });

type Opt = { value: string; label: string };

export type FieldDef =
  | { name: string; label: string; type: 'text' | 'textarea' | 'date' | 'datetime' | 'number' | 'tags' | 'markdown'; required?: boolean; hint?: string; full?: boolean }
  | { name: string; label: string; type: 'select'; options: Opt[]; required?: boolean; hint?: string; full?: boolean; allowEmpty?: boolean }
  | { name: string; label: string; type: 'switch'; hint?: string; full?: boolean };

export type Values = Record<string, unknown>;

function toInput(type: FieldDef['type'], v: unknown): string {
  if (v === null || v === undefined) return '';
  if (type === 'tags' && Array.isArray(v)) return v.join(', ');
  if (type === 'datetime' && typeof v === 'string') return v.slice(0, 16);
  if (type === 'date' && typeof v === 'string') return v.slice(0, 10);
  return String(v);
}

function fromInput(type: FieldDef['type'], v: unknown): unknown {
  if (type === 'switch') return Boolean(v);
  const s = String(v ?? '');
  if (type === 'number') return s === '' ? undefined : Number(s);
  if (type === 'tags') return s.split(',').map((x) => x.trim()).filter(Boolean);
  if (type === 'datetime') return s ? new Date(s).toISOString() : null;
  if (type === 'date' || type === 'select') return s || null;
  return s;
}

/**
 * Generic create/edit dialog for company OS entities. The server validates every field (Zod)
 * and enforces permissions; this component only collects input.
 */
export function EntityDialog({
  entity,
  open,
  onOpenChange,
  title,
  fields,
  initial,
  id,
  onSaved,
  extra,
}: {
  entity: EntityName;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  title: string;
  fields: FieldDef[];
  initial?: Values;
  id?: string;
  onSaved?: (row: { id: string; ai_session_id?: string }) => void;
  extra?: Values;
}) {
  const { t } = useTranslation();
  const [values, setValues] = useState<Record<string, unknown>>({});
  useEffect(() => {
    if (!open) return;
    const v: Record<string, unknown> = {};
    for (const f of fields) v[f.name] = f.type === 'switch' ? Boolean(initial?.[f.name]) : toInput(f.type, initial?.[f.name]);
    setValues(v);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initial]);

  const save = useAction(
    () => {
      const body: Values = { ...(extra ?? {}) };
      for (const f of fields) {
        const out = fromInput(f.type, values[f.name]);
        if (out !== undefined && !(id && out === '' && f.type !== 'textarea' && f.type !== 'markdown')) body[f.name] = out;
      }
      return id ? apiPatch<{ id: string }>(`/work/${entity}/${id}`, body) : apiPost<{ id: string; ai_session_id?: string }>(`/work/${entity}`, body);
    },
    {
      success: id ? t('common.saved') : t('common.created'),
      invalidate: [['work'], ['dashboard']],
      onSuccess: (row) => {
        onOpenChange(false);
        onSaved?.(row);
      },
    },
  );

  const set = (name: string, v: unknown) => setValues((prev) => ({ ...prev, [name]: v }));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="lg" closeLabel={t('common.close')}>
        <DialogHeader><DialogTitle>{title}</DialogTitle></DialogHeader>
        <form className="grid gap-4 sm:grid-cols-2" onSubmit={(e) => { e.preventDefault(); save.mutate(undefined); }}>
          {fields.map((f) => (
            <Field key={f.name} label={f.type === 'switch' ? undefined : f.label} hint={f.hint} className={f.full || f.type === 'textarea' || f.type === 'markdown' ? 'sm:col-span-2' : undefined}>
              {f.type === 'textarea' || f.type === 'markdown' ? (
                <Textarea rows={f.type === 'markdown' ? 14 : 4} className={f.type === 'markdown' ? 'font-mono text-xs' : undefined} value={String(values[f.name] ?? '')} onChange={(e) => set(f.name, e.target.value)} dir="auto" />
              ) : f.type === 'select' ? (
                <NativeSelect value={String(values[f.name] ?? '')} onChange={(e) => set(f.name, e.target.value)} required={f.required}>
                  {(f.allowEmpty ?? !f.required) && <option value="">{t('common.none')}</option>}
                  {f.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </NativeSelect>
              ) : f.type === 'switch' ? (
                <label className="flex items-center gap-3 text-sm"><Switch checked={Boolean(values[f.name])} onCheckedChange={(v) => set(f.name, v)} /> {f.label}</label>
              ) : (
                <Input
                  type={f.type === 'date' ? 'date' : f.type === 'datetime' ? 'datetime-local' : f.type === 'number' ? 'number' : 'text'}
                  required={f.required}
                  value={String(values[f.name] ?? '')}
                  onChange={(e) => set(f.name, e.target.value)}
                  dir="auto"
                />
              )}
            </Field>
          ))}
          <DialogFooter className="sm:col-span-2">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>{t('common.cancel')}</Button>
            <Button type="submit" loading={save.isPending}>{id ? t('common.save') : t('common.create')}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function useOptions() {
  const { t } = useTranslation();
  const members = useMembers();
  const ais = useAiList();
  const deps = useEntityList<{ id: string; name: string }>('departments');
  const projects = useEntityList<{ id: string; title: string }>('projects');
  const missions = useEntityList<{ id: string; title: string }>('missions');
  const goals = useEntityList<{ id: string; title: string }>('goals');
  const enumOpts = (prefix: string, values: readonly string[]) => values.map((v) => ({ value: v, label: t(`${prefix}.${v}`) }));
  return {
    members: (members.data ?? []).map((m) => ({ value: m.id, label: m.full_name || m.email || m.role })),
    ais: (ais.data ?? []).map((a) => ({ value: a.id, label: `${a.name} — ${a.job_title}` })),
    departments: (deps.data ?? []).map((d) => ({ value: d.id, label: d.name })),
    projects: (projects.data ?? []).map((d) => ({ value: d.id, label: d.title })),
    missions: (missions.data ?? []).map((d) => ({ value: d.id, label: d.title })),
    goals: (goals.data ?? []).map((d) => ({ value: d.id, label: d.title })),
    enumOpts,
    memberName: (id: string | null | undefined) => members.data?.find((m) => m.id === id)?.full_name,
    memberNameByUser: (userId: string | null | undefined) => members.data?.find((m) => m.user_id === userId)?.full_name,
    aiName: (id: string | null | undefined) => ais.data?.find((m) => m.id === id)?.name,
  };
}
