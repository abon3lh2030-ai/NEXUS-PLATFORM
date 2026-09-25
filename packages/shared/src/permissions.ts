import type { HumanRole } from './enums.js';

/**
 * Human permission keys. The backend resolves effective permissions as:
 *   DEFAULT_ROLE_PERMISSIONS[role]  ⊕  organization overrides (organization_role_permissions)
 * Owner-locked permissions can never be removed from the owner and never granted to others.
 */
export const PERMISSIONS = [
  'org.view',
  'org.manage',
  'org.close',
  'members.view',
  'members.manage',
  'billing.view',
  'billing.manage',
  'departments.manage',
  'work.view',
  'work.create',
  'work.manage',
  'meetings.manage',
  'documents.create',
  'documents.manage',
  'decisions.manage',
  'memory.manage',
  'approvals.decide',
  'analytics.view',
  'audit.view',
  'ai.view',
  'ai.manage',
  'ai.assign',
  'ai.control',
  'ai.computer.view',
  'nexus_ai.use',
  'files.shared.view',
  'files.shared.download',
  'files.shared.upload',
  'files.shared.manage_own',
  'files.shared.manage_all',
  'files.shared.purge',
  'files.permissions.manage',
  'files.private.use',
] as const;
export type Permission = (typeof PERMISSIONS)[number];

export const OWNER_LOCKED_PERMISSIONS: readonly Permission[] = ['org.close', 'billing.manage', 'files.permissions.manage'];

const ALL: readonly Permission[] = PERMISSIONS;

const MEMBER_BASE: Permission[] = [
  'org.view',
  'members.view',
  'work.view',
  'work.create',
  'documents.create',
  'ai.view',
  'ai.assign',
  'nexus_ai.use',
  'files.shared.view',
  'files.shared.download',
  'files.shared.upload',
  'files.shared.manage_own',
];

export const DEFAULT_ROLE_PERMISSIONS: Record<HumanRole, readonly Permission[]> = {
  owner: ALL,
  admin: ALL.filter((p) => !OWNER_LOCKED_PERMISSIONS.includes(p)),
  manager: [
    ...MEMBER_BASE,
    'billing.view',
    'work.manage',
    'meetings.manage',
    'documents.manage',
    'decisions.manage',
    'memory.manage',
    'approvals.decide',
    'analytics.view',
    'ai.control',
    'ai.computer.view',
    'files.shared.manage_all',
    'files.private.use',
  ],
  member: MEMBER_BASE,
  viewer: ['org.view', 'members.view', 'work.view', 'ai.view', 'files.shared.view', 'files.shared.download'],
};

export interface PermissionOverride {
  role: HumanRole;
  permission: Permission;
  allowed: boolean;
}

export function resolvePermissions(role: HumanRole, overrides: readonly PermissionOverride[] = []): Set<Permission> {
  const set = new Set<Permission>(DEFAULT_ROLE_PERMISSIONS[role]);
  for (const o of overrides) {
    if (o.role !== role) continue;
    if (OWNER_LOCKED_PERMISSIONS.includes(o.permission)) continue; // never configurable
    if (role === 'owner') continue; // owner always has full access
    if (o.allowed) set.add(o.permission);
    else set.delete(o.permission);
  }
  return set;
}

export function roleRank(role: HumanRole): number {
  return { owner: 5, admin: 4, manager: 3, member: 2, viewer: 1 }[role];
}

/** Whether `actor` may assign `target` role to someone (cannot grant at or above own rank, except owner). */
export function canAssignRole(actor: HumanRole, target: HumanRole): boolean {
  if (target === 'owner') return false; // ownership transfer is a dedicated flow
  if (actor === 'owner') return true;
  return roleRank(actor) > roleRank(target);
}

/* ------------------------------------------------------------------ */
/* AI employee permissions                                              */
/* ------------------------------------------------------------------ */

/**
 * Capabilities an AI employee can be granted. Note: there is intentionally NO key for
 * private files — AI employees can never access `private_owner` files.
 */
export const AI_PERMISSIONS = [
  'files.shared.view',
  'files.shared.upload',
  'files.own.modify',
  'files.own.delete',
  'documents.create',
  'documents.read',
  'tasks.read',
  'tasks.update_own',
  'tasks.create',
  'memory.read',
  'memory.write',
  'decisions.read',
  'delegate',
  'web.research',
  'computer.browser',
  'computer.terminal',
] as const;
export type AiPermission = (typeof AI_PERMISSIONS)[number];

export const DEFAULT_AI_PERMISSIONS: readonly AiPermission[] = [
  'documents.create',
  'documents.read',
  'tasks.read',
  'tasks.update_own',
  'memory.read',
  'files.own.modify',
];
