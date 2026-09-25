/**
 * Saudi Commercial Registration (السجل التجاري) numbers are 10 digits.
 * Legacy CRs start with a city code (1–5); unified national numbers (الرقم الوطني الموحد) start with 7.
 * This is a format check only — ownership is verified manually by the platform team.
 */
export function isValidSaudiCommercialRegistration(value: string): boolean {
  return /^[1-7]\d{9}$/.test(value.trim());
}

export function normalizeCommercialRegistration(value: string): string {
  // Accept Arabic-Indic digits and strip spaces/dashes.
  const map: Record<string, string> = { '٠': '0', '١': '1', '٢': '2', '٣': '3', '٤': '4', '٥': '5', '٦': '6', '٧': '7', '٨': '8', '٩': '9' };
  return value.replace(/[٠-٩]/g, (d) => map[d] ?? d).replace(/[\s-]/g, '');
}

/** Amounts are stored in halalas (1 SAR = 100 halalas) to avoid floating point errors. */
export function halalasToSar(halalas: number): number {
  return halalas / 100;
}

export function formatSar(halalas: number, locale: 'ar' | 'en'): string {
  return new Intl.NumberFormat(locale === 'ar' ? 'ar-SA' : 'en-SA', {
    style: 'currency',
    currency: 'SAR',
    maximumFractionDigits: 0,
  }).format(halalasToSar(halalas));
}
