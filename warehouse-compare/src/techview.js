/*
 * techview.js — the "Technology screen" view: the site-inputs form, the
 * flexibility vs efficiency map and the recommendation (src/frontier.js on
 * data/archetypes.json). app.js owns the state (inputs.site) and calls
 * init() once and show() when the view is opened.
 *
 * The map follows the charting rules used elsewhere in the app: one axis per
 * dimension, recessive grid, the six technologies in one neutral colour named
 * by direct labels (colour marks status only: recommended, runner-up,
 * excluded), a tooltip per point on hover and focus, and a table view.
 */
(function (root) {
  "use strict";
  const $ = function (id) { return document.getElementById(id); };
  const T = function (s, v) { return WC.t.T(s, v); };
  const NS = "http://www.w3.org/2000/svg";
  const PCT = { annual_sku_churn: 1, share_skus_outside_container: 1 };
  let ctx = null, cat = null, built = false;

  const I18 = function () { return window.WCi18n; };
  function words(k) { const d = cat.site_inputs[k], p = I18() && I18().param("site." + k); return p || { label: d.label, description: d.description }; }
  function optLabel(k, o) { const c = I18() && I18().choice("site." + k, o); return c != null ? c : cat.site_inputs[k].labels[o]; }
  function arch(id) {
    const a = cat.archetypes.find(function (x) { return x.id === id; }), tr = I18() && I18().archetype(id);
    return Object.assign({}, a, tr || {});
  }
  function fmt(v, d) { return Number(v).toLocaleString(WC.t.locale(), { minimumFractionDigits: d, maximumFractionDigits: d }); }
  function el(tag, attrs, parent, text) {
    const e = tag.indexOf("svg:") === 0 ? document.createElementNS(NS, tag.slice(4)) : document.createElement(tag);
    for (const k in attrs || {}) e.setAttribute(k, attrs[k]);
    if (text != null) e.textContent = text;
    if (parent) parent.appendChild(e);
    return e;
  }

  // ---------------------------------------------------------------- the form
  function buildForm() {
    const box = $("techForm"), site = ctx.inputs().site;
    box.innerHTML = "";
    el("h2", {}, box, T("Your site"));
    Object.keys(cat.site_inputs).forEach(function (k) {
      if (k.charAt(0) === "$") return;
      const d = cat.site_inputs[k], w = words(k), f = el("div", { class: "field", id: "tf_" + k }, box);
      const lab = el("label", { for: "t_" + k }, f);
      el("span", {}, lab, w.label);
      if (d.type === "choice") {
        const sel = el("select", { id: "t_" + k }, f);
        d.options.forEach(function (o) { el("option", { value: o }, sel, optLabel(k, o)); });
        sel.value = k === "flat_floor" ? (site.flat_floor ? "flat" : "not_flat") : site[k];
        sel.addEventListener("input", function () { site[k] = k === "flat_floor" ? sel.value === "flat" : sel.value; update(); });
      } else {
        const out = el("output", { id: "to_" + k }, lab);
        const inp = el("input", { type: "range", id: "t_" + k, min: d.minimum, max: d.maximum, step: d.step, value: site[k] }, f);
        const show = function () { out.textContent = PCT[k] ? fmt(100 * site[k], 0) + " %" : fmt(site[k], d.step < 1 ? (d.step < 0.1 ? 2 : 1) : 0) + (d.unit ? " " + T(d.unit) : ""); };
        inp.addEventListener("input", function () { site[k] = Number(inp.value); show(); mark(k, false); update(); });
        show();
      }
      el("div", { class: "help" }, f, w.description);
    });
  }
  // inputs taken from the comparison carry a small note
  function mark(k, on) {
    const f = $("tf_" + k); if (!f) return;
    let n = f.querySelector(".from-app");
    if (on && !n) { n = el("div", { class: "from-app" }, null, T("from the comparison")); f.insertBefore(n, f.querySelector(".help")); }
    if (!on && n) n.remove();
  }

  // ---------------------------------------------------------------- the map
  function drawMap(res) {
    const host = $("techMap"); host.innerHTML = "";
    host.classList.add("chart");
    el("div", { class: "chart-title" }, host, T("Picking technologies: flexibility vs efficiency"));
    const wrap = el("div", { class: "chart-wrap" }, host);
    const W = Math.max(320, host.clientWidth || 640), H = 372, m = { l: 48, r: 24, t: 16, b: 70 };
    const svg = el("svg:svg", { viewBox: "0 0 " + W + " " + H, width: "100%", height: H, role: "img", "aria-label": T("Picking technologies: flexibility vs efficiency") }, wrap);
    const X = function (f) { return m.l + f / 100 * (W - m.l - m.r); }, Y = function (e) { return H - m.b - e / 100 * (H - m.t - m.b); };
    const mm = WC.frontier.mapModel(res, cat);

    // boundary band first, behind everything
    if (mm.band) el("svg:rect", { x: X(mm.band[0]), y: m.t, width: X(mm.band[1]) - X(mm.band[0]), height: H - m.t - m.b, class: "band" }, svg);
    [0, 20, 40, 60, 80, 100].forEach(function (v) {
      el("svg:line", { x1: m.l, x2: W - m.r, y1: Y(v), y2: Y(v), class: "grid" }, svg);
      el("svg:text", { x: m.l - 6, y: Y(v) + 4, "text-anchor": "end", class: "tick" }, svg, String(v));
      el("svg:text", { x: X(v), y: H - m.b + 15, "text-anchor": "middle", class: "tick" }, svg, String(v));
    });
    el("svg:line", { x1: m.l, x2: W - m.r, y1: Y(0), y2: Y(0), class: "axis" }, svg);
    el("svg:text", { x: (m.l + W - m.r) / 2, y: H - m.b + 30, "text-anchor": "middle", class: "axis-label" }, svg, T("Flexibility (F)"));
    el("svg:text", { x: 12, y: (m.t + H - m.b) / 2, "text-anchor": "middle", class: "axis-label", transform: "rotate(-90 12 " + (m.t + H - m.b) / 2 + ")" }, svg, T("Efficiency (E)"));
    // the context gradient under the axis
    // stacked, so they can't collide on a narrow screen
    el("svg:text", { x: m.l, y: H - 20, class: "ctx" }, svg, T("← stable demand · long lease · high rent"));
    el("svg:text", { x: W - m.r, y: H - 6, "text-anchor": "end", class: "ctx" }, svg, T("volatile SKUs · short lease · fast ramp-up →"));
    // regions (not on narrow screens, where they would sit on the labels)
    if (W >= 520) {
      el("svg:text", { x: W - m.r - 4, y: Y(94), "text-anchor": "end", class: "region" }, svg, T("not achievable with today's technology"));
      el("svg:text", { x: X(4), y: Y(8), class: "region" }, svg, T("dominated designs"));
    }

    // the frontier
    el("svg:polyline", { points: mm.line.map(function (p) { return X(p[0]) + "," + Y(p[1]); }).join(" "), class: "frontier" }, svg);

    // required → target (how much cost pressure moved it), and the target line
    if (mm.site) {
      el("svg:line", { x1: X(mm.site.F), x2: X(mm.site.F), y1: m.t, y2: H - m.b, class: "refline" }, svg);
      if (Math.abs(mm.required - mm.site.F) > 0.5) {
        const y = H - m.b - 8;
        el("svg:line", { x1: X(mm.required), x2: X(mm.site.F), y1: y, y2: y, class: "shift", "marker-end": "url(#arrow)" }, svg);
        el("svg:circle", { cx: X(mm.required), cy: y, r: 3, class: "shift-dot" }, svg);
      }
    }
    const defs = el("svg:defs", {}, svg), mk = el("svg:marker", { id: "arrow", viewBox: "0 0 10 10", refX: 9, refY: 5, markerWidth: 6, markerHeight: 6, orient: "auto" }, defs);
    el("svg:path", { d: "M0,0 L10,5 L0,10 z", class: "shift-head" }, mk);

    // the technologies
    const tip = el("div", { class: "chart-tip" }, wrap); tip.hidden = true;
    mm.points.forEach(function (p) {
      const a = arch(p.id), g = el("svg:g", { class: "pt " + p.status }, svg);
      el("svg:circle", { cx: X(p.F), cy: Y(p.E), r: p.status === "recommended" ? 8 : 6, class: "mark" }, g);
      if (p.status === "recommended" || p.status === "runner_up") el("svg:circle", { cx: X(p.F), cy: Y(p.E), r: 12, class: "ring" }, g);
      // label on whichever side it fits (≈ 6.3 px a character at 11.5 px)
      const right = X(p.F) + 14 + a.name.length * 6.3 <= W - 2;
      el("svg:text", { x: X(p.F) + (right ? 14 : -14), y: Y(p.E) + 4, "text-anchor": right ? "start" : "end", class: "ptlabel" }, g, a.name);
      const hit = el("svg:circle", { cx: X(p.F), cy: Y(p.E), r: 16, fill: "transparent", tabindex: 0, "aria-label": a.name }, g);
      const show = function () {
        tip.innerHTML = "";
        el("div", { class: "tip-x" }, tip, a.name);
        [[fmt(p.F, 0), "F"], [fmt(p.E, 0), "E"], [fmt(a.sub_scores.volume_flex, 0) + " / " + fmt(a.sub_scores.mix_flex, 0) + " / " + fmt(a.sub_scores.exit_flex, 0), T("volume / mix / exit flexibility")]].forEach(function (r) {
          const row = el("div", {}, tip); el("b", {}, row, r[0]); el("span", {}, row, r[1]);
        });
        const st = p.status === "recommended" ? T("recommended") : p.status === "runner_up" ? T("runner-up") : p.status === "excluded" ? T("excluded: {r}", { r: p.excluded.reasons.map(function (x) { return x.text; }).join(" ") }) : "";
        if (st) el("div", { class: "tip-status" }, tip, st);
        if (p.simulated_as) el("div", { class: "tip-status" }, tip, T("Simulated in this app as WH-{id}: see the evidence below the result.", { id: p.simulated_as }));
        tip.hidden = false;
        const px = X(p.F) / W * wrap.clientWidth;
        tip.style.left = Math.min(wrap.clientWidth - tip.offsetWidth - 4, Math.max(4, px + 14)) + "px";
        tip.style.top = Math.max(4, Y(p.E) / H * wrap.clientHeight - 20) + "px";
      };
      const hide = function () { tip.hidden = true; };
      hit.addEventListener("pointerenter", show); hit.addEventListener("pointerleave", hide);
      hit.addEventListener("focus", show); hit.addEventListener("blur", hide);
    });
    if (mm.site) {
      const s = el("svg:g", { class: "site" }, svg), x = X(mm.site.F), y = Y(mm.site.E);
      el("svg:path", { d: "M" + x + "," + (y - 8) + " L" + (x + 8) + "," + y + " L" + x + "," + (y + 8) + " L" + (x - 8) + "," + y + " z", class: "site-mark" }, s);
      // below-left of the marker: above it sit the higher-efficiency technologies' labels
      // (on narrow screens the legend names the diamond: the label would sit on a technology's)
      if (W >= 520) el("svg:text", { x: x - 10, y: y + 20, "text-anchor": "end", class: "ptlabel site-label" }, s, T("your site"));
    }
    // legend for the marks (status, not identity)
    const lg = el("div", { class: "chart-legend tech-legend" }, host);
    [["rec", T("recommended")], ["run", T("runner-up")], ["exc", T("excluded")], ["site", T("your site, on the frontier at the target flexibility")], ["shift", T("required flexibility → after cost pressure")]].forEach(function (p) {
      const it = el("span", {}, lg); el("i", { class: "k-" + p[0] }, it); it.appendChild(document.createTextNode(p[1]));
    });
    // table view of the map
    const det = el("details", { class: "chart-table" }, host); el("summary", {}, det, T("Table"));
    const tb = el("table", {}, det), hr = el("tr", {}, tb);
    [T("Technology"), "F", "E", T("Volume"), T("Mix"), T("Exit"), T("Status")].forEach(function (h) { el("th", {}, hr, h); });
    mm.points.slice().sort(function (a, b) { return a.F - b.F; }).forEach(function (p) {
      const a = arch(p.id), tr = el("tr", {}, tb);
      [a.name, fmt(p.F, 0), fmt(p.E, 0), fmt(a.sub_scores.volume_flex, 0), fmt(a.sub_scores.mix_flex, 0), fmt(a.sub_scores.exit_flex, 0),
        p.status === "recommended" ? T("recommended") : p.status === "runner_up" ? T("runner-up") : p.status === "excluded" ? T("excluded") : ""].forEach(function (v) { el("td", {}, tr, v); });
    });
  }

  // ---------------------------------------------------------------- the result
  function drawResult(res) {
    const box = $("techResult"); box.innerHTML = "";
    if (!res.ok) {
      const w = el("div", { class: "warns" }, box);
      (res.problems || []).forEach(function (p) { el("div", {}, w, "⚠ " + p.text); });
      return;
    }
    const rec = arch(res.recommended), run = res.runner_up ? arch(res.runner_up) : null;
    const head = el("div", { class: "tech-head" }, box);
    el("div", { class: "eyebrow" }, head, T("Screening result"));
    el("div", { class: "tech-rec" }, head, rec.name);
    if (run) el("div", { class: "tech-run" }, head, T("Runner-up: {n}", { n: run.name }));
    if (res.boundary_case) el("div", { class: "pill warn" }, head, T("Boundary case: a shift of ±{d} in flexibility changes the pick — treat it as a choice between {a} and {b}.", { d: cat.config.boundary, a: rec.name, b: run ? run.name : "—" }));
    const sim = rec.simulated_as;
    if (sim) {
      const b = el("button", { class: "btn on" }, head, T("See it simulated in WH-{id}", { id: sim }));
      b.onclick = function () { ctx.goto(sim); };
    } else el("div", { class: "help" }, head, T("This app doesn't simulate this technology; WH-A (shelf-to-person) and WH-C (manual) are the nearest it does."));

    const nums = el("div", { class: "tech-nums" }, box);
    [[fmt(res.F_required, 1), T("flexibility the site needs")], [fmt(res.efficiency_pressure, 2), T("efficiency pressure (0–1)")], [fmt(res.F_target, 1), T("target flexibility after cost pressure")], [fmt(res.site_point.E, 1), T("efficiency on the frontier there")]].forEach(function (n) {
      const c = el("div", { class: "num" }, nums); el("b", {}, c, n[0]); el("span", {}, c, n[1]);
    });

    // drivers: what pushes the site towards flexibility (weight × normalised value)
    el("h2", {}, box, T("What drives the flexibility need"));
    const dl = el("div", { class: "drivers" }, box), maxw = Math.max.apply(null, cat.config.flexibility.map(function (f) { return f.weight; }));
    res.drivers.forEach(function (d) {
      const row = el("div", { class: "drow" }, dl);
      el("span", { class: "dlab" }, row, words(d.input).label);
      const bar = el("span", { class: "dbar" }, row); el("i", { style: "width:" + (100 * d.normalized * d.weight / maxw).toFixed(1) + "%" }, bar);
      el("span", { class: "dval" }, row, fmt(100 * d.normalized * d.weight, 1));
    });
    el("div", { class: "help" }, box, T("Points out of 100: weight × how far the input is towards its volatile end."));

    if (res.excluded.length) {
      el("h2", {}, box, T("Ruled out"));
      const ul = el("ul", { class: "excl" }, box);
      res.excluded.forEach(function (e) { const li = el("li", {}, ul); el("b", {}, li, arch(e.id).name); el("span", {}, li, e.reasons.map(function (x) { return x.text; }).join(" ")); });
    }

    el("h2", {}, box, rec.name);
    const card = el("dl", { class: "tech-card" }, box);
    [[T("How it works"), rec.mechanism], [T("Strengths"), rec.strengths], [T("Weaknesses"), rec.weaknesses], [T("Best fit"), rec.best_fit], [T("Example vendors"), rec.vendors.length ? rec.vendors.join(", ") : "—"]].forEach(function (r) { el("dt", {}, card, r[0]); el("dd", {}, card, r[1]); });
    el("div", { id: "techEvidence", class: "tech-evidence" }, box);
    drawEvidence();
    el("p", { class: "note-block tech-disclaimer" }, box, T("Indicative screening (catalogue {v}). The positions are expert judgement on 0–100 scales, not measurements, and the model leaves out capex, integration risk, labour availability and building limits such as clear height and floor load. A starting point, not an investment decision.", { v: res.version }));
  }

  // ---------------------------------------------------------------- evidence from the simulation
  // The spec's two technologies this app simulates (shelf-to-person = WH-A, manual = WH-C),
  // checked dimension by dimension against the comparison's current scenario
  // (WC.experiments.evidence). Computed once per set of comparison results.
  let ev = null, evFor = null, evBusy = false;
  function invalidate() { ev = null; evFor = null; }
  function drawEvidence() {
    const box = $("techEvidence"); if (!box) return;
    box.innerHTML = "";
    el("h2", {}, box, T("Evidence from the simulation"));
    const res = ctx.results();
    if (!res || !res.A || !res.C || !res.A.cost || !res.C.cost) { el("div", { class: "help" }, box, T("Waiting for the comparison…")); return; }
    if (!ev || evFor !== res.A) {
      el("div", { class: "help" }, box, T("Measuring WH-A and WH-C…"));
      if (evBusy) return;
      evBusy = true;
      setTimeout(function () {
        ev = WC.experiments.evidence(ctx.inputs(), res, cat); evFor = res.A; evBusy = false;
        drawEvidence();
      }, 30);
      return;
    }
    const a = arch(cat.archetypes.find(function (x) { return x.simulated_as === "A"; }).id).name, c = arch(cat.archetypes.find(function (x) { return x.simulated_as === "C"; }).id).name;
    el("p", { class: "note-block" }, box, T("The spec rates {a} and {c} by expert judgement; this app simulates them as WH-A and WH-C. For the comparison's current scenario ({l} lines a day, put-away: {p}), does the simulation point the same way? Each row reads {a} / WH-A first.",
      { a: a, c: c, l: WC.t.int(ev.lines_per_day), p: putAwayName(ev.policy) }));
    const tb = el("table", { class: "kpi evidence" }, box), hr = el("tr", {}, tb);
    [T("Dimension"), T("Experts (spec)"), T("Simulation"), T("Verdict")].forEach(function (h) { el("th", {}, hr, h); });
    const label = { labour: T("Efficiency: labour"), floor: T("Efficiency: floor"), cost: T("Efficiency: cost"), volume: T("Volume flexibility"), mix: T("Mix flexibility"), exit: T("Exit flexibility") };
    const expert = function (r) { return (["labour", "floor", "cost"].indexOf(r.key) >= 0 ? "E " : "") + T("{a} vs {c}", { a: fmt(r.expert.A, 0), c: fmt(r.expert.C, 0) }); };
    const measured = function (r) {
      const m = r.measured;
      switch (r.key) {
        case "labour": return T("{a} vs {c} lines per picker-hour", { a: fmt(m.A, 0), c: fmt(m.C, 0) });
        case "floor": return T("{a} vs {c} locations per m²", { a: fmt(m.A, 2), c: fmt(m.C, 2) });
        case "cost": return T("${a} vs ${c} per 1,000 lines", { a: fmt(m.A, 0), c: fmt(m.C, 0) });
        case "volume": return T("+{a}% vs +{c}% a year for {s}% more lines", { a: fmt(m.A, 1), c: fmt(m.C, 1), s: ev.volumeStep });
        case "mix": return T("+{a}% vs +{c}% travel per line after a demand shift", { a: fmt(m.A, 1), c: fmt(m.C, 1) });
        default: return T("{a}% vs {c}% of the build cost in equipment", { a: fmt(m.A, 0), c: fmt(m.C, 0) });
      }
    };
    const verdict = { agrees: "✓ " + T("agrees"), disagrees: "✗ " + T("disagrees"), close: "≈ " + T("too close to call") };
    ev.rows.forEach(function (r) {
      const tr = el("tr", {}, tb);
      el("td", {}, tr, label[r.key]); el("td", {}, tr, expert(r)); el("td", {}, tr, measured(r));
      el("td", { class: "v-" + r.verdict }, tr, verdict[r.verdict]);
    });
    const n = { agrees: 0, disagrees: 0, close: 0 }; ev.rows.forEach(function (r) { n[r.verdict]++; });
    el("p", { class: "note-block" }, box, T("The simulation agrees on {a} of {n} points, disagrees on {d} and can't separate the two on {c}.", { a: n.agrees, n: ev.rows.length, d: n.disagrees, c: n.close }));
    const ul = el("ul", { class: "ev-notes" }, box);
    [T("Floor: WH-C here is hand-picking shelving with 1.2 m aisles; WH-A's pods need robot aisles and spare slots, so manual shelving can be the denser store."),
     T("Mix: the simulation moves popularity between SKUs; the spec's mix flexibility also covers new item sizes and categories, which it doesn't model."),
     T("Exit: equipment is robots, pods and stations (WH-A) or shelving and pack stations (WH-C); the building is assumed to be reusable."),
     T("Costs here are the comparison's (in $), not the screen's euros. Two technologies and one scenario: evidence to weigh, not a calibration of the catalogue.")].forEach(function (t) { el("li", {}, ul, t); });
  }
  function putAwayName(pa) { return { fixed: T("Fixed home slot"), random: T("Random free slot"), nearest: T("Nearest free slot"), frequency: T("By popularity rank") }[pa]; }

  function update() {
    const res = WC.frontier.recommend(ctx.inputs().site, cat);
    drawMap(res); drawResult(res);
    ctx.changed();
  }

  // ---------------------------------------------------------------- wiring
  function init(c) {
    ctx = c; cat = c.catalogue;
    $("techExample").onclick = function () { Object.assign(ctx.inputs().site, cat.example_site); buildForm(); update(); };
    $("techFromApp").onclick = function () {
      const s = ctx.inputs().site, sc = ctx.inputs().sc;
      s.order_lines_per_day = Math.round(sc.lines_per_day); s.labour_cost_eur_per_hour = Math.round(sc.labour_cost_per_hour);
      buildForm(); mark("order_lines_per_day", true); mark("labour_cost_eur_per_hour", true); update();
    };
    $("techVersion").textContent = T("catalogue {v} · costs in €", { v: cat.version });
  }
  function show() {
    if (!built) { buildForm(); built = true; }
    update();
  }
  window.addEventListener("resize", function () { if (built && !$("viewTech").hidden) update(); });

  root.WC = root.WC || {}; root.WC.techview = { init: init, show: show, invalidate: invalidate };
})(typeof self !== "undefined" ? self : this);
