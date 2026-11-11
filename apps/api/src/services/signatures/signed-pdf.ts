import { readFileSync } from 'node:fs';
import fontkit from '@pdf-lib/fontkit';
import { PDFDocument, rgb, type PDFFont, type PDFImage, type PDFPage } from 'pdf-lib';

/**
 * Builds the signed copy of a document: the original pages (untouched apart from a small footer) plus
 * signature page(s) listing every signer/approver, their signature image, time, IP and the original
 * document's SHA-256 and verification code. Arabic is shaped by fontkit (IBM Plex Sans Arabic, OFL).
 */

const FONT_DIR = new URL('../../../assets/fonts/', import.meta.url);
let fonts: { regular: Uint8Array; bold: Uint8Array } | null = null;
function fontBytes() {
  fonts ??= {
    regular: readFileSync(new URL('IBMPlexSansArabic-Regular.ttf', FONT_DIR)),
    bold: readFileSync(new URL('IBMPlexSansArabic-Bold.ttf', FONT_DIR)),
  };
  return fonts;
}

export interface SignedEntry {
  name: string;
  role: 'signer' | 'approver';
  actedAt: Date;
  ip: string | null;
  method: 'drawn' | 'uploaded' | null;
  image: { bytes: Uint8Array; type: 'png' | 'jpg' } | null;
}

export interface SignedDocumentInfo {
  orgName: string;
  title: string;
  documentName: string;
  verificationCode: string;
  sha256: string;
  completedAt: Date;
}

const A4: [number, number] = [595.28, 841.89];
const MARGIN = 48;
const INK = rgb(0.1, 0.1, 0.12);
const MUTED = rgb(0.42, 0.42, 0.46);
const LINE = rgb(0.85, 0.85, 0.88);

/**
 * fontkit lays out a whole Arabic line right-to-left, which would also reverse embedded numbers and Latin
 * words. Pre-reversing those runs makes them come out in the right order.
 */
export function visualOrder(text: string): string {
  if (!/[؀-ۿ]/.test(text)) return text;
  return text.replace(/[0-9A-Za-z@._:/+-]+/g, (run) => [...run].reverse().join(''));
}

/** "2026-11-11 19:48" in Riyadh time (UTC+3). */
export function riyadhTime(d: Date): string {
  return new Date(d.getTime() + 3 * 3600_000).toISOString().slice(0, 16).replace('T', ' ');
}

/** Opens a PDF or throws `invalid_pdf` (corrupt or encrypted files can't be signed). */
export async function loadPdf(bytes: Uint8Array): Promise<PDFDocument> {
  try {
    return await PDFDocument.load(bytes);
  } catch {
    throw Object.assign(new Error('invalid_pdf'), { code: 'invalid_pdf' });
  }
}

export async function buildSignedPdf(original: Uint8Array, info: SignedDocumentInfo, entries: SignedEntry[]): Promise<Uint8Array> {
  const doc = await loadPdf(original);
  doc.registerFontkit(fontkit);
  const regular = await doc.embedFont(fontBytes().regular, { subset: true });
  const bold = await doc.embedFont(fontBytes().bold, { subset: true });

  const footer = `Signed electronically via NEXUS  |  Verification code ${info.verificationCode}`;
  for (const page of doc.getPages()) drawFooter(page, regular, footer);

  const images = await Promise.all(entries.map((e) => (e.image ? (e.image.type === 'png' ? doc.embedPng(e.image.bytes) : doc.embedJpg(e.image.bytes)) : Promise.resolve(null))));

  let page = newPage(doc, regular, footer);
  let y = A4[1] - MARGIN;
  const right = A4[0] - MARGIN;

  y = text(page, 'صفحة التواقيع الإلكترونية', { font: bold, size: 20, right, y });
  y = text(page, info.orgName, { font: regular, size: 11, right, y: y - 4, color: MUTED });
  y -= 14;

  const rows: Array<[string, string, boolean]> = [
    ['المستند', info.title, false],
    ['اسم الملف', info.documentName, false],
    ['رمز التحقق', info.verificationCode, true],
    ['تاريخ اكتمال التوقيع - توقيت الرياض', riyadhTime(info.completedAt), true],
    ['بصمة المستند الأصلي - SHA-256', info.sha256, true],
  ];
  for (const [label, value, latin] of rows) {
    y = text(page, label, { font: bold, size: 10, right, y, color: MUTED });
    y = text(page, value, { font: regular, size: latin ? 9 : 11, right, y: y - 1, maxWidth: right - MARGIN, ltr: latin });
    y -= 6;
  }
  y -= 6;
  page.drawLine({ start: { x: MARGIN, y }, end: { x: right, y }, thickness: 1, color: LINE });
  y -= 18;

  const BLOCK = 112;
  entries.forEach((e, i) => {
    if (y - BLOCK < MARGIN + 20) {
      page = newPage(doc, regular, footer);
      y = A4[1] - MARGIN;
    }
    const top = y;
    page.drawRectangle({ x: MARGIN, y: top - BLOCK, width: right - MARGIN, height: BLOCK, borderColor: LINE, borderWidth: 1 });
    let ty = top - 8;
    ty = text(page, e.name, { font: bold, size: 13, right: right - 12, y: ty });
    ty = text(page, e.role === 'approver' ? 'معتمد' : 'موقّع', { font: regular, size: 10, right: right - 12, y: ty, color: MUTED });
    ty = labelValue(page, e.role === 'approver' ? 'وقت الاعتماد:' : 'وقت التوقيع:', riyadhTime(e.actedAt), { regular, size: 9, right: right - 12, y: ty - 2 });
    ty = labelValue(page, 'عنوان الجهاز:', e.ip ?? '-', { regular, size: 9, right: right - 12, y: ty });
    text(page, `الطريقة: ${e.method === 'drawn' ? 'توقيع مرسوم' : e.method === 'uploaded' ? 'صورة توقيع مرفوعة' : 'اعتماد'}`, { font: regular, size: 9, right: right - 12, y: ty });

    const img = images[i];
    const box = { x: MARGIN + 12, y: top - BLOCK + 12, w: 200, h: BLOCK - 24 };
    page.drawRectangle({ x: box.x, y: box.y, width: box.w, height: box.h, color: rgb(0.98, 0.98, 0.99) });
    if (img) drawContained(page, img, box);
    else text(page, 'اعتماد بدون توقيع مرسوم', { font: regular, size: 9, right: box.x + box.w - 10, y: box.y + box.h / 2 + 6, color: MUTED });
    y = top - BLOCK - 12;
  });

  if (y - 40 < MARGIN + 20) {
    page = newPage(doc, regular, footer);
    y = A4[1] - MARGIN;
  }
  text(page, 'توقيع إلكتروني بسيط داخل منصة نيكسوس. أي تعديل على المستند الأصلي يغيّر بصمته المذكورة أعلاه.', { font: regular, size: 8, right, y: y - 4, color: MUTED, maxWidth: right - MARGIN });

  return doc.save();
}

function newPage(doc: PDFDocument, font: PDFFont, footer: string): PDFPage {
  const page = doc.addPage(A4);
  drawFooter(page, font, footer);
  return page;
}

function drawFooter(page: PDFPage, font: PDFFont, footer: string) {
  const size = 7;
  const width = font.widthOfTextAtSize(footer, size);
  page.drawText(footer, { x: (page.getWidth() - width) / 2, y: 12, size, font, color: MUTED });
}

/** Draws right-aligned text (wrapped when needed) and returns the y below it. */
function text(page: PDFPage, value: string, o: { font: PDFFont; size: number; right: number; y: number; color?: ReturnType<typeof rgb>; maxWidth?: number; ltr?: boolean }): number {
  const lineHeight = o.size * 1.6;
  const lines = wrap(value, o.font, o.size, o.maxWidth ?? 400);
  let y = o.y;
  for (const line of lines) {
    y -= lineHeight;
    const shown = o.ltr ? line : visualOrder(line);
    const width = o.font.widthOfTextAtSize(shown, o.size);
    page.drawText(shown, { x: o.right - width, y, size: o.size, font: o.font, color: o.color ?? INK });
  }
  return y;
}

/** An Arabic label with a Latin/number value to its left, drawn separately so neither gets reordered. */
function labelValue(page: PDFPage, label: string, value: string, o: { regular: PDFFont; size: number; right: number; y: number }): number {
  const y = o.y - o.size * 1.6;
  const lw = o.regular.widthOfTextAtSize(label, o.size);
  page.drawText(label, { x: o.right - lw, y, size: o.size, font: o.regular, color: MUTED });
  const vw = o.regular.widthOfTextAtSize(value, o.size);
  page.drawText(value, { x: o.right - lw - 6 - vw, y, size: o.size, font: o.regular, color: INK });
  return y;
}

function wrap(value: string, font: PDFFont, size: number, maxWidth: number): string[] {
  if (font.widthOfTextAtSize(value, size) <= maxWidth) return [value];
  // Long tokens without spaces (hashes) are split by characters.
  if (!value.includes(' ')) {
    const out: string[] = [];
    let cur = '';
    for (const ch of value) {
      if (font.widthOfTextAtSize(cur + ch, size) > maxWidth) {
        out.push(cur);
        cur = ch;
      } else cur += ch;
    }
    if (cur) out.push(cur);
    return out;
  }
  const out: string[] = [];
  let cur = '';
  for (const word of value.split(' ')) {
    const next = cur ? `${cur} ${word}` : word;
    if (font.widthOfTextAtSize(next, size) > maxWidth && cur) {
      out.push(cur);
      cur = word;
    } else cur = next;
  }
  if (cur) out.push(cur);
  return out;
}

function drawContained(page: PDFPage, img: PDFImage, box: { x: number; y: number; w: number; h: number }) {
  const scale = Math.min(box.w / img.width, box.h / img.height, 1.5);
  const w = img.width * scale;
  const h = img.height * scale;
  page.drawImage(img, { x: box.x + (box.w - w) / 2, y: box.y + (box.h - h) / 2, width: w, height: h });
}
