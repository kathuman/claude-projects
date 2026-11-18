// The cube robot: a turntable under the cube and two arms, left and right, each driven by one motor.
//
// The robot can do three things, written here in cube notation as seen by someone standing in front of it (the
// hub is at the back):
//   spin  arms open, the turntable turns the whole cube:                    y, y', y2
//   turn  both arms grip the upper two layers, the turntable turns the bottom layer:   D, D', D2
//   tip   one arm pushes the cube over sideways; the left arm rolls it to the right (z: the top goes right), the
//         right arm to the left (z')
// So the robot can only ever turn the bottom face. To make any other face turn, it first rolls that face to the
// bottom. The planner chooses those rolls: over the 24 ways the cube can sit in the robot, it finds the cheapest
// way (in seconds) to bring each face of the solution down in turn, exactly, by dynamic programming. It can also
// choose how the cube should be put into the robot in the first place.

import { SOLVED, FACES, applyAlg, applyMove, ROTATIONS } from './model.js';
import { split, parseAlg } from './notation.js';

// Rough times in seconds for each robot action, arms included (grip and release around a turn, push and return
// around a tip). The real ones depend on the build; they only steer which plan is chosen.
export const DEFAULT_COSTS = { spin: 0.7, spin2: 1.1, turn: 1.5, turn2: 1.9, tip: 1.6 };

// The robot's actions, each as a physical move in cube notation.
const ACTIONS = [
  { move: 'y', op: 'spin', q: -1 }, { move: "y'", op: 'spin', q: 1 }, { move: 'y2', op: 'spin', q: 2 },
  { move: 'z', op: 'tip', side: 'L' }, { move: "z'", op: 'tip', side: 'R' },
];
// q: quarter turns of the turntable, anticlockwise as seen from above (y turns the cube clockwise from above).
const TURN_Q = { 1: 1, 2: 2, 3: -1 }; // D clockwise from below = anticlockwise from above

const actionCost = (a, c) => (a.op === 'tip' ? c.tip : a.q === 2 ? c.spin2 : c.spin);

// An orientation: which face (by its letter at the start) sits at each place U R F D L B, read off the centres.
const CENTRES = [4, 13, 22, 31, 40, 49];
const centresOf = (state) => CENTRES.map((i) => state[i]).join('');
const ORIENTS = ROTATIONS.map((r) => centresOf(applyAlg(SOLVED, r)));
const ORIENT_INDEX = new Map(ORIENTS.map((o, i) => [o, i]));
const rotateOrient = (o, move) => {
  // put the six letters on the centres of a cube, turn it, read them back
  const s = SOLVED.split('');
  CENTRES.forEach((ci, k) => { s[ci] = o[k]; });
  return centresOf(applyMove(s.join(''), move));
};
const NEXT = ORIENTS.map((o) => ACTIONS.map((a) => ORIENT_INDEX.get(rotateOrient(o, a.move))));

// Cheapest way between any two orientations: Dijkstra from each of the 24 (tiny graph), kept for each set of costs.
const PATHS = new Map();
function shortestPaths(costs) {
  const key = JSON.stringify(costs);
  if (!PATHS.has(key)) PATHS.set(key, dijkstra(costs));
  return PATHS.get(key);
}
function dijkstra(costs) {
  return ORIENTS.map((_, from) => {
    const dist = ORIENTS.map(() => Infinity);
    const path = ORIENTS.map(() => null);
    dist[from] = 0; path[from] = [];
    const open = new Set(ORIENTS.map((__, i) => i));
    while (open.size) {
      let u = -1;
      for (const i of open) if (u < 0 || dist[i] < dist[u]) u = i;
      open.delete(u);
      ACTIONS.forEach((a, k) => {
        const v = NEXT[u][k];
        const d = dist[u] + actionCost(a, costs);
        if (d < dist[v] - 1e-9) { dist[v] = d; path[v] = path[u].concat(a); }
      });
    }
    return { dist, path };
  });
}

const COLOUR_NAME = { U: 'white', D: 'yellow', F: 'green', B: 'blue', L: 'orange', R: 'red' };

// Plan the robot's actions for a cube and a list of moves that solves it (face turns; whole-cube rotations x y z
// are allowed too and cost nothing, they only change what the later moves mean).
//   start   the cube as the page holds it (54-letter state)
//   moves   the solution
//   opts.hold  'best': the robot picks how the cube goes in (any of 24 ways); 'as-is': it goes in as shown
//   opts.costs  seconds per action (DEFAULT_COSTS)
// Returns { hold, start, steps, time, counts, place }:
//   hold   the rotation (from model.ROTATIONS) from the page's view to how the cube sits in the robot
//   start  the cube as it sits in the robot at the beginning
//   steps  [{ op: 'spin'|'tip'|'turn', move, q?, side?, cost }], move being the physical move in cube notation
//   place  how to put the cube in: { top, front } colour names of the centres on top and facing you
export function planRobot(start, moves, opts = {}) {
  const costs = { ...DEFAULT_COSTS, ...(opts.costs || {}) };
  const hold = opts.hold || 'best';

  // Which face (named by its letter in the page's view at the start) each face turn of the solution turns.
  let app = SOLVED; // tracks whole-cube rotations in the solution
  const turns = [];
  for (const m of parseAlg(moves)) {
    const { base, amount } = split(m);
    if ('xyz'.includes(base)) { app = applyMove(app, m); continue; }
    if (!FACES.includes(base)) throw new Error(`the robot plans face turns only, not "${m}"`);
    turns.push({ label: app[CENTRES[FACES.indexOf(base)]], amount });
  }

  const paths = shortestPaths(costs);
  const D = FACES.indexOf('D');
  const turnCost = (amount) => (amount === 2 ? costs.turn2 : costs.turn);

  // best[i][o]: least time to have made the first i turns with the cube in orientation o; from[i][o]: where from.
  const n = turns.length;
  const firsts = hold === 'as-is' ? [0] : ORIENTS.map((_, i) => i);
  let best = ORIENTS.map((_, o) => (firsts.includes(o) ? 0 : Infinity));
  const from = [];
  for (let i = 0; i < n; i++) {
    const next = ORIENTS.map(() => Infinity);
    const back = ORIENTS.map(() => -1);
    ORIENTS.forEach((o, v) => {
      if (o[D] !== turns[i].label) return; // this turn's face must be at the bottom
      for (let u = 0; u < ORIENTS.length; u++) {
        const t = best[u] + paths[u].dist[v];
        if (t < next[v] - 1e-9) { next[v] = t; back[v] = u; }
      }
      next[v] += turnCost(turns[i].amount);
    });
    from.push(back);
    best = next;
  }

  // Walk back from the cheapest end.
  let end = 0;
  best.forEach((t, o) => { if (t < best[end]) end = o; });
  const visits = [end];
  for (let i = n - 1; i >= 0; i--) visits.unshift(from[i][visits[0]]);
  const holdRot = ROTATIONS[visits[0]];

  const steps = [];
  for (let i = 0; i < n; i++) {
    for (const a of paths[visits[i]].path[visits[i + 1]]) steps.push({ ...a, cost: actionCost(a, costs) });
    const amount = turns[i].amount;
    steps.push({ op: 'turn', move: ['', 'D', 'D2', "D'"][amount], q: TURN_Q[amount], cost: turnCost(amount) });
  }
  const placed = applyAlg(start, holdRot);
  const counts = { spin: 0, tip: 0, turn: 0 };
  for (const s of steps) counts[s.op]++;
  return {
    hold: holdRot,
    start: placed,
    steps,
    time: steps.reduce((t, s) => t + s.cost, 0),
    counts,
    place: { top: COLOUR_NAME[placed[4]], front: COLOUR_NAME[placed[22]] },
  };
}

// The plan as short codes for the hub program: S1 S-1 S2 spin, T1 T-1 T2 turn (quarter turns of the turntable,
// anticlockwise from above), L R tip with the left or right arm.
export const toCodes = (steps) => steps.map((s) => (s.op === 'tip' ? s.side : `${s.op === 'spin' ? 'S' : 'T'}${s.q}`));

// A short label for each step, for the move list.
export function stepLabel(s) {
  if (s.op === 'tip') return `tip ${s.side}`;
  if (s.op === 'spin') return s.q === 2 ? 'spin ½' : s.q > 0 ? 'spin ↺' : 'spin ↻';
  return `turn ${s.move}`;
}
