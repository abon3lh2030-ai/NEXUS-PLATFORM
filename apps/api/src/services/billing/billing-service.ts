import type { FastifyBaseLogger } from 'fastify';
import { isMoyasarConfigured, type Env } from '../../config/env.js';
import type { OrgActor } from '../../context.js';
import { AppError, badRequest, conflict, forbidden, notFound, serviceUnavailable } from '../../lib/errors.js';
import type { Db } from '../../lib/supabase.js';
import type { OrganizationRow, SubscriptionRow } from '../../types/db.js';
import type { AuditService } from '../audit.js';
import { subscriptionNoticeEmail } from '../email/templates.js';
import type { EmailService } from '../email/provider.js';
import type { EntitlementService } from '../entitlements.js';
import type { NotificationService } from '../notifications.js';
import { MoyasarClient, safeEqual, safePaymentMetadata, type MoyasarPayment } from './moyasar.js';

interface TransactionRow {
  id: string;
  organization_id: string;
  user_id: string;
  plan_code: string;
  enterprise_offer_id: string | null;
  amount_halalas: number;
  currency: string;
  status: 'initiated' | 'paid' | 'failed' | 'refunded';
  provider_payment_id: string | null;
}

export interface CheckoutSession {
  transaction_id: string;
  amount: number;
  currency: 'SAR';
  description: string;
  publishable_api_key: string;
  callback_url: string;
  methods: Array<'creditcard' | 'applepay'>;
  apple_pay: { enabled: boolean; label: string; country: 'SA' };
}

export class BillingService {
  private readonly moyasar: MoyasarClient | null;

  constructor(
    private readonly env: Env,
    private readonly db: Db,
    private readonly entitlements: EntitlementService,
    private readonly notifications: NotificationService,
    private readonly email: EmailService,
    private readonly audit: AuditService,
    private readonly log: FastifyBaseLogger,
  ) {
    this.moyasar = isMoyasarConfigured(env) ? new MoyasarClient(env.MOYASAR_SECRET_KEY!, env.MOYASAR_API_BASE) : null;
  }

  private requireMoyasar(): MoyasarClient {
    if (!this.moyasar) throw serviceUnavailable('payments_not_configured');
    return this.moyasar;
  }

  private checkoutFor(tx: TransactionRow, description: string): CheckoutSession {
    return {
      transaction_id: tx.id,
      amount: tx.amount_halalas, // trusted server value
      currency: 'SAR',
      description,
      publishable_api_key: this.env.MOYASAR_PUBLISHABLE_KEY!,
      callback_url: `${this.env.PUBLIC_APP_URL}/app/billing/callback?tx=${tx.id}`,
      methods: this.env.MOYASAR_APPLE_PAY_ENABLED ? ['applepay', 'creditcard'] : ['creditcard'],
      apple_pay: { enabled: this.env.MOYASAR_APPLE_PAY_ENABLED, label: 'NEXUS', country: 'SA' },
    };
  }

  async createPlanCheckout(actor: OrgActor, planCode: 'starter' | 'pro' | 'business'): Promise<CheckoutSession> {
    this.requireMoyasar();
    if (!actor.permissions.has('billing.manage')) throw forbidden('billing_owner_only');
    if (actor.orgStatus !== 'active') throw conflict('organization_not_active');
    const plan = await this.entitlements.getPlan(planCode);
    if (!plan || plan.is_custom || !plan.is_public || !plan.price_halalas) throw badRequest('invalid_plan');

    const tx = await this.insertTransaction(actor, plan.code, plan.price_halalas, null);
    return this.checkoutFor(tx, `NEXUS ${plan.name_en} — annual subscription`);
  }

  async createOfferCheckout(actor: OrgActor, offerId: string): Promise<CheckoutSession> {
    this.requireMoyasar();
    if (!actor.permissions.has('billing.manage')) throw forbidden('billing_owner_only');
    const { data: offer } = await this.db
      .from('enterprise_offers')
      .select('id, price_halalas, status, expires_at, request_id, enterprise_requests!inner(user_id, work_email)')
      .eq('id', offerId)
      .maybeSingle<{ id: string; price_halalas: number; status: string; expires_at: string; enterprise_requests: { user_id: string | null; work_email: string } }>();
    if (!offer) throw notFound('offer_not_found');
    const req = offer.enterprise_requests;
    const owns = req.user_id === actor.userId || (actor.email && req.work_email.toLowerCase() === actor.email.toLowerCase());
    if (!owns) throw notFound('offer_not_found');
    if (offer.status !== 'offered') throw conflict('offer_not_available');
    if (new Date(offer.expires_at) < new Date()) throw conflict('offer_expired');
    const tx = await this.insertTransaction(actor, 'enterprise', offer.price_halalas, offer.id);
    return this.checkoutFor(tx, 'NEXUS Enterprise — custom annual subscription');
  }

  private async insertTransaction(actor: OrgActor, planCode: string, amount: number, offerId: string | null): Promise<TransactionRow> {
    const { data, error } = await this.db
      .from('payment_transactions')
      .insert({ organization_id: actor.orgId, user_id: actor.userId, plan_code: planCode, enterprise_offer_id: offerId, amount_halalas: amount })
      .select('*')
      .single<TransactionRow>();
    if (error || !data) throw new AppError(500, 'transaction_create_failed', error?.message);
    await this.audit.audit({ organizationId: actor.orgId, actorType: 'human', actorUserId: actor.userId, action: 'billing.checkout_created', targetType: 'payment_transaction', targetId: data.id, metadata: { plan_code: planCode, amount } });
    return data;
  }

  /**
   * Verifies a payment with Moyasar (server-to-server) and activates immediately.
   * Checks: payment exists, belongs to this transaction (metadata), status paid, exact amount & currency.
   */
  async verifyAndActivate(transactionId: string, paymentId: string, source: 'callback' | 'webhook', actorUserId?: string): Promise<{ status: 'paid' | 'failed' | 'pending'; subscription?: SubscriptionRow }> {
    const moyasar = this.requireMoyasar();
    const { data: tx } = await this.db.from('payment_transactions').select('*').eq('id', transactionId).maybeSingle<TransactionRow>();
    if (!tx) throw notFound('transaction_not_found');
    if (actorUserId && tx.user_id !== actorUserId) throw notFound('transaction_not_found');
    if (tx.status === 'paid') {
      if (tx.provider_payment_id !== paymentId) throw conflict('transaction_already_paid');
      const { data: sub } = await this.db.from('subscriptions').select('*').eq('organization_id', tx.organization_id).single<SubscriptionRow>();
      return { status: 'paid', ...(sub ? { subscription: sub } : {}) };
    }

    const payment: MoyasarPayment = await moyasar.getPayment(paymentId);
    const metaTx = payment.metadata?.['transaction_id'];
    if (metaTx !== tx.id) throw badRequest('payment_transaction_mismatch');
    if (payment.amount !== tx.amount_halalas || payment.currency.toUpperCase() !== tx.currency) throw badRequest('amount_mismatch');

    if (payment.status !== 'paid' && payment.status !== 'captured') {
      if (payment.status === 'failed') {
        await this.db.from('payment_transactions').update({ status: 'failed', provider_payment_id: payment.id, failure_reason: payment.source?.message?.slice(0, 300) ?? 'failed', provider_metadata: safePaymentMetadata(payment) }).eq('id', tx.id).eq('status', 'initiated');
        await this.notifications.notify({ organizationId: tx.organization_id, userIds: [tx.user_id], type: 'payment_failure', title: 'Payment failed', body: payment.source?.message ?? '', link: '/app/settings/billing' });
        return { status: 'failed' };
      }
      return { status: 'pending' };
    }

    const { data: sub, error } = await this.db.rpc('activate_paid_transaction', {
      p_transaction_id: tx.id,
      p_provider_payment_id: payment.id,
      p_amount_halalas: payment.amount,
      p_currency: payment.currency,
      p_method: payment.source?.type ?? 'unknown',
      p_metadata: safePaymentMetadata(payment),
    });
    if (error) {
      this.log.error({ err: error.message, tx: tx.id }, 'activation_failed');
      throw new AppError(409, 'activation_failed', error.message);
    }
    const subscription = sub as SubscriptionRow;
    await this.audit.audit({ organizationId: tx.organization_id, actorType: source === 'webhook' ? 'system' : 'human', actorUserId: actorUserId ?? null, action: 'billing.payment_verified', targetType: 'payment_transaction', targetId: tx.id, metadata: { source, plan_code: tx.plan_code, ends_at: subscription.ends_at } });
    await this.notifications.notify({ organizationId: tx.organization_id, userIds: [tx.user_id], type: 'payment_success', title: 'Payment successful — subscription active', link: '/app/settings/billing' });
    return { status: 'paid', subscription };
  }

  /** Moyasar webhook: authenticate by shared secret, then re-verify against the API (never trust the body). */
  async handleWebhook(body: unknown): Promise<void> {
    if (!this.env.MOYASAR_WEBHOOK_SECRET) throw serviceUnavailable('webhook_not_configured');
    const payload = body as { secret_token?: string; type?: string; data?: { id?: string; metadata?: Record<string, unknown> } };
    if (!payload.secret_token || !safeEqual(payload.secret_token, this.env.MOYASAR_WEBHOOK_SECRET)) throw forbidden('invalid_webhook_secret');
    const paymentId = payload.data?.id;
    const txId = payload.data?.metadata?.['transaction_id'];
    if (!paymentId || typeof txId !== 'string') return;
    await this.verifyAndActivate(txId, paymentId, 'webhook');
  }

  async overview(actor: OrgActor) {
    const [usage, plans, { data: transactions }] = await Promise.all([
      this.entitlements.getUsage(actor.orgId, actor.billing),
      this.entitlements.listPlans(),
      actor.permissions.has('billing.view')
        ? this.db.from('payment_transactions').select('id, plan_code, amount_halalas, currency, status, payment_method, provider_metadata, paid_at, created_at').eq('organization_id', actor.orgId).order('created_at', { ascending: false }).limit(50)
        : Promise.resolve({ data: [] }),
    ]);
    return {
      subscription: actor.billing.subscription,
      plan: actor.billing.plan,
      active: actor.billing.active,
      entitlements: actor.billing.entitlements,
      usage,
      plans: plans.filter((p) => p.is_public),
      transactions: transactions ?? [],
      payments_enabled: Boolean(this.moyasar),
      apple_pay_enabled: this.env.MOYASAR_APPLE_PAY_ENABLED,
    };
  }

  /** Cron: mark expired subscriptions (access is already blocked by timestamp) and send notices. */
  async runExpiryJob(): Promise<void> {
    const { data: expired } = await this.db.rpc('expire_subscriptions');
    for (const sub of (expired ?? []) as SubscriptionRow[]) {
      await this.noticeOwner(sub, 'expired');
      await this.db.from('subscriptions').update({ expired_notified_at: new Date().toISOString() }).eq('id', sub.id);
    }
    const soon = new Date(Date.now() + 14 * 24 * 3600 * 1000).toISOString();
    const { data: expiring } = await this.db.from('subscriptions').select('*').eq('status', 'active').lte('ends_at', soon).gt('ends_at', new Date().toISOString()).is('expiring_notified_at', null);
    for (const sub of (expiring ?? []) as SubscriptionRow[]) {
      await this.noticeOwner(sub, 'expiring');
      await this.db.from('subscriptions').update({ expiring_notified_at: new Date().toISOString() }).eq('id', sub.id);
    }
  }

  private async noticeOwner(sub: SubscriptionRow, kind: 'expiring' | 'expired') {
    const { data: org } = await this.db.from('organizations').select('*').eq('id', sub.organization_id).single<OrganizationRow>();
    if (!org) return;
    await this.notifications.notify({
      organizationId: org.id,
      userIds: [org.owner_user_id],
      type: kind === 'expired' ? 'subscription_expired' : 'subscription_expiring',
      title: kind === 'expired' ? 'Subscription expired' : 'Subscription expiring soon',
      link: '/app/settings/billing',
    });
    const { data: owner } = await this.db.from('profiles').select('email').eq('id', org.owner_user_id).single<{ email: string | null }>();
    if (owner?.email) {
      await this.email.send(subscriptionNoticeEmail(owner.email, kind, org.name, sub.ends_at ?? '', `${this.env.PUBLIC_APP_URL}/app/settings/billing`));
    }
  }
}
