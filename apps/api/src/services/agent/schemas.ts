import { z } from 'zod';
import { AGENT_TOOLS, DOCUMENT_TYPES, MEMORY_TYPES } from '@nexus/shared';

/**
 * The single structured output the model returns each step. Every arg is present-but-nullable
 * (friendly to strict structured outputs); per-tool Zod schemas below then validate strictly.
 */
export const agentStepSchema = z.object({
  phase: z.enum(['thinking', 'researching', 'reading', 'writing', 'executing']),
  progress_note: z.string().describe('One short sentence for the manager timeline describing what you are doing now.'),
  tool: z.enum(AGENT_TOOLS),
  args: z.object({
    file_id: z.string().nullable(),
    document_id: z.string().nullable(),
    ai_employee_id: z.string().nullable(),
    query: z.string().nullable(),
    name: z.string().nullable(),
    title: z.string().nullable(),
    content: z.string().nullable(),
    body: z.string().nullable(),
    doc_type: z.string().nullable(),
    memory_type: z.string().nullable(),
    status: z.string().nullable(),
    url: z.string().nullable(),
    command: z.string().nullable(),
    summary: z.string().nullable(),
    email_id: z.string().nullable(),
    to: z.string().nullable().describe('Comma-separated email addresses'),
    attachment_ids: z.string().nullable().describe('Comma-separated file ids'),
    meeting_id: z.string().nullable(),
    starts_at: z.string().nullable().describe('ISO 8601 date-time'),
    ends_at: z.string().nullable().describe('ISO 8601 date-time'),
    duration_minutes: z.number().nullable(),
    language: z.string().nullable(),
  }),
});
export type AgentStep = z.infer<typeof agentStepSchema>;

const id = z.uuid();
const str = (max: number) => z.string().trim().min(1).max(max);

export const TOOL_ARG_SCHEMAS = {
  read_task: z.object({}),
  list_shared_files: z.object({ query: str(200).optional() }),
  read_shared_file: z.object({ file_id: id }),
  read_workspace_file: z.object({ file_id: id }),
  list_workspace_files: z.object({}),
  write_workspace_file: z.object({ name: str(180), content: z.string().max(200_000) }),
  create_document: z.object({ title: str(300), doc_type: z.enum(DOCUMENT_TYPES).default('report'), content: z.string().min(1).max(300_000) }),
  search_documents: z.object({ query: str(200) }),
  read_document: z.object({ document_id: id }),
  search_memory: z.object({ query: str(200) }),
  write_memory: z.object({ title: str(300), content: str(8000), memory_type: z.enum(MEMORY_TYPES).default('lesson') }),
  read_decisions: z.object({ query: str(200).optional() }),
  update_task_status: z.object({ status: z.enum(['in_progress', 'review', 'blocked']) }),
  add_task_comment: z.object({ body: str(8000) }),
  create_subtask: z.object({ title: str(300), content: z.string().max(8000).optional() }),
  delegate_task: z.object({ ai_employee_id: id, title: str(300), content: z.string().max(8000).optional() }),
  message_employee: z.object({ ai_employee_id: id, body: str(4000) }),
  request_approval: z.object({ title: str(300), body: z.string().max(4000).optional() }),
  publish_file_to_shared: z.object({ file_id: id }),
  browser_action: z.object({ url: z.url({ protocol: /^https$/ }) }),
  terminal_command: z.object({ command: str(1000) }),
  create_presentation: z.object({ title: str(200), content: str(8000), language: z.enum(['ar', 'en']).optional() }),
  list_emails: z.object({ query: str(200).optional() }),
  read_email: z.object({ email_id: id }),
  draft_email: z.object({ to: str(2000), title: str(300), body: str(50_000), attachment_ids: z.string().max(400).optional(), email_id: id.optional() }),
  send_email: z.object({ email_id: id }),
  list_calendar: z.object({ starts_at: z.iso.datetime({ offset: true }).optional(), ends_at: z.iso.datetime({ offset: true }).optional() }),
  find_free_time: z.object({ starts_at: z.iso.datetime({ offset: true }), ends_at: z.iso.datetime({ offset: true }), duration_minutes: z.number().int().min(15).max(480), to: z.string().max(2000).optional() }),
  schedule_meeting: z.object({ title: str(200), starts_at: z.iso.datetime({ offset: true }), duration_minutes: z.number().int().min(15).max(480), to: z.string().max(2000).optional(), body: z.string().max(8000).optional() }),
  join_meeting: z.object({ meeting_id: id }),
  process_meeting: z.object({ meeting_id: id }),
  finish: z.object({ summary: str(8000), title: str(300).optional(), content: z.string().max(300_000).optional() }),
} as const;

export function cleanArgs(args: AgentStep['args']): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(args)) if (v !== null && v !== '') out[k] = v;
  return out;
}
