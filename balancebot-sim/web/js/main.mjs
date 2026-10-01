import { restState } from './dynamics.mjs';
import { defaultParams, deriveFromGeometry, mergeParams, DEFAULT_GEOMETRY, DEFAULT_MATERIAL } from './params.mjs';
import { createController, defaultGains, defaultRealism } from './controller.mjs';
import { createSimLoop } from './simloop.mjs';
import { buildScene, buildGround } from './scene.mjs';
import { PRESETS } from './presets.mjs';

const THREE = window.THREE;
const FALL_ANGLE = 1.2; // rad (~69 deg) -- past this, control gives up
const FREEZE_ANGLE = 1.48; // rad (~85 deg) -- past this, physics stops too
const CHART_RANGE_DEG = 45;
const CHART_SAMPLES = 320;

// --- live configuration state -------------------------------------------
let geometry = { ...DEFAULT_GEOMETRY };
let material = { ...DEFAULT_MATERIAL };
let params = defaultParams();
let gains = defaultGains();
let realism = defaultRealism();

const controller = createController(gains, realism);
const loop = createSimLoop(params, controller, 2000);
let fallen = false;
let frozen = false;

function recomputeFromGeometry(motorOverride, environmentOverride) {
  const derived = deriveFromGeometry(geometry, material);
  params = mergeParams(derived, {
    motor: motorOverride || params.motor,
    environment: environmentOverride || params.environment,
  });
}

// --- three.js scene -------------------------------------------------------
const stageEl = document.getElementById('stage');
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
if (renderer.outputEncoding !== undefined) renderer.outputEncoding = THREE.sRGBEncoding;
stageEl.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0b0f1a);
scene.fog = new THREE.Fog(0x0b0f1a, 2.5, 9);

const camera = new THREE.PerspectiveCamera(42, 1, 0.01, 50);

const hemi = new THREE.HemisphereLight(0x8fb7ff, 0x0b0f1a, 0.6);
scene.add(hemi);
const key = new THREE.DirectionalLight(0xfff2e0, 1.1);
key.position.set(1.2, 1.8, 1);
key.castShadow = true;
key.shadow.mapSize.set(1024, 1024);
key.shadow.camera.left = -1;
key.shadow.camera.right = 1;
key.shadow.camera.top = 1;
key.shadow.camera.bottom = -1;
key.shadow.camera.near = 0.2;
key.shadow.camera.far = 4;
key.shadow.bias = -0.0015;
scene.add(key);
const rim = new THREE.DirectionalLight(0x18e0c8, 0.3);
rim.position.set(-1.2, 0.8, -1);
scene.add(rim);

buildGround(THREE, scene);
let robot = buildScene(THREE, scene, params);

// --- chase-orbit camera -----------------------------------------------
const spherical = { theta: 1.3, phi: 1.0, radius: 0.95 };
const cameraTarget = new THREE.Vector3(0, 0.15, 0);

function cameraHeight() {
  return params.geometry.wheelRadius + params.geometry.bodyHeight * 0.5;
}

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

// --- UI: configuration / controller / realism sliders --------------------
const sliderSpecs = [
  { id: 'wheelRadius', get: () => geometry.wheelRadius, set: (v) => { geometry.wheelRadius = v; recomputeFromGeometry(); robot.rebuild(params); }, unit: 'm', decimals: 3 },
  { id: 'trackWidth', get: () => geometry.trackWidth, set: (v) => { geometry.trackWidth = v; recomputeFromGeometry(); robot.rebuild(params); }, unit: 'm', decimals: 3 },
  { id: 'bodyHeight', get: () => geometry.bodyHeight, set: (v) => { geometry.bodyHeight = v; recomputeFromGeometry(); robot.rebuild(params); }, unit: 'm', decimals: 3 },
  { id: 'comHeight', get: () => geometry.comHeight, set: (v) => { geometry.comHeight = v; recomputeFromGeometry(); robot.rebuild(params); }, unit: 'm', decimals: 3 },
  { id: 'bodyDensity', get: () => material.bodyDensity, set: (v) => { material.bodyDensity = v; recomputeFromGeometry(); robot.rebuild(params); }, unit: 'kg/m³', decimals: 0 },
  { id: 'maxTorque', get: () => params.motor.maxTorque, set: (v) => { params.motor.maxTorque = v; }, unit: 'N·m', decimals: 2 },
  { id: 'timeConstant', get: () => params.motor.timeConstant, set: (v) => { params.motor.timeConstant = v; }, unit: 's', decimals: 3 },
  { id: 'gravity', get: () => params.environment.gravity, set: (v) => { params.environment.gravity = v; }, unit: 'm/s²', decimals: 1 },

  { id: 'angleKp', get: () => gains.angleKp, set: (v) => { gains = { ...gains, angleKp: v }; controller.setGains(gains); }, decimals: 1 },
  { id: 'angleKd', get: () => gains.angleKd, set: (v) => { gains = { ...gains, angleKd: v }; controller.setGains(gains); }, decimals: 2 },
  { id: 'angleKi', get: () => gains.angleKi, set: (v) => { gains = { ...gains, angleKi: v }; controller.setGains(gains); }, decimals: 1 },
  { id: 'velocityKp', get: () => gains.velocityKp, set: (v) => { gains = { ...gains, velocityKp: v }; controller.setGains(gains); }, decimals: 2 },
  { id: 'velocityKi', get: () => gains.velocityKi, set: (v) => { gains = { ...gains, velocityKi: v }; controller.setGains(gains); }, decimals: 2 },
  { id: 'yawKp', get: () => gains.yawKp, set: (v) => { gains = { ...gains, yawKp: v }; controller.setGains(gains); }, decimals: 3 },

  { id: 'controlLoopHz', get: () => realism.controlLoopHz, set: (v) => { realism = { ...realism, controlLoopHz: v }; controller.setRealism(realism); }, unit: 'Hz', decimals: 0 },
  { id: 'sensorDelaySteps', get: () => realism.sensorDelaySteps, set: (v) => { realism = { ...realism, sensorDelaySteps: v }; controller.setRealism(realism); }, decimals: 0 },
  { id: 'sensorNoiseStdTheta', get: () => realism.sensorNoiseStdTheta, set: (v) => { realism = { ...realism, sensorNoiseStdTheta: v }; controller.setRealism(realism); }, unit: 'rad', decimals: 4 },
  { id: 'sensorNoiseStdRate', get: () => realism.sensorNoiseStdRate, set: (v) => { realism = { ...realism, sensorNoiseStdRate: v }; controller.setRealism(realism); }, unit: 'rad/s', decimals: 3 },
];

const sourcePill = document.getElementById('source-pill');
const sourceText = document.getElementById('source-text');

function markAnalytic() {
  sourcePill.classList.remove('source-freecad');
  sourceText.textContent = 'ANALYTIC';
}

function refreshSliderUI(spec) {
  const input = document.getElementById(spec.id);
  const label = document.getElementById('v-' + spec.id);
  const value = spec.get();
  input.value = value;
  if (label) label.textContent = value.toFixed(spec.decimals) + (spec.unit ? ' ' + spec.unit : '');
}

function refreshAllSliderUI() {
  sliderSpecs.forEach(refreshSliderUI);
}

sliderSpecs.forEach((spec) => {
  const input = document.getElementById(spec.id);
  input.addEventListener('input', () => {
    spec.set(parseFloat(input.value));
    refreshSliderUI(spec);
    if (['wheelRadius', 'trackWidth', 'bodyHeight', 'comHeight', 'bodyDensity'].includes(spec.id)) {
      markAnalytic();
    }
  });
});
refreshAllSliderUI();

// --- presets ---------------------------------------------------------------
const presetSelect = document.getElementById('preset-select');
function applyPreset(key) {
  const preset = PRESETS[key];
  if (!preset) return;
  geometry = { ...DEFAULT_GEOMETRY, ...(preset.geometry || {}) };
  material = { ...DEFAULT_MATERIAL, ...(preset.material || {}) };
  recomputeFromGeometry(preset.motor, preset.environment);
  gains = { ...defaultGains(), ...(preset.gains || {}) };
  realism = { ...defaultRealism(), ...(preset.realism || {}) };
  controller.setGains(gains);
  controller.setRealism(realism);
  controller.reset();
  robot.rebuild(params);
  markAnalytic();
  refreshAllSliderUI();
  resetSimulation();
}
presetSelect.addEventListener('change', () => {
  if (presetSelect.value) applyPreset(presetSelect.value);
});

// --- FreeCAD params loading --------------------------------------------
async function loadCadParams(announce) {
  try {
    const res = await fetch('cad/robot_params.json', { cache: 'no-store' });
    if (!res.ok) throw new Error('not found');
    const json = await res.json();
    params = mergeParams(defaultParams(), json);
    geometry = { ...geometry, ...params.geometry };
    sourcePill.classList.add('source-freecad');
    sourceText.textContent = 'FREECAD';
    robot.rebuild(params);
    refreshAllSliderUI();
    return true;
  } catch (e) {
    if (announce) {
      const prev = sourceText.textContent;
      sourceText.textContent = 'NO CAD FILE';
      setTimeout(() => { sourceText.textContent = prev; }, 1800);
    }
    return false;
  }
}
document.getElementById('btn-load-cad').addEventListener('click', () => loadCadParams(true));
loadCadParams(false);

// --- drive input ---------------------------------------------------------
const drive = { fwd: false, back: false, left: false, right: false };
const DRIVE_SPEED = 0.35;
const DRIVE_YAW = 0.9;

function bindHold(id, key) {
  const el = document.getElementById(id);
  const press = (v) => (e) => { e.preventDefault(); drive[key] = v; el.classList.toggle('held', v); };
  el.addEventListener('pointerdown', press(true));
  el.addEventListener('pointerup', press(false));
  el.addEventListener('pointerleave', press(false));
  el.addEventListener('pointercancel', press(false));
}
bindHold('pad-fwd', 'fwd');
bindHold('pad-back', 'back');
bindHold('pad-left', 'left');
bindHold('pad-right', 'right');

window.addEventListener('keydown', (e) => {
  if (e.key === 'ArrowUp') drive.fwd = true;
  if (e.key === 'ArrowDown') drive.back = true;
  if (e.key === 'ArrowLeft') drive.left = true;
  if (e.key === 'ArrowRight') drive.right = true;
  if (e.key === ' ') { e.preventDefault(); push(); }
  if (e.key === 'r' || e.key === 'R') resetSimulation();
});
window.addEventListener('keyup', (e) => {
  if (e.key === 'ArrowUp') drive.fwd = false;
  if (e.key === 'ArrowDown') drive.back = false;
  if (e.key === 'ArrowLeft') drive.left = false;
  if (e.key === 'ArrowRight') drive.right = false;
});

function push() {
  const s = loop.getState();
  const impulse = (Math.random() < 0.5 ? -1 : 1) * (1.2 + Math.random() * 0.8);
  loop.setState({ ...s, thetaDot: s.thetaDot + impulse });
}
document.getElementById('btn-push').addEventListener('click', push);

function resetSimulation() {
  loop.setState(restState());
  controller.reset();
  fallen = false;
  frozen = false;
  document.getElementById('fallen-banner').classList.remove('show');
  document.getElementById('status-pill').classList.remove('fallen');
  document.getElementById('status-pill').classList.add('ok');
  document.getElementById('status-text').textContent = 'BALANCED';
}
document.getElementById('btn-reset').addEventListener('click', resetSimulation);
document.getElementById('btn-reset-2').addEventListener('click', resetSimulation);

// --- strip chart -----------------------------------------------------------
const chartCanvas = document.getElementById('chart');
const chartCtx = chartCanvas.getContext('2d');
const chartHistory = new Array(CHART_SAMPLES).fill(0);
let chartWriteIndex = 0;

function pushChartSample(thetaDeg) {
  chartHistory[chartWriteIndex] = thetaDeg;
  chartWriteIndex = (chartWriteIndex + 1) % CHART_SAMPLES;
}

function drawChart() {
  const w = chartCanvas.width, h = chartCanvas.height;
  chartCtx.clearRect(0, 0, w, h);
  chartCtx.strokeStyle = 'rgba(135,147,171,0.25)';
  chartCtx.lineWidth = 1;
  chartCtx.beginPath();
  chartCtx.moveTo(0, h / 2);
  chartCtx.lineTo(w, h / 2);
  chartCtx.stroke();

  chartCtx.strokeStyle = '#18e0c8';
  chartCtx.lineWidth = 2;
  chartCtx.beginPath();
  for (let i = 0; i < CHART_SAMPLES; i++) {
    const sample = chartHistory[(chartWriteIndex + i) % CHART_SAMPLES];
    const x = (i / (CHART_SAMPLES - 1)) * w;
    const y = h / 2 - (sample / CHART_RANGE_DEG) * (h / 2);
    if (i === 0) chartCtx.moveTo(x, y); else chartCtx.lineTo(x, y);
  }
  chartCtx.stroke();
}
document.getElementById('chart-range').textContent = '±' + CHART_RANGE_DEG + '°';

// --- HUD ---------------------------------------------------------------
const hud = {
  theta: document.getElementById('hud-theta'),
  thetadot: document.getElementById('hud-thetadot'),
  xdot: document.getElementById('hud-xdot'),
  psidot: document.getElementById('hud-psidot'),
  tau: document.getElementById('hud-tau'),
};

function updateHud(state, lastCommand) {
  const thetaDeg = state.theta * (180 / Math.PI);
  hud.theta.textContent = thetaDeg.toFixed(1) + '°';
  hud.theta.classList.toggle('warn', Math.abs(thetaDeg) > 30);
  hud.thetadot.textContent = (state.thetaDot * 180 / Math.PI).toFixed(1) + ' °/s';
  hud.xdot.textContent = state.xDot.toFixed(2) + ' m/s';
  hud.psidot.textContent = (state.psiDot * 180 / Math.PI).toFixed(1) + ' °/s';
  hud.tau.textContent = lastCommand.tauL.toFixed(2) + ' / ' + lastCommand.tauR.toFixed(2);
}

// --- main loop -------------------------------------------------------------
let lastFrameTime = performance.now();
const MAX_CATCHUP_SECONDS = 0.1;

function tick(now) {
  requestAnimationFrame(tick);
  let dt = Math.min((now - lastFrameTime) / 1000, MAX_CATCHUP_SECONDS);
  lastFrameTime = now;

  if (!frozen) {
    const controlHz = realism.controlLoopHz;
    const controlDt = 1 / controlHz;
    let steps = Math.min(Math.round(dt / controlDt), 60);
    for (let i = 0; i < steps; i++) {
      if (!fallen) {
        loop.setCommand(
          (drive.fwd ? DRIVE_SPEED : 0) - (drive.back ? DRIVE_SPEED : 0),
          (drive.left ? DRIVE_YAW : 0) - (drive.right ? DRIVE_YAW : 0)
        );
        loop.advance(controlHz);
      } else {
        loop.advanceOpenLoop(0, 0, controlDt);
      }

      const theta = Math.abs(loop.getState().theta);
      if (!fallen && theta > FALL_ANGLE) {
        fallen = true;
        document.getElementById('fallen-banner').classList.add('show');
        document.getElementById('status-pill').classList.remove('ok');
        document.getElementById('status-pill').classList.add('fallen');
        document.getElementById('status-text').textContent = 'FALLEN';
      }
      if (fallen && theta > FREEZE_ANGLE) {
        frozen = true;
        break;
      }
    }
  }

  const state = loop.getState();
  robot.sync(state, params);
  updateCamera(state);
  updateHud(state, loop.getLastCommand());
  pushChartSample(state.theta * (180 / Math.PI));
  drawChart();
  renderer.render(scene, camera);
}

resize();
requestAnimationFrame(tick);
