import { zodResolver } from '@hookform/resolvers/zod';
import { Button, Card, CardContent, Checkbox, Field, Input, Label, NativeSelect, Textarea } from '@nexus/ui';
import { companyApplicationSchema, COMPANY_SIZES, INDUSTRIES } from '@nexus/shared';
import { useQueryClient } from '@tanstack/react-query';
import { MailCheck } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { Link, Navigate, useNavigate, useParams, useSearchParams } from 'react-router';
import { z } from 'zod';
import { ErrorNotice, LanguageToggle, Logo, ThemeToggle, useErrorMessage } from '@/components/common';
import { FullPageLoader } from '@/components/guards';
import { WhatsAppButton } from '@/components/whatsapp';
import { api } from '@/lib/api';
import { env } from '@/lib/env';
import { orgStore } from '@/lib/org-store';
import { supabase } from '@/lib/supabase';
import { useSession } from '@/providers/session';
import { readLogoFile } from '@/components/company-logo';

function AuthShell({ title, subtitle, children, footer }: { title: string; subtitle?: string; children: ReactNode; footer?: ReactNode }) {
  return (
    <div className="relative flex min-h-dvh flex-col">
      <div className="grid-bg absolute inset-0 -z-10 [mask-image:radial-gradient(ellipse_at_top,black,transparent_65%)]" />
      <header className="flex h-16 items-center justify-between px-4 sm:px-8">
        <Link to="/"><Logo /></Link>
        <div className="flex items-center gap-1"><LanguageToggle compact /><ThemeToggle /></div>
      </header>
      <div className="flex flex-1 items-start justify-center px-4 pb-16 pt-8 sm:pt-16">
        <div className="w-full max-w-md">
          <h1 className="text-center text-2xl font-semibold tracking-tight">{title}</h1>
          {subtitle && <p className="mt-2 text-center text-sm text-muted-foreground">{subtitle}</p>}
          <Card className="mt-8 shadow-lg"><CardContent className="p-6">{children}</CardContent></Card>
          {footer && <div className="mt-6 text-center text-sm text-muted-foreground">{footer}</div>}
        </div>
      </div>
      <WhatsAppButton />
    </div>
  );
}

const loginSchema = z.object({ email: z.email(), password: z.string().min(8) });

export function LoginPage() {
  const { t } = useTranslation();
  const { session } = useSession();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const form = useForm<z.infer<typeof loginSchema>>({ resolver: zodResolver(loginSchema) });
  const next = params.get('next')?.startsWith('/') ? params.get('next')! : '/app';
  if (session) return <Navigate to={next} replace />;

  const onSubmit = form.handleSubmit(async (v) => {
    setError(null);
    const { error: e } = await supabase.auth.signInWithPassword(v);
    if (e) setError(e.message.toLowerCase().includes('confirm') ? t('auth.emailNotConfirmed') : t('auth.invalidCredentials'));
    else navigate(next, { replace: true });
  });

  return (
    <AuthShell title={t('auth.signInTitle')} subtitle={t('auth.signInSubtitle')} footer={<>{t('auth.noAccount')} <Link to="/signup" className="font-medium text-primary">{t('auth.signUp')}</Link></>}>
      <form onSubmit={onSubmit} className="grid gap-4" noValidate>
        <Field label={t('forms.email')} error={form.formState.errors.email && t('validation.email')}><Input type="email" dir="ltr" autoComplete="email" {...form.register('email')} /></Field>
        <Field label={t('auth.password')} error={form.formState.errors.password && t('validation.password')}><Input type="password" dir="ltr" autoComplete="current-password" {...form.register('password')} /></Field>
        <div className="-mt-2 text-end"><Link to="/forgot-password" className="text-xs text-primary">{t('auth.forgot')}</Link></div>
        {error && <p className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}
        <Button type="submit" loading={form.formState.isSubmitting}>{t('auth.signIn')}</Button>
      </form>
    </AuthShell>
  );
}

const signupSchema = z.object({ full_name: z.string().trim().min(2).max(120), email: z.email(), password: z.string().min(8).max(72) });

export function SignupPage() {
  const { t, i18n } = useTranslation();
  const { session } = useSession();
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const form = useForm<z.infer<typeof signupSchema>>({ resolver: zodResolver(signupSchema) });
  if (session) return <Navigate to="/onboarding" replace />;

  const onSubmit = form.handleSubmit(async (v) => {
    setError(null);
    const { data, error: e } = await supabase.auth.signUp({
      email: v.email,
      password: v.password,
      options: { data: { full_name: v.full_name, locale: i18n.language }, emailRedirectTo: `${env.publicAppUrl}/auth/callback?next=/onboarding` },
    });
    if (e) setError(e.message);
    else if (!data.session) setSent(true);
  });

  if (sent) {
    return (
      <AuthShell title={t('auth.checkEmailTitle')}>
        <div className="flex flex-col items-center gap-3 py-4 text-center">
          <MailCheck className="size-10 text-primary" />
          <p className="text-sm text-muted-foreground">{t('auth.checkEmailBody')}</p>
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell title={t('auth.signUpTitle')} subtitle={t('auth.signUpSubtitle')} footer={<>{t('auth.haveAccount')} <Link to="/login" className="font-medium text-primary">{t('auth.signIn')}</Link></>}>
      <form onSubmit={onSubmit} className="grid gap-4" noValidate>
        <Field label={t('forms.fullName')} error={form.formState.errors.full_name && t('validation.required')}><Input autoComplete="name" {...form.register('full_name')} /></Field>
        <Field label={t('forms.workEmail')} error={form.formState.errors.email && t('validation.email')}><Input type="email" dir="ltr" autoComplete="email" {...form.register('email')} /></Field>
        <Field label={t('auth.password')} error={form.formState.errors.password && t('validation.password')} hint={t('auth.passwordHint')}><Input type="password" dir="ltr" autoComplete="new-password" {...form.register('password')} /></Field>
        {error && <p className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}
        <Button type="submit" variant="brand" loading={form.formState.isSubmitting}>{t('auth.createAccount')}</Button>
        <p className="text-center text-xs text-muted-foreground">{t('auth.agree')} <Link className="underline" to="/terms">{t('public.terms.title')}</Link> · <Link className="underline" to="/privacy">{t('public.privacy.title')}</Link></p>
      </form>
    </AuthShell>
  );
}

export function ForgotPasswordPage() {
  const { t } = useTranslation();
  const [sent, setSent] = useState(false);
  const form = useForm<{ email: string }>({ resolver: zodResolver(z.object({ email: z.email() })) });
  const onSubmit = form.handleSubmit(async ({ email }) => {
    await supabase.auth.resetPasswordForEmail(email, { redirectTo: `${env.publicAppUrl}/auth/callback?next=/reset-password` });
    setSent(true); // Same response whether or not the account exists.
  });
  return (
    <AuthShell title={t('auth.forgotTitle')} subtitle={t('auth.forgotSubtitle')}>
      {sent ? (
        <p className="text-center text-sm text-muted-foreground">{t('auth.resetSent')}</p>
      ) : (
        <form onSubmit={onSubmit} className="grid gap-4" noValidate>
          <Field label={t('forms.email')} error={form.formState.errors.email && t('validation.email')}><Input type="email" dir="ltr" {...form.register('email')} /></Field>
          <Button type="submit" loading={form.formState.isSubmitting}>{t('auth.sendReset')}</Button>
        </form>
      )}
    </AuthShell>
  );
}

export function ResetPasswordPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const form = useForm<{ password: string }>({ resolver: zodResolver(z.object({ password: z.string().min(8).max(72) })) });
  const onSubmit = form.handleSubmit(async ({ password }) => {
    const { error: e } = await supabase.auth.updateUser({ password });
    if (e) setError(e.message);
    else navigate('/app', { replace: true });
  });
  return (
    <AuthShell title={t('auth.newPasswordTitle')}>
      <form onSubmit={onSubmit} className="grid gap-4" noValidate>
        <Field label={t('auth.password')} error={form.formState.errors.password && t('validation.password')}><Input type="password" dir="ltr" autoComplete="new-password" {...form.register('password')} /></Field>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <Button type="submit" loading={form.formState.isSubmitting}>{t('common.save')}</Button>
      </form>
    </AuthShell>
  );
}

/** Handles Supabase PKCE redirects (email confirmation, password recovery). */
export function AuthCallbackPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const code = params.get('code');
    const next = params.get('next')?.startsWith('/') ? params.get('next')! : '/app';
    if (!code) {
      navigate(next, { replace: true });
      return;
    }
    void supabase.auth.exchangeCodeForSession(code).then(({ error }) => (error ? setFailed(true) : navigate(next, { replace: true })));
  }, [params, navigate]);
  return failed ? <AuthShell title={t('auth.linkInvalid')}><Button asChild className="w-full"><Link to="/login">{t('auth.signIn')}</Link></Button></AuthShell> : <FullPageLoader />;
}

export function AcceptInvitePage() {
  const { token } = useParams();
  const { t } = useTranslation();
  const { session, loading } = useSession();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const msg = useErrorMessage();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (loading) return <FullPageLoader />;
  if (!session) return <Navigate to={`/login?next=${encodeURIComponent(`/invite/${token}`)}`} replace />;
  const accept = async () => {
    setBusy(true);
    try {
      const res = await api<{ organization_id: string }>('/invitations/accept', { method: 'POST', body: { token }, org: false });
      orgStore.set(res.organization_id);
      await qc.invalidateQueries();
      navigate('/app', { replace: true });
    } catch (e) {
      setError(msg(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <AuthShell title={t('invite.title')} subtitle={t('invite.subtitle')}>
      <div className="grid gap-4">
        {error && <p className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}
        <Button onClick={() => void accept()} loading={busy}>{t('invite.accept')}</Button>
      </div>
    </AuthShell>
  );
}

type CompanyForm = z.input<typeof companyApplicationSchema>;

export function OnboardingPage() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const msg = useErrorMessage();
  const [error, setError] = useState<unknown>(null);
  const [logo, setLogo] = useState<{ name: string; data: string; preview: string } | null>(null);
  const [logoError, setLogoError] = useState<string | null>(null);
  const form = useForm<CompanyForm, unknown, z.output<typeof companyApplicationSchema>>({
    resolver: zodResolver(companyApplicationSchema),
    defaultValues: { industry: 'technology', company_size: '11-50', website: '', note: '' },
  });
  const e = (k: keyof CompanyForm) => {
    const m = form.formState.errors[k]?.message;
    if (!m) return undefined;
    return t(m === 'invalid_saudi_cr' ? 'validation.cr' : m === 'invalid_saudi_phone' ? 'validation.phone' : 'validation.invalid');
  };
  const pickLogo = async (file: File | undefined) => {
    setLogoError(null);
    if (!file) return;
    try {
      const data = await readLogoFile(file);
      setLogo({ name: file.name, data, preview: URL.createObjectURL(file) });
    } catch (err) {
      setLogo(null);
      setLogoError(msg(err));
    }
  };
  const onSubmit = form.handleSubmit(async (values) => {
    setError(null);
    try {
      const org = await api<{ id: string }>('/organizations', { method: 'POST', body: values, org: false });
      orgStore.set(org.id);
      // Optional logo — uploaded after the organization exists (failure here doesn't block registration).
      if (logo) await api('/org/logo', { method: 'PUT', body: { data_base64: logo.data } }).catch(() => undefined);
      await qc.invalidateQueries();
      navigate('/app/settings/billing?welcome=1', { replace: true });
    } catch (err) {
      setError(err);
    }
  });
  return (
    <AuthShell title={t('onboarding.title')} subtitle={t('onboarding.subtitle')}>
      <form onSubmit={onSubmit} className="grid gap-4" noValidate>
        <p className="rounded-lg border border-primary/20 bg-primary/5 p-3 text-xs leading-relaxed">{t('onboarding.companyDataNotice')}</p>
        <Field label={t('forms.companyLegalName')} error={e('company_name')}><Input {...form.register('company_name')} /></Field>
        <Field label={t('forms.cr')} error={e('commercial_registration')} hint={t('forms.crHint')}><Input inputMode="numeric" dir="ltr" {...form.register('commercial_registration')} /></Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t('forms.companyEmail')} error={e('company_email')} hint={t('forms.companyEmailHint')}><Input type="email" dir="ltr" placeholder="info@company.sa" {...form.register('company_email')} /></Field>
          <Field label={t('forms.companyPhone')} error={e('company_phone')} hint={t('forms.companyPhoneHint')}><Input type="tel" dir="ltr" placeholder="+966 11 xxx xxxx" {...form.register('company_phone')} /></Field>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t('forms.industry')}><NativeSelect {...form.register('industry')}>{INDUSTRIES.map((s) => <option key={s} value={s}>{t(`industries.${s}`)}</option>)}</NativeSelect></Field>
          <Field label={t('forms.companySize')}><NativeSelect {...form.register('company_size')}>{COMPANY_SIZES.map((s) => <option key={s} value={s}>{s}</option>)}</NativeSelect></Field>
        </div>
        <Field label={`${t('forms.website')} (${t('common.optional')})`} error={e('website')}><Input dir="ltr" placeholder="https://" {...form.register('website')} /></Field>
        <Field label={`${t('forms.companyLogo')} (${t('common.optional')})`} error={logoError ?? undefined} hint={t('forms.logoHint')}>
          <div className="flex items-center gap-3">
            {logo && <img src={logo.preview} alt="" className="size-12 rounded-lg bg-white object-contain p-1 ring-1 ring-border" />}
            <Input type="file" accept="image/png" onChange={(ev) => void pickLogo(ev.target.files?.[0])} />
          </div>
        </Field>
        <Field label={t('forms.applicantRole')} error={e('applicant_role')} hint={t('forms.applicantRoleHint')}><Input {...form.register('applicant_role')} /></Field>
        <Field label={`${t('forms.note')} (${t('common.optional')})`}><Textarea rows={3} {...form.register('note')} /></Field>
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
        <Button type="submit" variant="brand" loading={form.formState.isSubmitting}>{t('onboarding.submit')}</Button>
      </form>
    </AuthShell>
  );
}
