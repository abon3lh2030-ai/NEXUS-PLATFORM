/**
 * Public contact details shown on the site (footer + floating WhatsApp button).
 * They come only from .env (VITE_CONTACT_*), read at build time. An empty value hides that item.
 */
const env = import.meta.env as Record<string, string | undefined>;
const clean = (v: string | undefined) => (v ?? '').trim();

/** Accepts 05XXXXXXXX, 5XXXXXXXX, +9665XXXXXXXX or 9665XXXXXXXX and returns 9665XXXXXXXX (digits only). */
export function normalizeSaudiPhone(value: string): string {
  const d = value.replace(/\D/g, '');
  if (d.startsWith('966')) return d;
  if (d.startsWith('05') && d.length === 10) return `966${d.slice(1)}`;
  if (d.startsWith('5') && d.length === 9) return `966${d}`;
  return d;
}

export const SITE_CONTACT = {
  commercialRegistration: clean(env.VITE_CONTACT_CR),
  email: clean(env.VITE_CONTACT_EMAIL),
  /** International format, digits only (used for tel: and wa.me links). */
  phone: normalizeSaudiPhone(clean(env.VITE_CONTACT_PHONE)),
  whatsapp: normalizeSaudiPhone(clean(env.VITE_CONTACT_WHATSAPP)),
};

/** +966 54 416 0181 */
export function formatSaudiPhone(digits: string): string {
  const d = digits.replace(/\D/g, '');
  if (d.startsWith('966') && d.length === 12) return `+966 ${d.slice(3, 5)} ${d.slice(5, 8)} ${d.slice(8)}`;
  return `+${d}`;
}

export function whatsappLink(message: string): string {
  return `https://wa.me/${SITE_CONTACT.whatsapp}?text=${encodeURIComponent(message)}`;
}
