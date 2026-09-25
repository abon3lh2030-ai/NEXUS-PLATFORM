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

export interface MeetingBot {
  providerBotId: string;
  status: 'joining' | 'in_meeting' | 'left' | 'failed';
}

export interface MeetingProvider {
  readonly name: string;
  readonly capabilities: MeetingCapabilities;
  createMeeting(input: { title: string; startsAt: Date; endsAt: Date }): Promise<{ meetingUrl: string | null; providerMeetingId: string | null }>;
  joinMeeting(input: { meetingUrl: string; botName: string }): Promise<MeetingBot>;
  leaveMeeting(providerBotId: string): Promise<void>;
  getMeetingStatus(providerBotId: string): Promise<MeetingBot['status']>;
  getParticipants(providerBotId: string): Promise<string[]>;
  getTranscript(providerBotId: string): Promise<Array<{ speaker: string | null; text: string; startMs: number | null }>>;
  sendAudio(providerBotId: string, mp3: Buffer): Promise<void>;
  receiveAudio(providerBotId: string): Promise<never>;
  sharePresentation(providerBotId: string, fileUrl: string): Promise<void>;
}

/**
 * NEXUS-native meetings: scheduling, agenda, files, manual transcripts/notes and AI processing.
 * It cannot join a live call — that requires a meeting-bot provider (see RecallMeetingProvider).
 */
export class NexusMeetingProvider implements MeetingProvider {
  readonly name = 'nexus';
  readonly capabilities: MeetingCapabilities = { createMeeting: true, join: false, listen: false, transcript: false, speak: false, sharePresentation: false, participants: false };
  async createMeeting() {
    return { meetingUrl: null, providerMeetingId: null };
  }
  async joinMeeting(): Promise<MeetingBot> {
    throw new ProviderNotConnectedError('meeting', 'join');
  }
  async leaveMeeting(): Promise<void> {
    throw new ProviderNotConnectedError('meeting', 'join');
  }
  async getMeetingStatus(): Promise<MeetingBot['status']> {
    throw new ProviderNotConnectedError('meeting', 'join');
  }
  async getParticipants(): Promise<string[]> {
    throw new ProviderNotConnectedError('meeting', 'participants');
  }
  async getTranscript(): Promise<Array<{ speaker: string | null; text: string; startMs: number | null }>> {
    throw new ProviderNotConnectedError('meeting', 'transcript');
  }
  async sendAudio(): Promise<void> {
    throw new ProviderNotConnectedError('meeting', 'speak');
  }
  async receiveAudio(): Promise<never> {
    throw new ProviderNotConnectedError('meeting', 'listen');
  }
  async sharePresentation(): Promise<void> {
    throw new ProviderNotConnectedError('meeting', 'share');
  }
}

/**
 * Recall.ai meeting bots (Zoom / Google Meet / Microsoft Teams): join, transcript, output audio.
 * NOTE: implemented against Recall.ai's public REST API; must be verified with a real API key
 * before being reported as working (see ENV_SETUP.md → إعداد الاجتماعات).
 */
export class RecallMeetingProvider implements MeetingProvider {
  readonly name = 'recall';
  readonly capabilities: MeetingCapabilities = { createMeeting: false, join: true, listen: true, transcript: true, speak: true, sharePresentation: false, participants: true };
  private readonly base: string;

  constructor(
    private readonly apiKey: string,
    region: string,
  ) {
    this.base = `https://${region}.recall.ai/api/v1`;
  }

  private async req<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
    const res = await fetch(`${this.base}${path}`, {
      method: init.method ?? 'GET',
      headers: { Authorization: `Token ${this.apiKey}`, 'Content-Type': 'application/json', Accept: 'application/json' },
      ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) throw new AppError(502, 'meeting_provider_error', `recall_${res.status}`);
    return (res.status === 204 ? undefined : await res.json()) as T;
  }

  async createMeeting(): Promise<{ meetingUrl: string | null; providerMeetingId: string | null }> {
    throw new ProviderNotConnectedError('meeting', 'create');
  }

  async joinMeeting(input: { meetingUrl: string; botName: string }): Promise<MeetingBot> {
    const bot = await this.req<{ id: string }>('/bot/', { method: 'POST', body: { meeting_url: input.meetingUrl, bot_name: input.botName.slice(0, 100) } });
    return { providerBotId: bot.id, status: 'joining' };
  }

  async leaveMeeting(id: string) {
    await this.req(`/bot/${encodeURIComponent(id)}/leave_call/`, { method: 'POST', body: {} });
  }

  async getMeetingStatus(id: string): Promise<MeetingBot['status']> {
    const bot = await this.req<{ status_changes?: Array<{ code: string }> }>(`/bot/${encodeURIComponent(id)}/`);
    const last = bot.status_changes?.at(-1)?.code ?? '';
    if (/in_call/.test(last)) return 'in_meeting';
    if (/done|call_ended/.test(last)) return 'left';
    if (/fatal|error/.test(last)) return 'failed';
    return 'joining';
  }

  async getParticipants(id: string): Promise<string[]> {
    const bot = await this.req<{ meeting_participants?: Array<{ name: string }> }>(`/bot/${encodeURIComponent(id)}/`);
    return (bot.meeting_participants ?? []).map((p) => p.name);
  }

  async getTranscript(id: string) {
    const rows = await this.req<Array<{ speaker: string | null; words: Array<{ text: string; start_time?: number }> }>>(`/bot/${encodeURIComponent(id)}/transcript/`);
    return rows.map((r) => ({ speaker: r.speaker, text: r.words.map((w) => w.text).join(' '), startMs: r.words[0]?.start_time !== undefined ? Math.round(r.words[0].start_time * 1000) : null }));
  }

  async sendAudio(id: string, mp3: Buffer) {
    await this.req(`/bot/${encodeURIComponent(id)}/output_audio/`, { method: 'POST', body: { kind: 'mp3', b64_data: mp3.toString('base64') } });
  }

  async receiveAudio(): Promise<never> {
    // Live audio is delivered via provider webhooks/streams, not polled.
    throw new ProviderNotConnectedError('meeting', 'audio_stream');
  }

  async sharePresentation(): Promise<void> {
    throw new ProviderNotConnectedError('meeting', 'share');
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
