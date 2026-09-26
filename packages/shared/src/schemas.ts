import { z } from 'zod';
import {
  AUTONOMY_LEVELS,
  COMPANY_SIZES,
  DECISION_STATUSES,
  DOCUMENT_TYPES,
  FILE_LINK_ENTITY_TYPES,
  GOAL_STATUSES,
  HUMAN_ROLES,
  INDUSTRIES,
  MEMORY_TYPES,
  PRIORITIES,
  TASK_STATUSES,
  WORK_STATUSES,
} from './enums.js';
import { AI_PERMISSIONS, PERMISSIONS } from './permissions.js';
import { isValidSaudiCommercialRegistration, normalizeCommercialRegistration } from './saudi.js';

const uuid = z.uuid();
const optionalUuid = z.uuid().nullable().optional();
const text = (max: number) => z.string().trim().max(max);
const requiredText = (max: number) => z.string().trim().min(1).max(max);
const isoDate = z.iso.date();
const isoDateTime = z.iso.datetime({ offset: true });

export const commercialRegistrationSchema = z
  .string()
  .transform(normalizeCommercialRegistration)
  .refine(isValidSaudiCommercialRegistration, { message: 'invalid_saudi_cr' });

const optionalUrl = z
  .union([z.literal(''), z.url({ protocol: /^https?$/ })])
  .optional()
  .transform((v) => (v ? v : null));

/* ------------------------------ Public forms ------------------------------ */

/** Saudi phone numbers: mobile (05XXXXXXXX / +9665XXXXXXXX) or landline (01XXXXXXXX / +9661XXXXXXX). */
export const saudiPhoneSchema = z
  .string()
  .transform((v) => normalizeCommercialRegistration(v).replace(/[()]/g, ''))
  .refine((v) => /^(?:\+?966|0)(?:5\d{8}|1\d{7,8}|9200\d{5}|800\d{7})$/.test(v), { message: 'invalid_saudi_phone' });

/**
 * Company registration. All required contact data is the COMPANY's official data
 * (official email + phone), not the applicant's personal details. The applicant is
 * identified by their signed-in account; only their role in the company is asked.
 */
export const companyApplicationSchema = z.object({
  company_name: requiredText(160),
  commercial_registration: commercialRegistrationSchema,
  company_email: z.email().max(200),
  company_phone: saudiPhoneSchema,
  website: optionalUrl,
  applicant_role: requiredText(120),
  industry: z.enum(INDUSTRIES),
  company_size: z.enum(COMPANY_SIZES),
  note: text(2000).optional().default(''),
  confirm_saudi_registered: z.literal(true),
});
export type CompanyApplicationInput = z.infer<typeof companyApplicationSchema>;

export const enterpriseRequestSchema = z.object({
  company_name: requiredText(160),
  commercial_registration: commercialRegistrationSchema,
  website: optionalUrl,
  contact_name: requiredText(120),
  work_email: z.email().max(200),
  company_size: z.enum(COMPANY_SIZES),
  industry: z.enum(INDUSTRIES),
  expected_human_members: z.number().int().min(1).max(100_000),
  expected_ai_employees: z.number().int().min(0).max(100_000),
  expected_ai_usage: text(500),
  expected_computer_usage: text(500),
  expected_storage: text(200),
  requirements: text(4000),
  customer_note: text(2000).optional().default(''),
  confirm_saudi_registered: z.literal(true),
});
export type EnterpriseRequestInput = z.infer<typeof enterpriseRequestSchema>;

export const contactSchema = z.object({
  name: requiredText(120),
  email: z.email().max(200),
  company: text(160).optional().default(''),
  message: requiredText(4000),
});
export type ContactInput = z.infer<typeof contactSchema>;

/* ------------------------------ Organization ------------------------------ */

export const updateOrganizationSchema = z.object({
  name: requiredText(160).optional(),
  company_email: z.email().max(200).optional(),
  company_phone: saudiPhoneSchema.optional(),
  website: optionalUrl,
  industry: z.enum(INDUSTRIES).optional(),
  company_size: z.enum(COMPANY_SIZES).optional(),
  default_locale: z.enum(['ar', 'en']).optional(),
});

export const closeOrganizationSchema = z.object({
  confirm_name: requiredText(160),
  reason: requiredText(2000),
});

export const inviteMemberSchema = z.object({
  email: z.email().max(200),
  role: z.enum(HUMAN_ROLES).exclude(['owner']),
});

export const updateMemberSchema = z.object({
  display_name: requiredText(120).nullable().optional(),
  role: z.enum(HUMAN_ROLES).exclude(['owner']).optional(),
  department_id: optionalUuid,
  job_title: text(120).optional(),
});

export const rolePermissionOverrideSchema = z.object({
  overrides: z
    .array(z.object({ role: z.enum(HUMAN_ROLES).exclude(['owner']), permission: z.enum(PERMISSIONS), allowed: z.boolean() }))
    .max(500),
});

/* ------------------------------ Company OS ------------------------------ */

export const departmentSchema = z.object({
  name: requiredText(120),
  description: text(2000).optional().default(''),
  objective: text(1000).optional().default(''),
  lead_member_id: optionalUuid,
  lead_ai_employee_id: optionalUuid,
  parent_id: optionalUuid,
  kpis: z.array(z.object({ name: requiredText(120), target: text(60), current: text(60) })).max(20).optional().default([]),
});

export const goalSchema = z.object({
  title: requiredText(200),
  description: text(4000).optional().default(''),
  metric: text(120).optional().default(''),
  current_value: z.number().finite().optional().default(0),
  target_value: z.number().finite().optional().default(100),
  deadline: isoDate.nullable().optional(),
  owner_member_id: optionalUuid,
  status: z.enum(GOAL_STATUSES).optional().default('on_track'),
});

export const missionSchema = z.object({
  title: requiredText(200),
  description: text(4000).optional().default(''),
  objective: text(2000).optional().default(''),
  goal_id: optionalUuid,
  owner_member_id: optionalUuid,
  priority: z.enum(PRIORITIES).optional().default('medium'),
  status: z.enum(WORK_STATUSES).optional().default('planned'),
  start_date: isoDate.nullable().optional(),
  due_date: isoDate.nullable().optional(),
  department_ids: z.array(uuid).max(50).optional().default([]),
  ai_employee_ids: z.array(uuid).max(100).optional().default([]),
  member_ids: z.array(uuid).max(100).optional().default([]),
  milestones: z.array(z.object({ title: requiredText(200), due_date: isoDate.nullable().optional(), done: z.boolean().default(false) })).max(50).optional().default([]),
  risks: z.array(z.object({ title: requiredText(200), severity: z.enum(['low', 'medium', 'high']) })).max(50).optional().default([]),
});

export const projectSchema = z.object({
  title: requiredText(200),
  description: text(4000).optional().default(''),
  mission_id: optionalUuid,
  department_id: optionalUuid,
  owner_member_id: optionalUuid,
  status: z.enum(WORK_STATUSES).optional().default('planned'),
  priority: z.enum(PRIORITIES).optional().default('medium'),
  start_date: isoDate.nullable().optional(),
  due_date: isoDate.nullable().optional(),
  member_ids: z.array(uuid).max(100).optional().default([]),
  ai_employee_ids: z.array(uuid).max(100).optional().default([]),
  milestones: z.array(z.object({ title: requiredText(200), due_date: isoDate.nullable().optional(), done: z.boolean().default(false) })).max(50).optional().default([]),
});

export const taskSchema = z.object({
  title: requiredText(300),
  description: text(10000).optional().default(''),
  project_id: optionalUuid,
  mission_id: optionalUuid,
  parent_task_id: optionalUuid,
  assignee_member_id: optionalUuid,
  assignee_ai_employee_id: optionalUuid,
  priority: z.enum(PRIORITIES).optional().default('medium'),
  status: z.enum(TASK_STATUSES).optional().default('todo'),
  due_date: isoDateTime.nullable().optional(),
  tags: z.array(requiredText(40)).max(20).optional().default([]),
  requires_approval: z.boolean().optional().default(false),
  depends_on: z.array(uuid).max(50).optional().default([]),
});
export type TaskInput = z.infer<typeof taskSchema>;

export const taskUpdateSchema = taskSchema.partial();

export const commentSchema = z.object({
  body: requiredText(10000),
  file_ids: z.array(uuid).max(20).optional().default([]),
});

export const meetingSchema = z.object({
  title: requiredText(200),
  scheduled_at: isoDateTime,
  duration_minutes: z.number().int().min(5).max(24 * 60).optional().default(60),
  agenda: text(10000).optional().default(''),
  notes: text(100000).optional().default(''),
  participant_member_ids: z.array(uuid).max(200).optional().default([]),
  participant_ai_employee_ids: z.array(uuid).max(200).optional().default([]),
  project_id: optionalUuid,
  mission_id: optionalUuid,
});

export const documentSchema = z.object({
  title: requiredText(300),
  doc_type: z.enum(DOCUMENT_TYPES).optional().default('general'),
  content: text(500_000).optional().default(''),
  project_id: optionalUuid,
  mission_id: optionalUuid,
  department_id: optionalUuid,
  change_summary: text(500).optional(),
});

export const decisionSchema = z.object({
  title: requiredText(300),
  context: text(10000).optional().default(''),
  options: z.array(z.object({ label: requiredText(300), pros: text(2000).optional(), cons: text(2000).optional() })).max(20).optional().default([]),
  chosen_option: text(300).optional().default(''),
  reasoning: text(10000).optional().default(''),
  related_entity_type: z.enum(['goal', 'mission', 'project', 'task', 'meeting', 'department']).nullable().optional(),
  related_entity_id: optionalUuid,
  impact: z.enum(['low', 'medium', 'high']).optional().default('medium'),
  status: z.enum(DECISION_STATUSES).optional().default('decided'),
});

export const memorySchema = z.object({
  memory_type: z.enum(MEMORY_TYPES),
  title: requiredText(300),
  content: requiredText(20000),
  department_id: optionalUuid,
  project_id: optionalUuid,
  ai_employee_id: optionalUuid,
  tags: z.array(requiredText(40)).max(20).optional().default([]),
  pinned: z.boolean().optional().default(false),
});

export const approvalDecisionSchema = z.object({
  decision: z.enum(['approved', 'rejected', 'revision_requested']),
  comment: text(4000).optional().default(''),
});

/* ------------------------------ AI employees ------------------------------ */

export const aiEmployeeSchema = z.object({
  name: requiredText(80),
  job_title: requiredText(120),
  template_id: optionalUuid,
  department_id: optionalUuid,
  manager_member_id: optionalUuid,
  role_description: text(4000).optional().default(''),
  responsibilities: z.array(requiredText(300)).max(30).optional().default([]),
  skills: z.array(requiredText(80)).max(40).optional().default([]),
  goals: z.array(requiredText(300)).max(20).optional().default([]),
  instructions: text(10000).optional().default(''),
  autonomy: z.enum(AUTONOMY_LEVELS).optional().default('draft'),
  avatar_seed: text(60).optional(),
  model: text(80).optional(),
});
export type AiEmployeeInput = z.infer<typeof aiEmployeeSchema>;

export const aiEmployeePermissionsSchema = z.object({
  permissions: z.array(z.enum(AI_PERMISSIONS)).max(AI_PERMISSIONS.length),
  allowed_folder_ids: z.array(uuid).max(200).optional().default([]),
});

export const assignAiTaskSchema = z.object({
  task_id: uuid,
});

export const sessionControlSchema = z.object({
  action: z.enum(['pause', 'resume', 'cancel', 'request_stop']),
  reason: text(1000).optional(),
});

export const managerInstructionSchema = z.object({
  body: requiredText(4000),
});

export const nexusChatSchema = z.object({
  conversation_id: optionalUuid,
  message: requiredText(4000),
  locale: z.enum(['ar', 'en']).optional().default('ar'),
});

/* ------------------------------ Files ------------------------------ */

export const fileSpaceParam = z.enum(['shared', 'private']);

export const createFolderSchema = z.object({
  space: fileSpaceParam,
  name: requiredText(120),
  parent_id: optionalUuid,
});

/** Company logo: PNG only, max 1 MB, sent as base64 (validated again server-side by magic bytes). */
export const LOGO_MAX_BYTES = 1024 * 1024;
export const logoUploadSchema = z.object({
  data_base64: z.string().min(16).max(Math.ceil((LOGO_MAX_BYTES * 4) / 3) + 8),
});

export const initUploadSchema = z.object({
  space: fileSpaceParam,
  folder_id: optionalUuid,
  file_name: requiredText(255),
  size: z.number().int().min(1),
  declared_mime: text(200).optional(),
});

export const renameSchema = z.object({ name: requiredText(255) });
export const moveSchema = z.object({ folder_id: optionalUuid });

export const listFilesQuerySchema = z.object({
  space: z.enum(['shared', 'private', 'trash', 'recent']),
  folder_id: z.uuid().optional(),
  /** '1' = list across all folders (used by the attachment picker). */
  flat: z.enum(['1']).optional(),
  q: text(200).optional(),
  category: z.enum(['image', 'pdf', 'document', 'spreadsheet', 'presentation', 'text', 'archive']).optional(),
  uploader: z.uuid().optional(),
  from: isoDate.optional(),
  to: isoDate.optional(),
  sort: z.enum(['name', 'created_at', 'updated_at', 'size']).optional().default('created_at'),
  order: z.enum(['asc', 'desc']).optional().default('desc'),
});

export const fileLinkSchema = z.object({
  entity_type: z.enum(FILE_LINK_ENTITY_TYPES),
  entity_id: uuid,
});

export const aiFileAccessSchema = z.object({
  folder_ids: z.array(uuid).max(200),
});

/* ------------------------------ Billing ------------------------------ */

export const checkoutSchema = z.object({
  plan_code: z.enum(['starter', 'pro', 'business']),
});

export const enterpriseOfferCheckoutSchema = z.object({
  offer_id: uuid,
});

export const verifyPaymentSchema = z.object({
  transaction_id: uuid,
  payment_id: requiredText(100),
});

export const adminEnterpriseDecisionSchema = z.object({
  decision: z.enum(['approve', 'reject']),
  price_sar: z.number().int().min(1).max(10_000_000).optional(),
  entitlements: z
    .object({
      human_members: z.number().int().min(1).nullable(),
      ai_employees: z.number().int().min(0).nullable(),
      ai_executions_per_year: z.number().int().min(0).nullable(),
      active_projects: z.number().int().min(0).nullable(),
      storage_bytes: z.number().int().min(0).nullable(),
      max_file_size_bytes: z.number().int().min(1).nullable(),
      concurrent_ai_sessions: z.number().int().min(1).nullable(),
      computer_minutes_per_year: z.number().int().min(0).nullable(),
      ai_budget_halalas_per_year: z.number().int().min(0).nullable().optional(),
    })
    .optional(),
  note: text(4000).optional().default(''),
});

export const adminApplicationDecisionSchema = z.object({
  decision: z.enum(['verify', 'reject']),
  note: text(2000).optional().default(''),
});

export const paginationSchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).optional().default(50),
  offset: z.coerce.number().int().min(0).optional().default(0),
});

export const searchQuerySchema = z.object({
  q: requiredText(200),
});
