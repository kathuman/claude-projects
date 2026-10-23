// The catalog's health: every price check well formed, how much of each vendor's range has been checked and how
// recently, and (with --links) whether every product page and vendor search still answers.
//   node tools/check-catalog.mjs            records and coverage
//   node tools/check-catalog.mjs --links    also follow every link (the weekly job does this)
// Writes Markdown to stdout, and to the GitHub job summary when run in Actions. Exits 1 on a malformed record, or
// with --strict on a broken link too.
import { appendFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { PARTS, VENDORS, offerUrl } from '../src/catalog.js';
import { CHECKS, STALE_DAYS } from '../src/prices.js';

const DATE = /^\d{4}-\d{2}-\d{2}$/;

// Problems with the price-check records themselves.
export function validateChecks(checks = CHECKS, today = new Date()) {
  const errors = [];
  const ids = new Set(PARTS.map((p) => p.id));
  for (const [id, byVendor] of Object.entries(checks)) {
    if (!ids.has(id)) errors.push(`${id}: no such part`);
    for (const [v, c] of Object.entries(byVendor)) {
      const at = `${id} @ ${v}`;
      if (!VENDORS[v]) errors.push(`${at}: no such vendor`);
      if (!DATE.test(c.checked ?? '') || Number.isNaN(Date.parse(c.checked))) errors.push(`${at}: checked must be YYYY-MM-DD`);
      else if (new Date(`${c.checked}T00:00:00Z`) > today) errors.push(`${at}: checked in the future`);
      if (c.gone) {
        if (!c.note) errors.push(`${at}: a dropped offer needs a note saying why`);
        continue;
      }
      if (!(c.price > 0)) errors.push(`${at}: price must be positive`);
      if (!/^https:\/\//.test(c.url ?? '')) errors.push(`${at}: url must be an https product page`);
      if (!c.listed) errors.push(`${at}: listed (the shop's product name) is missing`);
    }
  }
  for (const p of PARTS) if (!p.offers.length && !p.kit) errors.push(`${p.id}: no offer left`);
  return errors;
}

export function coverage(today = new Date()) {
  return Object.entries(VENDORS).map(([id, v]) => {
    const offers = PARTS.flatMap((p) => p.offers.filter((o) => o.vendor === id).map((o) => ({ p, o })));
    const checked = offers.filter(({ o }) => o.status === 'checked');
    const stale = checked.filter(({ o }) => (today - new Date(`${o.checked}T00:00:00Z`)) / 86400000 > STALE_DAYS);
    return { id, name: v.name, offers: offers.length, checked: checked.length, stale: stale.map(({ p }) => p.id) };
  });
}

async function probe(url) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 20000);
  try {
    const r = await fetch(url, { redirect: 'follow', signal: ctl.signal, headers: { 'user-agent': 'Mozilla/5.0 (robot-configurator catalog check)' } });
    return { status: r.status };
  } catch (e) {
    return { status: 0, error: e.name === 'AbortError' ? 'timeout' : e.message };
  } finally {
    clearTimeout(timer);
  }
}

async function main() {
  const args = process.argv.slice(2);
  const out = [];
  const errors = validateChecks();
  out.push('# Robot Configurator catalog check', '');
  out.push(errors.length ? `**${errors.length} malformed price records:**\n\n${errors.map((e) => `- ${e}`).join('\n')}\n` : 'All price records are well formed.\n');
  out.push('| Vendor | Prices checked | Stale (> ' + STALE_DAYS + ' days) |', '|---|---|---|');
  for (const c of coverage()) out.push(`| ${c.name} | ${c.checked} / ${c.offers} | ${c.stale.length ? c.stale.join(', ') : '–'} |`);
  out.push('');
  let broken = [];
  if (args.includes('--links')) {
    const urls = new Map();
    for (const p of PARTS) for (const o of p.offers) if (o.status === 'checked') urls.set(o.url, `${p.id} @ ${o.vendor}`);
    for (const [id, v] of Object.entries(VENDORS)) urls.set(v.search.replace('{q}', 'arduino'), `${id} search`);
    const list = [...urls];
    const results = [];
    for (let i = 0; i < list.length; i += 4) {
      results.push(...await Promise.all(list.slice(i, i + 4).map(async ([url, what]) => ({ url, what, ...await probe(url) }))));
    }
    broken = results.filter((r) => r.status === 0 || r.status >= 400);
    out.push(`Followed ${results.length} links: ${results.length - broken.length} answered.`, '');
    if (broken.length) {
      out.push('| What | Status | Link |', '|---|---|---|');
      for (const b of broken) out.push(`| ${b.what} | ${b.status || b.error} | ${b.url} |`);
      out.push('', 'A 403 or 429 is often a shop turning away robots rather than a missing page: open the link to see.');
    }
  }
  const md = out.join('\n');
  console.log(md);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, md + '\n');
  if (errors.length || (args.includes('--strict') && broken.length)) process.exit(1);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) await main();
