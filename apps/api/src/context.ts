import type { HumanRole, Permission } from '@nexus/shared';
import type { BillingState } from './services/entitlements.js';

export interface AuthUser {
  userId: string;
  email: string | null;
  token: string;
  isSuperAdmin: boolean;
}

/** A human acting inside an organization. Resolved server-side on every request. */
export interface OrgActor extends AuthUser {
  orgId: string;
  orgName: string;
  orgStatus: 'active' | 'suspended' | 'closed';
  ownerUserId: string;
  role: HumanRole;
  memberId: string;
  permissions: Set<Permission>;
  billing: BillingState;
  ip?: string;
  userAgent?: string;
}

/** An AI employee acting inside an organization (no auth identity; never passes RLS). */
export interface AiActor {
  kind: 'ai';
  orgId: string;
  aiEmployeeId: string;
  name: string;
  permissions: Set<string>;
  allowedFolderIds: string[];
  autonomy: 'suggest' | 'draft' | 'execute_internal' | 'autonomous';
  sessionId: string;
}
