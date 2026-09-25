import {
  Avatar,
  Badge,
  Button,
  Card,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  EmptyState,
  Field,
  Input,
  NativeSelect,
  PageHeader,
  Textarea,
  cn,
} from '@nexus/ui';
import { AUTONOMY_LEVELS, TEMPLATE_CATEGORIES } from '@nexus/shared';
import { useQuery } from '@tanstack/react-query';
import { Bot, Plus, Sparkles } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router';
import { LoadingBlock, MockBanner, StatusBadge, useAction } from '@/components/common';
import { api, apiPost } from '@/lib/api';
import { useSession } from '@/providers/session';
import type { AiEmployee, Template } from './types';

export function useDepartments() {
  return useQuery({ queryKey: ['work', 'departments'], queryFn: () => api<Array<{ id: string; name: string }>>('/work/departments') });
}

export function WorkforcePage() {
  const { t } = useTranslation();
  const { can, org } = useSession();
  const [hire, setHire] = useState(false);
  const { data, isLoading } = useQuery({ queryKey: ['ai-employees'], queryFn: () => api<AiEmployee[]>('/ai/employees'), refetchInterval: 15_000 });
  const deps = useDepartments();
  const depName = (id: string | null) => deps.data?.find((d) => d.id === id)?.name;
  const limit = org?.billing.entitlements.ai_employees;

  return (
    <>
      <PageHeader
        title={t('nav.workforce')}
        description={t('workforce.description')}
        icon={<Bot />}
        actions={
          <>
            <Badge tone="neutral">{t('workforce.count', { count: data?.length ?? 0, limit: limit === null || limit === undefined ? '∞' : limit })}</Badge>
            {can('ai.manage') && <Button variant="brand" onClick={() => setHire(true)}><Plus /> {t('workforce.hire')}</Button>}
          </>
        }
      />
      <MockBanner show={Boolean(org?.ai.is_mock)} />
      {isLoading ? (
        <LoadingBlock className="mt-4" />
      ) : !data?.length ? (
        <EmptyState className="mt-4" icon={<Bot />} title={t('workforce.empty')} description={t('workforce.emptyHint')} action={can('ai.manage') ? <Button onClick={() => setHire(true)}><Plus /> {t('workforce.hire')}</Button> : undefined} />
      ) : (
        <div className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {data.map((e) => (
            <Link key={e.id} to={`/app/workforce/${e.id}`}>
              <Card className="h-full p-5 transition-shadow hover:shadow-lg">
                <div className="flex items-start gap-3">
                  <Avatar name={e.avatar_seed || e.name} square className="size-12 text-base" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-semibold">{e.name}</p>
                    <p className="truncate text-sm text-muted-foreground">{e.job_title}</p>
                  </div>
                  <StatusBadge value={e.is_active ? e.status : 'offline'} />
                </div>
                <div className="mt-4 flex flex-wrap gap-1.5">
                  {depName(e.department_id) && <Badge>{depName(e.department_id)}</Badge>}
                  <Badge tone="primary">{t(`autonomy.${e.autonomy}`)}</Badge>
                  <Badge tone="neutral" dir="ltr">{e.model}</Badge>
                </div>
                {e.skills.length > 0 && <p className="mt-3 line-clamp-1 text-xs text-muted-foreground">{e.skills.join(' · ')}</p>}
              </Card>
            </Link>
          ))}
        </div>
      )}
      <HireDialog open={hire} onOpenChange={setHire} />
    </>
  );
}

function HireDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const ar = i18n.language === 'ar';
  const templates = useQuery({ queryKey: ['ai-templates'], queryFn: () => api<Template[]>('/ai/templates'), enabled: open });
  const models = useQuery({ queryKey: ['ai-models'], queryFn: () => api<{ default: string; models: string[] }>('/ai/models'), enabled: open });
  const deps = useDepartments();
  const [step, setStep] = useState<'pick' | 'form'>('pick');
  const [form, setForm] = useState({ template_id: null as string | null, name: '', job_title: '', department_id: '', autonomy: 'draft' as string, role_description: '', skills: '', model: '' });

  const pick = (tpl: Template | null) => {
    setForm({
      template_id: tpl?.id ?? null,
      name: tpl ? (ar ? tpl.name_ar : tpl.name_en) : '',
      job_title: tpl ? (ar ? tpl.job_title_ar : tpl.job_title_en) : '',
      department_id: '',
      autonomy: tpl?.default_autonomy ?? 'draft',
      role_description: tpl ? (ar ? tpl.description_ar : tpl.description_en) : '',
      skills: tpl?.skills.join(', ') ?? '',
      model: '',
    });
    setStep('form');
  };

  const create = useAction(
    () =>
      apiPost<{ id: string }>('/ai/employees', {
        template_id: form.template_id,
        name: form.name,
        job_title: form.job_title,
        department_id: form.department_id || null,
        autonomy: form.autonomy,
        role_description: form.role_description,
        skills: form.skills.split(',').map((s) => s.trim()).filter(Boolean),
        responsibilities: templates.data?.find((x) => x.id === form.template_id)?.responsibilities ?? [],
        ...(form.model ? { model: form.model } : {}),
      }),
    { success: t('workforce.hired'), invalidate: [['ai-employees']], onSuccess: (r) => { onOpenChange(false); setStep('pick'); navigate(`/app/workforce/${r.id}`); } },
  );

  return (
    <Dialog open={open} onOpenChange={(o) => { onOpenChange(o); if (!o) setStep('pick'); }}>
      <DialogContent size="xl" closeLabel={t('common.close')}>
        <DialogHeader>
          <DialogTitle>{t('workforce.hireTitle')}</DialogTitle>
          <DialogDescription>{step === 'pick' ? t('workforce.pickTemplate') : t('workforce.configure')}</DialogDescription>
        </DialogHeader>
        {step === 'pick' ? (
          <div className="grid gap-5">
            <button onClick={() => pick(null)} className="flex items-center gap-3 rounded-xl border border-dashed p-4 text-start hover:bg-muted">
              <Sparkles className="size-5 text-primary" />
              <div><p className="font-medium">{t('workforce.custom')}</p><p className="text-xs text-muted-foreground">{t('workforce.customHint')}</p></div>
            </button>
            {TEMPLATE_CATEGORIES.map((cat) => {
              const list = templates.data?.filter((x) => x.category === cat) ?? [];
              if (!list.length) return null;
              return (
                <div key={cat}>
                  <p className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">{t(`templateCategories.${cat}`)}</p>
                  <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                    {list.map((tpl) => (
                      <button key={tpl.id} onClick={() => pick(tpl)} className="flex items-start gap-3 rounded-xl border p-3 text-start transition-colors hover:border-primary/40 hover:bg-primary/5">
                        <Avatar name={ar ? tpl.name_ar : tpl.name_en} square className="size-9" />
                        <div className="min-w-0">
                          <p className="text-sm font-medium">{ar ? tpl.job_title_ar : tpl.job_title_en}</p>
                          <p className="line-clamp-2 text-xs text-muted-foreground">{ar ? tpl.description_ar : tpl.description_en}</p>
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <form className="grid gap-4" onSubmit={(e) => { e.preventDefault(); create.mutate(undefined); }}>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={t('workforce.name')}><Input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} maxLength={80} /></Field>
              <Field label={t('workforce.jobTitle')}><Input required value={form.job_title} onChange={(e) => setForm({ ...form, job_title: e.target.value })} maxLength={120} /></Field>
              <Field label={t('nav.departments')}>
                <NativeSelect value={form.department_id} onChange={(e) => setForm({ ...form, department_id: e.target.value })}>
                  <option value="">{t('common.none')}</option>
                  {deps.data?.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                </NativeSelect>
              </Field>
              <Field label={t('workforce.autonomy')} hint={t(`autonomyHints.${form.autonomy}`)}>
                <NativeSelect value={form.autonomy} onChange={(e) => setForm({ ...form, autonomy: e.target.value })}>
                  {AUTONOMY_LEVELS.map((a) => <option key={a} value={a}>{t(`autonomy.${a}`)}</option>)}
                </NativeSelect>
              </Field>
              <Field label={t('ai.model')}>
                <NativeSelect value={form.model} onChange={(e) => setForm({ ...form, model: e.target.value })} dir="ltr">
                  <option value="">{t('workforce.defaultModel', { model: models.data?.default ?? '' })}</option>
                  {models.data?.models.map((m) => <option key={m} value={m}>{m}</option>)}
                </NativeSelect>
              </Field>
              <Field label={t('workforce.skills')} hint={t('workforce.skillsHint')}><Input value={form.skills} onChange={(e) => setForm({ ...form, skills: e.target.value })} /></Field>
            </div>
            <Field label={t('workforce.role')}><Textarea rows={3} value={form.role_description} onChange={(e) => setForm({ ...form, role_description: e.target.value })} /></Field>
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => setStep('pick')}>{t('common.back')}</Button>
              <Button type="submit" variant="brand" loading={create.isPending} className={cn(!form.name && 'opacity-60')}>{t('workforce.hire')}</Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
