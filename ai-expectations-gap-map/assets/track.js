// The track record page: the frozen monthly forecasts in data/ledger.json, scored as they come due (assets/accuracy.js).
import { evaluate } from "./accuracy.js";

const CLS = { over: "Overheated", under: "Underpriced", proven: "Proven", emerg: "Emerging" };
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const $ = (id) => document.getElementById(id);
const f1 = (x) => (x == null ? "–" : x.toFixed(1));
const pct = (x) => (x == null ? "–" : `${Math.round(x * 100)} %`);
const skillTxt = (s) => (s == null ? "–" : `<span class="${s > 0 ? "pos" : s < 0 ? "neg" : ""}">${s > 0 ? "+" : ""}${s.toFixed(2)}</span>`);
const monthName = (p) => new Date(`${p}-15`).toLocaleDateString("en-GB", { month: "long", year: "numeric" });

async function getJSON(p) { const r = await fetch(p, { cache: "no-cache" }); if (!r.ok) throw new Error(`${p}: ${r.status}`); return r.json(); }

let LEDGER, CFG, SCEN;
const st = { scenario: "base", horizon: null };

async function boot() {
  try {
    [LEDGER, CFG, SCEN] = await Promise.all([
      getJSON("data/ledger.json").catch(() => ({ records: [] })), getJSON("data/technologies.json"), getJSON("data/scenarios.json"),
    ]);
  } catch (e) {
    document.querySelector(".wrap").insertAdjacentHTML("afterbegin", `<div class="panel err"><h2>Data could not be loaded</h2><p class="note">${esc(e.message)}</p></div>`);
    return;
  }
  const chips = $("scenarios");
  for (const p of SCEN.presets) {
    const b = document.createElement("button");
    b.className = "chip";
    b.textContent = p.name;
    b.dataset.id = p.id;
    b.addEventListener("click", () => { st.scenario = p.id; render(); });
    chips.appendChild(b);
  }
  render();
}

const name = (id) => CFG.technologies.find((t) => t.id === id)?.name ?? id;
const scenName = (id) => SCEN.presets.find((p) => p.id === id)?.name ?? id;

function render() {
  document.querySelectorAll("#scenarios .chip").forEach((b) => b.setAttribute("aria-pressed", b.dataset.id === st.scenario));
  $("scenNote").textContent = `Forecasts are scored under the ${scenName(st.scenario)} scenario. The board opens on the base case; the other scenarios are kept so you can see which future came closest.`;
  const recs = LEDGER.records ?? [];
  const ev = evaluate(LEDGER, { scenario: st.scenario });
  const nextDue = ev.pending.map((p) => p.due).sort()[0];
  $("stats").innerHTML = [
    [recs.length, recs.length === 1 ? "month recorded" : "months recorded"],
    [ev.rows.length, "forecasts checked"],
    [nextDue ? monthName(nextDue) : "–", "next check"],
  ].map(([v, l]) => `<div class="stat"><b>${esc(v)}</b><span>${esc(l)}</span></div>`).join("");

  if (!recs.length) {
    $("summary").innerHTML = `<h2>Nothing recorded yet</h2><p class="note">The monthly signal refresh freezes the board's forecasts. The first record appears after its next run.</p>`;
    $("frozen").innerHTML = "";
    return;
  }

  // ---- by horizon
  if (!ev.byHorizon.length) {
    const firsts = [...new Map(ev.pending.sort((a, b) => a.due.localeCompare(b.due)).map((p) => [p.horizon, p])).values()];
    $("summary").innerHTML = `<h2>No forecast has come due yet</h2>
      <p>The board has kept its forecasts since ${esc(monthName(recs[0].period))}. Each is checked in the month it was aimed at, once that month's refresh has run:</p>
      <div class="tbl"><table><thead><tr><th>Horizon</th><th>First check</th></tr></thead><tbody>
      ${firsts.map((p) => `<tr><td>${p.horizon} months</td><td>${esc(monthName(p.due))} (forecast made for ${esc(p.from)})</td></tr>`).join("")}
      </tbody></table></div>`;
  } else {
    if (!ev.byHorizon.some((h) => h.horizon === st.horizon)) st.horizon = ev.byHorizon[0].horizon;
    $("summary").innerHTML = `<h2>Accuracy by horizon</h2>
      <div class="tbl"><table><thead><tr><th>Horizon</th><th class="num">Checked</th><th class="num">Error</th><th class="num">Standing still</th><th class="num">Skill</th><th class="num">Right quadrant</th><th class="num">Standing still</th><th class="num">Right direction</th><th class="num">Re-reviewed</th></tr></thead><tbody>
      ${ev.byHorizon.map((h) => `<tr><td><button class="chip" data-h="${h.horizon}" aria-pressed="${h.horizon === st.horizon}">${h.horizon} months</button></td>
        <td class="num">${h.n} (${h.forecasts} ${h.forecasts === 1 ? "month" : "months"})</td><td class="num">${f1(h.error)}</td><td class="num">${f1(h.naive)}</td><td class="num">${skillTxt(h.skill)}</td>
        <td class="num">${pct(h.classHit)}</td><td class="num">${pct(h.classHitNaive)}</td><td class="num">${pct(h.directionHit)} <small>of ${h.directionN}</small></td><td class="num">${h.reviewed}</td></tr>`).join("")}
      </tbody></table></div>
      ${ev.pending.length ? `<p class="note">Still to come due: ${ev.pending.length} forecasts, the next in ${esc(monthName(nextDue))}.</p>` : ""}`;
    $("summary").querySelectorAll("[data-h]").forEach((b) => b.addEventListener("click", () => { st.horizon = Number(b.dataset.h); render(); }));

    // ---- which future came closest
    const hs = [...new Set(ev.byScenario.map((s) => s.horizon))].sort((a, b) => a - b);
    $("scenarioPanel").hidden = false;
    $("scenarioPanel").innerHTML = `<h2>Which future came closest</h2>
      <p class="note">Average error of each scenario's forecasts. The lowest per horizon is marked.</p>
      <div class="tbl"><table><thead><tr><th>Scenario</th>${hs.map((h) => `<th class="num">${h} months</th>`).join("")}</tr></thead><tbody>
      ${SCEN.presets.map((p) => `<tr><td>${esc(p.name)}</td>${hs.map((h) => {
        const cell = ev.byScenario.find((s) => s.scenario === p.id && s.horizon === h);
        const best = Math.min(...ev.byScenario.filter((s) => s.horizon === h).map((s) => s.error));
        return `<td class="num">${cell ? (cell.error === best ? `<b>${f1(cell.error)}</b> ◆` : f1(cell.error)) : "–"}</td>`;
      }).join("")}</tr>`).join("")}
      </tbody></table></div>`;

    // ---- every technology at the chosen horizon
    const rows = ev.rows.filter((r) => r.horizon === st.horizon).sort((a, b) => b.from.localeCompare(a.from) || (b.error - b.naive) - (a.error - a.naive));
    $("detail").hidden = false;
    $("detail").innerHTML = `<h2>Each technology, ${st.horizon} months ahead</h2>
      <p class="note">Positions as expectations / evidence. Where the model beat standing still the error is green, where it did worse red.</p>
      <div class="tbl"><table><thead><tr><th>Technology</th><th>Made → due</th><th class="num">Then</th><th class="num">Forecast</th><th class="num">Later</th><th class="num">Error</th><th class="num">Standing still</th><th>Quadrant forecast / later</th><th class="num">Direction</th></tr></thead><tbody>
      ${rows.map((r) => `<tr><td>${esc(name(r.id))}${r.reviewed ? " <small>re-reviewed</small>" : ""}</td><td>${r.from} → ${r.due}</td>
        <td class="num">${f1(r.start[0])} / ${f1(r.start[1])}</td><td class="num">${f1(r.forecast[0])} / ${f1(r.forecast[1])}</td><td class="num">${f1(r.observed[0])} / ${f1(r.observed[1])}</td>
        <td class="num ${r.error < r.naive ? "pos" : r.error > r.naive ? "neg" : ""}">${f1(r.error)}</td><td class="num">${f1(r.naive)}</td>
        <td>${CLS[r.cls]} / ${CLS[r.clsObserved]}${r.cls === r.clsObserved ? " ✓" : ""}</td>
        <td class="num">${r.direction ? (r.direction.hit ? "✓" : "✗") : "–"}</td></tr>`).join("")}
      </tbody></table></div>`;
  }

  // ---- the latest frozen forecasts
  const last = recs.at(-1);
  const ids = Object.keys(last.technologies).sort((a, b) => name(a).localeCompare(name(b)));
  $("frozen").innerHTML = `<h2>Forecasts frozen in ${esc(monthName(last.period))}</h2>
    <p class="note">Recorded ${esc(last.made)}, starting from ${last.mode === "blend" ? "analyst scores blended with the collected signals" : "analyst scores only"}, under the ${esc(scenName(st.scenario))} scenario. Positions as expectations / evidence. <a href="data/ledger.json" download>Download the whole ledger</a>.</p>
    <div class="tbl"><table><thead><tr><th>Technology</th><th class="num">Now</th>${last.horizons.map((h) => `<th class="num">${h} months</th>`).join("")}</tr></thead><tbody>
    ${ids.map((id) => {
      const t = last.technologies[id];
      const fc = t.forecast[st.scenario] ?? [];
      return `<tr><td>${esc(name(id))}</td><td class="num">${f1(t.start[0])} / ${f1(t.start[1])} <small>${CLS[t.cls]}</small></td>${fc.map(([H, E]) => `<td class="num">${f1(H)} / ${f1(E)}</td>`).join("")}</tr>`;
    }).join("")}
    </tbody></table></div>`;
}

boot();
