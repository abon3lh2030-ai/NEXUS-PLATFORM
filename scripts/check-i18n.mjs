#!/usr/bin/env node
/**
 * Verifies that every static translation key used in apps/web/src exists in BOTH ar and en,
 * and that ar/en have identical key sets. Dynamic keys (t(`status.${x}`)) are checked by
 * prefix existence. Usage: node scripts/check-i18n.mjs [--list]
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const root = new URL('..', import.meta.url).pathname;
const src = join(root, 'apps/web/src');

function walk(dir) {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : /\.(tsx?)$/.test(f) && !p.includes('/i18n/') ? [p] : [];
  });
}

const staticKeys = new Set();
const dynamicPrefixes = new Set();
for (const file of walk(src)) {
  const code = readFileSync(file, 'utf8');
  for (const m of code.matchAll(/\bt\(\s*'([a-zA-Z0-9_.]+)'/g)) staticKeys.add(m[1]);
  for (const m of code.matchAll(/\bt\(\s*`([a-zA-Z0-9_.]+)\.\$\{/g)) dynamicPrefixes.add(m[1]);
  for (const m of code.matchAll(/\bt\(\s*`([a-zA-Z0-9_.]+)\.\$\{[^}]+\}\.([a-zA-Z0-9_]+)`/g)) dynamicPrefixes.add(`${m[1]}.*.${m[2]}`);
}

if (process.argv.includes('--list')) {
  console.log([...staticKeys].sort().join('\n'));
  console.log('--- dynamic prefixes ---');
  console.log([...dynamicPrefixes].sort().join('\n'));
  process.exit(0);
}

function flatten(obj, prefix = '', out = new Map()) {
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object' && !Array.isArray(v)) flatten(v, key, out);
    else out.set(key, v);
  }
  return out;
}

async function load(name) {
  // Node >= 22.18 / 24 strips TypeScript types natively; the locale files are plain object literals.
  const mod = await import(pathToFileURL(join(src, 'i18n', `${name}.ts`)).href);
  return mod[name];
}

const [ar, en] = await Promise.all([load('ar'), load('en')]);
const far = flatten(ar);
const fen = flatten(en);
const has = (map, key) => map.has(key) || [...map.keys()].some((k) => k.startsWith(`${key}.`));
const problems = [];

for (const key of [...staticKeys].sort()) {
  if (!has(far, key)) problems.push(`missing in ar: ${key}`);
  if (!has(fen, key)) problems.push(`missing in en: ${key}`);
}
for (const p of [...dynamicPrefixes].sort()) {
  const prefix = p.split('.*')[0];
  if (![...far.keys()].some((k) => k.startsWith(`${prefix}.`))) problems.push(`missing dynamic prefix in ar: ${p}`);
  if (![...fen.keys()].some((k) => k.startsWith(`${prefix}.`))) problems.push(`missing dynamic prefix in en: ${p}`);
}
for (const k of far.keys()) if (!fen.has(k)) problems.push(`only in ar: ${k}`);
for (const k of fen.keys()) if (!far.has(k)) problems.push(`only in en: ${k}`);

if (problems.length) {
  console.error(problems.join('\n'));
  console.error(`\n${problems.length} i18n problem(s)`);
  process.exit(1);
}
console.log(`i18n OK — ${staticKeys.size} static keys, ${dynamicPrefixes.size} dynamic prefixes, ${far.size} entries per locale`);
