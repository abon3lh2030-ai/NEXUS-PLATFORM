// Dev helper: renders a sample Arabic deck to inspect PPTX output. Usage: npx tsx scripts/sample-deck.mts out.pptx
import { writeFileSync } from 'node:fs';
import { deckSpecSchema } from '@nexus/shared';
import { renderPptx } from '../src/services/presentations/pptx-renderer.ts';
const spec = deckSpecSchema.parse({ title: 'خطة إطلاق المنتج الجديد', language: 'ar', slides: [
  { kind: 'cover', title: 'خطة إطلاق المنتج الجديد', subtitle: 'السوق السعودي — 2027', presenter: 'أطلس — وكيل الرئيس التنفيذي (ذكاء اصطناعي)' },
  { kind: 'agenda', title: 'جدول الأعمال', items: ['الملخص التنفيذي', 'فرصة السوق', 'المنافسون', 'المؤشرات', 'خارطة الطريق', 'المخاطر', 'الخطوات التالية'] },
  { kind: 'bullets', role: 'executive_summary', title: 'الملخص التنفيذي', points: ['طلب متزايد على الحلول الرقمية في قطاع التجزئة', 'فرصة للوصول إلى 1,200 عميل خلال السنة الأولى', 'إطلاق تدريجي يبدأ من الرياض ثم جدة والدمام'], note: 'التوصية: البدء بتجربة محدودة لمدة 8 أسابيع قبل الإطلاق الكامل.' },
  { kind: 'chart', title: 'حجم السوق المتوقع (مليون ر.س)', chart_type: 'bar', categories: ['2025', '2026', '2027', '2028'], series: [{ name: 'حجم السوق', values: [120, 150, 195, 240] }], caption: 'تقديرات أولية تحتاج تحقق من مصادر السوق' },
  { kind: 'table', title: 'مقارنة المنافسين', headers: ['المنافس', 'السعر', 'نقطة القوة', 'نقطة الضعف'], rows: [['المنافس أ', 'مرتفع', 'علامة معروفة', 'دعم محدود'], ['المنافس ب', 'متوسط', 'تكاملات', 'واجهة معقدة']], caption: '' },
  { kind: 'kpis', title: 'مؤشرات النجاح', metrics: [{ label: 'العملاء', value: '1,200', detail: 'خلال 12 شهرًا' }, { label: 'الاحتفاظ', value: '85%', detail: 'بعد 6 أشهر' }, { label: 'الإيراد', value: '3.4M', detail: 'ريال سعودي' }] },
  { kind: 'timeline', title: 'خارطة الطريق', milestones: [{ date: 'الربع 1', title: 'تجربة', detail: 'عملاء مختارون' }, { date: 'الربع 2', title: 'إطلاق الرياض', detail: '' }, { date: 'الربع 3', title: 'جدة والدمام', detail: '' }, { date: 'الربع 4', title: 'التوسع', detail: 'شراكات' }] },
  { kind: 'bullets', role: 'risks', title: 'المخاطر', points: ['تأخر التكاملات', 'منافسة سعرية'], note: '' },
  { kind: 'closing', title: 'أسئلة ونقاش', subtitle: 'شكرًا لكم', contact: '' },
] });
const buf = await renderPptx(spec, { companyName: 'شركة نموذجية', primaryColor: '312E81', accentColor: '0EA5E9' }, { author: 'أطلس' });
writeFileSync(process.argv[2] ?? 'sample-deck.pptx', buf);
console.log('bytes', buf.length);
