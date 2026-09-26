import type { ContactInput, EnterpriseRequestInput, Entitlements } from '@nexus/shared';
import type { Env } from '../config/env.js';
import type { AuthUser } from '../context.js';
import { badRequest, conflict, notFound, unwrap } from '../lib/errors.js';
import type { Db } from '../lib/supabase.js';
import type { AuditService } from './audit.js';
import type { EmailService } from './email/provider.js';
import { enterpriseApprovedEmail, enterpriseRejectedEmail, enterpriseRequestEmail } from './email/templates.js';
import type { EntitlementService } from './entitlements.js';
import type { NotificationService } from './notifications.js';

const ENTERPRISE_AI_BUDGET_SHARE = 0.4;
const OFFER_TTL_DAYS = 30;

/** Public forms + super-admin operations (platform level, not organization level). */
export class PlatformService {
  constructor(
    private readonly env: Env,
    private readonly db: Db,
    private readonly email: EmailService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationService,
    private readonly entitlements: EntitlementService,
  ) {}

  async submitEnterpriseRequest(auth: AuthUser | null, input: EnterpriseRequestInput) {
    const { confirm_saudi_registered: _c, ...fields } = input;
    const row = unwrap(await this.db.from('enterprise_requests').insert({ ...fields, user_id: auth?.userId ?? null }).select('*').single<Record<string, unknown> & { id: string }>());
    const sent = await this.email.send(enterpriseRequestEmail(this.env.PLATFORM_ADMIN_NOTIFICATION_EMAIL, row, `${this.env.PUBLIC_APP_URL}/admin/enterprise/${row.id}`));
    await this.audit.audit({ organizationId: null, actorType: 'human', actorUserId: auth?.userId ?? null, action: 'enterprise.requested', targetType: 'enterprise_request', targetId: row.id, metadata: { email_status: sent.status } });
    return { id: row.id };
  }

  async submitContact(input: ContactInput) {
    await this.db.from('contact_messages').insert(input);
  }

  async listMyEnterpriseRequests(auth: AuthUser) {
    const { data } = await this.db
      .from('enterprise_requests')
      .select('id, company_name, status, created_at, enterprise_offers(id, price_halalas, status, expires_at)')
      .or(`user_id.eq.${auth.userId}${auth.email ? `,work_email.ilike.${auth.email.replace(/[,()%_\\]/g, '')}` : ''}`)
      .order('created_at', { ascending: false });
    return data ?? [];
  }

  async getOffer(auth: AuthUser, offerId: string) {
    const { data } = await this.db
      .from('enterprise_offers')
      .select('id, price_halalas, currency, entitlements, status, expires_at, enterprise_requests!inner(company_name, user_id, work_email)')
      .eq('id', offerId)
      .maybeSingle<{ enterprise_requests: { user_id: string | null; work_email: string; company_name: string } } & Record<string, unknown>>();
    if (!data) throw notFound('offer_not_found');
    const r = data.enterprise_requests;
    if (r.user_id !== auth.userId && (!auth.email || r.work_email.toLowerCase() !== auth.email.toLowerCase())) throw notFound('offer_not_found');
    return data;
  }

  /* ----------------------------- super admin ----------------------------- */

  async dashboard() {
    const count = async (q: PromiseLike<{ count: number | null }>) => (await q).count ?? 0;
    const head = (table: string) => this.db.from(table).select('id', { count: 'exact', head: true });
    const monthAgo = new Date(Date.now() - 30 * 86400_000).toISOString();
    const [users, orgs, activeOrgs, aiEmployees, running, activeSubs, pendingEnterprise, pendingApplications, signups30d, paid, usage, computerRows] = await Promise.all([
      count(head('profiles')),
      count(head('organizations')),
      count(head('organizations').eq('status', 'active')),
      count(head('ai_employees').is('deleted_at', null)),
      count(head('ai_work_sessions').in('status', ['preparing', 'running'])),
      count(head('subscriptions').eq('status', 'active').gt('ends_at', new Date().toISOString())),
      count(head('enterprise_requests').eq('status', 'pending')),
      count(head('company_applications').eq('status', 'pending')),
      count(head('profiles').gte('created_at', monthAgo)),
      this.db.from('payment_transactions').select('amount_halalas, paid_at, plan_code').eq('status', 'paid').order('paid_at', { ascending: false }).limit(1000),
      this.db.from('ai_usage_events').select('estimated_cost_usd, input_tokens, output_tokens').gte('created_at', monthAgo).limit(10000),
      this.db.from('ai_computer_sessions').select('usage_seconds').gte('started_at', monthAgo).limit(10000),
    ]);
    const payments = (paid.data ?? []) as Array<{ amount_halalas: number; paid_at: string; plan_code: string }>;
    const usageRows = (usage.data ?? []) as Array<{ estimated_cost_usd: number; input_tokens: number; output_tokens: number }>;
    const { data: storageRows } = await this.db.from('company_files').select('size').is('purged_at', null).limit(100000);
    return {
      users,
      organizations: orgs,
      active_organizations: activeOrgs,
      ai_employees: aiEmployees,
      running_ai_sessions: running,
      active_subscriptions: activeSubs,
      pending_enterprise_requests: pendingEnterprise,
      pending_company_applications: pendingApplications,
      signups_30d: signups30d,
      revenue_halalas_total: payments.reduce((a, p) => a + Number(p.amount_halalas), 0),
      revenue_halalas_30d: payments.filter((p) => p.paid_at >= monthAgo).reduce((a, p) => a + Number(p.amount_halalas), 0),
      payments_count: payments.length,
      ai_cost_usd_30d: Math.round(usageRows.reduce((a, r) => a + Number(r.estimated_cost_usd), 0) * 100) / 100,
      ai_tokens_30d: usageRows.reduce((a, r) => a + r.input_tokens + r.output_tokens, 0),
      computer_minutes_30d: Math.round(((computerRows.data ?? []) as Array<{ usage_seconds: number }>).reduce((a, r) => a + r.usage_seconds, 0) / 60),
      storage_bytes: ((storageRows ?? []) as Array<{ size: number }>).reduce((a, r) => a + Number(r.size), 0),
    };
  }

  async listOrganizations() {
    const { data } = await this.db.from('organizations').select('id, name, commercial_registration, status, verification_status, created_at, subscriptions(plan_code, status, ends_at)').order('created_at', { ascending: false }).limit(500);
    return data ?? [];
  }

  async listApplications() {
    const { data } = await this.db.from('company_applications').select('*').order('created_at', { ascending: false }).limit(500);
    return data ?? [];
  }

  async getApplication(id: string) {
    const { data } = await this.db.from('company_applications').select('*').eq('id', id).maybeSingle();
    if (!data) throw notFound();
    return data;
  }

  async decideApplication(admin: AuthUser, id: string, decision: 'verify' | 'reject', note: string) {
    const app = (await this.getApplication(id)) as { id: string; organization_id: string | null; user_id: string; status: string };
    if (app.status !== 'pending') throw conflict('already_decided');
    const status = decision === 'verify' ? 'verified' : 'rejected';
    await this.db.from('company_applications').update({ status, reviewed_by: admin.userId, reviewed_at: new Date().toISOString(), review_note: note }).eq('id', id);
    if (app.organization_id) {
      await this.db.from('organizations').update({ verification_status: status, ...(decision === 'reject' ? { status: 'suspended' } : {}) }).eq('id', app.organization_id);
    }
    await this.notifications.notify({ organizationId: app.organization_id, userIds: [app.user_id], type: 'system', title: decision === 'verify' ? 'Company verified' : 'Company application rejected', body: note });
    await this.audit.audit({ organizationId: app.organization_id, actorType: 'super_admin', actorUserId: admin.userId, action: `application.${status}`, targetType: 'company_application', targetId: id });
  }

  async listEnterpriseRequests() {
    const { data } = await this.db.from('enterprise_requests').select('*, enterprise_offers(id, price_halalas, status, expires_at)').order('created_at', { ascending: false }).limit(500);
    return data ?? [];
  }

  async getEnterpriseRequest(id: string) {
    const { data } = await this.db.from('enterprise_requests').select('*, enterprise_offers(*)').eq('id', id).maybeSingle();
    if (!data) throw notFound();
    return data;
  }

  /** Secure decision — only reachable from the authenticated admin page, never from an email link directly. */
  async decideEnterprise(admin: AuthUser, id: string, input: { decision: 'approve' | 'reject'; price_sar?: number | undefined; entitlements?: Partial<Entitlements> | undefined; note: string }) {
    const req = (await this.getEnterpriseRequest(id)) as { id: string; status: string; work_email: string; user_id: string | null; organization_id: string | null };
    if (req.status !== 'pending') throw conflict('already_decided');

    if (input.decision === 'reject') {
      await this.db.from('enterprise_requests').update({ status: 'rejected', reviewed_by: admin.userId, reviewed_at: new Date().toISOString(), review_note: input.note }).eq('id', id);
      await this.email.send(enterpriseRejectedEmail(req.work_email, input.note));
      if (req.user_id) await this.notifications.notify({ organizationId: null, userIds: [req.user_id], type: 'enterprise_rejected', title: 'Enterprise request update', body: input.note });
      await this.audit.audit({ organizationId: null, actorType: 'super_admin', actorUserId: admin.userId, action: 'enterprise.rejected', targetType: 'enterprise_request', targetId: id });
      return { status: 'rejected' };
    }

    if (!input.price_sar) throw badRequest('price_required');
    const base = await this.entitlements.getPlan('enterprise');
    const entitlements = { ...(base?.entitlements ?? {}), ...(input.entitlements ?? {}) };
    // An enterprise offer is never AI-unlimited by accident: default AI budget = 40% of the price.
    if (entitlements.ai_budget_halalas_per_year === undefined || entitlements.ai_budget_halalas_per_year === null) {
      entitlements.ai_budget_halalas_per_year = Math.round(input.price_sar * 100 * ENTERPRISE_AI_BUDGET_SHARE);
    }
    const offer = unwrap(
      await this.db
        .from('enterprise_offers')
        .insert({ request_id: id, price_halalas: Math.round(input.price_sar * 100), entitlements, offered_by: admin.userId, expires_at: new Date(Date.now() + OFFER_TTL_DAYS * 86400_000).toISOString() })
        .select('id')
        .single<{ id: string }>(),
    );
    await this.db.from('enterprise_requests').update({ status: 'approved', reviewed_by: admin.userId, reviewed_at: new Date().toISOString(), review_note: input.note }).eq('id', id);
    const offerUrl = `${this.env.PUBLIC_APP_URL}/app/billing/offers/${offer.id}`;
    const sent = await this.email.send(enterpriseApprovedEmail(req.work_email, input.price_sar, offerUrl));
    if (req.user_id) {
      await this.notifications.notify({ organizationId: null, userIds: [req.user_id], type: 'enterprise_approved', title: 'تمت الموافقة على طلب الباقة المخصصة.', body: `السعر السنوي المخصص: ${input.price_sar} ر.س`, link: `/app/billing/offers/${offer.id}` });
    }
    await this.audit.audit({ organizationId: null, actorType: 'super_admin', actorUserId: admin.userId, action: 'enterprise.approved', targetType: 'enterprise_request', targetId: id, metadata: { price_sar: input.price_sar, email_status: sent.status } });
    return { status: 'approved', offer_id: offer.id, email_status: sent.status };
  }

  async listPayments() {
    const { data } = await this.db.from('payment_transactions').select('id, organization_id, plan_code, amount_halalas, status, payment_method, paid_at, created_at').order('created_at', { ascending: false }).limit(500);
    return data ?? [];
  }
}
