// Pure model functions. No DOM access, so they can be tested in Node.

export const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

/**
 * Starting position for a technology: analyst assessment blended with
 * collected signals where they exist.
 */
export function startingPoint(assessment, signal, blend) {
  let h = assessment.expectations;
  let e = assessment.evidence;
  const hasH = signal && Number.isFinite(signal.expectations_index);
  const hasE = signal && Number.isFinite(signal.evidence_index);
  if (blend.mode !== "analyst") {
    const wh = blend.mode === "signals" ? 1 : blend.expectations_signal_weight;
    const we = blend.mode === "signals" ? 1 : blend.evidence_signal_weight;
    if (hasH) h = (1 - wh) * h + wh * signal.expectations_index;
    if (hasE) e = (1 - we) * e + we * signal.evidence_index;
  }
  return { h0: clamp(h, 0, 100), e0: clamp(e, 0, 100) };
}

/**
 * Two-stock adjustment model, stepped `steps_per_year` times per year.
 *   dE/dt = r·(1 + Σ s_i·d_i)·E·(1 − E/100)
 *   dH/dt = k·(E + premium − H)
 */
export function simulate(item, state, model) {
  let E = Math.max(1, item.e0);
  let H = item.h0;
  const spy = model.steps_per_year;
  const steps = Math.round(state.horizon * spy);
  const mult = 1 + Object.entries(item.sensitivities)
    .reduce((acc, [k, s]) => acc + s * (state.drivers[k] || 0), 0);
  const r = Math.max(0, item.base_rate * mult);
  const premium = model.premium_impact * (item.impact - 50)
    + model.premium_capital * (state.drivers.capital || 0)
    + model.premium_capability * (state.drivers.capability || 0);
  for (let q = 0; q < steps; q++) {
    E = E + (r / spy) * E * (1 - E / 100);
    H = H + (state.correction_speed / spy) * (clamp(E + premium, 0, 100) - H);
  }
  return { E: clamp(E, 0, 100), H: clamp(H, 0, 100) };
}

export function classify(h, e, t) {
  const gap = h - e;
  if (gap > t.overheated_gap) return "over";
  if (gap < t.underpriced_gap) return "under";
  return e >= t.proven_evidence ? "proven" : "emerg";
}

/** Minimal RFC 4180 CSV parser (quoted fields, escaped quotes, CRLF). */
export function parseCSV(text) {
  const rows = [];
  let row = [], field = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') q = false;
      else field += c;
    } else if (c === '"') q = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field); field = "";
      if (row.some(x => x !== "")) rows.push(row);
      row = [];
    } else field += c;
  }
  row.push(field);
  if (row.some(x => x !== "")) rows.push(row);
  const [head, ...body] = rows;
  return body.map(r => Object.fromEntries(head.map((h, i) => [h.trim(), (r[i] ?? "").trim()])));
}
