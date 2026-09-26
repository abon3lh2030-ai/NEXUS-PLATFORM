import { cn } from '@nexus/ui';
import { useTranslation } from 'react-i18next';
import { whatsappLink } from '@/config/site';

export function WhatsAppIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden>
      <path d="M17.47 14.38c-.3-.15-1.75-.86-2.02-.96-.27-.1-.47-.15-.67.15-.2.3-.77.96-.94 1.16-.17.2-.35.22-.64.07-.3-.15-1.25-.46-2.38-1.47-.88-.79-1.47-1.76-1.64-2.05-.17-.3-.02-.46.13-.61.13-.13.3-.35.45-.52.15-.17.2-.3.3-.5.1-.2.05-.37-.02-.52-.08-.15-.67-1.62-.92-2.22-.24-.58-.49-.5-.67-.51h-.57c-.2 0-.52.07-.79.37-.27.3-1.04 1.02-1.04 2.48s1.07 2.88 1.21 3.08c.15.2 2.1 3.2 5.08 4.49.71.31 1.26.49 1.69.63.71.22 1.36.19 1.87.12.57-.09 1.75-.72 2-1.41.25-.69.25-1.28.17-1.41-.07-.12-.27-.2-.57-.35zM12.04 21.5h-.01a9.45 9.45 0 0 1-4.82-1.32l-.35-.2-3.58.94.96-3.49-.23-.36a9.43 9.43 0 0 1-1.45-5.03C2.56 6.83 6.8 2.6 12.05 2.6c2.54 0 4.92.99 6.72 2.78a9.42 9.42 0 0 1 2.78 6.72c0 5.23-4.25 9.4-9.5 9.4zm8.08-17.48A11.35 11.35 0 0 0 12.04.66C5.74.66.62 5.78.62 12.07c0 2.01.53 3.97 1.53 5.7L.53 23.34l5.7-1.5a11.4 11.4 0 0 0 5.81 1.48h.01c6.29 0 11.41-5.12 11.41-11.41 0-3.05-1.19-5.91-3.34-8.07z" />
    </svg>
  );
}

/** Floating WhatsApp support button, fixed to the bottom-LEFT corner in both RTL and LTR. */
export function WhatsAppButton({ className }: { className?: string }) {
  const { t } = useTranslation();
  return (
    <a
      href={whatsappLink(t('contact.whatsappMessage'))}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={t('contact.whatsappSupport')}
      title={t('contact.whatsappSupport')}
      className={cn(
        'group fixed bottom-5 left-5 z-50 flex size-14 items-center justify-center rounded-full bg-[#25D366] text-white shadow-lg shadow-black/20 transition-transform hover:scale-105 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#25D366]/40',
        className,
      )}
    >
      <span className="absolute inset-0 animate-ping rounded-full bg-[#25D366] opacity-20 [animation-duration:2.5s]" aria-hidden />
      <WhatsAppIcon className="relative size-7" />
    </a>
  );
}
