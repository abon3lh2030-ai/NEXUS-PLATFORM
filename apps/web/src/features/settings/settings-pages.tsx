import {
  Avatar,
  Badge,
  Button,
  Checkbox,
  ConfirmDialog,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Field,
  Input,
  NativeSelect,
  PageHeader,
  Section,
  Textarea,
  cn,
} from '@nexus/ui';
import { COMPANY_SIZES, DEFAULT_ROLE_PERMISSIONS, HUMAN_ROLES, INDUSTRIES, OWNER_LOCKED_PERMISSIONS, PERMISSIONS, type HumanRole } from '@nexus/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Building2, Copy, CreditCard, ImageUp, KeyRound, Pencil, ScrollText, ShieldCheck, Trash2, User, UserPlus, Users } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { NavLink, Outlet, useNavigate } from 'react-router';
import { toast } from 'sonner';
import { CompanyLogo, readLogoFile } from '@/components/company-logo';
import { LoadingBlock, StatusBadge, useAction } from '@/components/common';
import { FeatureGate } from '@/components/guards';
import { setLocale } from '@/i18n';
import { api, apiDelete, apiPatch, apiPost, apiPut } from '@/lib/api';
import { formatDate, formatDateTime } from '@/lib/format';
import { orgStore } from '@/lib/org-store';
import { useSession } from '@/providers/session';
import { useTheme } from '@/providers/theme';
import type { Member } from '@/features/work/shared';

export function SettingsLayout() {
  const { t } = useTranslation();
  const { can } = useSession();
  const items = [
    { to: '/app/settings', key: 'profile', icon: User, end: true },
    { to: '/app/settings/organization', key: 'organization', icon: Building2, show: can('org.view') },
    { to: '/app/settings/members', key: 'members', icon: Users, show: can('members.view') },
    { to: '/app/settings/billing', key: 'billing', icon: CreditCard, show: can('billing.view') },
    { to: '/app/settings/permissions', key: 'permissions', icon: KeyRound, show: can('org.manage') },
    { to: '/app/settings/audit', key: 'audit', icon: ScrollText, show: can('audit.view') },
  ].filter((i) => i.show !== false);
  return (
    <div className="grid gap-6 lg:grid-cols-[220px_1fr]">
      <nav className="flex gap-1 overflow-x-auto lg:flex-col">
        {items.map((i) => (
          <NavLink key={i.to} to={i.to} end={i.end} className={({ isActive }) => cn('flex items-center gap-2 whitespace-nowrap rounded-lg px-3 py-2 text-sm', isActive ? 'bg-primary/10 font-medium text-primary' : 'text-muted-foreground hover:bg-muted hover:text-foreground')}>
            <i.icon className="size-4" /> {t(`settings.${i.key}`)}
          </NavLink>
        ))}
      </nav>
      <div className="min-w-0"><Outlet /></div>
    </div>
  );
}

export function ProfileSettings() {
  const { t, i18n } = useTranslation();
  const { me } = useSession();
  const { theme, setTheme } = useTheme();
  const [name, setName] = useState(me?.profile?.full_name ?? '');
  useEffect(() => setName(me?.profile?.full_name ?? ''), [me]);
  const save = useAction(() => api('/me', { method: 'PATCH', body: { full_name: name, locale: i18n.language, theme }, org: false }), { success: t('common.saved'), invalidate: [['me'], ['members']] });
  return (
    <>
      <PageHeader title={t('settings.profile')} icon={<User />} />
      <Section>
        <div className="grid max-w-xl gap-4">
          <Field label={t('forms.fullName')}><Input value={name} onChange={(e) => setName(e.target.value)} /></Field>
          <Field label={t('forms.email')}><Input value={me?.email ?? ''} disabled dir="ltr" /></Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t('common.language')}><NativeSelect value={i18n.language} onChange={(e) => setLocale(e.target.value as 'ar' | 'en')}><option value="ar">العربية</option><option value="en">English</option></NativeSelect></Field>
            <Field label={t('common.theme')}><NativeSelect value={theme} onChange={(e) => setTheme(e.target.value as 'light' | 'dark' | 'system')}><option value="light">{t('common.light')}</option><option value="dark">{t('common.dark')}</option><option value="system">{t('common.system')}</option></NativeSelect></Field>
          </div>
          <Button className="justify-self-start" onClick={() => save.mutate(undefined)} loading={save.isPending}>{t('common.save')}</Button>
        </div>
      </Section>
    </>
  );
}

export function OrganizationSettings() {
  const { t } = useTranslation();
  const { org, can, me } = useSession();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const o = org?.organization;
  const [form, setForm] = useState({ name: '', company_email: '', company_phone: '', website: '', industry: '', company_size: '' });
  const [close, setClose] = useState(false);
  const [confirmName, setConfirmName] = useState('');
  const [reason, setReason] = useState('');
  useEffect(() => {
    if (o) setForm({ name: o.name, company_email: o.company_email ?? '', company_phone: o.company_phone ?? '', website: o.website ?? '', industry: o.industry ?? 'other', company_size: o.company_size ?? '1-10' });
  }, [o]);
  const save = useAction(() => apiPatch('/org', { ...form, company_email: form.company_email || undefined, company_phone: form.company_phone || undefined }), { success: t('common.saved'), invalidate: [['org'], ['me']] });
  const uploadLogo = useAction(async (file: File) => api('/org/logo', { method: 'PUT', body: { data_base64: await readLogoFile(file) } }), { success: t('settings.logoUpdated'), invalidate: [['org']] });
  const removeLogo = useAction(() => apiDelete('/org/logo'), { success: t('settings.logoRemoved'), invalidate: [['org']] });
  const closeCompany = useAction(() => apiPost('/org/close', { confirm_name: confirmName, reason }), {
    success: t('settings.closed'),
    onSuccess: () => {
      orgStore.set(null);
      void qc.invalidateQueries();
      navigate('/');
    },
  });
  if (!o) return <LoadingBlock />;
  const editable = can('org.manage');
  return (
    <>
      <PageHeader title={t('settings.organization')} icon={<Building2 />} />
      <div className="grid gap-6">
        <Section title={t('settings.logo')}>
          <div className="flex flex-wrap items-center gap-4">
            <CompanyLogo className="size-20 rounded-2xl p-1.5" />
            <div className="grid gap-2">
              <p className="text-sm text-muted-foreground">{t('forms.logoHint')}</p>
              {editable && (
                <div className="flex gap-2">
                  <Button asChild variant="outline" size="sm">
                    <label className="cursor-pointer"><ImageUp /> {o.logo_updated_at ? t('settings.changeLogo') : t('settings.uploadLogo')}<input type="file" accept="image/png" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadLogo.mutate(f); e.target.value = ''; }} /></label>
                  </Button>
                  {o.logo_updated_at && <Button variant="ghost" size="sm" onClick={() => removeLogo.mutate(undefined)}><Trash2 /> {t('common.remove')}</Button>}
                </div>
              )}
            </div>
          </div>
        </Section>
        <Section title={t('settings.companyInfo')}>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t('forms.companyLegalName')}><Input disabled={!editable} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
            <Field label={t('forms.cr')}><Input disabled value={o.commercial_registration} dir="ltr" /></Field>
            <Field label={t('forms.companyEmail')}><Input disabled={!editable} type="email" dir="ltr" value={form.company_email} onChange={(e) => setForm({ ...form, company_email: e.target.value })} /></Field>
            <Field label={t('forms.companyPhone')}><Input disabled={!editable} type="tel" dir="ltr" value={form.company_phone} onChange={(e) => setForm({ ...form, company_phone: e.target.value })} /></Field>
            <Field label={t('forms.website')}><Input disabled={!editable} dir="ltr" value={form.website} onChange={(e) => setForm({ ...form, website: e.target.value })} /></Field>
            <Field label={t('forms.industry')}><NativeSelect disabled={!editable} value={form.industry} onChange={(e) => setForm({ ...form, industry: e.target.value })}>{INDUSTRIES.map((s) => <option key={s} value={s}>{t(`industries.${s}`)}</option>)}</NativeSelect></Field>
            <Field label={t('forms.companySize')}><NativeSelect disabled={!editable} value={form.company_size} onChange={(e) => setForm({ ...form, company_size: e.target.value })}>{COMPANY_SIZES.map((s) => <option key={s} value={s}>{s}</option>)}</NativeSelect></Field>
            <Field label={t('settings.verification')}><div className="pt-2"><StatusBadge value={o.verification_status} /></div></Field>
          </div>
          {editable && <Button className="mt-4" onClick={() => save.mutate(undefined)} loading={save.isPending}>{t('common.save')}</Button>}
        </Section>
        {can('org.close') && o.owner_user_id === me?.user_id && (
          <Section title={<span className="flex items-center gap-2 text-destructive"><AlertTriangle className="size-4" /> {t('settings.dangerZone')}</span>} className="border-destructive/40">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div><p className="font-medium">{t('settings.closeCompany')}</p><p className="text-sm text-muted-foreground">{t('settings.closeHint')}</p></div>
              <Button variant="destructive" onClick={() => setClose(true)}>{t('settings.closeCompany')}</Button>
            </div>
          </Section>
        )}
      </div>
      <ConfirmDialog
        open={close}
        onOpenChange={setClose}
        title={t('settings.closeConfirmTitle')}
        description={t('settings.closeConfirmBody', { name: o.name })}
        confirmLabel={t('settings.closeCompany')}
        cancelLabel={t('common.cancel')}
        destructive
        loading={closeCompany.isPending}
        onConfirm={() => {
          if (confirmName.trim() !== o.name.trim() || !reason.trim()) {
            toast.error(t('settings.closeValidation'));
            return;
          }
          closeCompany.mutate(undefined);
        }}
      >
        <div className="grid gap-3">
          <Field label={t('settings.typeName', { name: o.name })}><Input value={confirmName} onChange={(e) => setConfirmName(e.target.value)} /></Field>
          <Field label={t('settings.closeReason')}><Textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
        </div>
      </ConfirmDialog>
    </>
  );
}

export function MembersSettings() {
  const { t } = useTranslation();
  const { can, org } = useSession();
  const [invite, setInvite] = useState(false);
  const [edit, setEdit] = useState<Member | null>(null);
  const [remove, setRemove] = useState<Member | null>(null);
  const members = useQuery({ queryKey: ['members'], queryFn: () => api<Member[]>('/org/members') });
  const invitations = useQuery({ queryKey: ['invitations'], queryFn: () => api<Array<{ id: string; email: string; role: string; expires_at: string; accepted_at: string | null; revoked_at: string | null }>>('/org/invitations'), enabled: can('members.manage') });
  const revoke = useAction((id: string) => apiDelete(`/org/invitations/${id}`), { invalidate: [['invitations']] });
  const removeM = useAction((id: string) => apiDelete(`/org/members/${id}`), { success: t('members.removed'), invalidate: [['members']] });
  const limit = org?.billing.entitlements.human_members;
  return (
    <>
      <PageHeader title={t('settings.members')} icon={<Users />} description={t('members.count', { count: members.data?.length ?? 0, limit: limit === null || limit === undefined ? '∞' : limit })} actions={can('members.manage') && <Button onClick={() => setInvite(true)}><UserPlus /> {t('members.invite')}</Button>} />
      <div className="overflow-hidden rounded-xl border bg-card">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-xs text-muted-foreground"><tr><th className="px-4 py-2 text-start">{t('fields.name')}</th><th className="px-4 py-2 text-start">{t('members.role')}</th><th className="hidden px-4 py-2 text-start md:table-cell">{t('members.jobTitle')}</th><th className="hidden px-4 py-2 text-start sm:table-cell">{t('members.joined')}</th><th className="w-24" /></tr></thead>
          <tbody>
            {members.data?.map((m) => (
              <tr key={m.id} className="border-t">
                <td className="px-4 py-2.5"><div className="flex items-center gap-3"><Avatar name={m.full_name || m.email || '?'} className="size-8" /><div><p className="font-medium">{m.full_name || '—'}</p>{m.email && <p className="text-xs text-muted-foreground" dir="ltr">{m.email}</p>}</div></div></td>
                <td className="px-4 py-2.5"><Badge tone={m.role === 'owner' ? 'primary' : 'neutral'}>{t(`roles.${m.role}`)}</Badge></td>
                <td className="hidden px-4 py-2.5 text-muted-foreground md:table-cell">{m.job_title ?? '—'}</td>
                <td className="hidden px-4 py-2.5 text-muted-foreground sm:table-cell">{formatDate((m as Member & { joined_at: string }).joined_at)}</td>
                <td className="px-2">
                  {can('members.manage') && (
                    <div className="flex justify-end">
                      <Button variant="ghost" size="icon-sm" onClick={() => setEdit(m)} aria-label={t('common.edit')}><Pencil /></Button>
                      {m.role !== 'owner' && <Button variant="ghost" size="icon-sm" onClick={() => setRemove(m)} aria-label={t('common.remove')}><Trash2 /></Button>}
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {can('members.manage') && (invitations.data?.length ?? 0) > 0 && (
        <Section className="mt-6" title={t('members.invitations')}>
          <ul className="grid gap-2">
            {invitations.data!.map((i) => (
              <li key={i.id} className="flex flex-wrap items-center gap-3 text-sm">
                <span dir="ltr">{i.email}</span><Badge>{t(`roles.${i.role}`)}</Badge>
                <span className="text-xs text-muted-foreground">{i.accepted_at ? t('members.accepted') : i.revoked_at ? t('members.revoked') : t('members.expires', { date: formatDate(i.expires_at) })}</span>
                {!i.accepted_at && !i.revoked_at && <Button size="sm" variant="ghost" className="ms-auto" onClick={() => revoke.mutate(i.id)}>{t('members.revoke')}</Button>}
              </li>
            ))}
          </ul>
        </Section>
      )}
      <InviteDialog open={invite} onOpenChange={setInvite} />
      <EditMemberDialog member={edit} onClose={() => setEdit(null)} />
      <ConfirmDialog open={Boolean(remove)} onOpenChange={(o) => !o && setRemove(null)} title={t('members.removeTitle', { name: remove?.full_name })} description={t('members.removeBody')} confirmLabel={t('common.remove')} cancelLabel={t('common.cancel')} destructive onConfirm={() => { if (remove) removeM.mutate(remove.id); setRemove(null); }} />
    </>
  );
}

function assignableRoles(role: HumanRole | undefined): HumanRole[] {
  const rank = { owner: 5, admin: 4, manager: 3, member: 2, viewer: 1 } as const;
  return HUMAN_ROLES.filter((r) => r !== 'owner' && role && (role === 'owner' || rank[role] > rank[r]));
}

function InviteDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const { t } = useTranslation();
  const { org } = useSession();
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<HumanRole>('member');
  const [result, setResult] = useState<{ invite_url: string; email_status: string } | null>(null);
  const send = useAction(() => apiPost<{ invite_url: string; email_status: string }>('/org/invitations', { email, role }), { invalidate: [['invitations']], onSuccess: (r) => setResult(r) });
  return (
    <Dialog open={open} onOpenChange={(o) => { onOpenChange(o); if (!o) { setResult(null); setEmail(''); } }}>
      <DialogContent size="sm" closeLabel={t('common.close')}>
        <DialogHeader><DialogTitle>{t('members.invite')}</DialogTitle></DialogHeader>
        {result ? (
          <div className="grid gap-3 text-sm">
            <p>{result.email_status === 'sent' ? t('members.inviteSent') : t('members.inviteNotEmailed')}</p>
            <div className="flex gap-2"><Input readOnly value={result.invite_url} dir="ltr" /><Button variant="outline" size="icon" onClick={() => void navigator.clipboard.writeText(result.invite_url).then(() => toast.success(t('common.copied')))} aria-label={t('common.copy')}><Copy /></Button></div>
          </div>
        ) : (
          <form className="grid gap-4" onSubmit={(e) => { e.preventDefault(); send.mutate(undefined); }}>
            <Field label={t('forms.email')}><Input type="email" dir="ltr" required value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
            <Field label={t('members.role')}><NativeSelect value={role} onChange={(e) => setRole(e.target.value as HumanRole)}>{assignableRoles(org?.membership.role).map((r) => <option key={r} value={r}>{t(`roles.${r}`)}</option>)}</NativeSelect></Field>
            <DialogFooter><Button type="submit" loading={send.isPending}>{t('members.sendInvite')}</Button></DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

/** Managers can rename employees (organization display name), change role, title and department. */
function EditMemberDialog({ member, onClose }: { member: Member | null; onClose: () => void }) {
  const { t } = useTranslation();
  const { org } = useSession();
  const deps = useQuery({ queryKey: ['work', 'departments', {}], queryFn: () => api<Array<{ id: string; name: string }>>('/work/departments') });
  const [form, setForm] = useState({ display_name: '', role: 'member' as HumanRole, job_title: '', department_id: '' });
  useEffect(() => {
    if (member) setForm({ display_name: member.full_name ?? '', role: member.role as HumanRole, job_title: member.job_title ?? '', department_id: member.department_id ?? '' });
  }, [member]);
  const save = useAction(
    () => apiPatch(`/org/members/${member!.id}`, {
      display_name: form.display_name.trim() || null,
      job_title: form.job_title,
      department_id: form.department_id || null,
      ...(member!.role !== 'owner' && form.role !== member!.role ? { role: form.role } : {}),
    }),
    { success: t('common.saved'), invalidate: [['members'], ['org-graph']], onSuccess: onClose },
  );
  return (
    <Dialog open={Boolean(member)} onOpenChange={(o) => !o && onClose()}>
      <DialogContent size="sm" closeLabel={t('common.close')}>
        <DialogHeader><DialogTitle>{t('members.editTitle')}</DialogTitle></DialogHeader>
        <form className="grid gap-4" onSubmit={(e) => { e.preventDefault(); save.mutate(undefined); }}>
          <Field label={t('members.displayName')} hint={t('members.displayNameHint')}><Input value={form.display_name} onChange={(e) => setForm({ ...form, display_name: e.target.value })} maxLength={120} /></Field>
          <Field label={t('members.jobTitle')}><Input value={form.job_title} onChange={(e) => setForm({ ...form, job_title: e.target.value })} maxLength={120} /></Field>
          <Field label={t('nav.departments')}><NativeSelect value={form.department_id} onChange={(e) => setForm({ ...form, department_id: e.target.value })}><option value="">{t('common.none')}</option>{deps.data?.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</NativeSelect></Field>
          {member?.role !== 'owner' && (
            <Field label={t('members.role')}><NativeSelect value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as HumanRole })}>{[member?.role as HumanRole, ...assignableRoles(org?.membership.role)].filter((v, i, a) => v && a.indexOf(v) === i).map((r) => <option key={r} value={r}>{t(`roles.${r}`)}</option>)}</NativeSelect></Field>
          )}
          <DialogFooter><Button type="submit" loading={save.isPending}>{t('common.save')}</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function PermissionsSettings() {
  const { t } = useTranslation();
  const { data } = useQuery({ queryKey: ['role-permissions'], queryFn: () => api<Array<{ role: HumanRole; permission: string; allowed: boolean }>>('/org/permissions') });
  const [overrides, setOverrides] = useState<Record<string, boolean>>({});
  useEffect(() => {
    if (data) setOverrides(Object.fromEntries(data.map((o) => [`${o.role}:${o.permission}`, o.allowed])));
  }, [data]);
  const roles = HUMAN_ROLES.filter((r) => r !== 'owner');
  const effective = (role: HumanRole, p: string) => overrides[`${role}:${p}`] ?? (DEFAULT_ROLE_PERMISSIONS[role] as readonly string[]).includes(p);
  const save = useAction(() => apiPut('/org/permissions', {
    overrides: Object.entries(overrides)
      .map(([k, allowed]) => { const [role, permission] = k.split(':') as [HumanRole, string]; return { role, permission, allowed }; })
      .filter((o) => (DEFAULT_ROLE_PERMISSIONS[o.role] as readonly string[]).includes(o.permission) !== o.allowed),
  }), { success: t('common.saved'), invalidate: [['role-permissions'], ['org']] });
  return (
    <FeatureGate feature="advanced_permissions">
      <PageHeader title={t('settings.permissions')} icon={<ShieldCheck />} description={t('permissions.description')} actions={<Button onClick={() => save.mutate(undefined)} loading={save.isPending}>{t('common.save')}</Button>} />
      <div className="overflow-x-auto rounded-xl border bg-card">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-xs text-muted-foreground"><tr><th className="px-4 py-2 text-start">{t('permissions.permission')}</th>{roles.map((r) => <th key={r} className="px-3 py-2">{t(`roles.${r}`)}</th>)}</tr></thead>
          <tbody>
            {PERMISSIONS.filter((p) => !OWNER_LOCKED_PERMISSIONS.includes(p)).map((p) => (
              <tr key={p} className="border-t">
                <td className="px-4 py-2"><p>{t(`permissions.keys.${p}`, p)}</p><p className="font-mono text-[10px] text-muted-foreground" dir="ltr">{p}</p></td>
                {roles.map((r) => <td key={r} className="px-3 py-2 text-center"><Checkbox checked={effective(r, p)} onCheckedChange={(v) => setOverrides((o) => ({ ...o, [`${r}:${p}`]: v === true }))} /></td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-3 text-xs text-muted-foreground">{t('permissions.ownerLocked')}</p>
    </FeatureGate>
  );
}

export function AuditSettings() {
  const { t } = useTranslation();
  const { data, isLoading } = useQuery({ queryKey: ['audit-logs'], queryFn: () => api<Array<{ id: number; action: string; actor_type: string; target_type: string | null; created_at: string; metadata: Record<string, unknown> }>>('/audit-logs') });
  return (
    <FeatureGate feature="audit_logs">
      <PageHeader title={t('settings.audit')} icon={<ScrollText />} />
      {isLoading ? <LoadingBlock /> : (
        <div className="overflow-hidden rounded-xl border bg-card">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-xs text-muted-foreground"><tr><th className="px-4 py-2 text-start">{t('common.date')}</th><th className="px-4 py-2 text-start">{t('audit.action')}</th><th className="px-4 py-2 text-start">{t('audit.actor')}</th><th className="hidden px-4 py-2 text-start md:table-cell">{t('audit.target')}</th></tr></thead>
            <tbody>{data?.map((l) => <tr key={l.id} className="border-t"><td className="px-4 py-2 text-muted-foreground">{formatDateTime(l.created_at)}</td><td className="px-4 py-2 font-mono text-xs" dir="ltr">{l.action}</td><td className="px-4 py-2">{t(`audit.actors.${l.actor_type}`)}</td><td className="hidden px-4 py-2 text-muted-foreground md:table-cell">{l.target_type ?? '—'}</td></tr>)}</tbody>
          </table>
        </div>
      )}
    </FeatureGate>
  );
}
