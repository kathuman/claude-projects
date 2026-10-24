// Plays Ripple in a real browser: the chain diagram on every screen, set-up, briefing, turn-by-turn play behind the
// hand-over screen (a reload in the middle of a week, an empty answer, an answer left unsent and no answer when time
// runs out), the debrief with its charts, hover read-out, table view and CSV; then an open-table game that times out,
// and the phone layout.
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
  await p.evaluate(() => { document.querySelector('details.advanced').open = true; });
  check((await p.$$('#structure .structure-svg .stage')).length === 4, 'the diagram shows the four stages on the start screen');
  await p.selectOption('#stages', '3');
  check((await p.$$('#structure .structure-svg .stage')).length === 3, 'the diagram follows the settings');
  await p.selectOption('#stages', '4');
  check((await p.inputValue('#limit')) === '15' && (await p.inputValue('#defaultOrder')) === '4', 'defaults: 15 seconds to answer, 4 units when nothing is entered');
  await p.fill('#limit', '3');

  // ---- set up: a 12-week step game, people on the store and the plant
  await p.fill('#team', 'Blue team');
  await p.evaluate(() => { document.querySelector('details.advanced').open = true; });
  await p.fill('#weeks', '12');
  await p.click('input[name=scenario][value=step]');
  await p.uncheck('input[name=person][value="1"]');
  await p.uncheck('input[name=person][value="2"]');
  await p.click('#setup button[type=submit]');
  await p.waitForSelector('#brief:not([hidden])');
  check((await p.textContent('#briefText')).includes('Regional DC, National DC'), 'briefing names the simulated stages');
  check(/3 seconds to place an order/.test(await p.textContent('#briefText')), 'the briefing states the time to answer');
  check(await p.isVisible('#structure svg'), 'the diagram stays on the briefing');
  await p.click('#begin');

  // ---- turn by turn
  let order = true;
  for (let w = 1; w <= 12; w++) {
    for (const who of ['Store', 'Plant']) {
      await p.waitForSelector('#cover:not([hidden]) #reveal');
      order = order && (await p.textContent('#cover h2')) === who;
      check(!(await p.$('#stageView table.statt')), `week ${w}: the ${who}'s own table is not on the hand-over screen`);
      if (w === 1) check((await p.$$('#structure .stage.now')).length === 1 && await p.isVisible('#structure svg'), 'the diagram marks the stage deciding now');
      await p.click('#reveal');
      await p.waitForSelector('#stageView:not([hidden]) form');
      if (w === 3 && who === 'Store') await shot(p, 'stage', true);
      const incoming = Number((await p.textContent('#stageView table.statt tbody tr:nth-child(4) td:nth-child(3)')).replace(/,/g, ''));
      if (w === 3 && who === 'Store') {
        check((await p.$$('#structure .qty')).length > 6 && (await p.$$('#structure .stock')).length === 4, 'the diagram shows the stock of every stage and what is on its way');
        check(!!(await p.$('#playCharts #pcNet svg path.ln')) && !!(await p.$('#playCharts #pcOrd svg path.ln')), 'stock and order charts beside the game');
        check((await p.$$('#playCharts #pcNet path.ln')).length === 4, 'the charts show every stage when the whole chain is visible');
        check(/Last week/.test(await p.textContent('#stageView table.statt')) && /On its way to you/.test(await p.textContent('#stageView .onway')), 'last week, this week and what is on its way');
      }
      if (w === 2 && who === 'Store') {
        await p.fill('#stageView input', '-3');
        await p.click('#stageView form button[type=submit]');
        check(/whole number/.test(await p.textContent('#stageView .err')), 'a negative order is refused with a message');
        await p.fill('#stageView input', '');
        await p.click('#stageView form button[type=submit]');   // empty: 4 units
        continue;
      }
      if (w === 4 && who === 'Plant') {            // typed, not sent: it goes when time runs out
        await p.fill('#stageView input', '9');
        await p.waitForSelector('#cover:not([hidden]) #reveal', { timeout: 6000 });
        continue;
      }
      if (w === 5 && who === 'Plant') {            // nothing typed when time runs out: 4 units
        await p.waitForSelector('#cover:not([hidden]) #reveal', { timeout: 6000 });
        continue;
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
  const hist = await p.evaluate(() => JSON.parse(localStorage.getItem('ripple-game')).game.history);
  check(hist[1].stages[0].order === 4 && hist[1].stages[0].auto === 'empty', 'an empty answer orders 4 units');
  check(hist[3].stages[3].order === 9 && hist[3].stages[3].auto === 'timeout', 'an answer typed but not sent is placed when time runs out');
  check(hist[4].stages[3].order === 4 && hist[4].stages[3].auto === 'timeout', 'no answer when time runs out orders 4 units');

  // ---- the debrief
  await p.waitForSelector('#debrief:not([hidden]) .kpis');
  check((await p.$$('.kpi')).length === 4, 'debrief: cost, both benchmarks and time');
  check(/thinking time 0:0[1-9]/.test(await p.textContent('.kpi:nth-child(4)')), 'thinking time is recorded');
  check(/swing grew/.test(await p.textContent('.takeaway')), 'debrief: the swing up the chain');
  check(!!(await p.$('#chOrders svg path.ln')) && !!(await p.$('#chNet svg')) && !!(await p.$('#chCurve svg')), 'debrief: all three charts');
  check((await p.$$('.scard')).length === 4, 'debrief: a card per stage');
  check((await p.textContent('.scard .rule')).includes('already on order'), 'debrief: the decision rule in words');
  check(/Orders placed by default\s*2 \(2 when time ran out\)/.test(await p.textContent('.scard:nth-child(4)')), 'debrief counts the plant orders placed by default');
  check(/Orders placed by default\s*1/.test(await p.textContent('.scard:nth-child(1)')), 'debrief counts the store empty answer');
  check(await p.isVisible('#structure svg'), 'the diagram stays on the debrief');
  check((await p.$$('#structure .stock')).length === 4, 'the debrief diagram shows where the game ended');
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
  await p.evaluate(() => { document.querySelector('details.advanced').open = true; });
  await p.fill('#weeks', '6');
  await p.fill('#limit', '3');
  await p.click('#setup button[type=submit]');
  await p.click('#begin');
  for (let w = 1; w <= 6; w++) {
    await p.waitForSelector(`#tableView:not([hidden]) #placeAll >> text=week ${w}`);
    check((await p.$$('#tableView form')).length === 4, `open table week ${w}: every stage on one screen`);
    if (w === 2) await shot(p, 'table', true);
    if (w === 3) {   // the table runs out of time with one order typed
      await p.fill('#ord1', '8');
      await p.waitForSelector('#tableView:not([hidden]) #placeAll >> text=week 4', { timeout: 6000 });
      continue;
    }
    for (let i = 0; i < 4; i++) await p.fill(`#ord${i}`, '6');
    await p.click('#placeAll');
  }
  const th = await p.evaluate(() => JSON.parse(localStorage.getItem('ripple-game')).game.history[2].stages.map((r) => `${r.order}:${r.auto}`));
  check(th.join(',') === '4:timeout,8:timeout,4:timeout,4:timeout', `the open table times out as a whole (${th})`);
  await p.waitForSelector('#debrief:not([hidden]) .kpis');
  check((await p.textContent('.scard .rule')).includes('Too few weeks'), 'a short game says it is too short to read a rule');

  // ---- only their own stage: the hand-over screen hides every number; a stage sees only its own
  await p.click('#newGame');
  await p.click('input[name=visibility][value=own]');
  await p.click('input[name=mode][value=turn]');
  await p.evaluate(() => { document.querySelector('details.advanced').open = true; });
  await p.fill('#weeks', '6');
  await p.fill('#limit', '0');
  await p.click('#setup button[type=submit]');
  check(/Only your own stage/.test(await p.textContent('#briefText')), 'the briefing says players see only their own stage');
  await p.click('#begin');
  for (let w = 1; w <= 2; w++) {
    for (let k = 0; k < 4; k++) {
      await p.waitForSelector('#cover:not([hidden]) #reveal');
      if (w === 2 && k === 1) {
        check((await p.$$('#structure .qty')).length === 0 && (await p.$$('#structure .stock')).length === 0, 'own stage: the hand-over diagram shows no numbers');
        check(/Hidden until/.test(await p.textContent('#playCharts')), 'own stage: the charts hide on the hand-over screen');
      }
      await p.click('#reveal');
      await p.waitForSelector('#stageView:not([hidden]) form');
      if (w === 2 && k === 1) {
        check((await p.$$('#structure .stock')).length === 1, 'own stage: the diagram shows only the stock of the deciding stage');
        check((await p.$$('#playCharts #pcNet path.ln')).length === 1, 'own stage: the charts show only the deciding stage');
      }
      await p.fill('#stageView input', '6');
      await p.click('#stageView form button[type=submit]');
    }
  }
  await p.evaluate(() => localStorage.removeItem('ripple-game'));

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
