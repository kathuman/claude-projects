// The robot planner, checked by the cube model: replaying the robot's physical moves (spins y, tips z, bottom-layer
// turns D) on the cube as it was put into the robot must solve it, whatever the position and the hold.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SOLVED, applyAlg, isSolved, ROTATIONS } from '../src/model.js';
import { parseAlg, invertAlg } from '../src/notation.js';
import { planRobot, toCodes, DEFAULT_COSTS } from '../src/robot.js';
import { pybricksProgram, planJSON } from '../src/pybricks.js';
import { Cube } from './cubejs.js';

Cube.initSolver();
const replay = (plan) => plan.steps.reduce((s, st) => applyAlg(s, st.move), plan.start);

test('500 random positions: every robot plan solves the cube, both ways of putting it in', () => {
  for (let k = 0; k < 500; k++) {
    const state = Cube.random().asString();
    const sol = Cube.fromString(state).solve();
    for (const hold of ['best', 'as-is']) {
      const plan = planRobot(state, sol, { hold });
      assert.ok(isSolved(replay(plan)), `${hold} ${state}: ${sol}`);
      assert.equal(plan.counts.turn, parseAlg(sol).length, 'one bottom turn per face turn');
      if (hold === 'as-is') assert.equal(plan.start, state, 'as-is keeps the cube as shown');
    }
  }
});

test('the robot only ever spins, tips or turns the bottom layer', () => {
  const state = Cube.random().asString();
  const plan = planRobot(state, Cube.fromString(state).solve());
  for (const s of plan.steps) assert.ok(["y", "y'", 'y2', 'z', "z'", 'D', "D'", 'D2'].includes(s.move), s.move);
  assert.ok(toCodes(plan.steps).every((c) => /^(S-?[12]|T-?[12]|L|R)$/.test(c)));
});

test('choosing how the cube goes in never costs time, and matches the best of all 24 holds tried one by one', () => {
  for (let k = 0; k < 60; k++) {
    const state = Cube.random().asString();
    const sol = parseAlg(Cube.fromString(state).solve());
    const best = planRobot(state, sol, { hold: 'best' });
    const asIs = planRobot(state, sol, { hold: 'as-is' });
    assert.ok(best.time <= asIs.time + 1e-9);
    // put in held by r, the same solution reads: undo r (a rotation, free), then the moves
    const each = Math.min(...ROTATIONS.map((r) => planRobot(applyAlg(state, r), [...invertAlg(r), ...sol], { hold: 'as-is' }).time));
    assert.ok(Math.abs(best.time - each) < 1e-9, `${best.time} vs ${each}`);
  }
});

test('short cases by hand: a D turn is one turn; R needs one tip; U needs two tips; F a spin and a tip', () => {
  const at = (alg) => planRobot(applyAlg(SOLVED, alg), invertAlg(alg), { hold: 'as-is' });
  assert.deepEqual(at('D').steps.map((s) => s.move), ["D'"]);
  assert.deepEqual(at('R').steps.map((s) => s.move), ['z', "D'"], 'the left arm rolls R to the bottom');
  assert.deepEqual(at('L').steps.map((s) => s.move), ["z'", "D'"], 'the right arm rolls L to the bottom');
  assert.deepEqual(at('U').steps.map((s) => s.op), ['tip', 'tip', 'turn']);
  assert.deepEqual(at('F').steps.map((s) => s.op).sort(), ['spin', 'tip', 'turn']);
  for (const alg of ['D', 'R', 'L', 'U', 'F', 'B', "R U2 F'"]) assert.ok(isSolved(replay(at(alg))), alg);
});

test('rotations in the solution cost nothing and are followed', () => {
  const state = Cube.random().asString();
  const sol = parseAlg(Cube.fromString(state).solve());
  const plain = planRobot(state, sol, { hold: 'as-is' });
  const padded = planRobot(state, ['x', "x'", 'y2', 'y2', ...sol], { hold: 'as-is' });
  assert.equal(padded.time, plain.time);
  // turned by y first, the solution's faces are named differently but it is the same cube turning
  const turned = planRobot(state, ['y', ...sol.map((m) => m.replace(/^[RFLB]/, (f) => ({ R: 'F', F: 'L', L: 'B', B: 'R' })[f]))], { hold: 'as-is' });
  assert.ok(isSolved(replay(turned)));
  assert.equal(turned.time, plain.time);
  assert.throws(() => planRobot(SOLVED, 'M'), /face turns only/);
});

test('a solved cube needs no steps', () => {
  const plan = planRobot(SOLVED, '');
  assert.equal(plan.steps.length, 0);
  assert.equal(plan.time, 0);
});

test('the Pybricks program carries the plan and is valid Python (when Python is available)', () => {
  const state = Cube.random().asString();
  const sol = Cube.fromString(state).solve();
  const plan = planRobot(state, sol);
  const prog = pybricksProgram(plan, { tablePort: 'E' }, { solution: sol, title: 'Test' });
  for (const c of toCodes(plan.steps)) assert.ok(prog.includes(`"${c}"`));
  assert.ok(prog.includes('Port.E'));
  assert.ok(prog.includes(`the ${plan.place.top} centre on top`));
  const data = JSON.parse(planJSON(plan, { solution: sol }));
  assert.equal(data.codes.length, plan.steps.length);
  let python = null;
  for (const exe of ['python3', 'python']) { try { execFileSync(exe, ['--version'], { stdio: 'ignore' }); python = exe; break; } catch { /* try next */ } }
  if (!python) return;
  const f = join(mkdtempSync(join(tmpdir(), 'cube-')), 'cube_robot.py');
  writeFileSync(f, prog);
  execFileSync(python, ['-c', 'import ast,sys; ast.parse(open(sys.argv[1]).read())', f]);
});

test('costs steer the plan: dearer tips mean fewer tips', () => {
  let cheap = 0, dear = 0;
  for (let k = 0; k < 30; k++) {
    const state = Cube.random().asString();
    const sol = Cube.fromString(state).solve();
    cheap += planRobot(state, sol).counts.tip;
    dear += planRobot(state, sol, { costs: { ...DEFAULT_COSTS, tip: 6 } }).counts.tip;
  }
  assert.ok(dear <= cheap);
});
