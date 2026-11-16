#!/usr/bin/env node
/**
 * Creates / maintains the NEXUS Founder Portal account. Server-side only (uses the service role key
 * from .env); there is no sign-up path for founder accounts anywhere in the app.
 *
 *   node --env-file=.env scripts/founder-account.mjs create   <email> --out <file> [--admin]
 *   node --env-file=.env scripts/founder-account.mjs reset-password <email> --out <file>
 *   node --env-file=.env scripts/founder-account.mjs reset-mfa <email>
 *
 * The initial password is random, is NEVER printed, and is written only to the --out file (mode 600).
 * The founder must replace it on first sign-in (enforced by the API), then enroll two-step verification.
 * `reset-mfa` removes the authenticator (e.g. a lost phone) so a new one can be enrolled at next sign-in.
 */
import { randomBytes } from 'node:crypto';
import { writeFileSync, chmodSync, existsSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';

const [cmd, emailArg, ...rest] = process.argv.slice(2);
const flag = (name) => rest.includes(name);
const opt = (name) => {
  const i = rest.indexOf(name);
  return i >= 0 ? rest[i + 1] : undefined;
};
const die = (msg) => {
  console.error(msg);
  process.exit(1);
};

if (!['create', 'reset-password', 'reset-mfa'].includes(cmd ?? '') || !emailArg) die('usage: founder-account.mjs create|reset-password|reset-mfa <email> [--out file] [--admin]');
const email = emailArg.trim().toLowerCase();
const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, PUBLIC_APP_URL } = process.env;
if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) die('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing (run with --env-file=.env)');
const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });

function strongPassword() {
  // 24 chars from a 56-symbol alphabet (~139 bits), always with upper, lower, digit and symbol.
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789-_!@#%';
  for (;;) {
    const bytes = randomBytes(24);
    const p = [...bytes].map((b) => alphabet[b % alphabet.length]).join('');
    if (/[A-Z]/.test(p) && /[a-z]/.test(p) && /\d/.test(p) && /[-_!@#%]/.test(p)) return p;
  }
}

async function findUser() {
  for (let page = 1; page < 50; page++) {
    const { data, error } = await db.auth.admin.listUsers({ page, perPage: 200 });
    if (error) die(`listUsers failed: ${error.message}`);
    const u = data.users.find((x) => x.email?.toLowerCase() === email);
    if (u) return u;
    if (data.users.length < 200) return null;
  }
  return null;
}

function writeSecret(password) {
  const out = opt('--out');
  if (!out) die('--out <file> is required (the password is never printed)');
  if (existsSync(out)) die(`${out} already exists — choose a new file`);
  const url = `${(PUBLIC_APP_URL ?? 'http://localhost:5173').replace(/\/$/, '')}/founder/login`;
  writeFileSync(out, `NEXUS Founder Portal — initial sign-in (delete this file after your first sign-in)\n\nLink:     ${url}\nEmail:    ${email}\nPassword: ${password}\n\nOn first sign-in you must choose a new password, then scan a QR code with an authenticator app.\n`, { mode: 0o600 });
  chmodSync(out, 0o600);
  console.log(`initial sign-in details written to ${out} (mode 600)`);
}

if (cmd === 'create') {
  let user = await findUser();
  const password = strongPassword();
  if (user) {
    const { data: isFounder } = await db.from('founder_accounts').select('user_id').eq('user_id', user.id).maybeSingle();
    if (isFounder) die('this email already has a founder account — use reset-password');
    const { data: memberships } = await db.from('organization_members').select('id').eq('user_id', user.id).limit(1);
    if (memberships?.length) die('this email belongs to a company account — the founder account must be separate');
    const { error } = await db.auth.admin.updateUserById(user.id, { password, email_confirm: true });
    if (error) die(`update failed: ${error.message}`);
  } else {
    const { data, error } = await db.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { full_name: 'NEXUS Founder', locale: 'ar' } });
    if (error) die(`create failed: ${error.message}`);
    user = data.user;
  }
  const { error: fe } = await db.from('founder_accounts').insert({ user_id: user.id, display_name: 'NEXUS Founder', must_change_password: true });
  if (fe) die(`founder_accounts insert failed: ${fe.message}`);
  await db.from('founder_audit_log').insert({ user_id: user.id, action: 'account.created', entity: 'account', summary: `Founder account created by server script for ${email}` });
  if (flag('--admin')) {
    const { error: ae } = await db.from('platform_admins').upsert({ user_id: user.id, granted_by: 'founder-script' });
    if (ae) die(`platform_admins failed: ${ae.message}`);
    console.log('platform admin (/admin) granted');
  }
  writeSecret(password);
  console.log(`founder account ready: ${email}`);
} else {
  const user = await findUser();
  if (!user) die('no such user');
  const { data: acc } = await db.from('founder_accounts').select('user_id').eq('user_id', user.id).maybeSingle();
  if (!acc) die('not a founder account');
  if (cmd === 'reset-password') {
    const password = strongPassword();
    const { error } = await db.auth.admin.updateUserById(user.id, { password });
    if (error) die(`update failed: ${error.message}`);
    await db.from('founder_accounts').update({ must_change_password: true }).eq('user_id', user.id);
    await db.from('founder_audit_log').insert({ user_id: user.id, action: 'password.reset_by_script', entity: 'account', summary: 'Temporary password issued by server script' });
    writeSecret(password);
  } else {
    const { data, error } = await db.auth.admin.mfa.listFactors({ userId: user.id });
    if (error) die(`listFactors failed: ${error.message}`);
    for (const f of data.factors) await db.auth.admin.mfa.deleteFactor({ userId: user.id, id: f.id });
    await db.from('founder_audit_log').insert({ user_id: user.id, action: 'mfa.reset_by_script', entity: 'account', summary: `${data.factors.length} authenticator(s) removed` });
    console.log(`removed ${data.factors.length} authenticator(s); a new one is enrolled at next sign-in`);
  }
}
