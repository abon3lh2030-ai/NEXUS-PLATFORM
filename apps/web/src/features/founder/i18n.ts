import i18n from '@/i18n';
import { founderAr, founderEn } from './strings';

i18n.addResourceBundle('ar', 'translation', { founder: founderAr }, true, true);
i18n.addResourceBundle('en', 'translation', { founder: founderEn }, true, true);
// Server error codes shown by the shared error toast.
i18n.addResourceBundle('ar', 'translation', { errors: founderAr.errors }, true, false);
i18n.addResourceBundle('en', 'translation', { errors: founderEn.errors }, true, false);
