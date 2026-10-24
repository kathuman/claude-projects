// Ripple: the page. A team sets up a game, reads the briefing, plays week by week on one device (turn by turn, each
// stage seeing only its own numbers behind a hand-over screen, or all together at an open table), and gets a debrief.
// The game is saved after every decision, so a reload or a closed tab resumes where it was.

import { newGame, startWeek, placeOrders, view, teamCost, config, stageNames } from './src/engine.js';
import { SCENARIOS } from './src/scenarios.js';
import { anchoring, orderUpTo, bestRule, TYPICAL, leadTime } from './src/rules.js';
import { summary, benchmarks, fits, causes } from './src/debrief.js';
import { lineChart, curveChart, wire } from './src/charts.js';
import { structureSvg } from './src/diagram.js';

const VERSION = '1.0.1';
const KEY = 'ripple-game';
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = (v, d = 0) => (v == null || !Number.isFinite(v) ? '–' : v.toLocaleString('en-GB', { minimumFractionDigits: d, maximumFractionDigits: d }));
const pct = (x) => `${Math.round(x * 100)} %`;
const clock = (s) => { s = Math.round(s); const h = Math.floor(s / 3600); const m = Math.floor((s % 3600) / 60); const ss = s % 60;
  return h ? `${h} h ${String(m).padStart(2, '0')} min` : `${m}:${String(ss).padStart(2, '0')}`; };
const color = (i) => `var(--s${i + 1})`;

let S = null; // the team's session: settings, the game, whose turn it is

const save = () => { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch { /* storage unavailable: the game still runs */ } };
const load = () => { try { return JSON.parse(localStorage.getItem(KEY) ?? 'null'); } catch { return null; } };

function show(id) {
  for (const s of document.querySelectorAll('.screen')) s.hidden = s.id !== id;
  scrollTo(0, 0);
}

// ---------------------------------------------------------------- setup

const SCEN_ORDER = ['surprise', 'step', 'seasonal', 'promotion', 'random'];

function renderStart() {
  $('scenarios').innerHTML = SCEN_ORDER.map((k) => {
    const s = k === 'surprise' ? { label: 'Surprise', blurb: 'One of the patterns below, picked at random and revealed only in the debrief.' } : SCENARIOS[k];
    return `<label class="card"><input type="radio" name="scenario" value="${k}"${k === 'surprise' ? ' checked' : ''}><span><b>${esc(s.label)}</b><small>${esc(s.blurb)}</small></span></label>`;
  }).join('');
  const drawPeople = () => {
    const names = stageNames(Number($('stages').value));
    $('people').innerHTML = names.map((n, i) => `<label><input type="checkbox" name="person" value="${i}" checked> ${esc(n)}</label>`).join('');
  };
  $('stages').onchange = () => { drawPeople(); drawStructure(); };
  drawPeople();
  drawStructure();
  $('resume').hidden = true;
  const saved = load();
  if (saved?.game && !saved.finished) {
    $('resume').hidden = false;
    $('resume').innerHTML = `<h2>Resume ${esc(saved.team)}'s game</h2>
      <p>Week ${Math.min(saved.game.week, saved.game.cfg.weeks)} of ${saved.game.cfg.weeks}, saved on this device.</p>
      <div class="row"><button class="btn primary" id="resumeBtn" type="button">Resume</button><button class="btn" id="discardBtn" type="button">Discard it and start a new game</button></div>`;
    $('resumeBtn').onclick = () => { S = saved; resumePlay(); };
    $('discardBtn').onclick = () => { try { localStorage.removeItem(KEY); } catch { /* ignore */ } $('resume').hidden = true; };
  } else if (saved?.finished) {
    $('resume').hidden = false;
    $('resume').innerHTML = `<h2>${esc(saved.team)}'s last game</h2><p>Finished, ${fmt(teamCost(saved.game))} total cost.</p>
      <div class="row"><button class="btn" id="lastBtn" type="button">See its debrief again</button></div>`;
    $('lastBtn').onclick = () => { S = saved; renderDebrief(); };
  }
}

// The settings as they stand on the form (the diagram follows them while a team chooses).
function formInput() {
  const num = (id) => Number($(id).value);
  return { stages: num('stages'), weeks: num('weeks'), initInv: num('initInv'), orderDelay: num('orderDelay'),
    shipDelay: num('shipDelay'), prodDelay: num('prodDelay'), holding: num('holding'), backlog: num('backlog'), seed: num('seed') };
}
const formPeople = () => [...$('setup').querySelectorAll('input[name=person]:checked')].map((x) => Number(x.value));

function readSetup() {
  const f = $('setup');
  const num = (id) => Number($(id).value);
  const whole = (id, dflt, max) => ($(id).value === '' ? dflt : Math.min(max, Math.max(0, Math.round(num(id)))));
  let scenario = f.elements.scenario.value;
  const surprise = scenario === 'surprise';
  if (surprise) scenario = ['step', 'seasonal', 'promotion', 'random'][Math.floor(Math.random() * 4)];
  const input = { stages: num('stages'), weeks: num('weeks'), initInv: num('initInv'), orderDelay: num('orderDelay'),
    shipDelay: num('shipDelay'), prodDelay: num('prodDelay'), holding: num('holding'), backlog: num('backlog'), seed: num('seed'), scenario };
  const people = [...f.querySelectorAll('input[name=person]:checked')].map((x) => Number(x.value));
  return { team: $('team').value.trim() || 'Team 1', input, people, surprise, mode: f.elements.mode.value, botKind: $('botKind').value,
    limit: whole('limit', 15, 600), defaultOrder: whole('defaultOrder', 4, 999) };
}

// ---------------------------------------------------------------- briefing

// The structure of the chain at the top of every screen: the game being played, or the settings being chosen.
function drawStructure({ cfg, people, now = -1, done = [] } = {}) {
  const c = cfg ?? config(formInput());
  const ppl = people ?? formPeople();
  $('structure').innerHTML = `<div class="structure-head"><h2>The chain</h2><span class="fine">${c.stages} stages · orders take ${c.orderDelay} wk · goods ${c.shipDelay} wk · production ${c.prodDelay} wk</span></div>
    <div class="structure-scroll">${structureSvg(c, { now, done, simulated: c.names.map((_, i) => i).filter((i) => !ppl.includes(i)) })}</div>`;
}

function renderBrief() {
  const cfg = config(S.input);
  drawStructure({ cfg, people: S.people });
  const lt = leadTime(cfg, 1);
  const sims = cfg.names.filter((_, i) => !S.people.includes(i));
  $('briefText').innerHTML = `
    <p><b>Your goal.</b> The lowest total cost for the whole team over ${cfg.weeks} weeks. Every unit in stock costs ${fmt(cfg.holding, 2)} a week; every unit you owe your customer costs ${fmt(cfg.backlog, 2)} a week. Running out costs more than holding stock, but holding too much adds up.</p>
    <p><b>Each week.</b> Goods arrive from your supplier, an order arrives from your customer, and you ship what you can. What you cannot ship is owed and shipped as soon as you have stock. Then you place an order with your supplier.</p>
    <p><b>The delays.</b> An order takes ${cfg.orderDelay} week${cfg.orderDelay > 1 ? 's' : ''} to reach your supplier and goods take ${cfg.shipDelay} weeks to arrive, so what you order now arrives in about ${lt} weeks, if your supplier has it. The ${esc(cfg.names.at(-1))} produces instead of ordering; production takes ${cfg.prodDelay} weeks.</p>
    <p><b>What you see.</b> Only your own stage: your stock, what you owe, what arrived, what was ordered from you, and what you have on order. The ${esc(cfg.names[0])} sees what customers order; nobody else does.</p>
    ${S.mode === 'turn' ? `<p><b>Turn by turn.</b> Each week the device goes from the ${esc(cfg.names[0])} up the chain. When it's your turn, look only at your own screen, and don't tell the others your numbers: in a real chain you wouldn't know them.</p>` : `<p><b>Open table.</b> Everyone sees every stage and the team decides together.</p>`}
    ${sims.length ? `<p><b>Simulated players</b> run the ${sims.map(esc).join(', ')}, behaving ${S.botKind === 'best' ? 'like the best simple rule' : 'like typical players'}.</p>` : ''}
    <p><b>The start.</b> Every stage holds ${cfg.initInv} units, and ${cfg.base} units a week are flowing through the chain.</p>
    <p><b>Time to answer.</b> ${S.limit ? `Each player has ${S.limit} seconds to place an order. When time runs out the order is placed for them: what they typed, or ${S.defaultOrder} units if they typed nothing.` : 'There is no time limit.'} Placing an order with nothing entered orders ${S.defaultOrder} units.</p>`;
  show('brief');
}

// ---------------------------------------------------------------- play

const humans = () => S.people.filter((i) => i < S.game.stages.length);
function botRule(i) {
  const cfg = S.game.cfg;
  return S.botKind === 'best' ? orderUpTo(bestRule(S.input), cfg, i) : anchoring(TYPICAL, cfg, i);
}

function begin() {
  S.game = newGame(S.input);
  S.startedAt = Date.now();
  S.finished = false;
  nextWeek();
}

function nextWeek() {
  const g = S.game;
  if (g.over) return finish();
  startWeek(g);
  S.orders = g.stages.map((_, i) => (S.people.includes(i) ? null : botRule(i)(view(g, i))));
  S.seconds = g.stages.map(() => null);
  S.auto = g.stages.map(() => null);
  S.turn = 0;
  save();
  resumePlay();
}

function resumePlay() {
  show('play');
  $('status').hidden = false;
  const g = S.game;
  if (g.over) return finish();
  if (g.phase === 'move') return nextWeek();
  const h = humans();
  if (!h.length) { closeWeek(); return; }
  if (S.mode === 'table') return showTable();
  const i = h.find((k) => S.orders[k] == null);
  if (i == null) return closeWeek();
  showCover(i);
}

function meta() {
  const g = S.game;
  $('status').textContent = `${S.team} · week ${Math.min(g.week, g.cfg.weeks)} of ${g.cfg.weeks}`;
  const thinking = g.history.flatMap((h) => h.stages.map((r) => r.seconds ?? 0)).reduce((a, b) => a + b, 0);
  $('playMeta').innerHTML = `<span>Week ${Math.min(g.week, g.cfg.weeks)} of ${g.cfg.weeks}</span><span>Time so far ${clock((Date.now() - S.startedAt) / 1000)}</span><span>Thinking time ${clock(thinking)}</span>`;
}

function showCover(i) {
  const g = S.game;
  meta();
  const done = humans().filter((k) => S.orders[k] != null);
  drawStructure({ cfg: g.cfg, people: S.people, now: i, done });
  $('stageView').hidden = true;
  $('stageView').innerHTML = '';
  $('tableView').hidden = true;
  $('tableView').innerHTML = '';
  $('cover').hidden = false;
  $('cover').innerHTML = `<p class="fine">Week ${g.week} of ${g.cfg.weeks}</p><h2>${esc(g.cfg.names[i])}</h2>
    <p>Hand the device to the player running the ${esc(g.cfg.names[i])}. Only they look at the next screen.</p>
    <button class="btn primary big" id="reveal" type="button">I run the ${esc(g.cfg.names[i])}: show my numbers</button>`;
  $('reveal').onclick = () => showStage(i);
  $('reveal').focus();
}

function stageHtml(i, { compact = false } = {}) {
  const g = S.game;
  const v = view(g, i);
  const n = g.stages.length;
  const up = i === n - 1 ? null : g.cfg.names[i + 1];
  const down = i === 0 ? 'Customers' : `The ${g.cfg.names[i - 1]}`;
  const lt = leadTime(g.cfg, i);
  const ask = up ? `How many units do you order from the ${esc(up)}?` : 'How many units do you start producing?';
  const past = v.past.slice(-8).reverse();
  return `
    <div class="tiles">
      <div class="tile"><span>${i === n - 1 ? 'Finished production' : 'Arrived'}</span><b>${fmt(v.arrived)}</b><small>${up ? `from the ${esc(up)}` : 'this week'}</small></div>
      <div class="tile"><span>Ordered from you</span><b>${fmt(v.incoming)}</b><small>${esc(down)}${i === 0 ? ' ordered this week' : ''}</small></div>
      <div class="tile"><span>Shipped</span><b>${fmt(v.shipped)}</b><small>${i === 0 ? 'to customers' : `to the ${esc(g.cfg.names[i - 1])}`}</small></div>
      <div class="tile"><span>In stock</span><b>${fmt(v.inventory)}</b><small>after shipping</small></div>
      <div class="tile${v.backlog > 0 ? ' bad' : ''}"><span>You owe</span><b>${fmt(v.backlog)}</b><small>units not yet shipped</small></div>
      <div class="tile"><span>${up ? 'On order' : 'In production'}</span><b>${fmt(v.supplyLine)}</b><small>not yet arrived</small></div>
    </div>
    <p class="fine">Your cost this week ${fmt(v.weekCost, 2)} · your total so far ${fmt(v.cost + v.weekCost, 2)}</p>
    <form class="order" data-stage="${i}" autocomplete="off" novalidate>
      <label for="ord${i}">${ask}</label>
      <div class="stepper"><button type="button" data-d="-1" aria-label="One less">−</button>
        <input id="ord${i}" type="number" inputmode="numeric" min="0" max="999" step="1" placeholder="${S.defaultOrder ?? 4}">
        <button type="button" data-d="1" aria-label="One more">+</button></div>
      ${compact ? '' : `${timerHtml()}<button class="btn primary big" type="submit">Place order</button>`}
      <p class="fine">Leave it empty to order ${S.defaultOrder ?? 4}. ${up ? `It reaches the ${esc(up)} in ${g.cfg.orderDelay} week${g.cfg.orderDelay > 1 ? 's' : ''}; the goods arrive about ${lt} weeks from now if it has them.` : `Production finishes in ${g.cfg.prodDelay} weeks.`}</p>
      <p class="fine err" role="alert"></p>
    </form>
    ${compact || !past.length ? '' : `<details class="pastwrap"><summary>Your last weeks</summary><div class="scroll"><table class="past"><thead><tr><th>Week</th><th class="num">Ordered from you</th><th class="num">Arrived</th><th class="num">You ordered</th><th class="num">Stock</th><th class="num">Owed</th></tr></thead><tbody>
      ${past.map((p) => `<tr><td>${p.week}</td><td class="num">${p.incoming}</td><td class="num">${p.arrived}</td><td class="num">${p.order}</td><td class="num">${p.inv}</td><td class="num">${p.backlog}</td></tr>`).join('')}</tbody></table></div></details>`}`;
}

// ---- the time to answer: a countdown that places the order when it runs out
let ticker = null;
const stopTimer = () => { clearInterval(ticker); ticker = null; };
const timerHtml = () => (S.limit ? `<div class="timer" role="timer"><div class="bar"><i></i></div><span class="left"></span><small>to answer</small></div>` : '');
function startTimer(root, onExpire) {
  stopTimer();
  const el = root.querySelector('.timer');
  if (!S.limit || !el) return;
  const end = performance.now() + S.limit * 1000;
  const tick = () => {
    const left = Math.max(0, (end - performance.now()) / 1000);
    el.querySelector('.left').textContent = `${Math.ceil(left)} s`;
    el.querySelector('i').style.width = `${(100 * left) / S.limit}%`;
    el.classList.toggle('low', left <= 5);
    if (left <= 0) { stopTimer(); onExpire(); }
  };
  tick();
  ticker = setInterval(tick, 200);
}

// What the box holds: a valid order, nothing (null), or something invalid (NaN).
function readOrder(inp) {
  if (inp.value.trim() === '') return null;
  const v = Number(inp.value);
  return Number.isInteger(v) && v >= 0 && v <= 999 ? v : NaN;
}

function wireOrder(form, onValue) {
  const inp = form.querySelector('input');
  form.querySelectorAll('[data-d]').forEach((b) => b.addEventListener('click', () => {
    inp.value = Math.max(0, (Number(inp.value) || 0) + Number(b.dataset.d));
    inp.focus();
  }));
  form.addEventListener('submit', (ev) => {
    ev.preventDefault();
    const v = readOrder(inp);
    if (Number.isNaN(v)) {
      form.querySelector('.err').textContent = 'Enter a whole number of units, 0 or more, or leave it empty.';
      inp.focus();
      return;
    }
    onValue(v ?? S.defaultOrder, v == null ? 'empty' : null);
  });
}

function showStage(i) {
  const g = S.game;
  $('cover').hidden = true;
  $('tableView').innerHTML = '';
  $('stageView').hidden = false;
  $('stageView').innerHTML = `<div class="panel"><div class="stagehead"><h2><span class="sw" style="display:inline-block;width:14px;height:14px;border-radius:3px;background:${color(i)};margin-right:8px"></span>${esc(g.cfg.names[i])}</h2><span class="fine">Week ${g.week} of ${g.cfg.weeks}</span></div>${stageHtml(i)}</div>`;
  const shownAt = performance.now();
  const form = $('stageView').querySelector('form');
  const inp = form.querySelector('input');
  const place = (v, why) => {
    stopTimer();
    S.orders[i] = v;
    S.seconds[i] = Math.round((performance.now() - shownAt) / 100) / 10;
    S.auto[i] = why;
    save();
    resumePlay();
  };
  wireOrder(form, place);
  startTimer(form, () => { const v = readOrder(inp); place(Number.isInteger(v) ? v : S.defaultOrder, 'timeout'); });
  inp.focus();
}

function showTable() {
  const g = S.game;
  meta();
  drawStructure({ cfg: g.cfg, people: S.people });
  $('cover').hidden = true;
  $('stageView').hidden = true;
  $('stageView').innerHTML = '';
  $('tableView').hidden = false;
  const h = humans();
  $('tableView').innerHTML = `${timerHtml()}<div class="tablegrid">${h.map((i) => `<div class="panel"><h3><span class="sw" style="display:inline-block;width:12px;height:12px;border-radius:3px;background:${color(i)};margin-right:6px"></span>${esc(g.cfg.names[i])}</h3>${stageHtml(i, { compact: true })}</div>`).join('')}</div>
    <div class="row"><button class="btn primary big" id="placeAll" type="button">Place all orders for week ${g.week}</button><span class="fine err" id="tableErr" role="alert"></span></div>`;
  const shownAt = performance.now();
  const placeAll = (timedOut) => {
    const vals = h.map((i) => readOrder($(`ord${i}`)));
    if (!timedOut && vals.some((v) => Number.isNaN(v))) {
      $('tableErr').textContent = 'Every order is a whole number of units, 0 or more, or left empty.';
      return;
    }
    stopTimer();
    const each = Math.round((performance.now() - shownAt) / 100 / h.length) / 10;
    h.forEach((i, k) => {
      const v = vals[k];
      S.orders[i] = Number.isInteger(v) ? v : S.defaultOrder;
      S.seconds[i] = each;
      S.auto[i] = timedOut ? 'timeout' : v == null ? 'empty' : null;
    });
    save();
    closeWeek();
  };
  $('tableView').querySelectorAll('form').forEach((f) => wireOrder(f, () => placeAll(false)));
  $('placeAll').onclick = () => placeAll(false);
  startTimer($('tableView'), () => placeAll(true));
  $(`ord${h[0]}`).focus();
}

function closeWeek() {
  placeOrders(S.game, S.orders, S.seconds, S.auto ?? []);
  save();
  nextWeek();
}

function finish() {
  stopTimer();
  S.finished = true;
  S.finishedAt ??= Date.now();
  save();
  renderDebrief();
}

// ---------------------------------------------------------------- debrief

function ruleText(f, kind) {
  if (!f) return '<p class="fine">Too few weeks to read a decision rule (eight are needed).</p>';
  const theta = f.theta > 0.6 ? 'followed each week\'s incoming orders closely' : f.theta < 0.2 ? 'kept a steady view of demand and barely reacted to single weeks' : 'updated its view of demand gradually';
  return `${kind ? `<p class="fine">${esc(kind)}</p>` : ''}
    <p>Counted about <b>${pct(f.beta)}</b> of what was already on order. Typical players count about a third; the best rule counts all of it.</p>
    <p>Corrected about <b>${pct(f.alpha)}</b> of the gap between the stock it wanted and the stock it had, each week.</p>
    <p>It ${theta}.</p>
    <p class="fine">${f.r2 == null ? '' : f.r2 >= 0.4 ? `This rule explains ${pct(f.r2)} of the ups and downs in its orders.` : `The orders follow no simple rule closely (it explains ${pct(f.r2)} of them): read these numbers loosely.`}</p>`;
}

// The debrief's headline compares the team with both benchmarks over the weeks it played.
function headline(team, typical, best) {
  if (team <= best * 1.05 && team <= typical) return 'As good as the best simple rule';
  if (team < typical * 0.95) return 'Better than typical players';
  if (team <= typical * 1.1) return 'About as well as typical players';
  return 'The ripple got you';
}

function renderDebrief() {
  show('debrief');
  $('status').hidden = true;
  const g = S.game;
  const cfg = g.cfg;
  drawStructure({ cfg, people: S.people });
  const sm = summary(g, S.people);
  const played = g.history.length;
  const bm = benchmarks(g);
  const f = played >= 8 ? fits(g) : cfg.names.map(() => null);
  const cz = played >= 8 ? causes(g, f) : null;
  // benchmarks over the same weeks the team played
  const costTo = (b) => b.history.slice(0, played).reduce((s, h) => s + h.stages.reduce((a, r) => a + r.cost, 0), 0);
  const typical = costTo(bm.typical);
  const best = costTo(bm.best);
  const wall = ((S.finishedAt ?? Date.now()) - S.startedAt) / 1000;
  const weeksArr = g.history;
  const ordersSeries = [
    { name: 'Customers', color: 'var(--demand)', values: weeksArr.map((h) => h.demand), dashed: true },
    ...cfg.names.map((nm, i) => ({ name: nm, color: color(i), values: weeksArr.map((h) => h.stages[i].order) })),
  ];
  const netSeries = cfg.names.map((nm, i) => ({ name: nm, color: color(i), values: weeksArr.map((h) => h.stages[i].inv - h.stages[i].backlog) }));
  const plantPeak = Math.max(...weeksArr.map((h) => h.stages.at(-1).order));
  const growth = plantPeak / Math.max(1, sm.demandPeak);
  const vsBest = sm.teamCost / Math.max(1, best);
  const scen = SCENARIOS[cfg.demand.type];

  let slText = '';
  if (cz) {
    const full = cz.curve.at(-1).cost;
    slText = cz.supplyLineSaving > 0.03 * cz.model
      ? `Your team counted about <b>${pct(cz.teamBeta)}</b> of what was already on order. Had every stage counted all of it, and decided as it did in every other way, the team's cost would have been about <b>${fmt(full)}</b> instead of ${fmt(cz.model)}: <b>${pct(cz.supplyLineSaving / cz.model)} lower</b>.`
      : `Your team counted about <b>${pct(cz.teamBeta)}</b> of what was already on order. In this game, counting more of it would not have lowered the cost much (about ${fmt(full)} against ${fmt(cz.model)}): your other habits mattered more.`;
  }

  $('debrief').innerHTML = `
    <div class="dhead"><div><p class="fine">Debrief · ${esc(S.team)} · ${played} weeks</p><h1>${headline(sm.teamCost, typical, best)}</h1></div>
      <div class="row"><button class="btn" id="again" type="button">Play again, same settings</button><button class="btn" id="newGame" type="button">New game</button><button class="btn" id="print" type="button">Print</button><button class="btn" id="dlCsv" type="button">Download the weeks (CSV)</button></div></div>
    <div class="kpis">
      <div class="kpi you"><span>Your team's cost</span><b>${fmt(sm.teamCost)}</b><small>holding ${fmt(sm.stages.reduce((a, s) => a + s.holdingCost, 0))} · owed ${fmt(sm.stages.reduce((a, s) => a + s.backlogCost, 0))}</small></div>
      <div class="kpi"><span>Typical players</span><b>${fmt(typical)}</b><small>the same chain and demand, simulated</small></div>
      <div class="kpi"><span>Best simple rule</span><b>${fmt(best)}</b><small>counts everything on order</small></div>
      <div class="kpi"><span>Time used</span><b>${clock(wall)}</b><small>thinking time ${clock(sm.timeTotal)} · ${sm.timeMedian != null ? `${fmt(sm.timeMedian, 1)} s per decision (median)` : 'no decisions timed'}</small></div>
    </div>
    <p class="takeaway">Customer orders peaked at <b>${sm.demandPeak}</b> units a week. The ${esc(cfg.names.at(-1))}'s orders peaked at <b>${plantPeak}</b>: the swing grew <b>${fmt(growth, 1)} times</b> on its way up the chain. ${vsBest > 1.05 ? `Your team spent ${pct(vsBest - 1)} more than the best simple rule would have on the same weeks.` : ''}</p>

    <div class="panel"><h2>The ripple: what each stage ordered</h2>
      <p class="fine">Customer demand (dashed) against the orders each stage placed. Swings that grow from the store to the plant are the bullwhip effect.</p>
      ${lineChart(ordersSeries, { yLabel: 'Units ordered', id: 'chOrders' })}</div>

    <div class="panel"><h2>Stock and backlog</h2>
      <p class="fine">Above zero: units in stock. Below zero: units owed to the customer. The best chains stay a little above zero.</p>
      ${lineChart(netSeries, { yLabel: 'Stock (+) or owed (−)', id: 'chNet' })}</div>

    ${cz ? `<div class="panel"><h2>The orders already on their way</h2>
      <p>${slText}</p>
      ${curveChart(cz.curve, [{ beta: Math.min(1, Math.max(0, cz.teamBeta)), label: 'Your team', cls: 'you', row: 0 }, { beta: TYPICAL.beta, label: 'Typical players', row: 1 }, { beta: 1, label: 'All of it', row: 0 }], { id: 'chCurve' })}
      <p class="fine">Each point replays your game with every stage's decision rule, read from its orders, changed only in how much of its supply line it counts. ${Math.abs(cz.fitGap) / Math.max(1, sm.teamCost) > 0.1 ? `The rules reproduce your team's cost only roughly (${fmt(cz.model)} against ${fmt(sm.teamCost)}).` : `The rules reproduce your team's cost closely (${fmt(cz.model)} against ${fmt(sm.teamCost)}).`}</p></div>` : ''}

    <div class="panel"><h2>Each stage</h2><div class="stagecards">
      ${sm.stages.map((s, i) => `<div class="scard" style="--c:${color(i)}"><h3>${esc(s.name)} <small>${s.person ? 'played by your team' : 'simulated'}</small></h3>
        <div class="split" title="Holding cost and backlog cost"><i class="h" style="width:${(100 * s.holdingCost) / Math.max(1, s.cost)}%"></i><i class="b" style="width:${(100 * s.backlogCost) / Math.max(1, s.cost)}%"></i></div>
        <small>Cost ${fmt(s.cost)}: stock ${fmt(s.holdingCost)}, owed ${fmt(s.backlogCost)}</small>
        <dl><dt>Largest order</dt><dd>${s.peakOrder}</dd><dt>Most owed</dt><dd>${s.peakBacklog}</dd>
          <dt>Swing against demand</dt><dd>${s.amplification == null ? '–' : `${fmt(s.amplification, 1)}×`}</dd>
          ${s.person ? `<dt>Orders placed by default</dt><dd>${s.autoEmpty + s.autoTimeout}${s.autoTimeout ? ` (${s.autoTimeout} when time ran out)` : ''}</dd><dt>Time per decision</dt><dd>${s.seconds.median == null ? '–' : `${fmt(s.seconds.median, 1)} s`}</dd><dt>Longest decision</dt><dd>${s.seconds.longest == null ? '–' : `${fmt(s.seconds.longest, 0)} s`}</dd>` : ''}</dl>
        <div class="rule">${ruleText(f[i], s.person ? '' : S.botKind === 'best' ? 'Simulated with the best simple rule.' : 'Simulated as a typical player.')}</div></div>`).join('')}
    </div></div>

    <div class="panel"><h2>What customers ordered</h2>
      <p><b>${esc(scen.label)}.</b> ${esc(scen.blurb)} ${S.surprise ? 'It was picked at random when the game started.' : ''}</p>
      <p class="fine">Only the ${esc(cfg.names[0])} saw these orders, one week at a time. Every other stage saw only the orders of the stage below it, already shaped by that stage's decisions.</p></div>`;
  wire($('debrief'));
  $('again').onclick = () => { S = { ...S, game: null, finished: false, finishedAt: null }; begin(); };
  $('newGame').onclick = () => { S = null; try { localStorage.removeItem(KEY); } catch { /* ignore */ } location.hash = ''; renderStart(); show('start'); };
  $('print').onclick = () => print();
  $('dlCsv').onclick = () => download(`${S.team.replace(/[^\w-]+/g, '_')}-ripple.csv`, csv(g), 'text/csv');
}

function csv(g) {
  const head = ['week', 'customer_demand'];
  g.cfg.names.forEach((nm) => ['incoming', 'arrived', 'shipped', 'stock', 'owed', 'on_order', 'order', 'placed_by_default', 'cost', 'seconds'].forEach((k) => head.push(`${nm} ${k}`)));
  const rows = g.history.map((h) => [h.week, h.demand, ...h.stages.flatMap((r) => [r.incoming, r.arrived, r.shipped, r.inv, r.backlog, r.supplyLine, r.order, r.auto ?? '', r.cost, r.seconds ?? ''])]);
  return [head, ...rows].map((r) => r.map((x) => (/[",]/.test(String(x)) ? `"${String(x).replace(/"/g, '""')}"` : x)).join(',')).join('\n') + '\n';
}

function download(name, text, type) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}

// ---------------------------------------------------------------- wiring

$('ver').textContent = `v${VERSION}`;
$('verFoot').textContent = `v${VERSION}`;
$('theme').onclick = () => {
  const cur = document.documentElement.dataset.theme === 'light' ? 'light' : 'dark';
  const next = cur === 'light' ? 'dark' : 'light';
  document.documentElement.dataset.theme = next;
  try { localStorage.setItem('ripple-theme', next); } catch { /* ignore */ }
};
$('setup').addEventListener('input', () => drawStructure());
$('setup').addEventListener('change', () => drawStructure());
$('setup').addEventListener('submit', (ev) => {
  ev.preventDefault();
  S = readSetup();
  renderBrief();
});
$('begin').onclick = begin;
$('backSetup').onclick = () => { show('start'); drawStructure(); };
$('endEarly').onclick = () => { $('endConfirm').hidden = false; $('endWeek').textContent = String(S.game.history.length); };
$('endNo').onclick = () => { $('endConfirm').hidden = true; };
$('endYes').onclick = () => {
  $('endConfirm').hidden = true;
  if (!S.game.history.length) { $('endConfirm').hidden = true; return; }
  stopTimer();
  S.game.over = true;
  finish();
};
setInterval(() => { if (S?.game && !S.finished && !$('play').hidden) meta(); }, 1000);
renderStart();
