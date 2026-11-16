// The main page: load a picture, set the parameters, run the solver in a worker and watch the thread go on.

import "./style.css";
import { circleMask, makeGeometry } from "../core/geometry";
import { NO_ADJUSTMENT, adjust, linearLuminance, resampleSquare, toTarget, type Rgba } from "../core/preprocess";
import type { StopReason } from "../core/solver";
import type { DoneResult, FromWorker, ToWorker } from "../worker/protocol";
import { T, apply, fx, int, mountSwitch } from "./i18n";
import { drawSample, loadImageFile } from "./image";
import { DEFAULT_UI, buildParams, type UiParams } from "./params";
import { ThreadPreview, drawDarkness } from "./preview";
import { VERSION } from "./version";

apply();
mountSwitch();
const $ = <E extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as E;
$("ver").textContent = "v" + VERSION;

// ---------------------------------------------------------------- state
const state = {
  src: null as { lum: Float32Array; width: number; height: number } | null,
  target: null as Float32Array | null,
  targetRes: 0,
  jobId: 0,
  running: false,
  paused: false,
  maxLines: 0,
  result: null as DoneResult | null
};

const preview = new ThreadPreview($<HTMLCanvasElement>("threadCanvas"));
const params = buildParams($("params"), DEFAULT_UI, (p) => { if (p.workingRes !== state.targetRes) rebuildTarget(); updateRunButton(p); });

// ---------------------------------------------------------------- the picture
function setSource(img: Rgba, name: string): void {
  state.src = { lum: linearLuminance(img), width: img.width, height: img.height };
  $("srcName").textContent = name;
  rebuildTarget();
}

function rebuildTarget(): void {
  const p = params.get();
  if (!state.src) return;
  const res = p.workingRes, { lum, width, height } = state.src;
  const Y = adjust(resampleSquare(lum, width, height, res), NO_ADJUSTMENT);
  state.target = toTarget(Y, circleMask(makeGeometry(p.nails, res, p.marginPx)));
  state.targetRes = res;
  drawDarkness($<HTMLCanvasElement>("targetSmall"), state.target, res);
  drawDarkness($<HTMLCanvasElement>("targetCanvas"), state.target, res);
  $("inputHint").hidden = true;
  updateRunButton(p);
}

$<HTMLInputElement>("file").addEventListener("change", async (ev) => {
  const f = (ev.target as HTMLInputElement).files?.[0];
  if (!f) return;
  try { setSource(await loadImageFile(f), f.name); }
  catch { status(T("That file could not be read. Use a JPG, PNG or WebP picture."), "bad"); }
});
$("btnSample").addEventListener("click", () => setSource(drawSample(), T("Drawn face (sample)")));

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
  state.jobId++; state.running = true; state.paused = false; state.result = null; state.maxLines = p.maxLines;
  preview.reset(p.nails, state.targetRes, p.marginPx, p.boardMm, p.threadMm, p.darkness);
  $("log").textContent = "";
  $("metrics").innerHTML = "";
  setBar(0);
  status(T("Preparing the lines…"));
  const { workingRes: _res, ...solverParams } = p;
  void _res;
  const target = Float32Array.from(state.target);
  send({ type: "start", jobId: state.jobId, solver: "greedy", target, weights: null, res: state.targetRes, params: solverParams }, [target.buffer]);
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
      showMetrics(m.result);
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
  $<HTMLInputElement>("file").disabled = state.running;
  $<HTMLButtonElement>("btnSample").disabled = state.running;
}
function updateRunButton(_p: UiParams): void { setButtons(); }

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

// the view: thread, target, or both side by side
document.querySelectorAll<HTMLButtonElement>("#segView button").forEach((b) => b.addEventListener("click", () => {
  $("stage").dataset.view = b.dataset.v!;
  document.querySelectorAll("#segView button").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
}));

setButtons();
// test hook for the browser checks
(window as unknown as { __sa: unknown }).__sa = { state, params, run, setSample: () => $("btnSample").click() };
