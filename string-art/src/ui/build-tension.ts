// The thread-tension working, shown on the calculations page: every step of hardware/tension.ts with its formula and
// the numbers put in, for a machine configuration and a busiest nail, so the result can be checked by hand. Numbers follow the page's language (decimal comma in Danish).

import { DEFAULT_MACHINE, xSpeedLimit, type MachineConfig } from "../machine/config";
import { PARAMS } from "../hardware/drive";
import { tension } from "../hardware/tension";
import { T, fx, int } from "./i18n";

const eq = (s: string) => `<div class="eq">${s}</div>`;
const p = (s: string) => `<p>${s}</p>`;
const h = (s: string) => `<h3>${s}</h3>`;

export function tensionSection(m: MachineConfig = DEFAULT_MACHINE, n: number = PARAMS.tension.busiestWraps): string {
  const r = tension(m, undefined, n), t = PARAMS.tension, sp = t.pinSpool;
  const R = m.boardMm / 2000, w = xSpeedLimit(m) * Math.PI / 180, al = m.xAccel * Math.PI / 180;
  const pathName: Record<string, string> = { dancer: T("dancer eye"), ptfe: T("PTFE tube, all its bends"), tip: T("guide tube tip") };
  const fibreName: Record<string, string> = { polyester: T("polyester"), nylon: T("nylon"), cotton: T("cotton") };
  const out: string[] = [];

  out.push(p(T("How hard the machine pulls the thread decides two things: whether the busiest nails bend, and how thin the thread may be. Each step below gives its formula with the numbers put in. Friction coefficients, the nails' steel and the threads' strength are typical values, not measurements, so check the real tension once the machine runs.")));

  out.push(h(T("1. Where the tension comes from")));
  out.push(p(T("The thread runs from the cone through the tension discs, the dancer eye, the PTFE tube and the guide tube, then over the tube's tip to the nail. The tension as it leaves the tip is the tension the line keeps on the board:")));
  out.push(eq(`<i>T</i><sub>exit</sub> = (<i>T</i><sub>brake</sub> + <i>T</i><sub>inertia</sub>) · <i>K</i>`));

  out.push(h(T("2. How fast thread is pulled off")));
  out.push(p(T("While the board turns, the line from the last nail to the guide grows at most as fast as the rim moves. It never shortens: each wrap ends on the side facing the next nail, so the line only lengthens, and the thread never goes slack.")));
  out.push(eq(`<i>v</i> = <i>R</i>·<i>ω</i> = ${fx(R, 2)} m × ${fx(w, 3)} rad/s = ${fx(r.speed.v, 2)} m/s\n<i>a</i> = <i>R</i>·<i>α</i> = ${fx(R, 2)} m × ${fx(al, 3)} rad/s² = ${fx(r.speed.a, 2)} m/s²`));

  out.push(h(T("3. Friction along the path")));
  out.push(p(T("Where the thread bends round something it rubs, and the tension grows by e<sup>μθ</sup> (the capstan equation; θ is the bend in radians, μ the friction coefficient):")));
  out.push(`<table class="bom"><thead><tr><th>${T("Point")}</th><th class="n sym">θ</th><th class="n sym">μ</th><th class="n sym">e<sup>μθ</sup></th></tr></thead><tbody>`
    + r.path.map((s) => `<tr><td>${pathName[s.id] ?? s.id}</td><td class="n">${fx(s.angle, 2)}</td><td class="n">${fx(s.mu, 2)}</td><td class="n">${fx(s.factor, 2)}</td></tr>`).join("")
    + `</tbody><tfoot><tr><th colspan="3"><i>K</i></th><td class="n">${fx(r.K, 2)}</td></tr></tfoot></table>`);
  out.push(p(T("So the tension discs only have to give about a third of the tension wanted on the board.")));

  out.push(h(T("4. The spool's inertia")));
  out.push(p(T("A spool that turns on a pin has to be speeded up with the thread. A full one (thread and core {m} g, radius {ro} mm on a {ri} mm core):", { m: int(sp.massFull * 1000), ro: sp.rOuter, ri: sp.rCore })));
  out.push(eq(`<i>I</i> = ½·<i>m</i>·(<i>r</i><sub>o</sub>² + <i>r</i><sub>i</sub>²) = ½ × ${fx(sp.massFull, 3)} × (${fx(sp.rOuter / 1000, 3)}² + ${fx(sp.rCore / 1000, 3)}²) = ${fx(0.5 * sp.massFull * ((sp.rOuter / 1000) ** 2 + (sp.rCore / 1000) ** 2) * 1e5, 2)}·10⁻⁵ kg·m²\n<i>T</i><sub>inertia</sub> = <i>I</i>·<i>a</i> / <i>r</i>² = ${fx(r.inertia.pinFull, 3)} N`));
  out.push(p(T("A cone that stands still only speeds up the thread itself: {t} N, nothing.", { t: fx(r.inertia.cone * 1e6, 0) + "·10⁻⁶" })));

  out.push(h(T("5. As the spool empties")));
  out.push(p(T("A felt brake on a turning spool gives a fixed torque <i>M</i>, so the tension is <i>T</i> = <i>M</i> / <i>r</i>: from a full spool to the core it grows {x} times. Pulled off the top of a standing cone through tension discs, it hardly changes (about ±{v} %). Either way, the friction is a little stronger at each start than while sliding (about ×{s}).", { x: fx(r.emptying, 1), v: int(t.coneVariation * 100), s: fx(t.stickSlip, 1) })));

  out.push(h(T("6. Lower limit: straight lines")));
  out.push(p(T("The board lies flat while it is wound, so a line sags under its own weight. The thread ({d} mm, about {x} tex, that is {x} g per km) weighs", { d: fx(m.threadMm, 2), x: fx(r.thread.tex, 0) })));
  out.push(eq(`<i>w</i> = <i>λ</i>·<i>g</i> = ${fx(r.thread.lambda * 1e5, 2)}·10⁻⁵ kg/m × ${fx(9.81, 2)} = ${fx(r.sag.w * 1e4, 2)}·10⁻⁴ N/m\n<i>δ</i> = <i>w</i>·<i>L</i>² / (8<i>T</i>)  →  <i>T</i> ≥ <i>w</i>·<i>L</i>² / (8 × ${fx(t.sagLimitMm, 1)} mm) = ${fx(r.sag.minT, 2)} N`));
  out.push(p(T("At {t} N the longest line ({l} m) sags {s} mm.", { t: fx(r.target, 2), l: fx(r.sag.L, 1), s: fx(r.sag.at, 2) })));

  out.push(h(T("7. Upper limit: the busiest nail")));
  out.push(p(T("Each wrap pulls the nail with two legs of tension <i>T</i>, both heading into the board. A line to a nail Δ away leaves at (90° − Δ/2) from straight inward; averaged over the lines allowed, the inward share is <i>s</i>, and the sideways shares mostly cancel. The wraps sit {z0} to {z1} mm up, so the pull acts about <i>h</i> above where the nail is held (adding one nail diameter for the wood giving way).",
    { z0: fx(m.zStartMm, 1), z1: fx(m.zStartMm + m.layerMm * (r.nail.n - 1), 1) })));
  out.push(eq(`<i>s</i> = mean sin(Δ/2) = ${fx(r.nail.s, 3)}\n<i>F</i> = 2·<i>s</i>·<i>n</i>·<i>T</i> = 2 × ${fx(r.nail.s, 3)} × ${r.nail.n} × <i>T</i> = ${fx(r.nail.forcePerT, 1)}·<i>T</i>\n<i>M</i> = <i>F</i>·<i>h</i> = ${fx(r.nail.forcePerT, 1)}·<i>T</i> × ${fx(r.nail.h, 1)} mm = ${fx(r.nail.momentPerT, 0)}·<i>T</i> N·mm\n<i>M</i><sub>y</sub> = <i>σ</i><sub>y</sub>·π·<i>d</i>³ / 32        <i>T</i><sub>max</sub> = <i>M</i><sub>y</sub> / (${fx(t.nailSafety, 1)} × <i>M</i>/<i>T</i>)`));
  out.push(`<table class="bom"><thead><tr><th>${T("Nail")}</th><th class="n">${T("Wraps on the busiest nail")}</th><th class="n">${T("Steel {s} MPa", { s: t.nailYield })}</th><th class="n">${T("Steel {s} MPa", { s: t.nailYieldHard })}</th></tr></thead><tbody>`
    + r.nailLimits.map((x) => `<tr><td>${fx(x.d, 1)} mm</td><td class="n">${x.n}</td><td class="n">${fx(x.soft, 2)} N</td><td class="n">${fx(x.hard, 2)} N</td></tr>`).join("") + "</tbody></table>");
  out.push(p(T("The wood holds well below that, and the nail bends elastically only a few hundredths of a millimetre: the risk is the steel yielding, which leaves the nail leaning in for good.")));

  out.push(h(T("8. The highest tension the thread sees")));
  out.push(eq(`<i>T</i><sub>brake</sub> = ${fx(r.target, 2)} / ${fx(r.K, 2)} = ${fx(r.brake, 3)} N\n${T("spool on a pin")}: (${fx(r.brake, 3)} × ${fx(r.emptying, 1)} × ${fx(t.stickSlip, 1)} + ${fx(r.inertia.pinFull, 3)}) × ${fx(r.K, 2)} = ${fx(r.peak.pin, 2)} N\n${T("standing cone")}: (${fx(r.brake, 3)} × ${fx(1 + t.coneVariation, 2)} × ${fx(t.stickSlip, 1)}) × ${fx(r.K, 2)} = ${fx(r.peak.cone, 2)} N`));
  out.push(p(T("With a spool on a pin the steady tension near its core would be {t} N, above what the nails take: that is why the machine stands the thread on a cone.", { t: fx(r.pinSteadyEmpty, 2) })));

  out.push(h(T("9. How thin the thread may be")));
  out.push(p(T("The thread must hold the highest tension {sf} times over, also at the knot that ties it on (a knot keeps about {k} % of the strength). Its strength per tex and its density give the diameter (fibres fill about {f} % of a twisted thread):", { sf: t.safety, k: int(t.knotEfficiency * 100), f: int(t.packing * 100) })));
  out.push(eq(`<i>F</i><sub>break</sub> ≥ ${t.safety} × <i>T</i><sub>peak</sub> / ${fx(t.knotEfficiency, 2)}  =  ${fx(r.required.cone, 2)} N (${T("standing cone")}),  ${fx(r.required.pin, 2)} N (${T("spool on a pin")})\ntex = <i>F</i><sub>break</sub> / ${T("strength per tex")}        <i>d</i> = √(4 · tex·10⁻⁶ / (π · <i>ρ</i> · ${fx(t.packing, 1)}))`));
  out.push(`<table class="bom"><thead><tr><th>${T("Thread")}</th><th class="n">${T("Strength")}</th><th class="n">${T("Standing cone")}</th><th class="n">${T("Spool on a pin")}</th></tr></thead><tbody>`
    + r.minimum.map((x) => `<tr><td>${fibreName[x.fibre]}</td><td class="n">${fx(t.fibres[x.fibre].tenacity, 2)} N/tex</td><td class="n">${fx(x.cone.tex, 1)} tex → ${fx(x.cone.d, 2)} mm</td><td class="n">${fx(x.pin.tex, 1)} tex → ${fx(x.pin.d, 2)} mm</td></tr>`).join("") + "</tbody></table>");

  out.push(h(T("10. What it means")));
  out.push(`<ul class="steps">`
    + `<li>${T("<b>Wind at {a}–{b} N; {t} N is set.</b> The thread leaving the guide should just lift a {g} g weight (or read it on a luggage scale).", { a: fx(r.sag.minT, 2), b: fx(r.nailLimit, 2), t: fx(r.target, 2), g: int(r.target / 9.81 * 1000) })}</li>`
    + `<li>${T("<b>The thread stands on a cone</b> and comes off over its top through tension discs, so the tension stays put as the cone empties.")}</li>`
    + `<li>${T("<b>Thread at least {d} mm</b>: thinner would hold in theory, but leaves nothing for wear at the tube tip or a weak spot. The app does not go below it. The usual {u} mm polyester holds the peak {s} times over.", { d: fx(PARAMS.tension.practicalMinMm, 2), u: fx(m.threadMm, 2), s: fx(r.safetyOfThread.cone, 0) })}</li>`
    + `<li>${T("<b>2 mm nails</b> for pieces whose busiest nail gets more than about 25 wraps (the machine page counts them and warns).")}</li>`
    + `<li>${T("<b>The turntable motor</b> feels the thread as {a} N·m extra, {b} N·m at the peak: nothing next to what it has.", { a: fx(r.turntable.atTarget, 3), b: fx(r.turntable.atPeak, 3) })}</li>`
    + `</ul>`);
  return out.join("");
}
