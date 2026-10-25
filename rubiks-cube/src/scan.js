// Reading a cube's colours from camera pictures. Each face is held up to the camera in a set way, nine colours are
// sampled from a 3×3 grid, and when all six faces are in, every sticker is matched to the centre it looks most like.
// Lighting changes between faces and white, yellow, orange and red can look alike, so the matching works in CIELAB
// (closer to how people see colour), gives lightness less weight than hue, and fills each colour exactly nine times:
// the closest pairs are taken first. Nothing leaves the device; this is plain arithmetic on pixels.

// The order the faces are shown, and how to hold the cube for each, so that the stickers land in the model's order
// (each face as drawn on the net). Colour names assume the usual scheme; the scan itself only compares with centres.
export const HOLDS = [
  { face: 'U', show: 'white', top: 'blue' },
  { face: 'R', show: 'red', top: 'white' },
  { face: 'F', show: 'green', top: 'white' },
  { face: 'D', show: 'yellow', top: 'green' },
  { face: 'L', show: 'orange', top: 'white' },
  { face: 'B', show: 'blue', top: 'white' },
];

const lin = (c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
const f = (t) => (t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116);
export function lab([r, g, b]) {
  const R = lin(r), G = lin(g), B = lin(b);
  const X = (0.4124 * R + 0.3576 * G + 0.1805 * B) / 0.95047;
  const Y = 0.2126 * R + 0.7152 * G + 0.0722 * B;
  const Z = (0.0193 * R + 0.1192 * G + 0.9505 * B) / 1.08883;
  return [116 * f(Y) - 16, 500 * (f(X) - f(Y)), 200 * (f(Y) - f(Z))];
}
const dist = (a, b) => Math.hypot(0.5 * (a[0] - b[0]), a[1] - b[1], a[2] - b[2]);

// Nine colours from one picture: the median of the middle of each cell of a square grid.
// data: RGBA pixels (width × height); grid: { x, y, size } in pixels.
export function sampleFace(data, width, grid) {
  const out = [];
  const cell = grid.size / 3;
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) {
    const x0 = Math.round(grid.x + (c + 0.3) * cell), x1 = Math.round(grid.x + (c + 0.7) * cell);
    const y0 = Math.round(grid.y + (r + 0.3) * cell), y1 = Math.round(grid.y + (r + 0.7) * cell);
    const ch = [[], [], []];
    for (let y = y0; y < y1; y += 2) for (let x = x0; x < x1; x += 2) {
      const i = (y * width + x) * 4;
      ch[0].push(data[i]); ch[1].push(data[i + 1]); ch[2].push(data[i + 2]);
    }
    out.push(ch.map((v) => { v.sort((a, b) => a - b); return v[v.length >> 1]; }));
  }
  return out;
}

import { validate } from './validate.js';

const CENTRES = [0, 1, 2, 3, 4, 5].map((k) => k * 9 + 4);
const LETTERS = 'URFDLB';

// Nine of each: the closest (sticker, colour) pairs are taken first; centres keep their own colour.
function assign(points, refs) {
  const out = Array(54).fill(-1);
  const count = Array(6).fill(0);
  CENTRES.forEach((i, k) => { out[i] = k; count[k]++; });
  const pairs = [];
  for (let i = 0; i < 54; i++) if (out[i] < 0) for (let k = 0; k < 6; k++) pairs.push([dist(points[i], refs[k]), i, k]);
  pairs.sort((a, b) => a[0] - b[0]);
  for (const [, i, k] of pairs) if (out[i] < 0 && count[k] < 9) { out[i] = k; count[k]++; }
  return out;
}

/**
 * Match 54 sampled colours (RGB, in the model's sticker order) to the six centres.
 * Returns { state, confidence: [per sticker, 0..1] }: the sticker letters and how clearly each one matched.
 */
export function classify(rgb) {
  const raw = rgb.map(lab);
  let points = raw;
  // first guess: compare with the centres as photographed
  let refs = CENTRES.map((i) => raw[i]);
  let out = assign(points, refs);
  // then refine: each colour's reference becomes the average of its nine stickers (seen under six different lights),
  // and each face's own shift in lighting (how far its stickers sit, on average, from their colours' references) is
  // taken out before matching again
  for (let it = 0; it < 8; it++) {
    refs = [0, 1, 2, 3, 4, 5].map((k) => {
      const m = [0, 0, 0]; let n = 0;
      points.forEach((p, i) => { if (out[i] === k) { m[0] += p[0]; m[1] += p[1]; m[2] += p[2]; n++; } });
      return m.map((v) => v / n);
    });
    points = raw.map((p) => p.slice());
    for (let f = 0; f < 6; f++) {
      const shift = [0, 0, 0];
      for (let j = 0; j < 9; j++) { const i = f * 9 + j; for (let c = 0; c < 3; c++) shift[c] += (raw[i][c] - refs[out[i]][c]) / 9; }
      for (let j = 0; j < 9; j++) { const i = f * 9 + j; for (let c = 0; c < 3; c++) points[i][c] = raw[i][c] - shift[c]; }
    }
    const next = assign(points, refs);
    if (next.every((k, i) => k === out[i])) break;
    out = next;
  }
  // confidence: how much nearer the chosen colour is than the next nearest
  const confidence = out.map((k, i) => {
    const d = refs.map((r) => dist(points[i], r));
    const other = Math.min(...d.filter((_, j) => j !== k));
    return Math.max(0, Math.min(1, (other - d[k]) / (other + 1e-9)));
  });
  let state = out.map((k) => LETTERS[k]).join('');
  // A misreading usually makes a piece that cannot exist (most often one red and one orange traded). If the reading is
  // impossible, try exchanging the colours of two of the least certain stickers, and keep the exchange that costs
  // least and makes a real cube.
  let repaired = [];
  if (!validate(state).ok) {
    const doubtful = confidence.map((c, i) => [c, i]).filter(([, i]) => !CENTRES.includes(i)).sort((a, b) => a[0] - b[0]).slice(0, 14).map(([, i]) => i);
    let best = null;
    for (let a = 0; a < doubtful.length; a++) for (let b = a + 1; b < doubtful.length; b++) {
      const i = doubtful[a], j = doubtful[b];
      if (out[i] === out[j]) continue;
      const cost = dist(points[i], refs[out[j]]) + dist(points[j], refs[out[i]]) - dist(points[i], refs[out[i]]) - dist(points[j], refs[out[j]]);
      if (best && cost >= best.cost) continue;
      const t = state.split(''); [t[i], t[j]] = [t[j], t[i]];
      const cand = t.join('');
      if (validate(cand).ok) best = { cost, cand, i, j };
    }
    if (best) { state = best.cand; repaired = [best.i, best.j]; repaired.forEach((i) => { confidence[i] = 0; }); }
  }
  return { state, confidence, repaired };
}
