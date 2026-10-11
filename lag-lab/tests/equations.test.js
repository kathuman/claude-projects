// Lag Lab equation checks — run with: node lag-lab/tests/equations.test.js
// Every published flow and auxiliary equation, recomputed from the other variables at the same moment, must equal the
// model's own output at every week, for every policy combination. So the diagram's equations are the model's.
const L = require("../src/model.js"), EQ = require("../src/equations.js");
let pass = 0, fail = 0;
function check(name, cond, detail) { if (cond) pass++; else fail++; if (!cond || process.env.VERBOSE) console.log((cond ? "ok   " : "FAIL ") + name + (detail !== undefined ? "  → " + detail : "")); }

check("every variable has a name, kind, units, equation and meaning", EQ.VARS.every((v) => v.name && ["stock", "flow", "aux", "exo"].includes(v.kind) && v.units && v.eq && v.about));
check("every reference in an equation names a known variable or parameter", EQ.VARS.every((v) => {
  const p = L.defaults(), txt = EQ.equation(v, p) + (v.init || "") + v.about + (v.alt ? v.alt(p) : "");
  return (txt.match(/\{([a-zA-Z]+)\}/g) || []).every((m) => EQ.BY_ID[m.slice(1, -1)]) && (txt.match(/\{p:([a-zA-Z.]+)\}/g) || []).every((m) => EQ.paramValue(p, m.slice(3, -1)) !== undefined);
}));
check("every model output column is described by an equation", L.SERIES.every((s) => EQ.VARS.some((v) => v.series === s)), L.SERIES.filter((s) => !EQ.VARS.some((v) => v.series === s)).join(", "));
check("every parameter the model uses is in the parameter list", Object.keys(L.defaults()).filter((k) => !["demand", "capacity", "horizon", "dt"].includes(k)).every((k) => EQ.PARAMS.some((q) => q[0] === k)));
check("stocks name their inflows and outflows", ["backlog", "inventory", "supplyLine", "vacancies", "trainees", "workforce"].every((id) => EQ.inputs(id, L.defaults()).length >= 2));

// the published equations reproduce the model, week by week, across policies and demand changes
let worst = 0, n = 0, where = "";
const combos = [];
for (const hiringDriver of ["inventory", "capacity"]) for (const forecast of ["smooth", "perfect"]) for (const capacity of ["workforce", "unconstrained"]) for (const w of [0, 0.5, 1])
  combos.push({ hiringDriver, forecast, capacity, wSL: w, wV: w });
combos.push({ demand: { size: -0.4 } }, { demand: { size: 1 }, wSL: 0, TAI: 2 }, { demand: { type: "pulse", size: 2, length: 3 } });
for (const p0 of combos) {
  const r = L.simulate(Object.assign({ horizon: 156 }, p0)), p = r.params;
  for (let i = 0; i < r.t.length; i++) {
    const x = {}; L.SERIES.forEach((s) => { x[s] = r[s][i]; });
    for (const v of EQ.VARS) {
      if (!v.calc || !v.series) continue;
      const got = v.calc(x, p, r.t[i]), want = r[v.series][i], err = Math.abs(got - want) / Math.max(1, Math.abs(want));
      if (err > worst) { worst = err; where = v.id + " at week " + r.t[i] + " " + JSON.stringify(p0); }
      n++;
    }
  }
}
check("each published equation reproduces the model's value at every week (" + n.toLocaleString() + " comparisons, " + combos.length + " runs)", worst < 1e-12, worst.toExponential(2) + " " + where);
const checked = EQ.VARS.filter((v) => v.calc && v.series).length, flowsAux = EQ.VARS.filter((v) => v.kind !== "stock").length;
check("all but the delay's internal outflow and the forecast's rate are checked this way (" + checked + " of " + flowsAux + ")", checked >= flowsAux - 2, EQ.VARS.filter((v) => v.kind !== "stock" && !(v.calc && v.series)).map((v) => v.id).join(", "));

// the two unchecked ones are covered by conservation (completions) and the smoothing test (forecast change); and the
// stock equations by the model tests' exact balances. Here: the forecast change equation integrates to the forecast
{
  const r = L.simulate({ dt: 0.01, horizon: 30 }), p = r.params; let w2 = 0;
  for (let i = 0; i + 1 < r.t.length; i++) {
    const rate = (r.demand[i] - r.expectedDemand[i]) / p.forecastTime;      // the published forecastChange
    // over one week with dt = 0.01, Euler steps of the published rate reproduce the next week's forecast
    let f = r.expectedDemand[i]; for (let k = 0; k < 100; k++) f += (L.demandAt(p.demand, r.t[i] + k * 0.01) - f) / p.forecastTime * 0.01;
    w2 = Math.max(w2, Math.abs(f - r.expectedDemand[i + 1]));
  }
  check("the change-in-expected-demand equation, integrated, reproduces the model's forecast", w2 < 1e-9, w2.toExponential(2));
}

console.log(pass + "/" + (pass + fail) + " checks passed");
process.exit(fail ? 1 : 0);
