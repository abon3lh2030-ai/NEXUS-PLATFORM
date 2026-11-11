import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { Env } from '../../config/env.js';
import type { OrgActor } from '../../context.js';
import { AppError, badRequest, conflict, forbidden, notFound, unwrap } from '../../lib/errors.js';
import type { Db } from '../../lib/supabase.js';
import type { AuditService } from '../audit.js';
import type { EmailService } from '../email/provider.js';
import { signatureRequestEmail } from '../email/templates.js';
import type { EntitlementService } from '../entitlements.js';
import type { FileService } from '../files/file-service.js';
import { FILES_BUCKET } from '../files/storage-keys.js';
import type { NotificationService } from '../notifications.js';
import { buildSignedPdf, loadPdf, type SignedEntry } from './signed-pdf.js';

export const MAX_SIGNERS = 20;
export const MAX_SIGNATURE_BYTES = 512 * 1024;
const ACTIVE = ['pending', 'viewed'] as const;
const DONE = ['signed', 'approved'] as const;

export interface SignatureRequestRow {
  id: string;
  organization_id: string;
  title: string;
  message: string;
  file_id: string;
  file_sha256: string;
  sequential: boolean;
  status: 'in_progress' | 'completed' | 'declined' | 'cancelled';
  due_at: string | null;
  verification_code: string;
  created_by: string;
  created_at: string;
  completed_at: string | null;
  cancelled_at: string | null;
  signed_file_id: string | null;
  failure_reason: string | null;
}

export interface SignerRow {
  id: string;
  organization_id: string;
  request_id: string;
  member_id: string;
  user_id: string;
  role: 'signer' | 'approver';
  sign_order: number;
  status: 'waiting' | 'pending' | 'viewed' | 'signed' | 'approved' | 'declined';
  signature_key: string | null;
  signature_method: 'drawn' | 'uploaded' | null;
  notified_at: string | null;
  viewed_at: string | null;
  acted_at: string | null;
  decline_reason: string | null;
  ip: string | null;
  user_agent: string | null;
}

export interface CreateSignatureInput {
  title: string;
  message: string;
  file_id: string;
  sequential: boolean;
  due_at: string | null;
  signers: Array<{ member_id: string; role: 'signer' | 'approver' }>;
}

/** Detects PNG/JPEG by their magic bytes — the declared type is never trusted. */
export function signatureImageType(bytes: Uint8Array): 'png' | 'jpg' | null {
  if (bytes.length > 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'png';
  if (bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'jpg';
  return null;
}

/** Which signers are asked to act next: everyone still waiting (parallel), or the lowest waiting order (in order). */
export function nextToNotify(signers: Array<Pick<SignerRow, 'id' | 'status' | 'sign_order'>>, sequential: boolean): string[] {
  if (signers.some((s) => s.status === 'declined')) return [];
  if (signers.some((s) => (ACTIVE as readonly string[]).includes(s.status))) return [];
  const waiting = signers.filter((s) => s.status === 'waiting');
  if (!waiting.length) return [];
  if (!sequential) return waiting.map((s) => s.id);
  const order = Math.min(...waiting.map((s) => s.sign_order));
  return waiting.filter((s) => s.sign_order === order).map((s) => s.id);
}

function verificationCode(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const b = randomBytes(8);
  const c = [...b].map((x) => alphabet[x % alphabet.length]).join('');
  return `NX-${c.slice(0, 4)}-${c.slice(4)}`;
}

/**
 * Internal e-signatures: send a PDF to employees and managers to sign (drawn or uploaded image) or
 * approve, in order or all at once, then issue a signed copy with a signature page.
 */
export class SignatureService {
  constructor(
    private readonly env: Env,
    private readonly db: Db,
    private readonly files: FileService,
    private readonly entitlements: EntitlementService,
    private readonly notifications: NotificationService,
    private readonly email: EmailService,
    private readonly audit: AuditService,
  ) {}

  /* ------------------------------ create ------------------------------ */

  async create(actor: OrgActor, input: CreateSignatureInput) {
    if (!input.signers.length || input.signers.length > MAX_SIGNERS) throw badRequest('invalid_signers');
    const file = await this.files.get(actor, input.file_id);
    if (file.status !== 'ready' || file.extension.toLowerCase() !== 'pdf') throw badRequest('pdf_required');
    const bytes = await this.download(file.storage_key, actor.orgId, Number(file.size));
    await loadPdf(bytes).catch(() => {
      throw badRequest('invalid_pdf');
    });

    const memberIds = [...new Set(input.signers.map((s) => s.member_id))];
    const { data: members } = await this.db.from('organization_members').select('id, user_id').eq('organization_id', actor.orgId).eq('status', 'active').in('id', memberIds);
    const userOf = new Map(((members ?? []) as Array<{ id: string; user_id: string }>).map((m) => [m.id, m.user_id]));
    if (userOf.size !== memberIds.length) throw badRequest('signer_not_in_organization');

    const request = unwrap(
      await this.db
        .from('signature_requests')
        .insert({
          organization_id: actor.orgId,
          title: input.title,
          message: input.message,
          file_id: file.id,
          file_sha256: createHash('sha256').update(bytes).digest('hex'),
          sequential: input.sequential,
          due_at: input.due_at,
          verification_code: verificationCode(),
          created_by: actor.userId,
        })
        .select('*')
        .single<SignatureRequestRow>(),
    );
    const seen = new Set<string>();
    const rows = input.signers
      .filter((s) => (seen.has(s.member_id) ? false : (seen.add(s.member_id), true)))
      .map((s, i) => ({ organization_id: actor.orgId, request_id: request.id, member_id: s.member_id, user_id: userOf.get(s.member_id)!, role: s.role, sign_order: input.sequential ? i + 1 : 1 }));
    unwrap(await this.db.from('signature_request_signers').insert(rows).select('id'));
    await this.audit.audit({ organizationId: actor.orgId, actorType: 'human', actorUserId: actor.userId, action: 'signature.requested', targetType: 'signature_request', targetId: request.id, metadata: { file_id: file.id, signers: rows.length, sequential: input.sequential } });
    await this.advance(request.id, actor.orgName);
    return this.get(actor, request.id);
  }

  /* ------------------------------ read ------------------------------ */

  async list(actor: OrgActor) {
    const [{ data: mine }, { data: asSigner }] = await Promise.all([
      this.db.from('signature_requests').select('id').eq('organization_id', actor.orgId).eq('created_by', actor.userId).order('created_at', { ascending: false }).limit(200),
      this.db.from('signature_request_signers').select('request_id').eq('organization_id', actor.orgId).eq('user_id', actor.userId).limit(500),
    ]);
    const ids = [...new Set([...((mine ?? []) as Array<{ id: string }>).map((r) => r.id), ...((asSigner ?? []) as Array<{ request_id: string }>).map((r) => r.request_id)])];
    if (!ids.length) return [];
    const [{ data: requests }, { data: signers }] = await Promise.all([
      this.db.from('signature_requests').select('*').in('id', ids).order('created_at', { ascending: false }),
      this.db.from('signature_request_signers').select('*').in('request_id', ids).order('sign_order'),
    ]);
    const names = await this.names([...((signers ?? []) as SignerRow[]).map((s) => s.user_id), ...((requests ?? []) as SignatureRequestRow[]).map((r) => r.created_by)]);
    return ((requests ?? []) as SignatureRequestRow[]).map((r) => {
      const list = ((signers ?? []) as SignerRow[]).filter((s) => s.request_id === r.id);
      const me = list.find((s) => s.user_id === actor.userId) ?? null;
      return {
        ...this.publicRequest(r),
        created_by_name: names.get(r.created_by) ?? '',
        is_creator: r.created_by === actor.userId,
        my_turn: Boolean(me && r.status === 'in_progress' && (ACTIVE as readonly string[]).includes(me.status)),
        my_status: me?.status ?? null,
        my_role: me?.role ?? null,
        progress: { done: list.filter((s) => (DONE as readonly string[]).includes(s.status)).length, total: list.length },
      };
    });
  }

  async get(actor: OrgActor, id: string) {
    const { request, signers } = await this.load(actor.orgId, id);
    this.assertCanView(actor, request, signers);
    const me = signers.find((s) => s.user_id === actor.userId);
    if (me && me.status === 'pending' && request.status === 'in_progress') {
      await this.db.from('signature_request_signers').update({ status: 'viewed', viewed_at: new Date().toISOString() }).eq('id', me.id);
      me.status = 'viewed';
    }
    const names = await this.names([...signers.map((s) => s.user_id), request.created_by]);
    const { data: file } = await this.db.from('company_files').select('original_name').eq('id', request.file_id).maybeSingle<{ original_name: string }>();
    return {
      ...this.publicRequest(request),
      file_name: file?.original_name ?? '',
      created_by_name: names.get(request.created_by) ?? '',
      is_creator: request.created_by === actor.userId,
      can_manage: request.created_by === actor.userId || actor.permissions.has('documents.manage'),
      my_signer_id: me?.id ?? null,
      my_role: me?.role ?? null,
      my_turn: Boolean(me && request.status === 'in_progress' && (ACTIVE as readonly string[]).includes(me.status)),
      signers: signers.map((s) => ({ id: s.id, member_id: s.member_id, name: names.get(s.user_id) ?? '', role: s.role, sign_order: s.sign_order, status: s.status, acted_at: s.acted_at, viewed_at: s.viewed_at, decline_reason: s.decline_reason })),
    };
  }

  /** The original (or the signed copy) as PDF bytes, for anyone taking part in the request. */
  async document(actor: OrgActor, id: string, which: 'original' | 'signed'): Promise<{ bytes: Uint8Array; name: string }> {
    const { request, signers } = await this.load(actor.orgId, id);
    this.assertCanView(actor, request, signers);
    const fileId = which === 'signed' ? request.signed_file_id : request.file_id;
    if (!fileId) throw notFound('signed_document_not_ready');
    const { data: file } = await this.db.from('company_files').select('storage_key, size, original_name').eq('id', fileId).maybeSingle<{ storage_key: string; size: number; original_name: string }>();
    if (!file) throw notFound('file_not_found');
    return { bytes: await this.download(file.storage_key, actor.orgId, Number(file.size)), name: file.original_name };
  }

  /* ------------------------------ act ------------------------------ */

  async sign(actor: OrgActor, id: string, input: { image_base64?: string | undefined; use_saved?: boolean | undefined; method: 'drawn' | 'uploaded'; save_as_default?: boolean | undefined }, meta: { ip: string | null; userAgent: string | null }) {
    const { request, me } = await this.myTurn(actor, id);
    if (me.role !== 'signer') throw badRequest('approver_cannot_sign');

    let bytes: Uint8Array;
    let method = input.method;
    if (input.use_saved) {
      const { data: saved } = await this.db.from('user_signatures').select('storage_key').eq('user_id', actor.userId).maybeSingle<{ storage_key: string }>();
      if (!saved) throw badRequest('no_saved_signature');
      bytes = await this.download(saved.storage_key);
      method = saved.storage_key.endsWith('.drawn.png') ? 'drawn' : 'uploaded';
    } else {
      bytes = this.decodeImage(input.image_base64);
    }
    const type = signatureImageType(bytes);
    if (!type) throw badRequest('signature_must_be_png_or_jpeg');

    const key = `signatures/${request.organization_id}/${request.id}/${me.id}.${type}`;
    await this.upload(key, bytes, type);
    if (input.save_as_default && !input.use_saved) await this.saveDefault(actor.userId, bytes, type, method);

    // Conditional update: two concurrent clicks can't both sign.
    const { data: updated } = await this.db
      .from('signature_request_signers')
      .update({ status: 'signed', signature_key: key, signature_method: method, acted_at: new Date().toISOString(), ip: meta.ip, user_agent: meta.userAgent?.slice(0, 500) ?? null })
      .eq('id', me.id)
      .in('status', [...ACTIVE])
      .select('id');
    if (!(updated ?? []).length) throw conflict('already_acted');
    await this.audit.audit({ organizationId: request.organization_id, actorType: 'human', actorUserId: actor.userId, action: 'signature.signed', targetType: 'signature_request', targetId: request.id, metadata: { method } });
    await this.advance(request.id, actor.orgName);
    return this.get(actor, id);
  }

  async approve(actor: OrgActor, id: string, meta: { ip: string | null; userAgent: string | null }) {
    const { request, me } = await this.myTurn(actor, id);
    if (me.role !== 'approver') throw badRequest('signer_must_sign');
    const { data: updated } = await this.db
      .from('signature_request_signers')
      .update({ status: 'approved', acted_at: new Date().toISOString(), ip: meta.ip, user_agent: meta.userAgent?.slice(0, 500) ?? null })
      .eq('id', me.id)
      .in('status', [...ACTIVE])
      .select('id');
    if (!(updated ?? []).length) throw conflict('already_acted');
    await this.audit.audit({ organizationId: request.organization_id, actorType: 'human', actorUserId: actor.userId, action: 'signature.approved', targetType: 'signature_request', targetId: request.id });
    await this.advance(request.id, actor.orgName);
    return this.get(actor, id);
  }

  async decline(actor: OrgActor, id: string, reason: string, meta: { ip: string | null; userAgent: string | null }) {
    const { request, me, signers } = await this.myTurn(actor, id);
    const now = new Date().toISOString();
    await this.db.from('signature_request_signers').update({ status: 'declined', decline_reason: reason, acted_at: now, ip: meta.ip, user_agent: meta.userAgent?.slice(0, 500) ?? null }).eq('id', me.id);
    await this.db.from('signature_requests').update({ status: 'declined' }).eq('id', request.id).eq('status', 'in_progress');
    await this.audit.audit({ organizationId: request.organization_id, actorType: 'human', actorUserId: actor.userId, action: 'signature.declined', targetType: 'signature_request', targetId: request.id, metadata: { reason } });
    await this.notifications.notify({ organizationId: request.organization_id, userIds: [request.created_by, ...signers.filter((s) => s.id !== me.id).map((s) => s.user_id)], type: 'signature_declined', title: request.title, body: reason, link: `/app/signatures/${request.id}` });
    return this.get(actor, id);
  }

  async cancel(actor: OrgActor, id: string) {
    const { request, signers } = await this.load(actor.orgId, id);
    this.assertCanManage(actor, request);
    if (request.status !== 'in_progress') throw conflict('not_in_progress');
    await this.db.from('signature_requests').update({ status: 'cancelled', cancelled_at: new Date().toISOString() }).eq('id', id);
    await this.audit.audit({ organizationId: actor.orgId, actorType: 'human', actorUserId: actor.userId, action: 'signature.cancelled', targetType: 'signature_request', targetId: id });
    await this.notifications.notify({ organizationId: actor.orgId, userIds: signers.filter((s) => s.status !== 'waiting').map((s) => s.user_id), type: 'system', title: request.title, body: 'cancelled', link: `/app/signatures/${id}` });
    return this.get(actor, id);
  }

  /** Re-notifies whoever still has to act. */
  async remind(actor: OrgActor, id: string) {
    const { request, signers } = await this.load(actor.orgId, id);
    this.assertCanManage(actor, request);
    if (request.status !== 'in_progress') throw conflict('not_in_progress');
    const active = signers.filter((s) => (ACTIVE as readonly string[]).includes(s.status));
    await this.notifySigners(request, active, actor.orgName);
    return { reminded: active.length };
  }

  /** Retries issuing the signed copy if it failed after everyone signed. */
  async finalizeAgain(actor: OrgActor, id: string) {
    const { request, signers } = await this.load(actor.orgId, id);
    this.assertCanManage(actor, request);
    if (request.status !== 'in_progress' || !signers.every((s) => (DONE as readonly string[]).includes(s.status))) throw conflict('not_ready');
    await this.finalize(request.id, actor.orgName);
    return this.get(actor, id);
  }

  /* ------------------------------ saved signature ------------------------------ */

  async savedSignature(actor: OrgActor) {
    const { data } = await this.db.from('user_signatures').select('storage_key, updated_at').eq('user_id', actor.userId).maybeSingle<{ storage_key: string; updated_at: string }>();
    if (!data) return { saved: false as const };
    const bytes = await this.download(data.storage_key);
    const type = signatureImageType(bytes) ?? 'png';
    return { saved: true as const, image: `data:image/${type === 'png' ? 'png' : 'jpeg'};base64,${Buffer.from(bytes).toString('base64')}`, updated_at: data.updated_at };
  }

  async deleteSavedSignature(actor: OrgActor) {
    const { data } = await this.db.from('user_signatures').select('storage_key').eq('user_id', actor.userId).maybeSingle<{ storage_key: string }>();
    if (!data) return;
    await this.db.storage.from(FILES_BUCKET).remove([data.storage_key]);
    await this.db.from('user_signatures').delete().eq('user_id', actor.userId);
  }

  /** Verification by code for organization members (e.g. to check a printed copy). */
  async verify(actor: OrgActor, code: string) {
    const { data } = await this.db.from('signature_requests').select('*').eq('organization_id', actor.orgId).eq('verification_code', code.trim().toUpperCase()).maybeSingle<SignatureRequestRow>();
    if (!data) throw notFound('verification_code_not_found');
    const { data: signers } = await this.db.from('signature_request_signers').select('user_id, role, status, acted_at').eq('request_id', data.id).order('sign_order');
    const rows = (signers ?? []) as Array<{ user_id: string; role: string; status: string; acted_at: string | null }>;
    const names = await this.names(rows.map((s) => s.user_id));
    return { id: data.id, title: data.title, status: data.status, completed_at: data.completed_at, file_sha256: data.file_sha256, signers: rows.map((s) => ({ name: names.get(s.user_id) ?? '', role: s.role, status: s.status, acted_at: s.acted_at })) };
  }

  /* ------------------------------ flow ------------------------------ */

  /** Moves the request forward: asks the next signers, or issues the signed copy when everyone is done. */
  private async advance(requestId: string, orgName: string): Promise<void> {
    const { data: request } = await this.db.from('signature_requests').select('*').eq('id', requestId).single<SignatureRequestRow>();
    if (!request || request.status !== 'in_progress') return;
    const { data } = await this.db.from('signature_request_signers').select('*').eq('request_id', requestId).order('sign_order');
    const signers = (data ?? []) as SignerRow[];
    if (signers.length && signers.every((s) => (DONE as readonly string[]).includes(s.status))) {
      await this.finalize(requestId, orgName);
      return;
    }
    const next = nextToNotify(signers, request.sequential);
    if (!next.length) return;
    await this.db.from('signature_request_signers').update({ status: 'pending', notified_at: new Date().toISOString() }).in('id', next).eq('status', 'waiting');
    await this.notifySigners(request, signers.filter((s) => next.includes(s.id)), orgName);
  }

  private async finalize(requestId: string, orgName: string): Promise<void> {
    const { data: request } = await this.db.from('signature_requests').select('*').eq('id', requestId).single<SignatureRequestRow>();
    if (!request || request.status !== 'in_progress') return;
    try {
      const { data: file } = await this.db.from('company_files').select('storage_key, original_name, folder_id').eq('id', request.file_id).single<{ storage_key: string; original_name: string; folder_id: string | null }>();
      if (!file) throw new AppError(409, 'document_missing');
      const original = await this.download(file.storage_key);
      if (createHash('sha256').update(original).digest('hex') !== request.file_sha256) throw new AppError(409, 'document_changed');

      const { data } = await this.db.from('signature_request_signers').select('*').eq('request_id', requestId).order('sign_order').order('acted_at');
      const signers = (data ?? []) as SignerRow[];
      const names = await this.names(signers.map((s) => s.user_id));
      const entries: SignedEntry[] = [];
      for (const s of signers) {
        let image: SignedEntry['image'] = null;
        if (s.signature_key) {
          const bytes = await this.download(s.signature_key);
          const type = signatureImageType(bytes);
          if (type) image = { bytes, type };
        }
        entries.push({ name: names.get(s.user_id) ?? '', role: s.role, actedAt: new Date(s.acted_at ?? Date.now()), ip: s.ip, method: s.signature_method, image });
      }
      const completedAt = new Date();
      const pdf = await buildSignedPdf(original, { orgName, title: request.title, documentName: file.original_name.replace(/\.pdf$/i, ''), verificationCode: request.verification_code, sha256: request.file_sha256, completedAt }, entries);
      const base = file.original_name.replace(/\.pdf$/i, '');
      const signed = await this.files.writeSharedBinary({ orgId: request.organization_id, userId: request.created_by, folderId: file.folder_id }, `${base} - موقّع.pdf`, pdf);
      await this.db.from('signature_requests').update({ status: 'completed', completed_at: completedAt.toISOString(), signed_file_id: signed.id, failure_reason: null }).eq('id', requestId).eq('status', 'in_progress');
      await this.audit.audit({ organizationId: request.organization_id, actorType: 'system', action: 'signature.completed', targetType: 'signature_request', targetId: requestId, metadata: { signed_file_id: signed.id } });
      await this.notifications.notify({ organizationId: request.organization_id, userIds: [request.created_by, ...signers.map((s) => s.user_id)], type: 'signature_completed', title: request.title, link: `/app/signatures/${requestId}` });
    } catch (err) {
      const reason = err instanceof AppError ? err.code : 'finalize_failed';
      await this.db.from('signature_requests').update({ failure_reason: reason }).eq('id', requestId);
      await this.notifications.notify({ organizationId: request.organization_id, userIds: [request.created_by], type: 'system', title: request.title, body: reason, link: `/app/signatures/${requestId}` });
    }
  }

  private async notifySigners(request: SignatureRequestRow, signers: SignerRow[], orgName: string): Promise<void> {
    if (!signers.length) return;
    const link = `/app/signatures/${request.id}`;
    await this.notifications.notify({ organizationId: request.organization_id, userIds: signers.map((s) => s.user_id), type: 'signature_requested', title: request.title, body: request.message.slice(0, 300), link });
    const names = await this.names([request.created_by]);
    const { data: profiles } = await this.db.from('profiles').select('id, email').in('id', signers.map((s) => s.user_id));
    for (const p of (profiles ?? []) as Array<{ id: string; email: string | null }>) {
      if (p.email) await this.email.send(signatureRequestEmail(p.email, orgName, request.title, names.get(request.created_by) ?? '', `${this.env.PUBLIC_APP_URL}${link}`));
    }
  }

  /* ------------------------------ helpers ------------------------------ */

  private publicRequest(r: SignatureRequestRow) {
    return { id: r.id, title: r.title, message: r.message, status: r.status, sequential: r.sequential, due_at: r.due_at, verification_code: r.verification_code, created_at: r.created_at, completed_at: r.completed_at, signed_file_id: r.signed_file_id, failure_reason: r.failure_reason, file_id: r.file_id };
  }

  private async load(orgId: string, id: string): Promise<{ request: SignatureRequestRow; signers: SignerRow[] }> {
    const { data: request } = await this.db.from('signature_requests').select('*').eq('id', id).eq('organization_id', orgId).maybeSingle<SignatureRequestRow>();
    if (!request) throw notFound('signature_request_not_found');
    const { data } = await this.db.from('signature_request_signers').select('*').eq('request_id', id).order('sign_order');
    return { request, signers: (data ?? []) as SignerRow[] };
  }

  private assertCanView(actor: OrgActor, request: SignatureRequestRow, signers: SignerRow[]) {
    if (request.created_by === actor.userId || signers.some((s) => s.user_id === actor.userId) || actor.permissions.has('documents.manage')) return;
    // Same 404 as a missing request, so IDs can't be probed.
    throw notFound('signature_request_not_found');
  }

  private assertCanManage(actor: OrgActor, request: SignatureRequestRow) {
    if (request.created_by !== actor.userId && !actor.permissions.has('documents.manage')) throw forbidden('cannot_manage_signature_request');
  }

  private async myTurn(actor: OrgActor, id: string) {
    const { request, signers } = await this.load(actor.orgId, id);
    if (request.status !== 'in_progress') throw conflict('not_in_progress');
    const me = signers.find((s) => s.user_id === actor.userId);
    if (!me) throw notFound('signature_request_not_found');
    if (!(ACTIVE as readonly string[]).includes(me.status)) throw conflict(me.status === 'waiting' ? 'not_your_turn' : 'already_acted');
    return { request, signers, me };
  }

  private decodeImage(b64: string | undefined): Uint8Array {
    if (!b64) throw badRequest('signature_required');
    const clean = b64.replace(/^data:image\/(png|jpeg|jpg);base64,/, '');
    if (clean.length > Math.ceil((MAX_SIGNATURE_BYTES * 4) / 3) + 8) throw badRequest('signature_too_large');
    const bytes = Buffer.from(clean, 'base64');
    if (!bytes.length || bytes.length > MAX_SIGNATURE_BYTES) throw badRequest('signature_too_large');
    return bytes;
  }

  private async saveDefault(userId: string, bytes: Uint8Array, type: 'png' | 'jpg', method: 'drawn' | 'uploaded') {
    const { data: old } = await this.db.from('user_signatures').select('storage_key').eq('user_id', userId).maybeSingle<{ storage_key: string }>();
    const key = `signatures/users/${userId}/${randomUUID()}${method === 'drawn' ? '.drawn' : ''}.${type}`;
    await this.upload(key, bytes, type);
    await this.db.from('user_signatures').upsert({ user_id: userId, storage_key: key, updated_at: new Date().toISOString() });
    if (old) await this.db.storage.from(FILES_BUCKET).remove([old.storage_key]);
  }

  private async upload(key: string, bytes: Uint8Array, type: 'png' | 'jpg') {
    const { error } = await this.db.storage.from(FILES_BUCKET).upload(key, Buffer.from(bytes), { contentType: type === 'png' ? 'image/png' : 'image/jpeg', upsert: true });
    if (error) throw new AppError(502, 'storage_unavailable', error.message);
  }

  /** Reads from storage; when on behalf of an organization, counts toward its monthly file-transfer allowance. */
  private async download(key: string, orgId?: string, size?: number): Promise<Uint8Array> {
    if (orgId && size) await this.entitlements.consume(orgId, await this.entitlements.getBillingState(orgId), 'download_bytes_per_month', size);
    const { data, error } = await this.db.storage.from(FILES_BUCKET).download(key);
    if (error || !data) throw notFound('file_not_found');
    return new Uint8Array(await data.arrayBuffer());
  }

  private async names(userIds: string[]): Promise<Map<string, string>> {
    const ids = [...new Set(userIds)];
    if (!ids.length) return new Map();
    const { data } = await this.db.from('profiles').select('id, full_name, email').in('id', ids);
    return new Map(((data ?? []) as Array<{ id: string; full_name: string; email: string | null }>).map((p) => [p.id, p.full_name || p.email || '—']));
  }
}
