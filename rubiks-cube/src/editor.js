// "Your cube": paint the stickers of a real cube on the net, or scan its six faces with the camera, then check it and
// use it. The camera picture never leaves the device: nine colours are read from it and the frame is dropped.

import { validate } from './validate.js';
import { HOLDS, sampleFace, classify } from './scan.js';

const COLOR = { U: '--cube-W', D: '--cube-Y', F: '--cube-G', B: '--cube-B', L: '--cube-O', R: '--cube-R', '?': '--unknown' };
const NAMES = { U: 'white', R: 'red', F: 'green', D: 'yellow', L: 'orange', B: 'blue' };
const CENTRE = (i) => i % 9 === 4;
const $ = (id) => document.getElementById(id);

/**
 * opts: { onChange(state) — the painted cube changed (for the 3D view); onUse(state) — a checked cube to use;
 *         onClose() — editing ended without using it }
 */
export function createEditor({ onChange, onUse, onClose }) {
  let painted = '';
  let colour = 'U';
  let marks = { bad: new Set(), doubt: new Set() };
  let stream = null;
  let step = 0;
  let samples = [];

  // the palette
  $('palette').innerHTML = 'URFDLB'.split('').map((f) => `<button type="button" role="radio" data-colour="${f}" aria-label="Paint ${NAMES[f]}" style="--cellColor: var(${COLOR[f]})"><span>${NAMES[f]}</span></button>`).join('');
  $('palette').addEventListener('click', (e) => { const b = e.target.closest('[data-colour]'); if (b) { colour = b.dataset.colour; drawPalette(); } });
  const drawPalette = () => $('palette').querySelectorAll('[data-colour]').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.colour === colour)));

  // the net to paint
  const net = $('paintNet');
  const cells = [];
  const BASE = { U: 0, R: 9, F: 18, D: 27, L: 36, B: 45 };
  for (const f of ['U', 'L', 'F', 'R', 'B', 'D']) {
    const g = document.createElement('div');
    g.className = `face-grid slot-${f}`;
    for (let j = 0; j < 9; j++) {
      const i = BASE[f] + j;
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'cell';
      b.dataset.i = String(i);
      if (CENTRE(i)) { b.disabled = true; b.title = `${NAMES[f]} centre`; }
      g.appendChild(b);
      cells[i] = b;
    }
    net.appendChild(g);
  }
  net.addEventListener('click', (e) => {
    const b = e.target.closest('button.cell');
    if (!b || b.disabled) return;
    const i = Number(b.dataset.i);
    painted = painted.slice(0, i) + colour + painted.slice(i + 1);
    marks.bad.delete(i); marks.doubt.delete(i);
    $('editProblems').innerHTML = '';
    draw();
  });

  function draw() {
    cells.forEach((b, i) => {
      b.style.setProperty('--cellColor', `var(${COLOR[painted[i]]})`);
      b.classList.toggle('bad', marks.bad.has(i));
      b.classList.toggle('doubt', marks.doubt.has(i));
      b.setAttribute('aria-label', `${painted[i] === '?' ? 'not painted' : NAMES[painted[i]]}${CENTRE(i) ? ' centre' : ''}`);
    });
    const left = painted.split('').filter((c) => c === '?').length;
    $('editCount').textContent = left ? `${left} sticker${left > 1 ? 's' : ''} left to paint` : 'every sticker painted';
    onChange(painted);
  }

  function showProblems(list, doubtful = []) {
    marks = { bad: new Set(), doubt: new Set(doubtful) };
    for (const p of list) if (p.stickers.length <= 12) p.stickers.forEach((i) => marks.bad.add(i));
    $('editProblems').innerHTML = list.map((p) => `<li>${p.text}</li>`).join('');
    draw();
  }

  // ---- camera
  const video = $('camVideo');
  const overlay = $('camGrid');
  const grid = () => { const s = Math.min(video.videoWidth, video.videoHeight) * 0.62; return { x: (video.videoWidth - s) / 2, y: (video.videoHeight - s) / 2, size: s }; };

  function drawOverlay() {
    if (!stream) return;
    const w = overlay.width = video.clientWidth, h = overlay.height = video.clientHeight;
    const ctx = overlay.getContext('2d');
    ctx.clearRect(0, 0, w, h);
    if (video.videoWidth) {
      const k = w / video.videoWidth;
      const g = grid();
      ctx.strokeStyle = 'rgba(255,255,255,.9)';
      ctx.lineWidth = 2;
      for (let t = 0; t <= 3; t++) {
        ctx.beginPath(); ctx.moveTo(k * (g.x + t * g.size / 3), k * g.y); ctx.lineTo(k * (g.x + t * g.size / 3), k * (g.y + g.size)); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(k * g.x, k * (g.y + t * g.size / 3)); ctx.lineTo(k * (g.x + g.size), k * (g.y + t * g.size / 3)); ctx.stroke();
      }
    }
    requestAnimationFrame(drawOverlay);
  }

  function hint() {
    if (step >= 6) { $('camHint').textContent = 'All six faces read.'; return; }
    const h = HOLDS[step];
    $('camHint').innerHTML = `<b>Face ${step + 1} of 6.</b> Hold the cube with the <b>${h.show}</b> centre facing the camera and the <b>${h.top}</b> centre on top, then fit the face in the grid.`;
    $('camBack').disabled = step === 0;
    $('camFaces').innerHTML = HOLDS.map((hh, k) => `<div class="camface${k === step ? ' now' : ''}" title="${hh.show} face">${k < step
      ? samples[k].map((c) => `<i style="background: rgb(${c.join(',')})"></i>`).join('') : '<span>' + hh.show + '</span>'}</div>`).join('');
  }

  async function startCamera() {
    $('editProblems').innerHTML = '';
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false });
    } catch (e) {
      showProblems([{ text: `The camera could not be opened (${e.name === 'NotAllowedError' ? 'permission was refused' : e.message}). You can paint the stickers instead.`, stickers: [] }]);
      return;
    }
    video.srcObject = stream;
    await video.play().catch(() => {});
    $('camera').hidden = false;
    step = 0; samples = [];
    hint();
    drawOverlay();
  }

  function stopCamera() {
    if (stream) stream.getTracks().forEach((t) => t.stop());
    stream = null;
    video.srcObject = null;
    $('camera').hidden = true;
  }

  function capture() {
    if (!stream || !video.videoWidth || step >= 6) return;
    const c = document.createElement('canvas');
    c.width = video.videoWidth; c.height = video.videoHeight;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(video, 0, 0);
    samples[step] = sampleFace(ctx.getImageData(0, 0, c.width, c.height).data, c.width, grid());
    step++;
    hint();
    if (step === 6) finishScan();
  }

  function finishScan() {
    stopCamera();
    const { state, confidence, repaired } = classify(samples.flat());
    painted = state;
    const check = validate(painted);
    const doubtful = check.ok ? repaired : confidence.map((c, i) => [c, i]).filter(([, i]) => !CENTRE(i)).sort((a, b) => a[0] - b[0]).slice(0, 8).map(([, i]) => i);
    showProblems(check.ok
      ? [{ text: `Read. ${repaired.length ? 'Two stickers were unclear and have been set so the cube is possible; they are marked. ' : ''}Compare the net with your cube, fix any sticker that is wrong, then press "Check and use this cube".`, stickers: [] }]
      : [...check.problems, { text: 'The marked stickers were the hardest to read: check those first.', stickers: [] }], doubtful);
  }

  $('camOpen').addEventListener('click', startCamera);
  $('camShoot').addEventListener('click', capture);
  $('camBack').addEventListener('click', () => { if (step > 0) { step--; hint(); } });
  $('camStop').addEventListener('click', stopCamera);
  $('editBlank').addEventListener('click', () => { painted = Array.from({ length: 54 }, (_, i) => (CENTRE(i) ? 'URFDLB'[i / 9 | 0] : '?')).join(''); showProblems([]); });
  $('editCancel').addEventListener('click', () => { close(); onClose(); });
  $('editUse').addEventListener('click', () => {
    const r = validate(painted);
    if (!r.ok) { showProblems(r.problems); return; }
    close();
    onUse(painted);
  });

  function open(current) {
    painted = current;
    colour = 'U';
    drawPalette();
    showProblems([]);
    $('editPanel').hidden = false;
  }
  function close() {
    stopCamera();
    $('editPanel').hidden = true;
  }
  return { open, close, get state() { return painted; } };
}
