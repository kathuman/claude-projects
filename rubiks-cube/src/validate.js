// Is a cube someone painted or scanned one that can exist? A cube taken apart and put back together at random can be
// solved only one time in twelve, so a real cube passes four checks: the right stickers, real pieces, corner twists
// that add up, edge flips that add up, and piece swaps that pair up between corners and edges. Each failure is
// explained in words, with the stickers involved, so the person can find and fix it.
//
// Stickers are letters naming the face whose centre has that colour (U R F D L B), in the model's order; '?' is a
// sticker not filled in yet.

import { STICKERS, FACES } from './model.js';

const NAME = { U: 'up', R: 'right', F: 'front', D: 'down', L: 'left', B: 'back' };
const det = (a, b, c) => a[0] * (b[1] * c[2] - b[2] * c[1]) - a[1] * (b[0] * c[2] - b[2] * c[0]) + a[2] * (b[0] * c[1] - b[1] * c[0]);

// The pieces: for each corner and edge position, its sticker indices in a fixed order. Corners start with the sticker
// on the up or down face and go clockwise seen from outside; edges start with the up/down sticker or, in the middle
// layer, the front/back one. This is the convention twist and flip are counted in.
const byCubie = new Map();
STICKERS.forEach((s, i) => { const k = String(s.p); if (!byCubie.has(k)) byCubie.set(k, []); byCubie.get(k).push(i); });
export const CORNERS = [];
export const EDGES = [];
for (const idx of byCubie.values()) {
  const first = (i) => (STICKERS[i].n[1] !== 0 ? 0 : STICKERS[i].n[2] !== 0 ? 1 : 2);
  idx.sort((a, b) => first(a) - first(b));
  if (idx.length === 3) {
    const [a, b, c] = idx.map((i) => STICKERS[i].n);
    if (det(a, b, c) > 0) idx.splice(1, 2, idx[2], idx[1]); // make it clockwise seen from outside
    CORNERS.push(idx);
  } else if (idx.length === 2) EDGES.push(idx);
}
const solvedPiece = (idx) => idx.map((i) => STICKERS[i].face).join('');
const SOLVED_CORNERS = CORNERS.map(solvedPiece);
const SOLVED_EDGES = EDGES.map(solvedPiece);
const where = (idx) => idx.map((i) => NAME[STICKERS[i].face]).join('-');
const colours = (s) => s.split('').map((f) => NAME[f]).join(', ');

const rotations = (s) => s.split('').map((_, k) => s.slice(k) + s.slice(0, k));
const parity = (perm) => {
  let p = 0;
  const seen = perm.map(() => false);
  for (let i = 0; i < perm.length; i++) {
    if (seen[i]) continue;
    let len = 0;
    for (let j = i; !seen[j]; j = perm[j]) { seen[j] = true; len++; }
    p += len - 1;
  }
  return p % 2;
};

/**
 * Check a cube. Returns { ok, problems: [{ text, stickers: [indices] }] }.
 * The checks stop at the first kind that fails, because later ones mean nothing until earlier ones pass.
 */
export function validate(state) {
  const problems = [];
  const s = state.split('');
  const missing = s.map((c, i) => (FACES.includes(c) ? -1 : i)).filter((i) => i >= 0);
  if (missing.length) return { ok: false, problems: [{ text: `${missing.length} sticker${missing.length > 1 ? 's are' : ' is'} not filled in yet.`, stickers: missing }] };

  // centres: one of each colour, in the standard hold
  for (let f = 0; f < 6; f++) {
    if (s[f * 9 + 4] !== FACES[f]) return { ok: false, problems: [{ text: 'The centres are not one of each colour.', stickers: [0, 1, 2, 3, 4, 5].map((k) => k * 9 + 4) }] };
  }

  // nine of each colour
  for (const f of FACES) {
    const n = s.filter((c) => c === f).length;
    if (n !== 9) problems.push({ text: `There are ${n} ${NAME[f]}-face stickers (the ${NAME[f]} centre's colour); a cube has 9 of each.`, stickers: s.map((c, i) => (c === f ? i : -1)).filter((i) => i >= 0) });
  }
  if (problems.length) return { ok: false, problems };

  // every piece real, and each one once
  const cornerAt = CORNERS.map((idx) => idx.map((i) => s[i]).join(''));
  const edgeAt = EDGES.map((idx) => idx.map((i) => s[i]).join(''));
  const cornerPiece = cornerAt.map((c) => SOLVED_CORNERS.findIndex((p) => rotations(p).includes(c)));
  const edgePiece = edgeAt.map((e) => SOLVED_EDGES.findIndex((p) => p === e || p === e[1] + e[0]));
  cornerAt.forEach((c, k) => {
    if (cornerPiece[k] >= 0) return;
    const mirror = SOLVED_CORNERS.some((p) => rotations(p).includes(c[0] + c[2] + c[1]));
    problems.push({ text: mirror
      ? `The corner at ${where(CORNERS[k])} has its colours (${colours(c)}) in mirror-image order; no real corner looks like that. Two of its stickers are swapped.`
      : `The corner at ${where(CORNERS[k])} has colours ${colours(c)}; no corner has that combination.`, stickers: CORNERS[k] });
  });
  edgeAt.forEach((e, k) => {
    if (edgePiece[k] < 0) problems.push({ text: `The edge at ${where(EDGES[k])} has colours ${colours(e)}; no edge has that combination.`, stickers: EDGES[k] });
  });
  if (problems.length) return { ok: false, problems };
  const twice = (arr, list, kind) => arr.forEach((p, k) => {
    const others = arr.map((q, j) => (q === p && j !== k ? j : -1)).filter((j) => j >= 0);
    if (others.length && others[0] > k) problems.push({ text: `The ${colours(SOLVED_PIECES(kind)[p])} ${kind} appears twice (at ${where(list[k])} and ${where(list[others[0]])}).`, stickers: [...list[k], ...list[others[0]]] });
  });
  const SOLVED_PIECES = (kind) => (kind === 'corner' ? SOLVED_CORNERS : SOLVED_EDGES);
  twice(cornerPiece, CORNERS, 'corner');
  twice(edgePiece, EDGES, 'edge');
  if (problems.length) return { ok: false, problems };

  // twist: the up/down colour of each corner, counted by where it sits in the clockwise order, must add up to 0 mod 3
  const twist = cornerAt.reduce((t, c) => t + c.split('').findIndex((f) => f === 'U' || f === 'D'), 0) % 3;
  if (twist) problems.push({ text: `One corner is twisted ${twist === 1 ? 'clockwise' : 'anticlockwise'} in place (or the corners' twists don't add up). A twisted corner can't be fixed by turning: take it out and put it back turned.`, stickers: CORNERS.flat() });
  // flip: each edge's main colour (up/down, or front/back for middle-layer pieces) must be in the main slot, an even
  // number of times wrong in all
  const main = (piece) => (/[UD]/.test(piece) ? /[UD]/ : /[FB]/);
  const flips = edgeAt.reduce((t, e, k) => t + (main(SOLVED_EDGES[edgePiece[k]]).test(e[0]) ? 0 : 1), 0) % 2;
  if (flips) problems.push({ text: 'One edge is flipped in place. That can\'t be fixed by turning: take it out and put it back the other way round.', stickers: EDGES.flat() });
  if (problems.length) return { ok: false, problems };

  // swaps: corners and edges are always swapped an even number of times between them
  if (parity(cornerPiece) !== parity(edgePiece)) {
    return { ok: false, problems: [{ text: 'Two pieces are swapped (or the stickers were painted with two pieces exchanged). Check that two edges or two corners have not traded places.', stickers: [...CORNERS.flat(), ...EDGES.flat()] }] };
  }
  return { ok: true, problems: [] };
}
