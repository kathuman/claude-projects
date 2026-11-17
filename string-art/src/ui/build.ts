// The build page: the machine in 3D, its numbers, the parts to buy and to print, drilling plans, wiring, controller
// settings and the assembly steps. Everything comes from src/hardware/params.json and what FreeCAD wrote from it.

import "./style.css";
import { drive, grblSettings, GRBL_MAX_RATE, PARAMS } from "../hardware/drive";
import { motorHang } from "../hardware/layout";
import { assemblySteps, boughtParts, calibrationSteps, grblComment, modelNames, printedNames } from "./build-data";
import { baseDrawing, platterDrawing, wiringDrawing } from "./build-drawings";
import { tension } from "../hardware/tension";
import { DEFAULT_MACHINE } from "../machine/config";
import { T, apply, fx, int, mountSwitch } from "./i18n";
import { VERSION } from "./version";

apply();
mountSwitch();
const $ = (id: string) => document.getElementById(id)!;
$("ver").textContent = "v" + VERSION;

interface PartsFile { centreDistance: number; boardTop: number; parts: { id: string; qty: number; file: string; size: number[]; volume: number; triangles: number }[] }

const rows = (r: [string, string][]) => r.map(([k, v]) => `<tr><th scope="row">${k}</th><td>${v}</td></tr>`).join("");
const eur = (v: number) => T("€ {v}", { v: int(v) });

// ---------------------------------------------------------------- the numbers
const dr = drive(), hang = motorHang();
$("bdNumbers").innerHTML = rows([
  [T("Turntable drive"), T("{a} to {b} teeth: {r} : 1", { a: PARAMS.drive.motorTeeth, b: PARAMS.drive.turntableTeeth, r: fx(dr.ratio, 0) })],
  [T("Motor to turntable axis"), T("{c} mm, with a {l} mm belt; {m} teeth in mesh", { c: fx(dr.centre, 1), l: PARAMS.drive.beltLength, m: fx(dr.meshTeeth, 1) })],
  [T("Steps"), T("X {x} per degree · Y {y} per mm · Z {z} per mm", { x: fx(dr.xSteps, 3), y: fx(dr.ySteps, 0), z: fx(dr.zSteps, 0) })],
  [T("Smallest move of a nail"), T("{u} µm per microstep", { u: fx(dr.resolutionMm * 1000, 1) })],
  [T("Motor speeds at top speed"), T("X {x} rpm · Y {y} rpm · Z {z} rpm", { x: int(dr.xRpm), y: int(dr.yRpm), z: int(dr.zRpm) })],
  [T("Step pulses at top speed"), T("{r} per second at most (GRBL on an Uno manages about {g})", { r: int(Math.max(dr.xRate, dr.yRate, dr.zRate)), g: int(GRBL_MAX_RATE) })],
  [T("Turning load"), T("{m} kg of platter and board, {i} kg·m²", { m: fx(dr.massKg, 1), i: fx(dr.inertia, 3) })],
  [T("Torque at the motor"), T("needs {n} N·m to accelerate, has about {a} N·m: {s} times the need", { n: fx(dr.torqueNeeded, 3), a: fx(dr.torqueAvail, 2), s: fx(dr.safety, 1) })],
  [T("Under the base"), T("the motor hangs {h} mm down; the {f} mm feet leave {c} mm to the floor", { h: int(hang.hang), f: PARAMS.base.footHeight, c: int(hang.clearance) })]
]);

// ---------------------------------------------------------------- parts to buy
const bought = boughtParts();
let total = 0, group = "";
const buy: string[] = [`<thead><tr><th>${T("Part")}</th><th>${T("Size or type")}</th><th class="n">${T("Qty")}</th><th class="n">${T("About")}</th></tr></thead><tbody>`];
for (const b of bought) {
  if (b.group !== group) { group = b.group; buy.push(`<tr class="grp"><th colspan="4">${group}</th></tr>`); }
  total += b.qty * b.eur;
  buy.push(`<tr><td>${b.name}</td><td>${b.spec}</td><td class="n">${b.qty}</td><td class="n">${eur(b.qty * b.eur)}</td></tr>`);
}
buy.push(`</tbody><tfoot><tr><th colspan="3">${T("Total, roughly")}</th><td class="n">${eur(total)}</td></tr></tfoot>`);
$("bdBuy").innerHTML = buy.join("");

// ---------------------------------------------------------------- parts to print (from what FreeCAD wrote)
const names = printedNames();
fetch("hardware/parts.json").then((r) => r.json() as Promise<PartsFile>).then((pf) => {
  let grams = 0;
  const body = pf.parts.map((p) => {
    const g = p.volume * 1.27 * 0.55 * p.qty;          // PETG, walls plus 40 % infill: about 55 % of solid
    grams += g;
    const n = names[p.id] ?? { name: p.id, note: "" };
    return `<tr><td><b>${n.name}</b><div class="fine">${n.note}</div></td><td class="n mono">${p.size.map((v) => fx(v, 0)).join(" × ")}</td><td class="n">${p.qty}</td><td class="n">${T("{g} g", { g: int(g) })}</td><td><a href="hardware/${p.file}" download>STL</a></td></tr>`;
  }).join("");
  $("bdPrint").innerHTML = `<thead><tr><th>${T("Part")}</th><th class="n">${T("Size, mm")}</th><th class="n">${T("Qty")}</th><th class="n">${T("Filament")}</th><th></th></tr></thead><tbody>${body}</tbody>`
    + `<tfoot><tr><th colspan="3">${T("All printed parts")}</th><td class="n">${T("{g} g", { g: int(grams) })}</td><td></td></tr></tfoot>`;
}).catch(() => { $("bdPrint").innerHTML = `<tbody><tr><td>${T("The list of printed parts could not be loaded.")}</td></tr></tbody>`; });

// ---------------------------------------------------------------- drawings
$("bdBase").innerHTML = baseDrawing("screen");
$("bdPlatter").innerHTML = platterDrawing("screen");
$("bdWiring").innerHTML = wiringDrawing();
{
  const tr = tension();
  $("bdTension").innerHTML = T("The machine winds at {t} N: enough for straight lines (at least {a} N), below what bends the busiest nail (about {b} N with 1.5 mm nails and {n} wraps). It stands the thread on a cone with tension discs, and the thread must be at least {d} mm. Every step, with your own numbers, is on the calculations page.",
    { t: fx(DEFAULT_MACHINE.tensionN, 2), a: fx(tr.sag.minT, 2), b: fx(tr.nailLimit, 2), n: tr.nail.n, d: fx(PARAMS.tension.practicalMinMm, 2) });
}
function save(name: string, text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: "image/svg+xml" })), a = document.createElement("a");
  a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
$("bdBaseSvg").addEventListener("click", () => save("string-art-machine-base-1to1.svg", baseDrawing("paper", true)));
$("bdPlatterSvg").addEventListener("click", () => save("string-art-machine-platter-1to1.svg", platterDrawing("paper", true)));

// ---------------------------------------------------------------- controller settings
const settings = grblSettings();
const pad = Math.max(...settings.map(([s]) => s.length)) + 2;
const grblText = settings.map(([s]) => s.padEnd(pad) + "; " + grblComment(s)).join("\n");
$("bdGrbl").textContent = grblText;
$("bdCopy").addEventListener("click", () => {
  void navigator.clipboard?.writeText(settings.map(([s]) => s).join("\n")).then(() => { $("bdCopy").textContent = T("Copied"); }).catch(() => undefined);
});

// ---------------------------------------------------------------- steps
$("bdAssembly").innerHTML = assemblySteps().map((s) => `<li>${s}</li>`).join("");
$("bdCalibrate").innerHTML = calibrationSteps().map((s) => `<li>${s}</li>`).join("");

// ---------------------------------------------------------------- the 3D model (three.js is loaded only for this)
const legend: [string, string, string][] = [
  ["#c9a46c", T("wood"), "W"], ["#2f9fd8", T("printed"), "P"], ["#b9c2cc", T("bought metal parts"), "A"],
  ["#2b2f36", T("motors"), "M"], ["#2e8a57", T("electronics"), "E"], ["#e5484d", T("thread path"), "T"]
];
$("b3dLegend").innerHTML = legend.map(([c, n]) => `<span><i style="background:${c}"></i>${n}</span>`).join("");
const model = modelNames();
function nameOf(part: string): string {
  const id = part.replace(/^[A-Z]_/, ""), pr = names[id.replace(/_\d+$/, "")];
  if (pr) return pr.name + " · " + T("printed");
  const base = id.replace(/_[lr]-?\d+$/, "");
  return model[base] ?? model[id] ?? id;
}
void import("./build-3d").then(({ MachineView }) => {
  const view = new MachineView($("b3d"), (p) => { $("b3dPick").textContent = p ? nameOf(p) : T("Click a part to see what it is. Drag to turn, scroll to zoom."); });
  ($("b3dTurn") as HTMLInputElement).addEventListener("change", (e) => { view.autoTurn = (e.target as HTMLInputElement).checked; });
  return view.load("hardware/machine.glb", (f) => { $("b3dLoad").textContent = T("Loading the 3D model… {p} %", { p: Math.round(f * 100) }); })
    .then(() => { $("b3dLoad").remove(); });
}).catch(() => { $("b3dLoad").textContent = T("The 3D model could not be shown in this browser."); });

// test hook
(window as unknown as { __bd: unknown }).__bd = { drive: dr, total, grblText };
