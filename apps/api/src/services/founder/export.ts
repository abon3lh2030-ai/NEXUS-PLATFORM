import fontkit from '@pdf-lib/fontkit';
import JSZip from 'jszip';
import { PDFDocument, rgb, type PDFFont } from 'pdf-lib';
import { fontBytes, riyadhTime, visualOrder } from '../signatures/signed-pdf.js';

export interface ExportColumn {
  key: string;
  label: string;
}
export interface ExportSheet {
  title: string;
  columns: ExportColumn[];
  rows: Array<Record<string, unknown>>;
}

// eslint-disable-next-line no-control-regex -- strips characters XML 1.0 forbids
const xmlEscape = (s: string) => s.replace(/[<>&"']/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[c]!).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');

function colName(i: number): string {
  let s = '';
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}

function cellValue(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'boolean') return v ? '✓' : '';
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

/** Excel workbook (.xlsx, Office Open XML) — one sheet per table, right-to-left when Arabic. */
export async function buildXlsx(sheets: ExportSheet[], rtl: boolean): Promise<Buffer> {
  const zip = new JSZip();
  const names = sheets.map((s, i) => (s.title.replace(/[[\]:*?/\\]/g, ' ').slice(0, 31) || `Sheet${i + 1}`));
  zip.file('[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}</Types>`);
  zip.file('_rels/.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`);
  zip.file('xl/workbook.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${names.map((n, i) => `<sheet name="${xmlEscape(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets></workbook>`);
  zip.file('xl/_rels/workbook.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`);
  zip.file('xl/styles.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Arial"/></font><font><b/><sz val="11"/><name val="Arial"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFEDE9FE"/></patternFill></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf/></cellStyleXfs><cellXfs count="3"><xf/><xf fontId="1" fillId="2" applyFont="1" applyFill="1"/><xf numFmtId="4" applyNumberFormat="1"/></cellXfs></styleSheet>`);
  sheets.forEach((sheet, i) => {
    const header = `<row r="1">${sheet.columns.map((c, j) => `<c r="${colName(j)}1" t="inlineStr" s="1"><is><t>${xmlEscape(c.label)}</t></is></c>`).join('')}</row>`;
    const body = sheet.rows.map((row, r) => `<row r="${r + 2}">${sheet.columns.map((c, j) => {
      const v = row[c.key];
      const ref = `${colName(j)}${r + 2}`;
      if (typeof v === 'number' && Number.isFinite(v)) return `<c r="${ref}" s="2"><v>${v}</v></c>`;
      if (typeof v === 'string' && /^-?\d+(\.\d+)?$/.test(v) && v.length < 16) return `<c r="${ref}" s="2"><v>${v}</v></c>`;
      return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${xmlEscape(cellValue(v))}</t></is></c>`;
    }).join('')}</row>`).join('');
    const cols = `<cols>${sheet.columns.map((_, j) => `<col min="${j + 1}" max="${j + 1}" width="22" customWidth="1"/>`).join('')}</cols>`;
    zip.file(`xl/worksheets/sheet${i + 1}.xml`, `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"${rtl ? ' rightToLeft="1"' : ''}><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>${cols}<sheetData>${header}${body}</sheetData></worksheet>`);
  });
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}

const INK = rgb(0.1, 0.1, 0.12);
const MUTED = rgb(0.42, 0.42, 0.46);
const BRAND = rgb(0.36, 0.25, 0.83);
const LINE = rgb(0.86, 0.86, 0.9);
const HEAD_BG = rgb(0.93, 0.91, 0.99);

function fit(font: PDFFont, text: string, size: number, width: number): string {
  let t = text.replace(/\s+/g, ' ').trim();
  if (font.widthOfTextAtSize(visualOrder(t), size) <= width) return t;
  while (t.length > 1 && font.widthOfTextAtSize(visualOrder(`${t}…`), size) > width) t = t.slice(0, -1);
  return `${t}…`;
}

/** Landscape A4 PDF report with one table per sheet (Arabic shaped by fontkit, laid out right-to-left). */
export async function buildPdf(title: string, sheets: ExportSheet[], rtl: boolean, footerNote: string): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const { regular, bold } = fontBytes();
  const font = await doc.embedFont(regular, { subset: true });
  const fontBold = await doc.embedFont(bold, { subset: true });
  doc.setTitle(title);
  doc.setCreator('NEXUS Founder Portal');

  const W = 841.89;
  const H = 595.28;
  const M = 36;
  let page = doc.addPage([W, H]);
  let y = H - M;

  const text = (s: string, x: number, yy: number, size: number, f: PDFFont, color = INK, align: 'left' | 'right' = rtl ? 'right' : 'left', width = 0) => {
    const v = visualOrder(s);
    const w = f.widthOfTextAtSize(v, size);
    page.drawText(v, { x: align === 'right' ? x + width - w : x, y: yy, size, font: f, color });
  };
  const newPage = () => {
    page = doc.addPage([W, H]);
    y = H - M;
  };

  text(title, M, y - 4, 18, fontBold, BRAND, rtl ? 'right' : 'left', W - 2 * M);
  y -= 22;
  text(`${footerNote} · ${riyadhTime(new Date())}`, M, y - 4, 9, font, MUTED, rtl ? 'right' : 'left', W - 2 * M);
  y -= 22;

  for (const sheet of sheets) {
    if (y < M + 80) newPage();
    text(sheet.title, M, y - 4, 13, fontBold, INK, rtl ? 'right' : 'left', W - 2 * M);
    y -= 22;
    const cols = sheet.columns.slice(0, 10);
    const colW = (W - 2 * M) / Math.max(1, cols.length);
    const xOf = (j: number) => (rtl ? W - M - (j + 1) * colW : M + j * colW);
    const header = () => {
      page.drawRectangle({ x: M, y: y - 16, width: W - 2 * M, height: 20, color: HEAD_BG });
      cols.forEach((c, j) => text(fit(fontBold, c.label, 9, colW - 8), xOf(j) + 4, y - 10, 9, fontBold, INK, rtl ? 'right' : 'left', colW - 8));
      y -= 22;
    };
    header();
    if (!sheet.rows.length) {
      text('—', M, y - 6, 9, font, MUTED, rtl ? 'right' : 'left', W - 2 * M);
      y -= 18;
    }
    for (const row of sheet.rows) {
      if (y < M + 24) {
        newPage();
        header();
      }
      cols.forEach((c, j) => text(fit(font, cellValue(row[c.key]), 8.5, colW - 8), xOf(j) + 4, y - 8, 8.5, font, INK, rtl ? 'right' : 'left', colW - 8));
      page.drawLine({ start: { x: M, y: y - 13 }, end: { x: W - M, y: y - 13 }, thickness: 0.5, color: LINE });
      y -= 18;
    }
    y -= 14;
  }

  const pages = doc.getPages();
  pages.forEach((p, i) => {
    const label = `${i + 1} / ${pages.length}`;
    p.drawText(label, { x: W / 2 - font.widthOfTextAtSize(label, 8) / 2, y: 18, size: 8, font, color: MUTED });
  });
  return doc.save();
}
