import { AI_SAFETY_LIMITS } from '@nexus/shared';
import type { AiActor } from '../../context.js';
import { AppError } from '../../lib/errors.js';
import type { Db } from '../../lib/supabase.js';
import type { FileService } from '../files/file-service.js';
import {
  ComputerCapabilityError,
  type ComputerCapabilities,
  type ComputerLogEntry,
  type ComputerProvider,
  type ComputerSession,
  type ComputerWorkspace,
} from './computer-provider.js';

/**
 * "Managed Workspace" computer: a real, isolated per-employee workspace backed by private
 * Supabase Storage (prefix {org}/ai/{employee}/) and tenant-scoped database rows.
 *
 * What it genuinely supports: file explorer, reading allowed files, writing files,
 * creating documents, session logs.
 * What it does NOT support (reported as unavailable, never simulated): web browser, terminal.
 * Those require an external sandbox provider (see E2BComputerProvider).
 */
export class StorageWorkspaceComputerProvider implements ComputerProvider {
  readonly name = 'storage_workspace';
  readonly capabilities: ComputerCapabilities = { files: true, documents: true, browser: false, terminal: false };

  constructor(
    private readonly db: Db,
    private readonly files: FileService,
  ) {}

  private async log(sessionId: string, entry: Omit<ComputerLogEntry, 'at'>): Promise<void> {
    const { data } = await this.db.from('ai_computer_sessions').select('logs').eq('id', sessionId).maybeSingle<{ logs: ComputerLogEntry[] }>();
    const logs = [...(data?.logs ?? []), { ...entry, at: new Date().toISOString() }].slice(-500);
    await this.db.from('ai_computer_sessions').update({ logs }).eq('id', sessionId);
  }

  async createWorkspace(ai: Pick<AiActor, 'orgId' | 'aiEmployeeId'>): Promise<ComputerWorkspace> {
    await this.db.from('ai_workspaces').upsert({ organization_id: ai.orgId, ai_employee_id: ai.aiEmployeeId }, { onConflict: 'ai_employee_id' });
    const { data, error } = await this.db
      .from('ai_computers')
      .upsert(
        { organization_id: ai.orgId, ai_employee_id: ai.aiEmployeeId, provider: this.name, capabilities: this.capabilities, status: 'ready' },
        { onConflict: 'ai_employee_id' },
      )
      .select('id')
      .single<{ id: string }>();
    if (error || !data) throw new AppError(500, 'computer_create_failed', error?.message);
    return { computerId: data.id, provider: this.name, capabilities: this.capabilities };
  }

  async createSession(ai: AiActor, workSessionId: string): Promise<ComputerSession> {
    const ws = await this.createWorkspace(ai);
    const { data, error } = await this.db
      .from('ai_computer_sessions')
      .insert({
        organization_id: ai.orgId,
        computer_id: ws.computerId,
        work_session_id: workSessionId,
        provider: this.name,
        status: 'running',
        logs: [{ at: new Date().toISOString(), kind: 'session', message: 'Workspace session started' }],
      })
      .select('id, started_at')
      .single<{ id: string; started_at: string }>();
    if (error || !data) throw new AppError(500, 'computer_session_failed', error?.message);
    await this.db.from('ai_computers').update({ status: 'busy' }).eq('id', ws.computerId);
    return { id: data.id, computerId: ws.computerId, provider: this.name, providerSessionId: null, status: 'running', startedAt: data.started_at };
  }

  async executeTool(session: ComputerSession, _ai: AiActor, tool: string): Promise<{ output: string }> {
    await this.log(session.id, { kind: 'tool', message: `Unsupported tool requested: ${tool}` });
    throw new ComputerCapabilityError('terminal', this.name);
  }

  async readFile(session: ComputerSession, ai: AiActor, fileId: string) {
    const res = await this.files.aiReadFile(ai, fileId, AI_SAFETY_LIMITS.maxFileReadBytes);
    await this.log(session.id, { kind: 'file', message: `Read file ${res.name}` });
    return res;
  }

  async writeFile(session: ComputerSession, ai: AiActor, name: string, content: string) {
    const row = await this.files.aiWriteWorkspaceFile(ai, name, content);
    await this.log(session.id, { kind: 'file', message: `Created file ${row.original_name}` });
    return { fileId: row.id, name: row.original_name };
  }

  async listFiles(session: ComputerSession, ai: AiActor) {
    const rows = await this.files.aiListWorkspaceFiles(ai);
    await this.log(session.id, { kind: 'file', message: `Listed ${rows.length} workspace files` });
    return rows.map((r) => ({ id: r.id, name: r.original_name, size: r.size, created_at: r.created_at }));
  }

  async createDocument(session: ComputerSession, ai: AiActor, doc: { title: string; content: string; doc_type: string; task_id?: string | null }) {
    // AI-authored documents start as drafts; publishing depends on autonomy/approval (handled by the agent runtime).
    const { data, error } = await this.db
      .from('documents')
      .insert({
        organization_id: ai.orgId,
        title: doc.title.slice(0, 300),
        doc_type: doc.doc_type,
        content: doc.content,
        created_by_ai_employee_id: ai.aiEmployeeId,
        status: 'draft',
      })
      .select('id')
      .single<{ id: string }>();
    if (error || !data) throw new AppError(500, 'document_create_failed', error?.message);
    await this.db.from('document_versions').insert({
      document_id: data.id,
      organization_id: ai.orgId,
      version: 1,
      title: doc.title.slice(0, 300),
      content: doc.content,
      change_summary: 'Created by AI employee',
      created_by_ai_employee_id: ai.aiEmployeeId,
    });
    await this.log(session.id, { kind: 'document', message: `Created document "${doc.title.slice(0, 120)}"` });
    return { documentId: data.id };
  }

  async browserAction(session: ComputerSession): Promise<{ output: string }> {
    await this.log(session.id, { kind: 'browser', message: 'Browser requested but not available on this provider' });
    throw new ComputerCapabilityError('browser', this.name);
  }

  async terminalCommand(session: ComputerSession): Promise<{ output: string; exitCode: number }> {
    await this.log(session.id, { kind: 'terminal', message: 'Terminal requested but not available on this provider' });
    throw new ComputerCapabilityError('terminal', this.name);
  }

  async terminateSession(session: ComputerSession): Promise<void> {
    const endedAt = new Date();
    const usage = Math.max(0, Math.round((endedAt.getTime() - new Date(session.startedAt).getTime()) / 1000));
    await this.log(session.id, { kind: 'session', message: 'Workspace session ended' });
    await this.db.from('ai_computer_sessions').update({ status: 'stopped', ended_at: endedAt.toISOString(), usage_seconds: usage }).eq('id', session.id);
    await this.db.from('ai_computers').update({ status: 'ready' }).eq('id', session.computerId);
  }

  async getSessionStatus(sessionId: string) {
    const { data } = await this.db.from('ai_computer_sessions').select('status').eq('id', sessionId).maybeSingle<{ status: ComputerSession['status'] }>();
    return data?.status ?? null;
  }

  async getLogs(sessionId: string) {
    const { data } = await this.db.from('ai_computer_sessions').select('logs').eq('id', sessionId).maybeSingle<{ logs: ComputerLogEntry[] }>();
    return data?.logs ?? [];
  }
}
