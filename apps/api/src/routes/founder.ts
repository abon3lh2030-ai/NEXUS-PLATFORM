import { createClient } from '@supabase/supabase-js';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { AppError, badRequest, notFound, parse } from '../lib/errors.js';
import { founderGuard, founderOf } from '../plugins/founder-guard.js';
import type { Services } from '../services/container.js';
import { COLLECTIONS, isCollection, type CollectionName } from '../services/founder/collections.js';
import { buildPdf, buildXlsx } from '../services/founder/export.js';
import { idOf } from './helpers.js';

const SETTING_KEYS = ['launch_date', 'opening_cash_balance', 'funding_target', 'usd_to_sar', 'reference_plan_price', 'ai_cost_cap_per_company', 'ai_cost_cap_pct', 'simulator_defaults', 'plan_approved_on'] as const;
const settingValue: Record<(typeof SETTING_KEYS)[number], z.ZodType> = {
  launch_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
  plan_approved_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
  opening_cash_balance: z.number().min(-1e12).max(1e12),
  funding_target: z.number().min(0).max(1e13).nullable(),
  usd_to_sar: z.number().positive().max(100),
  reference_plan_price: z.number().min(0).max(1e9),
  ai_cost_cap_per_company: z.number().min(0).max(1e9),
  ai_cost_cap_pct: z.number().min(0).max(100),
  simulator_defaults: z.record(z.string().max(60), z.number().min(0).max(1e13)),
};

/** At least 12 characters with letters and digits. */
const strongPassword = z.string().min(12).max(72).regex(/\p{L}/u).regex(/\d/);

const exportSchema = z.object({
  format: z.enum(['xlsx', 'pdf']),
  title: z.string().trim().min(1).max(200),
  locale: z.enum(['ar', 'en']).default('ar'),
  sheets: z.array(z.object({
    title: z.string().trim().min(1).max(120),
    columns: z.array(z.object({ key: z.string().max(60), label: z.string().max(120) })).min(1).max(30),
    rows: z.array(z.record(z.string().max(60), z.union([z.string().max(4000), z.number(), z.boolean(), z.null()]))).max(5000),
  })).min(1).max(12),
});

function collectionOf(params: unknown): CollectionName {
  const { col } = parse(z.object({ col: z.string().max(40) }), params);
  if (!isCollection(col)) throw notFound('route_not_found');
  return col;
}

export async function founderRoutes(app: FastifyInstance, s: Services) {
  /* Session status — the only routes reachable before MFA / before the initial password is replaced. */
  app.register(async (pre) => {
    pre.addHook('preHandler', founderGuard(s, { allowAal1: true, allowInitialPassword: true }));
    pre.get('/founder/session', async (req) => {
      const f = founderOf(req);
      const acc = await s.founder.account(f.userId);
      return { email: f.email, aal: f.aal, must_change_password: f.mustChangePassword, display_name: acc?.display_name ?? null, last_login_at: acc?.last_login_at ?? null, password_changed_at: acc?.password_changed_at ?? null };
    });
  });

  app.register(async (pw) => {
    pw.addHook('preHandler', founderGuard(s, { allowInitialPassword: true }));
    pw.post('/founder/password', { config: { rateLimit: { max: 5, timeWindow: '15 minutes' } } }, async (req) => {
      const f = founderOf(req);
      const body = parse(z.object({ current_password: z.string().min(1).max(200), new_password: strongPassword }), req.body);
      if (body.current_password === body.new_password) throw badRequest('password_unchanged');
      if (!f.email) throw badRequest('no_email');
      // Re-check the current password with a throwaway session, then revoke that session.
      const anon = createClient(s.env.SUPABASE_URL, s.env.SUPABASE_ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
      const { data: check, error } = await anon.auth.signInWithPassword({ email: f.email, password: body.current_password });
      if (error || !check.session) {
        await s.founder.audit(f, 'password.change_failed', 'account', null, 'كلمة المرور الحالية غير صحيحة');
        throw new AppError(400, 'current_password_invalid');
      }
      await s.db.auth.admin.signOut(check.session.access_token, 'local').catch(() => undefined);
      const { error: upd } = await s.db.auth.admin.updateUserById(f.userId, { password: body.new_password });
      if (upd) throw new AppError(400, 'password_rejected', upd.message);
      await s.db.from('founder_accounts').update({ must_change_password: false, password_changed_at: new Date().toISOString() }).eq('user_id', f.userId);
      await s.founder.audit(f, 'password.changed', 'account', null, 'تغيير كلمة المرور');
      return { ok: true };
    });
  });

  /* Everything else: founder + MFA + password already changed. */
  app.register(async (r) => {
    r.addHook('preHandler', founderGuard(s));

    r.get('/founder/overview', async () => s.founder.overview());
    r.get('/founder/finance', async () => s.founder.financeSummary());
    r.get('/founder/sales', async () => s.founder.salesSummary());
    r.get('/founder/development', async () => s.founder.developmentSummary());
    r.get('/founder/strategy', async () => s.founder.goalsSummary());
    r.get('/founder/technology', async () => s.founder.technologySummary());
    r.get('/founder/technology/progress', async () => s.founder.progress());
    r.get('/founder/investors', async () => s.founder.investorsSummary());
    r.get('/founder/marketing', async () => s.founder.marketingSummary());
    r.get('/founder/team', async () => s.founder.teamSummary());

    r.get('/founder/settings', async () => s.founder.settings());
    r.put('/founder/settings/:key', async (req) => {
      const { key } = parse(z.object({ key: z.enum(SETTING_KEYS) }), req.params);
      const { value } = parse(z.object({ value: settingValue[key] }), req.body);
      return s.founder.setSetting(founderOf(req), key, value);
    });

    r.get('/founder/audit', async (req) => {
      const q = parse(z.object({ entity: z.string().max(40).optional(), entity_id: z.uuid().optional(), limit: z.coerce.number().int().min(1).max(1000).optional() }), req.query);
      return s.founder.auditLog({ entity: q.entity, entityId: q.entity_id, limit: q.limit });
    });

    /* Generic CRUD for every record type (whitelisted in collections.ts). */
    r.get('/founder/c/:col', async (req) => {
      const col = collectionOf(req.params);
      const query = parse(z.record(z.string().max(40), z.string().max(200)), req.query ?? {});
      const { q, ...filters } = query;
      return s.founder.list(col, filters, q);
    });
    r.get('/founder/c/:col/:id', async (req) => s.founder.get(collectionOf(req.params), idOf(req.params)));
    r.post('/founder/c/:col', async (req, reply) => {
      const col = collectionOf(req.params);
      const body = parse(COLLECTIONS[col].schema.strict(), req.body) as Record<string, unknown>;
      return reply.code(201).send(await s.founder.create(founderOf(req), col, body));
    });
    r.patch('/founder/c/:col/:id', async (req) => {
      const col = collectionOf(req.params);
      const body = parse(COLLECTIONS[col].schema.partial().strict(), req.body) as Record<string, unknown>;
      // .partial() keeps defaults; drop keys the caller didn't send.
      const sent = Object.keys((req.body ?? {}) as object);
      const patch = Object.fromEntries(Object.entries(body).filter(([k]) => sent.includes(k)));
      if (!Object.keys(patch).length) throw badRequest('empty_patch');
      return s.founder.update(founderOf(req), col, idOf(req.params), patch);
    });
    r.delete('/founder/c/:col/:id', async (req) => {
      await s.founder.remove(founderOf(req), collectionOf(req.params), idOf(req.params));
      return { ok: true };
    });

    /* Hardware: buying books the expense against the phase budget; installing updates the inventory. */
    r.post('/founder/assets/:id/purchase', async (req) => {
      const body = parse(z.object({ quantity: z.coerce.number().int().min(1).max(10000), unit_price: z.coerce.number().positive().max(1e10), occurred_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), counterparty: z.string().max(200).nullable().optional(), notes: z.string().max(4000).nullable().optional() }), req.body);
      return s.founder.purchaseAsset(founderOf(req), idOf(req.params), body);
    });
    r.post('/founder/assets/:id/install', async (req) => {
      const { quantity } = parse(z.object({ quantity: z.coerce.number().int().min(1).max(10000) }), req.body);
      return s.founder.installAsset(founderOf(req), idOf(req.params), quantity);
    });

    /* Documents: private bucket, signed URLs only. */
    r.post('/founder/documents/upload', async (req) => {
      const body = parse(z.object({ title: z.string().trim().min(1).max(300), category: z.string().max(60).default('other'), file_name: z.string().min(1).max(200), mime_type: z.string().max(120), size_bytes: z.number().int().min(1).max(50 * 1024 * 1024), notes: z.string().max(4000).nullable().optional() }), req.body);
      return s.founder.createUpload(founderOf(req), body);
    });
    r.post('/founder/documents/:id/confirm', async (req) => s.founder.confirmUpload(founderOf(req), idOf(req.params)));
    r.get('/founder/documents/:id/download', async (req) => s.founder.downloadUrl(founderOf(req), idOf(req.params)));

    /* Export: renders what the portal shows as Excel or PDF. */
    r.post('/founder/export', { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, async (req, reply) => {
      const body = parse(exportSchema, req.body);
      const f = founderOf(req);
      const rtl = body.locale === 'ar';
      await s.founder.audit(f, 'export', 'report', null, `${body.format.toUpperCase()}: ${body.title}`);
      const safe = encodeURIComponent(`${body.title}.${body.format}`);
      if (body.format === 'xlsx') {
        const buf = await buildXlsx(body.sheets, rtl);
        return reply.header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet').header('Content-Disposition', `attachment; filename*=UTF-8''${safe}`).header('Cache-Control', 'no-store').send(buf);
      }
      const pdf = await buildPdf(body.title, body.sheets, rtl, rtl ? 'NEXUS Founder Portal — سري' : 'NEXUS Founder Portal — Confidential');
      return reply.header('Content-Type', 'application/pdf').header('Content-Disposition', `attachment; filename*=UTF-8''${safe}`).header('Cache-Control', 'no-store').send(Buffer.from(pdf));
    });
  });
}
