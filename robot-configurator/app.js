// The page: the requirements wizard, the proposals, the cost–headroom chart, and for the chosen proposal its checks,
// part swaps, budget, building guide, wiring and programs. The search runs in a worker that keeps its results, so a
// design picked on the chart or a swapped part comes back without a new search; everything else is computed here.

import { CATALOG_DATE, FX, REGIONS, VENDORS, part } from './src/catalog.js';
import { MODE_LABEL } from './src/pricing.js';
import { TERRAIN } from './src/physics.js';
import { BOARDS } from './src/pins.js';
import { SWAP_SLOTS, SLOT_LABEL } from './src/solver.js';
import { buildGuide } from './src/guide.js';
import { wiring, signalDiagram, powerDiagram } from './src/wiring.js';
import { generateFirmware } from './src/firmware.js';
import { zip } from './src/zip.js';
import { LANGS, t, num, setLang, lang, locale, guessLang } from './src/i18n.js';

const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const form = $('#wizard');
const results = $('#results');
$('#catDate').textContent = CATALOG_DATE;

let fx = { ...FX };
let state = { result: null, cards: [], selected: 0, tab: 'overview', file: 0, ms: 0, swap: null, compare: false, frontTable: false };

// ---------------------------------------------------------------- theme

const root = document.documentElement;
$('#theme').addEventListener('click', () => {
  root.dataset.theme = root.dataset.theme === 'light' ? 'dark' : 'light';
  try { localStorage.setItem('rc-theme', root.dataset.theme); } catch { /* storage unavailable */ }
});

// ---------------------------------------------------------------- language

const store = { get: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* storage unavailable */ } } };
const urlLang = new URLSearchParams(location.search).get('lang');
setLang(LANGS[urlLang] ? urlLang : store.get('rc-lang') ?? guessLang(navigator.languages ?? [navigator.language]));

// The static page: an element marked data-i18n keeps its English text as the key; data-i18n-attr names attributes
// translated the same way.
function translateStatic() {
  root.lang = lang();
  for (const el of document.querySelectorAll('[data-i18n]')) {
    el.dataset.key ??= el.textContent.replace(/\s+/g, ' ').trim();
    el.textContent = t(el.dataset.key);
  }
  for (const el of document.querySelectorAll('[data-i18n-attr]')) {
    for (const a of el.dataset.i18nAttr.split(',')) {
      const k = `key_${a.replace(/-/g, '_')}`;
      el.dataset[k] ??= el.getAttribute(a) ?? '';
      el.setAttribute(a, t(el.dataset[k]));
    }
  }
  document.title = t('Robot Configurator');
  $('#aboutLink').href = `about.html${lang() === 'en' ? '' : `?lang=${lang()}`}`;
}
const sel = $('#langSel');
sel.innerHTML = Object.entries(LANGS).map(([k, v]) => `<option value="${k}">${v.name}</option>`).join('');
sel.value = lang();
sel.addEventListener('change', () => {
  setLang(sel.value);
  store.set('rc-lang', sel.value);
  const u = new URL(location.href);
  u.searchParams.set('lang', sel.value);
  history.replaceState(null, '', u);
  translateStatic();
  search();
});

// ---------------------------------------------------------------- the request

const LANG_REGION = { da: 'DK', sv: 'SE', nb: 'NO' };

function readForm() {
  const f = new FormData(form);
  const n = (k) => Number(f.get(k));
  const behaviours = ['remote', 'obstacle', 'line', 'odometry'].filter((b) => f.get(`b-${b}`));
  return {
    region: f.get('region'),
    type: f.get('type'),
    rover: { payload: n('payload'), speed: n('speed'), slope: n('slope'), runtime: n('runtime'),
      terrain: f.get('terrain'), behaviours, accel: 0.5 },
    arm: { reach: n('reach') / 1000, payload: n('armPayload') / 1000, axes: n('axes'), wireless: !!f.get('wireless') },
    controller: f.get('controller'),
    solder: f.get('solder'),
    shopping: f.get('shopping'),
    budget: f.get('budget') === '' ? null : n('budget'),
    charger: !!f.get('charger'),
    tools: !!f.get('tools'),
    printer: !!f.get('printer'),
    fx,
  };
}

function writeForm(req) {
  const set = (name, v) => {
    const els = form.elements[name];
    if (!els) return;
    if (els instanceof RadioNodeList) { for (const el of els) el.checked = el.value === String(v); return; }
    if (els.type === 'checkbox') els.checked = !!v; else els.value = v ?? '';
  };
  if (req.region) set('region', req.region);
  if (req.type) set('type', req.type);
  if (req.rover) {
    set('payload', req.rover.payload); set('speed', req.rover.speed); set('slope', req.rover.slope);
    set('runtime', req.rover.runtime); set('terrain', req.rover.terrain);
    for (const b of ['remote', 'obstacle', 'line', 'odometry']) set(`b-${b}`, req.rover.behaviours?.includes(b));
  }
  if (req.arm) {
    set('reach', Math.round(req.arm.reach * 1000)); set('armPayload', Math.round(req.arm.payload * 1000));
    set('axes', req.arm.axes); set('wireless', req.arm.wireless);
  }
  for (const k of ['controller', 'solder', 'shopping', 'budget', 'charger', 'tools', 'printer']) if (k in req) set(k, req[k]);
  if (req.fx) fx = { ...FX, ...req.fx };
}

function syncForm() {
  const type = form.elements.type.value;
  $('#roverReq').hidden = type === 'arm';
  $('#armReq').hidden = type === 'rover';
  $('#budgetUnit').textContent = REGIONS[form.elements.region.value].currency;
}
form.addEventListener('change', syncForm);

// share link: the request in the URL hash
const encode = (req) => btoa(unescape(encodeURIComponent(JSON.stringify({ ...req, fx: undefined }))));
const decode = (s) => JSON.parse(decodeURIComponent(escape(atob(s))));

// ---------------------------------------------------------------- the worker

let worker = null;
function search({ scroll = false } = {}) {
  const req = readForm();
  history.replaceState(null, '', `${location.search}#r=${encode(req)}`);
  worker?.terminate();
  worker = new Worker(new URL('./src/worker.js', import.meta.url), { type: 'module' });
  worker.onmessage = (e) => onWorker(e.data, scroll);
  $('#go').disabled = true;
  results.innerHTML = `<div class="panel"><span class="spinner"></span>${esc(t('Checking every compatible combination of parts…'))}</div>`;
  worker.postMessage({ cmd: 'solve', req, lang: lang() });
}
form.addEventListener('submit', (e) => { e.preventDefault(); search({ scroll: true }); });

function onWorker(m, scroll) {
  if (!m.ok) {
    $('#go').disabled = false;
    results.innerHTML = `<div class="panel callout bad">${esc(t('Something went wrong:'))} <pre>${esc(m.error)}</pre></div>`;
    return;
  }
  if (m.cmd === 'solve') {
    $('#go').disabled = false;
    const r = m.result;
    state = { ...state, result: r, cards: r.ok ? r.proposals : [], selected: 0, file: 0, ms: m.ms, swap: null };
    render();
    // on a phone the results sit below the form
    if (scroll && matchMedia('(max-width: 900px)').matches) results.scrollIntoView({ behavior: 'smooth' });
  } else if (m.cmd === 'pick' && m.proposal) {
    usePick(m.proposal);
  } else if (m.cmd === 'swap' && state.swap?.slot === m.slot) {
    state.swap.options = m.options;
    render();
  }
}

// A design picked on the chart or by a swap becomes a card of its own (the "your pick" card, replaced each time),
// unless it is already one of the proposals.
function usePick(p) {
  const at = state.cards.findIndex((c) => c.idx === p.idx && c.kind !== 'fast');
  if (at >= 0) { state.selected = at; render(); return; }
  state.cards = [...state.cards.filter((c) => c.kind !== 'pick'), p];
  state.selected = state.cards.length - 1;
  state.swap = null;
  render();
}

// ---------------------------------------------------------------- formatting

const money = (v, cur) => new Intl.NumberFormat(locale(), { style: 'currency', currency: cur, maximumFractionDigits: 0 }).format(v);
const pct = (v) => `${num(v * 100, 0)} %`;
const unitVal = (v, unit) => {
  if (unit === 'm') return `${num(v * 1000, 0)} mm`;
  if (unit === 'kg') return `${num(v, 2)} kg`;
  if (unit === '') return num(v, 2);
  if (unit === 'min') return `${num(v, 0)} min`;
  return `${num(v, 2)} ${unit}`;
};
const duration = (min) => (min >= 60 ? `${num(min / 60, 1)} h` : `${min} min`);
const KIND = { cheapest: 'Lowest cost', robust: 'Most headroom', fast: 'Quickest delivery', pick: 'Your pick' };
const kindLabel = (p) => p.kinds.map((k) => t(KIND[k])).join(' · ');
const tightest = (d) => d.checks.filter((c) => c.key && c.severity === 'fail').sort((a, b) => a.margin - b.margin)[0];

// ---------------------------------------------------------------- render

function render() {
  const r = state.result;
  if (!r.ok) { results.innerHTML = renderInfeasible(r); return; }
  const cards = state.cards;
  const p = cards[state.selected];
  const tabs = [['overview', t('Design & checks')], ['budget', t('Budget')], ['build', t('Build guide')], ['wiring', t('Wiring')],
    ['programs', t('Programs')], ['method', t('Method & assumptions')]];
  const time = state.ms < 1000 ? t('{n} ms', { n: Math.max(1, Math.round(state.ms)) }) : `${num(state.ms / 1000, 1)} s`;
  results.innerHTML = `
    <p class="summary-line">${esc(t('{count} combinations checked, {feasible} pass every check, in {time}.',
      { count: num(r.count, 0), feasible: num(r.feasibleCount, 0), time }))} <a href="${esc(location.href)}" id="share">${esc(t('Link to this request'))}</a></p>
    <div class="proposals">${cards.map(renderCard).join('')}${r.robustSame ? `<div class="note-card">${esc(t(r.req.budget == null
      ? 'No design adds real headroom for at most twice the lowest cost: the lowest-cost design is also the sturdiest buy.'
      : 'No design within your budget adds real headroom over the lowest-cost one.'))}</div>` : ''}</div>
    ${cards.length > 1 ? `<div class="row-head"><span></span><button class="small-btn" type="button" id="cmpBtn" aria-expanded="${state.compare}">${esc(state.compare ? t('Hide the comparison') : t('Compare side by side'))}</button></div>` : ''}
    ${state.compare && cards.length > 1 ? `<div class="panel">${renderCompare(cards, r.req)}</div>` : ''}
    <div class="panel chart-panel">${renderChart(r)}</div>
    <div class="panel">
      <div class="tabs" role="tablist">${tabs.map(([id, l]) => `<button role="tab" type="button" data-tab="${id}" aria-selected="${state.tab === id}">${esc(l)}</button>`).join('')}</div>
      <div id="tabBody">${renderTab(p, r.req)}</div>
    </div>`;
  for (const b of results.querySelectorAll('.proposal')) {
    b.addEventListener('click', (e) => {
      if (e.target.closest('.drop')) return;
      state.selected = +b.dataset.i; state.file = 0; state.swap = null; render();
    });
  }
  results.querySelector('.proposal .drop')?.addEventListener('click', () => {
    state.cards = state.cards.filter((c) => c.kind !== 'pick');
    state.selected = Math.min(state.selected, state.cards.length - 1);
    render();
  });
  $('#cmpBtn')?.addEventListener('click', () => { state.compare = !state.compare; render(); });
  for (const b of results.querySelectorAll('[data-tab]')) b.addEventListener('click', () => { state.tab = b.dataset.tab; render(); });
  $('#share').addEventListener('click', (e) => { e.preventDefault(); navigator.clipboard?.writeText(location.href); e.target.textContent = t('Link copied'); });
  wireChart(r);
  wireTab(p, r.req);
}

function renderCard(p, i) {
  const tc = tightest(p.design);
  const twin = p.kind === 'fast' && state.cards.find((c) => c !== p && c.design.key === p.design.key);
  return `
    <button class="proposal" type="button" data-i="${i}" aria-pressed="${i === state.selected}">
      ${p.kind === 'pick' ? `<span class="drop" role="button" aria-label="${esc(t('Remove'))}" title="${esc(t('Remove'))}">×</span>` : ''}
      <div class="kind">${esc(kindLabel(p))}</div>
      <div class="price">${money(p.price.total, p.price.currency)}</div>
      <div class="meta">${esc(t(p.price.parcels.length > 1 ? '{n} parcels · arrives in ≈ {days} days' : '{n} parcel · arrives in ≈ {days} days',
        { n: p.price.parcels.length, days: p.price.days }))}</div>
      ${tc ? `<div class="tight">${esc(t('Headroom'))} <b>${pct(Math.max(0, tc.margin))}</b> · ${esc(t('tightest: {check}', { check: tc.label }))}</div>` : ''}
      ${twin ? `<p class="same">${esc(t('Same parts as {kind}, bought from vendors that deliver within a week.', { kind: kindLabel(twin) }))}</p>`
        : `<p class="why">${esc(describe(p.design))}</p>`}
    </button>`;
}

function describe(d) {
  const p = d.parts;
  const bits = [];
  if (d.type !== 'arm') bits.push(`${p.chassis.name.replace(/\s*\(.*\)/, '')}, ${p.motor.name.split(' ').slice(0, 2).join(' ')}, ${p.driver.name.split(' ')[0]}, ${p.battery.name.split(',')[0].replace(/\s*\(.*\)/, '')}`);
  if (d.arm) {
    bits.push(t('{n}-axis {frame} arm, {servos} servos', { n: d.arm.frame.joints.length, frame: d.arm.frame.name.split(' ')[0].toLowerCase(),
      servos: [...new Set(Object.values(d.arm.servos).map((s) => s.name.split(' ')[0]))].join(' + ') }));
  }
  bits.push(BOARDS[d.board].name);
  return bits.join(' · ');
}

// ---------------------------------------------------------------- compare

function slotValue(d, slot) {
  const v = d.slots?.[slot];
  if (!v) return '–';
  if (slot === 'power') return v.split('+').map((id) => part(id).name.split('(')[0].trim()).join(' + ');
  return part(v).name.replace(/\s*\(.*\)/, '');
}

function renderCompare(cards, req) {
  const cols = cards.map((p) => ({ p, d: p.design, s: p.design.specs, g: buildGuide(p.design, req) }));
  const rows = [];
  const row = (label, f, cls = '') => rows.push(`<tr class="${cls}"><th scope="row">${esc(label)}</th>${cols.map((c) => `<td class="num">${f(c)}</td>`).join('')}</tr>`);
  row(t('Landed total'), (c) => money(c.p.price.total, c.p.price.currency));
  row(t('Arrives in'), (c) => esc(t('≈ {days} days', { days: c.p.price.days })));
  row(t('Parcels'), (c) => c.p.price.parcels.length);
  row(t('Headroom'), (c) => { const tc = tightest(c.d); return tc ? `${pct(Math.max(0, tc.margin))}<br><small>${esc(tc.label)}</small>` : '–'; });
  if (req.type !== 'arm') {
    row(t('Top speed, flat'), (c) => `${num(c.s.topSpeed, 2)} m/s`);
    row(t('Steepest slope, continuous'), (c) => `${num(c.s.maxSlope, 0)}°`);
    row(t('Runtime (model)'), (c) => `${num(c.s.runtime / 60, 1)} h`);
    row(t('Total mass'), (c) => `${num(c.s.mass, 2)} kg`);
    row(t('Load headroom'), (c) => `${num(c.s.loadHeadroom, 2)} kg`);
  }
  if (req.type !== 'rover') {
    row(t('Full reach'), (c) => `${num(c.s.reach * 1000, 0)} mm`);
    row(t('Payload at your reach'), (c) => `${num(c.s.armPayload * 1000, 0)} g`);
  }
  row(t('Building time, first build'), (c) => `≈ ${duration(c.g.total)}`);
  for (const slot of SWAP_SLOTS[req.type]) {
    const vals = cols.map((c) => slotValue(c.d, slot));
    if (vals.every((v) => v === '–')) continue;
    row(t(SLOT_LABEL[slot]), (c) => esc(slotValue(c.d, slot)), new Set(vals).size > 1 ? 'diff' : '');
  }
  return `<h3>${esc(t('The proposals side by side'))}</h3>
    <div class="table-scroll"><table class="cmp"><thead><tr><th></th>${cols.map((c) => `<th class="num">${esc(kindLabel(c.p))}</th>`).join('')}</tr></thead>
    <tbody>${rows.join('')}</tbody></table></div>
    <p class="fine">${esc(t('Highlighted rows are the parts that differ.'))}</p>`;
}

// ---------------------------------------------------------------- the cost–headroom chart

function chartGeometry(r) {
  const pts = r.chart.points;
  const W = 760; const H = 300; const L = 58; const R = 16; const T = 14; const B = 44;
  const xs = pts.map((p) => p.x);
  const x0 = Math.min(...xs); const x1 = Math.max(...xs);
  const pad = (x1 - x0) * 0.04 || x0 * 0.1 || 1;
  const yMax = Math.min(1, Math.max(0.2, ...pts.map((p) => p.y)) * 1.08);
  const sx = (x) => L + ((x - (x0 - pad)) / ((x1 + pad) - (x0 - pad))) * (W - L - R);
  const sy = (y) => T + (1 - Math.max(0, y) / yMax) * (H - T - B);
  return { pts, W, H, L, R, T, B, x0: x0 - pad, x1: x1 + pad, yMax, sx, sy };
}

const niceTicks = (a, b, n = 5) => {
  const step0 = (b - a) / n;
  const mag = 10 ** Math.floor(Math.log10(step0));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= step0);
  const out = [];
  for (let v = Math.ceil(a / step) * step; v <= b + 1e-9; v += step) out.push(v);
  return out;
};

function renderChart(r) {
  if (!r.chart?.points.length) return '';
  const g = chartGeometry(r);
  const cur = r.chart.currency;
  const front = g.pts.filter((p) => p.f).sort((a, b) => a.x - b.x);
  const xt = niceTicks(g.x0, g.x1);
  const yt = niceTicks(0, g.yMax, 4);
  const marks = [];
  for (const v of yt) marks.push(`<line class="gridline" x1="${g.L}" x2="${g.W - g.R}" y1="${g.sy(v)}" y2="${g.sy(v)}"/><text class="tick" x="${g.L - 8}" y="${g.sy(v) + 3.5}" text-anchor="end">${num(v * 100, 0)} %</text>`);
  for (const v of xt) marks.push(`<text class="tick" x="${g.sx(v)}" y="${g.H - g.B + 16}" text-anchor="middle">${esc(money(v, cur))}</text>`);
  marks.push(`<line class="axis" x1="${g.L}" x2="${g.W - g.R}" y1="${g.H - g.B}" y2="${g.H - g.B}"/>`);
  marks.push(`<text class="axis-label" x="${(g.L + g.W - g.R) / 2}" y="${g.H - 6}" text-anchor="middle">${esc(t('Estimated parts cost, before shipping'))}</text>`);
  marks.push(`<text class="axis-label" transform="translate(13 ${(g.T + g.H - g.B) / 2}) rotate(-90)" text-anchor="middle">${esc(t('Headroom'))}</text>`);
  for (const p of g.pts) if (!p.f) marks.push(`<circle class="pt-other" cx="${g.sx(p.x)}" cy="${g.sy(p.y)}" r="2.6"/>`);
  if (front.length > 1) {
    // the frontier as a staircase: headroom only steps up as the money does
    let d = `M${g.sx(front[0].x)} ${g.sy(front[0].y)}`;
    for (const p of front.slice(1)) d += ` H${g.sx(p.x)} V${g.sy(p.y)}`;
    marks.push(`<path class="front-line" d="${d}"/>`);
  }
  for (const p of front) marks.push(`<circle class="pt-front" cx="${g.sx(p.x)}" cy="${g.sy(p.y)}" r="5"/>`);
  // the proposals, ringed and named
  const byIdx = new Map(g.pts.map((p) => [p.i, p]));
  const labelled = new Set();
  for (const c of state.cards) {
    const p = byIdx.get(c.idx);
    if (!p || labelled.has(c.idx)) continue;
    labelled.add(c.idx);
    const names = state.cards.filter((x) => x.idx === c.idx).map(kindLabel).join(' · ');
    const x = g.sx(p.x); const y = g.sy(p.y);
    const right = x > g.W * 0.7;
    marks.push(`<circle class="prop-ring" cx="${x}" cy="${y}" r="9"/><text class="prop-label" x="${right ? x - 13 : x + 13}" y="${y - 10}" text-anchor="${right ? 'end' : 'start'}">${esc(names)}</text>`);
  }
  // hit targets, larger than the marks
  for (const p of g.pts) marks.push(`<circle class="hit" data-i="${p.i}" cx="${g.sx(p.x)}" cy="${g.sy(p.y)}" r="${p.f ? 9 : 6}"/>`);
  const table = state.frontTable ? `<div class="table-scroll"><table><thead><tr><th class="num">${esc(t('Estimated parts cost'))}</th><th class="num">${esc(t('Headroom'))}</th><th></th></tr></thead><tbody>${
    front.map((p) => `<tr><td class="num">${money(p.x, cur)}</td><td class="num">${pct(p.y)}</td><td><button class="small-btn" type="button" data-pick="${p.i}">${esc(t('Make it my pick'))}</button></td></tr>`).join('')}</tbody></table></div>` : '';
  return `
    <h3>${esc(t('Cost against headroom'))}</h3>
    <p class="chart-note">${esc(t('Every design that passes every check, by its estimated parts cost and its headroom (the margin on its tightest check). The orange line is the frontier: the cheapest way to each level of headroom. Click any point to price it exactly and make it your pick.'))}${r.chart.sampled ? ' ' + esc(t('(A sample of the designs is shown, and all of the frontier.)')) : ''}</p>
    <div class="chart" id="chart"><svg viewBox="0 0 ${g.W} ${g.H}" role="img" aria-label="${esc(t('Cost against headroom'))}">${marks.join('')}<circle class="hover-ring" r="8" cx="-20" cy="-20"/></svg><div class="tip" hidden></div></div>
    <div class="legend"><span><i style="background:var(--s-other)"></i>${esc(t('Other designs that pass'))}</span><span><i style="background:var(--s-front)"></i>${esc(t('Frontier: cheapest for its headroom'))}</span><span><i style="border:2px solid var(--ink)"></i>${esc(t('The proposals'))}</span></div>
    <div class="row"><button class="link-btn" type="button" id="frontTableBtn">${esc(state.frontTable ? t('Hide the table') : t('Show the frontier as a table'))}</button></div>
    ${table}`;
}

function wireChart(r) {
  const box = $('#chart');
  if (!box) return;
  const g = chartGeometry(r);
  const byIdx = new Map(g.pts.map((p) => [p.i, p]));
  const tip = box.querySelector('.tip');
  const ring = box.querySelector('.hover-ring');
  const svg = box.querySelector('svg');
  svg.addEventListener('pointermove', (e) => {
    const hit = e.target.closest('.hit');
    if (!hit) { tip.hidden = true; ring.setAttribute('cx', -20); return; }
    const p = byIdx.get(+hit.dataset.i);
    ring.setAttribute('cx', hit.getAttribute('cx')); ring.setAttribute('cy', hit.getAttribute('cy'));
    tip.innerHTML = `<b>${esc(p.f ? t('On the frontier') : t('A design that passes'))}</b>${esc(t('Estimated parts cost'))}: ${money(p.x, r.chart.currency)}<br>${esc(t('Headroom'))}: ${pct(p.y)}<br><small>${esc(t('Click to price it and make it your pick'))}</small>`;
    tip.hidden = false;
    const bb = box.getBoundingClientRect();
    const x = e.clientX - bb.left; const y = e.clientY - bb.top;
    tip.style.left = `${Math.min(x + 14, bb.width - 230)}px`;
    tip.style.top = `${Math.max(0, y - 70)}px`;
  });
  svg.addEventListener('pointerleave', () => { tip.hidden = true; ring.setAttribute('cx', -20); });
  svg.addEventListener('click', (e) => {
    const hit = e.target.closest('.hit');
    if (hit) worker.postMessage({ cmd: 'pick', idx: +hit.dataset.i });
  });
  $('#frontTableBtn')?.addEventListener('click', () => { state.frontTable = !state.frontTable; render(); });
  for (const b of results.querySelectorAll('[data-pick]')) b.addEventListener('click', () => worker.postMessage({ cmd: 'pick', idx: +b.dataset.pick }));
}

// ---------------------------------------------------------------- tabs

function renderTab(p, req) {
  switch (state.tab) {
    case 'budget': return renderBudget(p, req);
    case 'build': return renderBuild(p, req);
    case 'wiring': return renderWiring(p);
    case 'programs': return renderPrograms(p, req);
    case 'method': return renderMethod(req);
    default: return renderOverview(p, req);
  }
}

function wireTab(p, req) {
  if (state.tab === 'overview') {
    for (const b of results.querySelectorAll('[data-swap]')) {
      b.addEventListener('click', () => {
        const slot = b.dataset.swap;
        if (state.swap?.slot === slot) { state.swap = null; render(); return; }
        state.swap = { slot, options: null };
        render();
        worker.postMessage({ cmd: 'swap', idx: p.idx, slot });
      });
    }
    for (const b of results.querySelectorAll('[data-use]')) b.addEventListener('click', () => worker.postMessage({ cmd: 'pick', idx: +b.dataset.use }));
  }
  if (state.tab === 'budget') $('#csv')?.addEventListener('click', () => downloadCsv(p, req));
  if (state.tab === 'programs') {
    for (const b of results.querySelectorAll('[data-file]')) b.addEventListener('click', () => { state.file = +b.dataset.file; render(); });
    $('#zip')?.addEventListener('click', () => {
      const fw = generateFirmware(p.design, req);
      download(new Blob([zip(fw.files.map((f) => ({ path: `robot-programs/${f.path}`, content: f.content })))], { type: 'application/zip' }), 'robot-programs.zip');
    });
    $('#copy')?.addEventListener('click', (e) => {
      navigator.clipboard?.writeText($('pre.code').textContent);
      e.target.textContent = t('Copied');
    });
  }
  if (state.tab === 'build') $('#print')?.addEventListener('click', () => print());
  if (state.tab === 'method') {
    for (const inp of results.querySelectorAll('[data-fx]')) {
      inp.addEventListener('change', () => { fx[inp.dataset.fx] = Number(inp.value) || FX[inp.dataset.fx]; search(); });
    }
    $('#fxReset')?.addEventListener('click', () => { fx = { ...FX }; search(); });
  }
}

function renderOverview(p, req) {
  const d = p.design;
  const s = d.specs;
  const tiles = [];
  if (d.type !== 'arm') {
    tiles.push([`${num(s.mass, 2)} kg`, t('total mass')], [`${num(s.topSpeed, 2)} m/s`, t('top speed, flat')],
      [`${num(s.maxSlope, 0)}°`, t('steepest slope, continuous')], [`${num(s.runtime / 60, 1)} h`, t('runtime (model)')],
      [`${num(s.loadHeadroom, 2)} kg`, t('load headroom')], [`${s.fuse} A`, t('fuse')]);
  }
  if (d.arm) {
    tiles.push([`${num(s.reach * 1000, 0)} mm`, t('full reach')], [t('{n} + gripper', { n: s.axes }), t('axes')],
      [`${num(s.armPayload * 1000, 0)} g`, t('payload at {mm} mm', { mm: num(req.arm.reach * 1000, 0) })], [`${num(s.servoPeak, 1)} A`, t('servo supply peak')]);
  }
  const passed = d.checks.filter((c) => c.severity === 'fail' && c.ok).length;
  const order = (c) => (c.severity === 'info' ? 2 : c.ok ? 1 : 0);
  const rows = [...d.checks].sort((a, b) => order(a) - order(b) || (a.margin ?? 1) - (b.margin ?? 1)).map((c) => {
    const st = c.severity === 'info' ? 'ok' : c.ok ? 'ok' : c.severity === 'warn' ? 'warn' : 'fail';
    const icon = { ok: '✓', warn: '!', fail: '✗' }[st];
    const hasNum = typeof c.value === 'number';
    const m = Math.max(0, Math.min(1, c.margin ?? 1));
    return `<tr>
      <td><span class="status ${st}" aria-label="${esc(t(st === 'ok' ? 'passes' : st === 'warn' ? 'warning' : 'fails'))}">${icon}</span></td>
      <td>${esc(c.label)}${c.detail ? `<br><small>${esc(c.detail)}</small>` : ''}</td>
      <td class="num">${hasNum ? `${esc(unitVal(c.value, c.unit))} ${c.cmp} ${esc(unitVal(c.limit, c.unit))}` : ''}</td>
      <td class="num">${hasNum && c.key ? `<span class="margin${m < 0.15 ? ' tight' : ''}" title="${esc(t('{pct} margin', { pct: pct(c.margin ?? 0) }))}"><i style="width:${m * 100}%"></i></span>` : ''}</td>
    </tr>`;
  }).join('');
  const parts = d.items.filter((i) => part(i.id).cat !== 'tool').map((i) => `<tr><td>${esc(i.role)}</td><td>${i.qty} × ${esc(part(i.id).name)}</td></tr>`).join('');
  const warns = d.checks.filter((c) => c.severity === 'warn' && !c.ok)
    .map((c) => `<div class="callout warn"><b>${esc(c.label)}.</b> ${esc(c.detail ?? '')}</div>`).join('');
  return `
    <div class="tiles">${tiles.map(([v, l]) => `<div class="tile"><div class="v">${esc(v)}</div><div class="l">${esc(l)}</div></div>`).join('')}</div>
    ${warns}
    <h3>${esc(t('Parts'))}</h3>
    <div class="table-scroll"><table><tbody>${parts}</tbody></table></div>
    <h3 style="margin-top:18px">${esc(t('Try another part'))}</h3>
    <p class="fine">${esc(t('Swap one part and keep the rest: what each alternative costs, how much headroom it leaves, and for those that do not work, which check stops them.'))}</p>
    ${renderSwaps(p, req)}
    <h3 style="margin-top:18px">${esc(t('Engineering checks ({n} passed)', { n: passed }))}</h3>
    <div class="table-scroll"><table><thead><tr><th></th><th>${esc(t('Check'))}</th><th class="num">${esc(t('Value vs limit'))}</th><th class="num">${esc(t('Margin'))}</th></tr></thead><tbody>${rows}</tbody></table></div>`;
}

function renderSwaps(p, req) {
  const d = p.design;
  const slots = SWAP_SLOTS[req.type].filter((sl) => d.slots?.[sl]);
  const rows = slots.map((slot) => {
    const open = state.swap?.slot === slot;
    let body = '';
    if (open) {
      const opts = state.swap.options;
      if (!opts) body = `<div class="swap"><span class="spinner"></span>${esc(t('Checking the alternatives…'))}</div>`;
      else if (!opts.length) body = `<div class="swap">${esc(t('No other part from the catalog fits this slot of this design.'))}</div>`;
      else {
        body = `<div class="swap"><table><tbody>${opts.map((o) => (o.ok ? `<tr><td>${esc(o.name)}</td>
          <td class="num ${o.delta > 0 ? 'delta-up' : 'delta-down'}">${o.delta == null ? '–' : `${o.delta > 0 ? '+' : '−'}${money(Math.abs(o.delta), p.price.currency)}`}</td>
          <td class="num">${esc(t('Headroom'))} ${pct(Math.max(0, o.robust))}</td>
          <td class="num"><button class="small-btn" type="button" data-use="${o.idx}">${esc(t('Use this'))}</button></td></tr>`
          : `<tr class="no"><td>${esc(o.name)}</td><td colspan="3">✗ ${esc(o.fails.join('; '))}</td></tr>`)).join('')}</tbody></table></div>`;
      }
    }
    return `<tr><td>${esc(t(SLOT_LABEL[slot]))}</td><td>${esc(slotValue(d, slot))}</td>
      <td class="num"><button class="small-btn" type="button" data-swap="${slot}" aria-expanded="${open}">${esc(open ? t('Close') : t('Alternatives'))}</button></td></tr>
      ${open ? `<tr><td colspan="3">${body}</td></tr>` : ''}`;
  }).join('');
  return `<div class="table-scroll"><table><tbody>${rows}</tbody></table></div>`;
}

function renderBudget(p, req) {
  const price = p.price;
  const r = REGIONS[req.region];
  const m = (v) => money(v, price.currency);
  let rows = '';
  for (const c of price.parcels) {
    const v = VENDORS[c.vendor];
    rows += `<tr class="parcel"><td colspan="3"><a href="${esc(v.url)}" target="_blank" rel="noopener">${esc(v.name)}</a> <small>· ${esc(t(MODE_LABEL[c.mode]))} · ${esc(t('{a}–{b} days', { a: c.days[0], b: c.days[1] }))}</small></td><td class="num">${m(c.total)}</td></tr>`;
    for (const l of c.lines) {
      rows += `<tr><td>${esc(part(l.id).name)}<br><small>${esc(l.role ?? '')}</small></td><td class="num">${l.qty}</td><td class="num">${m(l.unitNet * (1 + r.vat))}</td><td class="num">${m(l.lineNet * (1 + r.vat))}</td></tr>`;
    }
    rows += `<tr class="sub"><td colspan="3">${esc(c.freeShip ? t('Shipping (free above the threshold)') : t('Shipping'))}</td><td class="num">${m(c.shipping * (1 + r.vat))}</td></tr>`;
    if (c.duty) rows += `<tr class="sub"><td colspan="3">${esc(t('Customs duty (incl. VAT on it)'))}</td><td class="num">${m(c.duty * (1 + r.vat))}</td></tr>`;
    if (c.fees) rows += `<tr class="sub"><td colspan="3">${esc(t('Carrier clearance fee'))}</td><td class="num">${m(c.fees)}</td></tr>`;
  }
  const contingency = price.total * 0.1;
  return `
    <div class="tiles">
      <div class="tile"><div class="v">${m(price.total)}</div><div class="l">${esc(t('landed total, everything included'))}</div></div>
      <div class="tile"><div class="v">${m(price.vat)}</div><div class="l">${esc(t('of which VAT ({pct} %)', { pct: num(r.vat * 100, 0) }))}</div></div>
      <div class="tile"><div class="v">${m(price.shipping + price.duty + price.fees)}</div><div class="l">${esc(t('shipping, duty and fees (ex VAT)'))}</div></div>
      <div class="tile"><div class="v">≈ ${esc(t('{days} days', { days: price.days }))}</div><div class="l">${esc(t('until the last parcel arrives'))}</div></div>
    </div>
    <div class="callout info">${esc(t(r.note))}</div>
    <div class="table-scroll"><table>
      <thead><tr><th>${esc(t('Item'))}</th><th class="num">${esc(t('Qty'))}</th><th class="num">${esc(t('Unit incl. VAT'))}</th><th class="num">${esc(t('Total incl. VAT'))}</th></tr></thead>
      <tbody>${rows}
        <tr class="total"><td colspan="3">${esc(t('Total'))}</td><td class="num">${m(price.total)}</td></tr>
        <tr class="sub"><td colspan="3">${esc(t('Suggested contingency (spare jumper wires, a second fuse, a broken part): 10 %'))}</td><td class="num">${m(contingency)}</td></tr>
      </tbody></table></div>
    <div class="row no-print"><button class="small-btn" id="csv" type="button">${esc(t('Download CSV'))}</button>
    <small>${esc(t('Prices are indicative catalog listings of {date} at the exchange rates in Method & assumptions; confirm each item on the vendor\'s site.', { date: CATALOG_DATE }))}</small></div>`;
}

function downloadCsv(p, req) {
  const r = REGIONS[req.region];
  const cur = p.price.currency;
  const lines = [[t('vendor'), t('item'), t('role'), t('qty'), `${t('unit incl VAT')} (${cur})`, `${t('total incl VAT')} (${cur})`, t('tax mode')]];
  for (const c of p.price.parcels) {
    for (const l of c.lines) {
      lines.push([VENDORS[c.vendor].name, part(l.id).name, l.role ?? '', l.qty, (l.unitNet * (1 + r.vat)).toFixed(2),
        (l.lineNet * (1 + r.vat)).toFixed(2), c.mode]);
    }
    lines.push([VENDORS[c.vendor].name, t('shipping'), '', '', '', (c.shipping * (1 + r.vat)).toFixed(2), c.mode]);
    if (c.duty) lines.push([VENDORS[c.vendor].name, t('customs duty incl VAT'), '', '', '', (c.duty * (1 + r.vat)).toFixed(2), c.mode]);
    if (c.fees) lines.push([VENDORS[c.vendor].name, t('clearance fee'), '', '', '', c.fees.toFixed(2), c.mode]);
  }
  lines.push(['', t('TOTAL'), '', '', '', p.price.total.toFixed(2), '']);
  const csv = lines.map((l) => l.map((x) => `"${String(x).replace(/"/g, '""')}"`).join(',')).join('\n');
  download(new Blob([csv], { type: 'text/csv' }), 'robot-budget.csv');
}

function renderBuild(p, req) {
  const g = buildGuide(p.design, req);
  const steps = g.steps.map((s) => `<li>
      <h3>${esc(s.title)} <small>≈ ${duration(s.minutes)}</small></h3>
      ${s.warn ? `<div class="callout warn">⚠ ${esc(s.warn)}</div>` : ''}
      <ul>${s.body.map((b) => `<li>${esc(b)}</li>`).join('')}</ul>
      ${s.check ? `<div class="check-line">✓ ${esc(t('Before moving on:'))} ${esc(s.check)}</div>` : ''}
    </li>`).join('');
  return `
    <div class="tiles">
      <div class="tile"><div class="v">≈ ${num(g.total / 60, 1)} h</div><div class="l">${esc(t('building time, first build'))}</div></div>
      <div class="tile"><div class="v">${g.steps.length}</div><div class="l">${esc(t('steps'))}</div></div>
    </div>
    <h3>${esc(t('Tools'))}</h3><ul>${g.tools.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>
    <div class="row no-print"><button class="small-btn" id="print" type="button">${esc(t('Print the guide'))}</button></div>
    <ol class="steps">${steps}</ol>`;
}

const WIRE = { red: 'red', black: 'black', blue: 'blue', yellow: 'yellow', jumper: 'jumper' };

function renderWiring(p) {
  const d = p.design;
  const w = wiring(d);
  const groups = ['Power', 'Motors', 'Servos', 'Signals'];
  const tables = groups.map((g) => {
    const rows = w.rows.filter((r) => r.group === g);
    if (!rows.length) return '';
    return `<h3 style="margin-top:16px">${esc(t(g))}</h3><div class="table-scroll"><table><thead><tr><th>${esc(t('From'))}</th><th>${esc(t('To'))}</th><th>${esc(t('Wire'))}</th><th>${esc(t('Note'))}</th></tr></thead><tbody>${
      rows.map((r) => `<tr><td>${esc(r.from)}</td><td>${esc(r.to)}</td><td>${esc(WIRE[r.wire] ? t(r.wire) : r.wire)}</td><td><small>${esc(r.note)}</small></td></tr>`).join('')}</tbody></table></div>`;
  }).join('');
  const hasSignals = Object.keys(d.pins?.map ?? {}).length || d.arm;
  return `
    <h3>${esc(t('Power'))}</h3><div class="diagram-scroll">${powerDiagram(d)}</div>
    ${hasSignals ? `<h3>${esc(t('Signals'))}</h3><div class="diagram-scroll">${signalDiagram(d)}</div>` : ''}
    ${w.dividers.length ? `<div class="callout warn">${esc(t('Resistor dividers needed (1 kΩ in series, 2 kΩ to ground) for: {list}.', { list: w.dividers.join(', ') }))}</div>` : ''}
    ${tables}`;
}

function renderPrograms(p, req) {
  const fw = generateFirmware(p.design, req);
  const f = fw.files[state.file] ?? fw.files[0];
  return `
    <p>${esc(t('Two Arduino sketches made for this design: run the self-test first, then the robot program. They compile in Arduino IDE 2 with only the {board} board package, no extra libraries.', { board: fw.cfg.board.name }))}${fw.cfg.wifi ? ' ' + esc(t('The robot makes its own Wi-Fi network {ssid}; open http://192.168.4.1 to drive it from a phone.', { ssid: fw.cfg.wifiCred.ssid })) : ''}
    ${lang() === 'en' ? '' : `<small>${esc(t('The programs and their comments are in English, like the Arduino IDE.'))}</small>`}</p>
    <div class="row"><button class="small-btn" id="zip" type="button">${esc(t('Download all (.zip)'))}</button><button class="small-btn" id="copy" type="button">${esc(t('Copy this file'))}</button></div>
    <div class="code-files">${fw.files.map((x, i) => `<button class="small-btn" type="button" data-file="${i}" aria-pressed="${i === state.file}">${esc(x.path)}</button>`).join('')}</div>
    <pre class="code">${esc(f.content)}</pre>`;
}

function renderMethod(req) {
  const r = REGIONS[req.region];
  const kv = [
    [t('Motors'), t('Linear torque–speed line scaled with voltage; the motor voltage is the battery minus the driver\'s drop, capped in firmware at the motor rating. Continuous torque on the slope ≤ 30 % of stall at the battery\'s cut-off voltage; accelerating ≤ 60 %.')],
    [t('Grip'), t('Climbing and accelerating force ≤ tyre friction (μ {mu}) on the weight over the driven wheels.', { mu: Object.values(TERRAIN).map((x) => num(x.mu, 1)).join(' / ') })],
    [t('Runtime'), t('80 % of the battery\'s energy; moving 60 % of the time at 70 % of top speed; drive power ×1.5 (×2.5 for skid steer) for starts and turns. Cheap cells deliver less than their label.')],
    [t('Electrical'), t('Driver voltage range and continuous current per channel; stall current against the driver\'s peak (a warning, since the firmware ramps); regulator input range, dropout and current; battery discharge rating; 3.3 V logic against each board\'s input threshold; enough pins of the right kind.')],
    [t('Arms'), t('Holding torque of each pitch joint ≤ 50 % of the servo\'s stall torque at 6 V, with the payload held horizontally at the required reach; the supply covers every servo holding plus one stalled; the reach is used up to 90 % of full stretch.')],
    [t('Rover + arm'), t('The arm\'s mass rides on the rover; with the arm stretched sideways the centre of mass stays inside ⅔ of the half-track.')],
    [t('Headroom'), t('The margin on a design\'s tightest check: how far it is from failing. A design with 40 % headroom keeps working with cells below their label, a stiff gearbox or a heavier load; one with 5 % may not.')],
    [t('Ranking'), t('Lowest landed cost; the most headroom on the cost–headroom frontier for at most twice that (or within your budget); and, when it is faster, the quickest delivery from vendors that ship within a week.')],
  ];
  return `
    <h3>${esc(t('How a design is found'))}</h3>
    <p>${esc(t('Every compatible combination of chassis, motor, wheel, driver, battery, regulator and controller (and, for arms, frame, servos and power supply) is checked against the limits below. Compatible means the motor fits the chassis mounts, the wheel fits the shaft, and the part is sold by a vendor you allowed. Parts that need soldering are left out when you choose no soldering, and the printed arm when you have no 3D printer.'))}</p>
    <dl class="kv">${kv.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')}</dl>
    <h3 style="margin-top:16px">${esc(t('Prices and taxes in {country}', { country: t(r.name) }))}</h3>
    <p>${esc(t(r.note))} ${esc(t('The vendor mix is optimised exactly: every subset of vendors is tried and each part bought where it lands cheapest, counting each parcel\'s shipping, VAT, duty and clearance fee.'))}</p>
    <p class="fine">${esc(t('Catalog of {date}. Prices are indicative listings for planning, not quotes; vendor ranges, shipping fees and thresholds change. Duty rates are approximate TARIC rates by part type.', { date: CATALOG_DATE }))}</p>
    <h3 style="margin-top:16px">${esc(t('Exchange rates (per 1 EUR)'))}</h3>
    <div class="fx-grid">${['DKK', 'SEK', 'NOK', 'USD'].map((c) => `<label>${c}<input type="number" step="0.01" data-fx="${c}" value="${fx[c]}"></label>`).join('')}</div>
    <div class="row"><button class="small-btn" id="fxReset" type="button">${esc(t('Reset to catalog rates'))}</button></div>`;
}

function renderInfeasible(r) {
  if (r.reason === 'budget') {
    return `<div class="panel"><h2>${esc(t('No design fits the budget'))}</h2>
      <p>${esc(t('{n} designs pass every engineering check, but the cheapest costs {cheapest} landed, above your cap of {cap}.',
        { n: num(r.feasibleCount, 0), cheapest: money(r.cheapest, r.currency), cap: money(r.req.budget, r.currency) }))}</p>
      <p>${esc(t('Raise the cap, allow all vendors, or relax a requirement.'))}</p></div>`;
  }
  const e = r.explain;
  const blockers = e.blockers.map((b) => `<li>${esc(b.label)} <small>(${esc(t('{pct} of combinations', { pct: pct(b.share) }))})</small></li>`).join('');
  const nearest = e.nearest.map((c) => `<li>${esc(c.label)}: ${typeof c.value === 'number' ? esc(t('{value}, limit {limit}', { value: unitVal(c.value, c.unit), limit: unitVal(c.limit, c.unit) })) : esc(c.detail ?? '')}</li>`).join('');
  return `<div class="panel">
    <h2>${esc(t('No combination meets all the requirements'))}</h2>
    <p class="summary-line">${esc(t('{count} combinations checked.', { count: num(r.count, 0) }))}</p>
    ${e.relax.length ? `<h3>${esc(t('What would work'))}</h3><ul>${e.relax.map((x) => `<li>${esc(x.text)}</li>`).join('')}</ul>` : ''}
    <h3>${esc(t('The closest design fails on'))}</h3><ul>${nearest || '<li>–</li>'}</ul>
    <h3>${esc(t('Most common blockers'))}</h3><ul>${blockers}</ul>
    ${e.hints.length ? `<h3>${esc(t('Also worth trying'))}</h3><ul>${e.hints.map((h) => `<li>${esc(h)}</li>`).join('')}</ul>` : ''}
  </div>`;
}

function download(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

// ---------------------------------------------------------------- start

translateStatic();
const m = location.hash.match(/#r=(.+)/);
if (m) { try { writeForm(decode(m[1])); } catch { /* ignore a malformed link */ } }
else if (LANG_REGION[lang()]) writeForm({ region: LANG_REGION[lang()] });
syncForm();
search();
