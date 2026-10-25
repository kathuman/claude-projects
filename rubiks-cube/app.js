// Cube Studio: the page. The cube's state is a 54-sticker string (src/model.js); the 3D view is 26 small cubes drawn
// with CSS 3D transforms, the 2D net a grid of stickers, both redrawn from the state. Scrambles and solutions come
// from the solver worker (cubejs, Kociemba's two-phase algorithm); the move list plays like a video.

import { SOLVED, applyMove, isSolved, stickerAt, turnOf } from './src/model.js';
import { parseAlg, invert, tidy, metrics } from './src/notation.js';

const VERSION = '1.0.0';
const $ = (id) => document.getElementById(id);

const COLOR = { U: '--cube-W', D: '--cube-Y', F: '--cube-G', B: '--cube-B', L: '--cube-O', R: '--cube-R' };
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
    const st = document.createElement('div');
    st.className = 'sticker';
    fe.appendChild(st);
    el.appendChild(fe);
    faces[d.cls] = { el: st, index: stickerAt(toModel([x, y, z]), toModel(d.css)) };
  }
  cubies.push({ el, pos: [x, y, z], faces });
  cubeEl.appendChild(el);
}

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
const state = {
  cube: SOLVED,
  base: SOLVED,      // the cube before the loaded sequence
  seq: [],           // [{ move, kind: 'scramble' | 'solution' }]
  pos: 0,            // moves applied from base
  playing: false,
};
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
  $('rState').textContent = isSolved(s) ? 'solved' : 'scrambled';
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

function doMove(move) {
  const t = turnOf(move);
  const dur = duration();
  return new Promise((resolve) => {
    const layer = cubies.filter((cb) => t.layers.includes(toModel(cb.pos)[CSS_AXIS[t.axis]]));
    const finish = () => {
      state.cube = applyMove(state.cube, move);
      for (const cb of layer) { cb.el.classList.remove('move'); cb.el.style.transform = ''; }
      void cubeEl.offsetWidth; // the reset must not animate
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

function renderMoveTokens() {
  movesEl.innerHTML = '';
  state.seq.forEach((item, i) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = `move-token${item.kind === 'scramble' ? ' scramble' : ''}`;
    b.textContent = item.move;
    b.title = `${i + 1} · ${item.kind}`;
    b.setAttribute('aria-label', `Go to after move ${i + 1}, ${item.move}`);
    b.addEventListener('click', () => { pause(); seekTo(i + 1); });
    movesEl.appendChild(b);
  });
  scrub.max = String(state.seq.length);
  updateTransport();
}

function updateTransport() {
  const n = state.seq.length;
  for (const el of Object.values(tp)) el.disabled = !n || animating;
  scrub.disabled = !n;
  if (n) {
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
  $('btnSolve').disabled = !solverReady || busy || animating || state.playing || isSolved(state.cube);
  $('btnScramble').disabled = !solverReady || busy || animating || state.playing;
  $('btnReset').disabled = animating || state.playing;
}

function seekTo(target) {
  if (animating) return;
  target = Math.max(0, Math.min(state.seq.length, target));
  if (target === state.pos) return;
  if (target < state.pos) { state.cube = state.base; state.pos = 0; }
  while (state.pos < target) { state.cube = applyMove(state.cube, state.seq[state.pos].move); state.pos++; }
  render();
  updatePhase();
}

function updatePhase() {
  const el = $('tlPhase');
  if (!state.seq.length) { el.textContent = 'idle'; return; }
  if (state.pos >= state.seq.length) el.textContent = isSolved(state.cube) ? 'solved' : 'sequence complete';
  else el.textContent = state.seq[state.pos].kind === 'scramble' ? 'scrambling' : 'solving';
}

async function stepForward() {
  if (animating || state.pos >= state.seq.length) return;
  animating = true; updateTransport();
  await doMove(state.seq[state.pos].move);
  state.pos++;
  animating = false;
  updatePhase(); updateTransport();
}

async function stepBack() {
  if (animating || state.pos === 0) return;
  animating = true; updateTransport();
  await doMove(invert(state.seq[state.pos - 1].move));
  state.pos--;
  animating = false;
  updatePhase(); updateTransport();
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function play() {
  if (animating || state.pos >= state.seq.length) return;
  state.playing = true; updateTransport();
  while (state.playing && state.pos < state.seq.length) {
    animating = true; updateTransport();
    await doMove(state.seq[state.pos].move);
    state.pos++;
    animating = false;
    updatePhase(); updateTransport();
    if (state.playing) await wait(90);
  }
  state.playing = false;
  updatePhase(); updateTransport();
  if (isSolved(state.cube) && state.seq.length) announce('Solved.');
}
function pause() { state.playing = false; updateTransport(); }

function loadSequence(items, base) {
  state.base = base;
  state.cube = base;
  state.pos = 0;
  state.seq = items;
  renderMoveTokens();
  render();
  updatePhase();
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
  loadSequence(moves.map((move) => ({ move, kind: 'scramble' })), SOLVED);
  $('rScramble').textContent = moves.join(' ');
  $('rSolution').textContent = '—';
  $('rLen').textContent = '—';
  $('rTime').textContent = '—';
  seekTo(moves.length); // show the scrambled cube; the scramble can be stepped through from the start
  announce(`Scrambled with ${moves.length} moves from a random position.`);
}

function requestSolve() {
  if (!solverReady || busy || animating || isSolved(state.cube)) return;
  busy = true; updateTransport();
  pill('solving…', 'busy');
  worker.postMessage({ cmd: 'solve', facelets: state.cube });
}

function onSolved(alg, ms) {
  const moves = tidy(parseAlg(alg));
  const m = metrics(moves);
  loadSequence(moves.map((move) => ({ move, kind: 'solution' })), state.cube);
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
  loadSequence([], SOLVED);
  for (const id of ['rScramble', 'rSolution', 'rLen', 'rTime']) $(id).textContent = '—';
}

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
  cubeEl.style.setProperty('--fit', Math.max(0.28, box / 430).toFixed(3));
}
if (window.ResizeObserver) { const ro = new ResizeObserver(fitCube); ro.observe(stageSlot); ro.observe(railSlot); }
addEventListener('resize', fitCube);

let rx = -26, ry = -32, dragging = false, lastX = 0, lastY = 0;
const applyOrbit = () => { cubeEl.style.setProperty('--rx', `${rx.toFixed(1)}deg`); cubeEl.style.setProperty('--ry', `${ry.toFixed(1)}deg`); };
applyOrbit();
sceneEl.addEventListener('pointerdown', (e) => {
  dragging = true; setSpin(false); lastX = e.clientX; lastY = e.clientY;
  sceneEl.setPointerCapture(e.pointerId);
});
sceneEl.addEventListener('pointermove', (e) => {
  if (!dragging) return;
  ry += (e.clientX - lastX) * 0.5;
  rx = Math.max(-88, Math.min(88, rx - (e.clientY - lastY) * 0.5));
  lastX = e.clientX; lastY = e.clientY;
  cubeEl.classList.remove('spin');
  applyOrbit();
});
sceneEl.addEventListener('pointerup', (e) => { dragging = false; try { sceneEl.releasePointerCapture(e.pointerId); } catch { /* ignore */ } });
sceneEl.addEventListener('pointercancel', () => { dragging = false; });

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
$('btnSolve').addEventListener('click', requestSolve);
$('btnReset').addEventListener('click', reset);
tp.play.addEventListener('click', () => (state.playing ? pause() : play()));
tp.fwd.addEventListener('click', stepForward);
tp.back.addEventListener('click', stepBack);
tp.start.addEventListener('click', () => { pause(); seekTo(0); });
tp.end.addEventListener('click', () => { pause(); seekTo(state.seq.length); });
scrub.addEventListener('input', () => { pause(); seekTo(Number(scrub.value)); });

document.addEventListener('keydown', (e) => {
  if (e.target.closest('input, select, textarea') || e.metaKey || e.ctrlKey || e.altKey) return;
  if (e.code === 'Space' && !e.target.closest('button')) { e.preventDefault(); if (state.seq.length) (state.playing ? pause() : play()); }
  else if (e.key === 'ArrowRight') stepForward();
  else if (e.key === 'ArrowLeft') stepBack();
  else if (e.key.toLowerCase() === 's') scramble();
});

$('ver').textContent = `v${VERSION}`;
$('verFoot').textContent = `v${VERSION}`;
$('theme').addEventListener('click', () => {
  const next = document.documentElement.dataset.theme === 'light' ? 'dark' : 'light';
  document.documentElement.dataset.theme = next;
  try { localStorage.setItem('cube-theme', next); } catch { /* ignore */ }
});

applyView();
render();

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
