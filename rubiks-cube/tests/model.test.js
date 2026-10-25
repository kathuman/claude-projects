import test from 'node:test';
import assert from 'node:assert/strict';
import { SOLVED, STICKERS, applyMove, applyAlg, isSolved, normalise, turnOf, MOVES } from '../src/model.js';
import { parseAlg, invert, invertAlg, tidy, split, metrics, withAmount } from '../src/notation.js';
import { Cube } from './cubejs.js';

const BASES = Object.keys(MOVES);
const rand = (() => { let a = 12345; return () => { a = (a * 1103515245 + 12345) >>> 0; return a / 2 ** 32; }; })();
const randomAlg = (n, bases = 'URFDLB') => Array.from({ length: n }, () => bases[(rand() * bases.length) | 0] + ['', "'", '2'][(rand() * 3) | 0]);

test('54 stickers, each position and direction once, nine to a face', () => {
  assert.equal(STICKERS.length, 54);
  assert.equal(new Set(STICKERS.map((s) => `${s.p}|${s.n}`)).size, 54);
  for (const f of 'URFDLB') assert.equal(STICKERS.filter((s) => s.face === f).length, 9);
  assert.equal(SOLVED, 'UUUUUUUUURRRRRRRRRFFFFFFFFFDDDDDDDDDLLLLLLLLLBBBBBBBBB');
});

test('every move four times is no move; a move and its inverse cancel; a half turn is two quarter turns', () => {
  const start = applyAlg(SOLVED, randomAlg(30));
  for (const b of BASES) {
    assert.equal(applyAlg(start, [b, b, b, b]), start, `${b}×4`);
    assert.equal(applyAlg(start, [b, invert(b)]), start, `${b} ${invert(b)}`);
    assert.equal(applyMove(start, `${b}2`), applyAlg(start, [b, b]), `${b}2`);
  }
});

test('the model agrees with the solver library on 300 random sequences', () => {
  for (let k = 0; k < 300; k++) {
    const alg = randomAlg(1 + (k % 40));
    const c = new Cube();
    c.move(alg.join(' '));
    assert.equal(applyAlg(SOLVED, alg), c.asString(), alg.join(' '));
  }
});

test('known facts: opposite faces commute, (R U R′ U′)×6 is no move, R U has order 105', () => {
  const s = applyAlg(SOLVED, randomAlg(20));
  assert.equal(applyAlg(s, 'U D'), applyAlg(s, 'D U'));
  assert.equal(applyAlg(SOLVED, "R U R' U' ".repeat(6)), SOLVED);
  let t = SOLVED, n = 0;
  do { t = applyAlg(t, 'R U'); n++; } while (t !== SOLVED);
  assert.equal(n, 105);
});

test('the superflip: every edge flipped in place, corners and centres untouched', () => {
  const sf = applyAlg(SOLVED, "U R2 F B R B2 R U2 L B2 R U' D' R2 F R' L B2 U2 F2");
  assert.equal(sf, 'UBULURUFURURFRBRDRFUFLFRFDFDFDLDRDBDLULBLFLDLBUBRBLBDB');
  STICKERS.forEach((s, i) => {
    const corner = s.p.filter((v) => v !== 0).length === 3;
    const centre = s.p.filter((v) => v !== 0).length === 1;
    if (corner || centre) assert.equal(sf[i], s.face);
  });
});

test('slices, wide turns and rotations are the face turns they stand for', () => {
  const s = applyAlg(SOLVED, randomAlg(25));
  assert.equal(applyAlg(s, 'M'), applyAlg(s, "L' R x'"));
  assert.equal(applyAlg(s, 'E'), applyAlg(s, "U D' y'"));
  assert.equal(applyAlg(s, 'S'), applyAlg(s, "F' B z"));
  assert.equal(applyAlg(s, 'r'), applyAlg(s, "L x"));
  assert.equal(applyAlg(s, 'Rw'), applyAlg(s, 'r'));
  assert.equal(applyAlg(s, 'y'), applyAlg(s, "U E' D'"));
  assert.ok(isSolved(applyAlg(SOLVED, 'x y2 z')));
  assert.equal(normalise(applyAlg(SOLVED, 'x y2 z')), SOLVED);
});

test('notation: reading, inverting, tidying and counting', () => {
  assert.deepEqual(parseAlg("R U2' (F' r) M2 x"), ['R', 'U2', "F'", 'r', 'M2', 'x']);
  assert.deepEqual(parseAlg("RU2F'"), ['R', 'U2', "F'"]);
  assert.throws(() => parseAlg('R Q'));
  assert.deepEqual(invertAlg("R U2 F'"), ['F', 'U2', "R'"]);
  assert.deepEqual(tidy("R R U U' F2 F2 L"), ['R2', 'L']);
  assert.deepEqual(split("Rw'"), { base: 'Rw', amount: 3 });
  assert.equal(withAmount('R', 4), null);
  assert.deepEqual(metrics("R U2 M x F'"), { htm: 5, qtm: 6, stm: 4 });
  assert.deepEqual(turnOf("U'"), { axis: 'y', layers: [1], degrees: 90 });
});

test('every way of holding the cube is found and undone', async () => {
  const { ROTATIONS, orientation } = await import('../src/model.js');
  assert.equal(new Set(ROTATIONS.map((r) => applyAlg(SOLVED, r))).size, 24);
  for (const r of ROTATIONS) {
    const held = applyAlg(applyAlg(SOLVED, randomAlg(15)), r);
    const back = applyAlg(held, orientation(held));
    assert.equal(back[4], 'U'); assert.equal(back[22], 'F');
  }
});

test('dragging a sticker turns the layer it is dragged along', async () => {
  const { dragMove } = await import('../src/model.js');
  // front face, top row, dragged right: the top layer turns anticlockwise seen from above
  assert.equal(dragMove([0, 1, 1], [0, 0, 1], [1, 0, 0]), "U'");
  assert.equal(dragMove([1, 1, 1], [0, 0, 1], [-1, 0, 0]), 'U');
  // front face, right column, dragged up: R
  assert.equal(dragMove([1, 0, 1], [0, 0, 1], [0, 1, 0]), 'R');
  // front face, middle column, dragged down: M (follows L)
  assert.equal(dragMove([0, 0, 1], [0, 0, 1], [0, -1, 0]), 'M');
  // top face, front row, dragged right: F
  assert.equal(dragMove([0, 1, 1], [0, 1, 0], [1, 0, 0]), 'F');
  // every drag of every sticker: a quarter turn about n × d carries the sticker's face direction n onto d, so after
  // the move the grabbed sticker faces the way it was dragged
  const { STICKERS, stickerAt } = await import('../src/model.js');
  let n = 0;
  for (const s of STICKERS) {
    for (const d of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]) {
      if (d.some((v, i) => v !== 0 && s.n[i] !== 0)) continue;
      const mv = dragMove(s.p, s.n, d);
      const marked = STICKERS.map((_, i) => (i === stickerAt(s.p, s.n) ? '*' : '.')).join('');
      const q = STICKERS[applyMove(marked, mv).indexOf('*')];
      assert.deepEqual(q.n, d, `${mv} from ${s.p}/${s.n} along ${d}`);
      n++;
    }
  }
  assert.equal(n, 54 * 4);
});
