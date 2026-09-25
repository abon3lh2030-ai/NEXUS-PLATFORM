import type { AiActor } from '../../context.js';

export interface ComputerCapabilities {
  files: boolean;
  documents: boolean;
  browser: boolean;
  terminal: boolean;
}

export interface ComputerWorkspace {
  computerId: string;
  provider: string;
  capabilities: ComputerCapabilities;
}

export interface ComputerSession {
  id: string;
  computerId: string;
  provider: string;
  providerSessionId: string | null;
  status: 'starting' | 'running' | 'stopped' | 'failed';
  startedAt: string;
}

export interface ComputerLogEntry {
  at: string;
  kind: 'session' | 'file' | 'document' | 'browser' | 'terminal' | 'tool';
  message: string;
}

export class ComputerCapabilityError extends Error {
  constructor(
    public readonly capability: keyof ComputerCapabilities,
    public readonly provider: string,
  ) {
    super(`capability_not_available:${capability}`);
    this.name = 'ComputerCapabilityError';
  }
}

/**
 * Abstraction over an isolated execution environment for one AI employee.
 * Every call is scoped by an AiActor (organization + AI employee) — providers must never
 * expose the host filesystem, environment variables or other tenants' data.
 */
export interface ComputerProvider {
  readonly name: string;
  readonly capabilities: ComputerCapabilities;
  createWorkspace(ai: Pick<AiActor, 'orgId' | 'aiEmployeeId'>): Promise<ComputerWorkspace>;
  createSession(ai: AiActor, workSessionId: string): Promise<ComputerSession>;
  executeTool(session: ComputerSession, ai: AiActor, tool: string, input: Record<string, unknown>): Promise<{ output: string }>;
  readFile(session: ComputerSession, ai: AiActor, fileId: string): Promise<{ name: string; content: string; truncated: boolean }>;
  writeFile(session: ComputerSession, ai: AiActor, name: string, content: string): Promise<{ fileId: string; name: string }>;
  listFiles(session: ComputerSession, ai: AiActor): Promise<Array<{ id: string; name: string; size: number; created_at: string }>>;
  createDocument(
    session: ComputerSession,
    ai: AiActor,
    doc: { title: string; content: string; doc_type: string; task_id?: string | null },
  ): Promise<{ documentId: string }>;
  browserAction(session: ComputerSession, ai: AiActor, action: { type: 'open' | 'extract'; url: string }): Promise<{ output: string }>;
  terminalCommand(session: ComputerSession, ai: AiActor, command: string): Promise<{ output: string; exitCode: number }>;
  terminateSession(session: ComputerSession): Promise<void>;
  getSessionStatus(sessionId: string): Promise<ComputerSession['status'] | null>;
  getLogs(sessionId: string): Promise<ComputerLogEntry[]>;
}
