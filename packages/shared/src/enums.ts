/**
 * Canonical enum values. These mirror the Postgres enums in
 * supabase/migrations — keep both in sync.
 */

export const HUMAN_ROLES = ['owner', 'admin', 'manager', 'member', 'viewer'] as const;
export type HumanRole = (typeof HUMAN_ROLES)[number];

export const ORGANIZATION_STATUSES = ['active', 'suspended', 'closed'] as const;
export type OrganizationStatus = (typeof ORGANIZATION_STATUSES)[number];

export const VERIFICATION_STATUSES = ['pending', 'verified', 'rejected'] as const;
export type VerificationStatus = (typeof VERIFICATION_STATUSES)[number];

export const AI_EMPLOYEE_STATUSES = [
  'offline',
  'idle',
  'queued',
  'preparing',
  'thinking',
  'researching',
  'reading',
  'writing',
  'executing',
  'waiting',
  'waiting_approval',
  'blocked',
  'completed',
  'failed',
] as const;
export type AiEmployeeStatus = (typeof AI_EMPLOYEE_STATUSES)[number];

export const WORK_SESSION_STATUSES = [
  'queued',
  'preparing',
  'running',
  'paused',
  'waiting_approval',
  'completed',
  'failed',
  'cancelled',
] as const;
export type WorkSessionStatus = (typeof WORK_SESSION_STATUSES)[number];

export const AUTONOMY_LEVELS = ['suggest', 'draft', 'execute_internal', 'autonomous'] as const;
export type AutonomyLevel = (typeof AUTONOMY_LEVELS)[number];

export const TASK_STATUSES = ['backlog', 'todo', 'in_progress', 'review', 'blocked', 'done'] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export const PRIORITIES = ['low', 'medium', 'high', 'urgent'] as const;
export type Priority = (typeof PRIORITIES)[number];

export const WORK_STATUSES = ['planned', 'active', 'on_hold', 'blocked', 'completed', 'cancelled'] as const;
export type WorkStatus = (typeof WORK_STATUSES)[number];

export const GOAL_STATUSES = ['on_track', 'at_risk', 'off_track', 'achieved', 'archived'] as const;
export type GoalStatus = (typeof GOAL_STATUSES)[number];

export const DOCUMENT_TYPES = [
  'strategy',
  'research',
  'specification',
  'report',
  'meeting_notes',
  'plan',
  'general',
] as const;
export type DocumentType = (typeof DOCUMENT_TYPES)[number];

export const DECISION_STATUSES = ['proposed', 'decided', 'superseded', 'reverted'] as const;
export type DecisionStatus = (typeof DECISION_STATUSES)[number];

export const MEMORY_TYPES = [
  'company',
  'department',
  'project',
  'employee',
  'decision',
  'preference',
  'lesson',
] as const;
export type MemoryType = (typeof MEMORY_TYPES)[number];

export const APPROVAL_STATUSES = ['pending', 'approved', 'rejected', 'revision_requested'] as const;
export type ApprovalStatus = (typeof APPROVAL_STATUSES)[number];

export const FILE_VISIBILITIES = ['organization_shared', 'private_owner', 'restricted'] as const;
export type FileVisibility = (typeof FILE_VISIBILITIES)[number];

/** Storage space a file belongs to. `ai_workspace` = files produced inside an AI employee workspace. */
export const FILE_SPACES = ['shared', 'private', 'ai_workspace'] as const;
export type FileSpace = (typeof FILE_SPACES)[number];

export const FILE_STATUSES = ['uploading', 'processing', 'ready', 'failed'] as const;
export type FileStatus = (typeof FILE_STATUSES)[number];

export const SCAN_STATUSES = ['not_scanned', 'clean', 'infected', 'error'] as const;
export type ScanStatus = (typeof SCAN_STATUSES)[number];

export const FILE_ACTIVITY_ACTIONS = [
  'uploaded',
  'renamed',
  'moved',
  'downloaded',
  'viewed',
  'deleted',
  'restored',
  'purged',
  'linked',
  'published',
] as const;
export type FileActivityAction = (typeof FILE_ACTIVITY_ACTIONS)[number];

export const FILE_LINK_ENTITY_TYPES = ['task', 'project', 'mission', 'department', 'meeting', 'ai_output'] as const;
export type FileLinkEntityType = (typeof FILE_LINK_ENTITY_TYPES)[number];

export const SUBSCRIPTION_STATUSES = ['pending', 'active', 'expired', 'cancelled'] as const;
export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number];

export const PAYMENT_STATUSES = ['initiated', 'paid', 'failed', 'refunded'] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

export const ENTERPRISE_REQUEST_STATUSES = ['pending', 'approved', 'rejected', 'converted'] as const;
export type EnterpriseRequestStatus = (typeof ENTERPRISE_REQUEST_STATUSES)[number];

export const PLAN_CODES = ['starter', 'pro', 'business', 'enterprise'] as const;
export type PlanCode = (typeof PLAN_CODES)[number];

export const NOTIFICATION_TYPES = [
  'ai_completed',
  'ai_failed',
  'approval_requested',
  'approval_resolved',
  'task_assigned',
  'task_overdue',
  'mission_blocked',
  'file_shared',
  'subscription_expiring',
  'subscription_expired',
  'payment_success',
  'payment_failure',
  'enterprise_approved',
  'enterprise_rejected',
  'mention',
  'system',
] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

export const INBOX_ITEM_TYPES = [
  'task',
  'manager_instruction',
  'agent_message',
  'approval_result',
  'project_update',
  'mention',
] as const;
export type InboxItemType = (typeof INBOX_ITEM_TYPES)[number];

export const COMPANY_SIZES = ['1-10', '11-50', '51-200', '201-500', '501-1000', '1000+'] as const;
export type CompanySize = (typeof COMPANY_SIZES)[number];

export const INDUSTRIES = [
  'technology',
  'retail',
  'real_estate',
  'construction',
  'healthcare',
  'education',
  'finance',
  'logistics',
  'manufacturing',
  'hospitality',
  'energy',
  'government_services',
  'professional_services',
  'media',
  'other',
] as const;
export type Industry = (typeof INDUSTRIES)[number];
