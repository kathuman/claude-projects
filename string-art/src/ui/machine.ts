// The winding-machine page: take the last result (or a project file, or a demo pattern), plan the machine's moves,
// check the machine against the piece, estimate the time, play the winding back and download the G-code.

import "./style.css";
import { DEFAULT_MACHINE, sanitize, type MachineConfig, type MachineKey } from "../machine/config";
import { machineChecks, worstLevel, type Check } from "../machine/checks";
import { toGcode } from "../machine/gcode";
import { planToolpath, type Plan } from "../machine/toolpath";
import { threadLengthMm } from "../core/metrics";
import { T, apply, fx, int, mountSwitch } from "./i18n";
import { loadLast } from "./store";
import { MachineSim } from "./machine-sim";
import { VERSION } from "./version";
import { mountWind } from "./wind";

apply();
mountSwitch();
const $ = <E extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as E;
$("ver").textContent = "v" + VERSION;

const KEY = "sa-machine-v1";
interface Piece { seq: Uint16Array; nails: number; boardMm: number; threadMm: number; name: string }

// ---------------------------------------------------------------- the settings form
interface Field { key: MachineKey; label: string; unit: string; step: number; tip: string }
interface Group { title: string; fields: Field[] }
// The English strings are written out in full in each T() call so the language test can find them.
function groups(): Group[] {
  return [
    { title: T("Board"), fields: [
      { key: "nailMm", label: T("Nail diameter"), unit: "mm", step: 0.1, tip: T("Thicker nails leave a narrower gap for the guide.") },
      { key: "nailHeightMm", label: T("Nail height above the board"), unit: "mm", step: 1, tip: T("The wraps stack up the nails; taller nails hold more.") }
    ] },
    { title: T("Thread guide"), fields: [
      { key: "guideMm", label: T("Guide tube diameter"), unit: "mm", step: 0.1, tip: T("The outside diameter of the tube tip that passes between the nails.") },
      { key: "insideMm", label: T("Waits inside the ring by"), unit: "mm", step: 0.5, tip: T("How far inside the nail circle the guide waits while the board turns.") },
      { key: "outsideMm", label: T("Goes outside the ring by"), unit: "mm", step: 0.5, tip: T("How far outside the nail circle the guide goes to wrap a nail.") },
      { key: "tensionN", label: T("Winding tension"), unit: "N", step: 0.05, tip: T("How hard the thread is pulled as it leaves the guide, set at the disc tensioner. About 0.25 N: the thread should just lift 25 g. The build page shows the working.") },
      { key: "zStartMm", label: T("First wrap height"), unit: "mm", step: 0.5, tip: T("The height of the first wrap on each nail, above the board.") },
      { key: "layerMm", label: T("Rise per wrap"), unit: "mm", step: 0.05, tip: T("Each later wrap on the same nail is laid this much higher. About the thread diameter.") }
    ] },
    { title: T("Motion"), fields: [
      { key: "xSpeed", label: T("Board turning speed"), unit: "°/s", step: 5, tip: T("Top turning speed of the turntable.") },
      { key: "xAccel", label: T("Board acceleration"), unit: "°/s²", step: 10, tip: T("A heavy board needs a gentle acceleration, or the motor skips steps.") },
      { key: "ySpeed", label: T("Guide speed"), unit: "mm/s", step: 5, tip: T("Top speed of the guide moving in and out.") },
      { key: "yAccel", label: T("Guide acceleration"), unit: "mm/s²", step: 50, tip: T("Acceleration of the guide moving in and out.") },
      { key: "zSpeed", label: T("Height speed"), unit: "mm/s", step: 1, tip: T("Top speed of the guide moving up and down.") },
      { key: "zAccel", label: T("Height acceleration"), unit: "mm/s²", step: 10, tip: T("Acceleration of the guide moving up and down.") },
      { key: "threadSpeed", label: T("Thread speed"), unit: "mm/s", step: 50, tip: T("The fastest the thread may be pulled off the spool. It limits how fast the board may turn.") }
    ] },
    { title: T("Controller"), fields: [
      { key: "xSteps", label: T("Steps per degree (turn)"), unit: "", step: 0.001, tip: T("Motor steps for one degree of board turn: 200 steps × microsteps × gear ratio ÷ 360.") },
      { key: "ySteps", label: T("Steps per mm (guide)"), unit: "", step: 1, tip: T("Motor steps for one millimetre of guide travel.") },
      { key: "zSteps", label: T("Steps per mm (height)"), unit: "", step: 1, tip: T("Motor steps for one millimetre of guide height.") },
      { key: "pauseEvery", label: T("Stop every"), unit: T("lines"), step: 50, tip: T("The machine stops after this many lines so you can check the thread. 0 never stops.") }
    ] }
  ];
}

function loadMachine(): MachineConfig {
  try { const v = localStorage.getItem(KEY); if (v) return sanitize(JSON.parse(v) as Partial<MachineConfig>); } catch { /* defaults */ }
  return { ...DEFAULT_MACHINE };
}
function saveMachine(c: MachineConfig): void { try { localStorage.setItem(KEY, JSON.stringify(c)); } catch { /* not remembered */ } }

let cfg = loadMachine();
const form = $("mcForm");
function buildForm(): void {
  let n = 0;
  form.innerHTML = groups().map((g) => `<h3 class="mgroup">${g.title}</h3>` + g.fields.map((f) => {
    const id = `mf-${f.key}`, tip = `mt-${n++}`;
    return `<div class="mfield">
      <label for="${id}">${f.label}</label>
      <button type="button" class="tipbtn" aria-label="${T("What does this do?")}" aria-expanded="false" aria-controls="${tip}" title="${f.tip}">?</button>
      <span class="minput"><input type="number" id="${id}" data-k="${f.key}" step="${f.step}" min="0" inputmode="decimal" /><span class="unit">${f.unit}</span></span>
      <p class="tip" id="${tip}" hidden>${f.tip}</p>
    </div>`;
  }).join("")).join("");
  form.querySelectorAll<HTMLInputElement>("input").forEach((inp) => inp.addEventListener("change", () => {
    const k = inp.dataset.k as MachineKey, v = Number(inp.value);
    cfg = sanitize({ ...cfg, [k]: v }, cfg);
    inp.value = String(cfg[k]);
    saveMachine(cfg);
    replan();
  }));
  form.querySelectorAll<HTMLButtonElement>(".tipbtn").forEach((b) => b.addEventListener("click", () => {
    const tip = document.getElementById(b.getAttribute("aria-controls")!)!, open = tip.hidden;
    tip.hidden = !open; b.setAttribute("aria-expanded", String(open));
  }));
  syncForm();
}
function syncForm(): void {
  form.querySelectorAll<HTMLInputElement>("input").forEach((inp) => { inp.value = String(cfg[inp.dataset.k as MachineKey]); });
}
buildForm();
$("mcReset").addEventListener("click", () => {
  cfg = { ...DEFAULT_MACHINE, nails: cfg.nails, boardMm: cfg.boardMm, threadMm: cfg.threadMm, layerMm: Math.max(0.1, cfg.threadMm * 1.2) };
  saveMachine(cfg); syncForm(); replan();
});

// ---------------------------------------------------------------- the piece
let piece: Piece | null = null;
let plan: Plan | null = null;

/** A demo: a star polygon that visits every nail, 101 nails apart (101 and 240 share no factor). */
function demoPiece(): Piece {
  const n = 240, L = 720, seq = new Uint16Array(L + 1);
  for (let k = 0; k <= L; k++) seq[k] = (k * 101 + Math.floor(k / 240) * 7) % n;
  return { seq, nails: n, boardMm: 600, threadMm: 0.25, name: T("Demo pattern: a star of 720 lines") };
}

function setPiece(p: Piece): void {
  piece = p;
  cfg = sanitize({ ...cfg, nails: p.nails, boardMm: p.boardMm, threadMm: p.threadMm }, cfg);
  $("mcSrc").textContent = T("{name} · {n} nails · {d} mm board · {t} mm thread · {l} lines",
    { name: p.name, n: p.nails, d: p.boardMm, t: fx(p.threadMm, 2), l: int(p.seq.length - 1) });
  replan();
  seek(0);
}

$<HTMLInputElement>("mcProj").addEventListener("change", async (ev) => {
  const input = ev.target as HTMLInputElement, f = input.files?.[0];
  input.value = "";
  if (!f) return;
  try {
    const j = JSON.parse(await f.text()) as { app?: string; params?: { nails?: number; boardMm?: number; threadMm?: number }; sequence?: number[] };
    const N = j.params?.nails;
    if (j.app !== "string-art" || !Array.isArray(j.sequence) || !N || !j.params?.boardMm || !j.params?.threadMm
      || j.sequence.some((n) => !Number.isInteger(n) || n < 0 || n >= N) || j.sequence.length < 2) throw new Error("bad");
    setPiece({ seq: Uint16Array.from(j.sequence), nails: N, boardMm: j.params.boardMm, threadMm: j.params.threadMm, name: f.name });
  } catch {
    status(T("That is not a String Art project file."), "bad");
  }
});
$("mcDemo").addEventListener("click", () => setPiece(demoPiece()));

// ---------------------------------------------------------------- planning, checks and the summary
function hms(s: number): string {
  const t = Math.round(s), h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), x = t % 60;
  return `${h}:${String(m).padStart(2, "0")}:${String(x).padStart(2, "0")}`;
}
function duration(s: number): string {
  const m = Math.round(s / 60), h = Math.floor(m / 60);
  return h ? T("{h} h {m} min", { h, m: m % 60 }) : T("{m} min", { m });
}

function checkText(c: Check): string {
  const v = c.v;
  switch (c.code) {
    case "gap": return T("The guide tube ({g} mm) passes between nails with a {gap} mm gap, leaving {s} mm on each side.", { g: fx(cfg.guideMm, 1), gap: fx(v.gap, 2), s: fx(v.side, 2) })
      + (c.level === "ok" ? "" : " " + T("That is too tight to pass reliably: use a thinner tube or thinner nails, fewer nails or a bigger board."));
    case "inside": return c.level === "ok" ? T("While the board turns, the guide waits {h} mm inside the nail circle, clear of the nails.", { h: fx(v.have, 1) })
      : T("The guide waits only {h} mm inside the nail circle and would hit the nails as the board turns: it needs at least {n} mm.", { h: fx(v.have, 1), n: fx(v.need, 1) });
    case "outside": return c.level === "ok" ? T("To wrap a nail the guide goes {h} mm outside the nail circle, clear of the nails.", { h: fx(v.have, 1) })
      : T("The guide goes only {h} mm outside the nail circle and would hit the nail it wraps: it needs at least {n} mm.", { h: fx(v.have, 1), n: fx(v.need, 1) });
    case "height":
      if (c.level === "error") return T("The first wrap height is not below the top limit, 2 mm under the nail tops ({t} mm). Lower it or use taller nails.", { t: fx(v.top, 1) });
      return T("The busiest nail gets {w} wraps; the highest is laid {z} mm above the board, below the {t} mm limit.", { w: v.maxWraps, z: fx(v.maxZ, 1), t: fx(v.top, 1) })
        + (c.level === "warn" ? " " + T("{c} wraps would go higher and are laid at the limit, pressed onto earlier ones. Use taller nails or a smaller rise per wrap.", { c: int(v.capped) }) : "");
    case "tight": return v.tight === 0
      ? T("No line rubs a neighbouring nail: the closest passes {w} mm clear.", { w: fx(v.worst, 2) })
      : T("{n} of {l} lines leave a nail at a shallow angle and rub the next nail, which pulls them slightly out of line (by up to {w} mm). Lines that skip at least {s} nails are clear; this piece's smallest skip is {m}. To avoid it, set the minimum nail skip in the app to {s}.",
        { n: int(v.tight), l: int(v.lines), w: fx(-v.worst, 2), s: v.safeSkip, m: v.minSkip });
    case "tension": {
      const parts = [T("Winding at {t} N: the longest line needs at least {m} N to lie straight, and the busiest nail ({n} wraps) bends above about {l} N. The thread breaks at about {b} N; the highest tension while winding is about {p} N.",
        { t: fx(v.t, 2), m: fx(v.minT, 2), n: int(v.n), l: fx(v.limit, 2), b: fx(v.breaking, 1), p: fx(v.peak, 2) })];
      if (v.bends) parts.push(T("Lower the tension, or use 2 mm nails."));
      if (v.sags) parts.push(T("Raise the tension a little."));
      if (v.weak) parts.push(T("The thread is too thin to be safe: it should hold at least {r} N. Use 0.15 mm polyester or thicker.", { r: fx(v.required, 1) }));
      return parts.join(" ");
    }
    case "speed": return v.capped
      ? T("The board turns at {v} °/s at most: any faster and the rim would pull thread off the spool faster than {t} mm/s.", { v: fx(v.limit, 0), t: int(cfg.threadSpeed) })
      : T("The board turns at up to {v} °/s.", { v: fx(v.limit, 0) });
  }
}

let checks: Check[] = [];
function replan(): void {
  if (!piece) return;
  plan = planToolpath(piece.seq, cfg);
  checks = machineChecks(piece.seq, cfg, plan);
  $("mcChecks").innerHTML = checks.map((c) => `<p class="${c.level === "ok" ? "okbox" : c.level === "warn" ? "warnbox" : "badbox"}">${checkText(c)}</p>`).join("");
  const L = plan.lines, threadM = threadLengthMm(piece.seq, piece.nails, piece.boardMm) / 1000;
  const rows: [string, string][] = [
    [T("Lines"), int(L)],
    [T("Winding time (estimate, without stops)"), duration(plan.totalS)],
    [T("Per line, on average"), T("{s} s", { s: fx(plan.totalS / Math.max(1, L), 1) })],
    [T("Machine moves"), int(plan.axis.length)],
    [T("The board turns in all"), T("{n} turns", { n: fx(plan.turnDeg / 360, 0) })],
    [T("Wraps on the busiest nail"), int(plan.maxWraps)],
    [T("Thread"), T("{m} m between nails, plus about {w} m round the nails", { m: fx(threadM, 0), w: fx((L * Math.PI * (cfg.nailMm + cfg.threadMm)) / 2 / 1000, 0) })]
  ];
  $("mcSummary").innerHTML = rows.map(([k, v]) => `<tr><th scope="row">${k}</th><td>${v}</td></tr>`).join("");
  const scrub = $<HTMLInputElement>("mcScrub");
  scrub.max = String(L);
  $<HTMLButtonElement>("mcGcode").disabled = worstLevel(checks) === "error";
  sim.load(piece.seq, cfg, plan);
  t = Math.min(t, plan.totalS);
  frame();
}

// ---------------------------------------------------------------- playback
const sim = new MachineSim($<HTMLCanvasElement>("mcCanvas"), $<HTMLCanvasElement>("mcZoom"));
let t = 0, playing = false, speed = 10, lastNow = 0;
function seek(time: number): void { t = Math.max(0, Math.min(plan ? plan.totalS : 0, time)); frame(); }

const KIND: Record<string, () => string> = {
  setup: () => T("setting up"), travel: () => T("turning to the nail"), lift: () => T("setting the height"),
  out: () => T("guide out"), wrap: () => T("wrapping"), in: () => T("guide in"), finish: () => T("finished")
};

function frame(): void {
  if (!plan || !piece) return;
  const st = sim.draw(t);
  const [X, Y, Z] = st.pos, L = plan.lines;
  $("mcHud").innerHTML =
    `<div><b>${T("Line {k} of {l}", { k: int(Math.min(L, st.done + (st.kind === "finish" ? 0 : 1))), l: int(L) })}</b> · ${KIND[st.kind]()}</div>` +
    `<div>${st.kind !== "setup" && st.kind !== "finish" ? T("nail {a} → {b}", { a: piece.seq[st.line - 1] ?? 0, b: piece.seq[st.line] ?? 0 }) : ""}</div>` +
    `<div class="mono">X ${fx(X, 2)}° · Y ${fx(Y, 1)} · Z ${fx(Z, 1)} mm</div>` +
    `<div class="mono">${hms(t)} / ${hms(plan.totalS)}</div>`;
  if (document.activeElement !== $("mcScrub")) $<HTMLInputElement>("mcScrub").value = String(st.done);
}

function tick(now: number): void {
  if (!playing || !plan) return;
  const dt = Math.min(0.1, (now - lastNow) / 1000);
  lastNow = now;
  t += dt * speed;
  if (t >= plan.totalS) { t = plan.totalS; setPlaying(false); }
  frame();
  if (playing) requestAnimationFrame(tick);
}
function setPlaying(on: boolean): void {
  playing = on && !!plan;
  $("mcPlay").textContent = playing ? T("Pause") : T("Play");
  if (playing) {
    if (plan && t >= plan.totalS) t = 0;
    lastNow = performance.now();
    requestAnimationFrame(tick);
  }
}
$("mcPlay").addEventListener("click", () => setPlaying(!playing));
$("mcRestart").addEventListener("click", () => seek(0));
document.querySelectorAll<HTMLButtonElement>("#mcSpeed button").forEach((b) => b.addEventListener("click", () => {
  speed = Number(b.dataset.v);
  document.querySelectorAll("#mcSpeed button").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
}));
$<HTMLInputElement>("mcUpright").addEventListener("change", (e) => { sim.upright = (e.target as HTMLInputElement).checked; frame(); });
$<HTMLInputElement>("mcScrub").addEventListener("input", (e) => {
  const k = Number((e.target as HTMLInputElement).value);
  seek(sim.timeOfLine(k));
});
new ResizeObserver(() => frame()).observe($("mcCanvas"));

// ---------------------------------------------------------------- the G-code
function status(text: string, kind: "" | "good" | "warn" | "bad" = ""): void {
  const el = $("mcStatus"); el.textContent = text; el.className = "status " + kind;
}
$("mcGcode").addEventListener("click", () => {
  if (!piece || !plan) return;
  const g = toGcode(piece.seq, plan, cfg, { version: VERSION, date: new Date().toISOString().slice(0, 10) });
  const url = URL.createObjectURL(new Blob([g], { type: "text/plain" })), a = document.createElement("a");
  a.href = url; a.download = `string-art-${piece.nails}-nails-${plan.lines}-lines.gcode`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
});

// ---------------------------------------------------------------- start with the last result, else the demo
(function start() {
  const last = loadLast();
  if (last) {
    setPiece({ seq: Uint16Array.from(last.sequence), nails: last.params.nails, boardMm: last.params.boardMm, threadMm: last.params.threadMm,
      name: last.sourceName ? T("Your last result ({src})", { src: last.sourceName }) : T("Your last result") });
  } else {
    setPiece(demoPiece());
    status(T("No result from the app in this browser yet, so here is a demo pattern. Make a piece in the app, or open a project file."));
  }
})();
// ---------------------------------------------------------------- driving the machine over USB
mountWind({
  piece: () => piece,
  plan: () => plan,
  cfg: () => cfg,
  follow: (time) => { if (playing) setPlaying(false); seek(time); },
  canWind: () => !!piece && !!plan && worstLevel(checks) !== "error"
});

// test hook for the browser checks
(window as unknown as { __mc: unknown }).__mc = { get plan() { return plan; }, get cfg() { return cfg; }, seek, setPlaying, checks: () => checks };
