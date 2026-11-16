import { createVerify, generateKeyPairSync } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { ApnsClient, apnsPayload } from './apns.js';
import { isSensitiveApproval, pushTargets } from './push-service.js';

const log = { warn: () => undefined } as never;

describe('push targets', () => {
  it('turns a website link into the ids the app needs', () => {
    const id = '11111111-2222-4333-8444-555555555555';
    expect(pushTargets(`/app/approvals?id=${id}`)).toEqual({ approval_id: id });
    expect(pushTargets(`/app/tasks/${id}`)).toEqual({ task_id: id });
    expect(pushTargets(`/app/meetings/${id}`)).toEqual({ meeting_id: id });
    expect(pushTargets(`/app/signatures/${id}`)).toEqual({ signature_id: id });
    expect(pushTargets('/app/approvals')).toEqual({});
    expect(pushTargets(null)).toEqual({});
  });

  it('sensitive approvals never get the quick Approve button', () => {
    expect(isSensitiveApproval({ risk: 'low', approval_type: 'ai_output' })).toBe(false);
    expect(isSensitiveApproval({ risk: 'high', approval_type: 'ai_output' })).toBe(true);
    expect(isSensitiveApproval({ risk: 'low', approval_type: 'email_send' })).toBe(true);
    expect(isSensitiveApproval({ risk: 'medium', approval_type: 'meeting_action' })).toBe(true);
  });
});

describe('APNs', () => {
  it('builds the alert payload with the category and the app data', () => {
    const p = JSON.parse(apnsPayload({ title: 'طلب اعتماد', body: 'وليد', category: 'APPROVAL_SIMPLE', data: { approval_id: 'x' } }));
    expect(p).toEqual({ aps: { alert: { title: 'طلب اعتماد', body: 'وليد' }, sound: 'default', category: 'APPROVAL_SIMPLE' }, approval_id: 'x' });
  });

  it('signs a valid ES256 provider token with the .p8 key', () => {
    const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
    const pem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
    const client = new ApnsClient({ keyId: 'ABC123DEFG', teamId: 'TEAM123456', privateKey: pem, bundleId: 'com.nexusarabia.app' }, log);
    const token = client.providerToken();
    const [h, c, s] = token.split('.');
    expect(JSON.parse(Buffer.from(h!, 'base64url').toString())).toEqual({ alg: 'ES256', kid: 'ABC123DEFG' });
    expect(JSON.parse(Buffer.from(c!, 'base64url').toString())).toMatchObject({ iss: 'TEAM123456' });
    const ok = createVerify('SHA256').update(`${h}.${c}`).verify({ key: publicKey, dsaEncoding: 'ieee-p1363' }, Buffer.from(s!, 'base64url'));
    expect(ok).toBe(true);
    expect(client.providerToken()).toBe(token); // reused, not re-signed every time
  });
});
