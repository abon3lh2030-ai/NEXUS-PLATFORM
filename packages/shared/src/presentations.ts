import { z } from 'zod';

/**
 * Structured deck specification. It is the single source of truth for BOTH the in-app slide
 * preview and the generated .pptx, so what the manager reviews is exactly what is exported.
 * Kinds map to distinct slide layouts (no single template for everything).
 */
const txt = (max: number) => z.string().trim().max(max);
const bullets = z.array(txt(300)).max(8);

export const slideSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('cover'), title: txt(160), subtitle: txt(240), presenter: txt(120) }),
  z.object({ kind: z.literal('agenda'), title: txt(160), items: z.array(txt(160)).max(10) }),
  z.object({
    kind: z.literal('bullets'),
    // Semantic role so the deck can vary layouts/accents: executive summary, problem, opportunity, strategy, product, risks, recommendations, next steps…
    role: z.enum(['executive_summary', 'problem', 'opportunity', 'strategy', 'product', 'market', 'risks', 'recommendations', 'next_steps', 'general']),
    title: txt(160),
    points: bullets,
    note: txt(300),
  }),
  z.object({ kind: z.literal('two_column'), title: txt(160), left_title: txt(80), left_points: bullets, right_title: txt(80), right_points: bullets }),
  z.object({
    kind: z.literal('kpis'),
    title: txt(160),
    metrics: z.array(z.object({ label: txt(60), value: txt(30), detail: txt(120) })).min(1).max(6),
  }),
  z.object({
    kind: z.literal('chart'),
    title: txt(160),
    chart_type: z.enum(['bar', 'line', 'pie']),
    categories: z.array(txt(40)).min(1).max(12),
    series: z.array(z.object({ name: txt(60), values: z.array(z.number().finite()).max(12) })).min(1).max(4),
    caption: txt(240),
  }),
  z.object({
    kind: z.literal('table'),
    title: txt(160),
    headers: z.array(txt(40)).min(1).max(6),
    rows: z.array(z.array(txt(120)).max(6)).max(10),
    caption: txt(240),
  }),
  z.object({
    kind: z.literal('timeline'),
    title: txt(160),
    milestones: z.array(z.object({ date: txt(40), title: txt(80), detail: txt(160) })).min(1).max(7),
  }),
  z.object({ kind: z.literal('quote'), title: txt(160), quote: txt(400), attribution: txt(120) }),
  z.object({ kind: z.literal('closing'), title: txt(160), subtitle: txt(240), contact: txt(160) }),
]);
export type Slide = z.infer<typeof slideSchema>;

export const deckSpecSchema = z.object({
  title: txt(160),
  language: z.enum(['ar', 'en']),
  slides: z.array(slideSchema).min(2).max(25),
});
export type DeckSpec = z.infer<typeof deckSpecSchema>;

export interface DeckBranding {
  companyName: string;
  primaryColor: string; // hex without '#'
  accentColor: string;
  logoPngBase64?: string | null;
}

/** Normalizes chart series so every series has one value per category (pads with 0, trims extras). */
export function normalizeChart<T extends { categories: string[]; series: Array<{ name: string; values: number[] }> }>(c: T): T {
  const n = c.categories.length;
  return { ...c, series: c.series.map((s) => ({ ...s, values: Array.from({ length: n }, (_, i) => s.values[i] ?? 0) })) };
}

export const PRESENTATION_STATUSES = ['draft', 'pending_approval', 'changes_requested', 'final', 'archived'] as const;
export type PresentationStatus = (typeof PRESENTATION_STATUSES)[number];
