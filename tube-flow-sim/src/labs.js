/*
 * labs.js — guided experiments. Each lab is a short sequence of steps; a step says what to do and why,
 * points at the control involved, ticks itself off when the page reaches the state it asks for, and has
 * a "Do it for me" button. Steps talk to the page only through the `app` object index.html passes in:
 *   app.state, app.setCase(patch), app.applyRe(re), app.play(on), app.stats(), app.lattice(), app.geometry(),
 *   app.view, app.backendKind(), app.save(), app.runs(), app.compareCount(), app.sweep(), app.startSweep(o)
 */
const near = (a, b, tol) => Math.abs(a / b - 1) < (tol || 0.05);
const shapeIs = (app, s) => { const G = app.geometry(); return !!G && !!G.body && G.body.shape === s; };
const ft = (app) => { const s = app.stats(); return s ? s.ft : 0; };
const savedAt = (app, shape, re) => app.runs().some((r) => r.case.body === shape && near(r.lattice.ReSim, re, 0.08));

export const LABS = [
  {
    id: "stokes", title: "Stokes' law and the walls", level: "Basic · ~3 min",
    intro: "In creeping flow the drag on a sphere is Stokes' 6πμaU — but in a tube the walls add to it, by a factor K(λ) that grows steeply with the sphere's share λ of the tube. Haberman & Sayre computed K in 1958; here you check it.",
    steps: [
      { text: "Set up a sphere moving along a tube of glycerol: <b>Fluid</b> glycerol, <b>Frame</b> moving body, <b>Body</b> sphere, 30% of the tube.", el: "#frame",
        done: (a) => a.state.fluid === "glycerol" && a.state.frame === "moving" && shapeIs(a, "sphere") && near(a.state.ratio, 0.3, 0.02),
        doIt: (a) => a.setCase({ fluid: "glycerol", frame: "moving", body: "sphere", ratio: 0.3 }) },
      { text: "Press the <b>Creeping</b> preset (Re 0.5) and <b>Play</b>.", el: "[data-re='0.5']",
        done: (a) => a.lattice().ReSim < 1 && a.state.running, doIt: (a) => { a.applyRe(0.5); a.play(true); } },
      { text: "Wait for the badge under <b>Measurements</b> to turn green: <i>steady · attached flow</i>. The <b>Reference</b> line below the chart compares the drag with Stokes × K(λ = 0.30) = 2.37 — expect agreement within a few percent (closer on the finer grids).", el: "#regime-badge",
        done: (a) => { const s = a.stats(); return !!s && s.regime === "steady"; } },
      { text: "Now a much bigger sphere: set its diameter to <b>45%</b> of the tube (and press Creeping again). K(0.45) ≈ 4.5: the walls more than quadruple the drag. Wait for steady and read the Reference line again.", el: "#ratio",
        done: (a) => a.state.ratio >= 0.44 && a.lattice().ReSim < 1 && (a.stats() || {}).regime === "steady",
        doIt: (a) => { a.setCase({ ratio: 0.45 }); a.applyRe(0.5); a.play(true); } },
      { text: "<b>What you saw:</b> at low Reynolds numbers the walls are felt from far away — the flow the sphere pushes aside has to squeeze back past it. The app's validation report checks this at three sizes; open it from the <b>Validation</b> link.", el: "#validation-link", done: () => true }
    ]
  },
  {
    id: "wake", title: "Separation and the wake bubble", level: "Intermediate · ~6 min",
    intro: "Above a Reynolds number of about 20 the flow can no longer follow the back of a sphere: it separates and leaves a ring of recirculating fluid behind it. A Reynolds sweep maps when that happens and how the bubble grows.",
    steps: [
      { text: "Set up pipe flow of water past a sphere 30% of the tube: <b>Frame</b> pipe flow, <b>Inflow</b> developed, <b>Body</b> sphere.", el: "#inflow",
        done: (a) => a.state.frame === "pipe" && a.state.inflow === "parabolic" && shapeIs(a, "sphere") && near(a.state.ratio, 0.3, 0.02) && a.state.fluid === "water",
        doIt: (a) => a.setCase({ fluid: "water", frame: "pipe", inflow: "parabolic", body: "sphere", ratio: 0.3 }) },
      { text: "In <b>Reynolds sweep</b> (below the chart) run Re 10 → 150 with 4 points. Each point runs until it settles; it takes a few minutes.", el: "#sw-run",
        done: (a) => { const s = a.sweep(); return !!s && s.done && s.results.length >= 3; },
        doIt: (a) => a.startSweep({ from: 10, to: 150, n: 4, ft: 5 }) },
      { text: "Read the plots: the wake length L/d is zero at Re 10 and grows once the flow separates; the drag falls with Re but stays above Schiller–Naumann's open-flow curve — the tube's walls again. Turn on the <b>Axial slice</b> to see the bubble at the last point.", el: "#slice-switch",
        done: (a) => a.view.opts.axial, doIt: (a) => { a.view.set("axial", true); a.syncView(); } },
      { text: "Switch the slice to <b>Vorticity</b>: the shear layers leaving the sphere's shoulders roll up into the bubble.", el: "[data-field='vorticity']",
        done: (a) => a.view.opts.field === "vorticity", doIt: (a) => { a.view.set("field", "vorticity"); a.syncView(); } }
    ]
  },
  {
    id: "shape", title: "Shape matters", level: "Intermediate · ~6 min",
    intro: "At the same width and Reynolds number, a face-on disc, a sphere and a streamlined body have very different drag — mostly because of how early the flow separates. Save three runs and compare them.",
    steps: [
      { text: "Sphere, pipe flow of water, Re <b>100</b>: press the <b>Separated</b> preset and Play.", el: "[data-re='100']",
        done: (a) => shapeIs(a, "sphere") && near(a.lattice().ReSim, 100, 0.05) && a.state.running,
        doIt: (a) => { a.setCase({ fluid: "water", frame: "pipe", inflow: "parabolic", body: "sphere", ratio: 0.3 }); a.applyRe(100); a.play(true); } },
      { text: "When it has run about 2.5 flow-throughs (HUD, top left), press <b>Save run</b>.", el: "#btn-save",
        done: (a) => savedAt(a, "sphere", 100), doIt: (a) => { if (ft(a) > 2) a.save(); } },
      { text: "Now a <b>Disc, face-on</b>, same width and Re — run it ~2.5 flow-throughs and <b>Save run</b>.", el: "#body",
        done: (a) => savedAt(a, "disc", 100), doIt: (a) => { if (shapeIs(a, "disc") && ft(a) > 2) a.save(); else { a.setCase({ body: "disc" }); a.applyRe(100); a.play(true); } } },
      { text: "And an <b>Ellipsoid</b> with length/width 3 (streamlined) — run, then <b>Save run</b>.", el: "#body",
        done: (a) => savedAt(a, "ellipsoid", 100), doIt: (a) => { if (shapeIs(a, "ellipsoid") && ft(a) > 2) a.save(); else { a.setCase({ body: "ellipsoid", aspect: 3 }); a.applyRe(100); a.play(true); } } },
      { text: "<b>Saved runs</b> now compares them: the disc separates at its sharp edge and has the highest drag and the longest wake; the ellipsoid's flow stays attached almost to its tail — no bubble, and the least drag even though its surface (and skin friction) is the largest.", el: "#runs-card",
        done: (a) => a.compareCount() >= 3 }
    ]
  },
  {
    id: "shedding", title: "Vortex shedding", level: "Advanced · GPU · ~5 min",
    intro: "Past Re ≈ 210 a sphere's wake loses its symmetry, and from about 270 it sheds hairpin vortices at a regular rhythm — the Strouhal number St = f·d/U. Resolving this needs the GPU grid.",
    steps: [
      { text: "This lab needs the <b>GPU</b> solver (WebGPU) on the 64- or 96-cell grid. On the CPU grids the wake stays steady — the sphere is too coarse.", el: "#res-buttons",
        done: (a) => a.backendKind() === "gpu" },
      { text: "Pipe flow of water past a sphere 30% of the tube, then the <b>Unsteady wake</b> preset (Re 500) and Play.", el: "#re-max-btn",
        done: (a) => shapeIs(a, "sphere") && a.lattice().ReSim >= 400 && a.state.running,
        doIt: (a) => { a.setCase({ fluid: "water", frame: "pipe", inflow: "parabolic", body: "sphere", ratio: 0.3 }); a.applyRe(Math.min(500, Math.floor(a.lattice().ReMax))); a.play(true); } },
      { text: "Turn on <b>Vortex surfaces</b> and <b>Dye</b> from the body: watch the hairpins form and peel off, alternating sides.", el: "#sw-vortex",
        done: (a) => a.view.opts.vortex, doIt: (a) => { a.view.set("vortex", true); a.view.set("dye", true); a.view.set("dyeSource", "sphere"); a.syncView(); } },
      { text: "After 3–4 flow-throughs the badge reads <i>unsteady wake</i> and the <b>Strouhal</b> tile shows two peaks: ≈ 0.14 (shedding) and ≈ 0.05 (the slow wandering of the whole wake). Open-flow experiments give St ≈ 0.14–0.17 here.", el: "#regime-badge",
        done: (a) => (a.stats() || {}).regime === "unsteady" }
    ]
  },
  {
    id: "pulse", title: "Pulsatile flow and the Womersley number", level: "Advanced · ~5 min",
    intro: "Blood flow pulses. Whether the velocity profile keeps up with the pulse depends on the Womersley number α = R·√(ω/ν): slow pulses (α ≲ 1) keep the parabola, fast ones (α ≫ 1) give a flat core that moves like a plug and thin wall layers that lag behind it.",
    steps: [
      { text: "Pipe flow of water with a small sphere (15%), <b>Inflow</b> pulsatile, amplitude 60%, <b>Womersley α</b> 1.5 — slow pulses. Press <b>Attached</b> (Re 10) and Play.", el: "#inflow",
        done: (a) => a.state.inflow === "pulsatile" && a.state.womersley < 2 && a.state.running,
        doIt: (a) => { a.setCase({ fluid: "water", frame: "pipe", body: "sphere", ratio: 0.15, inflow: "pulsatile", pulseAmp: 0.6, womersley: 1.5 }); a.applyRe(10); a.play(true); } },
      { text: "Turn on the <b>Axial slice</b> (speed). The profile swells and shrinks but stays parabolic, in step with the pulse; the drag on the sphere follows the flow rate.", el: "#slice-switch",
        done: (a) => a.view.opts.axial && ft(a) > 0.5, doIt: (a) => { a.view.set("axial", true); a.view.set("field", "speed"); a.syncView(); } },
      { text: "Now <b>α = 10</b>: the core flattens and the fluid near the wall turns back before the core does — the phase lag that makes arterial wall stress so different from steady flow.", el: "#wom",
        done: (a) => a.state.womersley >= 9, doIt: (a) => a.setCase({ womersley: 10 }, true) }
    ]
  }
];

export function createLabs(app, host) {
  let lab = null, step = 0, hl = null, timer = 0;
  const card = document.createElement("div");
  card.className = "lab-card"; card.hidden = true;
  card.setAttribute("role", "dialog"); card.setAttribute("aria-label", "Guided lab");
  host.appendChild(card);
  function highlight(sel) {
    if (hl) hl.classList.remove("lab-hl");
    hl = sel ? document.querySelector(sel) : null;
    if (hl) { hl.classList.add("lab-hl"); }
  }
  function render() {
    if (!lab) { card.hidden = true; highlight(null); return; }
    const s = lab.steps[step], ok = !!s.done(app);
    card.hidden = false;
    card.innerHTML =
      '<div class="lab-top"><span class="lab-level">' + lab.level + '</span><button class="lab-x" type="button" aria-label="Close the lab">×</button></div>' +
      '<div class="lab-title">' + lab.title + '</div>' +
      (step === 0 ? '<p class="lab-intro">' + lab.intro + '</p>' : '') +
      '<div class="lab-dots">' + lab.steps.map((x, i) => '<i class="' + (i < step ? "past" : i === step ? "now" : "") + '"></i>').join("") + '</div>' +
      '<p class="lab-step"><span class="lab-tick ' + (ok ? "ok" : "") + '">' + (ok ? "✓" : step + 1) + '</span><span>' + s.text + '</span></p>' +
      '<div class="lab-btns">' +
      '<button class="lab-btn" type="button" data-a="back"' + (step ? "" : " disabled") + '>Back</button>' +
      (s.doIt ? '<button class="lab-btn" type="button" data-a="do">Do it for me</button>' : '') +
      '<button class="lab-btn primary" type="button" data-a="next"' + (ok ? "" : " disabled") + '>' + (step === lab.steps.length - 1 ? "Finish" : "Next") + '</button></div>';
    card.querySelector(".lab-x").onclick = () => start(null);
    card.querySelectorAll("[data-a]").forEach((b) => b.addEventListener("click", () => {
      const a = b.getAttribute("data-a");
      if (a === "back") { step = Math.max(0, step - 1); render(); }
      else if (a === "do") { s.doIt(app); setTimeout(render, 300); }
      else if (a === "next") { if (step === lab.steps.length - 1) start(null); else { step++; render(); } }
    }));
    highlight(s.el);
  }
  function start(id) {
    lab = LABS.filter((l) => l.id === id)[0] || null; step = 0;
    clearInterval(timer);
    if (lab) timer = setInterval(() => { if (lab) { const ok = lab.steps[step].done(app), t = card.querySelector(".lab-tick"); if (t && t.classList.contains("ok") !== ok) render(); } }, 700);
    render();
  }
  return { start: start, labs: LABS, current: () => lab && { id: lab.id, step: step, done: !!lab.steps[step].done(app) } };
}
