import { clamp, startingPoint, simulate, classify, parseCSV } from "./model.js";

const CLS = { over: "Overheated", under: "Underpriced", proven: "Proven", emerg: "Emerging" };
const ACT = {
  over: "Expectations exceed evidence. Fund small, staged options with explicit kill criteria. Avoid multi-year commitments until the watch signal moves.",
  under: "Delivering more than the market credits. Build capability now, while attention and vendor pricing are still low.",
  proven: "Evidence supports expectations. Scale with standard business cases and clear operating ownership.",
  emerg: "Low expectations, low evidence. Hold a cheap option: monitor, keep a small research budget and set a review trigger.",
};
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const $ = id => document.getElementById(id);
const fmtSigned = v => (v > 0 ? "+" : "") + v.toFixed(0);

// ---------- load data ----------
async function getJSON(p) { const r = await fetch(p, { cache: "no-cache" }); if (!r.ok) throw new Error(`${p}: ${r.status}`); return r.json(); }
async function getText(p) { const r = await fetch(p, { cache: "no-cache" }); if (!r.ok) throw new Error(`${p}: ${r.status}`); return r.text(); }

let CFG, SCEN, SET, SIG, HIST, ASSESS, CAND;
let overrides = {};   // local what-if edits, never saved
const st = { drivers: {}, horizon: 3, correction_speed: 0.4, preset: "base", sel: "ai-agents", all: false, mode: "blend" };

async function boot() {
  try {
    [CFG, SCEN, SET, SIG, HIST, ASSESS, CAND] = await Promise.all([
      getJSON("data/technologies.json"), getJSON("data/scenarios.json"), getJSON("data/settings.json"),
      getJSON("data/signals.json").catch(() => ({ technologies: {} })),
      getJSON("data/history.json").catch(() => ({ snapshots: [] })),
      getText("data/assessments.csv").then(parseCSV),
      getJSON("data/candidates.json").catch(() => null),
    ]);
  } catch (e) {
    document.querySelector(".wrap").insertAdjacentHTML("afterbegin",
      `<div class="panel err"><h2>Data could not be loaded</h2><p class="note">${esc(e.message)}. Open the app through a web server (GitHub Pages, or <code>python -m http.server</code> locally), not as a file.</p></div>`);
    return;
  }
  st.horizon = SET.defaults.horizon;
  st.correction_speed = SET.defaults.correction_speed;
  st.preset = SET.defaults.scenario;
  st.drivers = { ...SCEN.presets.find(p => p.id === st.preset).values };
  if (!hasSignals()) st.mode = "analyst";
  readHash();
  buildControls();
  drawFrame();
  syncControls();
  render();
  renderCandidates();
}

const hasSignals = () => SIG && SIG.generated && Object.keys(SIG.technologies || {}).length > 0;

function items() {
  const A = Object.fromEntries(ASSESS.map(a => [a.id, a]));
  return CFG.technologies.filter(t => A[t.id]).map(t => {
    const a = A[t.id];
    const base = { expectations: +a.expectations, evidence: +a.evidence };
    const ov = overrides[t.id] || {};
    const blendCfg = { mode: st.mode, ...SET.blend };
    const sig = SIG.technologies?.[t.id];
    const sp = startingPoint({ expectations: ov.h ?? base.expectations, evidence: ov.e ?? base.evidence }, sig, blendCfg);
    return { ...t, impact: ov.i ?? +a.impact, analyst: { ...base, impact: +a.impact }, reviewed: a.reviewed, notes: a.notes, sig, h0: sp.h0, e0: sp.e0, edited: !!overrides[t.id] };
  });
}

// ---------- URL state (shareable views) ----------
function readHash() {
  const p = new URLSearchParams(location.hash.slice(1));
  if (p.has("s")) { const pr = SCEN.presets.find(x => x.id === p.get("s")); if (pr) { st.preset = pr.id; st.drivers = { ...pr.values }; } }
  SCEN.drivers.forEach(d => { if (p.has(d.key)) { st.drivers[d.key] = clamp(+p.get(d.key) || 0, -1, 1); st.preset = null; } });
  if (p.has("t")) st.horizon = clamp(+p.get("t") || 0, 0, 5);
  if (p.has("k")) st.correction_speed = clamp(+p.get("k") || .4, .1, 1);
  if (p.has("m") && ["analyst", "blend", "signals"].includes(p.get("m")) && (p.get("m") === "analyst" || hasSignals())) st.mode = p.get("m");
  if (p.has("sel") && CFG.technologies.some(t => t.id === p.get("sel"))) st.sel = p.get("sel");
}
function writeHash() {
  const p = new URLSearchParams();
  if (st.preset) p.set("s", st.preset); else SCEN.drivers.forEach(d => p.set(d.key, st.drivers[d.key]));
  p.set("t", st.horizon); p.set("k", st.correction_speed); p.set("m", st.mode); p.set("sel", st.sel);
  history.replaceState(null, "", "#" + p.toString());
}

// ---------- chart ----------
const W = 680, Hh = 540, M = { l: 58, r: 18, t: 18, b: 52 }, PW = W - M.l - M.r, PH = Hh - M.t - M.b;
const X = e => M.l + e / 100 * PW, Y = h => M.t + (1 - h / 100) * PH;
const NS = "http://www.w3.org/2000/svg";
const svg = $("map");
function el(t, a, p) { const n = document.createElementNS(NS, t); for (const k in a) n.setAttribute(k, a[k]); (p || svg).appendChild(n); return n; }
const pts = a => a.map(([e, h]) => X(e) + "," + Y(h)).join(" ");
let gGhost, gBub, gLbl;

function drawFrame() {
  const t = SET.thresholds, o = t.overheated_gap, u = -t.underpriced_gap;
  el("polygon", { points: pts([[0, o], [0, 100], [100 - o, 100]]), style: "fill:var(--over-soft)" });
  el("polygon", { points: pts([[u, 0], [100, 0], [100, 100 - u]]), style: "fill:var(--under-soft)" });
  for (let v = 0; v <= 100; v += 20) {
    el("line", { x1: X(v), x2: X(v), y1: Y(0), y2: Y(100), style: "stroke:var(--grid)" });
    el("line", { x1: X(0), x2: X(100), y1: Y(v), y2: Y(v), style: "stroke:var(--grid)" });
    el("text", { x: X(v), y: Y(0) + 16, "text-anchor": "middle", class: "ax" }).textContent = v;
    el("text", { x: X(0) - 8, y: Y(v) + 4, "text-anchor": "end", class: "ax" }).textContent = v;
  }
  el("line", { x1: X(0), y1: Y(0), x2: X(100), y2: Y(100), style: "stroke:var(--muted);stroke-dasharray:3 4;opacity:.6" });
  const pe = t.proven_evidence;
  el("line", { x1: X(pe), y1: Y(pe - u), x2: X(pe), y2: Y(Math.min(100, pe + o)), style: "stroke:var(--muted);stroke-dasharray:2 4;opacity:.5" });
  el("text", { x: X(2), y: Y(94), class: "zone-l", style: "fill:var(--over)" }).textContent = "OVERHEATED · stage the bet";
  el("text", { x: X(98), y: Y(3), "text-anchor": "end", class: "zone-l", style: "fill:var(--under)" }).textContent = "UNDERPRICED · build quietly";
  el("text", { x: X(98), y: Y(95), "text-anchor": "end", class: "zone-l", style: "fill:var(--proven)" }).textContent = "PROVEN · scale";
  el("text", { x: X(2), y: Y(3), class: "zone-l", style: "fill:var(--emerg)" }).textContent = "EMERGING · hold an option";
  el("text", { x: X(50), y: Hh - 10, "text-anchor": "middle", class: "axt" }).textContent = "Demonstrated value (evidence) →";
  el("text", { x: 16, y: Y(50), "text-anchor": "middle", class: "axt", transform: `rotate(-90 16 ${Y(50)})` }).textContent = "Market expectations (hype) →";
  gGhost = el("g", {}); gBub = el("g", {}); gLbl = el("g", {});
  $("thresholdNote").textContent = `Classes: a gap above +${o} is overheated, below ${t.underpriced_gap} is underpriced; inside that band, evidence of ${pe} or more is proven, below ${pe} is emerging.`;
}

function render() {
  const T = SET.thresholds;
  const res = items().map(it => {
    const p = simulate(it, st, SET.model);
    return { ...it, ...p, c: classify(p.H, p.E, T), gap: p.H - p.E, c0: classify(it.h0, it.e0, T) };
  });
  gGhost.replaceChildren(); gBub.replaceChildren(); gLbl.replaceChildren();
  [...res].sort((a, b) => b.impact - a.impact).forEach(d => {
    const rad = 4 + d.impact / 100 * 12, sel = d.id === st.sel;
    if (st.horizon > 0) {
      el("line", { x1: X(d.e0), y1: Y(d.h0), x2: X(d.E), y2: Y(d.H), style: "stroke:var(--muted);opacity:.45" }, gGhost);
      el("circle", { cx: X(d.e0), cy: Y(d.h0), r: 2.5, style: "fill:none;stroke:var(--muted);opacity:.7" }, gGhost);
    }
    const c = el("circle", { cx: X(d.E), cy: Y(d.H), r: rad, class: "bub", tabindex: 0, role: "button", "aria-label": d.name,
      style: `fill:var(--${d.c});fill-opacity:${sel ? 1 : .78};stroke:${sel ? "var(--ink)" : "var(--panel)"};stroke-width:${sel ? 2.5 : 1.2}` }, gBub);
    const show = () => showTip(d, c);
    c.addEventListener("pointerenter", show);
    c.addEventListener("focus", show);
    c.addEventListener("pointerleave", hideTip);
    c.addEventListener("blur", hideTip);
    c.addEventListener("click", () => select(d.id));
    c.addEventListener("keydown", ev => { if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); select(d.id); } });
    if (st.all || sel || d.impact >= 80 || Math.abs(d.gap) > 40) {
      const right = X(d.E) + rad + 3 > W - 150;
      el("text", { x: right ? X(d.E) - rad - 3 : X(d.E) + rad + 3, y: Y(d.H) + 4, "text-anchor": right ? "end" : "start", class: "lbl", style: sel ? "font-weight:700" : "" }, gLbl).textContent = d.name;
    }
  });
  const pr = SCEN.presets.find(p => p.id === st.preset);
  $("chartTitle").textContent = st.horizon === 0 ? "Expectation gap map · today"
    : `Expectation gap map · ${st.horizon} year${st.horizon === 1 ? "" : "s"} out · ${pr ? pr.name : "Custom scenario"}`;

  const cnt = k => res.filter(d => d.c === k).length;
  const top = [...res].sort((a, b) => b.gap - a.gap)[0];
  $("stats").innerHTML =
    `<div class="stat"><b style="color:var(--over)">${cnt("over")}</b><span>Overheated</span></div>` +
    `<div class="stat"><b style="color:var(--under)">${cnt("under")}</b><span>Underpriced</span></div>` +
    `<div class="stat"><b>${res.filter(d => d.c !== d.c0).length}</b><span>Changed class vs today</span></div>` +
    `<div class="stat"><b>${fmtSigned(top.gap)}</b><span>Largest gap: ${esc(top.name)}</span></div>`;

  const row = (d, cl, txt, val) => `<button class="row" data-id="${d.id}" aria-current="${d.id === st.sel}"><span class="pill p-${cl}">${fmtSigned(val ?? d.gap)}</span><span><strong>${esc(d.name)}</strong><small>${esc(txt)}</small></span></button>`;
  const over = res.filter(d => d.c === "over").sort((a, b) => b.gap * b.impact - a.gap * a.impact).slice(0, 6);
  const under = res.filter(d => d.c === "under").sort((a, b) => a.gap - b.gap).slice(0, 4);
  $("overList").innerHTML = over.length ? over.map(d => row(d, "over", "Watch: " + d.watch_signal)).join("") : `<p class="empty">Nothing overheated in this scenario.</p>`;
  $("underList").innerHTML = under.length ? under.map(d => row(d, "under", "Watch: " + d.watch_signal)).join("") : `<p class="empty">Nothing underpriced in this scenario.</p>`;

  const flag = SET.review_flag_gap;
  const rev = res.filter(d => d.sig && Number.isFinite(d.sig.expectations_index) && Math.abs(d.sig.expectations_index - d.analyst.expectations) > flag)
    .sort((a, b) => Math.abs(b.sig.expectations_index - b.analyst.expectations) - Math.abs(a.sig.expectations_index - a.analyst.expectations)).slice(0, 5);
  $("reviewSec").hidden = !rev.length;
  $("reviewList").innerHTML = rev.map(d => row(d, "emerg", `Analyst ${d.analyst.expectations}, signals ${d.sig.expectations_index.toFixed(0)}. Last reviewed ${d.reviewed}.`, d.sig.expectations_index - d.analyst.expectations)).join("");
  document.querySelectorAll(".row").forEach(b => b.onclick = () => select(b.dataset.id));

  renderDetail(res.find(d => d.id === st.sel) || res[0]);
  writeHash();
}

function sparkline(id) {
  const pts = (HIST.snapshots || []).map(s => ({ p: s.period, v: s.technologies?.[id]?.expectations_index })).filter(x => Number.isFinite(x.v));
  if (pts.length < 2) return `<p class="note">Trend appears after two monthly refreshes.</p>`;
  const w = 140, h = 44, n = pts.length, xs = i => 2 + i / (n - 1) * (w - 4), ys = v => h - 3 - v / 100 * (h - 6);
  const line = pts.map((p, i) => `${xs(i)},${ys(p.v)}`).join(" ");
  const last = pts[n - 1];
  return `<svg class="spark" viewBox="0 0 ${w} ${h}" role="img" aria-label="Attention index trend, ${pts[0].p} to ${last.p}">
    <polygon class="ar" points="${xs(0)},${h} ${line} ${xs(n - 1)},${h}"/><polyline class="ln" points="${line}"/>
    <circle class="pt" cx="${xs(n - 1)}" cy="${ys(last.v)}" r="2.5"/></svg>`;
}

// ---------- what a technology is, on hover or focus ----------
function showTip(d, node) {
  const tip = $("tip"), box = tip.parentElement.getBoundingClientRect(), b = node.getBoundingClientRect();
  tip.innerHTML = `<b>${esc(d.name)}</b> <span class="pill p-${d.c}">${CLS[d.c]}</span>
    <span class="tip-n">Expectations ${d.H.toFixed(0)} · evidence ${d.E.toFixed(0)}</span>
    <p>${esc(d.description ?? "")}</p><span class="tip-n">Select it for a supply chain example.</span>`;
  tip.hidden = false;
  const x = b.left - box.left + b.width / 2, y = b.top - box.top + b.height / 2;
  const left = Math.min(Math.max(8, x - tip.offsetWidth / 2), box.width - tip.offsetWidth - 8);
  const above = y - tip.offsetHeight - 14;
  tip.style.left = `${left}px`;
  tip.style.top = `${above >= 4 ? above : y + 14}px`;
}
function hideTip() { $("tip").hidden = true; }

// ---------- candidates: rising terms the board does not track yet ----------
function renderCandidates() {
  const list = CAND?.candidates ?? [];
  if (!list.length) return;
  $("candidates").hidden = false;
  const n = (s) => (s ? `${s.now} titles (${s.before} before)` : "–");
  $("candNote").innerHTML = `Found automatically in AI story titles on Hacker News and paper titles on arXiv, ${esc(CAND.period)}: phrases that are rising and that the board does not track. Many are noise (product names, one-off news); a term earns a place on the board only when an analyst scores it. <a href="https://github.com/kathuman/claude-projects/tree/main/ai-expectations-gap-map#adding-a-technology">How to add a technology</a>.`;
  $("candList").innerHTML = list.map((c) => {
    const w = c.wikipedia;
    const ACRO = /^(ai|llm|llms|gpu|gpus|ml|rl|rag|api|apis|ar|vr|iot)$/;
    const title = c.phrase.split(" ").map((w, i) => (ACRO.test(w) ? w.toUpperCase().replace(/S$/, "s") : i ? w : w[0].toUpperCase() + w.slice(1))).join(" ");
    const desc = w ? `<p>${esc(w.extract.length > 320 ? w.extract.slice(0, 317).replace(/\s+\S*$/, "") + "…" : w.extract)} <a href="${esc(w.url)}" target="_blank" rel="noopener">Wikipedia: ${esc(w.title)}</a></p>`
      : `<p class="meta">No Wikipedia article yet. What people are writing:</p>`;
    const ex = (w ? [] : c.examples).map((e) => `<li><a href="${esc(e.url)}" target="_blank" rel="noopener">${esc(e.title)}</a></li>`).join("");
    return `<div class="tech"><h3>${esc(title)}</h3>${desc}${ex ? `<ul class="ex">${ex}</ul>` : ""}
      <p class="meta">Hacker News ${n(c.sources.hn)} · arXiv ${n(c.sources.arxiv)} · candidate ${c.seen.length === 1 ? "for the first time" : `in ${c.seen.length} months since ${esc(c.seen[0])}`}</p></div>`;
  }).join("");
}

function renderDetail(d) {
  const sens = SCEN.drivers.map(dr => {
    const v = d.sensitivities[dr.key] || 0, w = Math.abs(v) * 50;
    return `<div><span>${esc(dr.name)}</span><span class="bar"><i style="left:${v >= 0 ? 50 : 50 - w}%;width:${w}%;background:${v >= 0 ? "var(--accent)" : "var(--over)"}"></i><i style="left:50%;width:1px;background:var(--muted)"></i></span><output>${v > 0 ? "+" : ""}${v.toFixed(1)}</output></div>`;
  }).join("");
  const s = d.sig;
  const raw = s?.raw || {};
  const sigBlock = s ? `
    <div class="eyebrow">Collected signals · ${esc(SIG.period || "")}</div>
    <div class="sig"><table>
      <tr><td>Attention index (expectations)</td><td>${Number.isFinite(s.expectations_index) ? s.expectations_index.toFixed(0) : "n/a"}</td></tr>
      <tr><td>Usage proxy index (evidence)</td><td>${Number.isFinite(s.evidence_index) ? s.evidence_index.toFixed(0) : "n/a"}</td></tr>
      <tr><td>Wikipedia views, last 3 months</td><td>${raw.wikipedia_views?.toLocaleString() ?? "n/a"}</td></tr>
      <tr><td>Hacker News stories, last 3 months</td><td>${raw.hn_stories?.toLocaleString() ?? "n/a"}</td></tr>
      <tr><td>Momentum vs prior 3 months</td><td>${Number.isFinite(raw.momentum) ? (raw.momentum > 0 ? "+" : "") + (raw.momentum * 100).toFixed(0) + "%" : "n/a"}</td></tr>
      <tr><td>arXiv papers, last 3 months</td><td>${raw.arxiv_papers?.toLocaleString() ?? "n/a"}</td></tr>
      <tr><td>PyPI downloads, last month</td><td>${raw.pypi_downloads?.toLocaleString() ?? "n/a"}</td></tr>
    </table>${sparkline(d.id)}</div>` : `<p class="note">No collected signals yet. The first monthly refresh fills this in.</p>`;
  $("detail").innerHTML = `
    <div class="detail-top"><div><div class="eyebrow">Selected · Gartner 2026: ${esc(d.gartner_phase_2026)}</div><h2 style="font-size:22px">${esc(d.name)}</h2></div>
    <span class="pill p-${d.c}" style="font-size:13px;padding:4px 10px">${CLS[d.c]}${d.c !== d.c0 ? ` (today: ${CLS[d.c0]})` : ""}</span></div>
    ${d.description ? `<p class="what">${esc(d.description)}</p>` : ""}
    ${d.supply_chain_example ? `<div class="action scm"><b>In supply chain management.</b> ${esc(d.supply_chain_example)}</div>` : ""}
    <p class="note"><a href="about.html#technologies">What every technology on the board is</a></p>
    <div class="kv">
      <div><span>Expectations</span><b>${d.H.toFixed(0)}</b> <em>today ${d.h0.toFixed(0)}</em></div>
      <div><span>Evidence</span><b>${d.E.toFixed(0)}</b> <em>today ${d.e0.toFixed(0)}</em></div>
      <div><span>Gap</span><b style="color:var(--${d.c})">${fmtSigned(d.gap)}</b> <em>today ${fmtSigned(d.h0 - d.e0)}</em></div>
    </div>
    <div class="action"><b>What to do.</b> ${ACT[d.c]}<br><b>Signal to watch.</b> ${esc(d.watch_signal)}.</div>
    <p class="note">Analyst view (reviewed ${esc(d.reviewed)}): ${esc(d.notes)}</p>
    <div class="eyebrow" style="margin-top:14px">Sensitivity to drivers</div>
    <div class="sens">${sens}</div>
    ${sigBlock}
    <div class="eyebrow">What-if: adjust the analyst scores (this browser only, not saved)</div>
    <div class="edit">
      <label for="eh">Expectations<input id="eh" type="number" min="0" max="100" value="${overrides[d.id]?.h ?? d.analyst.expectations}"></label>
      <label for="ee">Evidence<input id="ee" type="number" min="0" max="100" value="${overrides[d.id]?.e ?? d.analyst.evidence}"></label>
      <label for="ei">Impact<input id="ei" type="number" min="0" max="100" value="${d.impact}"></label>
      <button class="btn" id="reset" ${d.edited ? "" : "hidden"}>Restore assessment</button>
    </div>`;
  [["eh", "h"], ["ee", "e"], ["ei", "i"]].forEach(([id, f]) => $(id).addEventListener("change", ev => {
    overrides[d.id] = { ...(overrides[d.id] || {}), [f]: clamp(+ev.target.value || 0, 0, 100) }; render();
  }));
  $("reset").onclick = () => { delete overrides[d.id]; render(); };
}
function select(id) { st.sel = id; render(); }

// ---------- controls ----------
const ctl = {};
function slider(id, nm, ds, min, max, step, val, fmt, on) {
  const l = document.createElement("label"); l.setAttribute("for", id);
  l.innerHTML = `<span class="nm">${esc(nm)}</span><output></output><input id="${id}" type="range" min="${min}" max="${max}" step="${step}" value="${val}"><span class="ds">${esc(ds)}</span>`;
  $("drivers").appendChild(l);
  const inp = l.querySelector("input"), out = l.querySelector("output");
  out.textContent = fmt(+inp.value);
  inp.addEventListener("input", () => { out.textContent = fmt(+inp.value); on(+inp.value); });
  return { inp, out, fmt };
}
function buildControls() {
  SCEN.presets.forEach(p => {
    const b = document.createElement("button"); b.className = "chip"; b.textContent = p.name; b.dataset.id = p.id;
    b.onclick = () => { st.preset = p.id; st.drivers = { ...p.values }; syncControls(); render(); };
    $("presets").appendChild(b);
  });
  ctl.horizon = slider("horizon", "Time horizon", "Years ahead to project. Zero shows today's starting positions.", 0, 5, .5, st.horizon, v => v + " yr", v => { st.horizon = v; render(); });
  ctl.k = slider("speed", "Hype correction speed", "How fast expectations converge on evidence. High means sharp corrections.", .1, 1, .05, st.correction_speed, v => v.toFixed(2), v => { st.correction_speed = v; render(); });
  SCEN.drivers.forEach(dr => {
    ctl[dr.key] = slider("d_" + dr.key, dr.name, dr.description + ". Left is weaker than today, right is stronger.", -1, 1, .1, st.drivers[dr.key] || 0,
      v => (v > 0 ? "+" : "") + v.toFixed(1), v => { st.drivers[dr.key] = v; st.preset = null; syncControls(); render(); });
  });
  document.querySelectorAll("#sources .chip").forEach(b => {
    if (b.dataset.mode !== "analyst" && !hasSignals()) b.disabled = true;
    b.onclick = () => { st.mode = b.dataset.mode; syncControls(); render(); };
  });
  $("allLbl").onchange = e => { st.all = e.target.checked; render(); };
  $("share").onclick = async () => {
    writeHash();
    try { await navigator.clipboard.writeText(location.href); $("share").textContent = "Link copied"; }
    catch { $("share").textContent = "Copy the address bar"; }
    setTimeout(() => $("share").textContent = "Copy link to this view", 2000);
  };
}
function syncControls() {
  SCEN.drivers.forEach(dr => { const c = ctl[dr.key]; c.inp.value = st.drivers[dr.key] || 0; c.out.textContent = c.fmt(+c.inp.value); });
  ctl.horizon.inp.value = st.horizon; ctl.horizon.out.textContent = ctl.horizon.fmt(st.horizon);
  ctl.k.inp.value = st.correction_speed; ctl.k.out.textContent = ctl.k.fmt(st.correction_speed);
  document.querySelectorAll("#presets .chip").forEach(b => b.setAttribute("aria-pressed", b.dataset.id === st.preset));
  document.querySelectorAll("#sources .chip").forEach(b => b.setAttribute("aria-pressed", b.dataset.mode === st.mode));
  const pr = SCEN.presets.find(p => p.id === st.preset);
  $("scenNote").textContent = pr ? pr.note : "Custom scenario: driver settings changed by hand.";
  const reviewed = ASSESS.map(a => a.reviewed).filter(Boolean).sort().pop();
  const sigTxt = hasSignals() ? `Signals collected ${SIG.generated.slice(0, 10)} for ${SIG.period}.` : "Signals not collected yet; showing analyst assessment only.";
  const modeTxt = { analyst: "Positions use analyst scores only.", blend: `Positions blend analyst scores with signals (${Math.round(SET.blend.expectations_signal_weight * 100)}% signal weight on expectations, ${Math.round(SET.blend.evidence_signal_weight * 100)}% on evidence).`, signals: "Positions use collected signals wherever they exist." }[st.mode];
  $("dataNote").textContent = `Analyst assessment last reviewed ${reviewed}. ${sigTxt} ${modeTxt}`;
  $("eyebrow").textContent = `AI portfolio board · ${CFG.technologies.length} technologies · data as of ${hasSignals() ? SIG.period : reviewed}`;
}

boot();
