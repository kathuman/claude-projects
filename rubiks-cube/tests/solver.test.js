// The solver (cubejs, Kociemba's two-phase algorithm), checked by the independent model: every solution it gives
// must solve the cube, and every random-position scramble must make the position it came from.
import test from 'node:test';
import assert from 'node:assert/strict';
import { SOLVED, applyAlg } from '../src/model.js';
import { metrics, parseAlg } from '../src/notation.js';
import { Cube } from './cubejs.js';

Cube.initSolver();

test('1,000 random positions: every solution solves the cube, in at most 22 moves', () => {
  let longest = 0;
  for (let k = 0; k < 1000; k++) {
    const c = Cube.random();
    const state = c.asString();
    const sol = c.solve();
    assert.equal(applyAlg(state, sol), SOLVED, `${state}: ${sol}`);
    longest = Math.max(longest, metrics(sol).htm);
  }
  assert.ok(longest <= 22, `longest ${longest}`);
});

test('a random-position scramble makes exactly the position drawn', () => {
  for (let k = 0; k < 100; k++) {
    const c = Cube.random();
    const scramble = Cube.inverse(c.solve());
    assert.equal(applyAlg(SOLVED, scramble), c.asString());
  }
});

test('the superflip, a position 20 moves from solved, is solved', () => {
  const state = applyAlg(SOLVED, "U R2 F B R B2 R U2 L B2 R U' D' R2 F R' L B2 U2 F2");
  const sol = Cube.fromString(state).solve();
  assert.equal(applyAlg(state, sol), SOLVED);
  assert.ok(parseAlg(sol).length >= 20, 'no solution can be shorter than 20');
});

// cubejs answers a solved cube with 14 moves that cancel out, so the page never asks it to solve one.
test('a solved cube: the library returns moves that cancel out (the page does not ask)', () => {
  const sol = new Cube().solve();
  assert.equal(applyAlg(SOLVED, sol), SOLVED);
});
