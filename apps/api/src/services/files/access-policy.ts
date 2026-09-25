import type { AiActor, OrgActor } from '../../context.js';
import type { FileRow, FolderRow } from '../../types/db.js';

/**
 * Pure authorization rules for company files. These run in the API; the same intent is
 * enforced independently by Postgres RLS and Storage policies (defense in depth).
 */

type Subject = Pick<FileRow, 'organization_id' | 'space' | 'visibility' | 'owner_user_id' | 'uploaded_by_user_id' | 'folder_id'>;

function sameOrg(actor: { orgId: string }, f: { organization_id: string }): boolean {
  return actor.orgId === f.organization_id;
}

export function isPrivate(f: Pick<FileRow, 'space' | 'visibility'>): boolean {
  return f.space === 'private' || f.visibility === 'private_owner';
}

export function canViewFile(actor: OrgActor, f: Subject): boolean {
  if (!sameOrg(actor, f)) return false;
  if (isPrivate(f)) return f.owner_user_id === actor.userId; // nobody else — not even the org owner or super admin
  if (f.space === 'ai_workspace') return actor.permissions.has('ai.computer.view');
  if (f.visibility === 'restricted') return actor.role === 'owner' || actor.role === 'admin';
  return actor.permissions.has('files.shared.view');
}

export function canDownloadFile(actor: OrgActor, f: Subject): boolean {
  if (!canViewFile(actor, f)) return false;
  if (isPrivate(f)) return true;
  if (f.space === 'ai_workspace') return actor.permissions.has('ai.computer.view');
  return actor.permissions.has('files.shared.download');
}

export function canManageFile(actor: OrgActor, f: Subject): boolean {
  if (!canViewFile(actor, f)) return false;
  if (isPrivate(f)) return f.owner_user_id === actor.userId;
  if (f.space === 'ai_workspace') return actor.permissions.has('ai.control');
  if (actor.permissions.has('files.shared.manage_all')) return true;
  return actor.permissions.has('files.shared.manage_own') && f.uploaded_by_user_id === actor.userId;
}

export function canPurgeFile(actor: OrgActor, f: Subject): boolean {
  if (!sameOrg(actor, f)) return false;
  if (isPrivate(f)) return f.owner_user_id === actor.userId;
  return actor.permissions.has('files.shared.purge');
}

export function canUploadTo(actor: OrgActor, space: 'shared' | 'private'): boolean {
  return space === 'private' ? actor.permissions.has('files.private.use') : actor.permissions.has('files.shared.upload');
}

export function canUseFolder(actor: OrgActor, folder: Pick<FolderRow, 'organization_id' | 'space' | 'owner_user_id' | 'deleted_at' | 'visibility'>, space: 'shared' | 'private'): boolean {
  if (folder.organization_id !== actor.orgId || folder.deleted_at) return false;
  if (folder.space !== space) return false;
  if (space === 'private') return folder.owner_user_id === actor.userId;
  if (folder.visibility === 'restricted') return actor.role === 'owner' || actor.role === 'admin';
  return true;
}

/**
 * AI employees may ONLY read organization-shared files, and only with an explicit grant.
 * Private manager files are unconditionally denied — no permission, prompt or autonomy level changes this.
 */
export function aiCanReadFile(ai: AiActor, f: Subject & { ai_employee_id?: string | null }): boolean {
  if (f.organization_id !== ai.orgId) return false;
  if (isPrivate(f)) return false;
  if (f.space === 'ai_workspace') return f.ai_employee_id === ai.aiEmployeeId;
  if (f.space !== 'shared' || f.visibility !== 'organization_shared') return false;
  if (!ai.permissions.has('files.shared.view')) return false;
  if (ai.allowedFolderIds.length > 0 && (!f.folder_id || !ai.allowedFolderIds.includes(f.folder_id))) return false;
  return true;
}
