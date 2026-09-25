import { resolvePermissions, type HumanRole } from '@nexus/shared';
import { describe, expect, it } from 'vitest';
import type { AiActor, OrgActor } from '../context.js';
import { evaluateToolCall } from '../services/agent/tool-guard.js';
import { aiCanReadFile, canDownloadFile, canManageFile, canPurgeFile, canViewFile } from '../services/files/access-policy.js';
import { buildStorageKey } from '../services/files/storage-keys.js';
import { computeHealthScore } from '../services/insights.js';
import { safeEqual, safePaymentMetadata } from '../services/billing/moyasar.js';
import type { FileRow } from '../types/db.js';

const ORG = '9b1e0c7a-0000-4000-8000-000000000001';
const OTHER_ORG = '9b1e0c7a-0000-4000-8000-000000000002';
const OWNER = '9b1e0c7a-0000-4000-8000-00000000000a';
const ADMIN = '9b1e0c7a-0000-4000-8000-00000000000b';
const MEMBER = '9b1e0c7a-0000-4000-8000-00000000000c';

function actor(userId: string, role: HumanRole, orgId = ORG): OrgActor {
  return {
    userId,
    email: null,
    token: 't',
    isSuperAdmin: true, // deliberately true: super admin must NOT grant private-file access
    orgId,
    orgName: 'A',
    orgStatus: 'active',
    ownerUserId: OWNER,
    role,
    memberId: 'm',
    permissions: resolvePermissions(role),
    billing: { subscription: null, plan: null, active: true, entitlements: { features: [] } as never },
  };
}

function ai(perms: string[], folders: string[] = [], autonomy: AiActor['autonomy'] = 'draft'): AiActor {
  return { kind: 'ai', orgId: ORG, aiEmployeeId: 'ai-1', name: 'Atlas', permissions: new Set(perms), allowedFolderIds: folders, autonomy, sessionId: 's' };
}

const file = (over: Partial<FileRow>): FileRow =>
  ({
    organization_id: ORG,
    space: 'shared',
    visibility: 'organization_shared',
    owner_user_id: null,
    uploaded_by_user_id: MEMBER,
    folder_id: 'folder-1',
    ai_employee_id: null,
    ...over,
  }) as FileRow;

const privateOwnerFile = file({ space: 'private', visibility: 'private_owner', owner_user_id: OWNER, uploaded_by_user_id: OWNER });

describe('private manager files — API layer', () => {
  it('only the owner can view/download/manage/purge', () => {
    const owner = actor(OWNER, 'owner');
    expect(canViewFile(owner, privateOwnerFile)).toBe(true);
    expect(canDownloadFile(owner, privateOwnerFile)).toBe(true);
    expect(canManageFile(owner, privateOwnerFile)).toBe(true);
    expect(canPurgeFile(owner, privateOwnerFile)).toBe(true);
  });
  it('other admin (even flagged super admin), manager, member, viewer are denied', () => {
    for (const [u, r] of [
      [ADMIN, 'admin'],
      [MEMBER, 'manager'],
      [MEMBER, 'member'],
      [MEMBER, 'viewer'],
    ] as const) {
      const a = actor(u, r);
      expect(canViewFile(a, privateOwnerFile)).toBe(false);
      expect(canDownloadFile(a, privateOwnerFile)).toBe(false);
      expect(canManageFile(a, privateOwnerFile)).toBe(false);
      expect(canPurgeFile(a, privateOwnerFile)).toBe(false);
    }
  });
  it('cross-organization access is denied even for owners', () => {
    const other = actor(OWNER, 'owner', OTHER_ORG);
    expect(canViewFile(other, file({}))).toBe(false);
    expect(canViewFile(other, privateOwnerFile)).toBe(false);
  });
});

describe('shared files — role defaults', () => {
  it('members manage only their own uploads; managers/admins manage all', () => {
    const mine = file({ uploaded_by_user_id: MEMBER });
    const theirs = file({ uploaded_by_user_id: ADMIN });
    expect(canManageFile(actor(MEMBER, 'member'), mine)).toBe(true);
    expect(canManageFile(actor(MEMBER, 'member'), theirs)).toBe(false);
    expect(canManageFile(actor(ADMIN, 'admin'), mine)).toBe(true);
    expect(canManageFile(actor(MEMBER, 'manager'), theirs)).toBe(true);
  });
  it('viewers can view and download but not manage', () => {
    const v = actor(MEMBER, 'viewer');
    expect(canViewFile(v, file({}))).toBe(true);
    expect(canDownloadFile(v, file({}))).toBe(true);
    expect(canManageFile(v, file({ uploaded_by_user_id: MEMBER }))).toBe(false);
  });
  it('only roles with purge permission can permanently delete shared files', () => {
    expect(canPurgeFile(actor(MEMBER, 'member'), file({}))).toBe(false);
    expect(canPurgeFile(actor(OWNER, 'owner'), file({}))).toBe(true);
  });
});

describe('AI employees and files', () => {
  it('never read private manager files, whatever permissions they hold', () => {
    const everything = ai(['files.shared.view', 'files.shared.upload', 'files.own.modify', 'files.private.view', 'files.private.use'], [], 'autonomous');
    expect(aiCanReadFile(everything, privateOwnerFile)).toBe(false);
  });
  it('need an explicit grant to read shared files', () => {
    expect(aiCanReadFile(ai([]), file({}))).toBe(false);
    expect(aiCanReadFile(ai(['files.shared.view']), file({}))).toBe(true);
  });
  it('respect folder restrictions', () => {
    expect(aiCanReadFile(ai(['files.shared.view'], ['folder-2']), file({ folder_id: 'folder-1' }))).toBe(false);
    expect(aiCanReadFile(ai(['files.shared.view'], ['folder-1']), file({ folder_id: 'folder-1' }))).toBe(true);
  });
  it('cannot read another org, restricted files, or another employee workspace', () => {
    expect(aiCanReadFile(ai(['files.shared.view']), file({ organization_id: OTHER_ORG }))).toBe(false);
    expect(aiCanReadFile(ai(['files.shared.view']), file({ visibility: 'restricted' }))).toBe(false);
    expect(aiCanReadFile(ai([]), file({ space: 'ai_workspace', visibility: 'restricted', ai_employee_id: 'ai-2' }))).toBe(false);
    expect(aiCanReadFile(ai([]), file({ space: 'ai_workspace', visibility: 'restricted', ai_employee_id: 'ai-1' }))).toBe(true);
  });
});

describe('AI tool guard (permission → capability → autonomy → approval)', () => {
  const caps = { files: true, documents: true, browser: false, terminal: false };
  it('denies unknown tools and tools without permission', () => {
    expect(evaluateToolCall(ai([]), 'read_env', caps).decision).toBe('deny');
    expect(evaluateToolCall(ai([]), 'eval', caps).decision).toBe('deny');
    expect(evaluateToolCall(ai([]), 'create_document', caps)).toMatchObject({ decision: 'deny', reason: 'missing_permission:documents.create' });
  });
  it('denies terminal/browser when the sandbox provider lacks them — no fake computer', () => {
    const full = ai(['computer.terminal', 'computer.browser'], [], 'autonomous');
    expect(evaluateToolCall(full, 'terminal_command', caps)).toMatchObject({ decision: 'deny', reason: 'computer_capability_unavailable' });
    expect(evaluateToolCall(full, 'browser_action', caps)).toMatchObject({ decision: 'deny' });
  });
  it('terminal always requires approval even when autonomous', () => {
    const full = ai(['computer.terminal'], [], 'autonomous');
    expect(evaluateToolCall(full, 'terminal_command', { ...caps, terminal: true }).decision).toBe('needs_approval');
  });
  it('autonomy gates sensitive actions', () => {
    expect(evaluateToolCall(ai(['files.shared.upload'], [], 'execute_internal'), 'publish_file_to_shared', caps).decision).toBe('needs_approval');
    expect(evaluateToolCall(ai(['files.shared.upload'], [], 'autonomous'), 'publish_file_to_shared', caps).decision).toBe('allow');
    expect(evaluateToolCall(ai(['documents.create'], [], 'suggest'), 'create_document', caps).decision).toBe('needs_approval');
    expect(evaluateToolCall(ai(['documents.create'], [], 'draft'), 'create_document', caps).decision).toBe('allow');
  });
  it('approval does not bypass missing permissions', () => {
    expect(evaluateToolCall(ai([]), 'publish_file_to_shared', caps, { preApproved: true }).decision).toBe('deny');
  });
});

describe('storage keys', () => {
  it('never contain the user file name and are scoped by org/owner', () => {
    const k = buildStorageKey({ space: 'private', orgId: ORG, ownerUserId: OWNER });
    expect(k.key).toBe(`${ORG}/private/${OWNER}/${k.fileId}`);
    expect(() => buildStorageKey({ space: 'private', orgId: '../../etc', ownerUserId: OWNER })).toThrow();
    expect(() => buildStorageKey({ space: 'shared', orgId: ORG, fileId: '../x' })).toThrow();
  });
});

describe('company health score', () => {
  it('is 100 with no problems and explains every penalty', () => {
    const clean = computeHealthScore({ openTasks: 10, overdueTasks: 0, blockedTasks: 0, activeMissions: 2, missionsBehind: 0, sessionsLast7d: 5, failedSessionsLast7d: 0, pendingApprovals: 0, staleApprovals: 0, overloadedEmployees: 0 });
    expect(clean.score).toBe(100);
    const bad = computeHealthScore({ openTasks: 10, overdueTasks: 5, blockedTasks: 2, activeMissions: 2, missionsBehind: 1, sessionsLast7d: 10, failedSessionsLast7d: 5, pendingApprovals: 4, staleApprovals: 2, overloadedEmployees: 1 });
    expect(bad.score).toBeLessThan(70);
    expect(bad.reasons.map((r) => r.key)).toEqual(expect.arrayContaining(['overdue_work', 'blocked_work', 'mission_progress', 'failed_executions', 'pending_approvals']));
    expect(100 - bad.reasons.reduce((a, r) => a + r.impact, 0)).toBe(bad.score);
  });
});

describe('payment helpers', () => {
  it('constant-time secret comparison', () => {
    expect(safeEqual('abc', 'abc')).toBe(true);
    expect(safeEqual('abc', 'abd')).toBe(false);
    expect(safeEqual('abc', 'abcd')).toBe(false);
  });
  it('never keeps full card numbers', () => {
    const meta = safePaymentMetadata({ id: 'p', status: 'paid', amount: 1, currency: 'SAR', source: { type: 'creditcard', number: '4111111111111111', company: 'visa' } });
    expect(JSON.stringify(meta)).not.toContain('411111111111');
    expect(meta.masked_number).toBe('XXXXXXXXXXXX1111');
  });
});
