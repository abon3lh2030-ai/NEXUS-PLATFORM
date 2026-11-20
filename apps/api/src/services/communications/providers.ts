import { AppError } from '../../lib/errors.js';

/**
 * Provider abstractions for the AI Employee Digital Office. Core business logic depends only on
 * these interfaces. Every provider declares its capabilities; callers check them and report
 * "not connected / not supported" honestly instead of simulating behavior.
 */

export class ProviderNotConnectedError extends AppError {
  constructor(kind: string, capability?: string) {
    super(503, `${kind}_provider_not_connected`, capability ? `${kind}:${capability}` : kind);
  }
}

/* ============================== Calendar ============================== */

export interface CalendarEventInput {
  title: string;
  description: string;
  startsAt: Date;
  endsAt: Date;
  attendees: string[]; // emails
  location?: string | null;
}

export interface CalendarProvider {
  readonly name: string;
  readonly capabilities: { internal: boolean; externalSync: boolean; freeBusy: boolean; invitations: boolean };
  /** Pushes an event to the external calendar; returns the provider event id. */
  createExternalEvent(orgId: string, ownerRef: string, e: CalendarEventInput): Promise<string>;
  cancelExternalEvent(orgId: string, ownerRef: string, providerEventId: string): Promise<void>;
}

/** Built-in NEXUS calendar (events live in calendar_events). No external sync. */
export class NexusCalendarProvider implements CalendarProvider {
  readonly name = 'nexus';
  readonly capabilities = { internal: true, externalSync: false, freeBusy: true, invitations: false };
  async createExternalEvent(): Promise<string> {
    throw new ProviderNotConnectedError('calendar', 'external_sync');
  }
  async cancelExternalEvent(): Promise<void> {
    throw new ProviderNotConnectedError('calendar', 'external_sync');
  }
}

/* ============================== Meetings ============================== */

export interface MeetingCapabilities {
  createMeeting: boolean;
  join: boolean;
  listen: boolean;
  transcript: boolean;
  speak: boolean;
  sharePresentation: boolean;
  participants: boolean;
}

/**
 * Live meetings run on LiveKit. The provider sends the AI employee into a meeting's room
 * (as a LiveKit Agents participant) and takes it out again.
 */
export interface MeetingProvider {
  readonly name: string;
  readonly capabilities: MeetingCapabilities;
  dispatchAgent(orgId: string, meetingId: string): Promise<{ joined: boolean; reason?: string }>;
  removeAgent(orgId: string, meetingId: string): Promise<void>;
}

/** Without LiveKit settings: scheduling, notes, manual transcripts and AI processing only — no live attendance. */
export class NexusMeetingProvider implements MeetingProvider {
  readonly name = 'nexus';
  readonly capabilities: MeetingCapabilities = { createMeeting: true, join: false, listen: false, transcript: false, speak: false, sharePresentation: false, participants: false };
  async dispatchAgent(): Promise<{ joined: boolean }> {
    throw new ProviderNotConnectedError('meeting', 'join');
  }
  async removeAgent(): Promise<void> {
    throw new ProviderNotConnectedError('meeting', 'join');
  }
}

/** LiveKit rooms; the meeting agent worker listens, transcribes, answers by voice and summarizes. */
export class LiveKitMeetingProvider implements MeetingProvider {
  readonly name = 'livekit';
  readonly capabilities: MeetingCapabilities = { createMeeting: true, join: true, listen: true, transcript: true, speak: true, sharePresentation: false, participants: true };
  constructor(private readonly live: { dispatchForMeeting(orgId: string, meetingId: string): Promise<{ joined: boolean; reason?: string }>; removeAgent(orgId: string, meetingId: string): Promise<void> }) {}
  dispatchAgent(orgId: string, meetingId: string) {
    return this.live.dispatchForMeeting(orgId, meetingId);
  }
  removeAgent(orgId: string, meetingId: string) {
    return this.live.removeAgent(orgId, meetingId);
  }
}

/* ============================== Voice ============================== */

export interface VoiceProvider {
  readonly name: string;
  readonly capabilities: { tts: boolean; stt: boolean; streaming: boolean; languages: Array<'ar' | 'en'> };
  textToSpeech(input: { text: string; voiceId: string | null; language: 'ar' | 'en' }): Promise<{ audio: Buffer; mime: 'audio/mpeg' }>;
  speechToText(input: { audio: Buffer; mime: string; language: 'ar' | 'en' }): Promise<{ text: string }>;
}

export class NoVoiceProvider implements VoiceProvider {
  readonly name = 'none';
  readonly capabilities = { tts: false, stt: false, streaming: false, languages: [] as Array<'ar' | 'en'> };
  async textToSpeech(): Promise<{ audio: Buffer; mime: 'audio/mpeg' }> {
    throw new ProviderNotConnectedError('voice', 'tts');
  }
  async speechToText(): Promise<{ text: string }> {
    throw new ProviderNotConnectedError('voice', 'stt');
  }
}

/** ElevenLabs (multilingual TTS incl. Arabic; Scribe STT). Verified only once an API key is provided. */
export class ElevenLabsVoiceProvider implements VoiceProvider {
  readonly name = 'elevenlabs';
  readonly capabilities = { tts: true, stt: true, streaming: false, languages: ['ar', 'en'] as Array<'ar' | 'en'> };
  constructor(
    private readonly apiKey: string,
    private readonly defaultVoiceId: string | undefined,
  ) {}

  async textToSpeech(input: { text: string; voiceId: string | null; language: 'ar' | 'en' }) {
    const voice = input.voiceId ?? this.defaultVoiceId;
    if (!voice) throw new AppError(400, 'voice_not_configured');
    const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voice)}`, {
      method: 'POST',
      headers: { 'xi-api-key': this.apiKey, 'Content-Type': 'application/json', Accept: 'audio/mpeg' },
      body: JSON.stringify({ text: input.text.slice(0, 2500), model_id: 'eleven_multilingual_v2', language_code: input.language }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) throw new AppError(502, 'voice_provider_error', `elevenlabs_${res.status}`);
    return { audio: Buffer.from(await res.arrayBuffer()), mime: 'audio/mpeg' as const };
  }

  async speechToText(input: { audio: Buffer; mime: string; language: 'ar' | 'en' }) {
    const form = new FormData();
    form.append('model_id', 'scribe_v1');
    form.append('language_code', input.language === 'ar' ? 'ara' : 'eng');
    form.append('file', new Blob([new Uint8Array(input.audio)], { type: input.mime }), 'audio');
    const res = await fetch('https://api.elevenlabs.io/v1/speech-to-text', { method: 'POST', headers: { 'xi-api-key': this.apiKey }, body: form, signal: AbortSignal.timeout(60_000) });
    if (!res.ok) throw new AppError(502, 'voice_provider_error', `elevenlabs_${res.status}`);
    const json = (await res.json()) as { text?: string };
    return { text: json.text ?? '' };
  }
}
