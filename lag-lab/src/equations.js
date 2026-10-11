// Lag Lab equations — every variable of the model with its equation, units and meaning, for the stock-and-flow
// diagram and the equation list. Equations are written with references: {id} is another variable, {p:key} a
// parameter. Each flow and auxiliary also carries calc(x, p), which recomputes it from the other variables at the
// same moment; the tests check calc against the model's own output, so what is published is what is computed.
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(require("./model.js"));
  else root.LagEquations = factory(root.LagLab);
})(typeof self !== "undefined" ? self : this, function (LagLab) {
  "use strict";
  var clamp = function (v, lo, hi) { return Math.min(hi, Math.max(lo, v)); };

  // kind: stock | flow | aux | exo. series: the model output column (null when the model does not report it).
  var VARS = [
    // ---- stocks
    { id: "backlog", name: "Backlog", kind: "stock", units: "units", series: "backlog",
      eq: "d/dt {backlog} = {demand} − {shipments}", init: "{p:targetDeliveryDelay} × initial demand",
      about: "Orders received and not yet shipped." },
    { id: "inventory", name: "Inventory", kind: "stock", units: "units", series: "inventory",
      eq: "d/dt {inventory} = {completions} − {shipments}", init: "{p:inventoryCoverage} × initial demand",
      about: "Finished goods ready to ship." },
    { id: "supplyLine", name: "Supply line", kind: "stock", units: "units", series: "supplyLine",
      eq: "d/dt {supplyLine} = {starts} − {completions}", init: "{p:productionLeadTime} × initial demand",
      about: "Work in the production pipeline. It is held in three equal stages, each emptying at 3 × stage / {p:productionLeadTime}: a third-order delay, so completions arrive spread around the lead time rather than all at once." },
    { id: "vacancies", name: "Vacancies", kind: "stock", units: "people", series: "vacancies",
      eq: "d/dt {vacancies} = {vacancyCreation} − {vacancyCancellation} − {hires}", init: "attrition × {p:hiringDelay}",
      about: "Open positions waiting to be filled." },
    { id: "trainees", name: "Trainees", kind: "stock", units: "people", series: "trainees",
      eq: "d/dt {trainees} = {hires} − {graduations}", init: "attrition × {p:trainingTime}",
      about: "Recruits still learning the job, working at {p:rookieProductivity} of full productivity." },
    { id: "workforce", name: "Workforce", kind: "stock", units: "people", series: "workforce",
      eq: "d/dt {workforce} = {graduations} − {attrition} − {layoffs}", init: "initial demand / ({p:productivity} × (1 + {p:rookieProductivity} × {p:trainingTime} / {p:averageTenure}))",
      about: "Experienced, fully productive people." },
    { id: "expectedDemand", name: "Expected demand", kind: "stock", units: "units/week", series: "expectedDemand",
      eq: function (p) { return p.forecast === "perfect" ? "{expectedDemand} = {demand}   (perfect forecast)" : "d/dt {expectedDemand} = {forecastChange}"; }, init: "initial demand",
      about: "The forecast: actual demand smoothed exponentially, so it follows a change with a lag of about {p:forecastTime}." },
    // ---- flows
    { id: "demand", name: "Orders (demand)", kind: "exo", units: "units/week", series: "demand",
      eq: function (p) { var d = p.demand; return d.type === "step" ? "{p:demand.base} before week {p:demand.at}; then {p:demand.base} × (1 + {p:demand.size})" : "the " + d.type + " demand pattern"; },
      about: "Customer orders: the input that drives everything else.",
      calc: function (x, p, t) { return LagLab.demandAt(p.demand, t); } },
    { id: "forecastChange", name: "Change in expected demand", kind: "flow", units: "units/week²", series: null,
      eq: "({demand} − {expectedDemand}) / {p:forecastTime}", about: "How fast the forecast catches up with demand." },
    { id: "shipments", name: "Shipments", kind: "flow", units: "units/week", series: "shipments",
      eq: "min({backlog} / {p:targetDeliveryDelay}, {inventory} / {p:minProcessingTime})",
      about: "Orders shipped: normally the backlog over the target delivery delay, but never more than inventory allows. Unfilled orders stay in the backlog.",
      calc: function (x, p) { return Math.min(x.backlog / p.targetDeliveryDelay, x.inventory / p.minProcessingTime); } },
    { id: "starts", name: "Production starts", kind: "flow", units: "units/week", series: "starts",
      eq: function (p) { return p.capacity === "unconstrained" ? "{desiredStarts}   (capacity unconstrained)" : "{capacity} × {utilisation}"; },
      about: "Work started: output follows the workforce, with working time flexing within the utilisation band.",
      calc: function (x, p) { return p.capacity === "unconstrained" ? x.desiredStarts : x.capacity * x.utilisation; } },
    { id: "completions", name: "Completions", kind: "flow", units: "units/week", series: "completions",
      eq: "3 × (third stage of {supplyLine}) / {p:productionLeadTime}",
      about: "Finished production entering inventory: the outflow of the third-order delay." },
    { id: "vacancyCreation", name: "Vacancy creation", kind: "flow", units: "people/week", series: "vacancyCreation",
      eq: "if {desiredHiring} ≥ 0: max(0, {desiredHiring} + {p:wV} × ({desiredVacancies} − {vacancies}) / {p:TAV}); otherwise 0",
      about: "Positions opened. With {p:wV} = 1 the open vacancies count fully; with 0 they are ignored.",
      calc: function (x, p) { if (x.desiredHiring < 0) return 0; return Math.max(0, x.desiredHiring + p.wV * (x.desiredVacancies - x.vacancies) / p.TAV); } },
    { id: "vacancyCancellation", name: "Vacancy cancellation", kind: "flow", units: "people/week", series: "vacancyCancellation",
      eq: "if {desiredHiring} ≥ 0: min({vacancies} / {p:TAV}, max(0, −({desiredHiring} + {p:wV} × ({desiredVacancies} − {vacancies}) / {p:TAV}))); otherwise {vacancies} / {p:TAV}",
      about: "Positions withdrawn when fewer people are wanted.",
      calc: function (x, p) { if (x.desiredHiring < 0) return x.vacancies / p.TAV; var w = x.desiredHiring + p.wV * (x.desiredVacancies - x.vacancies) / p.TAV; return w >= 0 ? 0 : Math.min(-w, x.vacancies / p.TAV); } },
    { id: "hires", name: "Hires", kind: "flow", units: "people/week", series: "hires",
      eq: "{vacancies} / {p:hiringDelay}", about: "Vacancies filled, after the hiring delay on average.",
      calc: function (x, p) { return x.vacancies / p.hiringDelay; } },
    { id: "graduations", name: "Graduations", kind: "flow", units: "people/week", series: "graduations",
      eq: "{trainees} / {p:trainingTime}", about: "Trainees becoming fully productive.",
      calc: function (x, p) { return x.trainees / p.trainingTime; } },
    { id: "attrition", name: "Attrition", kind: "flow", units: "people/week", series: "attrition",
      eq: "{workforce} / {p:averageTenure}", about: "People leaving of their own accord.",
      calc: function (x, p) { return x.workforce / p.averageTenure; } },
    { id: "layoffs", name: "Layoffs", kind: "flow", units: "people/week", series: "layoffs",
      eq: "if {desiredHiring} < 0: min(−{desiredHiring}, {workforce} / {p:TAW}); otherwise 0",
      about: "People let go beyond attrition when the workforce is above its target.",
      calc: function (x, p) { return x.desiredHiring < 0 ? Math.min(-x.desiredHiring, x.workforce / p.TAW) : 0; } },
    // ---- auxiliaries
    { id: "desiredInventory", name: "Desired inventory", kind: "aux", units: "units", series: "desiredInventory",
      eq: "{p:inventoryCoverage} × {expectedDemand}", about: "The inventory target: weeks of cover at expected demand.",
      calc: function (x, p) { return p.inventoryCoverage * x.expectedDemand; } },
    { id: "desiredSupplyLine", name: "Desired supply line", kind: "aux", units: "units", series: "desiredSupplyLine",
      eq: "{p:productionLeadTime} × {expectedDemand}", about: "The work that should be in the pipeline to deliver expected demand.",
      calc: function (x, p) { return p.productionLeadTime * x.expectedDemand; } },
    { id: "desiredStarts", name: "Desired starts", kind: "aux", units: "units/week", series: "desiredStarts",
      eq: "max(0, {expectedDemand} + ({desiredInventory} − {inventory}) / {p:TAI} + {p:wSL} × ({desiredSupplyLine} − {supplyLine}) / {p:TASL})",
      about: "The production start rule (anchor and adjust): expected demand, corrected for the inventory gap and, weighted by {p:wSL}, the supply-line gap.",
      calc: function (x, p) { return Math.max(0, x.expectedDemand + (x.desiredInventory - x.inventory) / p.TAI + p.wSL * (x.desiredSupplyLine - x.supplyLine) / p.TASL); } },
    { id: "effectiveWorkforce", name: "Effective workforce", kind: "aux", units: "people", series: "effectiveWorkforce",
      eq: "{workforce} + {p:rookieProductivity} × {trainees}", about: "Full-time equivalents of productive work.",
      calc: function (x, p) { return x.workforce + p.rookieProductivity * x.trainees; } },
    { id: "capacity", name: "Capacity", kind: "aux", units: "units/week", series: "capacity",
      eq: "{p:productivity} × {effectiveWorkforce}", about: "Output at normal working time.",
      calc: function (x, p) { return p.productivity * x.effectiveWorkforce; } },
    { id: "utilisation", name: "Utilisation", kind: "aux", units: "fraction", series: "utilisation",
      eq: "clamp({desiredStarts} / {capacity}, {p:uMin}, {p:uMax})", about: "Working time against normal: short-time working down to {p:uMin}, overtime up to {p:uMax}.",
      calc: function (x, p) { return p.capacity === "unconstrained" ? (x.capacity > 0 ? x.desiredStarts / x.capacity : 1) : clamp(x.desiredStarts / x.capacity, p.uMin, p.uMax); } },
    { id: "desiredWorkforce", name: "Desired workforce", kind: "aux", units: "people", series: "desiredWorkforce",
      eq: function (p) {
        return p.hiringDriver === "capacity" ? "{desiredStarts} / {p:productivity}   (hiring on the capacity gap)"
          : "max(0, {expectedDemand} + ({desiredInventory} − {inventory}) / {p:TAI}) / {p:productivity}   (hiring on the inventory gap)";
      },
      alt: function (p) {
        return p.hiringDriver === "capacity" ? "On the inventory gap it would be: max(0, {expectedDemand} + ({desiredInventory} − {inventory}) / {p:TAI}) / {p:productivity}, blind to the supply line."
          : "On the capacity gap it would be: {desiredStarts} / {p:productivity}, the capacity the production plan needs.";
      },
      about: "The workforce target. Which rule applies is the hiring-driver choice.",
      calc: function (x, p) { return p.hiringDriver === "capacity" ? x.desiredStarts / p.productivity : Math.max(0, x.expectedDemand + (x.desiredInventory - x.inventory) / p.TAI) / p.productivity; } },
    { id: "desiredHiring", name: "Desired hiring", kind: "aux", units: "people/week", series: "desiredHiring",
      eq: "{attrition} + ({desiredWorkforce} − {effectiveWorkforce}) / {p:TAW}",
      about: "The hiring rule (anchor and adjust): replace attrition and close the workforce gap over {p:TAW}. Negative means the workforce is too big.",
      calc: function (x, p) { return x.attrition + (x.desiredWorkforce - x.effectiveWorkforce) / p.TAW; } },
    { id: "desiredVacancies", name: "Desired vacancies", kind: "aux", units: "people", series: "desiredVacancies",
      eq: "max(0, {desiredHiring}) × {p:hiringDelay}", about: "The vacancies needed to sustain the desired hiring through the hiring delay.",
      calc: function (x, p) { return Math.max(0, x.desiredHiring) * p.hiringDelay; } }
  ];

  var PARAMS = [
    ["demand.base", "Demand before the step", "units/week"], ["demand.size", "Step size", "fraction"], ["demand.at", "Step time", "week"],
    ["productionLeadTime", "Production lead time", "weeks"], ["targetDeliveryDelay", "Target delivery delay", "weeks"], ["minProcessingTime", "Minimum order processing time", "weeks"],
    ["inventoryCoverage", "Inventory coverage", "weeks"], ["productivity", "Productivity", "units/person/week"], ["hiringDelay", "Hiring delay", "weeks"],
    ["trainingTime", "Training time", "weeks"], ["rookieProductivity", "Trainee relative productivity", "fraction"], ["averageTenure", "Average tenure", "weeks"],
    ["uMin", "Minimum utilisation", "fraction"], ["uMax", "Maximum utilisation", "fraction"],
    ["TAI", "Inventory adjustment time", "weeks"], ["TASL", "Supply-line adjustment time", "weeks"], ["wSL", "Supply-line weight", "0–1"],
    ["TAW", "Workforce adjustment time", "weeks"], ["TAV", "Vacancy adjustment time", "weeks"], ["wV", "Vacancy weight", "0–1"],
    ["forecastTime", "Forecast smoothing time", "weeks"], ["hiringDriver", "Hiring driver", "capacity or inventory"], ["forecast", "Forecast", "smooth or perfect"]
  ];
  var PARAM_LABEL = { "demand.base": "D₀", "demand.size": "step", "demand.at": "t_step", productionLeadTime: "lead time", targetDeliveryDelay: "delivery delay", minProcessingTime: "min processing time",
    inventoryCoverage: "coverage", productivity: "productivity", hiringDelay: "hiring delay", trainingTime: "training time", rookieProductivity: "ρ", averageTenure: "tenure",
    uMin: "u_min", uMax: "u_max", TAI: "TAI", TASL: "TASL", wSL: "w_SL", TAW: "TAW", TAV: "TAV", wV: "w_V", forecastTime: "forecast time" };

  var BY_ID = {}; VARS.forEach(function (v) { BY_ID[v.id] = v; });
  function paramValue(p, key) { var k = key.split("."); return k.length === 2 ? p[k[0]][k[1]] : p[k[0]]; }
  function equation(v, p) { return typeof v.eq === "function" ? v.eq(p) : v.eq; }
  // the variables an equation reads (for the diagram's arrows); a stock's equation names its flows, drawn as pipes
  function inputs(id, p) {
    var v = BY_ID[id], seen = {}, out = [];
    (equation(v, p).match(/\{([a-zA-Z]+)\}/g) || []).forEach(function (m) {
      var r = m.slice(1, -1); if (r !== id && BY_ID[r] && !seen[r]) { seen[r] = 1; out.push(r); }
    });
    return out;
  }
  function params(id, p) {
    var v = BY_ID[id], txt = equation(v, p) + " " + (v.about || "") + " " + (v.init || ""), seen = {}, out = [];
    (txt.match(/\{p:([a-zA-Z.]+)\}/g) || []).forEach(function (m) { var k = m.slice(3, -1); if (!seen[k]) { seen[k] = 1; out.push(k); } });
    return out;
  }
  return { VARS: VARS, BY_ID: BY_ID, PARAMS: PARAMS, PARAM_LABEL: PARAM_LABEL, equation: equation, inputs: inputs, params: params, paramValue: paramValue };
});
