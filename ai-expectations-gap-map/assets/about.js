import { simulate, classify, parseCSV } from "./model.js";

const $ = id => document.getElementById(id);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const CLS = { over: "Overheated", under: "Underpriced", proven: "Proven", emerg: "Emerging" };
const sgn = v => (v > 0 ? "+" : "") + v;

async function load() {
  const j = p => fetch(p, { cache: "no-cache" }).then(r => { if (!r.ok) throw new Error(p); return r.json(); });
  const [cfg, scen, set, sig, hist, csv] = await Promise.all([
    j("data/technologies.json"), j("data/scenarios.json"), j("data/settings.json"),
    j("data/signals.json").catch(() => ({})), j("data/history.json").catch(() => ({ snapshots: [] })),
    fetch("data/assessments.csv", { cache: "no-cache" }).then(r => r.text()).then(parseCSV),
  ]);
  return { cfg, scen, set, sig, hist, A: csv };
}

function render({ cfg, scen, set, sig, hist, A }) {
  const t = set.thresholds, m = set.model, b = set.blend;
  const lastReview = A.map(a => a.reviewed).sort().pop();
  $("asOf").textContent = `Scores reviewed ${lastReview}${sig.period ? ` · signals ${sig.period}` : ""}`;

  const score = Object.fromEntries(A.map((a) => [a.id, a]));
  $("techList").innerHTML = [...cfg.technologies].sort((x, y) => x.name.localeCompare(y.name)).map((tc) => `
    <div class="tech" id="t-${esc(tc.id)}"><h3>${esc(tc.name)}</h3>
      <p class="meta">Expectations ${esc(score[tc.id]?.expectations ?? "–")} · evidence ${esc(score[tc.id]?.evidence ?? "–")} · Gartner 2026: ${esc(tc.gartner_phase_2026)}</p>
      <p>${esc(tc.description ?? "")}</p>
      <p class="scm"><b>Supply chain example.</b> ${esc(tc.supply_chain_example ?? "")}</p>
      <p class="meta" style="margin-top:8px">Watch: ${esc(tc.watch_signal)}</p></div>`).join("");

  $("classTable").innerHTML = [
    ["over", `Gap above +${t.overheated_gap}`, "Expectations exceed evidence. Fund small, staged options with explicit kill criteria; avoid multi-year commitments until the watch signal moves."],
    ["proven", `Gap within band, evidence ${t.proven_evidence} or more`, "Evidence supports expectations. Scale with standard business cases and clear operating ownership."],
    ["under", `Gap below ${t.underpriced_gap}`, "Delivers more than the market credits. Build capability while attention and vendor pricing are low."],
    ["emerg", `Gap within band, evidence below ${t.proven_evidence}`, "Low expectations, low evidence. Hold a cheap option: monitor, keep a small research budget, set a review trigger."],
  ].map(([c, rule, act]) => `<div class="cls"><span class="pill p-${c}">${CLS[c]}</span><b>${rule}</b><p>${act}</p></div>`).join("");

  $("blendText").textContent = `A weighted mix: ${Math.round(b.expectations_signal_weight * 100)}% attention index and ${Math.round((1 - b.expectations_signal_weight) * 100)}% analyst score for expectations; ${Math.round(b.evidence_signal_weight * 100)}% usage index and ${Math.round((1 - b.evidence_signal_weight) * 100)}% analyst score for evidence, where an index exists.`;

  document.querySelectorAll('[data-k="steps"]').forEach(e => e.textContent = m.steps_per_year);
  document.querySelectorAll('[data-k="flag"]').forEach(e => e.textContent = set.review_flag_gap);

  const P = [
    ["r", "Base evidence growth rate per year", "0.03–0.40, per technology", "technologies.json"],
    ["s<sub>d</sub>", "Sensitivity to driver d", "−1 to +1, per technology", "technologies.json"],
    ["k", "Hype correction speed (default)", set.defaults.correction_speed, "settings.json, slider"],
    ["a", "Premium per impact point above 50", m.premium_impact, "settings.json"],
    ["b", "Premium per unit of capital driver", m.premium_capital, "settings.json"],
    ["c", "Premium per unit of capability driver", m.premium_capability, "settings.json"],
    ["Δt", "Time step", `1/${m.steps_per_year} year`, "settings.json"],
    ["T", "Projection horizon (default)", `${set.defaults.horizon} year(s), up to 5`, "settings.json, slider"],
    ["w<sub>H</sub>", "Signal weight on expectations (Blend)", b.expectations_signal_weight, "settings.json"],
    ["w<sub>E</sub>", "Signal weight on evidence (Blend)", b.evidence_signal_weight, "settings.json"],
  ];
  $("paramTable").innerHTML = P.map(r => `<tr><td><code>${r[0]}</code></td><td>${r[1]}</td><td class="num">${r[2]}</td><td><code>${r[3]}</code></td></tr>`).join("");

  // worked example: first technology with a large positive gap, analyst scores, base case
  const byId = Object.fromEntries(A.map(a => [a.id, a]));
  const pick = cfg.technologies.find(x => x.id === "ai-agents" && byId[x.id]) || cfg.technologies.find(x => byId[x.id]);
  const a = byId[pick.id];
  const item = { ...pick, h0: +a.expectations, e0: +a.evidence, impact: +a.impact };
  const base = scen.presets.find(p => p.id === set.defaults.scenario) || scen.presets[0];
  const prem = m.premium_impact * (item.impact - 50) + m.premium_capital * (base.values.capital || 0) + m.premium_capability * (base.values.capability || 0);
  $("exIntro").innerHTML = `<strong>${esc(pick.name)}</strong> under the ${esc(base.name.toLowerCase())}, starting from analyst scores: expectations ${item.h0}, evidence ${item.e0}, impact ${item.impact}. Base growth rate r = ${pick.base_rate}; correction speed k = ${set.defaults.correction_speed}. With all drivers at zero, r<sub>eff</sub> = r and the premium is P = ${m.premium_impact} × (${item.impact} − 50) = ${prem.toFixed(1)}.`;
  const rows = [];
  for (let y = 0; y <= 5; y++) {
    const s = simulate(item, { drivers: base.values, horizon: y, correction_speed: set.defaults.correction_speed }, m);
    const c = classify(s.H, s.E, t);
    rows.push(`<tr><td>${y}</td><td class="num">${s.H.toFixed(1)}</td><td class="num">${s.E.toFixed(1)}</td><td class="num">${sgn((s.H - s.E).toFixed(1))}</td><td><span class="pill p-${c}">${CLS[c]}</span></td></tr>`);
  }
  $("exTable").innerHTML = rows.join("");
  $("exNote").textContent = `Evidence follows its S-curve while expectations chase a moving target: evidence plus the premium. Expectations fall fast while the gap is large, then trail evidence because adjustment takes time. While evidence is still growing, that lag can pull expectations below evidence even with a positive premium; once evidence levels off, expectations settle at evidence plus the premium. The table is computed live from the data files, so changing k or the premium constants in settings.json changes it.`;

  $("driverTable").innerHTML = scen.drivers.map(d => `<tr><td><strong>${esc(d.name)}</strong></td><td>${esc(d.description)}.</td></tr>`).join("");
  $("scenHead").innerHTML = `<tr><th>Scenario</th>${scen.drivers.map(d => `<th class="num">${esc(d.name)}</th>`).join("")}</tr>`;
  $("scenTable").innerHTML = scen.presets.map(p => `<tr><td><strong>${esc(p.name)}</strong><br><span class="note-inline">${esc(p.note)}</span></td>${scen.drivers.map(d => { const v = p.values[d.key] || 0; return `<td class="num ${v > 0 ? "pos" : v < 0 ? "neg" : ""}">${v === 0 ? "0" : sgn(v.toFixed(1))}</td>`; }).join("")}</tr>`).join("");

  // log: signal refreshes and analyst reviews
  const snaps = (hist.snapshots || []).map(s => s.period).sort().reverse();
  const reviews = {};
  A.forEach(r => { reviews[r.reviewed] = (reviews[r.reviewed] || 0) + 1; });
  const revRows = Object.entries(reviews).sort((x, y) => y[0].localeCompare(x[0]));
  $("logBody").innerHTML = `
    <div class="log">
      <div><h3>Signal refreshes</h3>${snaps.length ? `<ul>${snaps.slice(0, 24).map(p => `<li><code>${p}</code>${p === sig.period ? " · current" : ""}</li>`).join("")}</ul>` : `<p class="note">None yet. The first monthly refresh adds an entry here.</p>`}</div>
      <div><h3>Analyst reviews</h3><ul>${revRows.map(([d, n]) => `<li><code>${esc(d)}</code> · ${n} technolog${n === 1 ? "y" : "ies"} last reviewed</li>`).join("")}</ul></div>
    </div>
    <p class="note">The full change history, with reasons, is in the repository's merged pull requests.</p>`;
}

load().then(render).catch(e => {
  $("logBody").innerHTML = `<p class="note">Data could not be loaded (${esc(e.message)}). Live values on this page are unavailable; open it through a web server.</p>`;
});
