import pptxgenModule from 'pptxgenjs';

// pptxgenjs ships CJS-style typings for an ESM default export; normalize both shapes.
type PptxCtor = new () => import('pptxgenjs').default;
const PptxGenJS: PptxCtor = ((pptxgenModule as unknown as { default?: PptxCtor }).default ?? (pptxgenModule as unknown as PptxCtor));
import { normalizeChart, type DeckBranding, type DeckSpec, type Slide } from '@nexus/shared';

/**
 * Renders a DeckSpec into a real .pptx (Office Open XML) using pptxgenjs — native text boxes,
 * native charts and native tables, so the file is fully editable in PowerPoint/Keynote/Google Slides.
 */

const W = 13.333; // LAYOUT_WIDE inches
const H = 7.5;
const M = 0.6; // margin

type Pptx = InstanceType<PptxCtor>;
type PSlide = ReturnType<Pptx['addSlide']>;

interface Ctx {
  pptx: Pptx;
  rtl: boolean;
  brand: DeckBranding;
  font: string;
  labels: { agenda: string; qa: string; page: string };
}

const INK = '1F2433';
const MUTED = '5B6275';
const SOFT = 'F3F4F8';

function align(ctx: Ctx): 'right' | 'left' {
  return ctx.rtl ? 'right' : 'left';
}

function text(ctx: Ctx, extra: Record<string, unknown> = {}) {
  return { fontFace: ctx.font, color: INK, rtlMode: ctx.rtl, lang: ctx.rtl ? 'ar-SA' : 'en-US', align: align(ctx), ...extra };
}

/** Common chrome: brand bar, logo, footer with company name and page number. */
function chrome(ctx: Ctx, slide: PSlide, n: number, title?: string) {
  slide.background = { color: 'FFFFFF' };
  slide.addShape(ctx.pptx.ShapeType.rect, { x: 0, y: 0, w: W, h: 0.12, fill: { color: ctx.brand.primaryColor }, line: { color: ctx.brand.primaryColor } });
  if (ctx.brand.logoPngBase64) {
    slide.addImage({ data: `image/png;base64,${ctx.brand.logoPngBase64}`, x: ctx.rtl ? M : W - M - 0.9, y: 0.3, w: 0.9, h: 0.6, sizing: { type: 'contain', w: 0.9, h: 0.6 } });
  }
  if (title) {
    slide.addText(title, text(ctx, { x: ctx.rtl ? M + 1.1 : M, y: 0.3, w: W - 2 * M - 1.1, h: 0.8, fontSize: 28, bold: true, color: INK, valign: 'middle' }));
    slide.addShape(ctx.pptx.ShapeType.rect, { x: ctx.rtl ? W - M - 1.2 : M, y: 1.12, w: 1.2, h: 0.06, fill: { color: ctx.brand.accentColor }, line: { color: ctx.brand.accentColor } });
  }
  slide.addText(ctx.brand.companyName, text(ctx, { x: M, y: H - 0.5, w: W / 2, h: 0.3, fontSize: 10, color: MUTED, align: ctx.rtl ? 'right' : 'left', ...(ctx.rtl ? { x: W / 2 - M } : {}) }));
  slide.addText(`${n}`, { fontFace: ctx.font, x: ctx.rtl ? M : W - M - 0.6, y: H - 0.5, w: 0.6, h: 0.3, fontSize: 10, color: MUTED, align: ctx.rtl ? 'left' : 'right' });
}

const ROLE_ACCENT: Record<string, string> = {
  risks: 'DC2626',
  problem: 'EA580C',
  opportunity: '059669',
  recommendations: '4338CA',
  next_steps: '0EA5E9',
};

function renderSlide(ctx: Ctx, s: Slide, n: number) {
  const { pptx } = ctx;
  const slide = pptx.addSlide();
  const body = { x: M, y: 1.45, w: W - 2 * M, h: H - 2.2 };

  switch (s.kind) {
    case 'cover': {
      slide.background = { color: ctx.brand.primaryColor };
      slide.addShape(pptx.ShapeType.rect, { x: 0, y: H - 0.35, w: W, h: 0.35, fill: { color: ctx.brand.accentColor }, line: { color: ctx.brand.accentColor } });
      if (ctx.brand.logoPngBase64) {
        slide.addShape(pptx.ShapeType.roundRect, { x: ctx.rtl ? W - M - 1.6 : M, y: 0.6, w: 1.6, h: 1.0, fill: { color: 'FFFFFF' }, line: { color: 'FFFFFF' }, rectRadius: 0.12 });
        slide.addImage({ data: `image/png;base64,${ctx.brand.logoPngBase64}`, x: (ctx.rtl ? W - M - 1.6 : M) + 0.1, y: 0.68, w: 1.4, h: 0.84, sizing: { type: 'contain', w: 1.4, h: 0.84 } });
      }
      slide.addText(s.title, text(ctx, { x: M, y: 2.3, w: W - 2 * M, h: 1.6, fontSize: 44, bold: true, color: 'FFFFFF', valign: 'bottom' }));
      slide.addText(s.subtitle, text(ctx, { x: M, y: 4.0, w: W - 2 * M, h: 0.9, fontSize: 20, color: 'E6E8F5', valign: 'top' }));
      slide.addText([s.presenter, ctx.brand.companyName].filter(Boolean).join(' · '), text(ctx, { x: M, y: 5.6, w: W - 2 * M, h: 0.5, fontSize: 14, color: 'E6E8F5' }));
      return;
    }
    case 'agenda': {
      chrome(ctx, slide, n, s.title || ctx.labels.agenda);
      const items = s.items.slice(0, 10);
      const colW = items.length > 5 ? (body.w - 0.4) / 2 : body.w;
      items.forEach((it, i) => {
        const col = items.length > 5 ? Math.floor(i / 5) : 0;
        const row = items.length > 5 ? i % 5 : i;
        const x = ctx.rtl ? body.x + body.w - colW - col * (colW + 0.4) : body.x + col * (colW + 0.4);
        const y = body.y + 0.2 + row * 0.95;
        slide.addShape(pptx.ShapeType.ellipse, { x: ctx.rtl ? x + colW - 0.6 : x, y, w: 0.6, h: 0.6, fill: { color: ctx.brand.primaryColor }, line: { color: ctx.brand.primaryColor } });
        slide.addText(String(i + 1), { fontFace: ctx.font, x: ctx.rtl ? x + colW - 0.6 : x, y, w: 0.6, h: 0.6, fontSize: 16, bold: true, color: 'FFFFFF', align: 'center', valign: 'middle' });
        slide.addText(it, text(ctx, { x: ctx.rtl ? x : x + 0.8, y, w: colW - 0.8, h: 0.6, fontSize: 18, valign: 'middle' }));
      });
      return;
    }
    case 'bullets': {
      chrome(ctx, slide, n, s.title);
      const accent = ROLE_ACCENT[s.role] ?? ctx.brand.primaryColor;
      const hasNote = Boolean(s.note);
      const listW = hasNote ? body.w * 0.64 : body.w;
      slide.addText(
        s.points.map((p) => ({ text: p, options: { bullet: { indent: 18 }, paraSpaceAfter: 10 } })),
        text(ctx, { x: ctx.rtl ? body.x + body.w - listW : body.x, y: body.y, w: listW, h: body.h, fontSize: 18, valign: 'top' }),
      );
      if (hasNote) {
        const nx = ctx.rtl ? body.x : body.x + listW + 0.3;
        const nw = body.w - listW - 0.3;
        slide.addShape(pptx.ShapeType.roundRect, { x: nx, y: body.y, w: nw, h: 3.2, fill: { color: SOFT }, line: { color: accent, width: 1.5 }, rectRadius: 0.1 });
        slide.addText(s.note, text(ctx, { x: nx + 0.2, y: body.y + 0.2, w: nw - 0.4, h: 2.8, fontSize: 15, color: INK, valign: 'top', italic: true }));
      }
      return;
    }
    case 'two_column': {
      chrome(ctx, slide, n, s.title);
      const cw = (body.w - 0.4) / 2;
      const cols = [
        { t: s.left_title, p: s.left_points, c: ctx.brand.primaryColor },
        { t: s.right_title, p: s.right_points, c: ctx.brand.accentColor },
      ];
      cols.forEach((col, i) => {
        const x = ctx.rtl ? body.x + body.w - cw - i * (cw + 0.4) : body.x + i * (cw + 0.4);
        slide.addShape(pptx.ShapeType.roundRect, { x, y: body.y, w: cw, h: body.h - 0.1, fill: { color: SOFT }, line: { color: SOFT }, rectRadius: 0.1 });
        slide.addShape(pptx.ShapeType.rect, { x, y: body.y, w: cw, h: 0.08, fill: { color: col.c }, line: { color: col.c } });
        slide.addText(col.t, text(ctx, { x: x + 0.25, y: body.y + 0.2, w: cw - 0.5, h: 0.6, fontSize: 20, bold: true, color: col.c }));
        slide.addText(col.p.map((p) => ({ text: p, options: { bullet: true, paraSpaceAfter: 8 } })), text(ctx, { x: x + 0.25, y: body.y + 0.9, w: cw - 0.5, h: body.h - 1.1, fontSize: 16, valign: 'top' }));
      });
      return;
    }
    case 'kpis': {
      chrome(ctx, slide, n, s.title);
      const count = s.metrics.length;
      const perRow = count <= 3 ? count : 3;
      const rows = Math.ceil(count / perRow);
      const cw = (body.w - (perRow - 1) * 0.3) / perRow;
      const ch = rows === 1 ? 2.8 : 2.1;
      s.metrics.forEach((m, i) => {
        const r = Math.floor(i / perRow);
        const c = i % perRow;
        const x = ctx.rtl ? body.x + body.w - cw - c * (cw + 0.3) : body.x + c * (cw + 0.3);
        const y = body.y + 0.2 + r * (ch + 0.3);
        slide.addShape(pptx.ShapeType.roundRect, { x, y, w: cw, h: ch, fill: { color: SOFT }, line: { color: 'E2E4EC' }, rectRadius: 0.12 });
        slide.addText(m.value, { fontFace: ctx.font, x: x + 0.2, y: y + 0.25, w: cw - 0.4, h: 1.0, fontSize: 40, bold: true, color: ctx.brand.primaryColor, align: 'center' });
        slide.addText(m.label, text(ctx, { x: x + 0.2, y: y + 1.25, w: cw - 0.4, h: 0.5, fontSize: 16, bold: true, align: 'center' }));
        if (m.detail) slide.addText(m.detail, text(ctx, { x: x + 0.2, y: y + 1.7, w: cw - 0.4, h: ch - 1.8, fontSize: 12, color: MUTED, align: 'center', valign: 'top' }));
      });
      return;
    }
    case 'chart': {
      chrome(ctx, slide, n, s.title);
      const c = normalizeChart(s);
      const data = c.series.map((ser) => ({ name: ser.name, labels: c.categories, values: ser.values }));
      const type = s.chart_type === 'pie' ? pptx.ChartType.pie : s.chart_type === 'line' ? pptx.ChartType.line : pptx.ChartType.bar;
      const palette = [ctx.brand.primaryColor, ctx.brand.accentColor, '10B981', 'F59E0B', 'EF4444', '8B5CF6'];
      slide.addChart(type, s.chart_type === 'pie' ? data.slice(0, 1) : data, {
        x: body.x, y: body.y, w: body.w, h: body.h - (s.caption ? 0.6 : 0),
        chartColors: palette, showLegend: c.series.length > 1 || s.chart_type === 'pie', legendPos: 'b', legendFontFace: ctx.font,
        catAxisLabelFontFace: ctx.font, valAxisLabelFontFace: ctx.font, catAxisLabelFontSize: 12, valAxisLabelFontSize: 11,
        dataLabelFontSize: 11, showValue: s.chart_type !== 'line', showPercent: s.chart_type === 'pie',
      });
      if (s.caption) slide.addText(s.caption, text(ctx, { x: body.x, y: body.y + body.h - 0.5, w: body.w, h: 0.5, fontSize: 13, color: MUTED }));
      return;
    }
    case 'table': {
      chrome(ctx, slide, n, s.title);
      const order = <T,>(row: T[]) => (ctx.rtl ? [...row].reverse() : row);
      const header = order(s.headers).map((h) => ({ text: h, options: { bold: true, color: 'FFFFFF', fill: { color: ctx.brand.primaryColor } } }));
      const rows = s.rows.map((r, i) => order(s.headers.map((_, j) => r[j] ?? '')).map((cell) => ({ text: cell, options: { fill: { color: i % 2 ? 'FFFFFF' : SOFT } } })));
      slide.addTable([header, ...rows], { x: body.x, y: body.y, w: body.w, fontFace: ctx.font, fontSize: 13, color: INK, border: { type: 'solid', color: 'E2E4EC', pt: 0.75 }, align: align(ctx), valign: 'middle', rowH: 0.45, autoPage: false });
      if (s.caption) slide.addText(s.caption, text(ctx, { x: body.x, y: H - 1.2, w: body.w, h: 0.4, fontSize: 12, color: MUTED }));
      return;
    }
    case 'timeline': {
      chrome(ctx, slide, n, s.title);
      const count = s.milestones.length;
      const lineY = body.y + 1.6;
      slide.addShape(pptx.ShapeType.line, { x: body.x, y: lineY, w: body.w, h: 0, line: { color: ctx.brand.primaryColor, width: 3 } });
      const step = body.w / count;
      s.milestones.forEach((m, i) => {
        const idx = ctx.rtl ? count - 1 - i : i;
        const cx = body.x + step * idx + step / 2;
        slide.addShape(pptx.ShapeType.ellipse, { x: cx - 0.18, y: lineY - 0.18, w: 0.36, h: 0.36, fill: { color: i === 0 ? ctx.brand.accentColor : ctx.brand.primaryColor }, line: { color: 'FFFFFF', width: 2 } });
        slide.addText(m.date, { fontFace: ctx.font, x: cx - step / 2 + 0.05, y: lineY - 1.0, w: step - 0.1, h: 0.5, fontSize: 13, bold: true, color: ctx.brand.primaryColor, align: 'center', rtlMode: ctx.rtl });
        slide.addText(m.title, { fontFace: ctx.font, x: cx - step / 2 + 0.05, y: lineY + 0.35, w: step - 0.1, h: 0.6, fontSize: 14, bold: true, color: INK, align: 'center', rtlMode: ctx.rtl });
        if (m.detail) slide.addText(m.detail, { fontFace: ctx.font, x: cx - step / 2 + 0.05, y: lineY + 0.95, w: step - 0.1, h: 1.6, fontSize: 11, color: MUTED, align: 'center', valign: 'top', rtlMode: ctx.rtl });
      });
      return;
    }
    case 'quote': {
      chrome(ctx, slide, n, s.title);
      slide.addShape(pptx.ShapeType.rect, { x: ctx.rtl ? W - M - 0.12 : M, y: body.y + 0.4, w: 0.12, h: 2.6, fill: { color: ctx.brand.accentColor }, line: { color: ctx.brand.accentColor } });
      slide.addText(`“${s.quote}”`, text(ctx, { x: ctx.rtl ? M : M + 0.4, y: body.y + 0.3, w: body.w - 0.4, h: 2.6, fontSize: 26, italic: true, valign: 'middle' }));
      if (s.attribution) slide.addText(`— ${s.attribution}`, text(ctx, { x: M, y: body.y + 3.1, w: body.w, h: 0.5, fontSize: 16, color: MUTED }));
      return;
    }
    case 'closing': {
      slide.background = { color: ctx.brand.primaryColor };
      slide.addText(s.title || ctx.labels.qa, text(ctx, { x: M, y: 2.2, w: W - 2 * M, h: 1.4, fontSize: 44, bold: true, color: 'FFFFFF', align: 'center' }));
      slide.addText(s.subtitle, text(ctx, { x: M, y: 3.7, w: W - 2 * M, h: 0.8, fontSize: 20, color: 'E6E8F5', align: 'center' }));
      if (s.contact) slide.addText(s.contact, text(ctx, { x: M, y: 5.2, w: W - 2 * M, h: 0.5, fontSize: 14, color: 'E6E8F5', align: 'center' }));
      return;
    }
  }
}

export async function renderPptx(spec: DeckSpec, brand: DeckBranding, meta: { author: string }): Promise<Buffer> {
  const pptx = new PptxGenJS();
  pptx.layout = 'LAYOUT_WIDE';
  const rtl = spec.language === 'ar';
  pptx.rtlMode = rtl;
  pptx.author = meta.author;
  pptx.company = brand.companyName;
  pptx.title = spec.title;
  pptx.subject = spec.title;
  const ctx: Ctx = {
    pptx,
    rtl,
    brand,
    font: rtl ? 'Arial' : 'Calibri',
    labels: rtl ? { agenda: 'جدول الأعمال', qa: 'أسئلة ونقاش', page: 'صفحة' } : { agenda: 'Agenda', qa: 'Q&A', page: 'Page' },
  };
  spec.slides.forEach((s, i) => renderSlide(ctx, s, i + 1));
  const out = await pptx.write({ outputType: 'nodebuffer' });
  return Buffer.isBuffer(out) ? out : Buffer.from(out as ArrayBuffer);
}
