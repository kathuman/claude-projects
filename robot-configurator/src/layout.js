// What the robot looks like, drawn from its parts: a top view of a rover with every board and the battery placed on
// the chassis plate (and a second deck when they do not fit), the power wiring along that layout, and a side view of
// an arm in its home pose with its reach. Board sizes are typical module footprints, so the drawing is a guide to
// fitting and wiring, not a mechanical drawing.

import { part } from './catalog.js';
import { BOARDS } from './pins.js';
import { t, num } from './i18n.js';

// Top-view footprints in mm (length × width as the module usually lies), by part id; `cat` defaults below.
export const FOOTPRINT = {
  'uno-r3': [69, 53], 'uno-clone': [69, 53], 'nano-clone': [45, 18], 'esp32-devkit': [55, 28],
  l298n: [43, 43], tb6612: [25, 20], drv8833: [20, 15], mdd10a: [84, 62], bts7960: [50, 50],
  'buck-lm2596': [43, 21], 'buck-mp1584': [22, 17], 'buck-xl4015': [51, 26], 'buck-xl4016': [65, 47], 'ubec-5a': [45, 25],
  'reg-s13v30f5': [23, 18],
  'batt-6aa-nimh': [58, 48], 'batt-2s-18650': [70, 38], 'batt-3s-18650': [70, 57], 'pack-2s-18650': [77, 41],
  'pack-3s-18650': [77, 60], 'batt-2s-lipo-2200': [105, 34], 'batt-3s-lipo-2200': [105, 34], 'batt-3s-lipo-5000': [155, 48],
  'breadboard-mini': [47, 35], hc05: [28, 15], mpu6050: [21, 16], pca9685: [62, 25], 'switch-fuse': [30, 20],
  hcsr04: [45, 20], 'line-5ch': [100, 20],
};
const CAT_FOOTPRINT = { mcu: [55, 30], driver: [30, 25], regulator: [40, 20], battery: [80, 40], sensor: [25, 20], misc: [30, 20] };
export const footprint = (id) => FOOTPRINT[id] ?? CAT_FOOTPRINT[part(id).cat] ?? [30, 20];

const GAP = 6; // mm between modules and to the plate edge
const WHEEL_W = 26;

// What sits on the deck, in the order it is placed: the battery first (low and central), then the boards by size.
function deckItems(design) {
  const p = design.parts;
  const out = [];
  const add = (id, label, kind, n = 1) => { for (let i = 0; i < n; i++) out.push({ id, label, kind }); };
  if (p.battery) add(p.battery.id, t('Battery'), 'battery');
  if (p.battery) add('switch-fuse', t('Switch + fuse'), 'misc'); // beside the battery, in its + lead
  add(p.mcu.id, BOARDS[design.board].name, 'mcu');
  if (p.driver) add(p.driver.id, p.driver.name.split(' ')[0], 'driver', design.ev?.perf.units ?? 1);
  if (p.reg) add(p.reg.id, p.reg.name.split(' ')[0], 'reg');
  if (p.servoReg) add(p.servoReg.id, `${p.servoReg.name.split(' ')[0]} (6 V)`, 'reg');
  add('breadboard-mini', t('Breadboard (power rails)'), 'misc');
  if (design.arm) add('pca9685', 'PCA9685', 'driver');
  if (design.bt) add('hc05', 'HC-05', 'sensor');
  if (design.ev?.sensors?.includes('mpu6050')) add('mpu6050', 'MPU-6050', 'sensor');
  return out;
}

// Placement: the battery (when first) goes in the middle, low and central; every other module takes the first free spot
// on a 5 mm grid, rear to front, lying whichever way fits. Returns what was placed and what did not fit.
const overlaps = (r, q) => r.x < q.x + q.l + GAP && q.x < r.x + r.l + GAP && r.y < q.y + q.w + GAP && q.y < r.y + r.w + GAP;
function pack(items, W, L, start = []) {
  const placed = [...start];
  const left = [];
  for (const it of items) {
    const [a, b] = footprint(it.id);
    let spot = null;
    if (it.kind === 'battery') {
      for (const [l, w] of [[a, b], [b, a]]) {
        const r = { ...it, l, w, x: (L - l) / 2, y: (W - w) / 2 };
        if (l <= L - 2 * GAP && w <= W - 2 * GAP && !placed.some((q) => overlaps(r, q))) { spot = r; break; }
      }
    }
    for (let x = GAP; !spot && x <= L - GAP; x += 5) {
      for (let y = GAP; !spot && y <= W - GAP; y += 5) {
        for (const [l, w] of [[a, b], [b, a]]) {
          const r = { ...it, l, w, x, y };
          if (x + l <= L - GAP && y + w <= W - GAP && !placed.some((q) => overlaps(r, q))) { spot = r; break; }
        }
      }
    }
    if (spot) placed.push(spot); else left.push(it);
  }
  return { placed, left };
}

// The rover seen from above. Coordinates in mm: x along the chassis (0 = rear), y across (0 = left side).
export function roverLayout(design) {
  const c = design.parts.chassis;
  const L = Math.round(c.length * 1000);
  const W = Math.round(c.track * 1000) - WHEEL_W - 4; // the plate sits between the wheels
  const D = Math.round(design.parts.wheel.diameter * 1000);
  const wheels = [];
  const xs = c.driven === 4 ? [D / 2 + 4, L - D / 2 - 4] : [L * 0.3];
  for (const x of xs) for (const side of [-1, 1]) wheels.push({ x, y: side < 0 ? -WHEEL_W / 2 - 2 : W + WHEEL_W / 2 + 2, d: D, w: WHEEL_W });
  const caster = c.driven === 4 ? null : { x: L - 18, y: W / 2 };
  // an arm on top takes the middle of the deck first
  const start = [];
  let armBase = null;
  if (design.arm) {
    const s = design.arm.frame.size === 'micro' ? 70 : 110;
    armBase = { id: 'arm', label: t('Arm base'), kind: 'arm', x: (L - s) / 2, y: (W - s) / 2, l: s, w: s };
    start.push(armBase);
  }
  const first = pack(deckItems(design), W, L, start);
  let second = null;
  if (first.left.length) second = pack(first.left, W, L);
  const area = (list) => list.reduce((s, r) => s + r.l * r.w, 0);
  const placed = first.placed.filter((r) => r.kind !== 'arm');
  return {
    L, W, wheels, caster, armBase,
    deck1: placed, deck2: second ? second.placed : [], unplaced: second ? second.left : [],
    fill: area(first.placed) / (L * W),
    front: design.ev?.sensors?.includes('hcsr04') ? { id: 'hcsr04', label: 'HC-SR04', x: L, y: W / 2 - 22, l: 20, w: 45 } : null,
    under: design.ev?.sensors?.includes('line-5ch') ? { id: 'line-5ch', label: t('Line sensor (underneath)'), x: L - 30, y: W / 2 - 50, l: 20, w: 100 } : null,
  };
}

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const ctr = (r) => [r.x + r.l / 2, r.y + r.w / 2];

// Top view: chassis plate, wheels, caster, the modules on the first deck, the power wiring between them, and the second
// deck (when needed) drawn beside the first.
export function roverTopView(design, lay = roverLayout(design)) {
  const S = 2; // px per mm
  const pad = 30;
  const deckH = (lay.W + 2 * WHEEL_W + 8) * S + 90; // one deck with its wheels, dimensions and title
  const twoDecks = lay.deck2.length > 0;
  const Wpx = pad * 2 + lay.L * S + (lay.front ? 50 : 0);
  const Hpx = pad + deckH * (twoDecks ? 2 : 1) + 20;
  const X = (x) => pad + x * S;
  const Y = (y, deck = 0) => pad + 26 + deck * deckH + (WHEEL_W + 4) * S + y * S;
  const o = [];
  const title = (text, deck) => o.push(`<text class="title" x="${pad}" y="${pad + deck * deckH + 8}">${esc(text)}</text>`);
  // a module: its box, and a label that shrinks to fit the box
  const box = (r, deck, cls) => {
    const w = r.l * S;
    const fs = Math.max(7, Math.min(12, (w - 6) / (r.label.length * 0.6)));
    return `<rect class="mod ${cls}" x="${X(r.x)}" y="${Y(r.y, deck)}" width="${w}" height="${r.w * S}" rx="4"/>`
      + `<text class="mod-label" x="${X(r.x) + w / 2}" y="${Y(r.y, deck) + (r.w * S) / 2 + fs / 3}" text-anchor="middle" style="font-size:${fs.toFixed(1)}px">${esc(r.label)}</text>`;
  };
  const deck = (n, items) => {
    o.push(`<rect class="plate" x="${X(0)}" y="${Y(0, n)}" width="${lay.L * S}" height="${lay.W * S}" rx="10"/>`);
    if (n === 0) {
      for (const w of lay.wheels) {
        o.push(`<rect class="wheel" x="${X(w.x - w.d / 2)}" y="${Y(w.y - w.w / 2)}" width="${w.d * S}" height="${w.w * S}" rx="6"/>`);
      }
      if (lay.caster) o.push(`<circle class="caster" cx="${X(lay.caster.x)}" cy="${Y(lay.caster.y)}" r="${9 * S}"/>`);
      if (lay.under) o.push(`<rect class="under" x="${X(lay.under.x)}" y="${Y(lay.under.y)}" width="${lay.under.l * S}" height="${lay.under.w * S}" rx="3"/>`);
    }
  };
  title(twoDecks ? t('First deck') : t('Top view'), 0);
  deck(0, lay.deck1);
  // power wiring on the first deck, drawn under the modules with right-angled runs between their centres
  const on1 = (kind, id) => lay.deck1.find((r) => (id ? r.id === id : r.kind === kind));
  const at = (r) => [X(ctr(r)[0]), Y(ctr(r)[1])];
  const wire = (a, b, cls) => {
    if (!a || !b) return;
    const [x1, y1] = at(a);
    const [x2, y2] = at(b);
    o.push(`<path class="pwire ${cls}" d="M${x1} ${y1} H${x2} V${y2}"/>`);
  };
  const batt = on1('battery');
  const sw = on1(null, 'switch-fuse');
  const rails = on1(null, 'breadboard-mini');
  wire(batt, sw, 'w-batt');
  wire(sw, rails, 'w-batt');
  for (const d of lay.deck1.filter((r) => r.kind === 'driver' && r.id !== 'pca9685')) wire(rails, d, 'w-batt');
  for (const r of lay.deck1.filter((x) => x.kind === 'reg')) wire(rails, r, 'w-batt');
  wire(on1('reg'), on1('mcu'), 'w-5v');
  const drv = lay.deck1.find((r) => r.kind === 'driver' && r.id !== 'pca9685');
  if (drv) {
    for (const w of lay.wheels) {
      const [x1, y1] = at(drv);
      o.push(`<path class="pwire w-motor" d="M${x1} ${y1} H${X(w.x)} V${Y(w.y < 0 ? 0 : lay.W)}"/>`);
    }
  }
  if (lay.armBase) o.push(box(lay.armBase, 0, 'arm'));
  for (const r of lay.deck1) o.push(box(r, 0, r.kind));
  if (lay.front) o.push(box(lay.front, 0, 'sensor'));
  o.push(`<text class="dim" x="${X(0)}" y="${Y(lay.W) + (WHEEL_W + 4) * S + 22}">${num(lay.L, 0)} × ${num(lay.W, 0)} mm ${esc(t('plate'))} · ${esc(t('front'))} →</text>`);
  if (twoDecks) {
    title(t('Second deck, on standoffs above the first'), 1);
    deck(1, lay.deck2);
    for (const r of lay.deck2) o.push(box(r, 1, r.kind));
  }
  return `<svg class="drawing" viewBox="0 0 ${Wpx} ${Hpx}" role="img" aria-label="${esc(t('Top view of the rover'))}">${o.join('')}</svg>`;
}

// The arm from the side: base, home pose (upper arm vertical, forearm horizontal), the stretched pose, and arcs for
// the full stretch and the reach you asked for. Coordinates in mm from the base's front edge.
export function armSide(frame, req) {
  const L1 = frame.L1 * 1000;
  const L2 = frame.L2 * 1000;
  const T = frame.tool * 1000;
  const H = frame.baseH * 1000;
  const reach = L1 + L2 + T;
  return {
    H, L1, L2, T, reach, want: (req.arm?.reach ?? 0) * 1000,
    home: [[0, H], [0, H + L1], [L2, H + L1], [L2 + T, H + L1]],
    stretched: [[0, H], [L1, H], [L1 + L2, H], [reach, H]],
  };
}

export function armSideView(frame, req, payload = req.arm?.payload ?? 0) {
  const g = armSide(frame, req);
  const S = 1.6;
  const pad = 30;
  const Wmm = g.reach + 60;
  const Hmm = g.H + Math.max(g.L1, g.reach * 0.6) + 40;
  const X = (x) => pad + 30 * S + x * S;
  const Y = (y) => pad + (Hmm - y) * S;
  const Wpx = X(Wmm) + pad;
  const Hpx = Y(0) + 40;
  const line = (pts, cls) => `<path class="${cls}" d="M${pts.map(([x, y]) => `${X(x)} ${Y(y)}`).join(' L')}"/>`;
  const o = [];
  o.push(`<line class="ground" x1="${X(-30)}" y1="${Y(0)}" x2="${X(Wmm)}" y2="${Y(0)}"/>`);
  o.push(`<rect class="mod arm" x="${X(-28)}" y="${Y(g.H)}" width="${56 * S}" height="${g.H * S}" rx="4"/>`);
  const arc = (r, cls) => `<path class="${cls}" d="M${X(r)} ${Y(g.H)} A${r * S} ${r * S} 0 0 0 ${X(r * Math.cos(1.2))} ${Y(g.H + r * Math.sin(1.2))}"/>`;
  o.push(arc(g.reach, 'reach-full'));
  if (g.want) o.push(arc(g.want, 'reach-want'));
  o.push(line(g.stretched, 'link stretched'));
  o.push(line(g.home, 'link'));
  for (const [x, y] of g.home.slice(0, 3)) o.push(`<circle class="joint" cx="${X(x)}" cy="${Y(y)}" r="5"/>`);
  if (g.want) {
    o.push(`<rect class="payload" x="${X(g.want) - 7}" y="${Y(g.H) - 7}" width="14" height="14" rx="2"/>`);
    o.push(`<text class="dim" x="${X(g.want)}" y="${Y(g.H) + 26}" text-anchor="middle">${esc(t('your reach {mm} mm, {g} g', { mm: num(g.want, 0), g: num(payload * 1000, 0) }))}</text>`);
  }
  o.push(`<text class="dim" x="${X(g.reach)}" y="${Y(g.H) - 12}" text-anchor="end">${esc(t('full stretch {mm} mm', { mm: num(g.reach, 0) }))}</text>`);
  o.push(`<text class="dim" x="${X(g.L2 / 2)}" y="${Y(g.H + g.L1) - 10}" text-anchor="middle">${esc(t('home pose'))}</text>`);
  return `<svg class="drawing" viewBox="0 0 ${Wpx} ${Hpx}" role="img" aria-label="${esc(t('Side view of the arm'))}">${o.join('')}</svg>`;
}
