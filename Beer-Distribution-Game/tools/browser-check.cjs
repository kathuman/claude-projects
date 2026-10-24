// Plays Ripple in a real browser: set-up, briefing, turn-by-turn play behind the hand-over screen (with a reload in the
// middle of a week), the debrief with its charts, hover read-out, table view and CSV; then an open-table game and the
// phone layout.
//   python -m http.server 8766   (from the repository root)
//   PW=<path to playwright or playwright-core> [CHROME=<chrome.exe>] [URL=…] [OUT=<folder for screenshots>] node Beer-Distribution-Game/tools/browser-check.cjs
const { chromium } = require(process.env.PW || 'playwright');

const BASE = process.env.URL || 'http://localhost:8766/Beer-Distribution-Game/';
const OUT = process.env.OUT;
let pass = 0;
const fails = [];
const check = (ok, what) => { if (ok) pass++; else fails.push(what); };
const shot = (p, name, full = false) => (OUT ? p.screenshot({ path: `${OUT}/${name}.png`, fullPage: full }) : null);

(async () => {
  const b = await chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : {});
  const errors = [];
  const ctx = await b.newContext({ viewport: { width: 1280, height: 900 }, acceptDownloads: true });
  const p = await ctx.newPage();
  p.on('pageerror', (e) => errors.push(String(e)));
  p.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await p.goto(BASE);
  await p.evaluate(() => localStorage.clear());
  await p.reload();
  await shot(p, 'start', true);

  // ---- set up: a 12-week step game, people on the store and the plant
  await p.fill('#team', 'Blue team');
  await p.click('summary');
  await p.fill('#weeks', '12');
  await p.click('input[name=scenario][value=step]');
  await p.uncheck('input[name=person][value="1"]');
  await p.uncheck('input[name=person][value="2"]');
  await p.click('#setup button[type=submit]');
  await p.waitForSelector('#brief:not([hidden])');
  check((await p.textContent('#briefText')).includes('Regional DC, National DC'), 'briefing names the simulated stages');
  await p.click('#begin');

  // ---- turn by turn
  let order = true;
  for (let w = 1; w <= 12; w++) {
    for (const who of ['Store', 'Plant']) {
      await p.waitForSelector('#cover:not([hidden]) #reveal');
      order = order && (await p.textContent('#cover h2')) === who;
      check(!(await p.$('#stageView .tile')), `week ${w}: nothing of the ${who}'s numbers shows on the hand-over screen`);
      await p.click('#reveal');
      await p.waitForSelector('#stageView:not([hidden]) form');
      if (w === 3 && who === 'Store') await shot(p, 'stage', true);
      const incoming = Number((await p.textContent('#stageView .tile:nth-child(2) b')).replace(/,/g, ''));
      if (w === 2 && who === 'Store') {
        await p.click('#stageView form button[type=submit]');
        check(/whole number/.test(await p.textContent('#stageView .err')), 'an empty order is refused with a message');
      }
      if (w === 1 && who === 'Store') await p.waitForTimeout(1200);
      await p.fill('#stageView input', String(who === 'Store' ? incoming + (w > 5 ? 3 : 0) : incoming + (w > 6 ? 5 : 0)));
      await p.click('#stageView form button[type=submit]');
      if (w === 7 && who === 'Store') {
        await p.reload();
        await p.waitForSelector('#resumeBtn');
        await p.click('#resumeBtn');
        await p.waitForSelector('#cover:not([hidden]) #reveal');
        check((await p.textContent('#cover h2')) === 'Plant', 'a reload mid-week resumes at the next stage');
      }
    }
  }
  check(order, 'the device goes up the chain, store first, every week');

  // ---- the debrief
  await p.waitForSelector('#debrief:not([hidden]) .kpis');
  check((await p.$$('.kpi')).length === 4, 'debrief: cost, both benchmarks and time');
  check(/thinking time 0:0[1-9]/.test(await p.textContent('.kpi:nth-child(4)')), 'thinking time is recorded');
  check(/swing grew/.test(await p.textContent('.takeaway')), 'debrief: the swing up the chain');
  check(!!(await p.$('#chOrders svg path.ln')) && !!(await p.$('#chNet svg')) && !!(await p.$('#chCurve svg')), 'debrief: all three charts');
  check((await p.$$('.scard')).length === 4, 'debrief: a card per stage');
  check((await p.textContent('.scard .rule')).includes('already on order'), 'debrief: the decision rule in words');
  await p.hover('#chOrders rect.hit', { position: { x: 300, y: 100 } });
  check(/Week \d+/.test(await p.textContent('#chOrders .tip')), 'hover read-out names the week');
  await p.click('#chOrders [data-table]');
  check((await p.$$('#chOrders .tablewrap tbody tr')).length === 12, 'table view lists every week');
  await shot(p, 'debrief', true);
  await p.evaluate(() => scrollTo(0, 0));
  const [dl] = await Promise.all([p.waitForEvent('download'), p.click('#dlCsv')]);
  check(dl.suggestedFilename() === 'Blue_team-ripple.csv', 'the weeks download as CSV');

  // ---- open table, everyone a person, 6 weeks
  await p.click('#newGame');
  await p.click('input[name=mode][value=table]');
  await p.click('summary');
  await p.fill('#weeks', '6');
  await p.click('#setup button[type=submit]');
  await p.click('#begin');
  for (let w = 1; w <= 6; w++) {
    await p.waitForSelector('#tableView:not([hidden]) #placeAll');
    check((await p.$$('#tableView form')).length === 4, `open table week ${w}: every stage on one screen`);
    if (w === 2) await shot(p, 'table', true);
    for (let i = 0; i < 4; i++) await p.fill(`#ord${i}`, '6');
    await p.click('#placeAll');
  }
  await p.waitForSelector('#debrief:not([hidden]) .kpis');
  check((await p.textContent('.scard .rule')).includes('Too few weeks'), 'a short game says it is too short to read a rule');

  // ---- theme and phone
  const before = await p.evaluate(() => document.documentElement.dataset.theme || 'dark');
  await p.click('#theme');
  check((await p.evaluate(() => document.documentElement.dataset.theme)) !== before, 'theme toggles');
  const m = await b.newPage({ viewport: { width: 390, height: 844 } });
  m.on('pageerror', (e) => errors.push(String(e)));
  await m.goto(BASE);
  await m.evaluate(() => localStorage.clear());
  await m.reload();
  await m.click('#setup button[type=submit]');
  await m.click('#begin');
  await m.click('#reveal');
  check((await m.evaluate(() => document.documentElement.scrollWidth)) <= 390, 'no sideways scroll at phone width');
  await shot(m, 'phone', true);

  check(errors.length === 0, `no page errors (${errors.slice(0, 3)})`);
  await b.close();
  console.log(`${pass}/${pass + fails.length} browser checks passed`);
  for (const f of fails) console.log(`  FAIL ${f}`);
  process.exit(fails.length ? 1 : 0);
})();
