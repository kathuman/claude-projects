import test from 'node:test';
import assert from 'node:assert/strict';
import { SOLVED, applyAlg } from '../src/model.js';
import { lab, classify, sampleFace } from '../src/scan.js';
import { validate } from '../src/validate.js';

const rand = (() => { let a = 7; return () => { a = (a * 1103515245 + 12345) >>> 0; return a / 2 ** 32; }; })();
const randomAlg = (n) => Array.from({ length: n }, () => 'URFDLB'[(rand() * 6) | 0] + ['', "'", '2'][(rand() * 3) | 0]);
// typical sticker colours as a phone camera sees them under indoor light
const PAINT = { U: [222, 224, 216], D: [236, 206, 30], F: [24, 160, 76], B: [26, 92, 196], L: [238, 120, 22], R: [196, 30, 46] };

// a cube photographed face by face: each face gets its own lighting (brighter or dimmer, warmer or cooler), and every
// sticker some noise
function photograph(state, { light = 0.25, tint = 12, noise = 10 } = {}) {
  const rgb = [];
  for (let f = 0; f < 6; f++) {
    const k = 1 + (rand() * 2 - 1) * light;
    const warm = (rand() * 2 - 1) * tint;
    for (let j = 0; j < 9; j++) {
      const c = PAINT[state[f * 9 + j]];
      rgb.push(c.map((v, ch) => Math.max(0, Math.min(255, Math.round(v * k + (ch === 0 ? warm : ch === 2 ? -warm : 0) + (rand() * 2 - 1) * noise)))));
    }
  }
  return rgb;
}

test('CIELAB: white is light and neutral, the reference red has a positive a*', () => {
  const [l, a, b] = lab([255, 255, 255]);
  assert.ok(Math.abs(l - 100) < 0.1 && Math.abs(a) < 0.5 && Math.abs(b) < 0.5);
  assert.ok(lab([255, 0, 0])[1] > 60);
});

test('every cube is read back exactly under uneven lighting, nine of each colour', () => {
  let exact = 0;
  for (let k = 0; k < 300; k++) {
    const state = applyAlg(SOLVED, randomAlg(25));
    const { state: got } = classify(photograph(state));
    for (const ch of 'URFDLB') assert.equal(got.split('').filter((c) => c === ch).length, 9);
    if (got === state) exact++;
  }
  assert.ok(exact >= 297, `${exact}/300 read exactly`);
});

// Harsh light (brightness ±40 %, strong colour casts, heavy noise): most cubes still read exactly, and a misreading
// never passes silently: it always makes a cube that fails the checks, so the person is asked to fix it.
test('harsh lighting: most cubes read exactly, and every misreading is caught by the checks', () => {
  let exact = 0, caught = 0;
  for (let k = 0; k < 200; k++) {
    const state = applyAlg(SOLVED, randomAlg(25));
    const { state: got } = classify(photograph(state, { light: 0.4, tint: 25, noise: 18 }));
    if (got === state) exact++;
    else if (!validate(got).ok) caught++;
  }
  assert.ok(exact >= 185, `${exact}/200 exact`);
  assert.equal(exact + caught, 200, 'a misreading that looks like a real cube');
});

test('sampling a picture: nine medians from the middles of a 3×3 grid', () => {
  const W = 90, H = 90;
  const data = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const cell = Math.floor(y / 30) * 3 + Math.floor(x / 30);
    const i = (y * W + x) * 4;
    data[i] = cell * 20; data[i + 1] = 100; data[i + 2] = 255 - cell * 20; data[i + 3] = 255;
  }
  const s = sampleFace(data, W, { x: 0, y: 0, size: 90 });
  assert.deepEqual(s.map((c) => c[0]), [0, 20, 40, 60, 80, 100, 120, 140, 160]);
});
