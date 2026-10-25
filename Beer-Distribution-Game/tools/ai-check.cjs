// Runs Ripple's AI players page in a real browser against a stand-in for Claude (no API key, no cost): the set-up
// with the experiment's starting values, the prompts preview, both games played to the end, a refused decision, the
// comparison, the charts, the reasons and the CSV, a reload that resumes, a rejected key, the SDK loading from the
// CDN, and the phone layout.
//   python -m http.server 8766   (from the repository root)
//   PW=<path to playwright or playwright-core> [CHROME=<chrome.exe>] [URL=…] [OUT=<folder for screenshots>] node Beer-Distribution-Game/tools/ai-check.cjs
const { chromium } = require(process.env.PW || 'playwright');

const BASE = (process.env.URL || 'http://localhost:8766/Beer-Distribution-Game/') + 'ai.html';
const OUT = process.env.OUT;
let pass = 0;
const fails = [];
const check = (ok, what) => { if (ok) pass++; else fails.push(what); };
const shot = (p, name, full = false) => (OUT ? p.screenshot({ path: `${OUT}/${name}.png`, fullPage: full }) : null);

// the stand-in: orders what was received plus a little while stock is short; refuses once (store, week 2, own stage)
const FAKE = () => {
  window.__calls = [];
  window.rippleAiClient = { beta: { messages: { create: async (p) => {
    window.__calls.push(p);
    await new Promise((r) => setTimeout(r, window.__slow ? 40 : 2));
    const t = p.messages[0].content;
    if (window.__reject) throw Object.assign(new Error('invalid x-api-key'), { status: 401 });
    if (/^Week 2\./.test(t) && /Order received from customers/.test(t) && !/whole chain/.test(t)) {
      return { stop_reason: 'refusal', content: [], usage: { input_tokens: 5, output_tokens: 0 }, model: 'claude-opus-5-5' };
    }
    const inc = Number(/Order received from [^:]+: (\d+)/.exec(t)[1]);
    const stock = Number(/Stock now: (\d+)/.exec(t)[1]);
    const order = inc + (stock < 8 ? 2 : 0);
    return { stop_reason: 'end_turn', model: 'claude-opus-5-5', usage: { input_tokens: 1200, output_tokens: 300 },
      content: [{ type: 'text', text: JSON.stringify({ reason: `Received ${inc}, stock ${stock}.`, order }) }] };
  } } } };
};

(async () => {
  const b = await chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : {});
  const errors = [];
  const ctx = await b.newContext({ viewport: { width: 1280, height: 900 }, acceptDownloads: true });
  await ctx.addInitScript(FAKE);
  const p = await ctx.newPage();
  p.on('pageerror', (e) => errors.push(String(e)));
  p.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await p.goto(BASE);
  await p.evaluate(() => localStorage.clear());
  await p.reload();

  // ---- set-up: the experiment's starting values
  const val = (id) => p.inputValue(`#${id}`);
  check((await val('weeks')) === '33' && (await val('initInv')) === '12' && (await val('initPipeline')) === '4', 'starts at 33 weeks, 12 in stock, 4 in every pipeline week');
  check((await val('demandFrom')) === '4' && (await val('stepWeek')) === '6' && (await val('demandTo')) === '8', 'customers: 4 a week, then 8 from week 6');
  check((await p.$$('input[name=condition]:checked')).length === 2, 'both games chosen');
  check((await p.$$('#structure .structure-svg .stage')).length === 4, 'the chain diagram shows four stages');
  check(/264 decisions/.test(await p.textContent('#estimate')), 'the estimate counts 264 decisions');
  check(/US\$\d/.test(await p.textContent('#estimate')), 'the estimate gives a cost in dollars');
  await p.evaluate(() => { document.getElementById('promptsBox').open = true; });
  await p.waitForSelector('#prompts pre');
  const prompts = await p.textContent('#prompts');
  check(/never ends/.test(prompts) && /no last week/.test(prompts), 'the prompts say the game never ends');
  check(!/33/.test(prompts), 'the prompts never give the number of weeks');
  check((await p.$$('#prompts pre')).length === 4, 'prompts shown for two stages in each game');
  await shot(p, 'ai-setup', true);

  // ---- run both games
  await p.click('#runBtn');
  await p.waitForSelector('#progress:not([hidden])');
  await p.waitForSelector('#results:not([hidden])', { timeout: 60000 });
  const calls = await p.evaluate(() => window.__calls.length);
  check(calls === 264, `264 decisions made (${calls})`);
  const reqOk = await p.evaluate(() => window.__calls.every((c) => c.model === 'claude-opus-5-5' && c.fallbacks === 'default' && c.output_config.format.type === 'json_schema'));
  check(reqOk, 'every request: Opus 5.5, default fallbacks, structured answer');
  const res = await p.textContent('#results');
  check(/After 33 weeks/.test(res), 'the verdict covers 33 weeks');
  check(/Typical players/.test(res) && /Best simple rule/.test(res), 'yardsticks shown');
  check((await p.$$('#results table.cmp tbody tr')).length === 8, 'cost and swing tables, four rows each');
  check((await p.$$('#results figure.chart')).length === 4, 'orders and stock charts for both games');
  check(/1 decision failed/.test(res), 'the refused decision is counted');
  check(/Received 4, stock/.test(await p.textContent('#reasonTable')), 'reasons listed');
  await p.selectOption('#rGame', 'local');
  check(/refusal: passed on the order received/.test(await p.textContent('#reasonTable')), 'the refused week shows what happened');
  await p.selectOption('#rStage', '3');
  check((await p.$$('#reasonTable tbody tr')).length === 33, 'a row per week for the plant');
  const [dl] = await Promise.all([p.waitForEvent('download'), p.click('#csvBtn')]);
  const text = require('fs').readFileSync(await dl.path(), 'utf8').trim().split('\n');
  check(text.length === 1 + 264, `CSV: a line per decision (${text.length - 1})`);
  await shot(p, 'ai-results', true);

  // ---- a reload offers the results again
  await p.reload();
  check(/last AI experiment/.test(await p.textContent('#resume')), 'a reload offers the last experiment');
  await p.click('#lastBtn');
  check(!(await p.isHidden('#results')), 'its results come back');

  // ---- stop part-way, reload, resume
  await p.evaluate(() => { window.__slow = true; });
  await p.fill('#weeks', '10');
  await p.click('#runBtn');
  await p.waitForFunction(() => /week [3-9] of 10/.test(document.getElementById('progressBody')?.textContent ?? ''));
  await p.click('#stopBtn');
  await p.waitForSelector('#results:not([hidden])', { timeout: 30000 });
  check(/so far/.test(await p.textContent('#results h2')), 'stopping shows the results so far');
  await p.reload();
  check(/stopped part-way/.test(await p.textContent('#resume')), 'a reload offers to resume');
  await p.click('#resumeBtn');
  await p.waitForSelector('#results:not([hidden])', { timeout: 30000 });
  check(/After 10 weeks/.test(await p.textContent('#results')), 'the resumed experiment finishes');

  // ---- a rejected key stops and says so
  await p.evaluate(() => { window.__reject = true; });
  await p.click('#runBtn');
  await p.waitForFunction(() => !document.getElementById('formMsg').hidden);
  check(/did not accept/.test(await p.textContent('#formMsg')), 'a rejected key stops the experiment with a message');
  check(/stopped part-way/.test(await p.textContent('#resume')), 'and it can be resumed later');

  // ---- the real SDK loads from the CDN and builds a client (no request sent)
  const sdk = await p.evaluate(async () => {
    try {
      const { default: Anthropic } = await import('https://cdn.jsdelivr.net/npm/@anthropic-ai/sdk@0.133.0/+esm');
      const c = new Anthropic({ apiKey: 'sk-ant-test', dangerouslyAllowBrowser: true });
      return typeof c.beta.messages.create === 'function';
    } catch (e) { return String(e); }
  });
  check(sdk === true, `the Anthropic SDK loads in the browser (${sdk})`);

  // ---- phone
  const m = await b.newPage({ viewport: { width: 390, height: 844 } });
  m.on('pageerror', (e) => errors.push(String(e)));
  await m.goto(BASE);
  check((await m.evaluate(() => document.documentElement.scrollWidth)) <= 390, 'no sideways scroll at phone width');
  await shot(m, 'ai-phone', true);

  check(errors.length === 0, `no page errors (${errors.slice(0, 3)})`);
  await b.close();
  console.log(`${pass}/${pass + fails.length} AI page checks passed`);
  for (const f of fails) console.log(`  FAIL ${f}`);
  process.exit(fails.length ? 1 : 0);
})();
