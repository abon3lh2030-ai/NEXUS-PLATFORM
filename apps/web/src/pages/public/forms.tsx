import { zodResolver } from '@hookform/resolvers/zod';
import { Button, Card, CardContent, Checkbox, Field, Input, Label, NativeSelect, Textarea } from '@nexus/ui';
import { COMPANY_SIZES, contactSchema, enterpriseRequestSchema, INDUSTRIES, type ContactInput } from '@nexus/shared';
import { CheckCircle2 } from 'lucide-react';
import { useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import type { z } from 'zod';
import { ErrorNotice } from '@/components/common';
import { api } from '@/lib/api';
import { PageHero } from './marketing';

type EnterpriseForm = z.input<typeof enterpriseRequestSchema>;

export function Success({ title, body }: { title: string; body?: string }) {
  return (
    <div className="flex flex-col items-center py-10 text-center">
      <CheckCircle2 className="size-12 text-success" />
      <p className="mt-4 text-lg font-semibold">{title}</p>
      {body && <p className="mt-1 max-w-md text-sm text-muted-foreground">{body}</p>}
    </div>
  );
}

export function EnterprisePage() {
  const { t } = useTranslation();
  const [done, setDone] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const form = useForm<EnterpriseForm, unknown, z.output<typeof enterpriseRequestSchema>>({
    resolver: zodResolver(enterpriseRequestSchema),
    defaultValues: { company_size: '51-200', industry: 'technology', expected_human_members: 20, expected_ai_employees: 30, website: '', customer_note: '', expected_ai_usage: '', expected_computer_usage: '', expected_storage: '', requirements: '' },
  });
  const err = (name: keyof EnterpriseForm) => (form.formState.errors[name] ? t(`validation.${form.formState.errors[name]?.message === 'invalid_saudi_cr' ? 'cr' : 'invalid'}`) : undefined);

  const onSubmit = form.handleSubmit(async (values) => {
    setError(null);
    try {
      await api('/public/enterprise-requests', { method: 'POST', body: values, org: false });
      setDone(true);
    } catch (e) {
      setError(e);
    }
  });

  return (
    <>
      <PageHero eyebrow={t('public.nav.enterprise')} title={t('enterprisePage.title')} subtitle={t('enterprisePage.subtitle')} />
      <div className="mx-auto max-w-3xl px-4 py-12 sm:px-6">
        <Card>
          <CardContent className="p-6 sm:p-8">
            {done ? (
              <Success title={t('enterprisePage.successTitle')} body={t('enterprisePage.successBody')} />
            ) : (
              <form onSubmit={onSubmit} className="grid gap-5" noValidate>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label={t('forms.companyName')} error={err('company_name')}><Input {...form.register('company_name')} /></Field>
                  <Field label={t('forms.cr')} error={err('commercial_registration')} hint={t('forms.crHint')}><Input inputMode="numeric" dir="ltr" {...form.register('commercial_registration')} /></Field>
                  <Field label={t('forms.website')} error={err('website')}><Input dir="ltr" placeholder="https://" {...form.register('website')} /></Field>
                  <Field label={t('forms.contactName')} error={err('contact_name')}><Input {...form.register('contact_name')} /></Field>
                  <Field label={t('forms.workEmail')} error={err('work_email')}><Input type="email" dir="ltr" {...form.register('work_email')} /></Field>
                  <Field label={t('forms.companySize')}>
                    <NativeSelect {...form.register('company_size')}>{COMPANY_SIZES.map((s) => <option key={s} value={s}>{s}</option>)}</NativeSelect>
                  </Field>
                  <Field label={t('forms.industry')}>
                    <NativeSelect {...form.register('industry')}>{INDUSTRIES.map((s) => <option key={s} value={s}>{t(`industries.${s}`)}</option>)}</NativeSelect>
                  </Field>
                  <Field label={t('forms.expectedHumans')} error={err('expected_human_members')}><Input type="number" min={1} {...form.register('expected_human_members', { valueAsNumber: true })} /></Field>
                  <Field label={t('forms.expectedAi')} error={err('expected_ai_employees')}><Input type="number" min={0} {...form.register('expected_ai_employees', { valueAsNumber: true })} /></Field>
                  <Field label={t('forms.expectedStorage')}><Input {...form.register('expected_storage')} placeholder="500 GB" /></Field>
                </div>
                <Field label={t('forms.expectedAiUsage')}><Textarea rows={2} {...form.register('expected_ai_usage')} /></Field>
                <Field label={t('forms.expectedComputerUsage')}><Textarea rows={2} {...form.register('expected_computer_usage')} /></Field>
                <Field label={t('forms.requirements')}><Textarea rows={4} {...form.register('requirements')} /></Field>
                <Field label={t('forms.customerNote')}><Textarea rows={2} {...form.register('customer_note')} /></Field>
                <Controller
                  control={form.control}
                  name="confirm_saudi_registered"
                  render={({ field }) => (
                    <div className="flex items-start gap-3 rounded-lg border bg-muted/40 p-3">
                      <Checkbox id="saudi" checked={field.value === true} onCheckedChange={(v) => field.onChange(v === true ? true : undefined)} />
                      <Label htmlFor="saudi" className="leading-relaxed">{t('forms.saudiConfirm')}</Label>
                    </div>
                  )}
                />
                {form.formState.errors.confirm_saudi_registered && <p className="text-xs text-destructive">{t('validation.saudiConfirm')}</p>}
                <ErrorNotice error={error} />
                <Button type="submit" variant="brand" size="lg" loading={form.formState.isSubmitting}>{t('pricing.requestCustom')}</Button>
              </form>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}

export function ContactPage() {
  const { t } = useTranslation();
  const [done, setDone] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const form = useForm<z.input<typeof contactSchema>, unknown, ContactInput>({ resolver: zodResolver(contactSchema), defaultValues: { company: '' } });
  const onSubmit = form.handleSubmit(async (values) => {
    setError(null);
    try {
      await api('/public/contact', { method: 'POST', body: values, org: false, auth: false });
      setDone(true);
    } catch (e) {
      setError(e);
    }
  });
  return (
    <>
      <PageHero eyebrow={t('public.nav.contact')} title={t('contactPage.title')} subtitle={t('contactPage.subtitle')} />
      <div className="mx-auto max-w-xl px-4 py-12 sm:px-6">
        <Card>
          <CardContent className="p-6 sm:p-8">
            {done ? (
              <Success title={t('contactPage.success')} />
            ) : (
              <form onSubmit={onSubmit} className="grid gap-4" noValidate>
                <Field label={t('forms.name')} error={form.formState.errors.name && t('validation.required')}><Input {...form.register('name')} /></Field>
                <Field label={t('forms.email')} error={form.formState.errors.email && t('validation.email')}><Input type="email" dir="ltr" {...form.register('email')} /></Field>
                <Field label={t('forms.company')}><Input {...form.register('company')} /></Field>
                <Field label={t('forms.message')} error={form.formState.errors.message && t('validation.required')}><Textarea rows={5} {...form.register('message')} /></Field>
                <ErrorNotice error={error} />
                <Button type="submit" loading={form.formState.isSubmitting}>{t('common.send')}</Button>
              </form>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
