import type {
  AiEmployeeStatus,
  AutonomyLevel,
  Entitlements,
  FileSpace,
  FileStatus,
  FileVisibility,
  HumanRole,
  ScanStatus,
  SubscriptionStatus,
  WorkSessionStatus,
} from '@nexus/shared';

/** Row shapes for tables the API reads frequently. Kept minimal and explicit. */

export interface OrganizationRow {
  id: string;
  name: string;
  commercial_registration: string;
  company_email: string | null;
  company_phone: string | null;
  logo_storage_key: string | null;
  logo_updated_at: string | null;
  website: string | null;
  industry: string | null;
  company_size: string | null;
  status: 'active' | 'suspended' | 'closed';
  verification_status: 'pending' | 'verified' | 'rejected';
  owner_user_id: string;
  default_locale: 'ar' | 'en';
  settings: Record<string, unknown>;
  created_at: string;
}

export interface MemberRow {
  id: string;
  organization_id: string;
  user_id: string;
  role: HumanRole;
  status: 'active' | 'removed';
  department_id: string | null;
  job_title: string | null;
  display_name: string | null;
  joined_at: string;
}

export interface SubscriptionRow {
  id: string;
  organization_id: string;
  plan_code: string;
  status: SubscriptionStatus;
  started_at: string | null;
  current_period_start: string | null;
  ends_at: string | null;
  custom_entitlements: Partial<Entitlements> | null;
}

export interface PlanRow {
  code: string;
  name_ar: string;
  name_en: string;
  price_halalas: number | null;
  currency: 'SAR';
  billing_interval: 'yearly';
  is_popular: boolean;
  is_custom: boolean;
  is_public: boolean;
  entitlements: Entitlements;
  ai_models: string[];
  sort_order: number;
}

export interface AiEmployeeRow {
  id: string;
  organization_id: string;
  template_id: string | null;
  name: string;
  avatar_seed: string;
  job_title: string;
  department_id: string | null;
  manager_member_id: string | null;
  role_description: string;
  responsibilities: string[];
  skills: string[];
  goals: string[];
  instructions: string;
  status: AiEmployeeStatus;
  autonomy: AutonomyLevel;
  provider: string;
  model: string;
  is_active: boolean;
  created_at: string;
  deleted_at: string | null;
}

export interface AiPermissionRow {
  ai_employee_id: string;
  organization_id: string;
  permissions: string[];
  allowed_folder_ids: string[];
}

export interface WorkSessionRow {
  id: string;
  organization_id: string;
  ai_employee_id: string;
  task_id: string | null;
  parent_session_id: string | null;
  delegation_depth: number;
  status: WorkSessionStatus;
  current_step: string | null;
  priority: number;
  provider: string;
  model: string;
  computer_session_id: string | null;
  step_count: number;
  child_action_count: number;
  retry_count: number;
  input_tokens: number;
  output_tokens: number;
  estimated_cost_usd: number;
  control_request: 'pause' | 'cancel' | 'request_stop' | null;
  resume_state: unknown;
  outputs: unknown[];
  error: string | null;
  requested_by_user_id: string | null;
  requested_by_ai_employee_id: string | null;
  queued_at: string;
  started_at: string | null;
  completed_at: string | null;
}

export interface TaskRow {
  id: string;
  organization_id: string;
  project_id: string | null;
  mission_id: string | null;
  parent_task_id: string | null;
  title: string;
  description: string;
  assignee_member_id: string | null;
  assignee_ai_employee_id: string | null;
  creator_user_id: string | null;
  creator_ai_employee_id: string | null;
  priority: string;
  status: string;
  due_date: string | null;
  tags: string[];
  requires_approval: boolean;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export interface FileRow {
  id: string;
  organization_id: string;
  space: FileSpace;
  visibility: FileVisibility;
  owner_user_id: string | null;
  uploaded_by_user_id: string | null;
  uploaded_by_ai_employee_id: string | null;
  ai_employee_id: string | null;
  folder_id: string | null;
  original_name: string;
  extension: string;
  storage_key: string;
  mime_type: string;
  category: string;
  size: number;
  checksum_sha256: string | null;
  status: FileStatus;
  scan_status: ScanStatus;
  failure_reason: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  deleted_by: string | null;
  purged_at: string | null;
}

export interface FolderRow {
  id: string;
  organization_id: string;
  space: FileSpace;
  visibility: FileVisibility;
  owner_user_id: string | null;
  ai_employee_id: string | null;
  parent_id: string | null;
  name: string;
  created_by_user_id: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export interface ApprovalRow {
  id: string;
  organization_id: string;
  title: string;
  description: string;
  approval_type: string;
  status: 'pending' | 'approved' | 'rejected' | 'revision_requested';
  requested_by_user_id: string | null;
  requested_by_ai_employee_id: string | null;
  session_id: string | null;
  task_id: string | null;
  entity_type: string | null;
  entity_id: string | null;
  payload: Record<string, unknown>;
  risk: 'low' | 'medium' | 'high';
  decided_by_user_id: string | null;
  decided_at: string | null;
  created_at: string;
}
