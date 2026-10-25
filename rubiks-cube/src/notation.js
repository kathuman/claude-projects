// Cube notation: reading, writing, inverting and tidying move sequences.
//
// A move is a token: a face turn (U R F D L B), a slice (M E S), a wide turn (Uw … or u r f d l b) or a whole-cube
// rotation (x y z), followed by nothing (a quarter turn clockwise), ' (anticlockwise) or 2 (a half turn). "2'" is
// read as a half turn too.

const TOKEN = /^([URFDLB]w|[URFDLBMESxyzurfdlb])(2'?|'?)$/;

// The base of a move ("R", "Rw", "x") and how many quarter turns clockwise it makes (1, 2 or 3).
export function split(move) {
  const m = TOKEN.exec(move);
  if (!m) throw new Error(`"${move}" is not a move`);
  const a = m[2] === '' ? 1 : m[2][0] === '2' ? 2 : 3;
  return { base: m[1], amount: a };
}

export const isMove = (move) => TOKEN.test(move);
export const amount = (move) => split(move).amount;

// The move for a base and an amount of quarter turns (any integer); null when it comes to nothing.
export function withAmount(base, a) {
  a = ((a % 4) + 4) % 4;
  return a === 0 ? null : a === 1 ? base : a === 2 ? `${base}2` : `${base}'`;
}

export const invert = (move) => { const { base, amount: a } = split(move); return withAmount(base, 4 - a); };

// A sequence as an array of moves, from a string (spaces optional between moves: "RU2F'" works) or an array.
export function parseAlg(alg) {
  if (Array.isArray(alg)) return alg.slice();
  const out = [];
  const re = /([URFDLB]w|[URFDLBMESxyzurfdlb])(2'?|'?)/gy;
  const s = String(alg).replace(/[\s()]+/g, ' ').trim();
  for (const part of s.split(' ').filter(Boolean)) {
    re.lastIndex = 0;
    let pos = 0;
    while (pos < part.length) {
      re.lastIndex = pos;
      const m = re.exec(part);
      if (!m) throw new Error(`cannot read "${part.slice(pos)}"`);
      out.push(m[0].replace("2'", '2'));
      pos = re.lastIndex;
    }
  }
  return out;
}

export const invertAlg = (alg) => parseAlg(alg).reverse().map(invert);

// Merge neighbouring turns of the same kind (R R → R2, R R' → nothing).
export function tidy(alg) {
  const out = [];
  for (const m of parseAlg(alg)) {
    const { base, amount: a } = split(m);
    if (out.length && split(out[out.length - 1]).base === base) {
      const merged = withAmount(base, split(out.pop()).amount + a);
      if (merged) out.push(merged);
    } else out.push(m);
  }
  return out;
}

export const toString = (alg) => parseAlg(alg).join(' ');

// Move counts in the usual metrics: HTM (any face turn counts 1), QTM (a half turn counts 2), STM (slices count 1).
// Whole-cube rotations count 0; in HTM and QTM a slice counts as two face turns.
export function metrics(alg) {
  let htm = 0, qtm = 0, stm = 0;
  for (const m of parseAlg(alg)) {
    const { base, amount: a } = split(m);
    if ('xyz'.includes(base)) continue;
    const slice = 'MES'.includes(base);
    const q = a === 2 ? 2 : 1;
    htm += slice ? 2 : 1;
    qtm += slice ? 2 * q : q;
    stm += 1;
  }
  return { htm, qtm, stm };
}
