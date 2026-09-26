import { Badge, Button, Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, EmptyState, PageHeader, Progress, Section, Spinner } from '@nexus/ui';
import type { Entitlements, PublicPlan, UsageSnapshot } from '@nexus/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle2, CreditCard, ShieldCheck, XCircle } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import 'moyasar-payment-form/dist/moyasar.css';
import { ErrorNotice, KeyValue, LoadingBlock, StatusBadge, useErrorMessage } from '@/components/common';
import { PlanCards } from '@/pages/public/marketing';
import { api, apiPost } from '@/lib/api';
import { formatBytes, formatDate, formatDateTime, formatNumber, formatSar } from '@/lib/format';
import { useSession } from '@/providers/session';

interface Overview {
  subscription: { plan_code: string; status: string; started_at: string | null; ends_at: string | null } | null;
  plan: PublicPlan | null;
  active: boolean;
  entitlements: Entitlements;
  usage: UsageSnapshot;
  plans: PublicPlan[];
  transactions: Array<{ id: string; plan_code: string; amount_halalas: number; status: string; payment_method: string | null; provider_metadata: { masked_number?: string | null; company?: string | null }; paid_at: string | null; created_at: string }>;
  payments_enabled: boolean;
  apple_pay_enabled: boolean;
}

interface Checkout {
  transaction_id: string;
  amount: number;
  currency: 'SAR';
  description: string;
  publishable_api_key: string;
  callback_url: string;
  methods: Array<'creditcard' | 'applepay'>;
  apple_pay: { enabled: boolean; label: string; country: 'SA' };
}

/**
 * Moyasar hosted payment form. Card data is entered into Moyasar's form and sent directly to
 * Moyasar — it never touches NEXUS servers. The amount comes from the server (trusted).
 */
function MoyasarForm({ checkout }: { checkout: Checkout }) {
  const { i18n } = useTranslation();
  const ref = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    void import('moyasar-payment-form')
      .then(({ default: Moyasar }) => {
        if (cancelled || !ref.current) return;
        ref.current.innerHTML = '';
        const config = {
          element: ref.current,
          amount: checkout.amount,
          currency: checkout.currency,
          description: checkout.description,
          publishable_api_key: checkout.publishable_api_key,
          callback_url: checkout.callback_url,
          methods: checkout.methods,
          supported_networks: ['mada', 'visa', 'mastercard'],
          language: i18n.language === 'ar' ? 'ar' : 'en',
          metadata: { transaction_id: checkout.transaction_id },
          ...(checkout.apple_pay.enabled
            ? { apple_pay: { country: checkout.apple_pay.country, label: checkout.apple_pay.label, validate_merchant_url: 'https://api.moyasar.com/v1/applepay/initiate' } }
            : {}),
        };
        Moyasar.init(config as never);
      })
      .catch(() => setError('payment_form_failed'));
    return () => {
      cancelled = true;
    };
  }, [checkout, i18n.language]);
  return (
    <>
      <div ref={ref} className="mysr-form" />
      {error && <p className="text-sm text-destructive">{error}</p>}
    </>
  );
}

function UsageRow({ label, used, limit, bytes, sar, hint }: { label: string; used: number; limit: number | null; bytes?: boolean; sar?: boolean; hint?: string }) {
  const { t } = useTranslation();
  const f = (n: number) => (bytes ? formatBytes(n) : sar ? formatSar(n) : formatNumber(n));
  const pct = limit ? Math.min(100, (used / limit) * 100) : 0;
  return (
    <div className="py-2">
      <div className="flex justify-between text-sm"><span>{label}</span><span className="tabular-nums text-muted-foreground">{f(used)} / {limit === null ? t('pricing.unlimited') : f(limit)}</span></div>
      {limit !== null && <Progress value={pct} className="mt-1.5" indicatorClassName={pct >= 90 ? 'bg-destructive' : undefined} />}
      {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

export function BillingPage() {
  const { t } = useTranslation();
  const { can } = useSession();
  const [params] = useSearchParams();
  const { data, isLoading } = useQuery({ queryKey: ['billing'], queryFn: () => api<Overview>('/billing') });
  const offers = useQuery({ queryKey: ['my-enterprise'], queryFn: () => api<Array<{ id: string; company_name: string; status: string; enterprise_offers: Array<{ id: string; price_halalas: number; status: string; expires_at: string }> }>>('/me/enterprise-requests', { org: false }) });
  const [checkout, setCheckout] = useState<Checkout | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);

  const start = async (code: string) => {
    setBusy(code);
    setError(null);
    try {
      setCheckout(await apiPost<Checkout>('/billing/checkout', { plan_code: code }));
    } catch (e) {
      setError(e);
    } finally {
      setBusy(null);
    }
  };

  if (isLoading || !data) return <LoadingBlock />;
  const e = data.entitlements;
  const pendingOffers = (offers.data ?? []).flatMap((r) => r.enterprise_offers.filter((o) => o.status === 'offered'));

  return (
    <>
      <PageHeader title={t('settings.billing')} description={t('billing.description')} icon={<CreditCard />} />
      {params.get('welcome') === '1' && (
        <div className="mb-6 rounded-xl border border-primary/30 bg-primary/5 p-4 text-sm"><p className="font-medium">{t('billing.welcomeTitle')}</p><p className="mt-1 text-muted-foreground">{t('billing.welcomeBody')}</p></div>
      )}
      <div className="grid gap-6 lg:grid-cols-3">
        <Section title={t('billing.current')}>
          {data.subscription ? (
            <div className="grid gap-1">
              <div className="flex items-center gap-2"><p className="text-lg font-semibold">{t(`plans.${data.subscription.plan_code}`)}</p><StatusBadge value={data.active ? 'active' : 'expired'} /></div>
              <KeyValue label={t('billing.startedAt')}>{formatDate(data.subscription.started_at)}</KeyValue>
              <KeyValue label={t('billing.endsAt')}>{formatDate(data.subscription.ends_at)}</KeyValue>
              <KeyValue label={t('billing.interval')}>{t('billing.yearly')}</KeyValue>
              {!data.active && <p className="mt-2 flex items-start gap-2 rounded-lg bg-destructive/10 p-3 text-sm text-destructive"><AlertTriangle className="mt-0.5 size-4 shrink-0" /> {t('billing.lockedDescription')}</p>}
              {data.active && <p className="mt-2 text-xs text-muted-foreground">{t('billing.renewNote')}</p>}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">{t('billing.noSubscriptionTitle')}</p>
          )}
        </Section>
        <Section className="lg:col-span-2" title={t('billing.usage')}>
          {data.active ? (
            <div className="grid gap-x-8 sm:grid-cols-2">
              <UsageRow label={t('pricing.humans')} used={data.usage.human_members} limit={e.human_members} />
              <UsageRow label={t('pricing.aiEmployees')} used={data.usage.ai_employees} limit={e.ai_employees} />
              <UsageRow label={t('pricing.executions')} used={data.usage.ai_executions_per_year} limit={e.ai_executions_per_year} />
              <UsageRow label={t('pricing.projects')} used={data.usage.active_projects} limit={e.active_projects} />
              <UsageRow label={t('pricing.storage')} used={data.usage.storage_bytes} limit={e.storage_bytes} bytes />
              <UsageRow label={t('billing.computerMinutes')} used={data.usage.computer_minutes_per_year} limit={e.computer_minutes_per_year} />
              <div className="sm:col-span-2"><UsageRow label={t('billing.aiBudget')} used={data.usage.ai_budget_halalas_per_year} limit={e.ai_budget_halalas_per_year} sar hint={t('billing.aiBudgetHint')} /></div>
            </div>
          ) : <p className="text-sm text-muted-foreground">{t('billing.usageAfterSubscribe')}</p>}
        </Section>
      </div>

      {pendingOffers.length > 0 && (
        <Section className="mt-6" title={t('billing.enterpriseOffers')}>
          {pendingOffers.map((o) => (
            <div key={o.id} className="flex flex-wrap items-center gap-3 rounded-lg border p-3">
              <Badge tone="primary">{t('plans.enterprise')}</Badge>
              <span className="font-semibold">{formatSar(o.price_halalas)} / {t('pricing.year')}</span>
              <span className="text-xs text-muted-foreground">{t('billing.offerExpires', { date: formatDate(o.expires_at) })}</span>
              <Button asChild size="sm" className="ms-auto"><Link to={`/app/billing/offers/${o.id}`}>{t('billing.viewOffer')}</Link></Button>
            </div>
          ))}
        </Section>
      )}

      <div className="mt-8">
        <h2 className="mb-1 text-lg font-semibold">{t('billing.plans')}</h2>
        <p className="mb-4 text-sm text-muted-foreground">{t('billing.plansHint')}</p>
        {!data.payments_enabled && <p className="mb-4 flex items-center gap-2 rounded-lg border border-warning/40 bg-warning/10 p-3 text-sm text-warning"><AlertTriangle className="size-4" /> {t('billing.paymentsNotConfigured')}</p>}
        <ErrorNotice error={error} className="mb-4" />
        <PlanCards plans={data.plans} currentPlan={data.subscription?.plan_code} busyPlan={busy} onSelect={can('billing.manage') && data.payments_enabled ? (c) => void start(c) : undefined} actionLabel={t('billing.subscribe')} />
        {!can('billing.manage') && <p className="mt-3 text-sm text-muted-foreground">{t('billing.askOwner')}</p>}
      </div>

      <Section className="mt-8" title={t('billing.history')}>
        {data.transactions.length === 0 ? <p className="text-sm text-muted-foreground">{t('billing.noPayments')}</p> : (
          <table className="w-full text-sm">
            <thead className="text-xs text-muted-foreground"><tr><th className="py-2 text-start">{t('common.date')}</th><th className="text-start">{t('billing.plan')}</th><th className="text-start">{t('billing.amount')}</th><th className="text-start">{t('billing.method')}</th><th className="text-start">{t('common.status')}</th></tr></thead>
            <tbody>
              {data.transactions.map((x) => (
                <tr key={x.id} className="border-t">
                  <td className="py-2">{formatDateTime(x.paid_at ?? x.created_at)}</td>
                  <td>{t(`plans.${x.plan_code}`)}</td>
                  <td className="tabular-nums">{formatSar(x.amount_halalas)}</td>
                  <td className="text-muted-foreground">{x.payment_method ? `${x.payment_method}${x.provider_metadata.masked_number ? ` · ${x.provider_metadata.masked_number.slice(-4)}` : ''}` : '—'}</td>
                  <td><StatusBadge value={x.status === 'paid' ? 'completed' : x.status === 'initiated' ? 'pending' : x.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Section>

      <Dialog open={Boolean(checkout)} onOpenChange={(o) => !o && setCheckout(null)}>
        <DialogContent closeLabel={t('common.close')}>
          <DialogHeader>
            <DialogTitle>{t('billing.checkoutTitle')}</DialogTitle>
            <DialogDescription>{checkout?.description} — <strong>{formatSar(checkout?.amount)}</strong></DialogDescription>
          </DialogHeader>
          {checkout && <MoyasarForm checkout={checkout} />}
          <p className="flex items-center gap-2 text-xs text-muted-foreground"><ShieldCheck className="size-4" /> {t('billing.secureNote')}</p>
        </DialogContent>
      </Dialog>
    </>
  );
}

/** Moyasar redirects here (?tx=…&id=…&status=…). Activation happens only after server verification. */
export function BillingCallbackPage() {
  const { t } = useTranslation();
  const [params] = useSearchParams();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const msg = useErrorMessage();
  const [state, setState] = useState<{ status: 'verifying' | 'paid' | 'failed' | 'pending' | 'error'; error?: string }>({ status: 'verifying' });
  const tx = params.get('tx');
  const paymentId = params.get('id');

  useEffect(() => {
    if (!tx || !paymentId) {
      setState({ status: 'error', error: t('billing.missingPayment') });
      return;
    }
    void apiPost<{ status: 'paid' | 'failed' | 'pending' }>('/billing/verify', { transaction_id: tx, payment_id: paymentId })
      .then((r) => {
        setState({ status: r.status });
        if (r.status === 'paid') void qc.invalidateQueries();
      })
      .catch((e: unknown) => setState({ status: 'error', error: msg(e) }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tx, paymentId]);

  return (
    <div className="mx-auto mt-16 max-w-md text-center">
      {state.status === 'verifying' && <><Spinner className="mx-auto size-8" /><p className="mt-4 font-medium">{t('billing.verifying')}</p></>}
      {state.status === 'paid' && <><CheckCircle2 className="mx-auto size-12 text-success" /><p className="mt-4 text-lg font-semibold">{t('billing.paidTitle')}</p><p className="mt-1 text-sm text-muted-foreground">{t('billing.paidBody')}</p><Button className="mt-6" onClick={() => navigate('/app')}>{t('billing.goToApp')}</Button></>}
      {(state.status === 'failed' || state.status === 'error' || state.status === 'pending') && (
        <>
          {state.status === 'pending' ? <Spinner className="mx-auto size-8" /> : <XCircle className="mx-auto size-12 text-destructive" />}
          <p className="mt-4 text-lg font-semibold">{state.status === 'pending' ? t('billing.pendingTitle') : t('billing.failedTitle')}</p>
          <p className="mt-1 text-sm text-muted-foreground">{state.error ?? t('billing.failedBody')}</p>
          <Button asChild className="mt-6" variant="outline"><Link to="/app/settings/billing">{t('billing.backToBilling')}</Link></Button>
        </>
      )}
    </div>
  );
}

export function EnterpriseOfferPage() {
  const { id } = useParams();
  const { t } = useTranslation();
  const { can } = useSession();
  const [checkout, setCheckout] = useState<Checkout | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const { data, isLoading, error: loadError } = useQuery({ queryKey: ['offer', id], queryFn: () => api<{ id: string; price_halalas: number; status: string; expires_at: string; entitlements: Entitlements; enterprise_requests: { company_name: string } }>(`/offers/${id}`, { org: false }) });
  if (isLoading) return <LoadingBlock />;
  if (loadError || !data) return <EmptyState className="mt-10" icon={<XCircle />} title={t('errors.offer_not_found')} />;
  const pay = async () => {
    setBusy(true);
    setError(null);
    try {
      setCheckout(await apiPost<Checkout>('/billing/offer-checkout', { offer_id: data.id }));
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };
  const e = data.entitlements;
  const lim = (v: number | null) => (v === null ? t('pricing.unlimited') : formatNumber(v));
  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader title={t('billing.offerTitle')} description={data.enterprise_requests.company_name} icon={<CreditCard />} />
      <Section>
        <p className="text-lg font-semibold">{t('billing.offerApproved')}</p>
        <p className="mt-2 text-3xl font-semibold">{formatSar(data.price_halalas)} <span className="text-base font-normal text-muted-foreground">/ {t('pricing.year')}</span></p>
        <div className="mt-4 grid divide-y rounded-lg border px-4 sm:grid-cols-2 sm:divide-y-0">
          <KeyValue label={t('pricing.humans')}>{lim(e.human_members)}</KeyValue>
          <KeyValue label={t('pricing.aiEmployees')}>{lim(e.ai_employees)}</KeyValue>
          <KeyValue label={t('pricing.executions')}>{lim(e.ai_executions_per_year)}</KeyValue>
          <KeyValue label={t('pricing.storage')}>{e.storage_bytes === null ? t('pricing.unlimited') : formatBytes(e.storage_bytes)}</KeyValue>
        </div>
        <p className="mt-3 text-xs text-muted-foreground">{t('billing.offerExpires', { date: formatDate(data.expires_at) })}</p>
        <ErrorNotice error={error} className="mt-4" />
        {data.status === 'offered' ? (
          can('billing.manage') ? <Button className="mt-4" variant="brand" loading={busy} onClick={() => void pay()}>{t('billing.viewOfferAndPay')}</Button> : <p className="mt-4 text-sm text-muted-foreground">{t('billing.askOwner')}</p>
        ) : <Badge className="mt-4" tone="success">{t(`offerStatus.${data.status}`)}</Badge>}
      </Section>
      <Dialog open={Boolean(checkout)} onOpenChange={(o) => !o && setCheckout(null)}>
        <DialogContent closeLabel={t('common.close')}>
          <DialogHeader><DialogTitle>{t('billing.checkoutTitle')}</DialogTitle><DialogDescription>{formatSar(checkout?.amount)}</DialogDescription></DialogHeader>
          {checkout && <MoyasarForm checkout={checkout} />}
        </DialogContent>
      </Dialog>
    </div>
  );
}
