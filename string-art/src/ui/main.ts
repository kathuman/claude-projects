// The main page: load a picture, crop and adjust it, mark what matters, set the parameters, run the solver in a worker
// and watch the thread go on.

import "./style.css";
import { checkTarget, type BackgroundCheck } from "../core/checks";
import { circleMask, makeGeometry } from "../core/geometry";
import { isPainted, newMask, resizeMask, stroke, dab } from "../core/mask";
import { buildTarget, linearLuminance, NO_ADJUSTMENT, type Crop, type Prep, type Rgba } from "../core/preprocess";
import type { StopReason } from "../core/solver";
import type { DoneResult, FromWorker, ToWorker } from "../worker/protocol";
import { CropEditor, rgbaCanvas, ZOOM_MAX, ZOOM_MIN } from "./crop";
import { LANGS, T, apply, fx, int, lang, locale, mountSwitch } from "./i18n";
import { loadImageFile, loadSample } from "./image";
import { DEFAULT_UI, buildParams, type UiParams } from "./params";
import { ThreadPreview, drawTargetWithMask } from "./preview";
import { VERSION } from "./version";
import { instructionsHtml } from "../export/instructions";
import { sequenceCsv } from "../export/csv";
import { templatePages, templatePrintHtml, templateSvg, type Paper } from "../export/template";
import { loadProject, saveProject } from "../export/project";

apply();
mountSwitch();
const $ = <E extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as E;
$("ver").textContent = "v" + VERSION;

// ---------------------------------------------------------------- state
const state = {
  src: null as { lum: Float32Array; width: number; height: number } | null,
  prep: { crop: { cx: 0, cy: 0, size: 1, angle: 0 }, adj: { ...NO_ADJUSTMENT }, clahe: false, claheClip: 2.5 } as Prep,
  target: null as Float32Array | null,
  targetRes: 0,
  mask: null as Float32Array | null,   // importance W at targetRes; null until painted
  check: null as BackgroundCheck | null,
  brush: "off" as "off" | "up" | "down",
  jobId: 0,
  running: false,
  paused: false,
  maxLines: 0,
  runParams: null as UiParams | null,
  runPrep: null as Prep | null,
  expectSeq: null as Uint16Array | null,   // a loaded project's sequence, to confirm the re-run matches
  paper: "A4" as Paper,
  result: null as DoneResult | null
};

const preview = new ThreadPreview($<HTMLCanvasElement>("threadCanvas"));
const params = buildParams($("params"), DEFAULT_UI, (p) => { if (p.workingRes !== state.targetRes && state.src) scheduleTarget(); setButtons(); tplInfo(); });
const crop = new CropEditor($<HTMLCanvasElement>("cropCanvas"), (c) => { state.prep.crop = c; syncCropControls(c); scheduleTarget(); });

// ---------------------------------------------------------------- the picture
function setSource(img: Rgba, name: string): void {
  state.src = { lum: linearLuminance(img), width: img.width, height: img.height };
  state.expectSeq = null;
  $("projNote").hidden = true;
  $("srcName").textContent = name;
  $("inputHint").hidden = true;
  $("editPanel").hidden = false;
  state.mask = null;
  crop.setSource(rgbaCanvas(img.data, img.width, img.height));   // resets the crop and rebuilds the target
}

// rebuilding the target is a few tens of ms: do it at most once per frame while sliders move
let targetQueued = false;
function scheduleTarget(): void {
  if (targetQueued) return;
  targetQueued = true;
  requestAnimationFrame(() => { targetQueued = false; rebuildTarget(); });
}

function rebuildTarget(): void {
  const p = params.get();
  if (!state.src) return;
  const res = p.workingRes, { lum, width, height } = state.src;
  const mask = circleMask(makeGeometry(p.nails, res, p.marginPx));
  if (state.mask && state.targetRes && state.targetRes !== res) state.mask = resizeMask(state.mask, state.targetRes, res);
  state.target = buildTarget(lum, width, height, res, state.prep, mask);
  state.targetRes = res;
  state.check = checkTarget(state.target, res, mask);
  drawTargetWithMask($<HTMLCanvasElement>("targetSmall"), state.target, null, res);
  redrawTargetView();
  showChecks(state.check);
  setButtons();
}

function redrawTargetView(): void {
  if (state.target) drawTargetWithMask($<HTMLCanvasElement>("targetCanvas"), state.target, state.mask, state.targetRes);
}

function showChecks(c: BackgroundCheck): void {
  const out: string[] = [];
  if (c.lowContrast) out.push(`<p class="warnbox">${T("Low contrast (spread {s}). String art draws with the differences between areas: with little contrast every line darkens everything about equally and the result is a grey haze. Raise the contrast, try the local contrast boost, or choose a picture with stronger lights and darks.", { s: fx(c.std, 2) })}</p>`);
  if (c.busyBorder) out.push(`<p class="warnbox">${T("Busy border. Every line starts and ends at the rim, so detail or texture near the edge turns into clutter that crosses the whole picture. Zoom in on the subject or choose a plainer background.")}</p>`);
  if (!out.length) out.push(`<p class="okbox">${T("Good contrast and a quiet border: this picture should work well.")}</p>`);
  $("checks").innerHTML = out.join("");
}

$<HTMLInputElement>("file").addEventListener("change", async (ev) => {
  const f = (ev.target as HTMLInputElement).files?.[0];
  if (!f) return;
  try { setSource(await loadImageFile(f), f.name); }
  catch { status(T("That file could not be read. Use a JPG, PNG or WebP picture."), "bad"); }
});
$("btnSample").addEventListener("click", async () => {
  try { setSource(await loadSample(), T("Sample portrait")); }
  catch { status(T("The sample could not be loaded."), "bad"); }
});

// ---------------------------------------------------------------- crop controls
const zoomToSlider = (z: number) => Math.log(z / ZOOM_MIN) / Math.log(ZOOM_MAX / ZOOM_MIN);
const sliderToZoom = (v: number) => ZOOM_MIN * Math.pow(ZOOM_MAX / ZOOM_MIN, v);
function syncCropControls(c: Crop): void {
  const z = crop.zoom, deg = Math.round((c.angle * 180) / Math.PI);
  $<HTMLInputElement>("zoom").value = String(zoomToSlider(z));
  $("zoomOut").textContent = "× " + fx(z, 2);
  $<HTMLInputElement>("rotate").value = String(deg);
  $("rotateOut").textContent = T("{d}°", { d: deg });
}
$<HTMLInputElement>("zoom").addEventListener("input", (e) => crop.setZoom(sliderToZoom(Number((e.target as HTMLInputElement).value))));
$<HTMLInputElement>("rotate").addEventListener("input", (e) => crop.setAngle(Number((e.target as HTMLInputElement).value)));
$("btnCropReset").addEventListener("click", () => crop.reset());

// ---------------------------------------------------------------- adjustments
const ADJ = {
  brightness: (v: number) => (v > 0 ? "+" : "") + fx(v, 2),
  contrast: (v: number) => "× " + fx(v, 2),
  gamma: (v: number) => fx(v, 2)
};
const ADJ_IDS = ["brightness", "contrast", "gamma"] as const;
function syncAdj(): void {
  for (const id of ADJ_IDS) { $<HTMLInputElement>(id).value = String(state.prep.adj[id]); $(id + "Out").textContent = ADJ[id](state.prep.adj[id]); }
}
for (const id of ADJ_IDS) {
  $<HTMLInputElement>(id).addEventListener("input", (e) => { state.prep.adj[id] = Number((e.target as HTMLInputElement).value); syncAdj(); scheduleTarget(); });
}
syncAdj();
const claheBox = $<HTMLInputElement>("clahe"), clipInp = $<HTMLInputElement>("claheClip");
function syncClahe(): void {
  claheBox.checked = state.prep.clahe; $("claheCtl").hidden = !state.prep.clahe;
  clipInp.value = String(state.prep.claheClip); $("claheClipOut").textContent = fx(state.prep.claheClip, 1);
}
claheBox.addEventListener("change", () => { state.prep.clahe = claheBox.checked; syncClahe(); scheduleTarget(); });
clipInp.addEventListener("input", () => { state.prep.claheClip = Number(clipInp.value); syncClahe(); scheduleTarget(); });
syncClahe();
$("btnAdjReset").addEventListener("click", () => {
  state.prep.adj = { ...NO_ADJUSTMENT }; state.prep.clahe = false; state.prep.claheClip = 2.5;
  syncAdj(); syncClahe(); scheduleTarget();
});

// ---------------------------------------------------------------- the importance brush (painted on the Target view)
const brushInp = $<HTMLInputElement>("brushSize");
const brushRadius = () => (Number(brushInp.value) / 100) * state.targetRes;   // percent of the board diameter
const syncBrushSize = () => { $("brushSizeOut").textContent = T("{p} % of the board", { p: fx(Number(brushInp.value), 1) }); };
brushInp.addEventListener("input", syncBrushSize);
syncBrushSize();
function setBrush(mode: "off" | "up" | "down"): void {
  state.brush = mode;
  document.querySelectorAll("#segBrush button").forEach((b) => b.setAttribute("aria-pressed", String((b as HTMLElement).dataset.v === mode)));
  $("stage").classList.toggle("painting", mode !== "off");
  if (mode !== "off" && $("stage").dataset.view === "thread") setView("target");
}
document.querySelectorAll<HTMLButtonElement>("#segBrush button").forEach((b) => b.addEventListener("click", () => setBrush(b.dataset.v as "off" | "up" | "down")));
$("btnMaskClear").addEventListener("click", () => { state.mask = null; redrawTargetView(); });

const tcv = $<HTMLCanvasElement>("targetCanvas");
let last: { x: number; y: number } | null = null;
const toRes = (e: PointerEvent) => {
  const r = tcv.getBoundingClientRect();
  return { x: ((e.clientX - r.left) / r.width) * state.targetRes, y: ((e.clientY - r.top) / r.height) * state.targetRes };
};
let paintQueued = false;
const repaint = () => { if (paintQueued) return; paintQueued = true; requestAnimationFrame(() => { paintQueued = false; redrawTargetView(); }); };
tcv.addEventListener("pointerdown", (e) => {
  if (state.brush === "off" || !state.target || state.running) return;
  tcv.setPointerCapture(e.pointerId);
  if (!state.mask) state.mask = newMask(state.targetRes);
  last = toRes(e);
  dab(state.mask, state.targetRes, last.x, last.y, brushRadius(), state.brush === "up" ? 1 : -1);
  repaint();
});
tcv.addEventListener("pointermove", (e) => {
  if (!last || !state.mask) return;
  const p = toRes(e);
  stroke(state.mask, state.targetRes, last.x, last.y, p.x, p.y, brushRadius(), state.brush === "up" ? 1 : -1);
  last = p;
  repaint();
});
const endStroke = () => { last = null; };
tcv.addEventListener("pointerup", endStroke);
tcv.addEventListener("pointercancel", endStroke);

// ---------------------------------------------------------------- the solver worker
let worker: Worker | null = null;
function getWorker(): Worker {
  if (worker) return worker;
  worker = new Worker(new URL("../worker/solver.worker.ts", import.meta.url), { type: "module" });
  worker.onmessage = (ev: MessageEvent<FromWorker>) => onWorker(ev.data);
  worker.onerror = () => { finish(); status(T("The solver stopped with an error."), "bad"); };
  return worker;
}
const send = (m: ToWorker, transfer: Transferable[] = []) => getWorker().postMessage(m, transfer);

function run(): void {
  if (!state.target || state.running) return;
  const p: UiParams = params.get();
  if (p.workingRes !== state.targetRes) rebuildTarget();
  state.jobId++; state.running = true; state.paused = false; state.result = null; state.maxLines = p.maxLines; state.runParams = p;
  state.runPrep = JSON.parse(JSON.stringify(state.prep)) as Prep;
  $("downloads").hidden = true;
  setBrush("off");
  preview.reset(p.nails, state.targetRes, p.marginPx, p.boardMm, p.threadMm, p.darkness);
  $("log").textContent = "";
  $("metrics").innerHTML = "";
  setBar(0);
  status(T("Preparing the lines…"));
  const { workingRes: _res, ...solverParams } = p;
  void _res;
  const target = Float32Array.from(state.target!);
  const weights = state.mask && isPainted(state.mask) ? Float32Array.from(state.mask) : null;
  send({ type: "start", jobId: state.jobId, solver: "greedy", target, weights, res: state.targetRes, params: solverParams },
    weights ? [target.buffer, weights.buffer] : [target.buffer]);
  if ($("stage").dataset.view === "target") setView("thread");
  setButtons();
}

function onWorker(m: FromWorker): void {
  if (m.jobId !== state.jobId) return;   // a message from an earlier run
  switch (m.type) {
    case "log":
      $("log").textContent += m.message + "\n";
      break;
    case "progress":
      preview.addChords(m.progress.newChords);
      setBar(m.progress.step / state.maxLines);
      if (!state.paused) status(T("Line {n} of {k} · RMSE {e}", { n: int(m.progress.step), k: int(state.maxLines), e: fx(m.progress.rmse, 4) }));
      break;
    case "paused":
      status(T("Paused."));
      break;
    case "resumed":
      break;
    case "done":
      state.result = m.result;
      finish();
      setBar(1);
      status(stopText(m.result.stopReason, m.result.steps), m.result.stopReason === "cancelled" ? "warn" : "good");
      if (state.expectSeq) {
        const want = state.expectSeq, got = m.result.sequences[0].sequence;
        const same = got.length === want.length && got.every((v, i) => v === want[i]);
        status(same ? T("Project loaded: the solver reproduced the saved sequence exactly ({n} lines).", { n: int(m.result.steps) })
          : T("Project loaded, but this run differs from the saved sequence. It was probably saved with another version of the app."), same ? "good" : "warn");
        state.expectSeq = null;
      }
      showMetrics(m.result);
      $("downloads").hidden = m.result.steps === 0;
      break;
    case "error":
      finish();
      status(T("The solver stopped with an error: {e}", { e: m.message }), "bad");
      break;
  }
}

function stopText(r: StopReason, steps: number): string {
  const n = { n: int(steps) };
  switch (r) {
    case "maxLines": return T("Done: {n} lines, the most allowed.", n);
    case "converged": return T("Done: {n} lines. More lines would not improve the picture.", n);
    case "noCandidate": return T("Done: {n} lines. Every allowed line from the last nail has been used.", n);
    case "cancelled": return T("Stopped after {n} lines.", n);
  }
}

function finish(): void { state.running = false; state.paused = false; setButtons(); }

$("btnRun").addEventListener("click", run);
$("btnPause").addEventListener("click", () => {
  if (!state.running) return;
  state.paused = !state.paused;
  send({ type: state.paused ? "pause" : "resume", jobId: state.jobId });
  if (state.paused) status(T("Pausing…"));
  setButtons();
});
$("btnCancel").addEventListener("click", () => { if (state.running) send({ type: "cancel", jobId: state.jobId }); });

// ---------------------------------------------------------------- display
function setButtons(): void {
  $<HTMLButtonElement>("btnRun").disabled = state.running || !state.target;
  $<HTMLButtonElement>("btnPause").disabled = !state.running;
  $<HTMLButtonElement>("btnCancel").disabled = !state.running;
  $("btnPause").textContent = state.paused ? T("Resume") : T("Pause");
  params.disable(state.running);
  for (const id of ["projFile", "file", "btnSample", "zoom", "rotate", "btnCropReset", "brightness", "contrast", "gamma", "clahe", "claheClip", "btnAdjReset", "brushSize", "btnMaskClear"])
    ($(id) as HTMLInputElement).disabled = state.running;
  document.querySelectorAll<HTMLButtonElement>("#segBrush button").forEach((b) => { b.disabled = state.running; });
  $("cropCanvas").style.pointerEvents = state.running ? "none" : "";
}

function setBar(f: number): void { ($("bar").firstElementChild as HTMLElement).style.width = `${Math.round(Math.min(1, f) * 1000) / 10}%`; }

function status(text: string, kind: "" | "good" | "warn" | "bad" = ""): void {
  const el = $("status");
  el.textContent = text;
  el.className = "status " + kind;
}

function showMetrics(r: DoneResult): void {
  const m = r.metrics, rows: [string, string][] = [
    [T("Lines"), int(m.lines)],
    [T("RMSE (lower is better)"), fx(m.rmse, 4)],
    [T("SSIM, pixel by pixel"), fx(m.ssim, 3)],
    [T("SSIM, seen from a distance"), fx(m.ssimSeen, 3)],
    [T("Thread"), T("{m} m, plus {s} m for wrapping and slack", { m: fx(m.threadM, 0), s: fx(m.slackM, 0) })],
    [T("Time"), T("{s} s", { s: fx(m.ms / 1000, 1) })],
    [T("Line cache"), r.cacheMode === "flat" ? T("all lines precomputed, {mb} MB", { mb: fx(r.cacheBytes / 1e6, 0) }) : T("lines computed as needed")]
  ];
  $("metrics").innerHTML = rows.map(([k, v]) => `<tr><th scope="row">${k}</th><td>${v}</td></tr>`).join("");
}

// ---------------------------------------------------------------- downloads
function save(name: string, text: string, type: string): void {
  const url = URL.createObjectURL(new Blob([text], { type })), a = document.createElement("a");
  a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
/** a small picture of the result for the instructions: the full-resolution board scaled to 600 px, as JPEG */
function previewDataUrl(): string {
  const c = document.createElement("canvas");
  c.width = 600; c.height = 600;
  const g = c.getContext("2d")!;
  g.imageSmoothingQuality = "high";
  g.drawImage(preview.full, 0, 0, 600, 600);
  return c.toDataURL("image/jpeg", 0.85);
}
function instructionsDoc(): string | null {
  const r = state.result, p = state.runParams;
  if (!r || !p) return null;
  return instructionsHtml({
    sequence: r.sequences[0].sequence, nails: p.nails, boardMm: p.boardMm, threadMm: p.threadMm, minSkip: p.minSkip,
    threadM: r.metrics.threadM, slackM: r.metrics.slackM, version: VERSION, preview: previewDataUrl(),
    date: new Date().toLocaleDateString(locale, { year: "numeric", month: "long", day: "numeric" })
  });
}
const fileBase = () => `string-art-${state.runParams!.nails}-nails-${state.result!.steps}-lines`;
$("btnInstructions").addEventListener("click", () => { const doc = instructionsDoc(); if (doc) save(fileBase() + ".html", doc, "text/html"); });
$("btnPng").addEventListener("click", () => {
  preview.full.toBlob((b) => {
    if (!b) return;
    const url = URL.createObjectURL(b), a = document.createElement("a");
    a.href = url; a.download = fileBase() + ".png"; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }, "image/png");
});
function projectText(): string | null {
  const r = state.result, p = state.runParams;
  if (!r || !p || !state.target) return null;
  return saveProject({ params: p, prep: state.runPrep ?? state.prep, res: state.targetRes, target: state.target, mask: state.mask,
    sequence: r.sequences[0].sequence, version: VERSION, saved: new Date().toISOString() });
}
$("btnProject").addEventListener("click", () => { const t = projectText(); if (t) save(fileBase() + ".json", t, "application/json"); });
$<HTMLInputElement>("projFile").addEventListener("change", async (ev) => {
  const input = ev.target as HTMLInputElement, f = input.files?.[0];
  input.value = "";
  if (!f) return;
  try {
    const pr = loadProject(await f.text());
    state.src = null;
    params.set({ ...pr.file.params, workingRes: pr.file.res });
    state.prep = pr.file.prep;
    state.target = pr.target; state.targetRes = pr.file.res; state.mask = pr.mask;
    const mask = circleMask(makeGeometry(pr.file.params.nails, pr.file.res, pr.file.params.marginPx));
    state.check = checkTarget(pr.target, pr.file.res, mask);
    $("srcName").textContent = f.name;
    $("inputHint").hidden = true; $("editPanel").hidden = false; $("projNote").hidden = false;
    drawTargetWithMask($<HTMLCanvasElement>("targetSmall"), pr.target, null, pr.file.res);
    redrawTargetView(); showChecks(state.check);
    state.expectSeq = pr.sequence;
    run();
  } catch (e) {
    const code = e instanceof Error ? e.message : "";
    status(code === "bad-hash" ? T("That project file is damaged: its picture does not match its fingerprint.")
      : code === "newer-format" ? T("That project was saved by a newer version of the app.") : T("That is not a String Art project file."), "bad");
  }
});

// ---------------------------------------------------------------- the nail template
function tplLabels() {
  const p = params.get();
  return {
    title: T("String Art nail template · {n} nails · {d} mm board", { n: p.nails, d: p.boardMm }),
    calibration: T("100 mm × 100 mm: check with a ruler"),
    page: (r: number, c: number) => T("row {r}, column {c}", { r, c })
  };
}
function tplInfo(): void {
  const p = params.get(), n = templatePages({ nails: p.nails, boardMm: p.boardMm, labels: tplLabels() }, state.paper).length;
  $("tplInfo").textContent = T("{n} pages of {paper} for a {d} mm board.", { n, paper: state.paper, d: p.boardMm });
}
document.querySelectorAll<HTMLButtonElement>("#segPaper button").forEach((b) => b.addEventListener("click", () => {
  state.paper = b.dataset.v as Paper;
  document.querySelectorAll("#segPaper button").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
  tplInfo();
}));
$("btnTplPages").addEventListener("click", () => {
  const p = params.get(), d = { nails: p.nails, boardMm: p.boardMm, labels: tplLabels() };
  save(`string-art-template-${p.nails}-nails-${p.boardMm}mm-${state.paper}.html`,
    templatePrintHtml(templatePages(d, state.paper), state.paper, d.labels.title,
      T("Print these pages at actual size (100 %, no scaling), check the 100 mm square with a ruler, then trim and tape the pages together, matching the crosses in the shaded overlaps."), LANGS[lang].html),
    "text/html");
});
$("btnTplSvg").addEventListener("click", () => {
  const p = params.get();
  save(`string-art-template-${p.nails}-nails-${p.boardMm}mm.svg`, templateSvg({ nails: p.nails, boardMm: p.boardMm, labels: tplLabels() }), "image/svg+xml");
});

$("btnCsv").addEventListener("click", () => {
  const r = state.result, p = state.runParams;
  if (r && p) save(fileBase() + ".csv", sequenceCsv(r.sequences[0].sequence, p.nails, p.boardMm), "text/csv");
});

// the view: thread, target, or both side by side
function setView(v: string): void {
  $("stage").dataset.view = v;
  document.querySelectorAll<HTMLElement>("#segView button").forEach((x) => x.setAttribute("aria-pressed", String(x.dataset.v === v)));
}
document.querySelectorAll<HTMLButtonElement>("#segView button").forEach((b) => b.addEventListener("click", () => setView(b.dataset.v!)));

setButtons();
tplInfo();
// test hook for the browser checks
(window as unknown as { __sa: unknown }).__sa = { state, params, crop, run, setBrush, instructionsDoc, projectText, setSample: () => $("btnSample").click() };
