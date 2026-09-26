import {
  Avatar,
  Badge,
  Button,
  Dialog,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Kbd,
  Popover,
  PopoverContent,
  PopoverTrigger,
  SheetContent,
  cn,
} from '@nexus/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Bell, Building2, Check, ChevronsUpDown, CreditCard, LogOut, Menu, Plus, Search, Shield, User } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router';
import { CommandPalette } from '@/components/command-palette';
import { WhatsAppButton } from '@/components/whatsapp';
import { LanguageToggle, Logo, ThemeToggle } from '@/components/common';
import { CompanyLogo } from '@/components/company-logo';
import { api, apiPost } from '@/lib/api';
import { formatRelative } from '@/lib/format';
import { supabase } from '@/lib/supabase';
import { useSession } from '@/providers/session';
import { NAV } from './nav';

interface Notification {
  id: string;
  title: string;
  body: string;
  link: string | null;
  type: string;
  read_at: string | null;
  created_at: string;
}

function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const { t } = useTranslation();
  const { can } = useSession();
  return (
    <nav className="flex flex-1 flex-col gap-5 overflow-y-auto px-3 pb-6">
      {NAV.map((group) => {
        const items = group.items.filter((i) => !i.permission || can(i.permission));
        if (!items.length) return null;
        return (
          <div key={group.key}>
            <p className="mb-1 px-3 text-[11px] font-medium uppercase tracking-wider text-muted-foreground/80">{t(`nav.${group.key}`)}</p>
            <div className="grid gap-0.5">
              {items.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.to === '/app'}
                  onClick={onNavigate}
                  className={({ isActive }) =>
                    cn(
                      'group flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors',
                      isActive ? 'bg-primary/10 font-medium text-primary' : 'text-foreground/75 hover:bg-muted hover:text-foreground',
                    )
                  }
                >
                  <item.icon className="size-4 shrink-0" />
                  {t(`nav.${item.key}`)}
                </NavLink>
              ))}
            </div>
          </div>
        );
      })}
    </nav>
  );
}

function OrgSwitcher() {
  const { t } = useTranslation();
  const { me, org, setOrg } = useSession();
  const navigate = useNavigate();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button className="mx-3 mb-4 flex items-center gap-2 rounded-xl border bg-surface px-3 py-2 text-start shadow-xs hover:bg-muted">
          <CompanyLogo className="size-7" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">{org?.organization.name}</p>
            <p className="truncate text-xs text-muted-foreground">{org ? t(`roles.${org.membership.role}`) : ''}</p>
          </div>
          <ChevronsUpDown className="size-4 text-muted-foreground" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64">
        <DropdownMenuLabel>{t('org.switch')}</DropdownMenuLabel>
        {me?.organizations.map((o) => (
          <DropdownMenuItem key={o.id} onSelect={() => setOrg(o.id)}>
            <Building2 /> <span className="flex-1 truncate">{o.name}</span> {o.id === org?.organization.id && <Check />}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => navigate('/onboarding')}>
          <Plus /> {t('org.registerAnother')}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function NotificationsBell() {
  const { t } = useTranslation();
  const { session } = useSession();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { data = [] } = useQuery({ queryKey: ['notifications'], queryFn: () => api<Notification[]>('/notifications', { org: false }), refetchInterval: 60_000 });
  const unread = data.filter((n) => !n.read_at).length;

  useEffect(() => {
    if (!session) return;
    const channel = supabase
      .channel(`notifications:${session.user.id}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notifications', filter: `user_id=eq.${session.user.id}` }, () => void qc.invalidateQueries({ queryKey: ['notifications'] }))
      .subscribe();
    return () => void supabase.removeChannel(channel);
  }, [session, qc]);

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon-sm" className="relative" aria-label={t('nav.notifications')}>
          <Bell />
          {unread > 0 && <span className="absolute -end-0.5 -top-0.5 flex size-4 items-center justify-center rounded-full bg-destructive text-[10px] font-semibold text-white">{unread > 9 ? '9+' : unread}</span>}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-96 p-0">
        <div className="flex items-center justify-between border-b px-4 py-3">
          <p className="text-sm font-semibold">{t('nav.notifications')}</p>
          {unread > 0 && (
            <Button variant="link" size="sm" onClick={() => void apiPost('/notifications/read').then(() => qc.invalidateQueries({ queryKey: ['notifications'] }))}>
              {t('notifications.markAllRead')}
            </Button>
          )}
        </div>
        <div className="max-h-96 overflow-y-auto">
          {data.length === 0 && <p className="p-6 text-center text-sm text-muted-foreground">{t('notifications.empty')}</p>}
          {data.slice(0, 15).map((n) => (
            <button
              key={n.id}
              className={cn('flex w-full flex-col items-start gap-0.5 border-b px-4 py-3 text-start last:border-0 hover:bg-muted', !n.read_at && 'bg-primary/5')}
              onClick={() => {
                void apiPost('/notifications/read', { ids: [n.id] }).then(() => qc.invalidateQueries({ queryKey: ['notifications'] }));
                if (n.link) navigate(n.link);
              }}
            >
              <span className="text-sm font-medium">{n.title}</span>
              {n.body && <span className="line-clamp-2 text-xs text-muted-foreground">{n.body}</span>}
              <span className="text-[11px] text-muted-foreground">{formatRelative(n.created_at)}</span>
            </button>
          ))}
        </div>
        <div className="border-t p-2">
          <Button asChild variant="ghost" size="sm" className="w-full">
            <Link to="/app/notifications">{t('notifications.viewAll')}</Link>
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

function UserMenu() {
  const { t } = useTranslation();
  const { me, signOut, can } = useSession();
  const navigate = useNavigate();
  const name = me?.profile?.full_name || me?.email || '';
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button className="rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" aria-label={t('common.account')}>
          <Avatar name={name} className="size-8" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-56">
        <DropdownMenuLabel>
          <p className="truncate font-medium text-foreground">{name}</p>
          <p className="truncate text-xs">{me?.email}</p>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => navigate('/app/settings')}><User /> {t('settings.profile')}</DropdownMenuItem>
        {can('billing.view') && <DropdownMenuItem onSelect={() => navigate('/app/settings/billing')}><CreditCard /> {t('settings.billing')}</DropdownMenuItem>}
        {me?.is_super_admin && <DropdownMenuItem onSelect={() => navigate('/admin')}><Shield /> {t('admin.title')}</DropdownMenuItem>}
        <DropdownMenuSeparator />
        <DropdownMenuItem destructive onSelect={() => void signOut().then(() => navigate('/'))}><LogOut /> {t('auth.signOut')}</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function AppLayout() {
  const { t } = useTranslation();
  const { org } = useSession();
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const location = useLocation();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPaletteOpen((o) => !o);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => setMobileOpen(false), [location.pathname]);

  const sidebar = (
    <>
      <div className="flex h-16 items-center px-6">
        <Link to="/app"><Logo /></Link>
      </div>
      <OrgSwitcher />
      <Sidebar onNavigate={() => setMobileOpen(false)} />
    </>
  );

  return (
    <div className="flex min-h-dvh bg-background">
      <aside className="sticky top-0 hidden h-dvh w-64 shrink-0 flex-col border-e bg-surface/60 backdrop-blur lg:flex">{sidebar}</aside>
      <Dialog open={mobileOpen} onOpenChange={setMobileOpen}>
        <SheetContent className="start-0 end-auto w-72 max-w-[85vw] border-e border-s-0 bg-surface" closeLabel={t('common.close')}>
          {sidebar}
        </SheetContent>
      </Dialog>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-16 items-center gap-2 border-b bg-background/80 px-4 backdrop-blur sm:px-6">
          <Button variant="ghost" size="icon-sm" className="lg:hidden" onClick={() => setMobileOpen(true)} aria-label={t('common.menu')}>
            <Menu />
          </Button>
          <button onClick={() => setPaletteOpen(true)} className="flex h-9 w-full max-w-md items-center gap-2 rounded-lg border bg-surface px-3 text-sm text-muted-foreground shadow-xs hover:bg-muted">
            <Search className="size-4" />
            <span className="flex-1 text-start">{t('command.searchPlaceholder')}</span>
            <Kbd className="hidden sm:inline-flex">⌘K</Kbd>
          </button>
          <div className="ms-auto flex items-center gap-1">
            {org && !org.billing.active && (
              <Badge tone="warning" className="hidden sm:inline-flex">{t('billing.inactiveBadge')}</Badge>
            )}
            <LanguageToggle compact />
            <ThemeToggle />
            <NotificationsBell />
            <UserMenu />
          </div>
        </header>
        <main className="mx-auto w-full max-w-[1400px] flex-1 px-4 py-6 sm:px-6 lg:px-8">
          <Outlet />
        </main>
      </div>
      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} />
      <WhatsAppButton />
    </div>
  );
}
