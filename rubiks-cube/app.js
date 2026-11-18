// Cube Studio: the page. The cube's state is a 54-sticker string (src/model.js); the 3D view is 26 small cubes drawn
// with CSS 3D transforms, the 2D net a grid of stickers, both redrawn from the state. Scrambles and solutions come
// from the solver worker (cubejs, Kociemba's two-phase algorithm); the move list plays like a video.

import { SOLVED, applyMove, applyAlg, isSolved, stickerAt, turnOf, orientation, dragMove } from './src/model.js';
import { parseAlg, invert, tidy, metrics } from './src/notation.js';
import { validate } from './src/validate.js';
import { createEditor } from './src/editor.js';
import { planRobot, stepLabel } from './src/robot.js';
import { pybricksProgram, planJSON, DEFAULT_SETTINGS } from './src/pybricks.js';

const VERSION = '1.3.0';
const $ = (id) => document.getElementById(id);

const COLOR = { U: '--cube-W', D: '--cube-Y', F: '--cube-G', B: '--cube-B', L: '--cube-O', R: '--cube-R', '?': '--unknown' };
const STEP = 64; // px between cubie centres (60 face + 4 gap)
const BASE = { U: 0, R: 9, F: 18, D: 27, L: 36, B: 45 };

// The six faces of a cubie element, with their outward direction in CSS space (x right, y DOWN, z towards the
// viewer). The model uses y UP, so y flips between the two.
const DIRS = [
  { css: [1, 0, 0], cls: 'px' }, { css: [-1, 0, 0], cls: 'nx' },
  { css: [0, 1, 0], cls: 'ny' }, { css: [0, -1, 0], cls: 'py' },
  { css: [0, 0, 1], cls: 'pz' }, { css: [0, 0, -1], cls: 'nz' },
];
const toModel = ([x, y, z]) => [x, -y, z];

// ---------------------------------------------------------------- the 26 cubies and the net
const cubeEl = $('cube');
const cubies = [];
for (let x = -1; x <= 1; x++) for (let y = -1; y <= 1; y++) for (let z = -1; z <= 1; z++) {
  if (!x && !y && !z) continue;
  const el = document.createElement('div');
  el.className = 'cubie';
  el.style.setProperty('--tx', `${x * STEP}px`);
  el.style.setProperty('--ty', `${y * STEP}px`);
  el.style.setProperty('--tz', `${z * STEP}px`);
  const faces = {};
  for (const d of DIRS) {
    const fe = document.createElement('div');
    fe.className = `face ${d.cls}`;
    fe.dataset.cubie = String(cubies.length);
    fe.dataset.dir = d.cls;
    const st = document.createElement('div');
    st.className = 'sticker';
    fe.appendChild(st);
    el.appendChild(fe);
    faces[d.cls] = { el: st, index: stickerAt(toModel([x, y, z]), toModel(d.css)) };
  }
  cubies.push({ el, pos: [x, y, z], faces });
  cubeEl.appendChild(el);
}

// The robot drawn around the cube: turntable underneath (its notch shows it turning), the arms left and right
// over the upper two layers, the hub at the back. Arm positions: x from the cube's centre, open / gripping / tipping.
const rig = { el: document.createElement('div'), table: 0 };
rig.el.className = 'rig';
rig.el.hidden = true;
rig.el.innerHTML = '<div class="rig-table"></div><div class="rig-arm" data-side="L"></div><div class="rig-arm" data-side="R"></div>'
  + `<div class="rig-hub">${Array.from({ length: 25 }, (_, i) => `<i${[6, 8, 16, 17, 18].includes(i) ? ' class="on"' : ''}></i>`).join('')}</div>`;
cubeEl.appendChild(rig.el);
const ARM_X = { open: 150, grip: 104, tip: 96 };
const ARM_Y = { open: -32, grip: -32, tip: -56 };
function poseRig(left = 'open', right = 'open', dur = 0) {
  rig.el.style.setProperty('--dur', `${dur}ms`);
  rig.el.querySelector('.rig-table').style.transform = `translate3d(0, ${1.5 * STEP + 8}px, 0) rotateY(${rig.table}deg) rotateX(90deg)`;
  for (const [side, pose] of [['L', left], ['R', right]]) {
    const sgn = side === 'L' ? -1 : 1;
    rig.el.querySelector(`.rig-arm[data-side="${side}"]`).style.transform = `translate3d(${sgn * ARM_X[pose]}px, ${ARM_Y[pose]}px, 0) rotateY(90deg)`;
  }
  rig.el.querySelector('.rig-hub').style.transform = `translate3d(0, -30px, ${-1.5 * STEP - 70}px)`;
}
poseRig();

const netEl = $('net');
const netCells = {};
for (const f of ['U', 'L', 'F', 'R', 'B', 'D']) {
  const g = document.createElement('div');
  g.className = `face-grid slot-${f}`;
  netCells[f] = [];
  for (let i = 0; i < 9; i++) {
    const cell = document.createElement('div');
    cell.className = 'cell';
    g.appendChild(cell);
    netCells[f].push(cell);
  }
  netEl.appendChild(g);
}

// ---------------------------------------------------------------- state
// The move list is also the history: a move made by hand drops whatever came after the current point and is added
// at the end, so Undo and Redo are a step back and a step forward.
const state = {
  cube: SOLVED,
  base: SOLVED,      // the cube before the loaded sequence
  baseAlg: [],       // the moves that make `base` from a solved cube (for links); null for a cube entered by hand
  seq: [],           // [{ move, kind: 'scramble' | 'solution' | 'manual' | 'alg' }]
  pos: 0,            // moves applied from base
  playing: false,
};
const queue = [];    // moves made while another was still turning
let editing = false; // while someone paints or scans their own cube
let animating = false;
let showLabels = false;

const announce = (text) => { $('announce').textContent = text; };

function render() {
  const s = state.cube;
  for (const cb of cubies) {
    for (const d of DIRS) {
      const { el, index } = cb.faces[d.cls];
      if (index === undefined) { el.style.opacity = '0'; el.removeAttribute('data-label'); continue; }
      const ch = s[index];
      el.style.opacity = '1';
      el.style.setProperty('--stickerColor', `var(${COLOR[ch]})`);
      if (showLabels) el.setAttribute('data-label', ch); else el.removeAttribute('data-label');
    }
  }
  for (const f in netCells) {
    for (let i = 0; i < 9; i++) {
      const ch = s[BASE[f] + i];
      netCells[f][i].style.setProperty('--cellColor', `var(${COLOR[ch]})`);
      netCells[f][i].textContent = showLabels ? ch : '';
    }
  }
  $('rState').textContent = isSolved(s) ? 'solved' : 'not solved';
  updateTransport();
}

// ---------------------------------------------------------------- one animated move
function duration() {
  const v = Number($('speed').value); // 0..100
  if (v <= 2 || reducedMotion()) return 0;
  return Math.round(520 - v * 4.4); // about 520 ms … 80 ms
}

// CSS rotation for a model turn: rotateY matches the model's y angle; x and z change sign because y is flipped.
const CSS_SIGN = { x: -1, y: 1, z: -1 };
const CSS_AXIS = { x: 0, y: 1, z: 2 };

function doMove(move, item) {
  const t = turnOf(move);
  const dur = duration();
  const step = item && item.step;
  if (step) {
    // the robot: arms grip for a layer turn, one arm pushes for a tip; the turntable turns under spins and turns
    if (step.op !== 'tip') rig.table += t.degrees;
    const arm = step.op === 'turn' ? 'grip' : 'open';
    poseRig(step.op === 'tip' && step.side === 'L' ? 'tip' : arm, step.op === 'tip' && step.side === 'R' ? 'tip' : arm, dur);
  }
  return new Promise((resolve) => {
    const layer = cubies.filter((cb) => t.layers.includes(toModel(cb.pos)[CSS_AXIS[t.axis]]));
    const finish = () => {
      state.cube = applyMove(state.cube, move);
      for (const cb of layer) { cb.el.classList.remove('move'); cb.el.style.transform = ''; }
      void cubeEl.offsetWidth; // the reset must not animate
      if (step) poseRig('open', 'open', dur);
      render();
      resolve();
    };
    if (!dur) { finish(); return; }
    const rot = `rotate${t.axis.toUpperCase()}(${t.degrees * CSS_SIGN[t.axis]}deg)`;
    for (const cb of layer) {
      cb.el.style.setProperty('--dur', `${dur}ms`);
      cb.el.classList.add('move');
      cb.el.style.transform = `${rot} translate3d(var(--tx), var(--ty), var(--tz))`;
    }
    let done = false;
    const onEnd = () => { if (done) return; done = true; layer[0].el.removeEventListener('transitionend', onEnd); finish(); };
    layer[0].el.addEventListener('transitionend', onEnd);
    setTimeout(onEnd, dur + 120); // in case transitionend never fires
  });
}

// ---------------------------------------------------------------- playback
const tp = { start: $('tpStart'), back: $('tpBack'), play: $('tpPlay'), fwd: $('tpFwd'), end: $('tpEnd') };
const movesEl = $('moves');
const scrub = $('scrub');

const STEP_TITLE = {
  spin: (s) => `arms open, the turntable spins the whole cube (${s.move})`,
  tip: (s) => (s.side === 'L' ? 'the left arm tips the cube over to the right (z)' : "the right arm tips the cube over to the left (z')"),
  turn: (s) => `the arms grip the upper two layers, the turntable turns the bottom layer (${s.move})`,
};

function renderMoveTokens() {
  movesEl.innerHTML = '';
  state.seq.forEach((item, i) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = `move-token${item.kind === 'scramble' ? ' scramble' : ''}${item.step ? ` robot ${item.step.op}` : ''}`;
    b.textContent = item.label || item.move;
    b.title = `${i + 1} · ${item.step ? STEP_TITLE[item.step.op](item.step) : item.kind}`;
    b.setAttribute('aria-label', `Go to after move ${i + 1}, ${item.move}`);
    b.addEventListener('click', () => { pause(); seekTo(i + 1); });
    movesEl.appendChild(b);
  });
  scrub.max = String(state.seq.length);
  updateTransport();
}

function updateTransport() {
  const n = state.seq.length;
  for (const el of Object.values(tp)) el.disabled = !n || animating || editing;
  scrub.disabled = !n || editing;
  if (n && !editing) {
    tp.start.disabled = tp.back.disabled = animating || state.pos === 0;
    tp.fwd.disabled = tp.end.disabled = animating || state.pos === n;
    tp.play.disabled = state.pos === n && !state.playing;
  }
  tp.play.textContent = state.playing ? '❚❚' : '▶';
  tp.play.setAttribute('aria-label', state.playing ? 'Pause' : 'Play');
  scrub.value = String(state.pos);
  $('tpCount').textContent = `${state.pos} / ${n}`;
  [...movesEl.children].forEach((el, i) => {
    el.classList.toggle('done', i < state.pos);
    el.classList.toggle('current', i === state.pos && state.playing);
  });
  $('btnSolve').disabled = editing || !solverReady || busy || animating || state.playing || isSolved(state.cube);
  $('btnScramble').disabled = editing || !solverReady || busy || animating || state.playing;
  $('btnReset').disabled = editing || animating || state.playing;
  $('btnEdit').disabled = editing || animating || state.playing;
  $('btnRobot').disabled = editing || !solverReady || busy || animating || state.playing || isSolved(state.cube);
  $('btnUndo').disabled = animating || state.playing || state.pos === 0;
  $('btnRedo').disabled = animating || state.playing || state.pos === n;
}

function seekTo(target) {
  if (animating) return;
  target = Math.max(0, Math.min(state.seq.length, target));
  if (target === state.pos) return;
  if (target < state.pos) { state.cube = state.base; state.pos = 0; }
  while (state.pos < target) { state.cube = applyMove(state.cube, state.seq[state.pos].move); state.pos++; }
  rig.table = tableAngle(state.pos);
  poseRig();
  render();
  updatePhase();
}

function updatePhase() {
  const el = $('tlPhase');
  if (!state.seq.length) { el.textContent = 'idle'; return; }
  if (state.pos >= state.seq.length) el.textContent = isSolved(state.cube) ? 'solved' : 'sequence complete';
  else el.textContent = { scramble: 'scrambling', solution: 'solving', manual: 'your moves', alg: 'playing your moves', robot: 'robot solving' }[state.seq[state.pos].kind];
}

async function stepForward() {
  if (animating || state.pos >= state.seq.length) return;
  animating = true; updateTransport();
  await doMove(state.seq[state.pos].move, state.seq[state.pos]);
  state.pos++;
  animating = false;
  updatePhase(); updateTransport();
  if (queue.length) makeMoves(queue.splice(0), 'manual');
}

async function stepBack() {
  if (animating || state.pos === 0) return;
  animating = true; updateTransport();
  await doMove(invert(state.seq[state.pos - 1].move), state.seq[state.pos - 1]);
  state.pos--;
  animating = false;
  updatePhase(); updateTransport();
  if (queue.length) makeMoves(queue.splice(0), 'manual');
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function play() {
  if (animating || state.pos >= state.seq.length) return;
  state.playing = true; updateTransport();
  while (state.playing && state.pos < state.seq.length) {
    animating = true; updateTransport();
    await doMove(state.seq[state.pos].move, state.seq[state.pos]);
    state.pos++;
    animating = false;
    updatePhase(); updateTransport();
    if (state.playing && state.pos < state.seq.length) await wait(90);
  }
  state.playing = false;
  updatePhase(); updateTransport();
  if (queue.length) { makeMoves(queue.splice(0), 'manual'); return; }
  if (isSolved(state.cube) && state.seq.length) announce('Solved.');
}
function pause() { state.playing = false; updateTransport(); }

function loadSequence(items, base, baseAlg = []) {
  state.base = base;
  state.baseAlg = baseAlg;
  state.cube = base;
  state.pos = 0;
  state.seq = items;
  rig.table = 0;
  poseRig();
  renderMoveTokens();
  render();
  updatePhase();
}

// Moves made by hand or typed: they replace whatever came after the current point and play at once.
function makeMoves(moves, kind) {
  if (!moves.length || editing) return;
  if (animating || state.playing) { state.playing = false; queue.push(...moves); return; }
  setSpin(false);
  state.seq = state.seq.slice(0, state.pos).concat(moves.map((move) => ({ move, kind })));
  renderMoveTokens();
  play();
}

const undo = () => { pause(); stepBack(); };
const redo = () => { pause(); stepForward(); };

// Start from a solved cube with these moves already made.
function setUp(moves) {
  pause();
  loadSequence([], applyAlg(SOLVED, moves), moves);
  $('rScramble').textContent = moves.length ? moves.join(' ') : '—';
  for (const id of ['rSolution', 'rLen', 'rTime']) $(id).textContent = '—';
}

function readAlg() {
  const msg = $('algMsg');
  try {
    const moves = parseAlg($('algInput').value);
    if (!moves.length) throw new Error('Type some moves first.');
    msg.hidden = true;
    return moves;
  } catch (e) {
    msg.className = 'algmsg';
    msg.textContent = /^"|^cannot/.test(e.message) ? `Not a move: ${e.message.replace(/^cannot read /, '')}. Use U R F D L B, M E S, x y z, wide turns like Rw or r, with ' or 2.` : e.message;
    msg.hidden = false;
    return null;
  }
}

function flash(text) {
  const msg = $('algMsg');
  msg.className = 'algmsg ok';
  msg.textContent = text;
  msg.hidden = false;
}

// A link that opens this cube and this move list: ?setup=<moves from solved to the start>&alg=<the moves>.
function link() {
  const u = new URL(location.href.split(/[?#]/)[0]);
  if (state.baseAlg) {
    const setup = tidy(state.baseAlg);
    if (setup.length) u.searchParams.set('setup', setup.join(' '));
  } else u.searchParams.set('state', state.base);
  if (state.seq.length) u.searchParams.set('alg', state.seq.map((s) => s.move).join(' '));
  return u.toString();
}

function openLink() {
  const q = new URLSearchParams(location.search);
  if (!q.has('setup') && !q.has('alg') && !q.has('state')) return false;
  try {
    const setup = parseAlg(q.get('setup') ?? '');
    const alg = parseAlg(q.get('alg') ?? '');
    setUp(setup);
    if (q.has('state')) {
      const st = q.get('state');
      const r = validate(st);
      if (!r.ok) throw new Error(r.problems[0].text);
      loadSequence([], st, null);
      $('rScramble').textContent = 'your own cube';
    }
    if (alg.length) { loadSequence(alg.map((move) => ({ move, kind: 'alg' })), state.base, state.baseAlg); }
    flash(`Opened from a link: ${setup.length} set-up moves${alg.length ? `, then ${alg.length} moves to play` : ''}.`);
  } catch (e) {
    $('algMsg').className = 'algmsg';
    $('algMsg').textContent = `The link's moves could not be read (${e.message}).`;
    $('algMsg').hidden = false;
  }
  return true;
}

// ---------------------------------------------------------------- actions
let busy = false; // waiting for the worker
const pill = (text, cls = '') => { $('statusPill').textContent = text; $('statusPill').className = `status-pill ${cls}`; };

function scramble() {
  if (!solverReady || animating || busy) return;
  pause();
  busy = true; updateTransport();
  pill('scrambling…', 'busy');
  worker.postMessage({ cmd: 'scramble' });
}

function onScrambled(alg) {
  const moves = tidy(parseAlg(alg));
  loadSequence(moves.map((move) => ({ move, kind: 'scramble' })), SOLVED, []);
  $('rScramble').textContent = moves.join(' ');
  $('rSolution').textContent = '—';
  $('rLen').textContent = '—';
  $('rTime').textContent = '—';
  seekTo(moves.length); // show the scrambled cube; the scramble can be stepped through from the start
  announce(`Scrambled with ${moves.length} moves from a random position.`);
}

function requestSolve(forRobot = false) {
  if (!solverReady || busy || animating || isSolved(state.cube)) return;
  robotNext = forRobot === true;
  busy = true; updateTransport();
  pill('solving…', 'busy');
  // the solver expects the standard hold; a cube that was turned as a whole is turned back first
  holdBack = parseAlg(orientation(state.cube));
  worker.postMessage({ cmd: 'solve', facelets: applyAlg(state.cube, holdBack) });
}
let holdBack = [];
let robotNext = false; // the solution is for the robot: plan it instead of playing it

function onSolved(alg, ms) {
  const moves = holdBack.concat(tidy(parseAlg(alg)));
  const m = metrics(moves);
  const baseAlg = state.baseAlg && tidy(state.baseAlg.concat(state.seq.slice(0, state.pos).map((s) => s.move)));
  if (robotNext) { robotNext = false; loadRobotPlan(moves, baseAlg, m, ms); return; }
  loadSequence(moves.map((move) => ({ move, kind: 'solution' })), state.cube, baseAlg);
  $('rSolution').textContent = moves.join(' ');
  $('rLen').textContent = `${m.htm} moves (${m.qtm} quarter turns)`;
  $('rTime').textContent = `${ms} ms`;
  updatePhase();
  announce(`Solution found: ${m.htm} moves.`);
  if (moves.length && !reducedMotion()) play();
}

function reset() {
  if (animating) return;
  pause();
  queue.length = 0;
  loadSequence([], SOLVED, []);
  for (const id of ['rScramble', 'rSolution', 'rLen', 'rTime']) $(id).textContent = '—';
}

// ---------------------------------------------------------------- the robot
let lastPlan = null; // { plan, solution }
const tableAngle = (pos) => state.seq.slice(0, pos).reduce((a, it) => (it.step && it.step.op !== 'tip' ? a + turnOf(it.move).degrees : a), 0);

function setRig(on) {
  rig.el.hidden = !on;
  $('rigToggle').setAttribute('aria-pressed', String(on));
  fitCube();
}
$('rigToggle').addEventListener('click', () => setRig(rig.el.hidden));

const robotPill = (text, cls = '') => { $('robotPill').textContent = text; $('robotPill').className = `status-pill ${cls}`; };

function loadRobotPlan(moves, baseAlg, m, ms) {
  let plan;
  try { plan = planRobot(state.cube, moves, { hold: $('robotHold').value }); } catch (e) { robotPill('no plan', 'busy'); $('rSolution').textContent = e.message; return; }
  lastPlan = { plan, solution: moves.filter((mv) => !/^[xyz]/.test(mv)).join(' ') };
  const items = plan.steps.map((step) => ({ move: step.move, kind: 'robot', label: stepLabel(step), step }));
  loadSequence(items, plan.start, baseAlg && tidy(baseAlg.concat(parseAlg(plan.hold))));
  $('rSolution').textContent = moves.join(' ');
  $('rLen').textContent = `${m.htm} moves (${m.qtm} quarter turns)`;
  $('rTime').textContent = `${ms} ms`;
  $('robotOut').hidden = false;
  $('robotPlace').innerHTML = `Put the cube in with the <b>${plan.place.top}</b> centre on top and the <b>${plan.place.front}</b> centre facing you (the hub is at the back).`;
  $('robotSteps').textContent = `${plan.steps.length} · ${plan.counts.spin} spins, ${plan.counts.tip} tips, ${plan.counts.turn} turns`;
  $('robotTime').textContent = `about ${Math.round(plan.time)} s`;
  robotPill('planned', 'ready');
  showCode();
  setRig(true);
  setSpin(false);
  updatePhase();
  announce(`Robot plan: ${plan.steps.length} steps, about ${Math.round(plan.time)} seconds. Put the cube in with the ${plan.place.top} centre on top and the ${plan.place.front} centre facing you.`);
}

// Hub settings: ports and the numbers that depend on the build, kept in this browser.
const PORTS = 'ABCDEF';
const hubInputs = [...document.querySelectorAll('.hubgrid [data-key]')];
for (const el of hubInputs) if (el.tagName === 'SELECT') el.innerHTML = [...PORTS].map((p) => `<option>${p}</option>`).join('');
function readSettings() {
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem('cube-robot') || '{}'); } catch { /* storage unavailable */ }
  return { ...DEFAULT_SETTINGS, ...saved };
}
function showSettings(s) { for (const el of hubInputs) el.value = String(s[el.dataset.key]); }
function hubSettings() {
  const s = readSettings();
  for (const el of hubInputs) {
    const k = el.dataset.key;
    if (el.tagName === 'SELECT') s[k] = el.value;
    else if (el.value !== '' && Number.isFinite(Number(el.value))) s[k] = Number(el.value);
  }
  return s;
}
showSettings(readSettings());
for (const el of hubInputs) el.addEventListener('change', () => { try { localStorage.setItem('cube-robot', JSON.stringify(hubSettings())); } catch { /* ignore */ } });
$('hsReset').addEventListener('click', () => { showSettings(DEFAULT_SETTINGS); try { localStorage.removeItem('cube-robot'); } catch { /* ignore */ } });

function download(name, text, type) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}
$('btnRobot').addEventListener('click', () => { pause(); requestSolve(true); });

// The program viewer: the Pybricks program or the JSON plan, as text to read, copy or download. It follows the
// plan and the hub settings as they change.
let codeTab = 'py';
function codeText() {
  if (!lastPlan) return { error: 'No plan yet.' };
  if (codeTab === 'json') return { name: 'cube_robot_plan.json', type: 'application/json', text: planJSON(lastPlan.plan, { solution: lastPlan.solution, version: VERSION }) };
  const s = hubSettings();
  if (new Set([s.tablePort, s.leftPort, s.rightPort]).size < 3) return { error: 'Two motors are set to the same port: check the hub settings.' };
  return { name: 'cube_robot.py', type: 'text/x-python', text: pybricksProgram(lastPlan.plan, s, { solution: lastPlan.solution, title: `Cube Studio ${VERSION}` }) };
}
const esc = (t) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
// light colouring for Python: comments and strings (a # inside a string is not a comment)
const pyLine = (line) => esc(line).replace(/("[^"]*")|(#.*$)/g, (m, str) => (str ? `<span class="s">${m}</span>` : `<span class="c">${m}</span>`));
function showCode() {
  if ($('codeView').hidden) return;
  $('cvPy').setAttribute('aria-pressed', String(codeTab === 'py'));
  $('cvJson').setAttribute('aria-pressed', String(codeTab === 'json'));
  const c = codeText();
  $('cvName').textContent = c.name || '';
  $('cvMsg').textContent = c.error || '';
  $('cvMsg').className = `code-msg${c.error ? ' bad' : ''}`;
  $('cvCode').innerHTML = c.error ? '' : codeTab === 'py' ? c.text.split('\n').map(pyLine).join('\n') : esc(c.text);
  $('cvCopy').disabled = $('cvDownload').disabled = !!c.error;
}
function openCode(tab) {
  codeTab = tab;
  $('codeView').hidden = false;
  showCode();
  $('codeView').scrollIntoView({ block: 'start', behavior: reducedMotion() ? 'auto' : 'smooth' });
}
$('viewPy').addEventListener('click', () => openCode('py'));
$('viewJson').addEventListener('click', () => openCode('json'));
$('cvPy').addEventListener('click', () => { codeTab = 'py'; showCode(); });
$('cvJson').addEventListener('click', () => { codeTab = 'json'; showCode(); });
$('cvClose').addEventListener('click', () => { $('codeView').hidden = true; });
$('cvDownload').addEventListener('click', () => { const c = codeText(); if (!c.error) download(c.name, c.text, c.type); });
$('cvCopy').addEventListener('click', async () => {
  const c = codeText();
  if (c.error) return;
  try { await navigator.clipboard.writeText(c.text); $('cvMsg').textContent = 'Copied.'; } catch { $('cvMsg').textContent = 'Copying is blocked here: select the text instead.'; }
});
for (const el of hubInputs) el.addEventListener('input', showCode);
$('hsReset').addEventListener('click', showCode);

// ---------------------------------------------------------------- solver worker
let solverReady = false;
const worker = new Worker('vendor/solver-worker.js');
worker.onmessage = (e) => {
  const m = e.data;
  if (m.cmd === 'ready') {
    solverReady = true;
    pill('solver: ready', 'ready');
    updateTransport();
    if (/^#(demo|solve)$/.test(location.hash)) { autoSolve = true; scramble(); } else if (location.hash === '#scramble') scramble();
    return;
  }
  busy = false;
  pill('solver: ready', 'ready');
  if (m.cmd === 'scrambled') { onScrambled(m.algorithm); if (autoSolve) { autoSolve = false; setTimeout(requestSolve, 400); } }
  else if (m.cmd === 'solved') onSolved(m.algorithm, m.ms);
  else if (m.cmd === 'error') { pill('solver error', 'busy'); $('rSolution').textContent = m.message; }
  updateTransport();
};
let autoSolve = false;
worker.onerror = () => pill('solver unavailable', 'busy');
worker.postMessage({ cmd: 'init' });

// ---------------------------------------------------------------- view: 3D or net, orbit, labels, auto-spin
const stageSlot = $('stageSlot');
const railSlot = $('railSlot');
const sceneEl = $('scene');
let stageView = '3d';

function applyView() {
  if (stageView === '3d') { stageSlot.appendChild(sceneEl); railSlot.appendChild(netEl); }
  else { stageSlot.appendChild(netEl); railSlot.appendChild(sceneEl); }
  $('view3d').setAttribute('aria-pressed', String(stageView === '3d'));
  $('view2d').setAttribute('aria-pressed', String(stageView === '2d'));
  fitCube();
}
$('view3d').addEventListener('click', () => { stageView = '3d'; applyView(); });
$('view2d').addEventListener('click', () => { stageView = '2d'; applyView(); });

$('labelsToggle').addEventListener('click', () => {
  showLabels = !showLabels;
  $('labelsToggle').setAttribute('aria-pressed', String(showLabels));
  render();
});

function fitCube() {
  const host = sceneEl.parentElement;
  const box = Math.min(host.clientWidth, host.clientHeight) || 320;
  const room = rig.el.hidden ? 430 : 600; // the robot needs more room around the cube
  cubeEl.style.setProperty('--fit', Math.max(0.22, box / room).toFixed(3));
}
if (window.ResizeObserver) { const ro = new ResizeObserver(fitCube); ro.observe(stageSlot); ro.observe(railSlot); }
addEventListener('resize', fitCube);

let rx = -26, ry = -32, dragging = false, lastX = 0, lastY = 0;
const applyOrbit = () => { cubeEl.style.setProperty('--rx', `${rx.toFixed(1)}deg`); cubeEl.style.setProperty('--ry', `${ry.toFixed(1)}deg`); };
applyOrbit();
// Dragging the background turns the whole view; dragging a sticker turns its layer the way it was dragged.
let grab = null; // { cubie, dir, x, y } while a sticker is held
const centre = (el) => { const r = el.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; };
const cubieAt = (pos) => cubies.find((cb) => cb.pos.every((v, i) => v === pos[i]));

// The layer a sticker drag turns: compare the drag on screen with where the face's two in-plane directions point on
// screen (measured from the face's own stickers, so the view's tilt and perspective are taken into account).
function moveForDrag(cb, dirCls, dx, dy) {
  const n = DIRS.find((d) => d.cls === dirCls).css;
  const mid = cubieAt(n).faces[dirCls].el;
  let best = null;
  for (let k = 0; k < 3; k++) {
    if (n[k] !== 0) continue;
    const a = [0, 0, 0]; a[k] = 1;
    const [x0, y0] = centre(mid);
    const [x1, y1] = centre(cubieAt(n.map((v, i) => v + a[i])).faces[dirCls].el);
    const len = Math.hypot(x1 - x0, y1 - y0) || 1;
    const dot = ((x1 - x0) * dx + (y1 - y0) * dy) / len;
    if (!best || Math.abs(dot) > Math.abs(best.dot)) best = { dot, a };
  }
  const d = best.a.map((v) => v * Math.sign(best.dot));
  return dragMove(toModel(cb.pos), toModel(n), toModel(d));
}

sceneEl.addEventListener('pointerdown', (e) => {
  setSpin(false);
  const face = e.target.closest('.face');
  if (face && cubies[Number(face.dataset.cubie)].faces[face.dataset.dir].index !== undefined) {
    grab = { cubie: cubies[Number(face.dataset.cubie)], dir: face.dataset.dir, x: e.clientX, y: e.clientY };
  } else {
    dragging = true; lastX = e.clientX; lastY = e.clientY;
  }
  sceneEl.setPointerCapture(e.pointerId);
});
sceneEl.addEventListener('pointermove', (e) => {
  if (grab) {
    const dx = e.clientX - grab.x, dy = e.clientY - grab.y;
    if (Math.hypot(dx, dy) < 14) return;
    const mv = moveForDrag(grab.cubie, grab.dir, dx, dy);
    grab = null;
    if (mv) makeMoves([mv], 'manual');
    return;
  }
  if (!dragging) return;
  ry += (e.clientX - lastX) * 0.5;
  rx = Math.max(-88, Math.min(88, rx - (e.clientY - lastY) * 0.5));
  lastX = e.clientX; lastY = e.clientY;
  cubeEl.classList.remove('spin');
  applyOrbit();
});
const release = (e) => { dragging = false; grab = null; try { sceneEl.releasePointerCapture(e.pointerId); } catch { /* ignore */ } };
sceneEl.addEventListener('pointerup', release);
sceneEl.addEventListener('pointercancel', release);

function reducedMotion() { return matchMedia('(prefers-reduced-motion: reduce)').matches; }
let autoSpin = !reducedMotion();
function setSpin(on) { autoSpin = on; $('spinToggle').setAttribute('aria-pressed', String(on)); }
setSpin(autoSpin);
$('spinToggle').addEventListener('click', () => setSpin(!autoSpin));
(function loop() {
  if (autoSpin && !dragging && !state.playing && !animating) { cubeEl.classList.add('spin'); ry += 0.18; applyOrbit(); }
  else cubeEl.classList.remove('spin');
  requestAnimationFrame(loop);
})();

// ---------------------------------------------------------------- wiring
$('btnScramble').addEventListener('click', scramble);
$('btnSolve').addEventListener('click', () => requestSolve());
$('btnReset').addEventListener('click', reset);
tp.play.addEventListener('click', () => (state.playing ? pause() : play()));
tp.fwd.addEventListener('click', stepForward);
tp.back.addEventListener('click', stepBack);
tp.start.addEventListener('click', () => { pause(); seekTo(0); });
tp.end.addEventListener('click', () => { pause(); seekTo(state.seq.length); });
scrub.addEventListener('input', () => { pause(); seekTo(Number(scrub.value)); });

// The move buttons: every face, slice and rotation, each clockwise, anticlockwise and twice.
const GROUPS = ['U', 'D', 'R', 'L', 'F', 'B', 'M', 'E', 'S', 'x', 'y', 'z'];
$('turnGrid').innerHTML = GROUPS.map((b) => `<div class="turn-group">${[b, `${b}'`, `${b}2`].map((m) => `<button type="button" data-move="${m}" aria-label="Turn ${m}">${m}</button>`).join('')}</div>`).join('');
$('turnGrid').addEventListener('click', (e) => { const b = e.target.closest('[data-move]'); if (b) makeMoves([b.dataset.move], 'manual'); });

$('algForm').addEventListener('submit', (e) => { e.preventDefault(); const m = readAlg(); if (m) makeMoves(m, 'alg'); });
$('algSetup').addEventListener('click', () => { const m = readAlg(); if (m) { setUp(m); flash(`Set up with ${m.length} moves.`); } });
$('btnUndo').addEventListener('click', undo);
$('btnRedo').addEventListener('click', redo);
$('btnLink').addEventListener('click', async () => {
  const url = link();
  try { await navigator.clipboard.writeText(url); flash('Link copied. It opens this cube with this move list.'); }
  catch { flash(url); }
});

// Keys: a face, slice or rotation letter turns it (Shift: the other way); Space, arrows; Ctrl+Z / Ctrl+Y.
const KEYS = { u: 'U', r: 'R', f: 'F', d: 'D', l: 'L', b: 'B', m: 'M', e: 'E', s: 'S', x: 'x', y: 'y', z: 'z' };
document.addEventListener('keydown', (e) => {
  if (e.target.closest('input, select, textarea') || editing) return;
  const k = e.key.toLowerCase();
  if ((e.ctrlKey || e.metaKey) && !e.altKey) {
    if (k === 'z' && !e.shiftKey) { e.preventDefault(); undo(); }
    else if (k === 'y' || (k === 'z' && e.shiftKey)) { e.preventDefault(); redo(); }
    return;
  }
  if (e.altKey) return;
  if (e.code === 'Space' && !e.target.closest('button')) { e.preventDefault(); if (state.seq.length) (state.playing ? pause() : play()); }
  else if (e.key === 'ArrowRight') stepForward();
  else if (e.key === 'ArrowLeft') stepBack();
  else if (KEYS[k]) { e.preventDefault(); makeMoves([e.shiftKey ? `${KEYS[k]}'` : KEYS[k]], 'manual'); }
});

$('ver').textContent = `v${VERSION}`;
$('verFoot').textContent = `v${VERSION}`;
$('theme').addEventListener('click', () => {
  const next = document.documentElement.dataset.theme === 'light' ? 'dark' : 'light';
  document.documentElement.dataset.theme = next;
  try { localStorage.setItem('cube-theme', next); } catch { /* ignore */ }
});

// ---------------------------------------------------------------- your own cube
let beforeEdit = SOLVED;
const editor = createEditor({
  onChange(painted) { state.cube = painted; render(); },
  onUse(painted) {
    editing = false;
    document.querySelector('.turnpanel').hidden = false;
    loadSequence([], painted, null);
    $('rScramble').textContent = 'your own cube';
    for (const id of ['rSolution', 'rLen', 'rTime']) $(id).textContent = '—';
    announce('Your cube is ready. Press Solve to solve it.');
  },
  onClose() {
    editing = false;
    document.querySelector('.turnpanel').hidden = false;
    state.cube = beforeEdit;
    render();
  },
});
$('btnEdit').addEventListener('click', () => {
  if (animating || state.playing) return;
  pause();
  editing = true;
  beforeEdit = state.cube;
  document.querySelector('.turnpanel').hidden = true;
  editor.open(state.cube);
  updateTransport();
  $('editPanel').scrollIntoView({ block: 'nearest' });
});

applyView();
render();
openLink();

// the cube assembles when the page opens
if (!reducedMotion()) {
  cubies.forEach((cb, i) => {
    const [dx, dy, dz] = cb.pos.map((v) => v * STEP * 3);
    cb.el.style.transition = 'none';
    cb.el.style.opacity = '0';
    cb.el.style.transform = `translate3d(${dx}px,${dy}px,${dz}px) scale(0.2)`;
    void cb.el.offsetWidth;
    cb.el.classList.add('assemble');
    cb.el.style.transitionDelay = `${i * 11}ms`;
    cb.el.style.opacity = '1';
    cb.el.style.transform = '';
  });
  setTimeout(() => cubies.forEach((cb) => { cb.el.classList.remove('assemble'); cb.el.style.transitionDelay = ''; cb.el.style.transition = ''; }),
    620 + cubies.length * 11 + 60);
}
