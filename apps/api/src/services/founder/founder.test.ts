import JSZip from 'jszip';
import { PDFDocument } from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import { COLLECTIONS } from './collections.js';
import { buildPdf, buildXlsx } from './export.js';
import { independencePercent, runwayMonths } from './founder-service.js';

describe('founder portal calculations', () => {
  it('independence counts each capability once, weighted, and only owned + active', () => {
    const services = [
      { capability: 'db', ownership: 'external', status: 'active', weight: 3 },
      { capability: 'db', ownership: 'owned', status: 'planned', weight: 3 },
      { capability: 'ai', ownership: 'external', status: 'planned', weight: 4 },
      { capability: 'video', ownership: 'owned', status: 'active', weight: 1 },
    ];
    expect(independencePercent(services)).toBe(12.5);
    services[1]!.status = 'active';
    expect(independencePercent(services)).toBe(50);
    expect(independencePercent([])).toBe(0);
  });

  it('runway is null when not burning cash', () => {
    expect(runwayMonths(100000, 0)).toBeNull();
    expect(runwayMonths(100000, -500)).toBeNull();
    expect(runwayMonths(120000, 20000)).toBe(6);
  });

  it('collections reject unknown fields and enforce enums', () => {
    expect(COLLECTIONS.deals.schema.safeParse({ company_name: 'X', stage: 'won' }).success).toBe(true);
    expect(COLLECTIONS.deals.schema.safeParse({ company_name: 'X', stage: 'maybe' }).success).toBe(false);
    const parsed = COLLECTIONS.transactions.schema.parse({ kind: 'expense', amount: 10, occurred_on: '2026-11-16', source: 'deal_won', id: 'x' });
    expect(parsed).not.toHaveProperty('source');
    expect(parsed).not.toHaveProperty('id');
  });
});

describe('founder exports', () => {
  const sheet = { title: 'الصفقات', columns: [{ key: 'name', label: 'الشركة' }, { key: 'value', label: 'القيمة' }], rows: [{ name: 'شركة <اختبار> & 1', value: 11999 }, { name: 'B', value: null }] };

  it('builds a valid xlsx workbook', async () => {
    const buf = await buildXlsx([sheet], true);
    const zip = await JSZip.loadAsync(buf);
    const xml = await zip.file('xl/worksheets/sheet1.xml')!.async('string');
    expect(xml).toContain('rightToLeft="1"');
    expect(xml).toContain('شركة &lt;اختبار&gt; &amp; 1');
    expect(xml).toContain('<v>11999</v>');
    expect(await zip.file('xl/workbook.xml')!.async('string')).toContain('name="الصفقات"');
  });

  it('builds a PDF with Arabic text', async () => {
    const bytes = await buildPdf('تقرير', [sheet, { ...sheet, rows: Array.from({ length: 60 }, (_, i) => ({ name: `صف ${i}`, value: i })) }], true, 'سري');
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBeGreaterThan(1);
  });
});
