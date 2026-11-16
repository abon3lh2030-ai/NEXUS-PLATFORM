import { createSign } from 'node:crypto';
import { connect, type ClientHttp2Session } from 'node:http2';
import type { FastifyBaseLogger } from 'fastify';

/**
 * Apple Push Notification service (APNs) over HTTP/2 with token-based auth (.p8 key).
 * Sends straight to Apple — no third-party push service.
 */
export interface ApnsConfig {
  keyId: string;
  teamId: string;
  /** Contents of the AuthKey_XXXX.p8 file. */
  privateKey: string;
  bundleId: string;
}

export interface ApnsMessage {
  title: string;
  body: string;
  category?: string;
  data?: Record<string, unknown>;
}

export type ApnsResult = 'sent' | 'invalid_token' | 'failed';

const HOSTS = { production: 'https://api.push.apple.com', development: 'https://api.sandbox.push.apple.com' } as const;
export type ApnsEnvironment = keyof typeof HOSTS;
const TOKEN_TTL_MS = 50 * 60_000; // Apple accepts a provider token for up to an hour.

const b64url = (b: Buffer | string) => Buffer.from(b).toString('base64url');

/** The JSON body APNs receives (exported for tests). */
export function apnsPayload(msg: ApnsMessage): string {
  return JSON.stringify({
    aps: { alert: { title: msg.title, body: msg.body }, sound: 'default', ...(msg.category ? { category: msg.category } : {}) },
    ...(msg.data ?? {}),
  });
}

export class ApnsClient {
  private jwt: { value: string; at: number } | null = null;
  private sessions = new Map<ApnsEnvironment, ClientHttp2Session>();

  constructor(
    private readonly cfg: ApnsConfig,
    private readonly log: FastifyBaseLogger,
  ) {}

  /** ES256 provider token, reused for 50 minutes. */
  providerToken(): string {
    if (this.jwt && Date.now() - this.jwt.at < TOKEN_TTL_MS) return this.jwt.value;
    const header = b64url(JSON.stringify({ alg: 'ES256', kid: this.cfg.keyId }));
    const claims = b64url(JSON.stringify({ iss: this.cfg.teamId, iat: Math.floor(Date.now() / 1000) }));
    const signer = createSign('SHA256');
    signer.update(`${header}.${claims}`);
    const signature = signer.sign({ key: this.cfg.privateKey.replace(/\\n/g, '\n'), dsaEncoding: 'ieee-p1363' });
    this.jwt = { value: `${header}.${claims}.${b64url(signature)}`, at: Date.now() };
    return this.jwt.value;
  }

  private session(env: ApnsEnvironment): ClientHttp2Session {
    const existing = this.sessions.get(env);
    if (existing && !existing.closed && !existing.destroyed) return existing;
    const s = connect(HOSTS[env]);
    s.on('error', (err) => this.log.warn({ err: err.message }, 'apns_session_error'));
    this.sessions.set(env, s);
    return s;
  }

  send(deviceToken: string, env: ApnsEnvironment, msg: ApnsMessage): Promise<ApnsResult> {
    return new Promise((resolve) => {
      let status = 0;
      let body = '';
      const req = this.session(env).request({
        ':method': 'POST',
        ':path': `/3/device/${deviceToken}`,
        authorization: `bearer ${this.providerToken()}`,
        'apns-topic': this.cfg.bundleId,
        'apns-push-type': 'alert',
        'apns-priority': '10',
        'content-type': 'application/json',
      });
      req.setTimeout(10_000, () => {
        req.close();
        resolve('failed');
      });
      req.on('response', (h) => (status = Number(h[':status'])));
      req.on('data', (c: Buffer) => (body += c.toString()));
      req.on('end', () => {
        if (status === 200) return resolve('sent');
        let reason = '';
        try {
          reason = (JSON.parse(body) as { reason?: string }).reason ?? '';
        } catch {
          /* empty body */
        }
        if (status === 410 || ['BadDeviceToken', 'Unregistered', 'DeviceTokenNotForTopic'].includes(reason)) return resolve('invalid_token');
        this.log.warn({ status, reason }, 'apns_send_failed');
        resolve('failed');
      });
      req.on('error', () => resolve('failed'));
      req.end(apnsPayload(msg));
    });
  }

  close() {
    for (const s of this.sessions.values()) s.close();
  }
}
