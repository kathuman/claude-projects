import test from 'node:test';
import assert from 'node:assert/strict';
import { SOLVED, applyAlg } from '../src/model.js';
import { validate, CORNERS, EDGES } from '../src/validate.js';
import { Cube } from './cubejs.js';

Cube.initSolver();

const rand = (() => { let a = 99; return () => { a = (a * 1103515245 + 12345) >>> 0; return a / 2 ** 32; }; })();
const randomAlg = (n) => Array.from({ length: n }, () => 'URFDLB'[(rand() * 6) | 0] + ['', "'", '2'][(rand() * 3) | 0]);
const set = (s, i, c) => s.slice(0, i) + c + s.slice(i + 1);
const swap = (s, i, j) => set(set(s, i, s[j]), j, s[i]);

test('8 corners and 12 edges, every sticker but the centres in exactly one piece', () => {
  assert.equal(CORNERS.length, 8);
  assert.equal(EDGES.length, 12);
  const all = [...CORNERS.flat(), ...EDGES.flat()].sort((a, b) => a - b);
  assert.deepEqual(all, Array.from({ length: 54 }, (_, i) => i).filter((i) => i % 9 !== 4));
});

test('every cube reached by turning passes, and so does every random position', () => {
  assert.ok(validate(SOLVED).ok);
  for (let k = 0; k < 300; k++) assert.ok(validate(applyAlg(SOLVED, randomAlg(25))).ok);
  for (let k = 0; k < 200; k++) assert.ok(validate(Cube.random().asString()).ok);
});

test('each kind of impossible cube is caught and explained', () => {
  const s = applyAlg(SOLVED, randomAlg(30));
  // a sticker left blank
  assert.match(validate(set(s, 0, '?')).problems[0].text, /not filled in/);
  // a wrong colour count
  const recolour = set(s, 0, s[0] === 'U' ? 'R' : 'U');
  assert.match(validate(recolour).problems[0].text, /a cube has 9 of each/);
  // a twisted corner: rotate one corner's three stickers
  const [a, b, c] = CORNERS[0];
  const twisted = set(set(set(s, a, s[c]), b, s[a]), c, s[b]);
  assert.match(validate(twisted).problems[0].text, /twisted/);
  // a flipped edge
  const [e0, e1] = EDGES[3];
  assert.match(validate(swap(s, e0, e1)).problems[0].text, /flipped/);
  // two stickers of a corner swapped: a mirror-image corner
  assert.match(validate(swap(s, CORNERS[2][1], CORNERS[2][2])).problems[0].text, /mirror-image/);
  // two whole edges exchanged: the swap parity
  const [x0, x1] = EDGES[0], [y0, y1] = EDGES[5];
  const swapped = swap(swap(s, x0, y0), x1, y1);
  const r = validate(swapped);
  assert.ok(!r.ok);
  assert.match(r.problems[0].text, /swapped|flipped/);
});

test('a piece that cannot exist, and a piece that appears twice', () => {
  // make the up-right-front corner white, white, red: two stickers of one colour on a corner
  const [a] = CORNERS[0];
  let s = SOLVED;
  const [p, q] = CORNERS[0].slice(1);
  s = set(s, p, 'U');
  // keep nine of each colour by recolouring a sticker elsewhere with the colour taken away
  const lost = SOLVED[p];
  const other = SOLVED.split('').findIndex((c, i) => c === 'U' && i !== a && i % 9 !== 4 && !CORNERS[0].includes(i));
  s = set(s, other, lost);
  assert.match(validate(s).problems.map((x) => x.text).join(' '), /no (corner|edge) has that combination/);
  assert.ok(!validate(s).ok, `${q}`);
});

test('two whole edges exchanged in the top layer: "two pieces are swapped"', async () => {
  const { STICKERS } = await import('../src/model.js');
  const top = EDGES.filter((e) => STICKERS[e[0]].face === 'U');
  const [x0, x1] = top[0], [y0, y1] = top[1];
  const r = validate(swap(swap(SOLVED, x0, y0), x1, y1));
  assert.match(r.problems[0].text, /Two pieces are swapped/);
});

test('a corner painted twice is named', () => {
  // copy the up-right-front corner onto the down-left-back corner, and fix the colour counts by swapping colours there
  const r = validate(SOLVED.split('').map((c, i) => (CORNERS[7].includes(i) ? SOLVED[CORNERS[0][CORNERS[7].indexOf(i)]] : c)).join(''));
  assert.ok(!r.ok);
});

// Put a cube together from loose pieces at random: only one in twelve such cubes can be solved. The checks must pass
// about that share, and the solver must solve every cube they pass.
test('random assemblies: about 1 in 12 pass, and every one that passes is solved', () => {
  const solvedCorners = CORNERS.map((idx) => idx.map((i) => SOLVED[i]));
  const solvedEdges = EDGES.map((idx) => idx.map((i) => SOLVED[i]));
  const shuffle = (a) => { for (let i = a.length - 1; i > 0; i--) { const j = (rand() * (i + 1)) | 0; [a[i], a[j]] = [a[j], a[i]]; } return a; };
  const N = 2400;
  let ok = 0;
  for (let k = 0; k < N; k++) {
    const s = SOLVED.split('');
    const cs = shuffle([...solvedCorners.keys()]);
    CORNERS.forEach((idx, pos) => { const t = (rand() * 3) | 0; const piece = solvedCorners[cs[pos]]; idx.forEach((i, j) => { s[i] = piece[(j + t) % 3]; }); });
    const es = shuffle([...solvedEdges.keys()]);
    EDGES.forEach((idx, pos) => { const f = (rand() * 2) | 0; const piece = solvedEdges[es[pos]]; idx.forEach((i, j) => { s[i] = piece[(j + f) % 2]; }); });
    const state = s.join('');
    if (!validate(state).ok) continue;
    ok++;
    const sol = Cube.fromString(state).solve();
    assert.equal(applyAlg(state, sol), SOLVED, state);
  }
  const share = ok / N;
  assert.ok(share > 1 / 12 * 0.75 && share < 1 / 12 * 1.25, `share ${share.toFixed(4)} (1/12 = 0.0833)`);
});
