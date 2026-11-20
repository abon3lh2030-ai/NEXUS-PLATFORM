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
import type { OfficeTools } from './agent/tools.js';
import { MailService } from './communications/mail-service.js';
import { OfficeService } from './communications/office-service.js';
import { TeamService } from './team-service.js';
import { SignatureService } from './signatures/signature-service.js';
import { PushService } from './push/push-service.js';
import { FounderService } from './founder/founder-service.js';
import { LiveKitService } from './meetings/livekit-service.js';
import {
  ElevenLabsVoiceProvider,
  NexusCalendarProvider,
  LiveKitMeetingProvider,
  NexusMeetingProvider,
  NoVoiceProvider,
  type MeetingProvider,
  type VoiceProvider,
} from './communications/providers.js';
import { PresentationService } from './presentations/presentation-service.js';
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
  presentations: PresentationService;
  mail: MailService;
  office: OfficeService;
  livekit: LiveKitService;
  team: TeamService;
  signatures: SignatureService;
  push: PushService;
  founder: FounderService;
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
  const push = new PushService(
    db,
    log,
    env.APNS_KEY_ID && env.APNS_TEAM_ID && env.APNS_PRIVATE_KEY ? { keyId: env.APNS_KEY_ID, teamId: env.APNS_TEAM_ID, privateKey: env.APNS_PRIVATE_KEY, bundleId: env.APNS_BUNDLE_ID } : null,
  );
  notifications.onNotify = (userIds, n) => push.push(userIds, n);
  const email = new EmailService(createEmailProvider(env, log), db, log);
  const entitlements = new EntitlementService(db, env.USD_TO_SAR_RATE, env.AI_DEFAULT_MODEL);
  const files = new FileService(env, db, entitlements, audit, new NoopScanner());
  const computer: ComputerProvider = env.COMPUTER_PROVIDER === 'e2b' ? createE2BProvider() : new StorageWorkspaceComputerProvider(db, files);
  // Digital office (constructed after the runtime; the runtime resolves it lazily).
  let officeTools: OfficeTools | null = null;
  const agents = new AgentRuntime({
    env, db, ai, computer, files, entitlements, notifications, audit, log,
    office: () => {
      if (!officeTools) throw new Error('office services not initialized');
      return officeTools;
    },
  });
  const billing = new BillingService(env, db, entitlements, notifications, email, audit, log);
  const work = new WorkService(db, entitlements, audit, notifications, agents);
  const orgs = new OrganizationService(env, db, email, audit, notifications);
  const insights = new InsightsService(db);
  const nexusAi = new NexusAiService(db, ai, work, agents, insights, entitlements);
  const platform = new PlatformService(env, db, email, audit, notifications, entitlements);
  const presentations = new PresentationService(db, ai, files, notifications, audit, entitlements);
  const mail = new MailService(env, db, email, notifications, audit, entitlements);
  const livekit = new LiveKitService(env, db, ai, entitlements, audit, log);
  const meetingProvider: MeetingProvider = livekit.configured ? new LiveKitMeetingProvider(livekit) : new NexusMeetingProvider();
  const voice: VoiceProvider = env.VOICE_PROVIDER === 'elevenlabs' && env.ELEVENLABS_API_KEY ? new ElevenLabsVoiceProvider(env.ELEVENLABS_API_KEY, env.ELEVENLABS_DEFAULT_VOICE_ID) : new NoVoiceProvider();
  const office = new OfficeService(db, ai, new NexusCalendarProvider(), meetingProvider, voice, mail, work, notifications, audit, entitlements);
  // Queued post-meeting summaries: tasks are created only if the attending AI employee may create them.
  livekit.processMeeting = async (orgId, meetingId, aiEmployeeId, model) => {
    const { data: perms } = aiEmployeeId ? await db.from('ai_employee_permissions').select('permissions').eq('ai_employee_id', aiEmployeeId).eq('organization_id', orgId).maybeSingle<{ permissions: string[] }>() : { data: null };
    const { data: voice } = aiEmployeeId ? await db.from('voice_profiles').select('language').eq('ai_employee_id', aiEmployeeId).maybeSingle<{ language: 'ar' | 'en' }>() : { data: null };
    return office.processMeeting(orgId, meetingId, aiEmployeeId ? { aiEmployeeId } : {}, { createTasks: (perms?.permissions ?? []).includes('meetings.create_tasks'), language: voice?.language ?? 'ar', model });
  };
  officeTools = { presentations, mail, office };
  return { env, db, log, ai, audit, notifications, email, entitlements, files, computer, agents, billing, work, orgs, nexusAi, insights, platform, meetingAi: new MeetingAiService(db, ai, work, entitlements), presentations, mail, office, livekit, team: new TeamService(db, ai, entitlements), signatures: new SignatureService(env, db, files, entitlements, notifications, email, audit), push, founder: new FounderService(db, log) };
}
