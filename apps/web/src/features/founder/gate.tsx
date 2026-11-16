import { Button, EmptyState, Field, Input } from '@nexus/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { KeyRound, ShieldCheck, ShieldQuestion } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import { Link, Navigate, useNavigate } from 'react-router';
import { FullPageLoader } from '@/components/guards';
import { LanguageToggle, Logo, ThemeToggle } from '@/components/common';
import { ApiError } from '@/lib/api';
import { supabase } from '@/lib/supabase';
import { useSession } from '@/providers/session';
import { fget, fsend } from './lib';

export interface FounderSession { email: string | null; aal: string; must_change_password: boolean; display_name: string | null; last_login_at: string | null; password_changed_at: string | null }

function Shell({ title, subtitle, icon, children }: { title: string; subtitle?: string; icon?: ReactNode; children: ReactNode }) {
  const { t } = useTranslation();
  return (
    <div className="flex min-h-dvh flex-col bg-background">
      <header className="flex items-center justify-between px-4 py-3 sm:px-6"><Logo /><div className="flex gap-1"><LanguageToggle compact /><ThemeToggle /></div></header>
      <main className="flex flex-1 items-center justify-center px-4 pb-16">
        <div className="w-full max-w-sm rounded-2xl border bg-card p-6 shadow-sm">
          <div className="mb-5 flex flex-col items-center gap-2 text-center">
            <span className="flex size-11 items-center justify-center rounded-xl bg-primary/10 text-primary [&_svg]:size-5">{icon ?? <ShieldCheck />}</span>
            <h1 className="text-lg font-semibold">{title}</h1>
            {subtitle && <p className="text-sm text-muted-foreground">{subtitle}</p>}
            <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{t('founder.portal')}</p>
          </div>
          {children}
        </div>
      </main>
    </div>
  );
}

export function FounderLoginPage() {
  const { t } = useTranslation();
  const { session } = useSession();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (session) return <Navigate to="/founder" replace />;
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { error: err } = await supabase.auth.signInWithPassword({ email, password });
    setBusy(false);
    if (err) setError(t('founder.auth.invalid'));
    else navigate('/founder', { replace: true });
  };
  return (
    <Shell title={t('founder.auth.title')} subtitle={t('founder.auth.subtitle')}>
      <form className="grid gap-4" onSubmit={submit}>
        <Field label={t('founder.auth.email')} htmlFor="f-email"><Input id="f-email" type="email" dir="ltr" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
        <Field label={t('founder.auth.password')} htmlFor="f-pass"><Input id="f-pass" type="password" dir="ltr" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} /></Field>
        <div className="-mt-2 text-end"><Link to="/forgot-password" className="text-xs text-primary">{t('founder.auth.forgot')}</Link></div>
        {error && <p className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}
        <Button type="submit" loading={busy}>{t('founder.auth.signIn')}</Button>
      </form>
    </Shell>
  );
}

function CodeForm({ onSubmit, busy, error }: { onSubmit: (code: string) => void; busy: boolean; error: string | null }) {
  const { t } = useTranslation();
  const [code, setCode] = useState('');
  return (
    <form className="grid gap-3" onSubmit={(e) => { e.preventDefault(); onSubmit(code); }}>
      <Field label={t('founder.auth.code')} htmlFor="f-code"><Input id="f-code" inputMode="numeric" autoComplete="one-time-code" dir="ltr" className="text-center text-lg tracking-[0.4em]" maxLength={6} pattern="\d{6}" required autoFocus value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))} /></Field>
      {error && <p className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}
      <Button type="submit" loading={busy} disabled={code.length !== 6}>{t('founder.auth.verify')}</Button>
    </form>
  );
}

type MfaSetup = { mode: 'verify'; factorId: string } | { mode: 'enroll'; factorId: string; qr: string; secret: string } | { error: string };
let pendingSetup: Promise<MfaSetup> | null = null;

/** Finds the verified authenticator, or starts ONE enrollment (shared, so a double effect run can't race). */
function mfaSetup(): Promise<MfaSetup> {
  pendingSetup ??= (async (): Promise<MfaSetup> => {
    const { data } = await supabase.auth.mfa.listFactors();
    const verified = data?.totp.find((f) => f.status === 'verified');
    if (verified) return { mode: 'verify', factorId: verified.id };
    // Remove half-finished enrollments, then start a fresh one.
    for (const f of data?.all ?? []) if (f.status !== 'verified') await supabase.auth.mfa.unenroll({ factorId: f.id });
    const { data: en, error } = await supabase.auth.mfa.enroll({ factorType: 'totp', friendlyName: `NEXUS Founder ${new Date().toISOString().slice(0, 19)}` });
    if (error || !en) return { error: error?.message ?? 'mfa_enroll_failed' };
    return { mode: 'enroll', factorId: en.id, qr: en.totp.qr_code, secret: en.totp.secret };
  })().finally(() => setTimeout(() => (pendingSetup = null), 0));
  return pendingSetup;
}

/** Two-step verification (TOTP): enrolls on first use, then asks for a code on every sign-in. */
function MfaStep({ onDone }: { onDone: () => void }) {
  const { t } = useTranslation();
  const [state, setState] = useState<{ mode: 'loading' } | { mode: 'verify'; factorId: string } | { mode: 'enroll'; factorId: string; qr: string; secret: string }>({ mode: 'loading' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void mfaSetup().then((r) => {
      if (cancelled) return;
      if ('error' in r) setError(r.error);
      else setState(r);
    });
    return () => { cancelled = true; };
  }, []);

  const verify = async (code: string) => {
    if (state.mode === 'loading') return;
    setBusy(true);
    setError(null);
    const { error: err } = await supabase.auth.mfa.challengeAndVerify({ factorId: state.factorId, code });
    setBusy(false);
    if (err) setError(t('founder.auth.badCode'));
    else onDone();
  };

  if (state.mode === 'loading') return <Shell title={t('founder.auth.mfaVerifyTitle')} icon={<ShieldQuestion />}>{error ? <p className="text-sm text-destructive">{error}</p> : <div className="h-24 animate-pulse rounded-lg bg-muted" />}</Shell>;
  if (state.mode === 'enroll') {
    return (
      <Shell title={t('founder.auth.mfaEnrollTitle')} subtitle={t('founder.auth.mfaEnrollBody')} icon={<ShieldQuestion />}>
        <div className="mb-4 flex flex-col items-center gap-2">
          <img src={state.qr} alt="" className="size-44 rounded-lg bg-white p-2" />
          <p className="text-xs text-muted-foreground">{t('founder.auth.mfaSecret')}</p>
          <code className="select-all break-all rounded bg-muted px-2 py-1 text-center font-mono text-xs" dir="ltr">{state.secret}</code>
        </div>
        <CodeForm onSubmit={(c) => void verify(c)} busy={busy} error={error} />
      </Shell>
    );
  }
  return <Shell title={t('founder.auth.mfaVerifyTitle')} subtitle={t('founder.auth.mfaVerifyBody')} icon={<ShieldQuestion />}><CodeForm onSubmit={(c) => void verify(c)} busy={busy} error={error} /></Shell>;
}

export function PasswordForm({ onDone }: { onDone: () => void }) {
  const { t } = useTranslation();
  const [cur, setCur] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (next !== confirm) return setError(t('founder.auth.mismatch'));
    if (next.length < 12 || !/\p{L}/u.test(next) || !/\d/.test(next)) return setError(t('founder.auth.weak'));
    setBusy(true);
    try {
      await fsend('POST', '/founder/password', { current_password: cur, new_password: next });
      // Changing the password ends every session; sign in again with the new password.
      toast.success(t('founder.auth.changedSignIn'));
      await supabase.auth.signOut({ scope: 'local' });
      onDone();
    } catch (err) {
      setError(err instanceof ApiError && err.code === 'current_password_invalid' ? t('founder.auth.wrongCurrent') : err instanceof ApiError && err.code === 'validation_failed' ? t('founder.auth.weak') : t('errors.generic', { code: err instanceof ApiError ? err.code : 'unknown' }));
    } finally {
      setBusy(false);
    }
  };
  return (
    <form className="grid gap-3" onSubmit={submit}>
      <Field label={t('founder.auth.current')} htmlFor="p-cur"><Input id="p-cur" type="password" dir="ltr" autoComplete="current-password" required value={cur} onChange={(e) => setCur(e.target.value)} /></Field>
      <Field label={t('founder.auth.new')} htmlFor="p-new" hint={t('founder.auth.weak')}><Input id="p-new" type="password" dir="ltr" autoComplete="new-password" required value={next} onChange={(e) => setNext(e.target.value)} /></Field>
      <Field label={t('founder.auth.confirm')} htmlFor="p-conf"><Input id="p-conf" type="password" dir="ltr" autoComplete="new-password" required value={confirm} onChange={(e) => setConfirm(e.target.value)} /></Field>
      {error && <p className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}
      <Button type="submit" loading={busy}>{t('founder.auth.change')}</Button>
    </form>
  );
}

/** Server-enforced gates, mirrored in the UI: founder account → two-step code → initial password replaced. */
export function FounderGate({ children }: { children: (s: FounderSession) => ReactNode }) {
  const { t } = useTranslation();
  const { session, loading } = useSession();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['founder-session', session?.access_token], queryFn: () => fget<FounderSession>('/founder/session'), enabled: Boolean(session), retry: false, staleTime: 30_000 });
  if (loading) return <FullPageLoader />;
  if (!session) return <Navigate to="/founder/login" replace />;
  if (q.isLoading) return <FullPageLoader />;
  if (q.error) {
    return (
      <Shell title={t('founder.auth.notFounder')} icon={<KeyRound />}>
        <Button className="w-full" variant="outline" onClick={() => void supabase.auth.signOut()}>{t('founder.auth.signOut')}</Button>
      </Shell>
    );
  }
  const s = q.data!;
  const refresh = () => void qc.invalidateQueries({ queryKey: ['founder-session'] });
  if (s.aal !== 'aal2') return <MfaStep onDone={refresh} />;
  if (s.must_change_password) {
    return <Shell title={t('founder.auth.changeTitle')} subtitle={t('founder.auth.changeBody')} icon={<KeyRound />}><PasswordForm onDone={refresh} /></Shell>;
  }
  return <>{children(s)}</>;
}

export function NotFounderNotice() {
  const { t } = useTranslation();
  return <EmptyState className="m-8" icon={<KeyRound />} title={t('founder.auth.notFounder')} />;
}
