// The cube as 54 stickers, written as a string in the order U R F D L B (nine stickers per face, row by row as the
// face is usually drawn on a net), the same convention as the solver (cubejs) and Kociemba's: a solved cube is
// "UUUUUUUUURRRRRRRRRFFFFFFFFFDDDDDDDDDLLLLLLLLLBBBBBBBBB", where each letter names the face whose colour it has.
//
// Moves are worked out from geometry, not typed in: every sticker has a position and an outward direction
// (x right, y up, z towards the viewer), and a move turns the stickers in its layers a quarter turn about its axis.
// This model is independent of the solver, so the tests use it to check the solver's answers.

import { split, parseAlg } from './notation.js';

export const FACES = 'URFDLB';
export const SOLVED = FACES.split('').map((f) => f.repeat(9)).join('');

// Sticker i ↔ { p: position of its cubie, n: outward direction }, for row r and column c of each face.
const GEOM = {
  U: (r, c) => ({ n: [0, 1, 0], p: [c - 1, 1, r - 1] }),
  R: (r, c) => ({ n: [1, 0, 0], p: [1, 1 - r, 1 - c] }),
  F: (r, c) => ({ n: [0, 0, 1], p: [c - 1, 1 - r, 1] }),
  D: (r, c) => ({ n: [0, -1, 0], p: [c - 1, -1, 1 - r] }),
  L: (r, c) => ({ n: [-1, 0, 0], p: [-1, 1 - r, c - 1] }),
  B: (r, c) => ({ n: [0, 0, -1], p: [1 - c, 1 - r, -1] }),
};
export const STICKERS = [];
const INDEX = new Map();
const key = (p, n) => `${p}|${n}`;
for (const f of FACES) for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) {
  const s = GEOM[f](r, c);
  INDEX.set(key(s.p, s.n), STICKERS.length);
  STICKERS.push({ face: f, ...s });
}
export const stickerAt = (p, n) => INDEX.get(key(p, n));

// A quarter turn by +90° (right-hand rule) about an axis.
const ROT = {
  x: ([x, y, z]) => [x, -z, y],
  y: ([x, y, z]) => [z, y, -x],
  z: ([x, y, z]) => [-y, x, z],
};
const AX = { x: 0, y: 1, z: 2 };

// Every move as an axis, the layers it turns (coordinates along the axis) and the angle of its clockwise quarter
// turn: a face turns clockwise as seen from outside that face; a slice follows L (M), D (E) or F (S); a rotation
// follows R (x), U (y) or F (z).
export const MOVES = {
  U: ['y', [1], -1], D: ['y', [-1], 1], R: ['x', [1], -1], L: ['x', [-1], 1], F: ['z', [1], -1], B: ['z', [-1], 1],
  M: ['x', [0], 1], E: ['y', [0], 1], S: ['z', [0], -1],
  x: ['x', [-1, 0, 1], -1], y: ['y', [-1, 0, 1], -1], z: ['z', [-1, 0, 1], -1],
  Uw: ['y', [0, 1], -1], Dw: ['y', [-1, 0], 1], Rw: ['x', [0, 1], -1], Lw: ['x', [-1, 0], 1], Fw: ['z', [0, 1], -1], Bw: ['z', [-1, 0], 1],
};
for (const f of 'urfdlb') MOVES[f] = MOVES[`${f.toUpperCase()}w`];

// The move's axis, layers and signed angle in degrees, for drawing it.
export function turnOf(move) {
  const { base, amount } = split(move);
  const [axis, layers, sign] = MOVES[base];
  return { axis, layers, degrees: amount === 2 ? 180 * sign : 90 * sign * (amount === 3 ? -1 : 1) };
}

// One quarter turn of a base move as a permutation: next[i] = prev[PERM[i]].
const PERM = {};
for (const [base, [axis, layers, sign]] of Object.entries(MOVES)) {
  const rot = (v) => (sign > 0 ? ROT[axis](v) : ROT[axis](ROT[axis](ROT[axis](v))));
  const perm = STICKERS.map((_, i) => i);
  STICKERS.forEach((s, i) => {
    if (!layers.includes(s.p[AX[axis]])) return;
    perm[stickerAt(rot(s.p), rot(s.n))] = i;
  });
  PERM[base] = perm;
}

export function applyMove(state, move) {
  const { base, amount } = split(move);
  const perm = PERM[base];
  let s = state;
  for (let k = 0; k < amount; k++) {
    const prev = s;
    s = perm.map((j) => prev[j]).join('');
  }
  return s;
}

export const applyAlg = (state, alg) => parseAlg(alg).reduce(applyMove, state);

// Solved: every face one colour (in any orientation, so a whole-cube rotation of a solved cube is still solved).
export function isSolved(state) {
  for (let f = 0; f < 6; f++) {
    const face = state.slice(f * 9, f * 9 + 9);
    if (face !== face[4].repeat(9)) return false;
  }
  return true;
}

// The same position seen with the standard orientation (white up, green front): the centres say how the cube is held.
// Returns the state relabelled so each centre carries its own face's letter.
export function normalise(state) {
  const map = {};
  for (let f = 0; f < 6; f++) map[state[f * 9 + 4]] = FACES[f];
  return state.split('').map((ch) => map[ch]).join('');
}

// The 24 ways to hold the cube, as rotations from the standard hold.
export const ROTATIONS = ['', 'x', "x'", 'x2', 'z', "z'"].flatMap((a) => ['', 'y', "y'", 'y2'].map((b) => [a, b].filter(Boolean).join(' ')));

// The rotation that brings a cube held any way back to the standard hold (white centre up, green centre in front),
// so the solver, which expects that hold, can solve it.
export function orientation(state) {
  return ROTATIONS.find((r) => { const s = applyAlg(state, r); return s[4] === 'U' && s[22] === 'F'; });
}

// The move a drag makes: a sticker at cubie position p with outward direction n, dragged along d (one of the two
// axes lying in the sticker's face, with a sign), turns the layer through p about n × d. Returns a move token.
export function dragMove(p, n, d) {
  const r = [n[1] * d[2] - n[2] * d[1], n[2] * d[0] - n[0] * d[2], n[0] * d[1] - n[1] * d[0]];
  const k = r.findIndex((v) => v !== 0);
  if (k < 0) return null;
  const axis = 'xyz'[k];
  const want = Math.sign(r[k]); // +1: a quarter turn by +90° about +axis
  const layer = p[k];
  const base = Object.keys(MOVES).find((b) => MOVES[b][0] === axis && MOVES[b][1].length === 1 && MOVES[b][1][0] === layer);
  return want === MOVES[base][2] ? base : `${base}'`;
}
