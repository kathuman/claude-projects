import { clamp, startingPoint, simulate, classify, parseCSV } from "./model.js";
import { RUBRIC, band, rankOf, change, composition, outlook } from "./explain.js";

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
const st = { drivers: {}, horizon: 3, correction_speed: 0.4, preset: "base", sel: "ai-agents", all: false, mode: "blend", tab: "overview" };

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
  if (p.has("tab") && TABS.some(([k]) => k === p.get("tab"))) st.tab = p.get("tab");
}
function writeHash() {
  const p = new URLSearchParams();
  if (st.preset) p.set("s", st.preset); else SCEN.drivers.forEach(d => p.set(d.key, st.drivers[d.key]));
  p.set("t", st.horizon); p.set("k", st.correction_speed); p.set("m", st.mode); p.set("sel", st.sel);
  if (st.tab !== "overview") p.set("tab", st.tab);
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
    <p>${esc(d.description ?? "")}</p><span class="tip-n">Click for its card: evidence, expectations, outlook.</span>`;
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

// ---------- the selected technology: an overview, and the evidence behind each number ----------
const TABS = [["overview", "Overview"], ["expectations", "Expectations"], ["evidence", "Evidence"], ["outlook", "Where it's heading"]];
const fmtN = v => (v == null || !Number.isFinite(v) ? "n/a" : Math.round(v).toLocaleString("en-GB"));
const fmtPct = x => `${x > 0 ? "+" : ""}${Math.round(x * 100)} %`;
const ordinal = n => n + (n % 100 >= 11 && n % 100 <= 13 ? "th" : ["th", "st", "nd", "rd"][n % 10] || "th");
const monthsOf = w => {
  if (!w) return "the last three months";
  const m = d => new Date(`${d}T12:00:00Z`).toLocaleDateString("en-GB", { month: "short", timeZone: "UTC" });
  return `${m(w[0])}–${m(w[1])} ${w[1].slice(0, 4)}`;
};
const horizonWord = t => (t === 0 ? "Now" : t < 1 ? `${Math.round(t * 12)} months` : `${+t.toFixed(2)} year${t === 1 ? "" : "s"}`);

// Where a score sits on its rubric scale: five labelled bands and a marker.
function scale(axis, v) {
  const b = band(axis, v);
  return `<div class="scale" role="img" aria-label="${esc(axis)} ${v.toFixed(0)} of 100, ${esc(b.anchor)}">
    ${RUBRIC[axis].map(([lo, hi, a], i) => `<div class="seg${i === b.index ? " on" : ""}"><span>${lo}–${hi}</span><b>${esc(a)}</b></div>`).join("")}
    <i class="mark" style="left:${clamp(v, 0, 100)}%"></i></div>
    <p class="band"><b>${v.toFixed(0)} · ${esc(b.anchor)}.</b> Typically: ${esc(b.signs)}</p>`;
}

// How the board's number is built: the analyst score and the signal index, with their weights.
function built(c, word, signalName, why) {
  const label = { analyst: "Analyst score", signal: signalName };
  const bar = c.parts.map(x => `<i class="${x.source}" style="width:${x.contribution}%" title="${esc(label[x.source])}"></i>`).join("");
  const sum = c.parts.map(x => c.parts.length > 1 ? `${esc(label[x.source])} ${x.value.toFixed(0)} × ${Math.round(x.weight * 100)} % = ${x.contribution.toFixed(1)}`
    : `${esc(label[x.source])} ${x.value.toFixed(0)}`).join(" + ");
  return `<div class="built"><div class="bbar">${bar}</div>
    <p>${sum}${c.parts.length > 1 ? ` → <b>${c.total.toFixed(0)}</b>` : ""}.</p>
    ${c.missing ? `<p class="note">${esc(why)}</p>` : ""}</div>`;
}

// One signal in plain words, with where it ranks on the board.
function signalRow(name, valueText, detail, rk, explain) {
  const pos = rk ? (rk.of > 1 ? (rk.of - rk.rank) / (rk.of - 1) : 1) : null;
  return `<div class="srow"><div class="shead"><b>${esc(name)}</b><span>${valueText}</span></div>
    ${rk ? `<div class="rank" aria-hidden="true"><i style="left:${(pos * 100).toFixed(1)}%"></i></div>
      <p>${detail} <span class="rk">${ordinal(rk.rank)} of ${rk.of} on the board.</span></p>` : `<p>${detail}</p>`}
    <p class="note">${explain}</p></div>`;
}

function measure(field) {
  return Object.fromEntries(Object.entries(SIG.technologies || {}).map(([k, v]) => [k, v?.raw?.[field] ?? null]));
}

function tabExpectations(d, aH) {
  const s = d.sig, raw = s?.raw || {}, when = monthsOf(SIG.window?.current);
  const c = composition(aH, s?.expectations_index, SET.blend.expectations_signal_weight, st.mode);
  const wikiCh = change(raw.wikipedia_views, raw.wikipedia_views_prior), hnCh = change(raw.hn_stories, raw.hn_stories_prior);
  const flag = s && Number.isFinite(s.expectations_index) && Math.abs(s.expectations_index - aH) > SET.review_flag_gap;
  const rows = s ? [
    signalRow("Attention index", `${fmtN(s.expectations_index)} of 100`, `Combines the three signals below: 40 % Wikipedia, 40 % Hacker News, 20 % momentum.`,
      rankOf(d.id, Object.fromEntries(Object.entries(SIG.technologies).map(([k, v]) => [k, v.expectations_index]))),
      "Relative to the other technologies: 0 is the least attention on the board, 100 the most."),
    signalRow("Wikipedia readers", fmtN(raw.wikipedia_views), `Page views of its Wikipedia article${(d.signals?.wikipedia || []).length > 1 ? "s" : ""} in ${when}${wikiCh != null ? `, ${fmtPct(wikiCh)} on the three months before` : ""}.`,
      rankOf(d.id, measure("wikipedia_views")), "How many people look the technology up: broad public and business attention."),
    signalRow("Hacker News stories", fmtN(raw.hn_stories), `Stories with ${(d.signals?.hn || []).map(q => `"${esc(q)}"`).join(" or ") || "its name"} in the title, ${when}${hnCh != null ? `, ${fmtPct(hnCh)} on the three months before` : ""}.`,
      rankOf(d.id, measure("hn_stories")), "How much practitioners and the technology press talk about it."),
    signalRow("Momentum", raw.momentum != null ? fmtPct(raw.momentum) : "n/a",
      raw.momentum == null ? "Not enough data for a trend." : raw.momentum > 0.1 ? "Attention is rising." : raw.momentum < -0.1 ? "Attention is falling." : "Attention is roughly steady.",
      null, "The average change of the two signals above against the three months before."),
    signalRow("Research papers (arXiv)", fmtN(raw.arxiv_papers), raw.arxiv_papers == null ? "Not collected this month." : `Papers matching "${esc(d.signals?.arxiv || "")}" in ${when}.`,
      rankOf(d.id, measure("arxiv_papers")), "Research activity. Shown for context, not part of the score."),
  ].join("") : `<p class="note">No signals collected yet; the first monthly refresh fills this in.</p>`;
  return `<p class="lead">Expectations: how much the market believes the technology will deliver, and how soon. It shows up as attention, investment, valuations and executive agendas.</p>
    ${scale("expectations", d.h0)}
    <h3>How the board arrives at ${d.h0.toFixed(0)}</h3>
    ${built(c, "expectations", "Attention index", "The collected signals have no attention index for this technology, so the analyst score is used alone.")}
    <h3>The analyst's reading</h3>
    <p>Scored <b>${aH.toFixed(0)}</b>${overrides[d.id]?.h != null ? " (your what-if value)" : ""}, reviewed ${esc(d.reviewed)}: ${esc(d.notes)}</p>
    ${flag ? `<p class="flagged">The signals put expectations at ${s.expectations_index.toFixed(0)}, ${Math.abs(s.expectations_index - aH).toFixed(0)} points ${s.expectations_index > aH ? "above" : "below"} the analyst. Either attention has moved, or the search terms catch noise: a prompt for the next review.</p>` : ""}
    <h3>What the public signals show</h3>
    ${rows}
    ${s ? `<div class="trend"><span class="eyebrow">Attention index, month by month</span>${sparkline(d.id)}</div>` : ""}
    <p class="note">Attention is not adoption: these signals measure how much people look and talk, which is a sign of expectations, not of value delivered.</p>`;
}

function tabEvidence(d, aE) {
  const s = d.sig, raw = s?.raw || {};
  const c = composition(aE, s?.evidence_index, SET.blend.evidence_signal_weight, st.mode);
  const pk = d.signals?.pypi || [];
  const usage = s && Number.isFinite(s.evidence_index) ? [
    signalRow("Usage index", `${fmtN(s.evidence_index)} of 100`, "Relative downloads of the open-source packages that implement it.",
      rankOf(d.id, Object.fromEntries(Object.entries(SIG.technologies).map(([k, v]) => [k, v.evidence_index]))),
      "0 is the least used of the technologies with packages, 100 the most."),
    signalRow("Package downloads (PyPI)", fmtN(raw.pypi_downloads), `Last month, for ${pk.map(x => `<code>${esc(x)}</code>`).join(", ")}.`,
      rankOf(d.id, measure("pypi_downloads")), "Developers installing the software is a sign of real use, though it favours open-source Python tools."),
  ].join("") : `<p>No usage signal: the technology has no package that maps cleanly to it, so evidence rests on the analyst's judgement alone. Page views and news stories are not used here, because attention is not adoption.</p>`;
  return `<p class="lead">Evidence: how much value the technology has demonstrably delivered in production, outside the vendors selling it.</p>
    ${scale("evidence", d.e0)}
    <h3>How the board arrives at ${d.e0.toFixed(0)}</h3>
    ${built(c, "evidence", "Usage index", "There is no usage signal for this technology, so the analyst score is used alone.")}
    <h3>The analyst's reading</h3>
    <p>Scored <b>${aE.toFixed(0)}</b>${overrides[d.id]?.e != null ? " (your what-if value)" : ""}, reviewed ${esc(d.reviewed)}: ${esc(d.notes)}</p>
    <h3>Measured use</h3>
    ${usage}
    <h3>What counts as evidence</h3>
    <ol class="tight"><li>Independent measurement: controlled studies, audited financial results, regulator data.</li>
      <li>Observed behaviour: production deployments, renewal and cancellation rates, spend.</li>
      <li>Practitioner reports with numbers: baseline, intervention and result.</li>
      <li>Surveys of intent or satisfaction count least; vendor claims and demonstrations hardly at all.</li></ol>
    <div class="action"><b>What would move it.</b> ${esc(d.watch_signal)}.</div>
    <p class="note">To reach the next band (${esc(RUBRIC.evidence[Math.min(4, band("evidence", d.e0).index + 1)][2])}): ${esc(RUBRIC.evidence[Math.min(4, band("evidence", d.e0).index + 1)][3])}</p>`;
}

function tabOutlook(d) {
  const pr = SCEN.presets.find(p => p.id === st.preset);
  if (st.horizon === 0) return `<p class="lead">Set the time horizon above zero (Drivers of the future) to see where the model takes ${esc(d.name)} and why.</p>`;
  const o = outlook(d, st, SET.model, SET.thresholds, SCEN.drivers.map(x => x.key));
  const name = k => SCEN.drivers.find(x => x.key === k)?.name ?? k;
  const moved = o.drivers.filter(x => Math.abs(x.effect) > 1e-9);
  const drv = SCEN.drivers.map(dr => {
    const x = o.drivers.find(y => y.key === dr.key), v = x.sensitivity, w = Math.abs(v) * 50;
    return `<div><span>${esc(dr.name)}</span><span class="bar"><i style="left:${v >= 0 ? 50 : 50 - w}%;width:${w}%;background:${v >= 0 ? "var(--accent)" : "var(--over)"}"></i><i style="left:50%;width:1px;background:var(--muted)"></i></span><output>${v > 0 ? "+" : ""}${v.toFixed(1)}</output><output>${x.setting ? (x.setting > 0 ? "+" : "") + x.setting.toFixed(1) : "0"}</output></div>`;
  }).join("");
  const prem = [
    [o.premium.impact, `${o.premium.impact >= 0 ? "+" : ""}${o.premium.impact.toFixed(0)} for an impact of ${d.impact.toFixed(0)}, since big promises keep expectations up`],
    [o.premium.capital, `${o.premium.capital >= 0 ? "+" : ""}${o.premium.capital.toFixed(0)} from capital availability`],
    [o.premium.capability, `${o.premium.capability >= 0 ? "+" : ""}${o.premium.capability.toFixed(0)} from capability progress`],
  ].filter(([v], i) => i === 0 || Math.abs(v) > 0.05).map(([, t]) => t).join(", ");
  const end = o.path.at(-1);
  return `<p class="lead">Under <b>${esc(pr ? pr.name : "your custom scenario")}</b>, ${horizonWord(st.horizon).toLowerCase()} ahead: expectations ${d.h0.toFixed(0)} → <b>${end.H.toFixed(0)}</b>, evidence ${d.e0.toFixed(0)} → <b>${end.E.toFixed(0)}</b>, gap ${fmtSigned(d.h0 - d.e0)} → <b>${fmtSigned(end.gap)}</b>${end.cls !== d.c0 ? `, from ${CLS[d.c0]} to ${CLS[end.cls]}` : ""}.</p>
    <h3>Why evidence moves</h3>
    <p>Evidence grows like adoption: slowly while little is proven, fastest in the middle, then levelling off as it nears 100. For ${esc(d.name)} the growth rate is <b>${Math.round(o.rate * 100)} % a year</b>, which from today's ${d.e0.toFixed(0)} adds ${(end.E - d.e0).toFixed(0)} points by the horizon: a base rate of ${Math.round(o.baseRate * 100)} %${moved.length ? `, ${o.multiplier >= 1 ? "raised" : "lowered"} by ${Math.round(Math.abs(o.multiplier - 1) * 100)} % because of ${moved.map(x => `${name(x.key).toLowerCase()} (${x.setting > 0 ? "+" : ""}${x.setting.toFixed(1)})`).join(", ")}` : " (this scenario moves no driver it is sensitive to)"}.</p>
    <div class="sens sens2"><div class="shd"><span>Driver</span><span>How sensitive ${esc(d.name)} is</span><output>Sens.</output><output>Setting</output></div>${drv}</div>
    <h3>Why expectations move</h3>
    <p>Expectations drift toward the evidence plus a premium: today that target is ${d.e0.toFixed(0)} ${o.premium.total >= 0 ? "+" : "−"} ${Math.abs(o.premium.total).toFixed(0)} = <b>${o.target.toFixed(0)}</b> (${prem}). With a hype correction speed of ${o.speed.toFixed(2)}, they close about ${Math.round((1 - Math.pow(1 - o.speed / SET.model.steps_per_year, SET.model.steps_per_year)) * 100)} % of the distance to the target each year, and the target rises as evidence does.</p>
    <h3>The path</h3>
    <div class="tbl"><table class="path"><thead><tr><th>When</th><th class="num">Expectations</th><th class="num">Evidence</th><th class="num">Gap</th><th>Class</th></tr></thead><tbody>
    ${o.path.map(x => `<tr><td>${horizonWord(x.t)}</td><td class="num">${x.H.toFixed(0)}</td><td class="num">${x.E.toFixed(0)}</td><td class="num">${fmtSigned(x.gap)}</td><td><span class="pill p-${x.cls}">${CLS[x.cls]}</span></td></tr>`).join("")}
    </tbody></table></div>
    <p class="note">A thinking tool, not a forecast of record: the rates, sensitivities and premium are judgement calls kept in the data files. The <a href="track.html">track record</a> checks how such forecasts have done.</p>`;
}

function tabOverview(d) {
  return `${d.description ? `<p class="what">${esc(d.description)}</p>` : ""}
    ${d.supply_chain_example ? `<div class="action scm"><b>In supply chain management.</b> ${esc(d.supply_chain_example)}</div>` : ""}
    <div class="kv">
      <div><span>Expectations</span><b>${d.H.toFixed(0)}</b> <em>today ${d.h0.toFixed(0)} · ${esc(band("expectations", d.h0).anchor)}</em></div>
      <div><span>Evidence</span><b>${d.E.toFixed(0)}</b> <em>today ${d.e0.toFixed(0)} · ${esc(band("evidence", d.e0).anchor)}</em></div>
      <div><span>Gap</span><b style="color:var(--${d.c})">${fmtSigned(d.gap)}</b> <em>today ${fmtSigned(d.h0 - d.e0)}</em></div>
    </div>
    <p class="note">The tabs above show what each number rests on: <a href="#" data-tab="expectations">expectations</a>, <a href="#" data-tab="evidence">evidence</a>, and <a href="#" data-tab="outlook">where it's heading</a>.</p>
    <div class="action"><b>What to do.</b> ${ACT[d.c]}<br><b>Signal to watch.</b> ${esc(d.watch_signal)}.</div>
    <p class="note">Analyst view (reviewed ${esc(d.reviewed)}): ${esc(d.notes)} <a href="about.html#technologies">What every technology on the board is</a>.</p>
    <div class="eyebrow" style="margin-top:14px">What-if: adjust the analyst scores (this browser only, not saved)</div>
    <div class="edit">
      <label for="eh">Expectations<input id="eh" type="number" min="0" max="100" value="${overrides[d.id]?.h ?? d.analyst.expectations}"></label>
      <label for="ee">Evidence<input id="ee" type="number" min="0" max="100" value="${overrides[d.id]?.e ?? d.analyst.evidence}"></label>
      <label for="ei">Impact<input id="ei" type="number" min="0" max="100" value="${d.impact}"></label>
      <button class="btn" id="reset" ${d.edited ? "" : "hidden"}>Restore assessment</button>
    </div>`;
}

function renderDetail(d) {
  const aH = overrides[d.id]?.h ?? d.analyst.expectations, aE = overrides[d.id]?.e ?? d.analyst.evidence;
  const body = { overview: () => tabOverview(d), expectations: () => tabExpectations(d, aH), evidence: () => tabEvidence(d, aE), outlook: () => tabOutlook(d) }[st.tab]();
  $("detail").innerHTML = `
    <div class="detail-top"><div><div class="eyebrow">Selected · Gartner 2026: ${esc(d.gartner_phase_2026)}</div><h2 style="font-size:22px">${esc(d.name)}</h2></div>
    <span class="pill p-${d.c}" style="font-size:13px;padding:4px 10px">${CLS[d.c]}${d.c !== d.c0 ? ` (today: ${CLS[d.c0]})` : ""}</span></div>
    <a class="tomap" href="#map">↑ Back to the map</a>
    <div class="tabs" role="tablist" aria-label="About ${esc(d.name)}">${TABS.map(([k, l]) => `<button role="tab" id="tab-${k}" data-tab="${k}" aria-selected="${k === st.tab}" aria-controls="tabpanel" tabindex="${k === st.tab ? 0 : -1}">${l}</button>`).join("")}</div>
    <div class="tabpanel" id="tabpanel" role="tabpanel" aria-labelledby="tab-${st.tab}">${body}</div>`;
  $("detail").querySelector(".tomap").addEventListener("click", ev => {
    ev.preventDefault();
    $("map").closest(".panel").scrollIntoView({ behavior: "smooth", block: "start" });
  });
  $("detail").querySelectorAll("[data-tab]").forEach(b => b.addEventListener("click", ev => {
    ev.preventDefault();
    st.tab = b.dataset.tab;
    render();
    $(`tab-${st.tab}`).focus();
  }));
  $("detail").querySelector('[role="tablist"]').addEventListener("keydown", ev => {
    const i = TABS.findIndex(([k]) => k === st.tab);
    const j = ev.key === "ArrowRight" ? (i + 1) % TABS.length : ev.key === "ArrowLeft" ? (i + TABS.length - 1) % TABS.length : -1;
    if (j < 0) return;
    ev.preventDefault();
    st.tab = TABS[j][0];
    render();
    $(`tab-${st.tab}`).focus();
  });
  if (st.tab === "overview") {
    [["eh", "h"], ["ee", "e"], ["ei", "i"]].forEach(([id, f]) => $(id).addEventListener("change", ev => {
      overrides[d.id] = { ...(overrides[d.id] || {}), [f]: clamp(+ev.target.value || 0, 0, 100) }; render();
    }));
    $("reset").onclick = () => { delete overrides[d.id]; render(); };
  }
}
// Selecting a technology opens its card; the card sits below the map, so bring it into view when it is off screen.
function select(id) {
  st.sel = id;
  render();
  const card = $("detail"), r = card.getBoundingClientRect();
  if (r.top > innerHeight - 80 || r.bottom < 80) {
    card.scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" });
  }
  $(`tab-${st.tab}`)?.focus({ preventScroll: true });
}

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
