// Clockspeed Balancing — the cockpit. You set the three strategies each quarter and advance the clock; the
// instruments, advisories, lag radar and history charts show what the model does with it.
// Version history:
//   1.0.0  launch: briefing with six scenarios; the cockpit — commercial, product supply chain and network levers
//          (each showing what is already in effect), quarterly and yearly advance, undo, autosave, save/load files;
//          gauges, fit bars, advisories, a lag radar of decisions still in flight, the regions, six history charts
//          with hover read-outs, and an end-of-flight comparison with holding the starting course
//   1.1.0  debrief at landing: the flight replayed with one level moving at a time, what each clock made or cost alone,
//          what moving them together added (alignment), fair Shapley shares, and a timeline of each decision against
//          when it took effect; the settled starting state is computed once, so undo and replay are about 8× faster
(function () {
  "use strict";
  var VERSION = "1.1.0";
  var C = window.Clockspeed, $ = function (id) { return document.getElementById(id); };
  $("ver").textContent = "v" + VERSION; $("ver-foot").textContent = "v" + VERSION;
  var SAVE = "clockspeed-save-v1";
  var COL = { s1: "#1f9fd8", s2: "#c7820c", s3: "#e0558f", s4: "#4f9f15", com: "#e0558f", psc: "#c7820c", net: "#1f9fd8", faint: "#6fa8c9", line: "#2a5580", ink: "#e6f3ff", good: "#3ddc97", warn: "#ffcf4a", bad: "#ff8a7a" };
  var P = C.defaults(), D0 = C.decisions0(P);
  var game = null, sim = null, cur = null, log = [], startRow = null, chosen = "calm";

  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
  function fmtK(x) { var a = Math.abs(x); return (x < 0 ? "−" : "") + (a >= 1e6 ? (a / 1e6).toFixed(2) + "M" : a >= 1e3 ? (a / 1e3).toFixed(a >= 1e5 ? 0 : 1) + "k" : a.toFixed(0)); }
  function pct(x, d) { return (x * 100).toFixed(d == null ? 0 : d) + "%"; }
  function when(q) { var y = Math.floor(q / 4) + 1, qq = q % 4 + 1; return "Y" + y + " Q" + qq; }
  function save() { try { localStorage.setItem(SAVE, JSON.stringify({ scenario: game.scenario, decisions: game.decisions })); } catch (e) { /* private mode */ } }
  function loadSaved() { try { var s = JSON.parse(localStorage.getItem(SAVE) || "null"); return s && C.SCENARIOS[s.scenario] && Array.isArray(s.decisions) ? s : null; } catch (e) { return null; } }

  // ---- briefing
  $("scenarios").innerHTML = Object.keys(C.SCENARIOS).map(function (k) { var s = C.SCENARIOS[k]; return '<button type="button" class="scn" data-k="' + k + '" aria-pressed="' + (k === chosen) + '"><b>' + esc(s.name) + "</b><span>" + esc(s.about) + "</span></button>"; }).join("");
  $("scenarios").addEventListener("click", function (e) { var b = e.target.closest(".scn"); if (!b) return; chosen = b.dataset.k; document.querySelectorAll(".scn").forEach(function (x) { x.setAttribute("aria-pressed", String(x === b)); }); });
  $("btn-takeoff").addEventListener("click", function () { start(chosen, []); });
  var saved = loadSaved();
  if (saved && saved.decisions.length) {
    $("resume").hidden = false;
    $("resume").innerHTML = 'or <button class="btn small" id="btn-resume" type="button">Resume your flight</button> (' + esc(C.SCENARIOS[saved.scenario].name) + ", " + when(saved.decisions.length) + ")";
    $("btn-resume").addEventListener("click", function () { start(saved.scenario, saved.decisions); });
  }
  $("btn-newgame").addEventListener("click", function () { $("cockpit").hidden = true; $("briefing").hidden = false; $("btn-newgame").hidden = true; window.scrollTo(0, 0); });

  // ---- a flight: rebuild by replaying its decisions (the model is deterministic)
  function start(scenario, decisions) {
    game = { scenario: scenario, decisions: [] }; log = []; active = {}; arrived = {};
    sim = C.create({}, scenario);
    startRow = null;
    decisions.slice(0, P.quarters).forEach(function (d) { stepQuarter(d, true); });
    cur = sim.decisions();
    $("briefing").hidden = true; $("cockpit").hidden = false; $("btn-newgame").hidden = false;
    buildYoke(); render(); save(); window.scrollTo(0, 0);
  }
  function stepQuarter(d, quiet) {
    var prevRow = sim.history.months.length ? sim.history.months[sim.history.months.length - 1] : null, q = sim.state.q;
    var prevState = { K: C.clone(sim.state.K), pipe: C.clone(sim.state.pipe) };
    var row = sim.quarter(d);
    if (!startRow) startRow = sim.history.months[0];
    game.decisions.push(C.clone(d));
    advise(q, prevRow, row, prevState, d);
    return row;
  }
  function advance(n) {
    for (var i = 0; i < n && !sim.done(); i++) { stepQuarter(cur); cur = sim.decisions(); }
    save(); syncYoke(); render();
  }
  $("btn-advance").addEventListener("click", function () { advance(1); });
  $("btn-advance4").addEventListener("click", function () { advance(4); });
  $("btn-toend").addEventListener("click", function () { advance(P.quarters); });
  $("btn-undo").addEventListener("click", function () {
    if (!game.decisions.length) return;
    var ds = game.decisions.slice(0, -1), last = game.decisions[game.decisions.length - 1];
    start(game.scenario, ds); cur = C.clone(last); syncYoke(); render();
  });
  $("btn-export").addEventListener("click", function () {
    var blob = new Blob([JSON.stringify({ app: "Clockspeed Balancing", version: VERSION, scenario: game.scenario, decisions: game.decisions }, null, 1)], { type: "application/json" });
    var a = document.createElement("a"), url = URL.createObjectURL(blob); a.href = url; a.download = "clockspeed-" + game.scenario + "-" + when(game.decisions.length).replace(" ", "") + ".json";
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
  });
  $("in-load").addEventListener("change", function () {
    var f = this.files[0]; if (!f) return;
    // FileReader rather than Blob.text(): it works in every browser that runs the cockpit, including older Safari
    new Promise(function (ok, no) { var r = new FileReader(); r.onload = function () { ok(String(r.result)); }; r.onerror = function () { no(new Error("the file could not be read")); }; r.readAsText(f); }).then(function (t) {
      var o = JSON.parse(t);
      if (!o || !C.SCENARIOS[o.scenario] || !Array.isArray(o.decisions)) throw new Error("not a Clockspeed flight file");
      start(o.scenario, o.decisions.map(function (d) { return C.clampDecisions(merge(C.decisions0(P), d)); }));
    }).catch(function (e) { addLog(sim ? sim.state.q : 0, "bad", "Could not load that file: " + e.message); renderAdvice(); });
    this.value = "";
  });
  // only known fields, as numbers, are taken from a loaded file
  function merge(base, d) {
    ["commercial", "product", "network"].forEach(function (g) { var a = base[g], b = d && d[g]; if (!b) return; Object.keys(a).forEach(function (k) { if (typeof a[k] === "object") { Object.keys(a[k]).forEach(function (j) { if (b[k] && isFinite(+b[k][j])) a[k][j] = +b[k][j]; }); } else if (isFinite(+b[k])) a[k] = +b[k]; }); });
    return base;
  }

  // ---- the yoke: decisions, grouped by clock speed, each showing what is already in effect
  var CTL = [];   // [path, label, min, max, step, fmt, actualFn]
  function buildYoke() {
    var y = $("yoke"), steady = D0.commercial.launches;
    var slider = function (path, label, min, max, step, fmt, actual) {
      CTL.push([path, label, min, max, step, fmt, actual]);
      var id = "in-" + path.replace(/\./g, "-");
      return '<div class="ctl"><div class="row"><label for="' + id + '">' + label + '</label><output id="' + id + '-o"></output></div><input type="range" id="' + id + '" min="' + min + '" max="' + max + '" step="' + step + '" data-path="' + path + '" />' + (actual ? '<div class="actual" id="' + id + '-a"></div>' : "") + "</div>";
    };
    CTL = [];
    var mult = function (v) { return "×" + (+v).toFixed(2); };
    var pairRow = function (title, base, min, max, step, fmt, actual) {
      return '<div class="ctl-title">' + title + '</div><div class="pair">' + ["F", "I"].map(function (s) { return slider(base + "." + s, s === "F" ? "Functional" : "Innovative", min, max, step, fmt, actual ? function () { return actual(s); } : null); }).join("") + "</div>";
    };
    var h = '<div class="lever-group" style="border-color:var(--com)"><h3>Commercial strategy</h3><div class="speed">takes effect in months</div>' +
      pairRow("Price", "commercial.price", 0.7, 1.4, 0.01, mult) +
      pairRow("Service promise (delivery speed)", "commercial.promise", 0.6, 1.6, 0.05, mult, function (s) { return "customers expect " + mult(sim.state.expPromise[s]); }) +
      slider("commercial.promo", "Promotion intensity", 0, 1, 0.05, function (v) { return pct(v); }) +
      pairRow("Product launches per quarter", "commercial.launches", 0, 45, 0.5, function (v) { return (+v).toFixed(1); }, function (s) { return sim.state.range[s].toFixed(0) + " SKUs · steady " + steady[s].toFixed(1); }) +
      pairRow("Range rationalisation", "commercial.rationalize", 0, 0.5, 0.05, function (v) { return pct(v) + "/yr"; }) +
      '<div class="ctl"><div class="row"><span>Markets served</span></div><div class="regions-in" id="presence">' + C.REG.map(function (r) { return '<button type="button" data-r="' + r + '">' + C.REG_NAME[r] + "</button>"; }).join("") + '</div><div class="actual" id="presence-a"></div></div></div>';
    h += '<div class="lever-group" style="border-color:var(--psc)"><h3>Product supply chain</h3><div class="speed">takes effect in about a year</div>' +
      ["coverage", "flex", "dual"].map(function (lv) {
        var lab = { coverage: "Inventory cover", flex: "Flexible capacity", dual: "Dual sourcing" }[lv], f = lv === "coverage" ? function (v) { return (+v).toFixed(1) + " wk"; } : function (v) { return pct(v); };
        var mx = { coverage: 12, flex: 0.5, dual: 1 }[lv], mn = { coverage: 0.5, flex: 0, dual: 0 }[lv], stp = { coverage: 0.5, flex: 0.01, dual: 0.05 }[lv];
        return pairRow(lab, "product." + lv, mn, mx, stp, f, function (s) { return "in effect: " + f(sim.state[lv === "coverage" ? "cov" : lv][s]); });
      }).join("") + "</div>";
    h += '<div class="lever-group" style="border-color:var(--net)"><h3>Network</h3><div class="speed">takes effect in years · build 30 months, close 12</div>' +
      '<table class="net"><thead><tr><th>Region</th><th>Capacity</th><th>Building</th><th>Order</th><th>Close</th></tr></thead><tbody>' +
      C.REG.map(function (r) { return '<tr><td>' + C.REG_NAME[r] + '</td><td id="k-' + r + '"></td><td id="b-' + r + '"></td><td><input type="number" min="0" max="400" step="10" data-net="expand" data-r="' + r + '" aria-label="Order new capacity in ' + C.REG_NAME[r] + '" /></td><td><input type="number" min="0" max="400" step="10" data-net="close" data-r="' + r + '" aria-label="Close capacity in ' + C.REG_NAME[r] + '" /></td></tr>'; }).join("") +
      '</tbody></table><div class="actual" style="margin-top:6px;">Order and Close are one-off for this quarter, in units per month of capacity. Closing writes off book value and costs severance.</div>' +
      '<div class="ctl-title" style="margin-top:10px;">Automation target</div><table class="net"><tbody><tr>' + C.REG.map(function (r) { return '<td>' + C.REG_NAME[r] + ' <input type="number" min="0" max="100" step="5" data-net="automate" data-r="' + r + '" aria-label="Automation target in ' + C.REG_NAME[r] + ', percent" />%</td>'; }).join("") + '</tr></tbody></table>' +
      '<div class="actual">Lowers unit cost, raises fixed cost; takes about 18 months.</div></div>';
    h += '<div class="flightbar"><button class="btn small" id="btn-steady" type="button" title="Back to the starting strategy">Reset levers to the start</button></div>';
    y.innerHTML = h;
    y.querySelectorAll('input[type=range]').forEach(function (inp) { inp.addEventListener("input", function () { setPath(inp.dataset.path, +inp.value); paintOutputs(); }); });
    y.querySelectorAll("#presence button").forEach(function (b) { b.addEventListener("click", function () { cur.commercial.presence[b.dataset.r] = cur.commercial.presence[b.dataset.r] > 0.5 ? 0 : 1; paintOutputs(); }); });
    y.querySelectorAll("input[data-net]").forEach(function (inp) { inp.addEventListener("input", function () { var v = +inp.value || 0; cur.network[inp.dataset.net][inp.dataset.r] = inp.dataset.net === "automate" ? v / 100 : v; renderRadar(); }); });
    $("btn-steady").addEventListener("click", function () { var keepNet = cur.network; cur = C.decisions0(P); cur.network.expand = { EU: 0, AM: 0, AS: 0 }; cur.network.close = { EU: 0, AM: 0, AS: 0 }; cur.network.automate = keepNet.automate; syncYoke(); renderRadar(); });
    syncYoke();
  }
  function getPath(path) { var k = path.split("."), o = cur; for (var i = 0; i < k.length; i++) o = o[k[i]]; return o; }
  function setPath(path, v) { var k = path.split("."), o = cur; for (var i = 0; i < k.length - 1; i++) o = o[k[i]]; o[k[k.length - 1]] = v; }
  function syncYoke() {
    CTL.forEach(function (c) { var el = $("in-" + c[0].replace(/\./g, "-")); if (el) el.value = getPath(c[0]); });
    document.querySelectorAll("input[data-net]").forEach(function (inp) { var v = cur.network[inp.dataset.net][inp.dataset.r]; inp.value = inp.dataset.net === "automate" ? Math.round(v * 100) : (v || ""); });
    paintOutputs();
  }
  function paintOutputs() {
    CTL.forEach(function (c) {
      var id = "in-" + c[0].replace(/\./g, "-"), o = $(id + "-o"); if (o) o.textContent = c[5](getPath(c[0]));
      var a = $(id + "-a"); if (a && c[6]) a.textContent = c[6]();
    });
    document.querySelectorAll("#presence button").forEach(function (b) { b.setAttribute("aria-pressed", String(cur.commercial.presence[b.dataset.r] > 0.5)); });
    var pa = $("presence-a"); if (pa) pa.textContent = "in effect: " + C.REG.map(function (r) { return C.REG_NAME[r] + " " + pct(sim.state.presence[r]); }).join(" · ");
    C.REG.forEach(function (r) {
      var k = $("k-" + r), b = $("b-" + r); if (!k) return;
      k.textContent = sim.state.K[r].toFixed(0);
      var pipe = sim.state.pipe[r][0] + sim.state.pipe[r][1] + sim.state.pipe[r][2];
      b.textContent = pipe > 0.5 ? pipe.toFixed(0) : "–";
    });
  }

  // ---- advisories: what changed this quarter, in plain words
  var EVENTS = {
    innovation: [[24, "info", "The market begins to shift toward innovative products."]],
    asia: [[36, "info", "Asian demand starts to grow fast."]],
    promisewar: [[48, "warn", "Competitors start promising faster delivery. Customers will come to expect it."]],
    storm: [[48, "bad", "A supply disruption hits Europe: 40% of its supply is lost for ten months."], [58, "good", "The European disruption is over."], [72, "warn", "Import tariffs double the cost of moving goods between regions."]]
  };
  EVENTS.perfect = [].concat(EVENTS.innovation, EVENTS.asia, EVENTS.promisewar, EVENTS.storm).sort(function (a, b) { return a[0] - b[0]; });
  var active = {}, arrived = {};
  // a condition is reported when it starts and, for the important ones, when it ends
  function onset(key, cond, q, kind, text, endText) {
    if (cond && !active[key]) { active[key] = true; addLog(q, kind, text); }
    else if (!cond && active[key]) { active[key] = false; if (endText) addLog(q, "good", endText); }
  }
  function addLog(q, kind, text) { log.unshift({ q: q, kind: kind, text: text }); if (log.length > 60) log.pop(); }
  function advise(q, prev, row, prevState, d) {
    var m0 = q * 3, m1 = m0 + 3;
    (EVENTS[game.scenario] || []).forEach(function (e) { if (e[0] >= m0 && e[0] < m1) addLog(q, e[1], e[2]); });
    if (!prev) return;
    var st = sim.state;
    C.REG.forEach(function (r) {
      arrived[r] = (arrived[r] || 0) + Math.max(0, st.K[r] - prevState.K[r]);
      var still = st.pipe[r][0] + st.pipe[r][1] + st.pipe[r][2];
      if (arrived[r] >= 5 && (still < 1 || arrived[r] >= 40)) { addLog(q, "good", Math.round(arrived[r]) + " units of new capacity are now working in " + C.REG_NAME[r] + (still >= 1 ? " (" + Math.round(still) + " still being built)" : "") + "."); arrived[r] = 0; }
    });
    ["F", "I"].forEach(function (s) {
      onset("ahead" + s, d.commercial.promise[s] > st.expPromise[s] + 0.05, q, "info", "Your " + C.SEG_NAME[s].toLowerCase() + " promise (×" + d.commercial.promise[s].toFixed(2) + ") is ahead of what customers expect (×" + st.expPromise[s].toFixed(2) + "). The advantage fades as they come to expect it, within about a year.");
      onset("exp" + s, st.expPromise[s] > d.commercial.promise[s] + 0.05, q, "warn", "Customers of " + C.SEG_NAME[s].toLowerCase() + " products now expect ×" + st.expPromise[s].toFixed(2) + " delivery speed; you promise ×" + d.commercial.promise[s].toFixed(2) + ".", "Your " + C.SEG_NAME[s].toLowerCase() + " promise again meets what customers expect.");
    });
    onset("rel-bad", row.reliability < 0.88, q, "bad", "Reliability is " + pct(row.reliability) + ": customers are noticing, and they notice failures faster than recoveries.", "Reliability is back above 88%.");
    onset("rel-warn", row.reliability < 0.93, q, "warn", "Reliability has slipped to " + pct(row.reliability) + ".", "Reliability is back above 93%.");
    onset("fire", row.firefight > 0.25 && row.capability < prev.capability, q, "warn", "Firefighting takes " + pct(row.firefight) + " of the organisation's time, and capability is eroding (" + pct(row.capability) + ").");
    onset("rebuild", row.capability > prev.capability + 0.003 && row.firefight < 0.2, q, "good", "Capability is rebuilding (" + pct(row.capability) + ").");
    C.REG.forEach(function (r) { onset("hot" + r, row.detail.util[r] > 0.97, q, "warn", C.REG_NAME[r] + " is at full capacity: queues and imports.", C.REG_NAME[r] + " has capacity to spare again."); });
    onset("imports", row.imports > 0.05 * row.demand, q, "warn", pct(row.imports / row.demand) + " of demand is now imported from other regions: slower and costlier.", "Imports are below 5% of demand again.");
    onset("fitP", row.fitProduct < 0.9, q, "warn", "The product supply chain no longer delivers what the commercial strategy needs (fit " + pct(row.fitProduct) + ").", "The product supply chain fits the commercial strategy again.");
    onset("fitN", row.fitNetwork < 0.9, q, "warn", "The network no longer matches where demand is (fit " + pct(row.fitNetwork) + ").", "The network matches demand again.");
    onset("trust", row.trust < 0.6, q, "bad", "Trust between functions is low: changes now take longer to implement.", "Trust between functions has recovered above 60%.");
    onset("cash", row.cash < 0, q, "bad", "Cash is negative.", "Cash is positive again.");
    onset("lost", row.lost > 0.02 * row.demand, q, "bad", pct(row.lost / row.demand) + " of demand cannot be served at all.", "All demand can be served again.");
  }

  // ---- instruments
  function gauge(label, value, lo, hi, text, delta, status) {
    var f = Math.max(0, Math.min(1, (value - lo) / (hi - lo))), a = Math.PI * (1 - f), cx = 60, cy = 58, r = 46;
    var x = cx + r * Math.cos(a), y = cy - r * Math.sin(a);
    var col = status === "bad" ? COL.bad : status === "warn" ? COL.warn : COL.good, icon = status === "bad" ? "▲" : status === "warn" ? "●" : "✓", word = status === "bad" ? "critical" : status === "warn" ? "watch" : "fine";
    return '<div class="gauge"><svg viewBox="0 0 120 70" aria-hidden="true"><path d="M14,58 A46,46 0 0 1 106,58" fill="none" stroke="#1d4470" stroke-width="9" stroke-linecap="round"/>' +
      '<path d="M14,58 A46,46 0 0 1 ' + x.toFixed(1) + "," + y.toFixed(1) + '" fill="none" stroke="' + col + '" stroke-width="9" stroke-linecap="round"/>' +
      '<line x1="60" y1="58" x2="' + (cx + (r - 14) * Math.cos(a)).toFixed(1) + '" y2="' + (cy - (r - 14) * Math.sin(a)).toFixed(1) + '" stroke="#e6f3ff" stroke-width="2.5" stroke-linecap="round"/><circle cx="60" cy="58" r="4" fill="#e6f3ff"/></svg>' +
      '<div class="lbl">' + esc(label) + '</div><div class="val">' + esc(text) + '</div><div class="delta">' + esc(delta) + ' · <span class="status ' + status + '">' + icon + " " + word + "</span></div></div>";
  }
  function render() {
    var q = sim.state.q, last = sim.history.months[sim.history.months.length - 1] || null, qrow = sim.history.quarters[sim.history.quarters.length - 1];
    $("clockface").innerHTML = sim.done() ? "Landed · 20 years" : "Year " + (Math.floor(q / 4) + 1) + ", quarter " + (q % 4 + 1) + "<small>" + q + " of 80 quarters flown</small>";
    $("progress").style.width = (q / P.quarters * 100) + "%";
    $("btn-advance").disabled = $("btn-advance4").disabled = $("btn-toend").disabled = sim.done(); $("btn-undo").disabled = q === 0;
    paintOutputs();
    var r = last || preview();
    var s0 = startRow || r, qp = qrow ? qrow.profit : r.profit * 3, qp0 = s0.profit * 3;
    var status = function (v, warn, bad, higherIsBetter) { return higherIsBetter === false ? (v > bad ? "bad" : v > warn ? "warn" : "good") : (v < bad ? "bad" : v < warn ? "warn" : "good"); };
    $("gauges").innerHTML =
      gauge("Profit / quarter", qp, 0, qp0 * 2, fmtK(qp), "start " + fmtK(qp0), status(qp / qp0, 0.85, 0.5)) +
      gauge("Cash", sim.state.cash, Math.min(0, sim.state.cash), Math.max(qp0 * 80, sim.state.cash), fmtK(sim.state.cash), "20-year course: " + fmtK(qp0 * 80), sim.state.cash < 0 ? "bad" : "good") +
      gauge("Reliability", r.reliability, 0.6, 1, pct(r.reliability, 1), "start " + pct(s0.reliability, 1), status(r.reliability, 0.93, 0.88)) +
      gauge("Demand", r.demand, 0, s0.demand * 2, r.demand.toFixed(0) + "/mo", "start " + s0.demand.toFixed(0), status(r.demand / s0.demand, 0.95, 0.85)) +
      gauge("Capability", r.capability, 0, 1, pct(r.capability), "start " + pct(s0.capability), status(r.capability, 0.8, 0.65)) +
      gauge("Trust", r.trust, 0, 1, pct(r.trust), "start " + pct(s0.trust), status(r.trust, 0.7, 0.5)) +
      gauge("Suppliers", r.supplier, 0, 1, pct(r.supplier), "start " + pct(s0.supplier), status(r.supplier, 0.75, 0.55));
    var fit = function (label, v, col, txt) { return '<div class="fit" style="border-top-color:' + col + '"><div class="lbl">' + label + '</div><div class="bar"><i style="width:' + (v * 100).toFixed(1) + "%;background:" + col + '"></i></div><div class="txt"><b>' + pct(v) + "</b> · " + txt + "</div></div>"; };
    $("fits").innerHTML = fit("Commercial promise kept", r.fitCommercial, COL.com, "customers' perceived reliability against what the promise needs") +
      fit("Product supply chain fit", r.fitProduct, COL.psc, "responsiveness delivered against what the commercial strategy needs") +
      fit("Network fit", r.fitNetwork, COL.net, "capacity where the demand is, without imports");
    renderAdvice(); renderRadar(); renderRegions(r); renderCharts(); renderEnd();
  }
  function preview() { var s = C.create({}, game.scenario); s.quarter(C.decisions0(P)); return s.history.months[0]; }
  function renderAdvice() {
    $("advisories").innerHTML = log.length ? log.map(function (l) { var ic = { bad: "▲", warn: "●", good: "✓", info: "ℹ" }[l.kind]; return '<li class="' + l.kind + '"><span class="ic" aria-label="' + l.kind + '">' + ic + '</span><span class="when">' + when(l.q) + "</span><span>" + esc(l.text) + "</span></li>"; }).join("")
      : '<li class="info"><span class="ic">ℹ</span><span>Set your levers and advance the clock. Advisories appear here as things change.</span></li>';
  }
  function renderRadar() {
    var st = sim.state, rows = [];
    C.REG.forEach(function (r) {
      var pp = st.pipe[r], tot = pp[0] + pp[1] + pp[2];
      if (tot > 0.5) { var mean = (pp[0] * 3 + pp[1] * 2 + pp[2]) / tot * (P.buildTime / 3); rows.push([COL.net, "Capacity being built in " + C.REG_NAME[r], tot.toFixed(0) + " units · ≈" + mean.toFixed(0) + " months on average"]); }
      if (st.closing[r] > 0.5) rows.push([COL.net, "Capacity closing in " + C.REG_NAME[r], st.closing[r].toFixed(0) + " units"]);
      if (Math.abs(cur.network.automate[r] - st.auto[r]) > 0.02) rows.push([COL.net, "Automation in " + C.REG_NAME[r], pct(st.auto[r]) + " → " + pct(cur.network.automate[r])]);
      if (cur.network.expand[r] > 0) rows.push([COL.net, "Order to place in " + C.REG_NAME[r] + " when you advance", "+" + cur.network.expand[r] + " units"]);
      if (cur.network.close[r] > 0) rows.push([COL.net, "Closure to start in " + C.REG_NAME[r] + " when you advance", "−" + cur.network.close[r] + " units"]);
    });
    ["F", "I"].forEach(function (s) {
      var name = C.SEG_NAME[s].toLowerCase();
      if (Math.abs(cur.product.coverage[s] - st.cov[s]) > 0.15) rows.push([COL.psc, "Inventory cover, " + name, st.cov[s].toFixed(1) + " → " + cur.product.coverage[s].toFixed(1) + " wk"]);
      if (Math.abs(cur.product.flex[s] - st.flex[s]) > 0.01) rows.push([COL.psc, "Flexible capacity, " + name, pct(st.flex[s]) + " → " + pct(cur.product.flex[s])]);
      if (Math.abs(cur.product.dual[s] - st.dual[s]) > 0.03) rows.push([COL.psc, "Dual sourcing, " + name, pct(st.dual[s]) + " → " + pct(cur.product.dual[s])]);
      if (Math.abs(st.expPromise[s] - cur.commercial.promise[s]) > 0.03) rows.push([COL.com, "Customers' expected promise, " + name, "×" + st.expPromise[s].toFixed(2) + " → ×" + cur.commercial.promise[s].toFixed(2) + " (or what competitors offer)"]);
      var ranget = cur.commercial.launches[s] / 3 / (1 / P.rangeLife + cur.commercial.rationalize[s] / 12);
      if (Math.abs(ranget - st.range[s]) > 0.05 * st.range[s]) rows.push([COL.com, "Product range, " + name, st.range[s].toFixed(0) + " → " + ranget.toFixed(0) + " SKUs"]);
    });
    C.REG.forEach(function (r) { if (Math.abs(cur.commercial.presence[r] - st.presence[r]) > 0.02) rows.push([COL.com, "Presence in " + C.REG_NAME[r], pct(st.presence[r]) + " → " + pct(cur.commercial.presence[r])]); });
    $("radar").innerHTML = rows.length ? "<table>" + rows.map(function (x) { return '<tr><td><span class="lane" style="background:' + x[0] + '"></span>' + esc(x[1]) + "</td><td>" + esc(x[2]) + "</td></tr>"; }).join("") + "</table>"
      : '<p style="font-size:13px; color:var(--ink-dim); margin:0;">Nothing in flight: every decision has fully taken effect.</p>';
  }
  function renderRegions(r) {
    var d = r.detail;
    $("regions").innerHTML = "<thead><tr><th>Region</th><th>Demand F</th><th>Demand I</th><th>Capacity</th><th>Effective</th><th>Utilisation</th><th>Imports</th><th>Reliability F / I</th></tr></thead><tbody>" +
      C.REG.map(function (g) {
        return "<tr><td>" + C.REG_NAME[g] + "</td><td>" + d.D.F[g].toFixed(0) + "</td><td>" + d.D.I[g].toFixed(0) + "</td><td>" + d.K[g].toFixed(0) + "</td><td>" + d.Keff[g].toFixed(0) + "</td><td>" + pct(d.util[g]) + "</td><td>" + d.imports[g].toFixed(0) + "</td><td>" + pct(d.SQ.F[g]) + " / " + pct(d.SQ.I[g]) + "</td></tr>";
      }).join("") + "</tbody>";
  }

  // ---- history charts over the full 20 years (the future stays empty)
  function Chart(host) {
    var self = this; this.cv = document.createElement("canvas"); this.tip = document.createElement("div"); this.tip.className = "tip"; this.tip.hidden = true;
    host.appendChild(this.cv); host.appendChild(this.tip); this.hx = null;
    this.cv.addEventListener("pointermove", function (e) { var b = self.cv.getBoundingClientRect(); self.hx = e.clientX - b.left; self.draw(); });
    this.cv.addEventListener("pointerleave", function () { self.hx = null; self.tip.hidden = true; self.draw(); });
  }
  Chart.prototype.set = function (d) { this.d = d; this.draw(); };
  Chart.prototype.draw = function () {
    var d = this.d; if (!d) return;
    var cv = this.cv, dpr = window.devicePixelRatio || 1, W = cv.clientWidth, H = cv.clientHeight; if (!W || !H) return;
    if (cv.width !== Math.round(W * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); }
    var cx = cv.getContext("2d"); cx.setTransform(dpr, 0, 0, dpr, 0, 0); cx.clearRect(0, 0, W, H);
    var Lm = 44, Rm = 8, Tm = 8, Bm = 20, pw = W - Lm - Rm, ph = H - Tm - Bm, n = d.t.length;
    var lo = d.lo != null ? d.lo : Infinity, hi = d.hi != null ? d.hi : -Infinity;
    d.series.forEach(function (s) { s.ys.forEach(function (y) { if (isFinite(y)) { lo = Math.min(lo, y); hi = Math.max(hi, y); } }); });
    if (!isFinite(lo)) { lo = 0; hi = 1; }
    var pad = (hi - lo) * 0.08 || 1; if (d.lo == null) lo -= pad; if (d.hi == null) hi += pad;
    var X = function (t) { return Lm + pw * t / 240; }, Y = function (v) { return Tm + ph * (hi - v) / (hi - lo); };
    cx.font = "10.5px IBM Plex Mono, monospace"; cx.fillStyle = COL.faint; cx.strokeStyle = COL.line; cx.lineWidth = 1;
    for (var k = 0; k <= 4; k++) { var v = lo + (hi - lo) * k / 4, yy = Math.round(Y(v)) + 0.5; cx.globalAlpha = 0.5; cx.beginPath(); cx.moveTo(Lm, yy); cx.lineTo(W - Rm, yy); cx.stroke(); cx.globalAlpha = 1; cx.fillText(d.fmt ? d.fmt(v) : (+v.toFixed(2)).toString(), 2, yy + 3); }
    for (var yr = 0; yr <= 20; yr += 5) { var xx = X(yr * 12); cx.fillText("Y" + yr, Math.min(W - Rm - 18, xx - 6), H - 5); }
    if (d.now != null) { var nx = Math.round(X(d.now)) + 0.5; cx.strokeStyle = "#7dd3fc"; cx.setLineDash([3, 3]); cx.beginPath(); cx.moveTo(nx, Tm); cx.lineTo(nx, Tm + ph); cx.stroke(); cx.setLineDash([]); }
    d.series.forEach(function (s) {
      cx.strokeStyle = s.color; cx.lineWidth = s.width || 2; cx.setLineDash(s.dash || []); cx.beginPath();
      for (var i = 0; i < n; i++) { var x = X(d.t[i]), y = Y(s.ys[i]); if (i) cx.lineTo(x, y); else cx.moveTo(x, y); }
      cx.stroke(); cx.setLineDash([]);
    });
    if (this.hx != null && n) {
      var tt = (this.hx - Lm) / pw * 240, idx = 0, best = Infinity;
      for (var i = 0; i < n; i++) { var dd = Math.abs(d.t[i] - tt); if (dd < best) { best = dd; idx = i; } }
      if (best <= 3) {
        var bx = Math.round(X(d.t[idx])) + 0.5; cx.strokeStyle = COL.faint; cx.lineWidth = 1; cx.beginPath(); cx.moveTo(bx, Tm); cx.lineTo(bx, Tm + ph); cx.stroke();
        d.series.forEach(function (s) { cx.fillStyle = s.color; cx.beginPath(); cx.arc(bx, Y(s.ys[idx]), 3.5, 0, 7); cx.fill(); });
        var mo = Math.round(d.t[idx]);
        this.tip.innerHTML = '<span style="color:#6fa8c9">year ' + (Math.floor((mo - 1) / 12) + 1) + ", month " + ((mo - 1) % 12 + 1) + "</span><br>" + d.series.map(function (s) { return '<span style="display:inline-block;width:10px;height:3px;background:' + s.color + ';vertical-align:middle"></span> ' + esc(s.name) + " " + (d.fmt ? d.fmt(s.ys[idx]) : s.ys[idx].toFixed(2)); }).join("<br>");
        this.tip.hidden = false; var tw = this.tip.offsetWidth; this.tip.style.left = Math.max(0, Math.min(W - tw - 2, bx + 12)) + "px"; this.tip.style.top = "4px";
      } else this.tip.hidden = true;
    }
  };
  var charts = {};
  var CHARTS = [
    ["money", "Revenue and profit per month", function (m) { return [["revenue", m.map(function (x) { return x.revenue; }), COL.s1], ["profit", m.map(function (x) { return x.profit; }), COL.s4]]; }, fmtK],
    ["service", "Reliability and fit", function (m) { return [["reliability", m.map(function (x) { return x.reliability; }), "#e6f3ff"], ["commercial", m.map(function (x) { return x.fitCommercial; }), COL.com], ["product SC", m.map(function (x) { return x.fitProduct; }), COL.psc], ["network", m.map(function (x) { return x.fitNetwork; }), COL.net]]; }, function (v) { return pct(v); }],
    ["org", "The inertial organisation", function (m) { return [["capability", m.map(function (x) { return x.capability; }), COL.s1], ["trust", m.map(function (x) { return x.trust; }), COL.s2], ["suppliers", m.map(function (x) { return x.supplier; }), COL.s3]]; }, function (v) { return pct(v); }],
    ["promise", "The promise ratchet: offered and expected", function (m) {
      var off = function (s) { return m.map(function (x) { var qd = game.decisions[Math.min(game.decisions.length - 1, Math.ceil(x.t / 3) - 1)]; return qd ? qd.commercial.promise[s] : 1; }); };
      return [["innovative offered", off("I"), COL.s3], ["innovative expected", m.map(function (x) { return x.expPromiseI; }), COL.s3, [6, 4]], ["functional offered", off("F"), COL.s1], ["functional expected", m.map(function (x) { return x.expPromiseF; }), COL.s1, [6, 4]]];
    }, function (v) { return "×" + v.toFixed(2); }],
    ["capacity", "Demand and capacity", function (m) { return [["demand", m.map(function (x) { return x.demand; }), "#e6f3ff"], ["capacity", m.map(function (x) { return x.capacity; }), COL.net], ["being built", m.map(function (x) { return x.pipeline; }), COL.net, [4, 3]]]; }, function (v) { return v.toFixed(0); }],
    ["range", "Product range (SKUs)", function (m) { return [["functional", m.map(function (x) { return x.rangeF; }), COL.s1], ["innovative", m.map(function (x) { return x.rangeI; }), COL.s3]]; }, function (v) { return v.toFixed(0); }]
  ];
  (function buildCharts() {
    CHARTS.forEach(function (c) {
      var box = document.createElement("div"); box.className = "chart"; box.id = "chart-" + c[0];
      box.innerHTML = "<h3>" + c[1] + '</h3><div class="legend"></div><div class="plot"></div>'; $("charts").appendChild(box);
      charts[c[0]] = new Chart(box.querySelector(".plot")); charts[c[0]].legend = box.querySelector(".legend");
    });
  })();
  function renderCharts() {
    var m = sim.history.months, t = m.map(function (x) { return x.t; });
    CHARTS.forEach(function (c) {
      var ser = c[2](m).map(function (s) { return { name: s[0], ys: s[1], color: s[2], dash: s[3] }; });
      var lim = c[0] === "service" || c[0] === "org" ? { lo: 0, hi: 1 } : c[0] === "capacity" || c[0] === "range" ? { lo: 0 } : {};
      charts[c[0]].set(Object.assign({ t: t, series: ser, fmt: c[3], now: sim.state.t }, lim));
      charts[c[0]].legend.innerHTML = ser.map(function (s) { return '<span><svg width="20" height="8"><line x1="1" y1="4" x2="19" y2="4" stroke="' + s.color + '" stroke-width="2"' + (s.dash ? ' stroke-dasharray="' + s.dash.join(",") + '"' : "") + "/></svg>" + esc(s.name) + "</span>"; }).join("");
    });
  }
  window.addEventListener("resize", function () { Object.keys(charts).forEach(function (k) { charts[k].draw(); }); });

  // ---- the debrief: replays the flight with only some strategy levels moving, to show which clock made or cost the
  // money and whether the levels pulled together; then a timeline of each decision against when most of it took effect
  var LEVEL = { commercial: ["Commercial", "var(--com)"], product: ["Product supply chain", "var(--psc)"], network: ["Network", "var(--net)"] };
  function debriefHtml() {
    var b = C.debrief({}, game.scenario, game.decisions);
    if (!b.timeline.length) return '<div class="debrief"><h3>Debrief</h3><p class="dim">You held the starting course, so there is nothing to attribute.</p></div>';
    var rows = C.GROUPS.map(function (g) { return { name: LEVEL[g][0] + " alone", v: b.alone[g], col: LEVEL[g][1] }; });
    rows.push({ name: "Moving together", v: b.interaction, col: "var(--accent)" });
    rows.push({ name: "Your flight vs starting course", v: b.gap, col: "var(--ink)", total: true });
    var mx = Math.max.apply(null, rows.map(function (r) { return Math.abs(r.v); }).concat([1]));
    var bars = rows.map(function (r) {
      var w = Math.abs(r.v) / mx * 50;
      return '<div class="db-row' + (r.total ? " total" : "") + '"><span class="db-name">' + esc(r.name) + '</span><span class="db-track"><i style="' + (r.v < 0 ? "right:50%" : "left:50%") + "; width:" + w.toFixed(2) + "%; background:" + r.col + '"></i></span><b class="' + (r.v < 0 ? "neg" : "pos") + '">' + (r.v >= 0 ? "+" : "") + fmtK(r.v) + "</b></div>";
    }).join("");
    var together = b.interaction, verdict = Math.abs(together) < 0.05 * Math.max(1, Math.abs(b.gap)) ? "Your levels moved mostly independently: the result is close to the sum of each level alone." :
      together > 0 ? "Your levels pulled together: moving them in step was worth " + fmtK(together) + " more than the sum of each move on its own." :
      "Your levels pulled against each other: moving them together cost " + fmtK(-together) + " compared with the sum of each move on its own.";
    // the timeline: one lane per clock, a dot when a decision was taken, a line to when most of it was in effect
    var W = 800, H = 118, x = function (q) { return 120 + (q / P.quarters) * (W - 136); }, lane = { commercial: 30, product: 60, network: 90 };
    var svg = '<svg viewBox="0 0 ' + W + " " + H + '" role="img" aria-label="When each decision was taken and when most of it was in effect">';
    for (var y = 0; y <= 20; y += 5) svg += '<line x1="' + x(y * 4) + '" y1="14" x2="' + x(y * 4) + '" y2="104" stroke="var(--line-soft)"/><text x="' + x(y * 4) + '" y="116" text-anchor="middle" fill="var(--ink-faint)" font-size="10" font-family="var(--mono)">Y' + y + "</text>";
    C.GROUPS.forEach(function (g) { svg += '<text x="0" y="' + (lane[g] + 4) + '" fill="var(--ink-dim)" font-size="11.5" font-family="var(--body)">' + LEVEL[g][0] + " · " + C.CLOCK_MONTHS[g] + ' mo</text><line x1="' + x(0) + '" y1="' + lane[g] + '" x2="' + x(P.quarters) + '" y2="' + lane[g] + '" stroke="var(--line)"/>'; });
    b.timeline.forEach(function (e) {
      var yy = lane[e.level], c = LEVEL[e.level][1];
      svg += '<line x1="' + x(e.q) + '" y1="' + yy + '" x2="' + x(e.landsQ) + '" y2="' + yy + '" stroke="' + c + '" stroke-width="5" stroke-linecap="round" opacity=".55"><title>' + LEVEL[e.level][0] + ": decided " + when(e.q) + ", mostly in effect by " + when(Math.min(e.landsQ, P.quarters - 1)) + "</title></line>" +
        '<circle cx="' + x(e.q) + '" cy="' + yy + '" r="4" fill="' + c + '"/>';
    });
    svg += "</svg>";
    return '<div class="debrief"><h3>Debrief: which clock made or cost the money</h3>' +
      '<p class="dim">Your flight replayed with only one level moving at a time, the others held at the starting course. 20-year profit against holding the starting course in the same weather.</p>' +
      '<div class="db-bars">' + bars + "</div><p>" + esc(verdict) + "</p>" +
      '<p class="dim small">Fair shares (Shapley): commercial ' + fmtK(b.shapley.commercial) + " · product supply chain " + fmtK(b.shapley.product) + " · network " + fmtK(b.shapley.network) + ".</p>" +
      '<h3>When your decisions landed</h3><p class="dim">A dot when you decided, a bar to when about two-thirds of the change was in effect at that level\'s tested clock speed.</p><div class="db-timeline">' + svg + "</div></div>";
  }

  // ---- landing: how the flight compares with holding the starting course in the same weather
  function renderEnd() {
    var box = $("endcard");
    if (!sim.done()) { box.hidden = true; return; }
    var ref = C.run({}, game.scenario), you = sim, last = you.history.months[239], rl = ref.history.months[239];
    var better = you.totals.profit >= ref.totals.profit;
    box.hidden = false;
    box.innerHTML = "<h2>Landed after 20 years</h2><p style=\"color:var(--ink-dim); margin:0;\">" + esc(C.SCENARIOS[game.scenario].name) + ". Compared with holding the starting course in the same weather:</p>" +
      '<div class="score">' +
      "<div><b>" + fmtK(you.totals.profit) + "</b><span>your 20-year profit · starting course " + fmtK(ref.totals.profit) + " (" + (better ? "+" : "") + fmtK(you.totals.profit - ref.totals.profit) + ")</span></div>" +
      "<div><b>" + fmtK(you.state.cash) + "</b><span>cash at landing · starting course " + fmtK(ref.state.cash) + "</span></div>" +
      "<div><b>" + last.demand.toFixed(0) + "</b><span>demand per month · starting course " + rl.demand.toFixed(0) + "</span></div>" +
      "<div><b>" + pct(last.reliability, 1) + "</b><span>reliability · starting course " + pct(rl.reliability, 1) + "</span></div>" +
      "<div><b>" + pct(last.capability) + "</b><span>capability · starting course " + pct(rl.capability) + "</span></div>" +
      "</div>" + debriefHtml() + "<div class=\"flightbar\"><button class=\"btn\" id=\"btn-again\" type=\"button\">Fly again in this weather</button><button class=\"btn\" id=\"btn-other\" type=\"button\">Choose other weather</button></div>";
    $("btn-again").addEventListener("click", function () { start(game.scenario, []); });
    $("btn-other").addEventListener("click", function () { $("btn-newgame").click(); });
  }

  window.clockspeed = { version: VERSION, sim: function () { return sim; }, game: function () { return game; }, cur: function () { return cur; }, start: start, advance: advance, log: function () { return log; } };
})();
