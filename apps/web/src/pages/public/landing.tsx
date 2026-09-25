import { Badge, Button, cn } from '@nexus/ui';
import { motion } from 'framer-motion';
import { Activity, ArrowLeft, ArrowRight, Bot, CheckCircle2, Cpu, FileText, FolderLock, Lock, ShieldCheck, Sparkles, Users } from 'lucide-react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';

export function Reveal({ children, delay = 0, className }: { children: ReactNode; delay?: number; className?: string }) {
  return (
    <motion.div initial={{ opacity: 0, y: 16 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, margin: '-60px' }} transition={{ duration: 0.5, delay }} className={className}>
      {children}
    </motion.div>
  );
}

export function SectionTitle({ eyebrow, title, subtitle, center = true }: { eyebrow?: string; title: string; subtitle?: string; center?: boolean }) {
  return (
    <div className={cn('max-w-3xl', center && 'mx-auto text-center')}>
      {eyebrow && <p className="text-sm font-medium text-primary">{eyebrow}</p>}
      <h2 className="mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">{title}</h2>
      {subtitle && <p className="mt-4 text-base leading-relaxed text-muted-foreground">{subtitle}</p>}
    </div>
  );
}

function ProductPreview() {
  const { t } = useTranslation();
  const rows = t('landing.preview.rows', { returnObjects: true }) as Array<{ name: string; role: string; step: string; status: string }>;
  return (
    <div className="relative mx-auto mt-16 max-w-5xl">
      <div className="absolute -inset-x-10 -top-10 bottom-0 -z-10 rounded-[3rem] bg-gradient-to-b from-primary/15 via-brand-2/10 to-transparent blur-3xl" />
      <div className="overflow-hidden rounded-2xl border bg-card shadow-2xl shadow-primary/10">
        <div className="flex items-center gap-2 border-b bg-surface-2/60 px-4 py-3">
          <span className="size-2.5 rounded-full bg-destructive/60" />
          <span className="size-2.5 rounded-full bg-warning/70" />
          <span className="size-2.5 rounded-full bg-success/70" />
          <span className="ms-3 flex items-center gap-2 text-xs text-muted-foreground"><Activity className="size-3.5" /> {t('landing.preview.title')}</span>
          <Badge tone="info" className="ms-auto">{t('landing.preview.illustration')}</Badge>
        </div>
        <div className="grid gap-px bg-border md:grid-cols-3">
          <div className="bg-card p-5 md:col-span-2">
            <div className="grid gap-3">
              {rows.map((r, i) => (
                <div key={i} className="flex items-center gap-3 rounded-xl border bg-surface p-3">
                  <div className="flex size-9 items-center justify-center rounded-lg brand-gradient text-white"><Bot className="size-4" /></div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium">{r.name} <span className="font-normal text-muted-foreground">· {r.role}</span></p>
                    <p className="truncate text-xs text-muted-foreground">{r.step}</p>
                  </div>
                  <Badge tone={i === 2 ? 'warning' : 'primary'}>{r.status}</Badge>
                </div>
              ))}
            </div>
          </div>
          <div className="bg-card p-5">
            <p className="text-xs font-medium text-muted-foreground">{t('landing.preview.timeline')}</p>
            <ol className="mt-3 grid gap-3 border-s ps-4 text-xs">
              {(t('landing.preview.steps', { returnObjects: true }) as string[]).map((s, i) => (
                <li key={i} className="relative">
                  <span className="absolute -start-[21px] top-1 size-2 rounded-full bg-primary" />
                  <span className="font-mono text-muted-foreground">09:{String(i * 3 + 1).padStart(2, '0')}</span> — {s}
                </li>
              ))}
            </ol>
          </div>
        </div>
      </div>
    </div>
  );
}

export function LandingPage() {
  const { t, i18n } = useTranslation();
  const Arrow = i18n.language === 'ar' ? ArrowLeft : ArrowRight;
  const pillars = [
    { icon: Bot, key: 'employees' },
    { icon: Cpu, key: 'computers' },
    { icon: Activity, key: 'operations' },
    { icon: FolderLock, key: 'files' },
    { icon: Sparkles, key: 'nexusAi' },
    { icon: Users, key: 'collaboration' },
  ];
  return (
    <>
      <section className="relative overflow-hidden">
        <div className="grid-bg absolute inset-0 -z-10 [mask-image:radial-gradient(ellipse_at_top,black,transparent_70%)]" />
        <div className="mx-auto max-w-7xl px-4 pb-20 pt-16 sm:px-6 sm:pt-24">
          <Reveal className="mx-auto max-w-4xl text-center">
            <Badge tone="primary" className="mb-6 px-3 py-1 text-xs">🇸🇦 {t('landing.badge')}</Badge>
            <h1 className="text-4xl font-semibold leading-tight tracking-tight sm:text-6xl">
              {t('landing.titleA')} <span className="brand-text">{t('landing.titleB')}</span>
            </h1>
            <p className="mx-auto mt-6 max-w-2xl text-lg leading-relaxed text-muted-foreground">{t('landing.subtitle')}</p>
            <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
              <Button asChild size="lg" variant="brand"><Link to="/signup">{t('landing.ctaPrimary')} <Arrow /></Link></Button>
              <Button asChild size="lg" variant="outline"><Link to="/platform">{t('landing.ctaSecondary')}</Link></Button>
            </div>
            <p className="mt-4 text-xs text-muted-foreground">{t('landing.ctaNote')}</p>
          </Reveal>
          <ProductPreview />
        </div>
      </section>

      <section className="border-t bg-surface/40 py-20">
        <div className="mx-auto max-w-7xl px-4 sm:px-6">
          <SectionTitle eyebrow={t('landing.pillarsEyebrow')} title={t('landing.pillarsTitle')} subtitle={t('landing.pillarsSubtitle')} />
          <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {pillars.map((p, i) => (
              <Reveal key={p.key} delay={i * 0.05}>
                <div className="h-full rounded-2xl border bg-card p-6 shadow-xs transition-shadow hover:shadow-lg">
                  <div className="flex size-11 items-center justify-center rounded-xl bg-primary/10 text-primary"><p.icon className="size-5" /></div>
                  <h3 className="mt-4 font-semibold">{t(`landing.pillars.${p.key}.title`)}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{t(`landing.pillars.${p.key}.body`)}</p>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      <section className="py-20">
        <div className="mx-auto grid max-w-7xl items-center gap-12 px-4 sm:px-6 lg:grid-cols-2">
          <Reveal>
            <SectionTitle center={false} eyebrow={t('landing.howEyebrow')} title={t('landing.howTitle')} />
            <ol className="mt-8 grid gap-5">
              {(t('landing.howSteps', { returnObjects: true }) as Array<{ title: string; body: string }>).map((s, i) => (
                <li key={i} className="flex gap-4">
                  <span className="flex size-8 shrink-0 items-center justify-center rounded-full border bg-surface text-sm font-semibold">{i + 1}</span>
                  <div>
                    <p className="font-medium">{s.title}</p>
                    <p className="mt-1 text-sm text-muted-foreground">{s.body}</p>
                  </div>
                </li>
              ))}
            </ol>
          </Reveal>
          <Reveal delay={0.1}>
            <div className="rounded-2xl border bg-card p-6 shadow-xl">
              <div className="flex items-center gap-2 text-sm font-medium"><Sparkles className="size-4 text-primary" /> Nexus AI</div>
              <div className="mt-4 grid gap-3 text-sm">
                {(t('landing.chat', { returnObjects: true }) as Array<{ who: 'user' | 'ai'; text: string }>).map((m, i) => (
                  <div key={i} className={cn('max-w-[85%] rounded-2xl px-4 py-2.5', m.who === 'user' ? 'ms-auto bg-primary text-primary-foreground' : 'bg-muted')}>{m.text}</div>
                ))}
              </div>
            </div>
          </Reveal>
        </div>
      </section>

      <section className="border-y bg-surface/40 py-20">
        <div className="mx-auto max-w-7xl px-4 sm:px-6">
          <SectionTitle eyebrow={t('landing.securityEyebrow')} title={t('landing.securityTitle')} subtitle={t('landing.securitySubtitle')} />
          <div className="mt-12 grid gap-4 md:grid-cols-3">
            {(t('landing.securityPoints', { returnObjects: true }) as Array<{ title: string; body: string }>).map((p, i) => (
              <Reveal key={i} delay={i * 0.05}>
                <div className="h-full rounded-2xl border bg-card p-6">
                  {(() => {
                    const Icon = [ShieldCheck, Lock, FileText][i % 3]!;
                    return <Icon className="size-5 text-success" />;
                  })()}
                  <h3 className="mt-3 font-semibold">{p.title}</h3>
                  <p className="mt-2 text-sm text-muted-foreground">{p.body}</p>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      <section className="py-20">
        <div className="mx-auto max-w-5xl px-4 text-center sm:px-6">
          <div className="relative overflow-hidden rounded-3xl brand-gradient px-6 py-14 text-white shadow-2xl">
            <h2 className="text-3xl font-semibold tracking-tight">{t('landing.finalTitle')}</h2>
            <p className="mx-auto mt-3 max-w-xl text-white/85">{t('landing.finalSubtitle')}</p>
            <div className="mt-8 flex flex-wrap justify-center gap-3">
              <Button asChild size="lg" className="bg-white text-foreground hover:bg-white/90"><Link to="/signup">{t('landing.ctaPrimary')}</Link></Button>
              <Button asChild size="lg" variant="outline" className="border-white/40 bg-transparent text-white hover:bg-white/10"><Link to="/pricing">{t('public.nav.pricing')}</Link></Button>
            </div>
            <ul className="mt-8 flex flex-wrap justify-center gap-x-6 gap-y-2 text-sm text-white/85">
              {(t('landing.finalPoints', { returnObjects: true }) as string[]).map((p) => (
                <li key={p} className="flex items-center gap-1.5"><CheckCircle2 className="size-4" /> {p}</li>
              ))}
            </ul>
          </div>
        </div>
      </section>
    </>
  );
}
