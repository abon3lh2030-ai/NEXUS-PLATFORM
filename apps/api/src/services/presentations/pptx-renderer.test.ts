import { deckSpecSchema, type DeckSpec } from '@nexus/shared';
import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import { renderPptx } from './pptx-renderer.js';

// 1x1 transparent PNG
const LOGO = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

const spec: DeckSpec = deckSpecSchema.parse({
  title: 'خطة إطلاق المنتج',
  language: 'ar',
  slides: [
    { kind: 'cover', title: 'خطة إطلاق المنتج', subtitle: 'السوق السعودي 2027', presenter: 'أطلس' },
    { kind: 'agenda', title: 'جدول الأعمال', items: ['الملخص', 'السوق', 'المنافسون', 'الخطة', 'المخاطر', 'الخطوات التالية'] },
    { kind: 'bullets', role: 'executive_summary', title: 'الملخص التنفيذي', points: ['نمو متوقع 20%', 'ثلاث شرائح عملاء'], note: 'التوصية: إطلاق تدريجي' },
    { kind: 'two_column', title: 'الفرص والتحديات', left_title: 'الفرص', left_points: ['طلب متزايد'], right_title: 'التحديات', right_points: ['منافسة'] },
    { kind: 'kpis', title: 'المؤشرات', metrics: [{ label: 'العملاء', value: '1,200', detail: 'السنة الأولى' }, { label: 'الإيراد', value: '3.4M', detail: 'ر.س' }] },
    { kind: 'chart', title: 'حجم السوق', chart_type: 'bar', categories: ['2025', '2026', '2027'], series: [{ name: 'السوق', values: [10, 14, 19] }], caption: 'مليون ر.س' },
    { kind: 'chart', title: 'الحصة', chart_type: 'pie', categories: ['نحن', 'أ', 'ب'], series: [{ name: 'الحصة', values: [20, 50, 30] }], caption: '' },
    { kind: 'table', title: 'المنافسون', headers: ['الشركة', 'السعر', 'الميزة'], rows: [['أ', '100', 'سعر'], ['ب', '150', 'جودة']], caption: '' },
    { kind: 'timeline', title: 'خارطة الطريق', milestones: [{ date: 'Q1', title: 'تجريبي', detail: '' }, { date: 'Q2', title: 'إطلاق', detail: 'الرياض' }] },
    { kind: 'quote', title: 'رؤية', quote: 'نبني المستقبل', attribution: 'المدير التنفيذي' },
    { kind: 'closing', title: 'أسئلة ونقاش', subtitle: 'شكرًا لكم', contact: 'info@example.sa' },
  ],
});

describe('PPTX renderer', () => {
  it('produces a valid Office Open XML deck with one slide per spec slide, RTL and native charts', async () => {
    const buf = await renderPptx(spec, { companyName: 'شركة الاختبار', primaryColor: '4338CA', accentColor: '0EA5E9', logoPngBase64: LOGO }, { author: 'أطلس' });
    expect(buf.subarray(0, 2).toString()).toBe('PK'); // ZIP container
    const zip = await JSZip.loadAsync(buf);
    expect(zip.file('ppt/presentation.xml')).toBeTruthy();
    expect(zip.file('[Content_Types].xml')).toBeTruthy();
    const slides = Object.keys(zip.files).filter((f) => /^ppt\/slides\/slide\d+\.xml$/.test(f));
    expect(slides).toHaveLength(spec.slides.length);
    const charts = Object.keys(zip.files).filter((f) => /^ppt\/charts\/chart\d+\.xml$/.test(f));
    expect(charts.length).toBe(2);
    const slide3 = await zip.file('ppt/slides/slide3.xml')!.async('string');
    expect(slide3).toContain('rtl="1"');
    expect(slide3).toContain('الملخص التنفيذي');
    const media = Object.keys(zip.files).filter((f) => f.startsWith('ppt/media/'));
    expect(media.length).toBeGreaterThan(0); // company logo embedded
  });

  it('renders English LTR decks without RTL paragraphs', async () => {
    const en = deckSpecSchema.parse({ title: 'Launch', language: 'en', slides: [{ kind: 'cover', title: 'Launch', subtitle: 'KSA', presenter: 'Atlas' }, { kind: 'closing', title: 'Q&A', subtitle: '', contact: '' }] });
    const zip = await JSZip.loadAsync(await renderPptx(en, { companyName: 'Co', primaryColor: '111111', accentColor: '222222' }, { author: 'Atlas' }));
    const s1 = await zip.file('ppt/slides/slide1.xml')!.async('string');
    expect(s1).not.toContain('rtl="1"');
  });
});
