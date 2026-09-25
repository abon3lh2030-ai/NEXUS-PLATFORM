/**
 * File-type policy shared by client (early UX feedback) and server (authoritative).
 * The server NEVER trusts the extension or the client-declared MIME type: it sniffs the
 * leading bytes of the stored object with `detectFileType` and rejects mismatches.
 */

export type FileCategory = 'image' | 'pdf' | 'document' | 'spreadsheet' | 'presentation' | 'text' | 'archive';

export interface AllowedType {
  mime: string;
  extensions: readonly string[];
  category: FileCategory;
  /** How the server verifies content. */
  signature: 'png' | 'jpeg' | 'gif' | 'webp' | 'pdf' | 'zip' | 'ole' | 'text';
  previewable: boolean;
}

export const ALLOWED_FILE_TYPES: readonly AllowedType[] = [
  { mime: 'image/png', extensions: ['png'], category: 'image', signature: 'png', previewable: true },
  { mime: 'image/jpeg', extensions: ['jpg', 'jpeg'], category: 'image', signature: 'jpeg', previewable: true },
  { mime: 'image/gif', extensions: ['gif'], category: 'image', signature: 'gif', previewable: true },
  { mime: 'image/webp', extensions: ['webp'], category: 'image', signature: 'webp', previewable: true },
  { mime: 'application/pdf', extensions: ['pdf'], category: 'pdf', signature: 'pdf', previewable: true },
  {
    mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    extensions: ['docx'],
    category: 'document',
    signature: 'zip',
    previewable: false,
  },
  { mime: 'application/msword', extensions: ['doc'], category: 'document', signature: 'ole', previewable: false },
  {
    mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    extensions: ['xlsx'],
    category: 'spreadsheet',
    signature: 'zip',
    previewable: false,
  },
  { mime: 'application/vnd.ms-excel', extensions: ['xls'], category: 'spreadsheet', signature: 'ole', previewable: false },
  {
    mime: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    extensions: ['pptx'],
    category: 'presentation',
    signature: 'zip',
    previewable: false,
  },
  {
    mime: 'application/vnd.ms-powerpoint',
    extensions: ['ppt'],
    category: 'presentation',
    signature: 'ole',
    previewable: false,
  },
  { mime: 'text/plain', extensions: ['txt', 'log'], category: 'text', signature: 'text', previewable: true },
  { mime: 'text/csv', extensions: ['csv'], category: 'spreadsheet', signature: 'text', previewable: true },
  { mime: 'application/json', extensions: ['json'], category: 'text', signature: 'text', previewable: true },
  { mime: 'text/markdown', extensions: ['md', 'markdown'], category: 'text', signature: 'text', previewable: true },
  { mime: 'application/zip', extensions: ['zip'], category: 'archive', signature: 'zip', previewable: false },
];

/** Extensions that are always refused, even inside otherwise allowed categories. */
export const BLOCKED_EXTENSIONS = new Set([
  'exe', 'dll', 'bat', 'cmd', 'com', 'msi', 'sh', 'bash', 'ps1', 'vbs', 'js', 'mjs', 'jar', 'app', 'scr',
  'html', 'htm', 'svg', 'xhtml', 'php', 'py', 'rb', 'pl', 'apk', 'dmg', 'iso', 'lnk', 'hta', 'docm', 'xlsm', 'pptm',
]);

export function getExtension(fileName: string): string {
  const idx = fileName.lastIndexOf('.');
  return idx >= 0 ? fileName.slice(idx + 1).toLowerCase() : '';
}

export function findAllowedTypeByExtension(fileName: string): AllowedType | undefined {
  const ext = getExtension(fileName);
  if (!ext || BLOCKED_EXTENSIONS.has(ext)) return undefined;
  return ALLOWED_FILE_TYPES.find((t) => t.extensions.includes(ext));
}

export function isArchiveAllowedByPolicy(type: AllowedType, allowArchives: boolean): boolean {
  return type.category !== 'archive' || allowArchives;
}

/**
 * Sanitize a user-supplied file name for DISPLAY purposes only.
 * Storage keys are always server-generated UUIDs and never contain this value.
 */
export function sanitizeFileName(input: string): string {
  const base = input.split(/[\\/]/).pop() ?? '';
  // Strip control characters, reserved characters and leading dots.
  // eslint-disable-next-line no-control-regex
  let name = base.replace(/[\u0000-\u001f\u007f<>:"|?*]/g, '').replace(/\s+/g, ' ').trim();
  name = name.replace(/^\.+/, '');
  if (name === '' || name === '.' || name === '..') name = 'file';
  if (name.length > 180) {
    const ext = getExtension(name);
    const stem = name.slice(0, 180 - (ext ? ext.length + 1 : 0));
    name = ext ? `${stem}.${ext}` : stem;
  }
  return name;
}

/** Folder names follow the same rules, without extension handling. */
export function sanitizeFolderName(input: string): string {
  // eslint-disable-next-line no-control-regex
  const name = input.replace(/[\u0000-\u001f\u007f<>:"|?*\\/]/g, '').replace(/\s+/g, ' ').trim().replace(/^\.+/, '');
  return name.slice(0, 120);
}

function startsWith(bytes: Uint8Array, sig: readonly number[], offset = 0): boolean {
  if (bytes.length < offset + sig.length) return false;
  return sig.every((b, i) => bytes[offset + i] === b);
}

/** Heuristic: is this buffer plausible UTF-8 text without binary control bytes? */
export function looksLikeText(bytes: Uint8Array): boolean {
  if (bytes.length === 0) return true;
  let suspicious = 0;
  for (const b of bytes) {
    if (b === 0) return false;
    if (b < 7 || (b > 13 && b < 32 && b !== 27)) suspicious++;
  }
  if (suspicious / bytes.length > 0.02) return false;
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(trimIncompleteUtf8(bytes));
    return true;
  } catch {
    return false;
  }
}

/** Drop a trailing partial UTF-8 sequence so a sniffed prefix doesn't fail decoding. */
function trimIncompleteUtf8(bytes: Uint8Array): Uint8Array {
  let end = bytes.length;
  for (let i = 1; i <= 3 && end - i >= 0; i++) {
    const b = bytes[end - i]!;
    if ((b & 0xc0) === 0x80) continue; // continuation byte
    if ((b & 0xe0) === 0xc0 && i < 2) end -= i;
    else if ((b & 0xf0) === 0xe0 && i < 3) end -= i;
    else if ((b & 0xf8) === 0xf0 && i < 4) end -= i;
    break;
  }
  return bytes.subarray(0, end);
}

export function matchesSignature(bytes: Uint8Array, signature: AllowedType['signature']): boolean {
  switch (signature) {
    case 'png':
      return startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    case 'jpeg':
      return startsWith(bytes, [0xff, 0xd8, 0xff]);
    case 'gif':
      return startsWith(bytes, [0x47, 0x49, 0x46, 0x38]);
    case 'webp':
      return startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) && startsWith(bytes, [0x57, 0x45, 0x42, 0x50], 8);
    case 'pdf':
      return startsWith(bytes, [0x25, 0x50, 0x44, 0x46, 0x2d]);
    case 'zip':
      return startsWith(bytes, [0x50, 0x4b, 0x03, 0x04]) || startsWith(bytes, [0x50, 0x4b, 0x05, 0x06]);
    case 'ole':
      return startsWith(bytes, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
    case 'text':
      return looksLikeText(bytes);
  }
}

export interface FileTypeVerdict {
  ok: boolean;
  type?: AllowedType;
  reason?: 'blocked_extension' | 'unsupported_type' | 'content_mismatch' | 'archives_disabled';
}

/**
 * Authoritative server-side validation: the declared name must map to an allowed type AND
 * the actual leading bytes must match that type's signature.
 */
export function verifyFileContent(fileName: string, head: Uint8Array, opts: { allowArchives: boolean }): FileTypeVerdict {
  const ext = getExtension(fileName);
  if (BLOCKED_EXTENSIONS.has(ext)) return { ok: false, reason: 'blocked_extension' };
  const type = findAllowedTypeByExtension(fileName);
  if (!type) return { ok: false, reason: 'unsupported_type' };
  if (!isArchiveAllowedByPolicy(type, opts.allowArchives)) return { ok: false, reason: 'archives_disabled' };
  if (!matchesSignature(head, type.signature)) return { ok: false, reason: 'content_mismatch', type };
  // OOXML files are ZIPs: a renamed .zip passes the signature, which is acceptable since
  // we never execute or unpack uploads; they're served with Content-Disposition attachment.
  return { ok: true, type };
}

export function formatBytes(bytes: number, locale = 'en'): string {
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let v = bytes;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${new Intl.NumberFormat(locale, { maximumFractionDigits: i === 0 ? 0 : 1 }).format(v)} ${units[i]}`;
}
