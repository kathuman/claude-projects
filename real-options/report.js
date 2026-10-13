// Real Options for Network Design — the decision report for one scenario (taken from the address, as the app writes
// it). Everything is recomputed here with src/model.js; nothing is passed from the app but the scenario.
(function () {
  "use strict";
  var M = window.RealOptions, S = window.ROSpecs.single, SPECS = S.SPECS, GROUPS = S.GROUPS;
  var I18 = window.ROi18n, T = I18.T, tw = I18.tw;
  var $ = function (id) { return document.getElementById(id); };
  $("ver").textContent = "v" + M.VERSION; $("ver-foot").textContent = "v" + M.VERSION;
  var NAMES = { full: T("Commit now"), best: T("Best fixed"), defer: T("Wait & see"), stage: T("Stage & expand"), lease: T("Lease & break") };
  var KEYS = ["full", "best", "defer", "stage", "lease"], FLEX = ["defer", "stage", "lease"];

  // ---- the scenario
  var state = { basis: "wacc" }, name = "", hash = location.hash || "";
  Object.keys(SPECS).forEach(function (k) { state[k] = SPECS[k].def; });
  hash.replace(/^#/, "").split("&").forEach(function (kv) {
    var a = kv.split("="), k = a[0], v = decodeURIComponent(a[1] || "");
    if (SPECS[k] && isFinite(parseFloat(v))) state[k] = parseFloat(v);
    else if (k === "basis" && (v === "rn" || v === "wacc")) state.basis = v;
    else if (k === "name") name = v;
    else if (k === "preset" && !name) name = T(v);
  });
  var appLink = I18.withLang("index.html") + hash.replace(/&?name=[^&]*/, "");
  $("backLink").href = appLink;
  $("printBtn").addEventListener("click", function () { window.print(); });
  function params(over) { var p = { basis: state.basis }; Object.keys(SPECS).forEach(function (k) { p[k] = state[k] * (SPECS[k].scale || 1); }); Object.keys(over || {}).forEach(function (k) { p[k] = over[k]; }); return p; }

  setTimeout(build, 30);
  function build() {
    var sol = M.solve(params()), sim = M.simulate(sol, 4000, 21), p = sol.params, L = sol.lattice;
    var stats = {}; KEYS.forEach(function (k) { var a = sim.map(function (r) { return r[k]; }).sort(function (x, y) { return x - y; }); stats[k] = { p5: a[Math.floor(0.05 * (a.length - 1))], p95: a[Math.floor(0.95 * (a.length - 1))], loss: a.filter(function (v) { return v < 0; }).length / a.length }; });
    var top = KEYS.reduce(function (a, b) { return sol[b].npv > sol[a].npv ? b : a; });
    var bf = FLEX.reduce(function (a, b) { return sol[b].npv > sol[a].npv ? b : a; }), flex = sol[bf].npv - sol.best.npv;
    var tr = triggers(sol);
    var basis = state.basis === "rn" ? T("risk-neutral valuation") : T("expected cash flows at a {w} WACC", { w: SPECS.wacc.fmt(state.wacc) });
    var h = "";
    h += "<header class='rep-head'><p class='eyebrow'>" + T("Decision report · Real Options for Network Design v{v}", { v: M.VERSION }) + "</p><h1>" + esc(name || T("Network design scenario")) + "</h1>" +
      "<p class='rep-meta'>" + T("Prepared {date} · demand today {D}, volatility {s}, growth {g} · {basis}", { date: new Date().toISOString().slice(0, 10), D: SPECS.D0.fmt(state.D0), s: SPECS.sigma.fmt(state.sigma), g: SPECS.g.fmt(state.g), basis: basis }) + "</p></header>";
    // 1. recommendation
    h += "<section><h2>" + T("1. Recommendation") + "</h2><div class='rep-rec'><div class='rep-il'>" + (window.ROIllus ? window.ROIllus.svg("strategy:" + top) : "") + "</div><p class='rep-big'>" + NAMES[top] + " <span>" + money(sol[top].npv) + "</span></p><p>" + recommendation(sol, top, tr) + "</p>" +
      "<p>" + (flex > 0.05 ? T("The value of flexibility is <b>{f}</b>: the best flexible strategy ({name}) against the best fixed design. Against committing to the full footprint now it is {vs}; most studies quote that larger number.", { f: money(flex), name: NAMES[bf], vs: money(sol[bf].npv - sol.full.npv) }) :
        T("Flexibility does not pay in this scenario: the best fixed design beats every flexible strategy by {f}.", { f: money(-flex) })) + "</p>" +
      "<p>" + T("Risk of the recommended strategy: a loss on {p}% of simulated demand paths; 90% of outcomes between {a} and {b}.", { p: Math.round(100 * stats[top].loss), a: money(stats[top].p5), b: money(stats[top].p95) }) + "</p></div></section>";
    // 2. strategies
    h += "<section><h2>" + T("2. The strategies compared") + "</h2><table class='data rep-table'><tr><th>" + T("Strategy") + "</th><th class='txt'>" + T("What it does") + "</th><th>" + T("NPV") + "</th><th>" + T("5th percentile") + "</th><th>" + T("P(loss)") + "</th></tr>" +
      KEYS.map(function (k) { return "<tr" + (k === top ? " class='top'" : "") + "><td>" + NAMES[k] + "</td><td class='txt'>" + describe(sol, k) + "</td><td>" + money(sol[k].npv) + "</td><td>" + money(stats[k].p5) + "</td><td>" + Math.round(100 * stats[k].loss) + "%</td></tr>"; }).join("") +
      "</table><p class='hint'>" + T("NPV is the lattice value of each strategy's optimal policy; percentiles and P(loss) are from 4,000 simulated demand paths following the same policies.") + "</p></section>";
    // 3. triggers
    h += "<section><h2>" + T("3. Decision triggers") + "</h2><p>" + T("The demand levels (thousand units a year) at which each decision becomes worth taking. A dash means the decision is not taken at any demand level in that year.") + "</p>" +
      "<table class='data rep-table'><tr><th>" + T("Year") + "</th><th>" + T("Wait & see: build above") + "</th><th>" + T("Stage & expand: first step above") + "</th><th>" + T("Best fixed: sell below") + "</th>" + (p.moth ? "<th>" + T("Best fixed: mothball below") + "</th><th>" + T("…restart above") + "</th>" : "") + "</tr>" +
      tr.rows.map(function (r) { return "<tr><td>" + r.year + "</td><td>" + f0(r.build) + "</td><td>" + f0(r.expand) + "</td><td>" + f0(r.sell) + "</td>" + (p.moth ? "<td>" + f0(r.idle) + "</td><td>" + f0(r.restart) + "</td>" : "") + "</tr>"; }).join("") + "</table>" +
      (tr.breaks.length ? "<p>" + T("Lease break dates: {list}.", { list: tr.breaks.map(function (b) { return b.D !== null ? T("year {y} (hand back below {D}k)", { y: b.year, D: b.D.toFixed(0) }) : T("year {y} (keep the lease)", { y: b.year }); }).join(", ") }) + "</p>" : "") +
      "<p class='hint'>" + T("Building and expanding are possible only inside the decision window ({w}); selling, mothballing and lease breaks at any time or at the break dates.", { w: SPECS.window.fmt(state.window) }) + "</p></section>";
    // 4. sensitivity
    var sens = sensitivity(flex);
    h += "<section><h2>" + T("4. What the value of flexibility depends on") + "</h2><p>" + T("Each assumption moved down and up, everything else as set; the change in the value of flexibility (now {f}). Pin down the first rows before committing.", { f: money(flex, true) }) + "</p>" +
      "<table class='data rep-table'><tr><th>" + T("Assumption") + "</th><th>" + T("Lower") + "</th><th>" + T("Effect") + "</th><th>" + T("Higher") + "</th><th>" + T("Effect") + "</th></tr>" +
      sens.slice(0, 6).map(function (r) { return "<tr><td>" + r.name + "</td><td>" + r.fmt(r.lo) + "</td><td>" + money(r.dlo, true) + "</td><td>" + r.fmt(r.hi) + "</td><td>" + money(r.dhi, true) + "</td></tr>"; }).join("") + "</table></section>";
    // 5. assumptions
    h += "<section><h2>" + T("5. Assumptions") + "</h2><div class='rep-assume'>" + GROUPS.map(function (g) {
      return "<div><h3>" + g.name + "</h3><table class='data'>" + g.items.filter(function (it) { return !it.only || it.only === state.basis; }).filter(function (it) { return !it.needs || state[it.needs]; }).map(function (it) {
        var v = state[it.id], d = v === it.def; return "<tr><td>" + it.label + "</td><td" + (d ? "" : " class='chg'") + ">" + (it.check ? (v ? T("yes") : T("no")) : it.fmt(v)) + "</td></tr>"; }).join("") + "</table></div>"; }).join("") +
      "</div><p class='hint'>" + T("Values that differ from the app's defaults are highlighted. Lattice: {step} steps, {n} steps over the asset life; drift {g}%/yr; discount rate {r}%/yr.", { step: stepName(L.dt), n: L.N, g: (L.g * 100).toFixed(2), r: (L.r * 100).toFixed(2) }) + "</p>" +
      (L.warnings.length ? "<p class='warn'>" + L.warnings.map(tw).join(" ") + "</p>" : "") + "</section>";
    // 6. method
    h += "<section><h2>" + T("6. Method and limits") + "</h2><p>" + (p.moth ? T("Demand follows a recombining binomial lattice whose expected growth equals the growth set. Each strategy's optimal policy is found by backward induction, with build and expansion lead times; unmet demand goes to a 3PL up to a limit and the rest is lost with a penalty, for every strategy alike. Owned sites can be sold for a declining resale value, or mothballed and restarted; the lease can be broken at its break dates. The value of flexibility is measured against the best fixed design. The engine is checked by automated tests, including convergence to Black–Scholes and a Monte Carlo replay of every policy.") :
      T("Demand follows a recombining binomial lattice whose expected growth equals the growth set. Each strategy's optimal policy is found by backward induction, with build and expansion lead times; unmet demand goes to a 3PL up to a limit and the rest is lost with a penalty, for every strategy alike. Owned sites can be sold for a declining resale value; the lease can be broken at its break dates. The value of flexibility is measured against the best fixed design. The engine is checked by automated tests, including convergence to Black–Scholes and a Monte Carlo replay of every policy.")) + "</p>" +
      "<p>" + T("Limits: one facility and one product (a two-region network is on the app's Network page); no competition or correlated cost risks; the staging premium stands for all the extra costs of building twice. Read the results as the direction and rough size of the flexibility premium, and the triggers, not as a project appraisal.") + "</p>" +
      "<p class='hint'>" + T("Scenario link: <a href='{href}'>open in the app</a>. Synthetic, illustrative model — not investment advice.", { href: esc(appLink) }) + "</p></section>";
    $("report").innerHTML = h;
    document.title = (name ? name + " — " : "") + T("Decision Report — Real Options for Network Design");
  }

  function recommendation(sol, top, tr) {
    var p = sol.params, first = function (key) { var r = tr.rows.find(function (x) { return x[key] !== null; }); return r || null; };
    if (top === "stage") { var e = first("expand"); return T("Build the initial stage of {K}k units now, on a site that can grow to {Kbig}k.", { K: sol.levels[0].toFixed(0), Kbig: sol.Kbig.toFixed(0) }) + " " + (e ? T("Add the first step when demand passes about {D}k (possible from year {y}).", { D: e.expand.toFixed(0), y: e.year }) : T("Expansions are not expected to pay at any demand level in the window.")); }
    if (top === "defer") { var b = first("build"); return T("Do not build yet: serve demand through a 3PL and keep the site option open.") + " " + (b ? T("Build the full {K}k site when demand passes about {D}k (from year {y}).", { K: sol.Kbig.toFixed(0), D: b.build.toFixed(0), y: b.year }) : T("No build is expected to pay inside the window.")); }
    if (top === "lease") { var br = tr.breaks.find(function (x) { return x.D !== null; }); return T("Lease {K}k units with the break clauses rather than building.", { K: sol.lease.K.toFixed(0) }) + " " + (br ? T("At the break in year {y}, hand the space back if demand is below about {D}k.", { y: br.year, D: br.D.toFixed(0) }) : T("The breaks are not expected to be used.")); }
    if (top === "best") return T("Build {K}k units now and keep the design simple: in this scenario no designed-in option pays for itself.", { K: sol.best.K.toFixed(0) }) + (p.salvF > 0 ? " " + T("Keep the building generic so that it can be sold if demand collapses.") : "");
    return T("Commit now to the full {K}k footprint.", { K: sol.Kbig.toFixed(0) });
  }
  function describe(sol, k) {
    return { full: T("Build the full {K}k units now", { K: sol.Kbig.toFixed(0) }), best: T("Build {K}k units now (the best fixed size)", { K: sol.best.K.toFixed(0) }), defer: T("3PL now; build {K}k once, inside the window", { K: sol.Kbig.toFixed(0) }),
      stage: T("Build {K}k now; add steps up to {Kbig}k", { K: sol.levels[0].toFixed(0), Kbig: sol.Kbig.toFixed(0) }), lease: T("Lease {K}k units with break clauses", { K: sol.lease.K.toFixed(0) }) }[k];
  }
  // demand thresholds by year, read off the policies (the same reading as the app's decision map)
  function triggers(sol) {
    var p = sol.params, L = sol.lattice, rows = [];
    var edge = function (t, i) { return i === 0 ? M.demand(p, L, t, 0) : Math.min(p.D0 * Math.pow(L.u, 2 * i - t - 1), p.ceiling * p.D0); };
    var topEdge = function (ex, t, code) { for (var i = t; i >= 0; i--) if (ex[t][i] === code) return i === t ? M.demand(p, L, t, t) : Math.min(p.D0 * Math.pow(L.u, 2 * i - t + 1), p.ceiling * p.D0); return null; };
    var per = Math.round(1 / L.dt);
    for (var y = 0; y < p.life; y += y < Math.min(p.window, p.life) ? 1 : 2) {
      var t = Math.min(L.N - 1, y * per), r = { year: y, build: null, expand: null, sell: null, idle: null, restart: null }, i;
      if (t <= L.W) {
        for (i = 0; i <= t; i++) if (sol.defer.build[t][i]) { r.build = edge(t, i); break; }
        if (t >= L.Lb) for (i = 0; i <= t; i++) { var c = sol.stage.pol[t][0][i]; if (c > 0 && c < 254) { r.expand = edge(t, i); break; } }
      }
      if (sol.Rbest.ex && t >= L.Lb) {
        r.sell = topEdge(sol.Rbest.ex, t, 1); r.idle = topEdge(sol.Rbest.ex, t, 2);
        if (r.idle !== null) for (i = 0; i <= t; i++) if (sol.Rbest.exB[t][i] === 3) { r.restart = edge(t, i); break; }
      }
      rows.push(r);
    }
    var breaks = Object.keys(sol.lease.breaks).map(Number).map(function (tb) { return { year: +(tb * L.dt).toFixed(2), D: topEdge(sol.lease.R.ex, tb, 1) }; });
    return { rows: rows, breaks: breaks };
  }
  function sensitivity(f0) {
    var yr = function (v) { return T("{v} years", { v: v }); }, unit = function (v) { return T("${v}/unit", { v: (v * 1000).toFixed(0) }); };
    var base = params(), LIST = [
      [T("Volatility"), "sigma", function (v) { return [v * 0.6, v * 1.4]; }, function (v) { return Math.round(v * 100) + "%"; }],
      [T("Expected growth"), "g", function (v) { return [v - 0.02, v + 0.02]; }, function (v) { return (v * 100).toFixed(1) + "%"; }],
      [T("Decision window"), "window", function (v) { return [Math.max(1, v - 3), Math.min(base.life, v + 3)]; }, yr],
      [T("Build lead time"), "buildLead", function (v) { return [Math.max(0, v - 0.75), v + 0.75]; }, yr],
      [T("Margin, own network"), "margin", function (v) { return [v * 0.8, v * 1.2]; }, unit],
      [T("Penalty, lost sale"), "penalty", function (v) { return [v * 0.5, v * 1.5]; }, unit],
      [T("Outsourcing limit"), "outCap", function (v) { return [Math.max(0, v - 0.5), v + 0.5]; }, function (v) { return Math.round(v * 100) + "%"; }],
      [T("Staging premium"), "premium", function (v) { return [Math.max(0, v - 0.15), v + 0.15]; }, function (v) { return Math.round(v * 100) + "%"; }],
      [T("Resale value"), "salvF", function (v) { return [Math.max(0, v - 0.2), v + 0.2]; }, function (v) { return Math.round(v * 100) + "%"; }],
      [T("Lease rent"), "rent", function (v) { return [v * 0.85, v * 1.15]; }, function (v) { return "$" + (v * 1000).toFixed(2); }],
      [T("Holding cost of capacity"), "opcost", function (v) { return [v * 0.7, v * 1.3]; }, function (v) { return "$" + (v * 1000).toFixed(1); }]
    ];
    var flexOf = function (s) { return Math.max(s.defer.npv, s.stage.npv, s.lease.npv) - s.best.npv; };
    return LIST.map(function (t) {
      var lh = t[2](base[t[1]]), d = lh.map(function (v) { var o = {}; o[t[1]] = v; return flexOf(M.solve(params(o))) - f0; });
      return { name: t[0], lo: lh[0], hi: lh[1], dlo: d[0], dhi: d[1], fmt: t[3] };
    }).sort(function (a, b) { return Math.max(Math.abs(b.dlo), Math.abs(b.dhi)) - Math.max(Math.abs(a.dlo), Math.abs(a.dhi)); });
  }
  function stepName(dt) { return dt === 0.25 ? T("quarterly") : Math.abs(dt - 1 / 12) < 1e-9 ? T("monthly") : T("weekly"); }
  function money(v, sign) { return (sign && v > 0 ? "+" : v < 0 ? "−" : "") + "$" + Math.abs(v).toFixed(1) + "M"; }
  function f0(v) { return v === null ? "—" : T("{v}k", { v: v.toFixed(0) }); }
  function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
})();
