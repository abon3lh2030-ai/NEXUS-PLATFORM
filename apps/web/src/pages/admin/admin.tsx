import { Badge, Button, Field, Input, PageHeader, Section, StatCard, Textarea, cn } from '@nexus/ui';
import { useQuery } from '@tanstack/react-query';
import { Building2, CreditCard, FileCheck2, Gauge, Handshake, Shield } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, NavLink, Outlet, useNavigate, useParams, useSearchParams } from 'react-router';
import { KeyValue, LanguageToggle, LoadingBlock, Logo, StatusBadge, ThemeToggle, useAction } from '@/components/common';
import { api, apiPost } from '@/lib/api';
import { formatBytes, formatDate, formatDateTime, formatNumber, formatSar, formatUsd } from '@/lib/format';

export function AdminLayout() {
  const { t } = useTranslation();
  const items = [
    { to: '/admin', key: 'dashboard', icon: Gauge, end: true },
    { to: '/admin/applications', key: 'applications', icon: FileCheck2 },
    { to: '/admin/enterprise', key: 'enterprise', icon: Handshake },
    { to: '/admin/organizations', key: 'organizations', icon: Building2 },
    { to: '/admin/payments', key: 'payments', icon: CreditCard },
  ];
  return (
    <div className="min-h-dvh">
      <header className="sticky top-0 z-30 flex h-16 items-center gap-4 border-b bg-background/80 px-4 backdrop-blur sm:px-6">
        <Link to="/admin"><Logo /></Link>
        <Badge tone="danger"><Shield /> {t('admin.title')}</Badge>
        <nav className="ms-4 hidden gap-1 md:flex">
          {items.map((i) => <NavLink key={i.to} to={i.to} end={i.end} className={({ isActive }) => cn('flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm', isActive ? 'bg-muted font-medium' : 'text-muted-foreground hover:text-foreground')}><i.icon className="size-4" /> {t(`admin.nav.${i.key}`)}</NavLink>)}
        </nav>
        <div className="ms-auto flex items-center gap-1"><LanguageToggle compact /><ThemeToggle /><Button asChild size="sm" variant="outline"><Link to="/app">{t('public.openApp')}</Link></Button></div>
      </header>
      <nav className="flex gap-1 overflow-x-auto border-b px-4 py-2 md:hidden">
        {items.map((i) => <NavLink key={i.to} to={i.to} end={i.end} className={({ isActive }) => cn('whitespace-nowrap rounded-lg px-3 py-1.5 text-sm', isActive ? 'bg-muted font-medium' : 'text-muted-foreground')}>{t(`admin.nav.${i.key}`)}</NavLink>)}
      </nav>
      <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6"><Outlet /></main>
    </div>
  );
}

export function AdminDashboard() {
  const { t } = useTranslation();
  const { data } = useQuery({ queryKey: ['admin-dashboard'], queryFn: () => api<Record<string, number>>('/admin/dashboard', { org: false }), refetchInterval: 30_000 });
  if (!data) return <LoadingBlock />;
  return (
    <>
      <PageHeader title={t('admin.nav.dashboard')} icon={<Gauge />} />
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <StatCard label={t('admin.users')} value={formatNumber(data.users)} hint={t('admin.signups30d', { count: data.signups_30d })} />
        <StatCard label={t('admin.organizations')} value={formatNumber(data.organizations)} hint={t('admin.active', { count: data.active_organizations })} />
        <StatCard label={t('admin.subscriptions')} value={formatNumber(data.active_subscriptions)} />
        <StatCard label={t('admin.revenue')} value={formatSar(data.revenue_halalas_total)} hint={t('admin.last30', { value: formatSar(data.revenue_halalas_30d) })} />
        <StatCard label={t('dashboard.aiEmployees')} value={formatNumber(data.ai_employees)} hint={t('admin.runningSessions', { count: data.running_ai_sessions })} />
        <StatCard label={t('admin.aiCost30d')} value={formatUsd(data.ai_cost_usd_30d)} hint={t('ops.tokens', { count: data.ai_tokens_30d })} />
        <StatCard label={t('admin.computerMinutes')} value={formatNumber(data.computer_minutes_30d)} />
        <StatCard label={t('analytics.storage')} value={formatBytes(data.storage_bytes)} />
      </div>
      <div className="mt-6 grid gap-4 md:grid-cols-2">
        <Link to="/admin/applications"><StatCard className="hover:shadow-md" label={t('admin.pendingApplications')} value={formatNumber(data.pending_company_applications)} /></Link>
        <Link to="/admin/enterprise"><StatCard className="hover:shadow-md" label={t('admin.pendingEnterprise')} value={formatNumber(data.pending_enterprise_requests)} /></Link>
      </div>
    </>
  );
}

interface Application { id: string; company_name: string; commercial_registration: string; company_email: string | null; company_phone: string | null; website: string | null; applicant_name: string; work_email: string; applicant_role: string; industry: string; company_size: string; note: string; status: string; created_at: string; review_note: string | null }

export function AdminApplications() {
  const { t } = useTranslation();
  const { data } = useQuery({ queryKey: ['admin-apps'], queryFn: () => api<Application[]>('/admin/applications', { org: false }) });
  return (
    <>
      <PageHeader title={t('admin.nav.applications')} icon={<FileCheck2 />} />
      {!data ? <LoadingBlock /> : (
        <ul className="grid gap-2">{data.map((a) => <li key={a.id}><Link to={`/admin/applications/${a.id}`} className="flex items-center gap-3 rounded-xl border bg-card p-4 hover:shadow-md"><span className="flex-1 font-medium">{a.company_name}</span><span className="font-mono text-xs text-muted-foreground" dir="ltr">{a.commercial_registration}</span><span className="text-xs text-muted-foreground">{formatDate(a.created_at)}</span><StatusBadge value={a.status} /></Link></li>)}</ul>
      )}
    </>
  );
}

export function AdminApplication() {
  const { id } = useParams();
  const { t } = useTranslation();
  const [note, setNote] = useState('');
  const { data } = useQuery({ queryKey: ['admin-app', id], queryFn: () => api<Application>(`/admin/applications/${id}`, { org: false }) });
  const decide = useAction((decision: 'verify' | 'reject') => api(`/admin/applications/${id}/decide`, { method: 'POST', body: { decision, note }, org: false }), { success: t('common.saved'), invalidate: [['admin-app', id], ['admin-apps']] });
  if (!data) return <LoadingBlock />;
  return (
    <>
      <PageHeader title={data.company_name} description={t('admin.applicationTitle')} icon={<FileCheck2 />} actions={<StatusBadge value={data.status} />} />
      <Section>
        <div className="grid divide-y sm:grid-cols-2 sm:gap-x-8 sm:divide-y-0">
          <KeyValue label={t('forms.cr')}><span dir="ltr">{data.commercial_registration}</span></KeyValue>
          <KeyValue label={t('forms.companyEmail')}><span dir="ltr">{data.company_email ?? '—'}</span></KeyValue>
          <KeyValue label={t('forms.companyPhone')}><span dir="ltr">{data.company_phone ?? '—'}</span></KeyValue>
          <KeyValue label={t('forms.website')}>{data.website ?? '—'}</KeyValue>
          <KeyValue label={t('forms.industry')}>{t(`industries.${data.industry}`)}</KeyValue>
          <KeyValue label={t('forms.companySize')}>{data.company_size}</KeyValue>
          <KeyValue label={t('admin.applicant')}>{data.applicant_name} · <span dir="ltr">{data.work_email}</span></KeyValue>
          <KeyValue label={t('forms.applicantRole')}>{data.applicant_role}</KeyValue>
        </div>
        {data.note && <p className="mt-4 rounded-lg bg-muted p-3 text-sm">{data.note}</p>}
      </Section>
      {data.status === 'pending' && (
        <Section className="mt-6" title={t('admin.decision')}>
          <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder={t('admin.notePlaceholder')} />
          <div className="mt-3 flex gap-2"><Button onClick={() => decide.mutate('verify')} loading={decide.isPending}>{t('admin.verify')}</Button><Button variant="destructive" onClick={() => decide.mutate('reject')} loading={decide.isPending}>{t('approvals.reject')}</Button></div>
        </Section>
      )}
    </>
  );
}

interface EnterpriseRequest { id: string; company_name: string; commercial_registration: string; website: string | null; contact_name: string; work_email: string; company_size: string; industry: string; expected_human_members: number; expected_ai_employees: number; expected_ai_usage: string; expected_computer_usage: string; expected_storage: string; requirements: string; customer_note: string; status: string; created_at: string; enterprise_offers: Array<{ id: string; price_halalas: number; status: string; expires_at: string }> }

export function AdminEnterpriseList() {
  const { t } = useTranslation();
  const { data } = useQuery({ queryKey: ['admin-enterprise'], queryFn: () => api<EnterpriseRequest[]>('/admin/enterprise-requests', { org: false }) });
  return (
    <>
      <PageHeader title={t('admin.nav.enterprise')} icon={<Handshake />} />
      {!data ? <LoadingBlock /> : <ul className="grid gap-2">{data.map((r) => <li key={r.id}><Link to={`/admin/enterprise/${r.id}`} className="flex items-center gap-3 rounded-xl border bg-card p-4 hover:shadow-md"><span className="flex-1 font-medium">{r.company_name}</span><span className="text-xs text-muted-foreground">{formatDate(r.created_at)}</span><StatusBadge value={r.status} /></Link></li>)}</ul>}
    </>
  );
}

/** Secure admin review page (email buttons only link here; decisions require login + super_admin). */
export function AdminEnterpriseDetail() {
  const { id } = useParams();
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [price, setPrice] = useState('');
  const [note, setNote] = useState('');
  const [limits, setLimits] = useState({ human_members: '', ai_employees: '', ai_executions_per_year: '', storage_gb: '' });
  const { data } = useQuery({ queryKey: ['admin-ent', id], queryFn: () => api<EnterpriseRequest>(`/admin/enterprise-requests/${id}`, { org: false }) });
  const num = (v: string) => (v.trim() === '' ? null : Number(v));
  const decide = useAction(
    (decision: 'approve' | 'reject') =>
      apiPost(`/admin/enterprise-requests/${id}/decide`, {
        decision,
        note,
        ...(decision === 'approve'
          ? {
              price_sar: Number(price),
              entitlements: { human_members: num(limits.human_members), ai_employees: num(limits.ai_employees), ai_executions_per_year: num(limits.ai_executions_per_year), storage_bytes: limits.storage_gb ? Number(limits.storage_gb) * 1024 ** 3 : null, active_projects: null, max_file_size_bytes: 262144000, concurrent_ai_sessions: 20, computer_minutes_per_year: null },
            }
          : {}),
      }),
    { success: t('common.saved'), invalidate: [['admin-ent', id], ['admin-enterprise']], onSuccess: () => navigate('/admin/enterprise') },
  );
  if (!data) return <LoadingBlock />;
  const intent = params.get('intent');
  return (
    <>
      <PageHeader title={data.company_name} description={t('admin.enterpriseTitle')} icon={<Handshake />} actions={<StatusBadge value={data.status} />} />
      <div className="grid gap-6 lg:grid-cols-2">
        <Section title={t('admin.requestDetails')}>
          <KeyValue label={t('forms.cr')}><span dir="ltr">{data.commercial_registration}</span></KeyValue>
          <KeyValue label={t('forms.contactName')}>{data.contact_name}</KeyValue>
          <KeyValue label={t('forms.workEmail')}><span dir="ltr">{data.work_email}</span></KeyValue>
          <KeyValue label={t('forms.website')}>{data.website ?? '—'}</KeyValue>
          <KeyValue label={t('forms.industry')}>{t(`industries.${data.industry}`)}</KeyValue>
          <KeyValue label={t('forms.companySize')}>{data.company_size}</KeyValue>
          <KeyValue label={t('forms.expectedHumans')}>{data.expected_human_members}</KeyValue>
          <KeyValue label={t('forms.expectedAi')}>{data.expected_ai_employees}</KeyValue>
          <KeyValue label={t('forms.expectedStorage')}>{data.expected_storage || '—'}</KeyValue>
          <div className="mt-3 grid gap-2 text-sm">
            <p><span className="text-muted-foreground">{t('forms.expectedAiUsage')}:</span> {data.expected_ai_usage || '—'}</p>
            <p><span className="text-muted-foreground">{t('forms.expectedComputerUsage')}:</span> {data.expected_computer_usage || '—'}</p>
            <p><span className="text-muted-foreground">{t('forms.requirements')}:</span> {data.requirements || '—'}</p>
            <p><span className="text-muted-foreground">{t('forms.customerNote')}:</span> {data.customer_note || '—'}</p>
          </div>
        </Section>
        {data.status === 'pending' ? (
          <Section title={t('admin.decision')}>
            {intent && <p className="mb-3 rounded-lg bg-muted px-3 py-2 text-xs">{t('admin.intentNotice')}</p>}
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label={t('admin.priceSar')} className="sm:col-span-2"><Input type="number" min={1} value={price} onChange={(e) => setPrice(e.target.value)} dir="ltr" /></Field>
              <Field label={t('pricing.humans')}><Input type="number" placeholder="∞" value={limits.human_members} onChange={(e) => setLimits({ ...limits, human_members: e.target.value })} /></Field>
              <Field label={t('pricing.aiEmployees')}><Input type="number" placeholder="∞" value={limits.ai_employees} onChange={(e) => setLimits({ ...limits, ai_employees: e.target.value })} /></Field>
              <Field label={t('pricing.executions')}><Input type="number" placeholder="∞" value={limits.ai_executions_per_year} onChange={(e) => setLimits({ ...limits, ai_executions_per_year: e.target.value })} /></Field>
              <Field label={t('admin.storageGb')}><Input type="number" placeholder="∞" value={limits.storage_gb} onChange={(e) => setLimits({ ...limits, storage_gb: e.target.value })} /></Field>
            </div>
            <Field className="mt-3" label={t('admin.noteToCustomer')}><Textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} /></Field>
            <div className="mt-4 flex gap-2">
              <Button disabled={!(Number(price) > 0)} onClick={() => decide.mutate('approve')} loading={decide.isPending}>{t('admin.approveAndSend')}</Button>
              <Button variant="destructive" onClick={() => decide.mutate('reject')} loading={decide.isPending}>{t('approvals.reject')}</Button>
            </div>
          </Section>
        ) : (
          <Section title={t('admin.offers')}>
            {data.enterprise_offers.map((o) => <KeyValue key={o.id} label={formatSar(o.price_halalas)}><StatusBadge value={o.status === 'paid' ? 'completed' : o.status === 'offered' ? 'pending' : o.status} /></KeyValue>)}
            {data.enterprise_offers.length === 0 && <p className="text-sm text-muted-foreground">—</p>}
          </Section>
        )}
      </div>
    </>
  );
}

export function AdminOrganizations() {
  const { t } = useTranslation();
  const { data } = useQuery({ queryKey: ['admin-orgs'], queryFn: () => api<Array<{ id: string; name: string; commercial_registration: string; status: string; verification_status: string; created_at: string; subscriptions: { plan_code: string; status: string; ends_at: string } | Array<{ plan_code: string; status: string; ends_at: string }> | null }>>('/admin/organizations', { org: false }) });
  return (
    <>
      <PageHeader title={t('admin.nav.organizations')} icon={<Building2 />} />
      {!data ? <LoadingBlock /> : (
        <div className="overflow-x-auto rounded-xl border bg-card">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-xs text-muted-foreground"><tr><th className="px-4 py-2 text-start">{t('fields.name')}</th><th className="px-4 py-2 text-start">{t('forms.cr')}</th><th className="px-4 py-2 text-start">{t('common.status')}</th><th className="px-4 py-2 text-start">{t('billing.plan')}</th><th className="px-4 py-2 text-start">{t('billing.endsAt')}</th></tr></thead>
            <tbody>
              {data.map((o) => {
                const sub = Array.isArray(o.subscriptions) ? o.subscriptions[0] : o.subscriptions;
                return <tr key={o.id} className="border-t"><td className="px-4 py-2 font-medium">{o.name}</td><td className="px-4 py-2 font-mono text-xs" dir="ltr">{o.commercial_registration}</td><td className="px-4 py-2"><StatusBadge value={o.status} /> <StatusBadge value={o.verification_status} /></td><td className="px-4 py-2">{sub ? t(`plans.${sub.plan_code}`) : '—'}</td><td className="px-4 py-2 text-muted-foreground">{sub ? formatDate(sub.ends_at) : '—'}</td></tr>;
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

export function AdminPayments() {
  const { t } = useTranslation();
  const { data } = useQuery({ queryKey: ['admin-payments'], queryFn: () => api<Array<{ id: string; plan_code: string; amount_halalas: number; status: string; payment_method: string | null; paid_at: string | null; created_at: string }>>('/admin/payments', { org: false }) });
  return (
    <>
      <PageHeader title={t('admin.nav.payments')} icon={<CreditCard />} />
      {!data ? <LoadingBlock /> : (
        <div className="overflow-x-auto rounded-xl border bg-card">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-xs text-muted-foreground"><tr><th className="px-4 py-2 text-start">{t('common.date')}</th><th className="px-4 py-2 text-start">{t('billing.plan')}</th><th className="px-4 py-2 text-start">{t('billing.amount')}</th><th className="px-4 py-2 text-start">{t('billing.method')}</th><th className="px-4 py-2 text-start">{t('common.status')}</th></tr></thead>
            <tbody>{data.map((p) => <tr key={p.id} className="border-t"><td className="px-4 py-2">{formatDateTime(p.paid_at ?? p.created_at)}</td><td className="px-4 py-2">{t(`plans.${p.plan_code}`)}</td><td className="px-4 py-2 tabular-nums">{formatSar(p.amount_halalas)}</td><td className="px-4 py-2">{p.payment_method ?? '—'}</td><td className="px-4 py-2"><StatusBadge value={p.status === 'paid' ? 'completed' : p.status === 'initiated' ? 'pending' : p.status} /></td></tr>)}</tbody>
          </table>
        </div>
      )}
    </>
  );
}
