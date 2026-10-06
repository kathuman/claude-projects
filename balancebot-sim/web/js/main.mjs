import { restState, forcesAt } from './dynamics.mjs';
import { deriveFromGeometry, mergeParams } from './params.mjs';
import { createController, seededRandom } from './controller.mjs';
import { createSimLoop } from './simloop.mjs';
import { buildScene, buildGround } from './scene.mjs';
import { PRESETS, buildPreset } from './presets.mjs';
import { MOTORS, BALBOA_EXTERNAL, motorParams, freeSpeedAt } from './motors.mjs';

// Bump on every user-visible change.
//   1.0.0  launch: Lagrangian pitch/drive dynamics, cascaded PID, presets, FreeCAD parameters
//   1.1.0  honest and usable: every preset is shown with a scripted push (the failure presets visibly
//          fail), a floor the body lands on (motors cut on a fall, like real firmware), a visible Push
//          button, seeded (repeatable) noise and pushes, no 404 at load, stage-first phone layout,
//          the Cobot Lab theme, version + credit + footer; fixes: slider edits never reached the
//          physics after the first geometry change, the body tilt and wheel spin were drawn mirrored,
//          and a control loop slower than the frame rate never ran (the 25 Hz preset froze)
//   1.2.0  real hardware: DC gearmotors from datasheets (back-EMF top speed, battery voltage, current,
//          gear play, rotor inertia), wheel encoders with quantized counts and a firmware speed filter,
//          tyre grip and wheel slip, a yaw integral; presets for a Balboa-class robot (published Pololu
//          parts), flat battery, sloppy gears, ice and the old ideal motors
const APP_VERSION = '1.2.0';
document.getElementById('ver').textContent = 'v' + APP_VERSION;
document.getElementById('ver-foot').textContent = 'v' + APP_VERSION;

const THREE = window.THREE;
const FALL_ANGLE = 1.2; // rad (~69 deg) -- past this, the firmware gives up and cuts the motors
const CHART_RANGE_DEG = 45;
const CHART_SAMPLES = 320;
const $ = (id) => document.getElementById(id);

// --- live configuration state -------------------------------------------
let presetKey = 'default';
let built = buildPreset(presetKey);
let geometry = built.geometry;
let material = built.material;
let params = built.params;
let gains = built.gains;
let realism = built.realism;

const controller = createController(gains, realism);
const loop = createSimLoop(params, controller, 2000);
let fallen = false;
let simTime = 0;
let pendingPush = null; // { at, kick }
let pushRand = seededRandom(realism.noiseSeed + 7919);

function setParams(p) {
  params = p;
  loop.setParams(params);
}

function recomputeFromGeometry() {
  setParams(mergeParams(deriveFromGeometry(geometry, material), { motor: params.motor, environment: params.environment }));
  robot.rebuild(params);
}

// --- three.js scene -------------------------------------------------------
const stageEl = $('stage');
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
if (renderer.outputEncoding !== undefined) renderer.outputEncoding = THREE.sRGBEncoding;
stageEl.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0a2f52);
scene.fog = new THREE.Fog(0x0a2f52, 2.5, 9);

const camera = new THREE.PerspectiveCamera(42, 1, 0.01, 50);

scene.add(new THREE.HemisphereLight(0xbfd8ff, 0x0a2f52, 0.45));
const key = new THREE.DirectionalLight(0xfff4e6, 1.1);
key.position.set(1.2, 1.8, 1);
key.castShadow = true;
key.shadow.mapSize.set(1024, 1024);
Object.assign(key.shadow.camera, { left: -1, right: 1, top: 1, bottom: -1, near: 0.2, far: 4 });
key.shadow.bias = -0.0015;
scene.add(key);
const rim = new THREE.DirectionalLight(0x7dd3fc, 0.35);
rim.position.set(-1.2, 0.8, -1);
scene.add(rim);

buildGround(THREE, scene);
const robot = buildScene(THREE, scene, params);

// --- chase-orbit camera -----------------------------------------------
const spherical = { theta: 1.3, phi: 1.0, radius: 0.95 };
const cameraTarget = new THREE.Vector3(0, 0.15, 0);
const cameraHeight = () => params.geometry.wheelRadius + params.geometry.bodyHeight * 0.5;

function updateCamera(state) {
  cameraTarget.set(state.posX, cameraHeight(), -state.posZ);
  camera.position.set(
    cameraTarget.x + spherical.radius * Math.sin(spherical.phi) * Math.sin(spherical.theta),
    cameraTarget.y + spherical.radius * Math.cos(spherical.phi),
    cameraTarget.z + spherical.radius * Math.sin(spherical.phi) * Math.cos(spherical.theta)
  );
  camera.lookAt(cameraTarget);
}
updateCamera(restState());

const dom = renderer.domElement;
dom.style.touchAction = 'none';
let dragging = false, lastX = 0, lastY = 0;
dom.addEventListener('pointerdown', (e) => { dragging = true; lastX = e.clientX; lastY = e.clientY; dom.setPointerCapture(e.pointerId); });
dom.addEventListener('pointerup', () => { dragging = false; });
dom.addEventListener('pointercancel', () => { dragging = false; });
dom.addEventListener('pointermove', (e) => {
  if (!dragging) return;
  const dx = e.clientX - lastX, dy = e.clientY - lastY;
  lastX = e.clientX; lastY = e.clientY;
  spherical.theta -= dx * 0.006;
  spherical.phi = Math.max(0.2, Math.min(1.45, spherical.phi - dy * 0.006));
});
dom.addEventListener('wheel', (e) => {
  e.preventDefault();
  spherical.radius = Math.max(0.25, Math.min(3.5, spherical.radius * (1 + e.deltaY * 0.0012)));
}, { passive: false });

function resize() {
  const w = stageEl.clientWidth, h = stageEl.clientHeight;
  if (!w || !h) return;
  renderer.setSize(w, h);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
new ResizeObserver(resize).observe(stageEl);

// --- UI: sliders ------------------------------------------------------------
const geo = (k) => ({ get: () => geometry[k], set: (v) => { geometry[k] = v; recomputeFromGeometry(); markCustom(); } });
const env = (k) => ({ get: () => params.environment[k], set: (v) => { setParams({ ...params, environment: { ...params.environment, [k]: v } }); markCustom(); } });
const mot = (k, scale = 1) => ({ get: () => params.motor[k] / scale, set: (v) => { setParams({ ...params, motor: { ...params.motor, [k]: v * scale } }); refreshMotorNote(); markCustom(); } });
const gain = (k) => ({ get: () => gains[k], set: (v) => { gains = { ...gains, [k]: v }; controller.setGains(gains); markCustom(); } });
const real = (k) => ({ get: () => realism[k], set: (v) => { realism = { ...realism, [k]: v }; controller.setRealism(realism); if (k === 'noiseSeed') pushRand = seededRandom(v + 7919); markCustom(); } });
let driveSpeed = 0.35;

const sliderSpecs = [
  { id: 'wheelRadius', ...geo('wheelRadius'), unit: 'm', decimals: 3 },
  { id: 'trackWidth', ...geo('trackWidth'), unit: 'm', decimals: 3 },
  { id: 'bodyHeight', ...geo('bodyHeight'), unit: 'm', decimals: 3 },
  { id: 'comHeight', ...geo('comHeight'), unit: 'm', decimals: 3 },
  { id: 'bodyDensity', get: () => material.bodyDensity, set: (v) => { material.bodyDensity = v; recomputeFromGeometry(); markCustom(); }, unit: 'kg/m³', decimals: 0 },
  { id: 'groundFriction', ...env('groundFriction'), decimals: 2 },
  { id: 'gravity', ...env('gravity'), unit: 'm/s²', decimals: 1 },

  { id: 'batteryVoltage', ...mot('batteryVoltage'), unit: 'V', decimals: 1 },
  { id: 'backlashDeg', ...mot('backlash', Math.PI / 180), unit: '°', decimals: 1 },
  { id: 'maxTorque', ...mot('maxTorque'), unit: 'N·m', decimals: 2 },
  { id: 'timeConstant', ...mot('timeConstant'), unit: 's', decimals: 3 },

  { id: 'angleKp', ...gain('angleKp'), decimals: 1 },
  { id: 'angleKd', ...gain('angleKd'), decimals: 2 },
  { id: 'angleKi', ...gain('angleKi'), decimals: 1 },
  { id: 'velocityKp', ...gain('velocityKp'), decimals: 2 },
  { id: 'velocityKi', ...gain('velocityKi'), decimals: 2 },
  { id: 'yawKp', ...gain('yawKp'), decimals: 3 },
  { id: 'yawKi', ...gain('yawKi'), decimals: 2 },

  { id: 'controlLoopHz', ...real('controlLoopHz'), unit: 'Hz', decimals: 0 },
  { id: 'sensorDelaySteps', ...real('sensorDelaySteps'), decimals: 0 },
  { id: 'sensorNoiseStdTheta', ...real('sensorNoiseStdTheta'), unit: 'rad', decimals: 4 },
  { id: 'sensorNoiseStdRate', ...real('sensorNoiseStdRate'), unit: 'rad/s', decimals: 3 },
  { id: 'speedFilterHz', ...real('speedFilterHz'), unit: 'Hz', decimals: 0 },
  { id: 'noiseSeed', ...real('noiseSeed'), decimals: 0 },
  { id: 'driveSpeed', get: () => driveSpeed, set: (v) => { driveSpeed = v; }, unit: 'm/s', decimals: 2 },
];

function refreshSliderUI(spec) {
  const input = $(spec.id), label = $('v-' + spec.id), value = spec.get();
  input.value = value;
  if (label) label.textContent = value.toFixed(spec.decimals) + (spec.unit ? ' ' + spec.unit : '');
}
const refreshAllSliderUI = () => sliderSpecs.forEach(refreshSliderUI);

sliderSpecs.forEach((spec) => {
  $(spec.id).addEventListener('input', () => {
    spec.set(parseFloat($(spec.id).value));
    refreshSliderUI(spec);
  });
});

// --- motors -------------------------------------------------------------------
const motorModel = $('motor-model'), motorSelect = $('motor-select'), balboaGears = $('balboa-gears');
Object.keys(MOTORS).forEach((k) => motorSelect.add(new Option(MOTORS[k].label, k)));

function refreshMotorUI() {
  motorModel.value = params.motor.model;
  motorSelect.value = params.motor.motorKey in MOTORS ? params.motor.motorKey : 'generic';
  balboaGears.checked = params.motor.externalRatio > 1;
  const dc = params.motor.model === 'dc';
  document.querySelectorAll('.dc-only').forEach((el) => { el.hidden = !dc; });
  document.querySelectorAll('.ideal-only').forEach((el) => { el.hidden = dc; });
  const bv = $('batteryVoltage');
  bv.min = (params.motor.batteryNominal * 0.6).toFixed(1);
  bv.max = (params.motor.batteryNominal * 1.25).toFixed(1);
  refreshMotorNote();
}

function refreshMotorNote() {
  const m = params.motor, note = $('motor-note');
  if (m.model !== 'dc') {
    note.innerHTML = 'A perfect torque source: any torque up to the limit at any speed, after a first-order lag. No top speed, no battery, no gear play &mdash; the v1.0 model, kept for comparison.';
    return;
  }
  const spec = MOTORS[m.motorKey] || MOTORS.generic;
  const top = freeSpeedAt(m, m.batteryVoltage) * params.geometry.wheelRadius;
  const stall = (m.stallTorque * m.batteryVoltage) / m.vNom;
  note.innerHTML =
    `At ${m.batteryVoltage.toFixed(1)} V (firmware assumes ${m.batteryNominal.toFixed(1)} V): top speed <b>${top.toFixed(2)} m/s</b>, ` +
    `stall <b>${stall.toFixed(2)} N·m</b> per wheel, <b>${m.encoderCpr}</b> encoder counts per wheel turn.<br>` +
    `Source: ${spec.source}` + (spec.estimated && spec.estimated.length ? ` <span class="est">Estimated: ${spec.estimated.join(', ')}.</span>` : '');
}

function rebuildMotor() {
  const spec = MOTORS[motorSelect.value];
  const nominal = motorSelect.value === 'generic' ? 7.4 : 7.2; // a 2S LiPo, or the Balboa's six NiMH cells
  setParams({
    ...params,
    motor: {
      ...params.motor,
      ...motorParams(spec, { external: balboaGears.checked ? BALBOA_EXTERNAL : null, batteryNominal: nominal, batteryVoltage: nominal }),
      motorKey: motorSelect.value,
    },
  });
  refreshMotorUI();
  refreshAllSliderUI();
  markCustom();
}
motorSelect.addEventListener('change', rebuildMotor);
balboaGears.addEventListener('change', rebuildMotor);
motorModel.addEventListener('change', () => {
  setParams({ ...params, motor: { ...params.motor, model: motorModel.value } });
  refreshMotorUI();
  markCustom();
});

// --- realism toggles ------------------------------------------------------------
$('use-encoders').addEventListener('change', (e) => {
  realism = { ...realism, useEncoders: e.target.checked };
  controller.setRealism(realism);
  markCustom();
});

// --- presets ---------------------------------------------------------------------
const presetSelect = $('preset-select');
presetSelect.add(new Option('Custom', ''));
Object.keys(PRESETS).forEach((k) => presetSelect.add(new Option(PRESETS[k].label, k)));

function markCustom() {
  if (presetSelect.value) {
    presetSelect.value = '';
    $('preset-desc').textContent = 'Your own configuration.';
  }
  sourceText.textContent = 'ANALYTIC';
  sourcePill.classList.remove('source-freecad');
}

function applyPreset(key) {
  if (!PRESETS[key]) return;
  presetKey = key;
  built = buildPreset(key);
  geometry = built.geometry;
  material = built.material;
  gains = built.gains;
  realism = built.realism;
  setParams(built.params);
  controller.setGains(gains);
  controller.setRealism(realism);
  robot.rebuild(params);
  presetSelect.value = key;
  $('preset-desc').textContent = PRESETS[key].description;
  $('use-encoders').checked = realism.useEncoders !== false;
  sourceText.textContent = 'ANALYTIC';
  sourcePill.classList.remove('source-freecad');
  refreshMotorUI();
  refreshAllSliderUI();
  resetSimulation();
  if ($('auto-push').checked) pendingPush = { at: 1, kick: built.nudge };
}
presetSelect.addEventListener('change', () => { if (presetSelect.value) applyPreset(presetSelect.value); });

// --- FreeCAD params loading --------------------------------------------
const sourcePill = $('source-pill');
const sourceText = $('source-text');
async function loadCadParams(announce) {
  try {
    const res = await fetch('cad/robot_params.json', { cache: 'no-store' });
    if (!res.ok) throw new Error('not found');
    const json = await res.json();
    setParams(mergeParams(params, json));
    geometry = { ...geometry, ...params.geometry };
    presetSelect.value = '';
    $('preset-desc').textContent = 'Mass and inertia from the FreeCAD model (cad/parametric_robot.py).';
    sourcePill.classList.add('source-freecad');
    sourceText.textContent = 'FREECAD';
    robot.rebuild(params);
    refreshMotorUI();
    refreshAllSliderUI();
    return true;
  } catch (e) {
    if (announce) toast('No FreeCAD export found — run cad/parametric_robot.py first');
    return false;
  }
}
$('btn-load-cad').addEventListener('click', () => loadCadParams(true));
// The FreeCAD export only exists in a local checkout where the macro has been run, so only look for
// it automatically there (on the published site it would just be a 404 in the console).
if (/^(localhost|127\.0\.0\.1|)$/.test(location.hostname)) loadCadParams(false);

// --- drive input ---------------------------------------------------------
const drive = { fwd: false, back: false, left: false, right: false };
const DRIVE_YAW = 0.9;

function bindHold(id, k) {
  const el = $(id);
  const press = (v) => (e) => { e.preventDefault(); drive[k] = v; el.classList.toggle('held', v); };
  el.addEventListener('pointerdown', press(true));
  el.addEventListener('pointerup', press(false));
  el.addEventListener('pointerleave', press(false));
  el.addEventListener('pointercancel', press(false));
}
bindHold('pad-fwd', 'fwd');
bindHold('pad-back', 'back');
bindHold('pad-left', 'left');
bindHold('pad-right', 'right');

const KEYS = { ArrowUp: 'fwd', ArrowDown: 'back', ArrowLeft: 'left', ArrowRight: 'right' };
window.addEventListener('keydown', (e) => {
  if (e.target.closest && e.target.closest('input, select, textarea')) return;
  if (KEYS[e.key]) { drive[KEYS[e.key]] = true; e.preventDefault(); }
  if (e.key === ' ') { e.preventDefault(); push(); }
  if (e.key === 'r' || e.key === 'R') resetSimulation();
});
window.addEventListener('keyup', (e) => { if (KEYS[e.key]) drive[KEYS[e.key]] = false; });

let toastTimer = null;
function toast(text) {
  const el = $('toast');
  el.textContent = text;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 1600);
}

/** Kick the pitch rate (rad/s). Without an argument: a pseudo-random shove from the noise seed. */
function push(kick) {
  const s = loop.getState();
  const k = kick != null ? kick : (pushRand() < 0.5 ? -1 : 1) * (1.2 + pushRand() * 0.8);
  loop.setState({ ...s, thetaDot: s.thetaDot + k });
  toast(`Push: ${k > 0 ? '+' : ''}${k.toFixed(1)} rad/s`);
}
$('btn-push').addEventListener('click', () => push());

function resetSimulation() {
  loop.setState(restState());
  controller.reset();
  pushRand = seededRandom(realism.noiseSeed + 7919);
  fallen = false;
  simTime = 0;
  pendingPush = null;
  chartHistory.fill(0);
  speedHistory.fill(0);
  $('fallen-banner').classList.remove('show');
  $('status-pill').classList.remove('fallen');
  $('status-pill').classList.add('ok');
  $('status-text').textContent = 'BALANCED';
}
$('btn-reset').addEventListener('click', resetSimulation);
$('btn-reset-2').addEventListener('click', resetSimulation);

// --- strip charts (one quantity each, one axis) -----------------------------------
const chartHistory = new Array(CHART_SAMPLES).fill(0);
const speedHistory = new Array(CHART_SAMPLES).fill(0);
let chartWriteIndex = 0;

function drawChart(canvas, history, range, color, refs = []) {
  const ctx = canvas.getContext('2d'), w = canvas.width, h = canvas.height;
  ctx.clearRect(0, 0, w, h);
  ctx.strokeStyle = 'rgba(143,208,242,0.28)';
  ctx.lineWidth = 1;
  ctx.setLineDash([]);
  ctx.beginPath(); ctx.moveTo(0, h / 2); ctx.lineTo(w, h / 2); ctx.stroke();
  ctx.setLineDash([6, 5]);
  ctx.strokeStyle = 'rgba(255,207,74,0.75)';
  refs.forEach((r) => {
    const y = h / 2 - (r / range) * (h / 2);
    if (y < 0 || y > h) return;
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
  });
  ctx.setLineDash([]);
  ctx.strokeStyle = color;
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  for (let i = 0; i < CHART_SAMPLES; i++) {
    const sample = Math.max(-range, Math.min(range, history[(chartWriteIndex + i) % CHART_SAMPLES]));
    const x = (i / (CHART_SAMPLES - 1)) * w, y = h / 2 - (sample / range) * (h / 2);
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.stroke();
}
$('chart-range').textContent = '±' + CHART_RANGE_DEG + '°';

// --- HUD ---------------------------------------------------------------
function updateHud(state) {
  const c = loop.getLastCommand(), sensed = loop.getLastSensed();
  const thetaDeg = state.theta * (180 / Math.PI);
  $('hud-theta').textContent = thetaDeg.toFixed(1) + '°';
  $('hud-theta').classList.toggle('warn', Math.abs(thetaDeg) > 30);
  $('hud-thetadot').textContent = (state.thetaDot * 180 / Math.PI).toFixed(1) + ' °/s';
  $('hud-xdot').textContent = state.xDot.toFixed(2) + ' m/s';
  $('hud-enc').textContent = sensed ? sensed.xDot.toFixed(2) + ' m/s' : '—';
  $('hud-psidot').textContent = (state.psiDot * 180 / Math.PI).toFixed(1) + ' °/s';
  const R = params.geometry.wheelRadius;
  const slip = Math.max(Math.abs(R * state.omegaL - state.xDot), Math.abs(R * state.omegaR - state.xDot)) - Math.abs(state.psiDot) * params.geometry.trackWidth / 2;
  $('hud-slip').textContent = Math.max(0, slip).toFixed(2) + ' m/s';
  $('hud-slip').classList.toggle('warn', slip > 0.05);
  const dc = params.motor.model === 'dc';
  $('hud-u-label').textContent = dc ? 'Duty L / R' : 'τ cmd L / R';
  $('hud-u').textContent = dc
    ? `${Math.round(c.uL * 100)}% / ${Math.round(c.uR * 100)}%`
    : `${c.uL.toFixed(2)} / ${c.uR.toFixed(2)}`;
  $('hud-u').classList.toggle('warn', dc && Math.max(Math.abs(c.uL), Math.abs(c.uR)) > 0.98);
  const f = forcesAt(state, c.uL, c.uR, params);
  $('hud-tau').textContent = f.tauWL.toFixed(2) + ' / ' + f.tauWR.toFixed(2);
}

// --- main loop -------------------------------------------------------------
let lastFrameTime = performance.now();
const MAX_CATCHUP_SECONDS = 0.1;
let timeDebt = 0;

function tick(now) {
  requestAnimationFrame(tick);
  const dt = Math.min((now - lastFrameTime) / 1000, MAX_CATCHUP_SECONDS);
  lastFrameTime = now;

  const controlHz = realism.controlLoopHz;
  const controlDt = 1 / controlHz;
  // run whole control ticks for the real time that has passed (a slow loop runs less than once a frame)
  timeDebt = Math.min(timeDebt + dt, MAX_CATCHUP_SECONDS);
  const steps = Math.floor(timeDebt / controlDt + 1e-9);
  timeDebt -= steps * controlDt;
  for (let i = 0; i < steps; i++) {
    if (pendingPush && simTime >= pendingPush.at) { push(pendingPush.kick); pendingPush = null; }
    if (!fallen) {
      loop.setCommand(
        (drive.fwd ? driveSpeed : 0) - (drive.back ? driveSpeed : 0),
        (drive.left ? DRIVE_YAW : 0) - (drive.right ? DRIVE_YAW : 0)
      );
      loop.advance(controlHz);
    } else {
      loop.advanceOpenLoop(0, 0, controlDt); // firmware has cut the motors
    }
    simTime += controlDt;
    if (!fallen && Math.abs(loop.getState().theta) > FALL_ANGLE) {
      fallen = true;
      $('fallen-banner').classList.add('show');
      $('status-pill').classList.remove('ok');
      $('status-pill').classList.add('fallen');
      $('status-text').textContent = 'FALLEN';
    }
  }

  const state = loop.getState();
  robot.sync(state, params);
  updateCamera(state);
  updateHud(state);
  chartHistory[chartWriteIndex] = state.theta * (180 / Math.PI);
  speedHistory[chartWriteIndex] = state.xDot;
  chartWriteIndex = (chartWriteIndex + 1) % CHART_SAMPLES;
  drawChart($('chart'), chartHistory, CHART_RANGE_DEG, '#4fe0ff');
  const top = params.motor.model === 'dc' ? freeSpeedAt(params.motor, params.motor.batteryVoltage) * params.geometry.wheelRadius : null;
  const speedRange = Math.max(0.5, Math.ceil((top || 1) * 1.25 * 2) / 2);
  $('speed-range').textContent = '±' + speedRange.toFixed(1);
  drawChart($('chart-speed'), speedHistory, speedRange, '#3ddc97', top ? [top, -top] : []);
  renderer.render(scene, camera);
}

applyPreset('default');
resize();
requestAnimationFrame(tick);

// a small hook for automated checks (tests/smoke)
window.Plumb = {
  version: APP_VERSION,
  state: () => loop.getState(),
  params: () => params,
  applyPreset,
  push,
  fallen: () => fallen,
  simTime: () => simTime,
  robot,
};
