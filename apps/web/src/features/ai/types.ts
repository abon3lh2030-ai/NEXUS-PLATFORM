export interface AiEmployee {
  id: string;
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
  status: string;
  autonomy: 'suggest' | 'draft' | 'execute_internal' | 'autonomous';
  provider: string;
  model: string;
  is_active: boolean;
  created_at: string;
}

export interface AiEmployeeDetail extends AiEmployee {
  permissions: { permissions: string[]; allowed_folder_ids: string[] } | null;
  workspace: { notes: string } | null;
  computer: { id: string; provider: string; status: string; capabilities: Record<string, boolean> } | null;
  queue: Array<{ id: string; status: string; current_step: string | null; task_id: string | null; priority: number; queued_at: string; tasks: { title: string; due_date: string | null; priority: string } | null }>;
}

export interface Template {
  id: string;
  code: string;
  category: string;
  name_ar: string;
  name_en: string;
  job_title_ar: string;
  job_title_en: string;
  description_ar: string;
  description_en: string;
  responsibilities: string[];
  skills: string[];
  default_autonomy: AiEmployee['autonomy'];
}

export interface SessionEvent {
  id: number;
  event_type: string;
  message: string;
  data: Record<string, unknown>;
  created_at: string;
}

export interface ToolExecution {
  id: string;
  tool: string;
  status: string;
  risk: string;
  input: Record<string, unknown>;
  denial_reason: string | null;
  output_summary: string | null;
  error: string | null;
  duration_ms: number | null;
  created_at: string;
}

export interface WorkSession {
  id: string;
  ai_employee_id: string;
  task_id: string | null;
  status: string;
  current_step: string | null;
  provider: string;
  model: string;
  started_at: string | null;
  completed_at: string | null;
  queued_at: string;
  input_tokens: number;
  output_tokens: number;
  estimated_cost_usd: number;
  estimated_cost_sar?: number;
  delegation_depth: number;
  error: string | null;
  outputs: Array<{ kind: string; id: string; title: string }>;
  tasks?: { title: string; description?: string } | null;
  ai_employees?: { name: string; job_title: string; avatar_seed: string } | null;
  events?: SessionEvent[];
  tool_executions?: ToolExecution[];
  outputs_rows?: unknown[];
  computer_logs?: Array<{ at: string; kind: string; message: string }>;
}
