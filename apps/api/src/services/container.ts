import type { FastifyBaseLogger } from 'fastify';
import type { Env } from '../config/env.js';
import { createServiceClient, type Db } from '../lib/supabase.js';
import { AnthropicProvider } from './ai/anthropic-provider.js';
import { MockAIProvider } from './ai/mock-provider.js';
import type { AIProvider } from './ai/provider.js';
import { AgentRuntime } from './agent/runtime.js';
import { AuditService } from './audit.js';
import { BillingService } from './billing/billing-service.js';
import type { ComputerProvider } from './computer/computer-provider.js';
import { createE2BProvider } from './computer/e2b-provider.js';
import { StorageWorkspaceComputerProvider } from './computer/storage-workspace-provider.js';
import { createEmailProvider, EmailService } from './email/provider.js';
import { EntitlementService } from './entitlements.js';
import { FileService } from './files/file-service.js';
import { NoopScanner } from './files/scanner.js';
import { NexusAiService } from './nexus-ai/nexus-ai-service.js';
import { NotificationService } from './notifications.js';
import { OrganizationService } from './organizations.js';
import { WorkService } from './work-service.js';
import { InsightsService } from './insights.js';
import { PlatformService } from './platform-service.js';
import { MeetingAiService } from './meeting-ai.js';
import { mockFixtures } from './ai/mock-fixtures.js';

export interface Services {
  env: Env;
  db: Db;
  log: FastifyBaseLogger;
  ai: AIProvider;
  audit: AuditService;
  notifications: NotificationService;
  email: EmailService;
  entitlements: EntitlementService;
  files: FileService;
  computer: ComputerProvider;
  agents: AgentRuntime;
  billing: BillingService;
  work: WorkService;
  orgs: OrganizationService;
  nexusAi: NexusAiService;
  insights: InsightsService;
  platform: PlatformService;
  meetingAi: MeetingAiService;
}

export function createAIProvider(env: Env): AIProvider {
  if (env.AI_PROVIDER === 'mock') {
    if (env.NODE_ENV === 'production') throw new Error('mock AI provider is not allowed in production');
    return new MockAIProvider(mockFixtures());
  }
  return new AnthropicProvider(env.ANTHROPIC_API_KEY!, env.AI_DEFAULT_MODEL, env.AI_EFFORT);
}

export function createServices(env: Env, log: FastifyBaseLogger, overrides: Partial<Pick<Services, 'db' | 'ai'>> = {}): Services {
  const db = overrides.db ?? createServiceClient(env);
  const ai = overrides.ai ?? createAIProvider(env);
  const audit = new AuditService(db);
  const notifications = new NotificationService(db);
  const email = new EmailService(createEmailProvider(env, log), db, log);
  const entitlements = new EntitlementService(db);
  const files = new FileService(env, db, entitlements, audit, new NoopScanner());
  const computer: ComputerProvider = env.COMPUTER_PROVIDER === 'e2b' ? createE2BProvider() : new StorageWorkspaceComputerProvider(db, files);
  const agents = new AgentRuntime({ env, db, ai, computer, files, entitlements, notifications, audit, log });
  const billing = new BillingService(env, db, entitlements, notifications, email, audit, log);
  const work = new WorkService(db, entitlements, audit, notifications, agents);
  const orgs = new OrganizationService(env, db, email, audit, notifications);
  const insights = new InsightsService(db);
  const nexusAi = new NexusAiService(db, ai, work, agents, insights);
  const platform = new PlatformService(env, db, email, audit, notifications, entitlements);
  return { env, db, log, ai, audit, notifications, email, entitlements, files, computer, agents, billing, work, orgs, nexusAi, insights, platform, meetingAi: new MeetingAiService(db, ai, work) };
}
