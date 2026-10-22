// The page: the requirements wizard, the proposals, and for the chosen proposal its checks, budget, building
// guide, wiring and programs. The search runs in a worker; everything after it is computed here from the design.

import { CATALOG_DATE, FX, REGIONS, VENDORS, part } from './src/catalog.js';
import { MODE_LABEL } from './src/pricing.js';
import { TERRAIN } from './src/physics.js';
import { BOARDS } from './src/pins.js';
import { buildGuide } from './src/guide.js';
import { wiring, signalDiagram, powerDiagram } from './src/wiring.js';
import { generateFirmware } from './src/firmware.js';
import { zip } from './src/zip.js';

const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const form = $('#wizard');
const results = $('#results');
$('#catDate').textContent = CATALOG_DATE;

const LOCALE = { DK: 'da-DK', SE: 'sv-SE', NO: 'nb-NO' };
let fx = { ...FX };
let state = { result: null, selected: 0, tab: 'overview', file: 0 };

// ---------------------------------------------------------------- theme

const root = document.documentElement;
try { const t = localStorage.getItem('rc-theme'); if (t) root.dataset.theme = t; } catch { /* storage unavailable */ }
$('#theme').addEventListener('click', () => {
  const dark = root.dataset.theme ? root.dataset.theme === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
  root.dataset.theme = dark ? 'light' : 'dark';
  try { localStorage.setItem('rc-theme', root.dataset.theme); } catch { /* storage unavailable */ }
});

// ---------------------------------------------------------------- the request

function readForm() {
  const f = new FormData(form);
  const num = (k) => Number(f.get(k));
  const behaviours = ['remote', 'obstacle', 'line', 'odometry'].filter((b) => f.get(`b-${b}`));
  return {
    region: f.get('region'),
    type: f.get('type'),
    rover: { payload: num('payload'), speed: num('speed'), slope: num('slope'), runtime: num('runtime'),
      terrain: f.get('terrain'), behaviours, accel: 0.5 },
    arm: { reach: num('reach') / 1000, payload: num('armPayload') / 1000, axes: num('axes'), wireless: !!f.get('wireless') },
    controller: f.get('controller'),
    solder: f.get('solder'),
    shopping: f.get('shopping'),
    budget: f.get('budget') === '' ? null : num('budget'),
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
  set('region', req.region);
  set('type', req.type);
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

// ---------------------------------------------------------------- search

let worker = null;
function search({ scroll = false } = {}) {
  const req = readForm();
  history.replaceState(null, '', `#r=${encode(req)}`);
  worker?.terminate();
  worker = new Worker(new URL('./src/worker.js', import.meta.url), { type: 'module' });
  $('#go').disabled = true;
  results.innerHTML = `<div class="panel"><span class="spinner"></span>Checking every compatible combination of parts…</div>`;
  worker.onmessage = (e) => {
    $('#go').disabled = false;
    if (!e.data.ok) {
      results.innerHTML = `<div class="panel callout bad">Something went wrong: <pre>${esc(e.data.error)}</pre></div>`;
      return;
    }
    state = { result: e.data.result, selected: 0, tab: state.tab, file: 0, ms: e.data.ms };
    render();
    // on a phone the results sit below the form
    if (scroll && matchMedia('(max-width: 900px)').matches) results.scrollIntoView({ behavior: 'smooth' });
  };
  worker.postMessage(req);
}
form.addEventListener('submit', (e) => { e.preventDefault(); search({ scroll: true }); });

// ---------------------------------------------------------------- formatting

const money = (v, cur, region) => new Intl.NumberFormat(LOCALE[region] ?? 'en', { style: 'currency', currency: cur,
  maximumFractionDigits: 0 }).format(v);
const fmt = (v, d = 2) => (Number.isFinite(v) ? Number(v).toFixed(d) : '–');
const unitVal = (v, unit) => {
  if (unit === 'm') return `${fmt(v * 1000, 0)} mm`;
  if (unit === 'kg') return `${fmt(v, 2)} kg`;
  if (unit === '') return fmt(v, 2);
  if (unit === 'min') return `${fmt(v, 0)} min`;
  return `${fmt(v, 2)} ${unit}`;
};

// ---------------------------------------------------------------- render

function render() {
  const r = state.result;
  const region = r.req.region;
  if (!r.ok) { results.innerHTML = renderInfeasible(r); return; }
  const props = r.proposals;
  const cards = props.map((p, i) => `
    <button class="proposal" type="button" data-i="${i}" aria-pressed="${i === state.selected}">
      <div class="kind">${esc(p.kinds.map((k) => ({ cheapest: 'Lowest cost', robust: 'Most headroom', fast: 'Quickest delivery' })[k]).join(' · '))}</div>
      <div class="price">${money(p.price.total, p.price.currency, region)}</div>
      <div class="meta">${p.price.parcels.length} parcel${p.price.parcels.length > 1 ? 's' : ''} · arrives in ≈ ${p.price.days} days · tightest margin ${fmt(p.design.robust * 100, 0)} %</div>
      <p class="why">${esc(describe(p.design))}</p>
    </button>`).join('');
  const p = props[state.selected];
  const tabs = [['overview', 'Design & checks'], ['budget', 'Budget'], ['build', 'Build guide'], ['wiring', 'Wiring'],
    ['programs', 'Programs'], ['method', 'Method & assumptions']];
  results.innerHTML = `
    <p class="summary-line">${r.count.toLocaleString('en')} combinations checked, ${r.feasibleCount.toLocaleString('en')} pass every check${state.ms ? ` (${fmt(state.ms / 1000, 1)} s)` : ''}. <a href="${esc(location.href)}" id="share">Link to this request</a></p>
    <div class="proposals">${cards}</div>
    <div class="panel">
      <div class="tabs" role="tablist">${tabs.map(([id, l]) => `<button role="tab" type="button" data-tab="${id}" aria-selected="${state.tab === id}">${l}</button>`).join('')}</div>
      <div id="tabBody">${renderTab(p, r.req)}</div>
    </div>`;
  for (const b of results.querySelectorAll('.proposal')) b.addEventListener('click', () => { state.selected = +b.dataset.i; state.file = 0; render(); });
  for (const b of results.querySelectorAll('[data-tab]')) b.addEventListener('click', () => { state.tab = b.dataset.tab; render(); });
  $('#share').addEventListener('click', (e) => { e.preventDefault(); navigator.clipboard?.writeText(location.href); e.target.textContent = 'Link copied'; });
  wireTab(p, r.req);
}

function describe(d) {
  const p = d.parts;
  const bits = [];
  if (d.type !== 'arm') bits.push(`${p.chassis.name.replace(/\s*\(.*\)/, '')}, ${p.motor.name.split(' ').slice(0, 2).join(' ')} motors, ${p.driver.name.split(' ')[0]}, ${p.battery.name.split(',')[0].replace(/\s*\(.*\)/, '')}`);
  if (d.arm) bits.push(`${d.arm.frame.joints.length}-axis ${d.arm.frame.name.split(' ')[0].toLowerCase()} arm with ${[...new Set(Object.values(d.arm.servos).map((s) => s.name.split(' ')[0]))].join(' + ')}`);
  bits.push(BOARDS[d.board].name);
  return bits.join(' · ');
}

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
  if (state.tab === 'budget') $('#csv')?.addEventListener('click', () => downloadCsv(p, req));
  if (state.tab === 'programs') {
    for (const b of results.querySelectorAll('[data-file]')) b.addEventListener('click', () => { state.file = +b.dataset.file; render(); });
    $('#zip')?.addEventListener('click', () => {
      const fw = generateFirmware(p.design, req);
      download(new Blob([zip(fw.files.map((f) => ({ path: `robot-programs/${f.path}`, content: f.content })))], { type: 'application/zip' }), 'robot-programs.zip');
    });
    $('#copy')?.addEventListener('click', (e) => {
      navigator.clipboard?.writeText($('pre.code').textContent);
      e.target.textContent = 'Copied';
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
    tiles.push([`${fmt(s.mass, 2)} kg`, 'total mass'], [`${fmt(s.topSpeed, 2)} m/s`, 'top speed, flat'],
      [`${fmt(s.maxSlope, 0)}°`, 'steepest slope, continuous'], [`${fmt(s.runtime / 60, 1)} h`, 'runtime (model)'],
      [`${fmt(s.loadHeadroom, 2)} kg`, 'load headroom'], [`${s.fuse} A`, 'fuse']);
  }
  if (d.arm) {
    tiles.push([`${fmt(s.reach * 1000, 0)} mm`, 'full reach'], [`${s.axes} + gripper`, 'axes'],
      [`${fmt(s.armPayload * 1000, 0)} g`, `payload at ${fmt(req.arm.reach * 1000, 0)} mm`], [`${fmt(s.servoPeak, 1)} A`, 'servo supply peak']);
  }
  const passed = d.checks.filter((c) => c.severity === 'fail' && c.ok).length;
  const order = (c) => (c.severity === 'info' ? 2 : c.ok ? 1 : 0);
  const rows = [...d.checks].sort((a, b) => order(a) - order(b) || (a.margin ?? 1) - (b.margin ?? 1)).map((c) => {
    const st = c.severity === 'info' ? 'ok' : c.ok ? 'ok' : c.severity === 'warn' ? 'warn' : 'fail';
    const icon = { ok: '✓', warn: '!', fail: '✗' }[st];
    const hasNum = typeof c.value === 'number';
    const m = Math.max(0, Math.min(1, c.margin ?? 1));
    return `<tr>
      <td><span class="status ${st}" aria-label="${st}">${icon}</span></td>
      <td>${esc(c.label)}${c.detail ? `<br><small>${esc(c.detail)}</small>` : ''}</td>
      <td class="num">${hasNum ? `${esc(unitVal(c.value, c.unit))} ${c.cmp} ${esc(unitVal(c.limit, c.unit))}` : ''}</td>
      <td class="num">${hasNum && c.key ? `<span class="margin${m < 0.15 ? ' tight' : ''}" title="${fmt((c.margin ?? 0) * 100, 0)} % margin"><i style="width:${m * 100}%"></i></span>` : ''}</td>
    </tr>`;
  }).join('');
  const parts = d.items.filter((i) => part(i.id).cat !== 'tool').map((i) => `<tr><td>${esc(i.role)}</td><td>${i.qty} × ${esc(part(i.id).name)}</td></tr>`).join('');
  const warns = d.checks.filter((c) => c.severity === 'warn' && !c.ok)
    .map((c) => `<div class="callout warn"><b>${esc(c.label)}.</b> ${esc(c.detail ?? '')}</div>`).join('');
  return `
    <div class="tiles">${tiles.map(([v, l]) => `<div class="tile"><div class="v">${esc(v)}</div><div class="l">${esc(l)}</div></div>`).join('')}</div>
    ${warns}
    <h3>Parts</h3>
    <div class="table-scroll"><table><tbody>${parts}</tbody></table></div>
    <h3 style="margin-top:18px">Engineering checks (${passed} passed)</h3>
    <div class="table-scroll"><table><thead><tr><th></th><th>Check</th><th class="num">Value vs limit</th><th class="num">Margin</th></tr></thead><tbody>${rows}</tbody></table></div>`;
}

function renderBudget(p, req) {
  const price = p.price;
  const region = req.region;
  const r = REGIONS[region];
  const m = (v) => money(v, price.currency, region);
  let rows = '';
  for (const c of price.parcels) {
    const v = VENDORS[c.vendor];
    rows += `<tr class="parcel"><td colspan="3"><a href="${esc(v.url)}" target="_blank" rel="noopener">${esc(v.name)}</a> <small>· ${esc(MODE_LABEL[c.mode])} · ${c.days[0]}–${c.days[1]} days</small></td><td class="num">${m(c.total)}</td></tr>`;
    for (const l of c.lines) {
      rows += `<tr><td>${esc(part(l.id).name)}<br><small>${esc(l.role ?? '')}</small></td><td class="num">${l.qty}</td><td class="num">${m(l.unitNet * (1 + r.vat))}</td><td class="num">${m(l.lineNet * (1 + r.vat))}</td></tr>`;
    }
    rows += `<tr class="sub"><td colspan="3">Shipping${c.freeShip ? ' (free above the threshold)' : ''}</td><td class="num">${m(c.shipping * (1 + r.vat))}</td></tr>`;
    if (c.duty) rows += `<tr class="sub"><td colspan="3">Customs duty (incl. VAT on it)</td><td class="num">${m(c.duty * (1 + r.vat))}</td></tr>`;
    if (c.fees) rows += `<tr class="sub"><td colspan="3">Carrier clearance fee</td><td class="num">${m(c.fees)}</td></tr>`;
  }
  const contingency = price.total * 0.1;
  return `
    <div class="tiles">
      <div class="tile"><div class="v">${m(price.total)}</div><div class="l">landed total, everything included</div></div>
      <div class="tile"><div class="v">${m(price.vat)}</div><div class="l">of which VAT (${r.vat * 100} %)</div></div>
      <div class="tile"><div class="v">${m(price.shipping + price.duty + price.fees)}</div><div class="l">shipping, duty and fees (ex VAT)</div></div>
      <div class="tile"><div class="v">≈ ${price.days} days</div><div class="l">until the last parcel arrives</div></div>
    </div>
    <div class="callout info">${esc(r.note)}</div>
    <div class="table-scroll"><table>
      <thead><tr><th>Item</th><th class="num">Qty</th><th class="num">Unit incl. VAT</th><th class="num">Total incl. VAT</th></tr></thead>
      <tbody>${rows}
        <tr class="total"><td colspan="3">Total</td><td class="num">${m(price.total)}</td></tr>
        <tr class="sub"><td colspan="3">Suggested contingency (spare jumper wires, a second fuse, a broken part): 10 %</td><td class="num">${m(contingency)}</td></tr>
      </tbody></table></div>
    <div class="row no-print"><button class="small-btn" id="csv" type="button">Download CSV</button>
    <small>Prices are indicative catalog listings of ${CATALOG_DATE} at the exchange rates in Method &amp; assumptions; confirm each item on the vendor's site.</small></div>`;
}

function downloadCsv(p, req) {
  const r = REGIONS[req.region];
  const lines = [['vendor', 'item', 'role', 'qty', `unit incl VAT (${p.price.currency})`, `total incl VAT (${p.price.currency})`, 'tax mode']];
  for (const c of p.price.parcels) {
    for (const l of c.lines) {
      lines.push([VENDORS[c.vendor].name, part(l.id).name, l.role ?? '', l.qty, (l.unitNet * (1 + r.vat)).toFixed(2),
        (l.lineNet * (1 + r.vat)).toFixed(2), c.mode]);
    }
    lines.push([VENDORS[c.vendor].name, 'shipping', '', '', '', (c.shipping * (1 + r.vat)).toFixed(2), c.mode]);
    if (c.duty) lines.push([VENDORS[c.vendor].name, 'customs duty incl VAT', '', '', '', (c.duty * (1 + r.vat)).toFixed(2), c.mode]);
    if (c.fees) lines.push([VENDORS[c.vendor].name, 'clearance fee', '', '', '', c.fees.toFixed(2), c.mode]);
  }
  lines.push(['', 'TOTAL', '', '', '', p.price.total.toFixed(2), '']);
  const csv = lines.map((l) => l.map((x) => `"${String(x).replace(/"/g, '""')}"`).join(',')).join('\n');
  download(new Blob([csv], { type: 'text/csv' }), 'robot-budget.csv');
}

function renderBuild(p, req) {
  const g = buildGuide(p.design, req);
  const steps = g.steps.map((s) => `<li>
      <h3>${esc(s.title)} <small>≈ ${s.minutes >= 60 ? `${fmt(s.minutes / 60, 1)} h` : `${s.minutes} min`}</small></h3>
      ${s.warn ? `<div class="callout warn">⚠ ${esc(s.warn)}</div>` : ''}
      <ul>${s.body.map((b) => `<li>${esc(b)}</li>`).join('')}</ul>
      ${s.check ? `<div class="check-line">✓ Before moving on: ${esc(s.check)}</div>` : ''}
    </li>`).join('');
  return `
    <div class="tiles">
      <div class="tile"><div class="v">≈ ${fmt(g.total / 60, 1)} h</div><div class="l">building time, first build</div></div>
      <div class="tile"><div class="v">${g.steps.length}</div><div class="l">steps</div></div>
    </div>
    <h3>Tools</h3><ul>${g.tools.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>
    <div class="row no-print"><button class="small-btn" id="print" type="button">Print the guide</button></div>
    <ol class="steps">${steps}</ol>`;
}

function renderWiring(p) {
  const d = p.design;
  const w = wiring(d);
  const groups = ['Power', 'Motors', 'Servos', 'Signals'];
  const tables = groups.map((g) => {
    const rows = w.rows.filter((r) => r.group === g);
    if (!rows.length) return '';
    return `<h3 style="margin-top:16px">${g}</h3><div class="table-scroll"><table><thead><tr><th>From</th><th>To</th><th>Wire</th><th>Note</th></tr></thead><tbody>${
      rows.map((r) => `<tr><td>${esc(r.from)}</td><td>${esc(r.to)}</td><td>${esc(r.wire)}</td><td><small>${esc(r.note)}</small></td></tr>`).join('')}</tbody></table></div>`;
  }).join('');
  const hasSignals = Object.keys(d.pins?.map ?? {}).length || d.arm;
  return `
    <h3>Power</h3><div class="diagram-scroll">${powerDiagram(d)}</div>
    ${hasSignals ? `<h3>Signals</h3><div class="diagram-scroll">${signalDiagram(d)}</div>` : ''}
    ${w.dividers.length ? `<div class="callout warn">Resistor dividers needed (1 kΩ in series, 2 kΩ to ground) for: ${esc(w.dividers.join(', '))}.</div>` : ''}
    ${tables}`;
}

function renderPrograms(p, req) {
  const fw = generateFirmware(p.design, req);
  const f = fw.files[state.file] ?? fw.files[0];
  return `
    <p>Two Arduino sketches made for this design: run the <b>self-test</b> first, then the <b>robot program</b>. They compile in Arduino IDE 2 with only the ${esc(fw.cfg.board.name)} board package, no extra libraries.${fw.cfg.wifi ? ` The robot makes its own Wi-Fi network <code>${esc(fw.cfg.wifiCred.ssid)}</code>; open <code>http://192.168.4.1</code> to drive it from a phone.` : ''}</p>
    <div class="row"><button class="small-btn" id="zip" type="button">Download all (.zip)</button><button class="small-btn" id="copy" type="button">Copy this file</button></div>
    <div class="code-files">${fw.files.map((x, i) => `<button class="small-btn" type="button" data-file="${i}" aria-pressed="${i === state.file}">${esc(x.path)}</button>`).join('')}</div>
    <pre class="code">${esc(f.content)}</pre>`;
}

function renderMethod(req) {
  const r = REGIONS[req.region];
  return `
    <h3>How a design is found</h3>
    <p>Every compatible combination of chassis, motor, wheel, driver, battery, regulator and controller (and, for arms, frame, servos and power supply) is checked against the limits below. Compatible means the motor fits the chassis mounts, the wheel fits the shaft, and the part is sold by a vendor you allowed. Parts that need soldering are left out when you choose no soldering, and the printed arm when you have no 3D printer.</p>
    <dl class="kv">
      <dt>Motors</dt><dd>Linear torque–speed line scaled with voltage; the motor voltage is the battery minus the driver's drop, capped in firmware at the motor rating. Continuous torque on the slope ≤ 30 % of stall at the battery's cut-off voltage; accelerating ≤ 60 %.</dd>
      <dt>Grip</dt><dd>Climbing and accelerating force ≤ tyre friction (μ ${Object.values(TERRAIN).map((t) => t.mu).join('/')}) on the weight over the driven wheels.</dd>
      <dt>Runtime</dt><dd>80 % of the battery's energy; moving 60 % of the time at 70 % of top speed; drive power ×1.5 (×2.5 for skid steer) for starts and turns. Cheap cells deliver less than their label.</dd>
      <dt>Electrical</dt><dd>Driver voltage range and continuous current per channel; stall current against the driver's peak (a warning, since the firmware ramps); regulator input range, dropout and current; battery discharge rating; 3.3 V logic against each board's input threshold; enough pins of the right kind.</dd>
      <dt>Arms</dt><dd>Holding torque of each pitch joint ≤ 50 % of the servo's stall torque at 6 V, with the payload held horizontally at the required reach; the supply covers every servo holding plus one stalled; the reach is used up to 90 % of full stretch.</dd>
      <dt>Rover + arm</dt><dd>The arm's mass rides on the rover; with the arm stretched sideways the centre of mass stays inside ⅔ of the half-track.</dd>
      <dt>Ranking</dt><dd>Lowest landed cost; largest margin on the tightest check; and, when it is faster, the quickest delivery from vendors that ship within a week.</dd>
    </dl>
    <h3 style="margin-top:16px">Prices and taxes in ${esc(r.name)}</h3>
    <p>${esc(r.note)} The vendor mix is optimised exactly: every subset of vendors is tried and each part bought where it lands cheapest, counting each parcel's shipping, VAT, duty and clearance fee.</p>
    <p class="fine">Catalog of ${CATALOG_DATE}. Prices are indicative listings for planning, not quotes; vendor ranges, shipping fees and thresholds change. Duty rates are approximate TARIC rates by part type.</p>
    <h3 style="margin-top:16px">Exchange rates (per 1 EUR)</h3>
    <div class="fx-grid">${['DKK', 'SEK', 'NOK', 'USD'].map((c) => `<label>${c}<input type="number" step="0.01" data-fx="${c}" value="${fx[c]}"></label>`).join('')}</div>
    <div class="row"><button class="small-btn" id="fxReset" type="button">Reset to catalog rates</button></div>`;
}

function renderInfeasible(r) {
  if (r.reason === 'budget') {
    return `<div class="panel"><h2>No design fits the budget</h2>
      <p>${r.feasibleCount.toLocaleString('en')} designs pass every engineering check, but the cheapest costs <b>${money(r.cheapest, r.currency, r.req.region)}</b> landed, above your cap of ${money(r.req.budget, r.currency, r.req.region)}.</p>
      <p>Raise the cap, allow all vendors, or relax a requirement.</p></div>`;
  }
  const e = r.explain;
  const blockers = e.blockers.map((b) => `<li>${esc(b.label)} <small>(${fmt(b.share * 100, 0)} % of combinations)</small></li>`).join('');
  const nearest = e.nearest.map((c) => `<li>${esc(c.label)}: ${typeof c.value === 'number' ? `${esc(unitVal(c.value, c.unit))}, limit ${esc(unitVal(c.limit, c.unit))}` : esc(c.detail ?? '')}</li>`).join('');
  return `<div class="panel">
    <h2>No combination meets all the requirements</h2>
    <p class="summary-line">${r.count.toLocaleString('en')} combinations checked.</p>
    ${e.relax.length ? `<h3>What would work</h3><ul>${e.relax.map((x) => `<li>${esc(x.text)}</li>`).join('')}</ul>` : ''}
    <h3>The closest design fails on</h3><ul>${nearest || '<li>–</li>'}</ul>
    <h3>Most common blockers</h3><ul>${blockers}</ul>
    ${e.hints.length ? `<h3>Also worth trying</h3><ul>${e.hints.map((h) => `<li>${esc(h)}</li>`).join('')}</ul>` : ''}
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

const m = location.hash.match(/#r=(.+)/);
if (m) { try { writeForm(decode(m[1])); } catch { /* ignore a malformed link */ } }
syncForm();
search();
