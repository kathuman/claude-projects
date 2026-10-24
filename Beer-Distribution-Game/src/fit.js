// Reading a player's decision rule from their orders. For each stage, find the anchoring-and-adjustment rule
// (rules.js) that best reproduces the orders it actually placed: the forecast weight θ, the share α of the stock gap
// corrected each week, how much β of the supply line was counted, and the desired level S′. Least squares, the way
// Sterman (1989) estimated it: for every θ and β on a grid the rest is a straight-line fit, and the best grid point
// wins. α and β are kept within 0–1, as the rule means them.

const sum = (a) => a.reduce((s, x) => s + x, 0);

// rows: what the stage saw and did each week { incoming, inv, backlog, supplyLine, order }; base: the calm demand.
export function fitRule(rows, base) {
  if (rows.length < 8) return null;
  const S = rows.map((r) => r.inv - r.backlog);
  const SL = rows.map((r) => r.supplyLine);
  const O = rows.map((r) => r.order);
  const meanO = sum(O) / O.length;
  const sst = sum(O.map((o) => (o - meanO) ** 2));
  let best = null;
  for (let ti = 0; ti <= 20; ti++) {
    const theta = ti / 20;
    let e = base;
    const L = rows.map((r) => (e = theta * r.incoming + (1 - theta) * e));
    const y = O.map((o, k) => o - L[k]);
    for (let bi = 0; bi <= 20; bi++) {
      const beta = bi / 20;
      const x = S.map((s, k) => s + beta * SL[k]);
      // y = α·S′ − α·x  →  y = a + b·x with α = −b, S′ = a / α
      const mx = sum(x) / x.length;
      const my = sum(y) / y.length;
      const sxx = sum(x.map((v) => (v - mx) ** 2));
      let alpha = sxx > 1e-9 ? -sum(x.map((v, k) => (v - mx) * (y[k] - my))) / sxx : 0;
      alpha = Math.min(1, Math.max(0, alpha));
      const a = my + alpha * mx;
      const pred = x.map((v, k) => Math.max(0, L[k] + a - alpha * v));
      const sse = sum(pred.map((p, k) => (O[k] - p) ** 2));
      if (!best || sse < best.sse - 1e-9) best = { theta, beta, alpha, desired: alpha > 1e-6 ? a / alpha : null, sse };
    }
  }
  best.r2 = sst > 1e-9 ? Math.max(0, 1 - best.sse / sst) : null;
  best.rmse = Math.sqrt(best.sse / rows.length);
  return best;
}

// The rows a stage saw, from a finished game's history.
export const stageRows = (game, i) => game.history.map((h) => ({ ...h.stages[i] }));
