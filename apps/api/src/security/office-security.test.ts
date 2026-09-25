import { resolvePermissions } from '@nexus/shared';
import { describe, expect, it } from 'vitest';
import type { AiActor } from '../context.js';
import { evaluateToolCall } from '../services/agent/tool-guard.js';
import { NexusMeetingProvider, NoVoiceProvider } from '../services/communications/providers.js';
import { aiCanReadFile } from '../services/files/access-policy.js';
import { toStrictSlides } from '../services/presentations/presentation-service.js';
import type { FileRow } from '../types/db.js';

const ai = (perms: string[], autonomy: AiActor['autonomy'] = 'draft'): AiActor => ({ kind: 'ai', orgId: 'org-1', aiEmployeeId: 'ai-1', name: 'Atlas', permissions: new Set(perms), allowedFolderIds: [], autonomy, sessionId: 's' });
const caps = { files: true, documents: true, browser: false, terminal: false, meetingJoin: false };

describe('digital office tool guard', () => {
  it('communication tools need their explicit permissions', () => {
    for (const [tool, perm] of [['create_presentation', 'presentations.create'], ['read_email', 'email.read'], ['draft_email', 'email.draft'], ['send_email', 'email.send'], ['list_calendar', 'calendar.view'], ['schedule_meeting', 'meetings.create'], ['process_meeting', 'meetings.create_tasks']] as const) {
      expect(evaluateToolCall(ai([]), tool, caps)).toMatchObject({ decision: 'deny', reason: `missing_permission:${perm}` });
    }
  });
  it('joining a meeting is refused when no meeting provider can join (no fake attendance)', () => {
    expect(evaluateToolCall(ai(['meetings.join'], 'autonomous'), 'join_meeting', caps)).toMatchObject({ decision: 'deny', reason: 'meeting_provider_not_connected' });
    expect(evaluateToolCall(ai(['meetings.join'], 'autonomous'), 'join_meeting', { ...caps, meetingJoin: true }).decision).toBe('allow');
  });
  it('scheduling meetings needs execute_internal autonomy or approval', () => {
    expect(evaluateToolCall(ai(['meetings.create'], 'draft'), 'schedule_meeting', caps).decision).toBe('needs_approval');
    expect(evaluateToolCall(ai(['meetings.create'], 'execute_internal'), 'schedule_meeting', caps).decision).toBe('allow');
  });
  it('humans cannot grant AI access to private files through communication permissions', () => {
    const everything = ai(['files.shared.view', 'email.attach_files', 'email.send', 'email.send_external', 'presentations.publish'], 'autonomous');
    const privateFile = { organization_id: 'org-1', space: 'private', visibility: 'private_owner', owner_user_id: 'u', uploaded_by_user_id: 'u', folder_id: null } as unknown as FileRow;
    expect(aiCanReadFile(everything, privateFile)).toBe(false); // → cannot be attached to emails or used in presentations
    expect(resolvePermissions('owner').has('files.private.use')).toBe(true);
  });
});

describe('providers report capabilities honestly', () => {
  it('NEXUS meetings cannot join/listen/speak and say so', async () => {
    const p = new NexusMeetingProvider();
    expect(p.capabilities).toMatchObject({ join: false, listen: false, speak: false, createMeeting: true });
    await expect(p.joinMeeting()).rejects.toMatchObject({ code: 'meeting_provider_not_connected' });
    await expect(p.sendAudio()).rejects.toMatchObject({ code: 'meeting_provider_not_connected' });
  });
  it('no voice provider → TTS is refused', async () => {
    await expect(new NoVoiceProvider().textToSpeech()).rejects.toMatchObject({ code: 'voice_provider_not_connected' });
  });
});

describe('AI deck normalization', () => {
  it('keeps valid slides, drops invalid ones, clamps long text', () => {
    const nulls = { role: null, subtitle: null, points: null, note: null, left_title: null, left_points: null, right_title: null, right_points: null, metrics: null, chart_type: null, categories: null, series: null, headers: null, rows: null, milestones: null, quote: null, attribution: null };
    const slides = toStrictSlides([
      { ...nulls, kind: 'cover', title: 'x'.repeat(500), subtitle: 's' },
      { ...nulls, kind: 'kpis', title: 'empty metrics' }, // invalid: needs ≥1 metric
      { ...nulls, kind: 'chart', title: 'c', chart_type: 'bar', categories: ['a', 'b'], series: [{ name: 'n', values: [1, Number.NaN, 3] }] },
    ]);
    expect(slides.map((s) => s.kind)).toEqual(['cover', 'chart']);
    expect(slides[0]!.title.length).toBe(160);
  });
});
