import { Badge, Button, SheetContent, Dialog, cn } from '@nexus/ui';
import { Activity, BarChart3, Bot, Briefcase, Calculator, Code2, Compass, Cpu, FileText, Gauge, Gavel, History, Landmark, LogOut, Map, Megaphone, Menu, PieChart, Scale, Settings, Shield, ShieldAlert, Swords, Target, TrendingUp, Users, Wallet } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, NavLink, Outlet } from 'react-router';
import { LanguageToggle, Logo, ThemeToggle } from '@/components/common';
import { useSession } from '@/providers/session';
import { FounderGate } from './gate';
import './i18n';

const GROUPS = [
  { key: 'command', items: [
    { to: '/founder', key: 'overview', icon: Gauge, end: true },
    { to: '/founder/strategy', key: 'strategy', icon: Target },
    { to: '/founder/growth', key: 'growth', icon: TrendingUp },
    { to: '/founder/decisions', key: 'decisions', icon: Gavel },
    { to: '/founder/reports', key: 'reports', icon: BarChart3 },
  ] },
  { key: 'business', items: [
    { to: '/founder/sales', key: 'sales', icon: Briefcase },
    { to: '/founder/finance', key: 'finance', icon: Wallet },
    { to: '/founder/marketing', key: 'marketing', icon: Megaphone },
    { to: '/founder/investors', key: 'investors', icon: PieChart },
    { to: '/founder/team', key: 'team', icon: Users },
  ] },
  { key: 'technology', items: [
    { to: '/founder/technology', key: 'technology', icon: Cpu, end: true },
    { to: '/founder/technology/plan', key: 'plan', icon: Map },
    { to: '/founder/technology/progress', key: 'progress', icon: Activity },
    { to: '/founder/technology/simulator', key: 'simulator', icon: Calculator },
    { to: '/founder/development', key: 'development', icon: Code2 },
  ] },
  { key: 'governance', items: [
    { to: '/founder/legal', key: 'legal', icon: Scale },
    { to: '/founder/competitors', key: 'competitors', icon: Swords },
    { to: '/founder/risks', key: 'risks', icon: ShieldAlert },
    { to: '/founder/documents', key: 'documents', icon: FileText },
    { to: '/founder/audit', key: 'audit', icon: History },
    { to: '/founder/settings', key: 'settings', icon: Settings },
  ] },
] as const;

function Nav({ onNavigate }: { onNavigate?: () => void }) {
  const { t } = useTranslation();
  const { me } = useSession();
  return (
    <nav className="grid gap-5 p-3">
      {GROUPS.map((g) => (
        <div key={g.key}>
          <p className="mb-1 px-3 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{t(`founder.nav.groups.${g.key}`)}</p>
          <div className="grid gap-0.5">
            {g.items.map((i) => (
              <NavLink key={i.to} to={i.to} end={'end' in i ? i.end : false} onClick={onNavigate}
                className={({ isActive }) => cn('flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors', isActive ? 'bg-primary/10 font-medium text-primary' : 'text-muted-foreground hover:bg-muted hover:text-foreground')}>
                <i.icon className="size-4 shrink-0" /> {t(`founder.nav.${i.key}`)}
              </NavLink>
            ))}
          </div>
        </div>
      ))}
      {me?.is_super_admin && (
        <Link to="/admin" onClick={onNavigate} className="flex items-center gap-2.5 rounded-lg border border-dashed px-3 py-2 text-sm text-muted-foreground hover:text-foreground"><Shield className="size-4" /> {t('founder.nav.admin')}</Link>
      )}
    </nav>
  );
}

export function FounderLayout() {
  const { t } = useTranslation();
  const { signOut } = useSession();
  const [open, setOpen] = useState(false);
  return (
    <FounderGate>
      {(s) => (
        <div className="min-h-dvh bg-background lg:grid lg:grid-cols-[260px_1fr]">
          <aside className="sticky top-0 hidden h-dvh flex-col border-e bg-surface lg:flex">
            <div className="flex h-16 items-center gap-2 border-b px-4"><Link to="/founder"><Logo /></Link><Badge tone="primary"><Landmark /> {t('founder.short')}</Badge></div>
            <div className="flex-1 overflow-y-auto"><Nav /></div>
            <div className="border-t p-3 text-xs text-muted-foreground"><p className="truncate" dir="ltr">{s.email}</p><p>{t('founder.confidential')}</p></div>
          </aside>
          <div className="min-w-0">
            <header className="sticky top-0 z-30 flex h-16 items-center gap-2 border-b bg-background/80 px-4 backdrop-blur sm:px-6">
              <Button className="lg:hidden" size="icon-sm" variant="ghost" aria-label={t('common.menu')} onClick={() => setOpen(true)}><Menu /></Button>
              <span className="flex items-center gap-2 text-sm font-semibold lg:hidden"><Bot className="size-4 text-primary" /> {t('founder.short')}</span>
              <div className="ms-auto flex items-center gap-1">
                <Link to="/founder/technology" className="hidden items-center gap-1 rounded-lg px-2 py-1 text-xs text-muted-foreground hover:bg-muted sm:flex"><Compass className="size-3.5" /> {t('founder.nav.technology')}</Link>
                <LanguageToggle compact /><ThemeToggle />
                <Button size="sm" variant="ghost" onClick={() => void signOut()}><LogOut /> <span className="hidden sm:inline">{t('founder.auth.signOut')}</span></Button>
              </div>
            </header>
            <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6"><Outlet /></main>
          </div>
          <Dialog open={open} onOpenChange={setOpen}>
            <SheetContent closeLabel={t('founder.common.cancel')} className="overflow-y-auto p-0"><div className="flex h-14 items-center border-b px-4"><Logo /></div><Nav onNavigate={() => setOpen(false)} /></SheetContent>
          </Dialog>
        </div>
      )}
    </FounderGate>
  );
}
