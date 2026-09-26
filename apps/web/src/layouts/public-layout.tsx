import { Button, Dialog, SheetContent } from '@nexus/ui';
import { FileBadge, Mail, Menu, Phone } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, NavLink, Outlet, useLocation } from 'react-router';
import { LanguageToggle, Logo, ThemeToggle } from '@/components/common';
import { useSession } from '@/providers/session';
import { WhatsAppButton, WhatsAppIcon } from '@/components/whatsapp';
import { formatSaudiPhone, SITE_CONTACT, whatsappLink } from '@/config/site';

const LINKS = [
  { to: '/platform', key: 'platform' },
  { to: '/ai-workforce', key: 'aiWorkforce' },
  { to: '/features', key: 'features' },
  { to: '/pricing', key: 'pricing' },
  { to: '/enterprise', key: 'enterprise' },
  { to: '/contact', key: 'contact' },
];

export function PublicLayout() {
  const { t } = useTranslation();
  const { session } = useSession();
  const [open, setOpen] = useState(false);
  const location = useLocation();
  useEffect(() => {
    setOpen(false);
    window.scrollTo(0, 0);
  }, [location.pathname]);

  const links = (
    <>
      {LINKS.map((l) => (
        <NavLink key={l.to} to={l.to} className={({ isActive }) => `rounded-lg px-3 py-2 text-sm transition-colors ${isActive ? 'text-foreground' : 'text-muted-foreground hover:text-foreground'}`}>
          {t(`public.nav.${l.key}`)}
        </NavLink>
      ))}
    </>
  );

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="sticky top-0 z-40 border-b border-transparent bg-background/70 backdrop-blur-xl [&:has(~main_*)]:border-border/60">
        <div className="mx-auto flex h-16 max-w-7xl items-center gap-4 px-4 sm:px-6">
          <Link to="/" aria-label="NEXUS"><Logo /></Link>
          <nav className="ms-6 hidden items-center gap-1 lg:flex">{links}</nav>
          <div className="ms-auto flex items-center gap-1">
            <LanguageToggle compact />
            <ThemeToggle />
            {session ? (
              <Button asChild size="sm" variant="brand" className="ms-2"><Link to="/app">{t('public.openApp')}</Link></Button>
            ) : (
              <>
                <Button asChild size="sm" variant="ghost" className="hidden sm:inline-flex"><Link to="/login">{t('auth.signIn')}</Link></Button>
                <Button asChild size="sm" variant="brand" className="ms-1"><Link to="/signup">{t('public.getStarted')}</Link></Button>
              </>
            )}
            <Button variant="ghost" size="icon-sm" className="lg:hidden" onClick={() => setOpen(true)} aria-label={t('common.menu')}><Menu /></Button>
          </div>
        </div>
      </header>
      <Dialog open={open} onOpenChange={setOpen}>
        <SheetContent className="w-72 p-6 pt-14" closeLabel={t('common.close')}>
          <nav className="grid gap-1">{links}</nav>
          {!session && <Button asChild variant="outline" className="mt-4"><Link to="/login">{t('auth.signIn')}</Link></Button>}
        </SheetContent>
      </Dialog>
      <main className="flex-1">
        <Outlet />
      </main>
      <WhatsAppButton />
      <footer className="border-t bg-surface/50">
        <div className="mx-auto grid max-w-7xl gap-8 px-4 py-12 sm:px-6 md:grid-cols-4">
          <div className="md:col-span-2">
            <Logo />
            <p className="mt-3 max-w-sm text-sm text-muted-foreground">{t('public.footer.tagline')}</p>
            <p className="mt-2 text-xs text-muted-foreground">{t('public.footer.saudiOnly')}</p>
          </div>
          <div className="grid content-start gap-2 text-sm">
            <p className="font-medium">{t('public.footer.product')}</p>
            {LINKS.slice(0, 4).map((l) => <Link key={l.to} to={l.to} className="text-muted-foreground hover:text-foreground">{t(`public.nav.${l.key}`)}</Link>)}
          </div>
          <div className="grid content-start gap-2 text-sm">
            <p className="font-medium">{t('public.footer.company')}</p>
            <Link to="/enterprise" className="text-muted-foreground hover:text-foreground">{t('public.nav.enterprise')}</Link>
            <Link to="/contact" className="text-muted-foreground hover:text-foreground">{t('public.nav.contact')}</Link>
            <Link to="/privacy" className="text-muted-foreground hover:text-foreground">{t('public.privacy.title')}</Link>
            <Link to="/terms" className="text-muted-foreground hover:text-foreground">{t('public.terms.title')}</Link>
          </div>
        </div>
        <div className="border-t">
          <div className="mx-auto flex max-w-7xl flex-col items-center gap-4 px-4 py-6 sm:px-6 lg:flex-row lg:justify-between">
            <ul className="flex flex-wrap items-center justify-center gap-x-6 gap-y-3 text-sm text-muted-foreground" data-testid="footer-contact">
              <li className="flex items-center gap-2">
                <FileBadge className="size-4 shrink-0" />
                <span>{t('contact.cr')}:</span>
                <span className="font-medium text-foreground" dir="ltr">{SITE_CONTACT.commercialRegistration}</span>
              </li>
              <li>
                <a href={`mailto:${SITE_CONTACT.email}`} className="flex items-center gap-2 hover:text-foreground">
                  <Mail className="size-4 shrink-0" />
                  <span className="font-medium text-foreground" dir="ltr">{SITE_CONTACT.email}</span>
                </a>
              </li>
              <li>
                <a href={`tel:+${SITE_CONTACT.phone}`} className="flex items-center gap-2 hover:text-foreground">
                  <Phone className="size-4 shrink-0" />
                  <span className="font-medium text-foreground" dir="ltr">{formatSaudiPhone(SITE_CONTACT.phone)}</span>
                </a>
              </li>
              <li>
                <a href={whatsappLink(t('contact.whatsappMessage'))} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 hover:text-foreground">
                  <WhatsAppIcon className="size-4 shrink-0 text-[#25D366]" />
                  <span className="font-medium text-foreground">{t('contact.whatsapp')}</span>
                </a>
              </li>
            </ul>
            <p className="text-xs text-muted-foreground">© {new Date().getFullYear()} NEXUS. {t('public.footer.rights')}</p>
          </div>
        </div>
      </footer>
    </div>
  );
}
