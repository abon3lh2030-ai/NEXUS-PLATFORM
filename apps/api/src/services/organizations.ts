import { createHash, randomBytes } from 'node:crypto';
import { canAssignRole, LOGO_MAX_BYTES, matchesSignature, type CompanyApplicationInput, type HumanRole } from '@nexus/shared';
import type { Env } from '../config/env.js';
import type { AuthUser, OrgActor } from '../context.js';
import { AppError, badRequest, conflict, forbidden, notFound, unwrap } from '../lib/errors.js';
import type { Db } from '../lib/supabase.js';
import type { MemberRow, OrganizationRow } from '../types/db.js';
import type { AuditService } from './audit.js';
import type { EmailService } from './email/provider.js';
import { companyApplicationEmail, companyClosedEmail, invitationEmail } from './email/templates.js';
import type { EntitlementService } from './entitlements.js';
import type { NotificationService } from './notifications.js';
import { FILES_BUCKET } from './files/storage-keys.js';

const DEFAULT_SHARED_FOLDERS = ['Marketing', 'Finance', 'Product', 'Projects', 'General'];
const DEFAULT_PRIVATE_FOLDERS = ['Personal', 'Drafts', 'Reports', 'Notes'];
const INVITE_TTL_DAYS = 7;

export const hashToken = (t: string) => createHash('sha256').update(t).digest('hex');

export class OrganizationService {
  constructor(
    private readonly env: Env,
    private readonly db: Db,
    private readonly email: EmailService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationService,
  ) {}

  async listForUser(auth: AuthUser) {
    const { data } = await this.db
      .from('organization_members')
      .select('role, organizations!inner(id, name, status, verification_status, default_locale)')
      .eq('user_id', auth.userId)
      .eq('status', 'active')
      .neq('organizations.status', 'closed');
    return ((data ?? []) as unknown as Array<{ role: HumanRole; organizations: Pick<OrganizationRow, 'id' | 'name' | 'status' | 'verification_status' | 'default_locale'> }>).map((r) => ({
      ...r.organizations,
      role: r.role,
    }));
  }

  /** Saudi company registration: creates the organization (owner = caller) + application record, emails the platform admin. */
  async registerCompany(auth: AuthUser, input: CompanyApplicationInput): Promise<OrganizationRow> {
    const { data: existing } = await this.db
      .from('organizations')
      .select('id')
      .eq('commercial_registration', input.commercial_registration)
      .neq('status', 'closed')
      .maybeSingle();
    if (existing) throw conflict('commercial_registration_already_registered');

    const org = unwrap(
      await this.db
        .from('organizations')
        .insert({
          name: input.company_name,
          commercial_registration: input.commercial_registration,
          company_email: input.company_email.toLowerCase(),
          company_phone: input.company_phone,
          website: input.website,
          industry: input.industry,
          company_size: input.company_size,
          owner_user_id: auth.userId,
        })
        .select('*')
        .single<OrganizationRow>(),
    );
    await this.db.from('organization_members').insert({ organization_id: org.id, user_id: auth.userId, role: 'owner', job_title: input.applicant_role });
    // The applicant is identified by their account; the application stores the COMPANY's official contact data.
    const { data: profile } = await this.db.from('profiles').select('full_name').eq('id', auth.userId).maybeSingle<{ full_name: string }>();
    const applicantName = profile?.full_name || auth.email || '';

    const application = unwrap(
      await this.db
        .from('company_applications')
        .insert({
          user_id: auth.userId,
          organization_id: org.id,
          company_name: input.company_name,
          commercial_registration: input.commercial_registration,
          website: input.website,
          company_email: input.company_email.toLowerCase(),
          company_phone: input.company_phone,
          applicant_name: applicantName,
          work_email: auth.email ?? input.company_email,
          applicant_role: input.applicant_role,
          industry: input.industry,
          company_size: input.company_size,
          note: input.note,
          confirmed_saudi_registered: input.confirm_saudi_registered,
        })
        .select('id')
        .single<{ id: string }>(),
    );

    await this.db.from('company_file_folders').insert([
      ...DEFAULT_SHARED_FOLDERS.map((name) => ({ organization_id: org.id, space: 'shared', visibility: 'organization_shared', name, created_by_user_id: auth.userId })),
      ...DEFAULT_PRIVATE_FOLDERS.map((name) => ({ organization_id: org.id, space: 'private', visibility: 'private_owner', owner_user_id: auth.userId, name, created_by_user_id: auth.userId })),
    ]);

    await this.email.send(
      companyApplicationEmail(this.env.PLATFORM_ADMIN_NOTIFICATION_EMAIL, { ...input, applicant_name: applicantName, applicant_account_email: auth.email }, `${this.env.PUBLIC_APP_URL}/admin/applications/${application.id}`),
    );
    await this.audit.audit({ organizationId: org.id, actorType: 'human', actorUserId: auth.userId, action: 'organization.registered', targetType: 'organization', targetId: org.id });
    return org;
  }

  async get(actor: OrgActor) {
    const { data } = await this.db.from('organizations').select('*').eq('id', actor.orgId).single<OrganizationRow>();
    return data;
  }

  async update(actor: OrgActor, patch: Record<string, unknown>) {
    const row = unwrap(await this.db.from('organizations').update(patch).eq('id', actor.orgId).select('*').single<OrganizationRow>());
    await this.audit.audit({ organizationId: actor.orgId, actorType: 'human', actorUserId: actor.userId, action: 'organization.updated', metadata: { fields: Object.keys(patch) } });
    return row;
  }

  async listMembers(actor: OrgActor) {
    const { data: members } = await this.db.from('organization_members').select('*').eq('organization_id', actor.orgId).eq('status', 'active').order('joined_at');
    const rows = (members ?? []) as MemberRow[];
    const { data: profiles } = await this.db.from('profiles').select('id, full_name, email, avatar_url').in('id', rows.map((m) => m.user_id));
    const byId = new Map(((profiles ?? []) as Array<{ id: string; full_name: string; email: string | null; avatar_url: string | null }>).map((p) => [p.id, p]));
    const canSeeEmails = actor.permissions.has('members.manage');
    return rows.map((m) => {
      const p = byId.get(m.user_id);
      return { ...m, full_name: m.display_name || p?.full_name || '', account_name: p?.full_name ?? '', email: canSeeEmails ? (p?.email ?? null) : null, avatar_url: p?.avatar_url ?? null };
    });
  }

  async invite(actor: OrgActor, entitlements: EntitlementService, email: string, role: HumanRole) {
    if (!canAssignRole(actor.role, role)) throw forbidden('cannot_assign_role');
    const { count: pending } = await this.db
      .from('organization_invitations')
      .select('id', { count: 'exact', head: true })
      .eq('organization_id', actor.orgId)
      .is('accepted_at', null)
      .is('revoked_at', null)
      .gt('expires_at', new Date().toISOString());
    await entitlements.assertWithinLimit(actor.orgId, actor.billing, 'human_members', 1 + (pending ?? 0));

    const token = randomBytes(32).toString('base64url');
    const invitation = unwrap(
      await this.db
        .from('organization_invitations')
        .insert({
          organization_id: actor.orgId,
          email: email.toLowerCase(),
          role,
          token_hash: hashToken(token),
          invited_by: actor.userId,
          expires_at: new Date(Date.now() + INVITE_TTL_DAYS * 86400_000).toISOString(),
        })
        .select('id, email, role, expires_at')
        .single<{ id: string; email: string; role: string; expires_at: string }>(),
    );
    const url = `${this.env.PUBLIC_APP_URL}/invite/${token}`;
    const sent = await this.email.send(invitationEmail(email, actor.orgName, role, url));
    await this.audit.audit({ organizationId: actor.orgId, actorType: 'human', actorUserId: actor.userId, action: 'member.invited', targetType: 'invitation', targetId: invitation.id, metadata: { role } });
    // The link is returned to the inviting admin so it can be shared manually when email isn't configured.
    return { ...invitation, invite_url: url, email_status: sent.status };
  }

  async listInvitations(actor: OrgActor) {
    const { data } = await this.db
      .from('organization_invitations')
      .select('id, email, role, expires_at, accepted_at, revoked_at, created_at')
      .eq('organization_id', actor.orgId)
      .order('created_at', { ascending: false });
    return data ?? [];
  }

  async revokeInvitation(actor: OrgActor, id: string) {
    await this.db.from('organization_invitations').update({ revoked_at: new Date().toISOString() }).eq('id', id).eq('organization_id', actor.orgId);
  }

  async acceptInvitation(auth: AuthUser, entitlements: EntitlementService, token: string) {
    const { data: inv } = await this.db
      .from('organization_invitations')
      .select('*')
      .eq('token_hash', hashToken(token))
      .maybeSingle<{ id: string; organization_id: string; email: string; role: HumanRole; expires_at: string; accepted_at: string | null; revoked_at: string | null; invited_by: string }>();
    if (!inv || inv.revoked_at || inv.accepted_at || new Date(inv.expires_at) < new Date()) throw notFound('invitation_invalid');
    if (!auth.email || auth.email.toLowerCase() !== inv.email.toLowerCase()) throw forbidden('invitation_email_mismatch');
    const billing = await entitlements.getBillingState(inv.organization_id);
    await entitlements.assertWithinLimit(inv.organization_id, billing, 'human_members', 1);

    const { data: existing } = await this.db.from('organization_members').select('id, status').eq('organization_id', inv.organization_id).eq('user_id', auth.userId).maybeSingle<{ id: string; status: string }>();
    if (existing?.status === 'active') throw conflict('already_member');
    if (existing) {
      await this.db.from('organization_members').update({ status: 'active', role: inv.role, invited_by: inv.invited_by }).eq('id', existing.id);
    } else {
      await this.db.from('organization_members').insert({ organization_id: inv.organization_id, user_id: auth.userId, role: inv.role, invited_by: inv.invited_by });
    }
    await this.db.from('organization_invitations').update({ accepted_at: new Date().toISOString(), accepted_by: auth.userId }).eq('id', inv.id);
    await this.db.from('company_file_folders').insert(
      DEFAULT_PRIVATE_FOLDERS.map((name) => ({ organization_id: inv.organization_id, space: 'private', visibility: 'private_owner', owner_user_id: auth.userId, name, created_by_user_id: auth.userId })),
    );
    await this.audit.audit({ organizationId: inv.organization_id, actorType: 'human', actorUserId: auth.userId, action: 'member.joined', metadata: { role: inv.role } });
    return { organization_id: inv.organization_id };
  }

  async updateMember(actor: OrgActor, memberId: string, patch: { role?: HumanRole | undefined; department_id?: string | null | undefined; job_title?: string | undefined; display_name?: string | null | undefined }) {
    const { data: target } = await this.db.from('organization_members').select('*').eq('id', memberId).eq('organization_id', actor.orgId).maybeSingle<MemberRow>();
    if (!target) throw notFound('member_not_found');
    if (target.role === 'owner' && patch.role) throw forbidden('cannot_change_owner_role');
    if (patch.role && (!canAssignRole(actor.role, patch.role) || !canAssignRole(actor.role, target.role))) throw forbidden('cannot_assign_role');
    const row = unwrap(await this.db.from('organization_members').update(patch).eq('id', memberId).select('*').single<MemberRow>());
    await this.audit.audit({ organizationId: actor.orgId, actorType: 'human', actorUserId: actor.userId, action: 'member.updated', targetType: 'member', targetId: memberId, metadata: { ...patch } });
    return row;
  }

  async removeMember(actor: OrgActor, memberId: string) {
    const { data: target } = await this.db.from('organization_members').select('*').eq('id', memberId).eq('organization_id', actor.orgId).maybeSingle<MemberRow>();
    if (!target) throw notFound('member_not_found');
    if (target.role === 'owner') throw forbidden('cannot_remove_owner');
    if (!canAssignRole(actor.role, target.role)) throw forbidden('cannot_remove_member');
    // Soft removal. Their private files stay private and owned by them — nobody else gains access.
    await this.db.from('organization_members').update({ status: 'removed' }).eq('id', memberId);
    await this.audit.audit({ organizationId: actor.orgId, actorType: 'human', actorUserId: actor.userId, action: 'member.removed', targetType: 'member', targetId: memberId });
  }

  async getRolePermissions(actor: OrgActor) {
    const { data } = await this.db.from('organization_role_permissions').select('role, permission, allowed').eq('organization_id', actor.orgId);
    return data ?? [];
  }

  async setRolePermissions(actor: OrgActor, overrides: Array<{ role: HumanRole; permission: string; allowed: boolean }>) {
    await this.db.from('organization_role_permissions').delete().eq('organization_id', actor.orgId);
    if (overrides.length) {
      await this.db.from('organization_role_permissions').insert(overrides.map((o) => ({ ...o, organization_id: actor.orgId, updated_by: actor.userId })));
    }
    await this.audit.audit({ organizationId: actor.orgId, actorType: 'human', actorUserId: actor.userId, action: 'permissions.updated', metadata: { count: overrides.length } });
  }

  /* ----------------------------- company logo ----------------------------- */

  /** Stores a PNG logo in PRIVATE storage under {org}/branding/. Content is verified by magic bytes, not by name. */
  async setLogo(actor: OrgActor, dataBase64: string) {
    const clean = dataBase64.replace(/^data:image\/png;base64,/, '');
    if (!/^[A-Za-z0-9+/]+={0,2}$/.test(clean)) throw badRequest('invalid_logo');
    const bytes = Buffer.from(clean, 'base64');
    if (bytes.byteLength === 0 || bytes.byteLength > LOGO_MAX_BYTES) throw badRequest('logo_too_large');
    if (!matchesSignature(bytes.subarray(0, 16), 'png')) throw badRequest('logo_must_be_png');

    const org = await this.get(actor);
    if (!org) throw notFound();
    const key = `${org.id}/branding/logo-${randomBytes(8).toString('hex')}.png`;
    const { error } = await this.db.storage.from(FILES_BUCKET).upload(key, bytes, { contentType: 'image/png', upsert: false });
    if (error) throw new AppError(502, 'storage_unavailable', error.message);
    await this.db.from('organizations').update({ logo_storage_key: key, logo_updated_at: new Date().toISOString() }).eq('id', org.id);
    if (org.logo_storage_key) await this.db.storage.from(FILES_BUCKET).remove([org.logo_storage_key]);
    await this.audit.audit({ organizationId: org.id, actorType: 'human', actorUserId: actor.userId, action: 'organization.logo_updated' });
    return { logo_updated_at: new Date().toISOString() };
  }

  async removeLogo(actor: OrgActor) {
    const org = await this.get(actor);
    if (!org?.logo_storage_key) return;
    await this.db.storage.from(FILES_BUCKET).remove([org.logo_storage_key]);
    await this.db.from('organizations').update({ logo_storage_key: null, logo_updated_at: null }).eq('id', org.id);
    await this.audit.audit({ organizationId: org.id, actorType: 'human', actorUserId: actor.userId, action: 'organization.logo_removed' });
  }

  /** Streams the logo to organization members only (bucket stays private). */
  async getLogo(actor: OrgActor): Promise<Buffer | null> {
    const org = await this.get(actor);
    if (!org?.logo_storage_key) return null;
    const { data } = await this.db.storage.from(FILES_BUCKET).download(org.logo_storage_key);
    return data ? Buffer.from(await data.arrayBuffer()) : null;
  }

  /** Owner-only. Soft close: nothing is deleted. Running AI work is cancelled; admin is emailed. */
  async close(actor: OrgActor, confirmName: string, reason: string) {
    if (actor.role !== 'owner' || actor.userId !== actor.ownerUserId) throw forbidden('owner_only');
    const org = await this.get(actor);
    if (!org) throw notFound();
    if (confirmName.trim() !== org.name.trim()) throw badRequest('confirmation_name_mismatch');
    const closedAt = new Date().toISOString();
    const { error } = await this.db.from('organizations').update({ status: 'closed', closed_at: closedAt, closed_by: actor.userId, close_reason: reason }).eq('id', org.id);
    if (error) throw new AppError(500, 'close_failed', error.message);
    await this.db
      .from('ai_work_sessions')
      .update({ status: 'cancelled', error: 'organization_closed', completed_at: closedAt })
      .eq('organization_id', org.id)
      .in('status', ['queued', 'preparing', 'running', 'paused', 'waiting_approval']);
    await this.audit.audit({ organizationId: org.id, actorType: 'human', actorUserId: actor.userId, action: 'organization.closed', metadata: { reason } });
    const { data: profile } = await this.db.from('profiles').select('full_name, email').eq('id', actor.userId).single<{ full_name: string; email: string | null }>();
    await this.email.send(
      companyClosedEmail(this.env.PLATFORM_ADMIN_NOTIFICATION_EMAIL, {
        name: org.name,
        cr: org.commercial_registration,
        closedBy: `${profile?.full_name ?? ''} <${profile?.email ?? actor.email ?? ''}>`,
        reason,
        closedAt,
      }),
    );
    await this.notifications.notify({ organizationId: null, userIds: [actor.userId], type: 'system', title: `${org.name} closed` });
  }
}
