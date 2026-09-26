import { Badge, Button, Card, CardContent, cn } from '@nexus/ui';
import { useQuery } from '@tanstack/react-query';
import type { PublicPlan } from '@nexus/shared';
import { Bot, Check, Crown, Minus } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { LoadingBlock } from '@/components/common';
import { api } from '@/lib/api';
import { formatBytes, formatNumber, formatSar } from '@/lib/format';
import { Reveal, SectionTitle } from './landing';

function PageHero({ eyebrow, title, subtitle }: { eyebrow?: string; title: string; subtitle?: string }) {
  return (
    <section className="relative overflow-hidden border-b">
      <div className="grid-bg absolute inset-0 -z-10 [mask-image:radial-gradient(ellipse_at_top,black,transparent_70%)]" />
      <div className="mx-auto max-w-4xl px-4 py-16 text-center sm:px-6 sm:py-20">
        {eyebrow && <p className="text-sm font-medium text-primary">{eyebrow}</p>}
        <h1 className="mt-2 text-4xl font-semibold tracking-tight sm:text-5xl">{title}</h1>
        {subtitle && <p className="mx-auto mt-4 max-w-2xl text-lg text-muted-foreground">{subtitle}</p>}
      </div>
    </section>
  );
}

type Block = { title: string; body: string; points?: string[] };

function BlockGrid({ blocks }: { blocks: Block[] }) {
  return (
    <div className="mx-auto grid max-w-7xl gap-4 px-4 py-16 sm:px-6 md:grid-cols-2 lg:grid-cols-3">
      {blocks.map((b, i) => (
        <Reveal key={i} delay={(i % 3) * 0.05}>
          <Card className="h-full">
            <CardContent className="p-6">
              <h3 className="font-semibold">{b.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{b.body}</p>
              {b.points && (
                <ul className="mt-4 grid gap-1.5 text-sm">
                  {b.points.map((p) => (
                    <li key={p} className="flex gap-2"><Check className="mt-0.5 size-4 shrink-0 text-success" /> {p}</li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </Reveal>
      ))}
    </div>
  );
}

export function PlatformPage() {
  const { t } = useTranslation();
  return (
    <>
      <PageHero eyebrow={t('public.nav.platform')} title={t('platformPage.title')} subtitle={t('platformPage.subtitle')} />
      <BlockGrid blocks={t('platformPage.blocks', { returnObjects: true }) as Block[]} />
    </>
  );
}

export function FeaturesPage() {
  const { t } = useTranslation();
  return (
    <>
      <PageHero eyebrow={t('public.nav.features')} title={t('featuresPage.title')} subtitle={t('featuresPage.subtitle')} />
      <BlockGrid blocks={t('featuresPage.blocks', { returnObjects: true }) as Block[]} />
    </>
  );
}

export function AiWorkforcePublicPage() {
  const { t } = useTranslation();
  const categories = t('workforcePage.categories', { returnObjects: true }) as Array<{ title: string; roles: string[] }>;
  return (
    <>
      <PageHero eyebrow={t('public.nav.aiWorkforce')} title={t('workforcePage.title')} subtitle={t('workforcePage.subtitle')} />
      <div className="mx-auto max-w-7xl px-4 py-16 sm:px-6">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {categories.map((c, i) => (
            <Reveal key={c.title} delay={(i % 4) * 0.04}>
              <Card className="h-full">
                <CardContent className="p-5">
                  <p className="text-sm font-semibold">{c.title}</p>
                  <ul className="mt-3 grid gap-2">
                    {c.roles.map((r) => (
                      <li key={r} className="flex items-center gap-2 text-sm text-muted-foreground"><Bot className="size-4 text-primary" /> {r}</li>
                    ))}
                  </ul>
                </CardContent>
              </Card>
            </Reveal>
          ))}
        </div>
        <div className="mt-16">
          <SectionTitle title={t('workforcePage.autonomyTitle')} subtitle={t('workforcePage.autonomySubtitle')} />
          <div className="mt-10 grid gap-4 md:grid-cols-4">
            {(t('workforcePage.autonomy', { returnObjects: true }) as Block[]).map((b, i) => (
              <Card key={b.title}>
                <CardContent className="p-5">
                  <Badge tone="primary">{i + 1}</Badge>
                  <p className="mt-3 font-semibold">{b.title}</p>
                  <p className="mt-1 text-sm text-muted-foreground">{b.body}</p>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}

/** Human-readable name of a Claude model id (e.g. claude-sonnet-5 → Claude Sonnet 5). */
export function modelLabel(id: string | undefined): string {
  if (!id) return '—';
  return id
    .replace(/^claude-/, 'Claude ')
    .replace(/-(\d+)-(\d+)$/, ' $1.$2')
    .replace(/-(\d+)$/, ' $1')
    .replace(/(^|\s)([a-z])/g, (_m, s: string, c: string) => s + c.toUpperCase());
}

export function PlanCards({ plans, onSelect, currentPlan, busyPlan, actionLabel }: { plans: PublicPlan[]; onSelect?: (code: string) => void; currentPlan?: string | null; busyPlan?: string | null; actionLabel?: string }) {
  const { t } = useTranslation();
  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
      {plans.map((p) => {
        const e = p.entitlements;
        const limit = (v: number | null) => (v === null ? t('pricing.unlimited') : formatNumber(v));
        const rows = [
          [t('pricing.humans'), limit(e.human_members)],
          [t('pricing.aiEmployees'), limit(e.ai_employees)],
          [t('pricing.projects'), limit(e.active_projects)],
          [t('pricing.executions'), limit(e.ai_executions_per_year)],
          [t('pricing.storage'), e.storage_bytes === null ? t('pricing.unlimited') : formatBytes(e.storage_bytes)],
          [t('pricing.aiModel'), modelLabel(p.ai_models?.[0])],
        ];
        return (
          <div key={p.code} className={cn('relative flex flex-col rounded-2xl border bg-card p-6 shadow-xs', p.is_popular && 'border-primary shadow-lg shadow-primary/10 ring-1 ring-primary')}>
            {p.is_popular && <Badge tone="primary" className="absolute -top-3 start-6 bg-primary text-primary-foreground"><Crown /> {t('pricing.popular')}</Badge>}
            <p className="font-semibold">{t(`plans.${p.code}`, p.name_en)}</p>
            <div className="mt-4 flex items-baseline gap-1">
              {p.is_custom ? <span className="text-3xl font-semibold">{t('pricing.custom')}</span> : <><span className="text-4xl font-semibold tabular-nums tracking-tight">{formatSar(p.price_halalas)}</span><span className="text-sm text-muted-foreground">/{t('pricing.year')}</span></>}
            </div>
            <p className="mt-1 text-xs text-muted-foreground">{t('pricing.annualOnly')}</p>
            <ul className="mt-6 grid gap-2 text-sm">
              {rows.map(([k, v]) => (
                <li key={k} className="flex justify-between gap-2"><span className="text-muted-foreground">{k}</span><span className="font-medium tabular-nums">{v}</span></li>
              ))}
            </ul>
            <ul className="mt-5 grid flex-1 content-start gap-1.5 border-t pt-5 text-sm">
              {(['full_memory', 'knowledge', 'decisions', 'meetings', 'approvals', 'agent_orchestration', 'advanced_analytics', 'advanced_permissions', 'audit_logs', 'priority_support'] as const).map((f) => {
                const has = e.features.includes(f);
                return (
                  <li key={f} className={cn('flex items-center gap-2', !has && 'text-muted-foreground/60')}>
                    {has ? <Check className="size-4 text-success" /> : <Minus className="size-4" />} {t(`features.${f}`)}
                  </li>
                );
              })}
            </ul>
            <div className="mt-6">
              {p.is_custom ? (
                <Button asChild variant="outline" className="w-full"><Link to="/enterprise">{t('pricing.requestCustom')}</Link></Button>
              ) : onSelect ? (
                <Button className="w-full" variant={p.is_popular ? 'brand' : 'default'} loading={busyPlan === p.code} onClick={() => onSelect(p.code)}>
                  {currentPlan === p.code ? t('billing.renew') : (actionLabel ?? t('billing.subscribe'))}
                </Button>
              ) : (
                <Button asChild className="w-full" variant={p.is_popular ? 'brand' : 'default'}><Link to="/signup">{t('public.getStarted')}</Link></Button>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function PricingPage() {
  const { t } = useTranslation();
  const { data, isLoading } = useQuery({ queryKey: ['plans'], queryFn: () => api<PublicPlan[]>('/plans', { auth: false, org: false }) });
  return (
    <>
      <PageHero eyebrow={t('public.nav.pricing')} title={t('pricing.title')} subtitle={t('pricing.subtitle')} />
      <div className="mx-auto max-w-7xl px-4 py-16 sm:px-6">
        {isLoading ? <LoadingBlock /> : data ? <PlanCards plans={data} /> : <p className="text-center text-muted-foreground">{t('errors.network_error')}</p>}
        <div className="mx-auto mt-12 max-w-3xl rounded-2xl border bg-card p-6 text-sm text-muted-foreground">
          <p className="font-medium text-foreground">{t('pricing.notesTitle')}</p>
          <ul className="mt-3 grid list-disc gap-1.5 ps-5">
            {(t('pricing.notes', { returnObjects: true }) as string[]).map((n) => <li key={n}>{n}</li>)}
          </ul>
        </div>
      </div>
    </>
  );
}

export function LegalPage({ kind }: { kind: 'privacy' | 'terms' }) {
  const { t } = useTranslation();
  const sections = t(`public.${kind}.sections`, { returnObjects: true }) as Array<{ title: string; body: string }>;
  return (
    <div className="mx-auto max-w-3xl px-4 py-16 sm:px-6">
      <h1 className="text-3xl font-semibold tracking-tight">{t(`public.${kind}.title`)}</h1>
      <p className="mt-2 text-sm text-muted-foreground">{t('public.legalUpdated')}</p>
      <div className="mt-8 grid gap-6">
        {sections.map((s) => (
          <section key={s.title}>
            <h2 className="text-lg font-semibold">{s.title}</h2>
            <p className="mt-2 leading-relaxed text-muted-foreground">{s.body}</p>
          </section>
        ))}
      </div>
    </div>
  );
}

export function NotFoundPage() {
  const { t } = useTranslation();
  return (
    <div className="flex min-h-[60dvh] flex-col items-center justify-center px-4 text-center">
      <p className="brand-text text-7xl font-bold">404</p>
      <h1 className="mt-4 text-2xl font-semibold">{t('notFound.title')}</h1>
      <p className="mt-2 text-muted-foreground">{t('notFound.body')}</p>
      <Button asChild className="mt-6"><Link to="/">{t('notFound.home')}</Link></Button>
    </div>
  );
}

export { PageHero };
