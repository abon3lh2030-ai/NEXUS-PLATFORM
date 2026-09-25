import { describe, expect, it } from 'vitest';
import {
  canAssignRole,
  companyApplicationSchema,
  computeRenewalWindow,
  isSubscriptionActive,
  isValidSaudiCommercialRegistration,
  normalizeCommercialRegistration,
  resolvePermissions,
  sanitizeFileName,
  verifyFileContent,
} from './index.js';

const bytes = (...b: number[]) => new Uint8Array(b);
const PDF = bytes(0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37);
const PNG = bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);
const ZIP = bytes(0x50, 0x4b, 0x03, 0x04, 0, 0);
const EXE = bytes(0x4d, 0x5a, 0x90, 0x00);

describe('file content validation (server-side, not extension-only)', () => {
  it('accepts files whose bytes match the extension', () => {
    expect(verifyFileContent('report.pdf', PDF, { allowArchives: false }).ok).toBe(true);
    expect(verifyFileContent('logo.png', PNG, { allowArchives: false }).ok).toBe(true);
    expect(verifyFileContent('plan.docx', ZIP, { allowArchives: false }).ok).toBe(true);
    expect(verifyFileContent('notes.md', new TextEncoder().encode('# عنوان\nمرحبا'), { allowArchives: false }).ok).toBe(true);
  });
  it('rejects renamed executables and mismatched content', () => {
    expect(verifyFileContent('invoice.pdf', EXE, { allowArchives: false })).toMatchObject({ ok: false, reason: 'content_mismatch' });
    expect(verifyFileContent('image.png', PDF, { allowArchives: false })).toMatchObject({ ok: false, reason: 'content_mismatch' });
    expect(verifyFileContent('data.csv', bytes(0, 1, 2, 3, 0), { allowArchives: false })).toMatchObject({ ok: false });
  });
  it('blocks dangerous extensions outright', () => {
    for (const name of ['setup.exe', 'run.sh', 'page.html', 'icon.svg', 'macro.docm', 'x.js']) {
      expect(verifyFileContent(name, PDF, { allowArchives: true })).toMatchObject({ ok: false, reason: 'blocked_extension' });
    }
  });
  it('archives only when the policy allows', () => {
    expect(verifyFileContent('a.zip', ZIP, { allowArchives: false })).toMatchObject({ ok: false, reason: 'archives_disabled' });
    expect(verifyFileContent('a.zip', ZIP, { allowArchives: true }).ok).toBe(true);
  });
});

describe('file name sanitization', () => {
  it('strips path traversal and control characters', () => {
    expect(sanitizeFileName('../../etc/passwd')).toBe('passwd');
    expect(sanitizeFileName('..\\..\\windows\\system32\\evil.pdf')).toBe('evil.pdf');
    expect(sanitizeFileName('a\u0000b<>:"|?*.pdf')).toBe('ab.pdf');
    expect(sanitizeFileName('...')).toBe('file');
    expect(sanitizeFileName('تقرير السوق 2027.pdf')).toBe('تقرير السوق 2027.pdf');
  });
  it('limits length but keeps the extension', () => {
    const long = `${'a'.repeat(400)}.pdf`;
    const out = sanitizeFileName(long);
    expect(out.length).toBeLessThanOrEqual(180);
    expect(out.endsWith('.pdf')).toBe(true);
  });
});

describe('permissions', () => {
  it('only the owner can close the company or manage billing', () => {
    expect(resolvePermissions('owner').has('org.close')).toBe(true);
    expect(resolvePermissions('admin').has('org.close')).toBe(false);
    expect(resolvePermissions('admin').has('billing.manage')).toBe(false);
  });
  it('owner-locked permissions cannot be granted by overrides', () => {
    const p = resolvePermissions('admin', [{ role: 'admin', permission: 'org.close', allowed: true }]);
    expect(p.has('org.close')).toBe(false);
  });
  it('overrides adjust non-owner roles', () => {
    expect(resolvePermissions('member', [{ role: 'member', permission: 'files.shared.upload', allowed: false }]).has('files.shared.upload')).toBe(false);
    expect(resolvePermissions('viewer', [{ role: 'viewer', permission: 'files.shared.upload', allowed: true }]).has('files.shared.upload')).toBe(true);
  });
  it('viewers cannot upload, members cannot manage all shared files', () => {
    expect(resolvePermissions('viewer').has('files.shared.upload')).toBe(false);
    expect(resolvePermissions('member').has('files.shared.manage_all')).toBe(false);
    expect(resolvePermissions('member').has('files.private.use')).toBe(false);
  });
  it('role assignment cannot escalate', () => {
    expect(canAssignRole('admin', 'admin')).toBe(false);
    expect(canAssignRole('admin', 'manager')).toBe(true);
    expect(canAssignRole('owner', 'owner')).toBe(false);
    expect(canAssignRole('manager', 'admin')).toBe(false);
  });
});

describe('Saudi company rules', () => {
  it('validates 10-digit CR numbers incl. Arabic digits', () => {
    expect(isValidSaudiCommercialRegistration('7055047331')).toBe(true);
    expect(isValidSaudiCommercialRegistration(normalizeCommercialRegistration('١٠١٠١٢٣٤٥٦'))).toBe(true);
    expect(isValidSaudiCommercialRegistration('12345')).toBe(false);
    expect(isValidSaudiCommercialRegistration('9010123456')).toBe(false);
  });
  it('requires official company contact data (valid Saudi phone)', () => {
    const base = { company_name: 'شركة', commercial_registration: '1010123456', company_email: 'info@company.sa', company_phone: '+966 55 123 4567', applicant_role: 'CEO', industry: 'technology', company_size: '11-50', confirm_saudi_registered: true };
    expect(companyApplicationSchema.safeParse(base).success).toBe(true);
    expect(companyApplicationSchema.safeParse({ ...base, company_phone: '12345' }).success).toBe(false);
    const { company_email: _e, ...noEmail } = base;
    expect(companyApplicationSchema.safeParse(noEmail).success).toBe(false);
  });
  it('requires the Saudi registration confirmation', () => {
    const base = {
      company_name: 'شركة',
      commercial_registration: '1010123456',
      company_email: 'info@company.sa',
      company_phone: '0112345678',
      website: '',
      applicant_role: 'CEO',
      industry: 'technology',
      company_size: '11-50',
    };
    expect(companyApplicationSchema.safeParse({ ...base, confirm_saudi_registered: false }).success).toBe(false);
    expect(companyApplicationSchema.safeParse({ ...base, confirm_saudi_registered: true }).success).toBe(true);
  });
});

describe('annual subscription', () => {
  it('renewal before expiry keeps remaining days', () => {
    const now = new Date('2027-01-01T00:00:00Z');
    const end = new Date('2027-03-01T00:00:00Z');
    expect(computeRenewalWindow(now, end).endsAt.toISOString()).toBe('2028-03-01T00:00:00.000Z');
  });
  it('renewal after expiry starts from now', () => {
    const now = new Date('2027-05-01T00:00:00Z');
    expect(computeRenewalWindow(now, new Date('2027-03-01T00:00:00Z')).endsAt.toISOString()).toBe('2028-05-01T00:00:00.000Z');
  });
  it('access is locked the instant ends_at passes', () => {
    const now = new Date('2027-03-01T00:00:01Z');
    expect(isSubscriptionActive({ status: 'active', ends_at: '2027-03-01T00:00:00Z' }, now)).toBe(false);
    expect(isSubscriptionActive({ status: 'active', ends_at: '2027-03-02T00:00:00Z' }, now)).toBe(true);
    expect(isSubscriptionActive({ status: 'expired', ends_at: '2099-01-01T00:00:00Z' }, now)).toBe(false);
  });
});
