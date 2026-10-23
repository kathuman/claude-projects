// Drives the page in a real browser: every robot type, the chart pick, part swaps, the comparison, every tab, the
// downloads, every language (no English left behind), the About page, phone width and the theme.
//   python -m http.server 8766   (from the repository root)
//   PW=<path to playwright or playwright-core> [CHROME=<chrome.exe>] [URL=…] node robot-configurator/tools/browser-check.cjs
const { chromium } = require(process.env.PW || 'playwright');

const BASE = process.env.URL || 'http://localhost:8766/robot-configurator/';
let pass = 0;
const fails = [];
const check = (ok, what) => { if (ok) pass++; else fails.push(what); };

async function ready(p) {
  await p.waitForFunction(() => document.querySelector('#results .proposal, #results h2'), null, { timeout: 60000 });
}

(async () => {
  const browser = await chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : {});
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true, locale: 'en-GB' });
  const p = await ctx.newPage();
  const errors = [];
  p.on('pageerror', (e) => errors.push(e.message));
  p.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

  // ---- rover: proposals, chart, pick, compare, swap, tabs
  await p.goto(`${BASE}?lang=en`);
  await ready(p);
  const kinds = await p.$$eval('.proposal .kind', (els) => els.map((e) => e.textContent));
  check(kinds.length >= 2, `rover: at least two proposals (${kinds})`);
  check(kinds.some((k) => k.includes('Most headroom')) && !kinds.some((k) => k.includes('Lowest cost · Most headroom')), 'rover: most headroom is its own card');
  check(/\d+ ms|\d+[.,]\d s/.test(await p.textContent('.summary-line')), 'summary shows the search time');
  const pts = await p.$$eval('#chart .hit', (els) => els.length);
  check(pts > 50, `chart has points (${pts})`);
  const props = await p.$$eval('#chart .prop-label', (els) => els.map((e) => e.textContent));
  check(props.length >= 2, `chart labels the proposals (${props})`);
  // a frontier point that is not a proposal → your pick
  const idx = await p.evaluate(() => {
    const ringed = new Set([...document.querySelectorAll('#chart .prop-ring')].map((r) => `${r.getAttribute('cx')},${r.getAttribute('cy')}`));
    const hit = [...document.querySelectorAll('#chart .hit')].find((h) => h.getAttribute('r') === '9' && !ringed.has(`${h.getAttribute('cx')},${h.getAttribute('cy')}`));
    return hit?.dataset.i;
  });
  await p.click(`#chart .hit[data-i="${idx}"]`, { force: true });
  await p.waitForFunction(() => [...document.querySelectorAll('.proposal .kind')].some((k) => k.textContent.includes('Your pick')), null, { timeout: 15000 });
  check(true, 'chart click adds your pick');
  await p.click('.proposal .drop');
  check(!(await p.$$eval('.proposal .kind', (els) => els.some((e) => e.textContent.includes('Your pick')))), 'your pick can be removed');
  await p.click('#cmpBtn');
  check((await p.$$('tr.diff')).length > 0, 'comparison highlights differing parts');
  await p.click('#cmpBtn');
  // swap the battery
  await p.click('[data-swap="battery"]');
  await p.waitForSelector('.swap table', { timeout: 15000 });
  const swapRows = await p.$$eval('.swap tr', (els) => els.map((e) => e.textContent));
  check(swapRows.length > 0 && swapRows.every((r) => r.includes('✗') || /Headroom/.test(r)), 'swap lists each alternative with its headroom or the check that stops it');
  const use = await p.$('.swap [data-use]');
  check(!!use, 'swap offers a working alternative');
  if (use) {
    await use.click();
    await p.waitForFunction(() => [...document.querySelectorAll('.proposal .kind')].some((k) => k.textContent.includes('Your pick')), null, { timeout: 15000 });
    check(true, 'using a swap adds your pick');
  }
  for (const [tab, sel] of [['drawing', 'svg.drawing'], ['budget', 'tr.total'], ['build', 'ol.steps > li'], ['wiring', 'svg.diagram'], ['programs', 'pre.code'], ['method', 'dl.kv'], ['overview', '.tiles']]) {
    await p.click(`[data-tab="${tab}"]`);
    check(!!(await p.$(sel)), `tab ${tab} renders`);
  }
  // the build pack: every section assembled for printing (print itself is stubbed)
  await p.evaluate(() => { window.print = () => {}; });
  await p.click('#packBtn');
  check((await p.$$('#pack .pack-sec')).length === 5 && !!(await p.$('#pack svg.drawing')), 'build pack has its five sections and the drawing');
  await p.evaluate(() => document.documentElement.classList.remove('print-pack'));
  await p.click('[data-tab="programs"]');
  const [zip] = await Promise.all([p.waitForEvent('download'), p.click('#zip')]);
  check(zip.suggestedFilename() === 'robot-programs.zip', 'programs download as a zip');
  await p.click('[data-tab="budget"]');
  const [csv] = await Promise.all([p.waitForEvent('download'), p.click('#csv')]);
  check(csv.suggestedFilename() === 'robot-budget.csv', 'budget downloads as CSV');

  // ---- arm and rover + arm
  for (const type of ['arm', 'mobile']) {
    await p.click(`.types input[value="${type}"]`);
    await p.click('#go');
    await p.waitForFunction(() => !document.querySelector('#go').disabled, null, { timeout: 120000 });
    check((await p.$$('.proposal')).length >= 1, `${type}: proposals`);
    await p.click('[data-tab="drawing"]');
    check(!!(await p.$('svg.drawing')), `${type}: drawing`);
    check(!!(await p.$('#chart svg')), `${type}: chart`);
  }

  // ---- an impossible request is explained
  await p.click('.types input[value="rover"]');
  await p.fill('input[name=payload]', '20');
  await p.fill('input[name=slope]', '30');
  await p.click('#go');
  await p.waitForFunction(() => !document.querySelector('#go').disabled, null, { timeout: 120000 });
  check((await p.textContent('#results')).includes('What would work'), 'infeasible request says what would work');

  // ---- theme
  const before = await p.evaluate(() => document.documentElement.dataset.theme || 'dark');
  await p.click('#theme');
  check((await p.evaluate(() => document.documentElement.dataset.theme)) !== before, 'theme toggles');

  // ---- every language: the page and the results translated, no English left in the visible text
  const ENGLISH = ['Find designs', 'Lowest cost', 'Design & checks', 'Cost against headroom', 'Engineering checks', 'Try another part', 'Where you buy'];
  for (const lang of ['da', 'sv', 'nb', 'es']) {
    await p.goto(`${BASE}?lang=${lang}`);
    await ready(p);
    await p.waitForSelector('.proposal');
    const text = await p.evaluate(() => document.body.innerText);
    const left = ENGLISH.filter((s) => text.includes(s));
    check(left.length === 0, `${lang}: no English left (${left})`);
    check((await p.evaluate(() => document.documentElement.lang)) === lang, `${lang}: html lang set`);
    for (const tab of ['budget', 'build', 'wiring', 'method']) {
      await p.click(`[data-tab="${tab}"]`);
      const body = await p.textContent('#tabBody');
      check(!/\b(Total incl\. VAT|Check the delivery|Ground rail|How a design is found)\b/.test(body), `${lang}: tab ${tab} translated`);
    }
    await p.goto(`${BASE}about.html?lang=${lang}`);
    check(!(await p.evaluate(() => document.body.innerText)).includes('What it does'), `${lang}: About page translated`);
  }

  // ---- phone width
  await p.goto(`${BASE}?lang=en`);
  await ready(p);
  await p.setViewportSize({ width: 390, height: 844 });
  await p.waitForTimeout(300);
  check((await p.evaluate(() => document.documentElement.scrollWidth)) <= 390, 'no sideways scroll at phone width');

  check(errors.length === 0, `no console errors (${errors.slice(0, 3)})`);
  await browser.close();
  console.log(`${pass}/${pass + fails.length} browser checks passed`);
  for (const f of fails) console.log(`  FAIL ${f}`);
  process.exit(fails.length ? 1 : 0);
})();
