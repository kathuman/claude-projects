// Ripple: AI players. Each stage of the chain is run by its own AI, one call to Claude per stage per week, in two
// games: every AI seeing only its own stage, and every AI seeing the whole chain. Then the two games are compared,
// with typical players and the best simple rule on the same chain as yardsticks. The runs are saved after every
// week, so a reload resumes them. The API key stays in this browser (and only if the user asks to remember it).

import { config, teamCost, newGame, startWeek } from './src/engine.js';
import { benchmark } from './src/rules.js';
import { summary } from './src/debrief.js';
import { lineChart, wire } from './src/charts.js';
import { structureSvg } from './src/diagram.js';
import { CONDITIONS, MODEL, newRun, playWeek, estimate, dollars, systemPrompt, situation } from './src/ai.js';

const VERSION = '1.0.3';
const SDK_URL = 'https://cdn.jsdelivr.net/npm/@anthropic-ai/sdk@0.133.0/+esm';
const KEY = 'ripple-ai';
const KEY_API = 'ripple-ai-key';
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = (v, d = 0) => (v == null || !Number.isFinite(v) ? '–' : v.toLocaleString('en-GB', { minimumFractionDigits: d, maximumFractionDigits: d }));
const usd = (v) => `US$${fmt(v, 2)}`;
const color = (i) => `var(--s${i + 1})`;
const ORDER = ['local', 'full'];

// the experiment: { input, effort, runs: { local?, full? }, started, finished }
let X = null;
let stopping = false;
let running = false;

const save = () => { try { localStorage.setItem(KEY, JSON.stringify(X)); } catch { /* storage unavailable: the run still goes on */ } };
const load = () => { try { return JSON.parse(localStorage.getItem(KEY) ?? 'null'); } catch { return null; } };

// ---------------------------------------------------------------- set-up

function formInput() {
  const num = (id) => Number($(id).value);
  return { stages: num('stages'), weeks: num('weeks'), initInv: num('initInv'), initPipeline: num('initPipeline'),
    orderDelay: num('orderDelay'), shipDelay: num('shipDelay'), prodDelay: num('prodDelay'), holding: num('holding'),
    backlog: num('backlog'), scenario: 'custom', demandFrom: num('demandFrom'), demandTo: num('demandTo'), stepWeek: num('stepWeek') };
}
const formConditions = () => [...document.querySelectorAll('input[name=condition]:checked')].map((x) => x.value);

function drawStructure() {
  const c = config(formInput());
  $('structure').innerHTML = `<div class="structure-head"><h2>The chain</h2><span class="fine">${c.stages} stages · orders take ${c.orderDelay} wk · goods ${c.shipDelay} wk · production ${c.prodDelay} wk · every stage an AI</span></div>
    <div class="structure-scroll">${structureSvg(c, { simulated: [] })}</div>`;
}

function drawEstimate() {
  const conds = formConditions();
  if (!conds.length) { $('estimate').textContent = 'Choose at least one of the two games.'; return; }
  const e = estimate(formInput(), conds, $('effort').value);
  $('estimate').innerHTML = `${fmt(e.calls)} decisions (${conds.length} game${conds.length > 1 ? 's' : ''} × ${config(formInput()).stages} stages × ${config(formInput()).weeks} weeks). A rough estimate of the cost: <b>about ${usd(e.dollars)}</b>, at ${MODEL}'s US$4 per million input tokens and US$20 per million output tokens; how long each AI thinks varies, so the real cost can be half or double. The cost so far is shown while it runs.`;
}

// The prompts, for a look before paying for them: week 1 for the store and the stage above it.
function drawPrompts() {
  const g = newGame(formInput());
  startWeek(g);
  const pick = [0, Math.min(1, g.stages.length - 1)];
  $('prompts').innerHTML = formConditions().concat(formConditions().length ? [] : ['local']).map((c) => pick.map((i) => `
    <h3>${esc(CONDITIONS[c].label)} · ${esc(g.cfg.names[i])}, week 1</h3>
    <pre class="prompt">${esc(systemPrompt(g.cfg, i, c))}\n\n— this week —\n${esc(situation(g, i, c))}</pre>`).join('')).join('');
}

function refreshForm() { drawStructure(); drawEstimate(); if ($('promptsBox').open) drawPrompts(); }

function renderResume() {
  const saved = load();
  const box = $('resume');
  box.hidden = true;
  if (!saved?.runs) return;
  const done = ORDER.filter((c) => saved.runs[c]).map((c) => `${CONDITIONS[c].label}: week ${saved.runs[c].game.history.length} of ${saved.runs[c].game.cfg.weeks}`).join(' · ');
  box.hidden = false;
  box.innerHTML = saved.finished
    ? `<h2>The last AI experiment</h2><p>${esc(done)}.</p><div class="row"><button class="btn" id="lastBtn" type="button">See its results again</button></div>`
    : `<h2>An AI experiment stopped part-way</h2><p>${esc(done)}. Resuming continues from there and needs the API key.</p>
       <div class="row"><button class="btn primary" id="resumeBtn" type="button">Resume</button><button class="btn" id="lastBtn" type="button">See the results so far</button><button class="btn" id="discardBtn" type="button">Discard it</button></div>`;
  $('lastBtn').onclick = () => { X = saved; renderResults(); };
  if (!saved.finished) {
    $('resumeBtn').onclick = () => { X = saved; go(); };
    $('discardBtn').onclick = () => { try { localStorage.removeItem(KEY); } catch { /* ignore */ } box.hidden = true; };
  }
}

// ---------------------------------------------------------------- running

async function client() {
  if (window.rippleAiClient) return window.rippleAiClient; // the browser check's stand-in
  const apiKey = $('apiKey').value.trim();
  if (!apiKey) throw new Error('Enter your Anthropic API key first.');
  try { if ($('rememberKey').checked) localStorage.setItem(KEY_API, apiKey); else localStorage.removeItem(KEY_API); } catch { /* ignore */ }
  const { default: Anthropic } = await import(SDK_URL);
  // the key belongs to the person running the page, in their own browser
  return new Anthropic({ apiKey, dangerouslyAllowBrowser: true, maxRetries: 4 });
}

function msg(text) { $('formMsg').hidden = !text; $('formMsg').textContent = text ?? ''; }

async function go() {
  if (running) return;
  msg('');
  let c;
  try { c = await client(); } catch (e) { msg(e.message); $('setup').scrollIntoView(); return; }
  running = true;
  stopping = false;
  let failure = null;
  $('results').hidden = true;
  $('progress').hidden = false;
  $('stopBtn').disabled = false;
  $('runBtn').disabled = true;
  drawProgress();
  // the two games run side by side, a week at a time each; within a week every stage decides at once
  const conds = ORDER.filter((k) => X.runs[k]);
  await Promise.all(conds.map(async (k) => {
    const run = X.runs[k];
    while (!run.game.over && !stopping) {
      try {
        await playWeek(run, c, X.effort);
      } catch (e) {
        stopping = true;
        failure = e.message;
        break;
      }
      save();
      drawProgress();
    }
  }));
  X.finished = conds.every((k) => X.runs[k].game.over);
  save();
  running = false;
  $('runBtn').disabled = false;
  $('progress').hidden = true;
  $('stopBtn').textContent = 'Stop after this week';
  if (failure) {
    msg(`Claude did not accept the request, so the experiment stopped (nothing was lost; resume it once this is fixed). ${failure}`);
    renderResume();
    $('setup').scrollIntoView();
    return;
  }
  renderResults();
}

function start() {
  const conds = formConditions();
  if (!conds.length) { msg('Choose at least one of the two games.'); return; }
  const input = formInput();
  X = { input, effort: $('effort').value, runs: {}, started: new Date().toISOString(), finished: false, version: VERSION };
  for (const k of conds) X.runs[k] = newRun(input, k);
  save();
  go();
}

const totalUsage = () => ORDER.filter((k) => X.runs[k]).reduce((u, k) => {
  for (const f of Object.keys(u)) u[f] += X.runs[k].usage[f];
  return u;
}, { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 });

function drawProgress() {
  const conds = ORDER.filter((k) => X.runs[k]);
  $('progressMeta').textContent = `${MODEL} · effort ${X.effort} · cost so far ${usd(dollars(totalUsage()))}`;
  $('progressBody').innerHTML = conds.map((k) => {
    const run = X.runs[k];
    const g = run.game;
    const cfg = g.cfg;
    const last = run.decisions.at(-1);
    const live = { stages: g.stages.map((s) => ({ inv: s.inv, backlog: s.backlog, inbound: s.inbound, outbound: s.outbound })),
      deciding: false, orders: [], visible: cfg.names.map(() => true) };
    return `<h3>${esc(CONDITIONS[k].label)} · week ${g.history.length} of ${cfg.weeks} · team cost ${fmt(teamCost(g))}${run.problems ? ` · ${run.problems} decision${run.problems > 1 ? 's' : ''} failed` : ''}</h3>
      <div class="structure-scroll">${structureSvg(cfg, { simulated: [] }, live)}</div>
      ${last ? `<ul class="reasons">${last.map((d, i) => `<li><b>${esc(cfg.names[i])}</b> ordered ${d.order}${d.problem ? ` <span class="warn">(${esc(d.problem)}: passed on the order received)</span>` : ''}: ${esc(d.reason ?? '')}</li>`).join('')}</ul>` : '<p class="fine">Waiting for week 1…</p>'}`;
  }).join('');
}

$('stopBtn').onclick = () => { stopping = true; $('stopBtn').disabled = true; $('stopBtn').textContent = 'Stopping after this week…'; };

// ---------------------------------------------------------------- results

const sum = (a) => a.reduce((s, x) => s + x, 0);

// One game's numbers for the comparison: cost by stage, swings, peaks.
function outcome(label, g) {
  const s = summary(g);
  return { label, g, cost: s.teamCost, stages: s.stages, peakOrder: Math.max(...s.stages.map((x) => x.peakOrder)),
    peakOwed: Math.max(...s.stages.map((x) => x.peakBacklog)), holding: sum(s.stages.map((x) => x.holdingCost)), backlog: sum(s.stages.map((x) => x.backlogCost)) };
}

function renderResults() {
  const box = $('results');
  const conds = ORDER.filter((k) => X.runs[k]);
  const played = conds.filter((k) => X.runs[k].game.history.length);
  box.hidden = false;
  if (!played.length) { box.innerHTML = '<div class="panel"><p>No weeks played yet.</p></div>'; return; }
  const weeks = Math.min(...played.map((k) => X.runs[k].game.history.length));
  const partial = played.some((k) => !X.runs[k].game.over);
  const cfg = X.runs[played[0]].game.cfg;
  // yardsticks: the same chain and demand, over the same weeks
  const yard = { ...X.input, weeks: Math.max(6, weeks) };
  const rows = [
    ...played.map((k) => ({ ...outcome(`AIs: ${CONDITIONS[k].label.toLowerCase()}`, X.runs[k].game), ai: k })),
    outcome('Typical players', benchmark(yard, 'typical')),
    outcome('Best simple rule', benchmark(yard, 'best')),
  ];
  const head = `<tr><th></th><th class="num">Team cost</th>${cfg.names.map((n, i) => `<th class="num"><span class="sw" style="background:${color(i)}"></span>${esc(n)}</th>`).join('')}<th class="num">Stock cost</th><th class="num">Backlog cost</th><th class="num">Largest order</th><th class="num">Most owed</th></tr>`;
  const body = rows.map((r) => `<tr${r.ai ? '' : ' class="yard"'}><th>${esc(r.label)}</th><td class="num"><b>${fmt(r.cost)}</b></td>${r.stages.map((s) => `<td class="num">${fmt(s.cost)}</td>`).join('')}<td class="num">${fmt(r.holding)}</td><td class="num">${fmt(r.backlog)}</td><td class="num">${fmt(r.peakOrder)}</td><td class="num">${fmt(r.peakOwed)}</td></tr>`).join('');
  const ampHead = `<tr><th></th>${cfg.names.map((n) => `<th class="num">${esc(n)}</th>`).join('')}</tr>`;
  const ampBody = rows.map((r) => `<tr${r.ai ? '' : ' class="yard"'}><th>${esc(r.label)}</th>${r.stages.map((s) => `<td class="num">${s.amplification == null ? '–' : `${fmt(s.amplification, 1)}×`}</td>`).join('')}</tr>`).join('');
  const [a, b] = played.map((k) => rows.find((r) => r.ai === k));
  const verdict = a && b && Math.round(a.cost) === Math.round(b.cost)
    ? `<p class="lede">After ${weeks} weeks, both games cost the same: <b>${fmt(a.cost)}</b>. Typical players cost ${fmt(rows.at(-2).cost)} on the same chain; the best simple rule ${fmt(rows.at(-1).cost)}.</p>`
    : a && b
    ? `<p class="lede">After ${weeks} weeks, the AIs seeing <b>${b.cost < a.cost ? 'the whole chain' : 'only their own stage'}</b> ran the chain for less: <b>${fmt(Math.min(a.cost, b.cost))}</b> against <b>${fmt(Math.max(a.cost, b.cost))}</b>, ${fmt(Math.abs(a.cost - b.cost) / Math.max(a.cost, b.cost) * 100)} % less. Typical players cost ${fmt(rows.at(-2).cost)} on the same chain; the best simple rule ${fmt(rows.at(-1).cost)}.</p>`
    : `<p class="lede">After ${weeks} weeks the AIs' team cost was <b>${fmt(rows[0].cost)}</b>. Typical players cost ${fmt(rows.at(-2).cost)} on the same chain; the best simple rule ${fmt(rows.at(-1).cost)}.</p>`;
  const opt = { W: 560, H: 260, right: 112 };
  const charts = played.map((k) => {
    const g = X.runs[k].game;
    const ser = (i, f) => ({ name: cfg.names[i], color: color(i), values: g.history.map((h) => f(h.stages[i])) });
    const dem = { name: 'Customers', color: 'var(--demand)', dashed: true, values: g.history.map((h) => h.demand) };
    return `<div class="panel"><h3>${esc(CONDITIONS[k].label)}</h3>
      <h4>Orders placed</h4>${lineChart([dem, ...cfg.names.map((_, i) => ser(i, (r) => r.order))], { ...opt, yLabel: 'Units a week', id: `ord-${k}` })}
      <h4>Stock (+) or owed (−)</h4>${lineChart(cfg.names.map((_, i) => ser(i, (r) => r.inv - r.backlog)), { ...opt, yLabel: 'Units', id: `net-${k}` })}</div>`;
  }).join('');
  const u = totalUsage();
  const problems = sum(played.map((k) => X.runs[k].problems));
  box.innerHTML = `
    <div class="panel">
      <h2>How the AIs did${partial ? ' so far' : ''}</h2>
      ${verdict}
      ${partial ? '<p class="warn">The experiment stopped part-way; the comparison covers the weeks every game has played, and the yardsticks the same weeks.</p>' : ''}
      <div class="scrollx"><table class="data cmp"><thead>${head}</thead><tbody>${body}</tbody></table></div>
      <p class="fine">The cost is every stage's stock cost (${fmt(cfg.holding, 2)} a unit a week) and backlog cost (${fmt(cfg.backlog, 2)} a unit a week) over the weeks played. Typical players and the best simple rule play the same chain and the same customer orders without any AI (see About).</p>
      <h3>How much each stage swung its orders</h3>
      <p class="fine">The spread of a stage's orders divided by the spread of customer orders: 1× passes demand on unchanged; more is the bullwhip.</p>
      <div class="scrollx"><table class="data cmp"><thead>${ampHead}</thead><tbody>${ampBody}</tbody></table></div>
      <p class="fine">${MODEL}, effort ${esc(X.effort)} · ${fmt(sum(played.map((k) => X.runs[k].decisions.length * cfg.stages)))} decisions · ${fmt(u.input)} input and ${fmt(u.output)} output tokens · about ${usd(dollars(u))}${problems ? ` · ${problems} decision${problems > 1 ? 's' : ''} failed and passed on the order received` : ''}.</p>
      <div class="row"><button class="btn" id="csvBtn" type="button">Download every decision (CSV)</button>${X.finished ? '' : '<button class="btn primary" id="resumeRun" type="button">Resume the experiment</button>'}<button class="btn" id="newRun" type="button">Set up a new experiment</button></div>
    </div>
    <div class="cmp2">${charts}</div>
    <div class="panel"><h2>Why they ordered what they did</h2>
      <p class="fine">Every AI wrote a short reason with each order; it was shown back to that AI the next week as its note.</p>
      <div class="row"><label class="inline">Game <select id="rGame">${played.map((k) => `<option value="${k}">${esc(CONDITIONS[k].label)}</option>`).join('')}</select></label>
        <label class="inline">Stage <select id="rStage">${cfg.names.map((n, i) => `<option value="${i}">${esc(n)}</option>`).join('')}</select></label></div>
      <div id="reasonTable"></div></div>`;
  wire(box);
  const drawReasons = () => {
    const k = $('rGame').value; const i = Number($('rStage').value);
    const run = X.runs[k];
    $('reasonTable').innerHTML = `<div class="scrollx"><table class="data"><thead><tr><th>Week</th><th class="num">Order received</th><th class="num">Stock</th><th class="num">Owed</th><th class="num">Ordered</th><th>Reason</th></tr></thead><tbody>${
      run.game.history.map((h, w) => { const r = h.stages[i]; const d = run.decisions[w][i];
        return `<tr><td>${h.week}</td><td class="num">${r.incoming}</td><td class="num">${r.inv}</td><td class="num">${r.backlog}</td><td class="num"><b>${r.order}</b></td><td>${d.problem ? `<span class="warn">${esc(d.problem)}: passed on the order received</span>` : esc(d.reason)}</td></tr>`; }).join('')}</tbody></table></div>`;
  };
  $('rGame').onchange = drawReasons; $('rStage').onchange = drawReasons;
  drawReasons();
  $('csvBtn').onclick = () => download('ripple-ai-players.csv', csv());
  if ($('resumeRun')) $('resumeRun').onclick = () => go();
  $('newRun').onclick = () => { box.hidden = true; $('setup').scrollIntoView(); };
  box.scrollIntoView();
}

function csv() {
  const q = (v) => (v == null ? '' : /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
  const lines = [['game', 'week', 'customer_orders', 'stage', 'order_received', 'arrived', 'shipped', 'stock', 'owed', 'supply_line', 'order', 'cost', 'problem', 'model', 'reason'].join(',')];
  for (const k of ORDER.filter((c) => X.runs[c])) {
    const run = X.runs[k];
    run.game.history.forEach((h, w) => h.stages.forEach((r, i) => {
      const d = run.decisions[w][i];
      lines.push([k, h.week, h.demand, run.game.cfg.names[i], r.incoming, r.arrived, r.shipped, r.inv, r.backlog, r.supplyLine, r.order, r.cost, d.problem, d.model, d.reason].map(q).join(','));
    }));
  }
  return lines.join('\n');
}

function download(name, text) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: 'text/csv' }));
  a.download = name;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}

// ---------------------------------------------------------------- wiring

$('ver').textContent = `v${VERSION}`;
$('verFoot').textContent = `v${VERSION}`;
$('theme').onclick = () => {
  const next = document.documentElement.dataset.theme === 'light' ? 'dark' : 'light';
  document.documentElement.dataset.theme = next;
  try { localStorage.setItem('ripple-theme', next); } catch { /* ignore */ }
};
try { const k = localStorage.getItem(KEY_API); if (k) { $('apiKey').value = k; $('rememberKey').checked = true; } } catch { /* ignore */ }
$('setup').addEventListener('input', refreshForm);
$('setup').addEventListener('change', refreshForm);
$('promptsBox').addEventListener('toggle', () => { if ($('promptsBox').open) drawPrompts(); });
$('setup').addEventListener('submit', (ev) => { ev.preventDefault(); start(); });
refreshForm();
renderResume();
