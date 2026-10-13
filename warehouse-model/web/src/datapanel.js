/*
 * datapanel.js — the "Data & Files" panel: import real movement/inventory data
 * (dataimport.js) and export the design as IFC, DXF, glTF, SVG or a FreeCAD
 * command (exporters.js). Owns only its own panel's DOM; sees the app through
 * window.WH.app like decisions.js.
 */
window.WH = window.WH || {};
window.WH.initDataPanel = function () {
  "use strict";
  const A = window.WH.app, model = A.model, data = window.WH.data, ex = window.WH.exporters, T = window.ROi18n.T, tw = window.ROi18n.tw;
  const $ = function (id) { return document.getElementById(id); };
  const esc = function (s) { return String(s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); };
  let texts = { movements: "", inventory: "" }, analysis = null;

  function download(name, content, type) {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(content instanceof Blob ? content : new Blob([content], { type: type }));
    a.download = name; document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
  }

  // ------------------------------------------------------------------ import
  function readFile(input, key) {
    input.addEventListener("change", function () {
      const f = input.files && input.files[0];
      if (!f) return;
      const r = new FileReader();
      r.onload = function () { texts[key] = String(r.result); $(key === "movements" ? "imp-mv-name" : "imp-inv-name").textContent = f.name; run(); };
      r.readAsText(f);
    });
  }
  readFile($("imp-mv"), "movements");
  readFile($("imp-inv"), "inventory");
  $("imp-sample").addEventListener("click", function () {
    const s = data.sample(7);
    texts = { movements: s.movements, inventory: s.inventory };
    $("imp-mv-name").textContent = T("sample-movements.csv (18,000 rows)");
    $("imp-inv-name").textContent = T("sample-inventory.csv (600 SKUs)");
    run();
  });
  $("imp-sample-dl").addEventListener("click", function () {
    const s = data.sample(7);
    download("sample-movements.csv", s.movements, "text/csv");
    setTimeout(function () { download("sample-inventory.csv", s.inventory, "text/csv"); }, 300);
  });

  function run() {
    if (!texts.movements) { $("imp-result").innerHTML = '<p class="hint">' + T("Choose a movements file (or try the sample) to begin.") + "</p>"; return; }
    analysis = data.analyse(texts.movements, texts.inventory);
    render();
  }
  const LABELS = {
    daily_throughput_pallets: [T("Pallet moves per day"), function (v) { return Math.round(v).toLocaleString("en-US"); }],
    peak_hour_factor: [T("Peak-hour factor"), function (v) { return (+v).toFixed(2) + "×"; }],
    operating_hours_per_day: [T("Operating hours per day"), function (v) { return v + " h"; }],
    current_inventory_pallets: [T("Pallets on hand"), function (v) { return Math.round(v).toLocaleString("en-US"); }],
    demand_skew: [T("Demand skew (moves from fastest 20%)"), function (v) { return Math.round(v) + "%"; }]
  };
  function render() {
    const r = analysis, el = $("imp-result");
    if (!r.ok) { el.innerHTML = '<p class="imp-error">' + r.errors.map(function (e) { return esc(tw(e)); }).join("<br>") + "</p>"; return; }
    let h = '<p class="dmsg">' + T("{r} rows · {d} days · {s} SKUs · {p} pallets moved", { r: r.used.toLocaleString("en-US"), d: r.days, s: r.skus.toLocaleString("en-US"), p: Math.round(r.totalPallets).toLocaleString("en-US") }) +
      (r.inbound || r.outbound ? " " + T("({p}% in)", { p: Math.round(r.inbound / r.totalPallets * 100) }) : "") + "</p>";
    h += '<table class="dtable imp-table"><thead><tr><th>' + T("Input") + "</th><th>" + T("From your data") + "</th><th>" + T("Model now") + "</th></tr></thead><tbody>";
    Object.keys(LABELS).forEach(function (k) {
      if (r.suggestions[k] === undefined) return;
      h += "<tr><th>" + LABELS[k][0] + "</th><td>" + LABELS[k][1](r.suggestions[k]) + "</td><td>" + LABELS[k][1](model.get(k)) + "</td></tr>";
    });
    h += "</tbody></table>";
    h += '<button class="btn small" id="imp-apply" type="button">' + T("Apply to the model") + "</button>";
    if (r.deep) {
      h += '<p class="panel-note imp-deep">' + T("Product mix: {s} SKUs, {p} pallets each on average. {a}% of pallets belong to SKUs with 4 or more (enough to fill double-deep lanes on both sides), {b}% to SKUs with 10 or more (drive-in lanes). The rest need selective or VNA racking — use this for the optimiser's selectivity target.",
        { s: r.deep.skus, p: r.deep.perSku.toFixed(1), a: Math.round(r.deep.ge4 * 100), b: Math.round(r.deep.ge10 * 100) }) + "</p>";
    }
    h += '<ul class="imp-notes">' + r.notes.map(function (n) { return "<li>" + esc(tw(n)) + "</li>"; }).join("") + "</ul>";
    el.innerHTML = h + lorenzSVG(r);
    $("imp-apply").addEventListener("click", function () {
      model.setMany(r.suggestions);
      $("imp-apply").textContent = T("Applied ✓");
    });
  }
  function lorenzSVG(r) {
    const W = 300, H = 200, p = 30, X = function (v) { return p + v * (W - p - 10); }, Y = function (v) { return H - p - v * (H - p - 10); };
    let s = '<svg viewBox="0 0 ' + W + " " + H + '" width="100%" class="lorenz" role="img" aria-label="' + T("Share of moves against share of {b}, fastest movers first", { b: r.skewBasis === "SKUs" ? "SKUs" : T("pallets") }) + '">';
    s += '<rect x="' + X(0) + '" y="' + Y(1) + '" width="' + (X(1) - X(0)) + '" height="' + (Y(0) - Y(1)) + '" fill="none" stroke="#2a5580"/>';
    s += '<line x1="' + X(0) + '" y1="' + Y(0) + '" x2="' + X(1) + '" y2="' + Y(1) + '" stroke="#6fa8c9" stroke-dasharray="3,3"/>';
    s += '<polyline fill="none" stroke="#7be0c4" stroke-width="2" points="' + r.curve.map(function (q) { return X(q[0]).toFixed(1) + "," + Y(q[1]).toFixed(1); }).join(" ") + '"/>';
    s += '<line x1="' + X(0.2) + '" y1="' + Y(0) + '" x2="' + X(0.2) + '" y2="' + Y(r.skew) + '" stroke="#f5b833" stroke-dasharray="3,2"/><line x1="' + X(0) + '" y1="' + Y(r.skew) + '" x2="' + X(0.2) + '" y2="' + Y(r.skew) + '" stroke="#f5b833" stroke-dasharray="3,2"/>';
    s += '<text x="' + (X(0.2) + 4) + '" y="' + (Y(r.skew) - 4) + '" fill="#f5b833" font-size="10">' + T("{p}% of moves", { p: Math.round(r.skew * 100) }) + "</text>";
    s += '<text x="' + X(0.5) + '" y="' + (H - 8) + '" fill="#6fa8c9" font-size="9" text-anchor="middle">' + T("share of {b}, fastest-moving first", { b: r.skewBasis === "SKUs" ? "SKUs" : T("pallets") }) + "</text>";
    s += '<text x="10" y="' + Y(0.5) + '" fill="#6fa8c9" font-size="9" text-anchor="middle" transform="rotate(-90 10 ' + Y(0.5) + ')">' + T("share of moves") + "</text></svg>";
    return s;
  }

  // ------------------------------------------------------------------ export
  const stamp = function () { return new Date().toISOString().slice(0, 10); };
  $("exp-ifc").addEventListener("click", function () {
    download("warehouse-" + stamp() + ".ifc", ex.toIFC(model.getAll(), A.results(), { version: A.version, fileName: "warehouse-" + stamp() + ".ifc" }), "application/x-step");
  });
  $("exp-dxf").addEventListener("click", function () { download("warehouse-plan-" + stamp() + ".dxf", ex.toDXF(model.getAll(), A.results()), "application/dxf"); });
  $("exp-glb").addEventListener("click", function () {
    const btn = $("exp-glb"), viz = A.viz();
    if (!viz || viz.mode !== "live") { $("exp-msg").textContent = T("Switch to the Live Parametric View to export the 3D model."); return; }
    btn.disabled = true; $("exp-msg").textContent = T("Building the 3D file…");
    viz.exportGLB(function (glb, err) {
      btn.disabled = false;
      if (err) { $("exp-msg").textContent = T("3D export failed: {e}", { e: err }); return; }
      download("warehouse-3d-" + stamp() + ".glb", new Blob([glb], { type: "model/gltf-binary" }));
      $("exp-msg").textContent = T("3D model saved ({v} MB).", { v: (glb.byteLength / 1048576).toFixed(1) });
    });
  });
  $("exp-svg").addEventListener("click", function () { $("btn-svg").click(); });
  function showCommand() { $("exp-fc").textContent = ex.freecadCommand(model.getAll(), model.defaults); }
  $("exp-fc-copy").addEventListener("click", function () {
    const t = $("exp-fc").textContent;
    try { navigator.clipboard.writeText(t).then(function () { $("exp-msg").textContent = T("Command copied."); }, function () { $("exp-msg").textContent = T("Select the command and copy it."); }); } catch (e) { $("exp-msg").textContent = T("Select the command and copy it."); }
  });
  A.onRecompute(function () { showCommand(); if (analysis && analysis.ok) render(); });
  showCommand();
  run();
  window.WH.dataPanel = { analysis: function () { return analysis; } };
};
