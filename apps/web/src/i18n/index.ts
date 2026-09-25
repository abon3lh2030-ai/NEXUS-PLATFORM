import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { ar } from './ar';
import { en } from './en';

export type Locale = 'ar' | 'en';
const KEY = 'nexus.locale';

function initialLocale(): Locale {
  try {
    return localStorage.getItem(KEY) === 'en' ? 'en' : 'ar'; // Arabic is the default
  } catch {
    return 'ar';
  }
}

export function applyDocumentLocale(locale: Locale): void {
  document.documentElement.lang = locale;
  document.documentElement.dir = locale === 'ar' ? 'rtl' : 'ltr';
}

export function setLocale(locale: Locale): void {
  try {
    localStorage.setItem(KEY, locale);
  } catch {
    /* ignore */
  }
  applyDocumentLocale(locale);
  void i18n.changeLanguage(locale);
}

const locale = initialLocale();
applyDocumentLocale(locale);

void i18n.use(initReactI18next).init({
  resources: { ar: { translation: ar }, en: { translation: en } },
  lng: locale,
  fallbackLng: 'ar',
  interpolation: { escapeValue: false },
  returnNull: false,
});

export default i18n;
