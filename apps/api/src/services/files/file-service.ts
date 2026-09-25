import { createHash } from 'node:crypto';
import {
  findAllowedTypeByExtension,
  getExtension,
  sanitizeFileName,
  sanitizeFolderName,
  verifyFileContent,
  type FileLinkEntityType,
} from '@nexus/shared';
import type { Env } from '../../config/env.js';
import type { AiActor, OrgActor } from '../../context.js';
import { AppError, badRequest, conflict, forbidden, notFound, paymentRequired, tooLarge, unwrap } from '../../lib/errors.js';
import { createUserClient, type Db } from '../../lib/supabase.js';
import type { FileRow, FolderRow } from '../../types/db.js';
import type { AuditService } from '../audit.js';
import type { EntitlementService } from '../entitlements.js';
import {
  aiCanReadFile,
  canDownloadFile,
  canManageFile,
  canPurgeFile,
  canUploadTo,
  canUseFolder,
  canViewFile,
  isPrivate,
} from './access-policy.js';
import type { MalwareScanner } from './scanner.js';
import { buildStorageKey, FILES_BUCKET } from './storage-keys.js';

const SIGNED_DOWNLOAD_TTL_SECONDS = 60;
const SNIFF_BYTES = 8192;
const MAX_PREVIEW_BYTES = 25 * 1024 * 1024;
const MAX_TEXT_PREVIEW_BYTES = 1024 * 1024;

export type ListSpace = 'shared' | 'private' | 'trash' | 'recent';

export interface ListFilesQuery {
  space: ListSpace;
  folder_id?: string | undefined;
  flat?: '1' | undefined;
  q?: string | undefined;
  category?: string | undefined;
  uploader?: string | undefined;
  from?: string | undefined;
  to?: string | undefined;
  sort: 'name' | 'created_at' | 'updated_at' | 'size';
  order: 'asc' | 'desc';
}

const FILE_COLUMNS =
  'id,organization_id,space,visibility,owner_user_id,uploaded_by_user_id,uploaded_by_ai_employee_id,ai_employee_id,folder_id,original_name,extension,storage_key,mime_type,category,size,checksum_sha256,status,scan_status,failure_reason,created_at,updated_at,deleted_at,deleted_by,purged_at';

export class FileService {
  constructor(
    private readonly env: Env,
    private readonly db: Db,
    private readonly entitlements: EntitlementService,
    private readonly audit: AuditService,
    private readonly scanner: MalwareScanner,
  ) {}

  /* ----------------------------- helpers ----------------------------- */

  private userDb(actor: OrgActor): Db {
    return createUserClient(this.env, actor.token);
  }

  /** Loads a file through the CALLER's JWT (RLS applies) and then applies API rules on top. */
  private async loadVisibleFile(actor: OrgActor, fileId: string, opts: { includeDeleted?: boolean } = {}): Promise<FileRow> {
    let q = this.userDb(actor).from('company_files').select(FILE_COLUMNS).eq('id', fileId).eq('organization_id', actor.orgId).is('purged_at', null);
    if (!opts.includeDeleted) q = q.is('deleted_at', null);
    const { data } = await q.maybeSingle<FileRow>();
    // Same response for "doesn't exist" and "not yours" — do not leak existence.
    if (!data || !canViewFile(actor, data)) throw notFound('file_not_found');
    return data;
  }

  private async loadFolder(actor: OrgActor, folderId: string): Promise<FolderRow> {
    const { data } = await this.userDb(actor)
      .from('company_file_folders')
      .select('*')
      .eq('id', folderId)
      .eq('organization_id', actor.orgId)
      .maybeSingle<FolderRow>();
    if (!data) throw notFound('folder_not_found');
    return data;
  }

  private async logActivity(
    file: Pick<FileRow, 'id' | 'organization_id' | 'space' | 'owner_user_id'> | null,
    action: string,
    actor: { userId?: string; aiEmployeeId?: string },
    metadata: Record<string, unknown> = {},
    folder?: Pick<FolderRow, 'id' | 'organization_id' | 'space' | 'owner_user_id'>,
  ): Promise<void> {
    const subject = file ?? folder;
    if (!subject) return;
    await this.db.from('file_activity_events').insert({
      organization_id: subject.organization_id,
      file_id: file?.id ?? null,
      folder_id: folder?.id ?? null,
      space: subject.space,
      owner_user_id: subject.owner_user_id,
      action,
      actor_user_id: actor.userId ?? null,
      actor_ai_employee_id: actor.aiEmployeeId ?? null,
      metadata,
    });
  }

  private assertPaid(actor: OrgActor): void {
    if (!actor.billing.active) throw paymentRequired('subscription_required');
  }

  /* ----------------------------- folders ----------------------------- */

  async listFolders(actor: OrgActor, space: 'shared' | 'private', parentId: string | null): Promise<FolderRow[]> {
    if (space === 'private' && !actor.permissions.has('files.private.use')) throw forbidden('private_files_not_allowed');
    let q = this.userDb(actor)
      .from('company_file_folders')
      .select('*')
      .eq('organization_id', actor.orgId)
      .eq('space', space)
      .is('deleted_at', null)
      .order('name');
    q = parentId ? q.eq('parent_id', parentId) : q.is('parent_id', null);
    if (space === 'private') q = q.eq('owner_user_id', actor.userId);
    const { data, error } = await q;
    if (error) throw new AppError(500, 'database_error', error.message);
    return (data ?? []) as FolderRow[];
  }

  async breadcrumbs(actor: OrgActor, folderId: string): Promise<Array<{ id: string; name: string }>> {
    const trail: Array<{ id: string; name: string }> = [];
    let current: string | null = folderId;
    for (let i = 0; current && i < 20; i++) {
      const folder = await this.loadFolder(actor, current);
      trail.unshift({ id: folder.id, name: folder.name });
      current = folder.parent_id;
    }
    return trail;
  }

  async createFolder(actor: OrgActor, input: { space: 'shared' | 'private'; name: string; parent_id?: string | null | undefined }): Promise<FolderRow> {
    this.assertPaid(actor);
    if (!canUploadTo(actor, input.space)) throw forbidden('cannot_create_folder');
    const name = sanitizeFolderName(input.name);
    if (!name) throw badRequest('invalid_folder_name');
    if (input.parent_id) {
      const parent = await this.loadFolder(actor, input.parent_id);
      if (!canUseFolder(actor, parent, input.space)) throw notFound('folder_not_found');
    }
    const row = unwrap(
      await this.db
        .from('company_file_folders')
        .insert({
          organization_id: actor.orgId,
          space: input.space,
          visibility: input.space === 'private' ? 'private_owner' : 'organization_shared',
          owner_user_id: input.space === 'private' ? actor.userId : null,
          parent_id: input.parent_id ?? null,
          name,
          created_by_user_id: actor.userId,
        })
        .select('*')
        .single<FolderRow>(),
    );
    await this.logActivity(null, 'folder_created', { userId: actor.userId }, { name }, row);
    return row;
  }

  async renameFolder(actor: OrgActor, folderId: string, name: string): Promise<FolderRow> {
    const folder = await this.loadFolder(actor, folderId);
    this.assertFolderManage(actor, folder);
    const clean = sanitizeFolderName(name);
    if (!clean) throw badRequest('invalid_folder_name');
    const row = unwrap(await this.db.from('company_file_folders').update({ name: clean }).eq('id', folder.id).select('*').single<FolderRow>());
    await this.logActivity(null, 'renamed', { userId: actor.userId }, { from: folder.name, to: clean }, row);
    return row;
  }

  async deleteFolder(actor: OrgActor, folderId: string): Promise<void> {
    const folder = await this.loadFolder(actor, folderId);
    this.assertFolderManage(actor, folder);
    const [files, children] = await Promise.all([
      this.db.from('company_files').select('id', { count: 'exact', head: true }).eq('folder_id', folder.id).is('deleted_at', null),
      this.db.from('company_file_folders').select('id', { count: 'exact', head: true }).eq('parent_id', folder.id).is('deleted_at', null),
    ]);
    if ((files.count ?? 0) > 0 || (children.count ?? 0) > 0) throw conflict('folder_not_empty');
    await this.db.from('company_file_folders').update({ deleted_at: new Date().toISOString(), deleted_by: actor.userId }).eq('id', folder.id);
    await this.logActivity(null, 'deleted', { userId: actor.userId }, { name: folder.name }, folder);
  }

  private assertFolderManage(actor: OrgActor, folder: FolderRow): void {
    if (folder.space === 'private') {
      if (folder.owner_user_id !== actor.userId) throw notFound('folder_not_found');
      return;
    }
    if (folder.space !== 'shared') throw forbidden();
    if (!actor.permissions.has('files.shared.manage_all') && folder.created_by_user_id !== actor.userId) throw forbidden('cannot_manage_folder');
  }

  /* ----------------------------- listing ----------------------------- */

  async list(actor: OrgActor, query: ListFilesQuery): Promise<{ files: Array<FileRow & { uploader_name: string | null }> }> {
    const db = this.userDb(actor);
    let q = db.from('company_files').select(FILE_COLUMNS).eq('organization_id', actor.orgId).is('purged_at', null);

    switch (query.space) {
      case 'shared':
        if (!actor.permissions.has('files.shared.view')) throw forbidden();
        q = q.eq('space', 'shared').is('deleted_at', null).eq('status', 'ready');
        q = query.folder_id ? q.eq('folder_id', query.folder_id) : query.q || query.flat ? q : q.is('folder_id', null);
        break;
      case 'private':
        if (!actor.permissions.has('files.private.use')) throw forbidden('private_files_not_allowed');
        q = q.eq('space', 'private').eq('owner_user_id', actor.userId).is('deleted_at', null).eq('status', 'ready');
        q = query.folder_id ? q.eq('folder_id', query.folder_id) : query.q || query.flat ? q : q.is('folder_id', null);
        break;
      case 'trash': {
        q = q.not('deleted_at', 'is', null);
        // Own private trash + shared trash the actor may manage.
        const canSeeSharedTrash = actor.permissions.has('files.shared.manage_all');
        q = canSeeSharedTrash
          ? q.or(`and(space.eq.private,owner_user_id.eq.${actor.userId}),space.eq.shared`)
          : q.or(`and(space.eq.private,owner_user_id.eq.${actor.userId}),and(space.eq.shared,uploaded_by_user_id.eq.${actor.userId})`);
        break;
      }
      case 'recent':
        q = q
          .is('deleted_at', null)
          .eq('status', 'ready')
          .or(`space.eq.shared,and(space.eq.private,owner_user_id.eq.${actor.userId})`)
          .gte('updated_at', new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString());
        break;
    }

    if (query.q) q = q.ilike('original_name', `%${query.q.replace(/[%_\\]/g, (m) => `\\${m}`)}%`);
    if (query.category) q = q.eq('category', query.category);
    if (query.uploader) q = q.eq('uploaded_by_user_id', query.uploader);
    if (query.from) q = q.gte('created_at', `${query.from}T00:00:00Z`);
    if (query.to) q = q.lte('created_at', `${query.to}T23:59:59Z`);
    const sortCol = query.sort === 'name' ? 'original_name' : query.sort;
    q = q.order(query.space === 'trash' ? 'deleted_at' : sortCol, { ascending: query.order === 'asc' }).limit(500);

    const { data, error } = await q;
    if (error) throw new AppError(500, 'database_error', error.message);
    const files = ((data ?? []) as FileRow[]).filter((f) => canViewFile(actor, f));
    const names = await this.profileNames(files.map((f) => f.uploaded_by_user_id).filter((v): v is string => Boolean(v)));
    return { files: files.map((f) => ({ ...f, uploader_name: f.uploaded_by_user_id ? (names.get(f.uploaded_by_user_id) ?? null) : null })) };
  }

  async recentlyViewed(actor: OrgActor): Promise<FileRow[]> {
    const { data } = await this.userDb(actor)
      .from('file_recent_views')
      .select('file_id, viewed_at')
      .eq('organization_id', actor.orgId)
      .order('viewed_at', { ascending: false })
      .limit(20);
    const ids = ((data ?? []) as Array<{ file_id: string }>).map((r) => r.file_id);
    if (ids.length === 0) return [];
    const { data: files } = await this.userDb(actor).from('company_files').select(FILE_COLUMNS).in('id', ids).is('deleted_at', null);
    const byId = new Map(((files ?? []) as FileRow[]).map((f) => [f.id, f]));
    return ids.map((id) => byId.get(id)).filter((f): f is FileRow => Boolean(f) && canViewFile(actor, f!));
  }

  private async profileNames(ids: string[]): Promise<Map<string, string>> {
    const unique = [...new Set(ids)];
    if (unique.length === 0) return new Map();
    const { data } = await this.db.from('profiles').select('id, full_name').in('id', unique);
    return new Map(((data ?? []) as Array<{ id: string; full_name: string }>).map((p) => [p.id, p.full_name]));
  }

  async get(actor: OrgActor, fileId: string): Promise<FileRow> {
    return this.loadVisibleFile(actor, fileId, { includeDeleted: true });
  }

  /* ----------------------------- upload ----------------------------- */

  async initUpload(
    actor: OrgActor,
    input: { space: 'shared' | 'private'; folder_id?: string | null | undefined; file_name: string; size: number; declared_mime?: string | undefined },
  ): Promise<{ file_id: string; upload_url: string; token: string; path: string; max_size: number }> {
    this.assertPaid(actor);
    if (!canUploadTo(actor, input.space)) throw forbidden('cannot_upload');

    const name = sanitizeFileName(input.file_name);
    const type = findAllowedTypeByExtension(name);
    if (!type) throw badRequest('unsupported_file_type');
    if (type.category === 'archive' && !actor.billing.entitlements.features.includes('archive_uploads')) {
      throw badRequest('archives_not_allowed_on_plan');
    }

    const maxSize = actor.billing.entitlements.max_file_size_bytes ?? Number.MAX_SAFE_INTEGER;
    if (input.size > maxSize) throw tooLarge('file_too_large', { max_size: maxSize });
    await this.entitlements.assertWithinLimit(actor.orgId, actor.billing, 'storage_bytes', input.size);

    if (input.folder_id) {
      const folder = await this.loadFolder(actor, input.folder_id);
      if (!canUseFolder(actor, folder, input.space)) throw notFound('folder_not_found');
    }

    const { fileId, key } =
      input.space === 'private'
        ? buildStorageKey({ space: 'private', orgId: actor.orgId, ownerUserId: actor.userId })
        : buildStorageKey({ space: 'shared', orgId: actor.orgId });

    unwrap(
      await this.db
        .from('company_files')
        .insert({
          id: fileId,
          organization_id: actor.orgId,
          space: input.space,
          visibility: input.space === 'private' ? 'private_owner' : 'organization_shared',
          owner_user_id: input.space === 'private' ? actor.userId : null,
          uploaded_by_user_id: actor.userId,
          folder_id: input.folder_id ?? null,
          original_name: name,
          extension: getExtension(name),
          storage_key: key,
          mime_type: type.mime,
          category: type.category,
          size: input.size,
          status: 'uploading',
        })
        .select('id')
        .single(),
    );

    const { data, error } = await this.db.storage.from(FILES_BUCKET).createSignedUploadUrl(key);
    if (error || !data) {
      await this.db.from('company_files').update({ status: 'failed', failure_reason: 'signed_upload_failed' }).eq('id', fileId);
      throw new AppError(502, 'storage_unavailable', error?.message);
    }
    return { file_id: fileId, upload_url: data.signedUrl, token: data.token, path: data.path, max_size: maxSize };
  }

  /**
   * Called after the browser finished uploading. The server streams the stored object, sniffs the
   * real content type, measures the real size and computes a SHA-256 checksum. Anything that doesn't
   * match policy is deleted from storage and marked failed.
   */
  async completeUpload(actor: OrgActor, fileId: string): Promise<FileRow> {
    const { data: file } = await this.db
      .from('company_files')
      .select(FILE_COLUMNS)
      .eq('id', fileId)
      .eq('organization_id', actor.orgId)
      .maybeSingle<FileRow>();
    if (!file || file.uploaded_by_user_id !== actor.userId) throw notFound('file_not_found');
    if (file.status === 'ready') return file;
    if (file.status !== 'uploading') throw conflict('upload_not_pending');

    await this.db.from('company_files').update({ status: 'processing' }).eq('id', file.id);
    const verdict = await this.inspectStoredObject(file, actor.billing.entitlements.max_file_size_bytes, actor.billing.entitlements.features.includes('archive_uploads'));
    if (!verdict.ok) {
      await this.db.storage.from(FILES_BUCKET).remove([file.storage_key]);
      await this.db.from('company_files').update({ status: 'failed', failure_reason: verdict.reason, deleted_at: new Date().toISOString() }).eq('id', file.id);
      throw badRequest(verdict.reason);
    }

    const scan = await this.scanner.scan({ storageKey: file.storage_key, size: verdict.size, mimeType: file.mime_type });
    if (scan === 'infected') {
      await this.db.storage.from(FILES_BUCKET).remove([file.storage_key]);
      await this.db.from('company_files').update({ status: 'failed', scan_status: 'infected', failure_reason: 'malware_detected', deleted_at: new Date().toISOString() }).eq('id', file.id);
      throw badRequest('malware_detected');
    }

    const updated = unwrap(
      await this.db
        .from('company_files')
        .update({ status: 'ready', size: verdict.size, checksum_sha256: verdict.checksum, scan_status: scan })
        .eq('id', file.id)
        .select(FILE_COLUMNS)
        .single<FileRow>(),
    );
    await this.logActivity(updated, 'uploaded', { userId: actor.userId }, { size: verdict.size });
    return updated;
  }

  private async inspectStoredObject(
    file: Pick<FileRow, 'storage_key' | 'original_name'>,
    maxSize: number | null,
    allowArchives: boolean,
  ): Promise<{ ok: true; size: number; checksum: string } | { ok: false; reason: string }> {
    const { data: signed } = await this.db.storage.from(FILES_BUCKET).createSignedUrl(file.storage_key, 60);
    if (!signed) return { ok: false, reason: 'upload_missing' };
    const res = await fetch(signed.signedUrl, { signal: AbortSignal.timeout(120_000) });
    if (!res.ok || !res.body) return { ok: false, reason: 'upload_missing' };

    const hash = createHash('sha256');
    const head = new Uint8Array(SNIFF_BYTES);
    let headLen = 0;
    let size = 0;
    const reader = res.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (maxSize !== null && size > maxSize) {
        await reader.cancel();
        return { ok: false, reason: 'file_too_large' };
      }
      hash.update(value);
      if (headLen < SNIFF_BYTES) {
        const take = Math.min(SNIFF_BYTES - headLen, value.byteLength);
        head.set(value.subarray(0, take), headLen);
        headLen += take;
      }
    }
    if (size === 0) return { ok: false, reason: 'empty_file' };
    const verdict = verifyFileContent(file.original_name, head.subarray(0, headLen), { allowArchives });
    if (!verdict.ok) return { ok: false, reason: verdict.reason ?? 'unsupported_file_type' };
    return { ok: true, size, checksum: hash.digest('hex') };
  }

  /* ----------------------------- read / download ----------------------------- */

  /** Short-lived signed URL minted with the CALLER's JWT, so Storage policies are enforced too. */
  async getDownloadUrl(actor: OrgActor, fileId: string): Promise<{ url: string; expires_in: number }> {
    this.assertPaid(actor);
    const file = await this.loadVisibleFile(actor, fileId);
    if (file.status !== 'ready') throw conflict('file_not_ready');
    if (!canDownloadFile(actor, file)) throw forbidden('cannot_download');
    const { data, error } = await this.userDb(actor)
      .storage.from(FILES_BUCKET)
      .createSignedUrl(file.storage_key, SIGNED_DOWNLOAD_TTL_SECONDS, { download: file.original_name });
    if (error || !data) throw notFound('file_not_found');
    await this.logActivity(file, 'downloaded', { userId: actor.userId });
    await this.markViewed(actor, file);
    return { url: data.signedUrl, expires_in: SIGNED_DOWNLOAD_TTL_SECONDS };
  }

  /** Streams file bytes for in-app preview (images, PDF, text) with safe headers. */
  async getPreview(actor: OrgActor, fileId: string): Promise<{ body: Buffer; mime: string; name: string }> {
    this.assertPaid(actor);
    const file = await this.loadVisibleFile(actor, fileId);
    if (file.status !== 'ready') throw conflict('file_not_ready');
    const type = findAllowedTypeByExtension(file.original_name);
    if (!type?.previewable) throw badRequest('preview_not_supported');
    const limit = type.category === 'text' || type.mime === 'text/csv' ? MAX_TEXT_PREVIEW_BYTES : MAX_PREVIEW_BYTES;
    if (file.size > limit) throw tooLarge('preview_too_large');
    const { data, error } = await this.userDb(actor).storage.from(FILES_BUCKET).download(file.storage_key);
    if (error || !data) throw notFound('file_not_found');
    await this.logActivity(file, 'viewed', { userId: actor.userId });
    await this.markViewed(actor, file);
    return { body: Buffer.from(await data.arrayBuffer()), mime: type.mime, name: file.original_name };
  }

  private async markViewed(actor: OrgActor, file: FileRow): Promise<void> {
    await this.db
      .from('file_recent_views')
      .upsert({ user_id: actor.userId, file_id: file.id, organization_id: actor.orgId, viewed_at: new Date().toISOString() });
  }

  /* ----------------------------- mutations ----------------------------- */

  async rename(actor: OrgActor, fileId: string, name: string): Promise<FileRow> {
    const file = await this.loadVisibleFile(actor, fileId);
    if (!canManageFile(actor, file)) throw forbidden('cannot_manage_file');
    let clean = sanitizeFileName(name);
    // Renaming must never change the verified type.
    if (getExtension(clean) !== file.extension) clean = `${clean}.${file.extension}`;
    const row = unwrap(await this.db.from('company_files').update({ original_name: clean }).eq('id', file.id).select(FILE_COLUMNS).single<FileRow>());
    await this.logActivity(file, 'renamed', { userId: actor.userId }, { from: file.original_name, to: clean });
    return row;
  }

  async move(actor: OrgActor, fileId: string, folderId: string | null): Promise<FileRow> {
    const file = await this.loadVisibleFile(actor, fileId);
    if (!canManageFile(actor, file)) throw forbidden('cannot_manage_file');
    if (file.space !== 'shared' && file.space !== 'private') throw forbidden();
    if (folderId) {
      const folder = await this.loadFolder(actor, folderId);
      // Moving can never cross the shared/private boundary.
      if (!canUseFolder(actor, folder, file.space)) throw notFound('folder_not_found');
    }
    const row = unwrap(await this.db.from('company_files').update({ folder_id: folderId }).eq('id', file.id).select(FILE_COLUMNS).single<FileRow>());
    await this.logActivity(file, 'moved', { userId: actor.userId }, { from: file.folder_id, to: folderId });
    return row;
  }

  async softDelete(actor: OrgActor, fileId: string): Promise<void> {
    const file = await this.loadVisibleFile(actor, fileId);
    if (!canManageFile(actor, file)) throw forbidden('cannot_delete_file');
    await this.db.from('company_files').update({ deleted_at: new Date().toISOString(), deleted_by: actor.userId }).eq('id', file.id);
    await this.logActivity(file, 'deleted', { userId: actor.userId });
  }

  async restore(actor: OrgActor, fileId: string): Promise<FileRow> {
    const file = await this.loadVisibleFile(actor, fileId, { includeDeleted: true });
    if (!file.deleted_at) return file;
    if (!canManageFile(actor, file)) throw forbidden('cannot_restore_file');
    let folderId = file.folder_id;
    if (folderId) {
      const { data: folder } = await this.db.from('company_file_folders').select('deleted_at').eq('id', folderId).maybeSingle<{ deleted_at: string | null }>();
      if (!folder || folder.deleted_at) folderId = null; // restore to root if folder is gone
    }
    const row = unwrap(
      await this.db.from('company_files').update({ deleted_at: null, deleted_by: null, folder_id: folderId }).eq('id', file.id).select(FILE_COLUMNS).single<FileRow>(),
    );
    await this.logActivity(file, 'restored', { userId: actor.userId });
    return row;
  }

  /** Permanently removes bytes from storage; metadata row is kept (purged_at) for audit integrity. */
  async purge(actor: OrgActor, fileId: string): Promise<void> {
    const file = await this.loadVisibleFile(actor, fileId, { includeDeleted: true });
    if (!file.deleted_at) throw conflict('move_to_trash_first');
    if (!canPurgeFile(actor, file)) throw forbidden('cannot_purge_file');
    const { error } = await this.db.storage.from(FILES_BUCKET).remove([file.storage_key]);
    if (error) throw new AppError(502, 'storage_unavailable', error.message);
    await this.db.from('company_files').update({ purged_at: new Date().toISOString() }).eq('id', file.id);
    await this.db.from('file_links').delete().eq('file_id', file.id);
    await this.logActivity(file, 'purged', { userId: actor.userId });
    await this.audit.audit({ organizationId: actor.orgId, actorType: 'human', actorUserId: actor.userId, action: 'file.purged', targetType: 'file', targetId: file.id });
  }

  /**
   * The ONLY way a private file becomes visible to others: the owner explicitly publishes a COPY
   * into Shared Files. The private original stays private.
   */
  async sharePrivateCopy(actor: OrgActor, fileId: string, folderId: string | null): Promise<FileRow> {
    this.assertPaid(actor);
    const file = await this.loadVisibleFile(actor, fileId);
    if (!isPrivate(file) || file.owner_user_id !== actor.userId) throw forbidden();
    if (!canUploadTo(actor, 'shared')) throw forbidden('cannot_upload');
    if (folderId) {
      const folder = await this.loadFolder(actor, folderId);
      if (!canUseFolder(actor, folder, 'shared')) throw notFound('folder_not_found');
    }
    await this.entitlements.assertWithinLimit(actor.orgId, actor.billing, 'storage_bytes', file.size);
    const { fileId: newId, key } = buildStorageKey({ space: 'shared', orgId: actor.orgId });
    const { error } = await this.db.storage.from(FILES_BUCKET).copy(file.storage_key, key);
    if (error) throw new AppError(502, 'storage_unavailable', error.message);
    const row = unwrap(
      await this.db
        .from('company_files')
        .insert({
          id: newId,
          organization_id: actor.orgId,
          space: 'shared',
          visibility: 'organization_shared',
          uploaded_by_user_id: actor.userId,
          folder_id: folderId,
          original_name: file.original_name,
          extension: file.extension,
          storage_key: key,
          mime_type: file.mime_type,
          category: file.category,
          size: file.size,
          checksum_sha256: file.checksum_sha256,
          status: 'ready',
          scan_status: file.scan_status,
          source_file_id: null, // do not reference the private original
        })
        .select(FILE_COLUMNS)
        .single<FileRow>(),
    );
    await this.logActivity(row, 'uploaded', { userId: actor.userId }, { via: 'explicit_share' });
    return row;
  }

  /* ----------------------------- links ----------------------------- */

  async link(actor: OrgActor, fileId: string, entityType: FileLinkEntityType, entityId: string): Promise<void> {
    const file = await this.loadVisibleFile(actor, fileId);
    // Private files can't be attached to shared work items — they would leak to other members.
    if (file.space !== 'shared') throw badRequest('only_shared_files_can_be_linked');
    const table = { task: 'tasks', project: 'projects', mission: 'missions', department: 'departments', meeting: 'meetings', ai_output: 'ai_outputs' }[entityType];
    const { data: entity } = await this.db.from(table).select('id').eq('id', entityId).eq('organization_id', actor.orgId).maybeSingle();
    if (!entity) throw notFound('entity_not_found');
    await this.db
      .from('file_links')
      .upsert({ organization_id: actor.orgId, file_id: file.id, entity_type: entityType, entity_id: entityId, linked_by_user_id: actor.userId }, { onConflict: 'file_id,entity_type,entity_id' });
    await this.logActivity(file, 'linked', { userId: actor.userId }, { entity_type: entityType, entity_id: entityId });
  }

  async unlink(actor: OrgActor, fileId: string, entityType: FileLinkEntityType, entityId: string): Promise<void> {
    await this.loadVisibleFile(actor, fileId);
    if (!actor.permissions.has('work.create')) throw forbidden();
    await this.db.from('file_links').delete().eq('organization_id', actor.orgId).eq('file_id', fileId).eq('entity_type', entityType).eq('entity_id', entityId);
  }

  async listLinked(actor: OrgActor, entityType: FileLinkEntityType, entityId: string): Promise<FileRow[]> {
    const { data: links } = await this.db
      .from('file_links')
      .select('file_id')
      .eq('organization_id', actor.orgId)
      .eq('entity_type', entityType)
      .eq('entity_id', entityId);
    const ids = ((links ?? []) as Array<{ file_id: string }>).map((l) => l.file_id);
    if (ids.length === 0) return [];
    const { data } = await this.userDb(actor).from('company_files').select(FILE_COLUMNS).in('id', ids).is('deleted_at', null);
    return ((data ?? []) as FileRow[]).filter((f) => canViewFile(actor, f));
  }

  async activity(actor: OrgActor, fileId?: string): Promise<unknown[]> {
    let q = this.userDb(actor).from('file_activity_events').select('*').eq('organization_id', actor.orgId).order('created_at', { ascending: false }).limit(200);
    if (fileId) q = q.eq('file_id', fileId);
    const { data } = await q;
    return data ?? [];
  }

  async storageUsage(actor: OrgActor): Promise<{ used_bytes: number; file_count: number; limit_bytes: number | null }> {
    const { data } = await this.db.rpc('organization_storage_usage', { p_org: actor.orgId });
    const row = ((data ?? []) as Array<{ used_bytes: number; file_count: number }>)[0];
    return { used_bytes: Number(row?.used_bytes ?? 0), file_count: Number(row?.file_count ?? 0), limit_bytes: actor.billing.entitlements.storage_bytes };
  }

  /* ----------------------------- AI access (service role + strict policy) ----------------------------- */

  async aiListSharedFiles(ai: AiActor, q?: string): Promise<Array<Pick<FileRow, 'id' | 'original_name' | 'category' | 'size' | 'folder_id' | 'created_at'>>> {
    if (!ai.permissions.has('files.shared.view')) throw forbidden('ai_permission_denied');
    let query = this.db
      .from('company_files')
      .select(FILE_COLUMNS)
      .eq('organization_id', ai.orgId)
      .eq('space', 'shared') // hard filter: private files are never even queried
      .eq('visibility', 'organization_shared')
      .eq('status', 'ready')
      .is('deleted_at', null)
      .is('purged_at', null)
      .limit(50);
    if (ai.allowedFolderIds.length > 0) query = query.in('folder_id', ai.allowedFolderIds);
    if (q) query = query.ilike('original_name', `%${q.replace(/[%_\\]/g, (m) => `\\${m}`)}%`);
    const { data } = await query;
    return ((data ?? []) as FileRow[])
      .filter((f) => aiCanReadFile(ai, f))
      .map((f) => ({ id: f.id, original_name: f.original_name, category: f.category, size: f.size, folder_id: f.folder_id, created_at: f.created_at }));
  }

  /** Reads a text-like shared or own-workspace file for an AI employee. Private files: always denied. */
  async aiReadFile(ai: AiActor, fileId: string, maxBytes: number): Promise<{ name: string; content: string; truncated: boolean }> {
    const { data: file } = await this.db.from('company_files').select(FILE_COLUMNS).eq('id', fileId).eq('organization_id', ai.orgId).maybeSingle<FileRow>();
    if (!file || file.deleted_at || file.purged_at || file.status !== 'ready' || !aiCanReadFile(ai, file)) {
      throw forbidden('ai_file_access_denied');
    }
    const type = findAllowedTypeByExtension(file.original_name);
    if (!type || (type.category !== 'text' && type.mime !== 'text/csv')) throw badRequest('ai_can_only_read_text_files');
    const { data } = await this.db.storage.from(FILES_BUCKET).download(file.storage_key);
    if (!data) throw notFound('file_not_found');
    const buf = Buffer.from(await data.arrayBuffer());
    const truncated = buf.byteLength > maxBytes;
    await this.logActivity(file, 'viewed', { aiEmployeeId: ai.aiEmployeeId });
    return { name: file.original_name, content: buf.subarray(0, maxBytes).toString('utf8'), truncated };
  }

  /** Writes a generated text file into the AI employee's own workspace (never into shared/private spaces). */
  async aiWriteWorkspaceFile(ai: AiActor, name: string, content: string): Promise<FileRow> {
    const clean = sanitizeFileName(name);
    const type = findAllowedTypeByExtension(clean);
    if (!type || type.signature !== 'text') throw badRequest('ai_can_only_write_text_files');
    const bytes = Buffer.from(content, 'utf8');
    const { fileId, key } = buildStorageKey({ space: 'ai_workspace', orgId: ai.orgId, aiEmployeeId: ai.aiEmployeeId });
    const { error } = await this.db.storage.from(FILES_BUCKET).upload(key, bytes, { contentType: `${type.mime}; charset=utf-8`, upsert: false });
    if (error) throw new AppError(502, 'storage_unavailable', error.message);
    const row = unwrap(
      await this.db
        .from('company_files')
        .insert({
          id: fileId,
          organization_id: ai.orgId,
          space: 'ai_workspace',
          visibility: 'restricted',
          ai_employee_id: ai.aiEmployeeId,
          uploaded_by_ai_employee_id: ai.aiEmployeeId,
          original_name: clean,
          extension: getExtension(clean),
          storage_key: key,
          mime_type: type.mime,
          category: type.category,
          size: bytes.byteLength,
          checksum_sha256: createHash('sha256').update(bytes).digest('hex'),
          status: 'ready',
        })
        .select(FILE_COLUMNS)
        .single<FileRow>(),
    );
    await this.logActivity(row, 'uploaded', { aiEmployeeId: ai.aiEmployeeId });
    return row;
  }

  /** Stores a generated binary artifact (e.g. PPTX) in an AI employee's workspace. Type is verified by signature. */
  async writeWorkspaceBinary(owner: { orgId: string; aiEmployeeId: string }, name: string, bytes: Buffer): Promise<FileRow> {
    const clean = sanitizeFileName(name);
    const verdict = verifyFileContent(clean, bytes.subarray(0, SNIFF_BYTES), { allowArchives: false });
    if (!verdict.ok || !verdict.type) throw badRequest(verdict.reason ?? 'unsupported_file_type');
    const { fileId, key } = buildStorageKey({ space: 'ai_workspace', orgId: owner.orgId, aiEmployeeId: owner.aiEmployeeId });
    const { error } = await this.db.storage.from(FILES_BUCKET).upload(key, bytes, { contentType: verdict.type.mime, upsert: false });
    if (error) throw new AppError(502, 'storage_unavailable', error.message);
    const row = unwrap(
      await this.db
        .from('company_files')
        .insert({
          id: fileId,
          organization_id: owner.orgId,
          space: 'ai_workspace',
          visibility: 'restricted',
          ai_employee_id: owner.aiEmployeeId,
          uploaded_by_ai_employee_id: owner.aiEmployeeId,
          original_name: clean,
          extension: getExtension(clean),
          storage_key: key,
          mime_type: verdict.type.mime,
          category: verdict.type.category,
          size: bytes.byteLength,
          checksum_sha256: createHash('sha256').update(bytes).digest('hex'),
          status: 'ready',
        })
        .select(FILE_COLUMNS)
        .single<FileRow>(),
    );
    await this.logActivity(row, 'uploaded', { aiEmployeeId: owner.aiEmployeeId });
    return row;
  }

  /** Short-lived download URL minted by the API after it authorized access to the owning resource. */
  async serviceSignedDownload(orgId: string, fileId: string): Promise<{ url: string; expires_in: number }> {
    const { data: file } = await this.db.from('company_files').select(FILE_COLUMNS).eq('id', fileId).eq('organization_id', orgId).maybeSingle<FileRow>();
    if (!file || file.deleted_at || file.purged_at || isPrivate(file)) throw notFound('file_not_found');
    const { data } = await this.db.storage.from(FILES_BUCKET).createSignedUrl(file.storage_key, SIGNED_DOWNLOAD_TTL_SECONDS, { download: file.original_name });
    if (!data) throw notFound('file_not_found');
    return { url: data.signedUrl, expires_in: SIGNED_DOWNLOAD_TTL_SECONDS };
  }

  async aiListWorkspaceFiles(ai: AiActor): Promise<Array<Pick<FileRow, 'id' | 'original_name' | 'size' | 'created_at'>>> {
    const { data } = await this.db
      .from('company_files')
      .select('id, original_name, size, created_at')
      .eq('organization_id', ai.orgId)
      .eq('space', 'ai_workspace')
      .eq('ai_employee_id', ai.aiEmployeeId)
      .is('deleted_at', null)
      .order('created_at', { ascending: false })
      .limit(100);
    return (data ?? []) as Array<Pick<FileRow, 'id' | 'original_name' | 'size' | 'created_at'>>;
  }

  /** Publishes an AI workspace file into Shared Files (only after policy/approval allowed it). */
  async publishAiFileToShared(orgId: string, fileId: string, approvedByUserId: string | null, folderId: string | null): Promise<FileRow> {
    const { data: file } = await this.db.from('company_files').select(FILE_COLUMNS).eq('id', fileId).eq('organization_id', orgId).maybeSingle<FileRow>();
    if (!file || file.space !== 'ai_workspace' || file.deleted_at) throw notFound('file_not_found');
    const { fileId: newId, key } = buildStorageKey({ space: 'shared', orgId });
    const { error } = await this.db.storage.from(FILES_BUCKET).copy(file.storage_key, key);
    if (error) throw new AppError(502, 'storage_unavailable', error.message);
    const row = unwrap(
      await this.db
        .from('company_files')
        .insert({
          id: newId,
          organization_id: orgId,
          space: 'shared',
          visibility: 'organization_shared',
          uploaded_by_ai_employee_id: file.ai_employee_id,
          uploaded_by_user_id: approvedByUserId,
          folder_id: folderId,
          original_name: file.original_name,
          extension: file.extension,
          storage_key: key,
          mime_type: file.mime_type,
          category: file.category,
          size: file.size,
          checksum_sha256: file.checksum_sha256,
          status: 'ready',
          source_file_id: file.id,
        })
        .select(FILE_COLUMNS)
        .single<FileRow>(),
    );
    await this.logActivity(row, 'published', { ...(approvedByUserId ? { userId: approvedByUserId } : {}), ...(file.ai_employee_id ? { aiEmployeeId: file.ai_employee_id } : {}) });
    return row;
  }
}
