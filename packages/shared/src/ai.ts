import type { AiPermission } from './permissions.js';
import type { AutonomyLevel } from './enums.js';

/** Tools an AI employee may invoke during a work session. */
export const AGENT_TOOLS = [
  'read_task',
  'list_shared_files',
  'read_shared_file',
  'read_workspace_file',
  'write_workspace_file',
  'list_workspace_files',
  'create_document',
  'search_documents',
  'read_document',
  'search_memory',
  'write_memory',
  'read_decisions',
  'update_task_status',
  'add_task_comment',
  'create_subtask',
  'delegate_task',
  'message_employee',
  'request_approval',
  'publish_file_to_shared',
  'browser_action',
  'terminal_command',
  'finish',
] as const;
export type AgentTool = (typeof AGENT_TOOLS)[number];

export type ToolRisk = 'low' | 'medium' | 'high';

export interface AgentToolPolicy {
  /** AI permission required to use the tool (none = always allowed within own scope). */
  permission?: AiPermission;
  risk: ToolRisk;
  /** Minimum autonomy level at which the tool runs WITHOUT prior human approval. `null` = always requires approval. */
  autoApproveFrom: AutonomyLevel | null;
  /** Requires a real computer provider session. */
  requiresComputer?: boolean;
}

export const AGENT_TOOL_POLICIES: Record<AgentTool, AgentToolPolicy> = {
  read_task: { risk: 'low', autoApproveFrom: 'suggest' },
  list_shared_files: { permission: 'files.shared.view', risk: 'low', autoApproveFrom: 'suggest' },
  read_shared_file: { permission: 'files.shared.view', risk: 'low', autoApproveFrom: 'suggest' },
  read_workspace_file: { risk: 'low', autoApproveFrom: 'suggest' },
  list_workspace_files: { risk: 'low', autoApproveFrom: 'suggest' },
  write_workspace_file: { permission: 'files.own.modify', risk: 'low', autoApproveFrom: 'draft' },
  create_document: { permission: 'documents.create', risk: 'low', autoApproveFrom: 'draft' },
  search_documents: { permission: 'documents.read', risk: 'low', autoApproveFrom: 'suggest' },
  read_document: { permission: 'documents.read', risk: 'low', autoApproveFrom: 'suggest' },
  search_memory: { permission: 'memory.read', risk: 'low', autoApproveFrom: 'suggest' },
  write_memory: { permission: 'memory.write', risk: 'medium', autoApproveFrom: 'execute_internal' },
  read_decisions: { permission: 'decisions.read', risk: 'low', autoApproveFrom: 'suggest' },
  update_task_status: { permission: 'tasks.update_own', risk: 'low', autoApproveFrom: 'draft' },
  add_task_comment: { permission: 'tasks.update_own', risk: 'low', autoApproveFrom: 'draft' },
  create_subtask: { permission: 'tasks.create', risk: 'medium', autoApproveFrom: 'execute_internal' },
  delegate_task: { permission: 'delegate', risk: 'medium', autoApproveFrom: 'execute_internal' },
  message_employee: { risk: 'low', autoApproveFrom: 'draft' },
  request_approval: { risk: 'low', autoApproveFrom: 'suggest' },
  publish_file_to_shared: { permission: 'files.shared.upload', risk: 'high', autoApproveFrom: 'autonomous' },
  browser_action: { permission: 'computer.browser', risk: 'medium', autoApproveFrom: 'execute_internal', requiresComputer: true },
  terminal_command: { permission: 'computer.terminal', risk: 'high', autoApproveFrom: null, requiresComputer: true },
  finish: { risk: 'low', autoApproveFrom: 'suggest' },
};

const AUTONOMY_ORDER: Record<AutonomyLevel, number> = { suggest: 1, draft: 2, execute_internal: 3, autonomous: 4 };

export function autonomyAtLeast(level: AutonomyLevel, min: AutonomyLevel): boolean {
  return AUTONOMY_ORDER[level] >= AUTONOMY_ORDER[min];
}

/** Hard safety limits for AI-to-AI delegation and sessions. Organization settings may lower them, never raise above these. */
export const AI_SAFETY_LIMITS = {
  maxDelegationDepth: 3,
  maxChildActionsPerSession: 5,
  maxStepsPerSession: 24,
  sessionTimeoutMs: 20 * 60 * 1000,
  maxRetries: 2,
  maxOutputTokensPerStep: 8000,
  maxTokensPerSession: 400_000,
  maxCostHalalasPerSession: 2_000, // 20 SAR safety ceiling per session
  maxFileReadBytes: 512 * 1024,
} as const;

/** Nexus AI (the central assistant) tools. Read-mostly; mutations go through the same permission layer as the human caller. */
export const NEXUS_AI_TOOLS = [
  'inspect_company',
  'inspect_department',
  'inspect_employee',
  'inspect_employee_computer',
  'inspect_work_session',
  'inspect_goal',
  'inspect_mission',
  'inspect_project',
  'inspect_tasks',
  'retrieve_company_files',
  'retrieve_documents',
  'retrieve_memory',
  'retrieve_decisions',
  'summarize_activity',
  'create_task',
  'propose_mission',
  'create_project',
  'assign_employee',
  'request_approval',
] as const;
export type NexusAiTool = (typeof NEXUS_AI_TOOLS)[number];

export const TEMPLATE_CATEGORIES = [
  'executive',
  'product',
  'engineering',
  'marketing',
  'sales',
  'finance',
  'operations',
] as const;
export type TemplateCategory = (typeof TEMPLATE_CATEGORIES)[number];
