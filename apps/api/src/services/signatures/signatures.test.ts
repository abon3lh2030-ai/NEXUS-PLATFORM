import { PDFDocument } from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import { nextToNotify, signatureImageType } from './signature-service.js';
import { buildSignedPdf, loadPdf, riyadhTime, visualOrder } from './signed-pdf.js';

// 1×1 transparent PNG
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');

describe('signature images', () => {
  it('accepts PNG and JPEG by content, never by name', () => {
    expect(signatureImageType(PNG)).toBe('png');
    expect(signatureImageType(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0]))).toBe('jpg');
    expect(signatureImageType(Buffer.from('<svg onload=alert(1)>'))).toBeNull();
    expect(signatureImageType(Buffer.from('%PDF-1.7'))).toBeNull();
  });
});

describe('signing order', () => {
  const s = (id: string, status: string, sign_order: number) => ({ id, status: status as never, sign_order });

  it('in order: only the next step is asked, and only once the current step is done', () => {
    expect(nextToNotify([s('a', 'waiting', 1), s('b', 'waiting', 2)], true)).toEqual(['a']);
    expect(nextToNotify([s('a', 'pending', 1), s('b', 'waiting', 2)], true)).toEqual([]);
    expect(nextToNotify([s('a', 'signed', 1), s('b', 'waiting', 2), s('c', 'waiting', 2)], true)).toEqual(['b', 'c']);
  });

  it('all at once: everyone is asked together', () => {
    expect(nextToNotify([s('a', 'waiting', 1), s('b', 'waiting', 1)], false)).toEqual(['a', 'b']);
  });

  it('a decline stops the request', () => {
    expect(nextToNotify([s('a', 'declined', 1), s('b', 'waiting', 2)], true)).toEqual([]);
  });
});

describe('signed PDF', () => {
  it('keeps the original pages, adds a signature page, and stays a valid PDF', async () => {
    const src = await PDFDocument.create();
    src.addPage();
    src.addPage();
    const out = await buildSignedPdf(
      await src.save(),
      { orgName: 'مؤسسة الاختبار', title: 'عقد توظيف', documentName: 'contract.pdf', verificationCode: 'NX-ABCD-EFGH', sha256: 'f'.repeat(64), completedAt: new Date('2026-11-11T17:00:00Z') },
      [
        { name: 'سارة القحطاني', role: 'signer', actedAt: new Date(), ip: '10.0.0.1', method: 'drawn', image: { bytes: PNG, type: 'png' } },
        { name: 'عمر', role: 'approver', actedAt: new Date(), ip: null, method: null, image: null },
      ],
    );
    const doc = await PDFDocument.load(out);
    expect(doc.getPageCount()).toBe(3);
  });

  it('rejects files that are not PDFs', async () => {
    await expect(loadPdf(Buffer.from('not a pdf'))).rejects.toMatchObject({ code: 'invalid_pdf' });
  });

  it('keeps numbers and Latin words readable inside Arabic lines', () => {
    expect(visualOrder('رمز NX-12')).toBe('رمز 21-XN');
    expect(visualOrder('Signed by NEXUS')).toBe('Signed by NEXUS');
    expect(riyadhTime(new Date('2026-11-11T17:00:00Z'))).toBe('2026-11-11 20:00');
  });
});
