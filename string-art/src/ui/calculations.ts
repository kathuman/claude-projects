// The calculations page: the thread-tension working (build-tension.ts) for numbers the visitor can change, with a
// one-line verdict on top. The inputs are remembered in this browser; the working itself is the same code the build
// page and the machine page's check use.

import "./style.css";
import { DEFAULT_MACHINE, sanitize, type MachineConfig } from "../machine/config";
import { PARAMS } from "../hardware/drive";
import { MIN_THREAD_MM, tension } from "../hardware/tension";
import { tensionSection } from "./build-tension";
import { T, apply, fx, int, mountSwitch } from "./i18n";
import { VERSION } from "./version";

apply();
mountSwitch();
const $ = (id: string) => document.getElementById(id)!;
$("ver").textContent = "v" + VERSION;

interface Inputs { tensionN: number; threadMm: number; nailMm: number; wraps: number; xSpeed: number; xAccel: number }
const KEY = "sa-calc-v1";
const DEFAULTS: Inputs = {
  tensionN: DEFAULT_MACHINE.tensionN, threadMm: DEFAULT_MACHINE.threadMm, nailMm: DEFAULT_MACHINE.nailMm,
  wraps: PARAMS.tension.busiestWraps, xSpeed: DEFAULT_MACHINE.xSpeed, xAccel: DEFAULT_MACHINE.xAccel
};
interface Field { key: keyof Inputs; label: string; unit: string; min: number; max: number; step: number; digits: number }
// The English strings are written out in full in each T() call so the language test can find them.
const FIELDS: Field[] = [
  { key: "tensionN", label: T("Winding tension"), unit: "N", min: 0.05, max: 3, step: 0.05, digits: 2 },
  { key: "threadMm", label: T("Thread diameter"), unit: "mm", min: 0.05, max: 1, step: 0.01, digits: 2 },
  { key: "nailMm", label: T("Nail diameter"), unit: "mm", min: 0.8, max: 4, step: 0.1, digits: 1 },
  { key: "wraps", label: T("Wraps on the busiest nail"), unit: "", min: 1, max: 80, step: 1, digits: 0 },
  { key: "xSpeed", label: T("Board turning speed"), unit: "°/s", min: 5, max: 360, step: 5, digits: 0 },
  { key: "xAccel", label: T("Board acceleration"), unit: "°/s²", min: 10, max: 1000, step: 10, digits: 0 }
];

function load(): Inputs {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) || "null") as Partial<Inputs> | null;
    if (v) return { ...DEFAULTS, ...Object.fromEntries(Object.entries(v).filter(([, x]) => typeof x === "number" && Number.isFinite(x) && x > 0)) };
  } catch { /* defaults */ }
  return { ...DEFAULTS };
}
let inp = load();
const save = () => { try { localStorage.setItem(KEY, JSON.stringify(inp)); } catch { /* not remembered */ } };

$("calcInputs").innerHTML = FIELDS.map((f) => `<label class="calcf"><span>${f.label}</span>
  <span class="minput"><input type="number" id="ci-${f.key}" min="${f.min}" max="${f.max}" step="${f.step}" inputmode="decimal" /><span class="unit">${f.unit}</span></span></label>`).join("");
const sync = () => FIELDS.forEach((f) => { ($(`ci-${f.key}`) as HTMLInputElement).value = String(inp[f.key]); });
FIELDS.forEach((f) => $(`ci-${f.key}`).addEventListener("change", (e) => {
  const v = Number((e.target as HTMLInputElement).value);
  if (Number.isFinite(v)) inp[f.key] = Math.min(f.max, Math.max(f.min, f.key === "wraps" ? Math.round(v) : v));
  sync(); save(); render();
}));
$("calcReset").addEventListener("click", () => { inp = { ...DEFAULTS }; sync(); save(); render(); });

function machine(): MachineConfig {
  return sanitize({ ...DEFAULT_MACHINE, tensionN: inp.tensionN, threadMm: inp.threadMm, nailMm: inp.nailMm, xSpeed: inp.xSpeed, xAccel: inp.xAccel });
}

function render(): void {
  const m = machine(), n = inp.wraps, r = tension(m, undefined, n);
  const lines: { ok: boolean; text: string }[] = [
    { ok: m.tensionN >= r.sag.minT, text: T("Straight lines need at least {m} N.", { m: fx(r.sag.minT, 2) }) },
    { ok: m.tensionN <= r.nailLimit, text: T("The busiest nail ({n} wraps, {d} mm) bends above about {l} N.", { n: int(n), d: fx(m.nailMm, 1), l: fx(r.nailLimit, 2) }) },
    { ok: r.thread.breaking >= r.required.cone, text: T("The thread breaks at about {b} N and should hold {r} N.", { b: fx(r.thread.breaking, 1), r: fx(r.required.cone, 2) }) },
    { ok: m.threadMm >= MIN_THREAD_MM, text: T("The app's thinnest thread is {d} mm.", { d: fx(MIN_THREAD_MM, 2) }) }
  ];
  const all = lines.every((l) => l.ok);
  $("calcVerdict").className = "calcverdict " + (all ? "ok" : "warn");
  $("calcVerdict").innerHTML = `<p><b>${all ? T("These numbers work: {t} N is inside the window.", { t: fx(m.tensionN, 2) }) : T("Something needs changing:")}</b></p><ul>`
    + lines.map((l) => `<li class="${l.ok ? "ok" : "bad"}">${l.ok ? "✓" : "✗"} ${l.text}</li>`).join("") + "</ul>";
  $("calcBody").innerHTML = tensionSection(m, n);
}

sync();
render();
