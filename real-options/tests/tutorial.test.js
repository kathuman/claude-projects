// Tutorial checks — run with: node real-options/tests/tutorial.test.js
// Every step is well formed and its scenario is one the sliders can show; presets and targets exist; and every claim a
// question makes about the model is true in the engines, at the scenario the step sets up.
const fs = require("fs"), path = require("path");
const T = require("../tour-content.js"), S = require("../specs.js"), M = require("../src/model.js"), N = require("../src/network.js");
let pass = 0, fail = 0;
function check(name, cond, detail) { if (cond) pass++; else fail++; if (!cond || process.env.VERBOSE) console.log((cond ? "ok   " : "FAIL ") + name + (detail !== undefined ? "  → " + detail : "")); }
const html = { index: fs.readFileSync(path.join(__dirname, "../index.html"), "utf8"), network: fs.readFileSync(path.join(__dirname, "../network.html"), "utf8") };
const pageSpecs = { index: S.single, network: S.network };

// the scenario a step sets up, as model parameters for its page
function stepParams(st) {
  const sp = pageSpecs[st.page], s = st.setup || {}, shown = {};
  if (s.preset) Object.assign(shown, sp.PRESETS[s.preset]);
  Object.assign(shown, s.shown || {});
  return S.toModel(sp.SPECS, shown, s.basis);
}
const flex = (s) => Math.max(s.defer.npv, s.stage.npv, s.lease.npv) - s.best.npv;
const step = (id) => T.LEVELS.flatMap((l) => l.steps).find((x) => x.id === id);

// ---- structure
{
  check("three levels: beginner, intermediate, advanced", T.LEVELS.map((l) => l.id).join() === "beginner,intermediate,advanced");
  const all = T.LEVELS.flatMap((l) => l.steps), ids = new Set(all.map((s) => s.id));
  check("every step has a unique id, a page, a title and a body (" + all.length + " steps)", ids.size === all.length && all.every((s) => (s.page === "index" || s.page === "network") && s.title && s.body));
  let badRange = [], badPreset = [], badTarget = [], badQuiz = [], badToken = [];
  for (const s of all) {
    const sp = pageSpecs[s.page], su = s.setup || {};
    for (const [k, v] of Object.entries(su.shown || {})) { const p = sp.SPECS[k]; if (!p || (p.check ? !(v === 0 || v === 1) : (v < p.min || v > p.max || Math.abs((v - p.min) / p.step - Math.round((v - p.min) / p.step)) > 1e-9))) badRange.push(s.id + ":" + k); }
    if (su.preset && !sp.PRESETS[su.preset]) badPreset.push(s.id);
    // targets: an id or data attribute that the page's HTML declares, or one the scripts create (marked below)
    const created = ["#c_", "#n_", "[data-basis", "#scorecards", "#headline"];
    const m = /^#([\w-]+)$/.exec(s.target || "");
    if (m && !html[s.page].includes('id="' + m[1] + '"') && !created.some((c) => s.target.startsWith(c))) badTarget.push(s.id + ":" + s.target);
    if (s.target && s.target.startsWith("#c_") && !S.single.SPECS[s.target.slice(3)]) badTarget.push(s.id);
    if (s.target && s.target.startsWith("#n_") && !S.network.SPECS[s.target.slice(3)]) badTarget.push(s.id);
    if (s.quiz && !(s.quiz.options.length >= 2 && s.quiz.answer >= 0 && s.quiz.answer < s.quiz.options.length && s.quiz.explain)) badQuiz.push(s.id);
    (s.body + (s.quiz ? s.quiz.explain : "")).replace(/\{\{(\w+)\}\}/g, (m0, t) => { if (!T.TOKENS.includes(t)) badToken.push(s.id + ":" + t); });
  }
  check("every slider value a step sets is inside the slider's range and on its step", badRange.length === 0, badRange.join(" "));
  check("every preset a step loads exists", badPreset.length === 0, badPreset.join(" "));
  check("every element a step points at exists on its page", badTarget.length === 0, badTarget.join(" "));
  check("every question has options, a valid answer and an explanation", badQuiz.length === 0, badQuiz.join(" "));
  check("every {{token}} in the text is one the player fills in", badToken.length === 0, badToken.join(" "));
  check("both pages load the tutorial and have the Tutorial button", ["index", "network"].every((p) => html[p].includes("tour-content.js") && html[p].includes("tour.js") && html[p].includes('id="tourBtn"')));
  check("every question carries a claim that is checked below", all.filter((s) => s.quiz).every((s) => s.quiz.claim));
}

// ---- the claims the questions make, checked at each step's own scenario
const claims = {
  "vol-raises-flex": () => { const lo = M.solve(stepParams(step("b-vol-q"))), hi = M.solve(stepParams(step("b-vol-high"))); return [flex(hi) > flex(lo) + 1, flex(lo).toFixed(2) + " → " + flex(hi).toFixed(2)]; },
  "decline-lease": () => { const s = M.solve(stepParams(step("b-decline"))), top = ["full", "best", "defer", "stage", "lease"].reduce((a, b) => s[b].npv > s[a].npv ? b : a); return [top === "lease", top]; },
  "no-bridge-builds-now": () => { const s = M.solve(stepParams(step("i-bridge-q"))); return [Math.abs(s.defer.npv - s.full.npv) < 1e-9, s.defer.npv.toFixed(2) + " vs " + s.full.npv.toFixed(2)]; },
  "resale-raises-best": () => { const p = stepParams(step("i-resale-q")), a = M.solve(p).best.npv, b = M.solve(Object.assign({}, p, { salvF: 0.5 })).best.npv; return [b > a, a.toFixed(2) + " → " + b.toFixed(2)]; },
  "rn-equals-wacc": () => { const p = stepParams(step("a-rn-q")), a = M.solve(p), b = M.solve(Object.assign({}, p, { basis: "wacc" })); return [["full", "best", "defer", "stage", "lease"].every((k) => Math.abs(a[k].npv - b[k].npv) < 1e-9), a.stage.npv.toFixed(3)]; },
  "resale-kills-moth": () => { const before = M.solve(stepParams(step("a-moth"))), after = M.solve(stepParams(step("a-sell-q"))); return [before.best.npv - before.best.noMoth > 0.2 && after.best.npv - after.best.noMoth < 0.05, (before.best.npv - before.best.noMoth).toFixed(2) + " → " + (after.best.npv - after.best.noMoth).toFixed(2)]; },
  "rho-lowers-central": () => { const p = stepParams(step("a-net-rho-q")), v = [-0.6, 0, 0.6].map((rho) => N.fixedNpv(Object.assign({}, p, { rho }), 750, 0)); return [v[0] > v[1] && v[1] > v[2], v.map((x) => x.toFixed(1)).join(" > ")]; },
  "learn-raises-pilot": () => { const p = stepParams(step("a-net-learn-q")), a = N.solve(p).pilot.npv, b = N.solve(Object.assign({}, p, { learn: 0.6 })).pilot.npv; return [b > a, a.toFixed(2) + " → " + b.toFixed(2)]; }
};
for (const s of T.LEVELS.flatMap((l) => l.steps).filter((x) => x.quiz)) {
  const fn = claims[s.quiz.claim];
  if (!fn) { check("claim " + s.quiz.claim + " has a check", false); continue; }
  const [ok, detail] = fn();
  check("\"" + s.quiz.q + "\" — the right answer (" + s.quiz.options[s.quiz.answer] + ") is what the model says", ok, detail);
}
// statements in the step texts that are not questions, checked too
{
  const pool = N.solve(stepParams(step("a-net-pool"))), top = ["central", "two", "both", "pilot", "wait"].reduce((a, b) => pool[b].npv > pool[a].npv + 1e-9 ? b : a);
  check("'Pooling pays': the text says one hub's spare capacity wins — the central hub is best", top === "central", top);
  const w = N.solve(stepParams(step("a-net-wait")));
  check("'Both markets uncertain': waiting is best", w.wait.npv > Math.max(w.central.npv, w.two.npv, w.both.npv, w.pilot.npv) + 0.5);
  const lease = M.solve(stepParams(step("i-lease"))), lt = ["full", "best", "defer", "stage", "lease"].reduce((a, b) => lease[b].npv > lease[a].npv ? b : a);
  check("'Volatile & flat': the lease step names the winner from the results; it is the lease, with break clauses worth something", lt === "lease" && lease.lease.npv > lease.lease.noBreak);
  const w2 = M.solve(stepParams(step("i-window"))), w12 = M.solve(Object.assign(stepParams(step("i-window")), { window: 12 }));
  check("'a longer window never lowers it': 2 years against 12", flex(w12) >= flex(w2), flex(w2).toFixed(2) + " → " + flex(w12).toFixed(2));
  const lat = M.lattice(M.merge(stepParams(step("a-lattice"))));
  check("'12% growth with 5% volatility needs finer steps, and the page says so'", lat.dt < 0.25 && lat.warnings.length === 1);
}

console.log(pass + "/" + (pass + fail) + " checks passed");
process.exit(fail ? 1 : 0);
