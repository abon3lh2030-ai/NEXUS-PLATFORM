/**
 * Public contact details shown on the site (footer + floating WhatsApp button).
 * Can be overridden at build time with VITE_* variables.
 */
const env = import.meta.env as Record<string, string | undefined>;

export const SITE_CONTACT = {
  commercialRegistration: env.VITE_CONTACT_CR ?? '7055047331',
  email: env.VITE_CONTACT_EMAIL ?? 'abdullahfah2030@hotmail.com',
  /** International format, digits only (used for tel: and wa.me links). */
  phone: env.VITE_CONTACT_PHONE ?? '966544160181',
  whatsapp: env.VITE_CONTACT_WHATSAPP ?? '966544160181',
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
