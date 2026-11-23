// Chart geometry, kept pure and tested: nice ticks, scales, paths, a kernel density, and quantiles.

export type Scale = (v: number) => number;

export function linear(d0: number, d1: number, r0: number, r1: number): Scale {
  const span = d1 - d0 || 1;
  return (v) => r0 + ((v - d0) / span) * (r1 - r0);
}

/** About `count` round tick values covering [lo, hi]. */
export function niceTicks(lo: number, hi: number, count = 4): number[] {
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) return [];
  if (hi === lo) return [lo];
  const raw = (hi - lo) / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? 10 * mag;
  const out: number[] = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + step * 1e-9; v += step) out.push(Number(v.toPrecision(12)));
  return out;
}

/** A domain padded by a share of its span (and never empty). */
export function padded(values: number[], share = 0.06): [number, number] {
  const v = values.filter(Number.isFinite);
  if (!v.length) return [0, 1];
  let lo = Math.min(...v);
  let hi = Math.max(...v);
  if (hi === lo) { lo -= Math.abs(lo) * 0.05 || 1; hi += Math.abs(hi) * 0.05 || 1; }
  const p = (hi - lo) * share;
  return [lo - p, hi + p];
}

export function linePath(xs: number[], ys: number[]): string {
  return xs.map((x, i) => `${i ? "L" : "M"}${x.toFixed(1)},${ys[i].toFixed(1)}`).join("");
}

/** The area between two series (a band). */
export function bandPath(xs: number[], lo: number[], hi: number[]): string {
  const top = xs.map((x, i) => `${i ? "L" : "M"}${x.toFixed(1)},${hi[i].toFixed(1)}`).join("");
  const bottom = xs.map((_, j) => {
    const i = xs.length - 1 - j;
    return `L${xs[i].toFixed(1)},${lo[i].toFixed(1)}`;
  }).join("");
  return `${top}${bottom}Z`;
}

export function quantile(values: number[], q: number): number {
  const v = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!v.length) return NaN;
  const pos = (v.length - 1) * q;
  const i = Math.floor(pos);
  return v[i] + (v[Math.min(i + 1, v.length - 1)] - v[i]) * (pos - i);
}

/** Gaussian kernel density on `n` points over [lo, hi], with Silverman's bandwidth. */
export function kde(values: number[], lo: number, hi: number, n = 48): { x: number; y: number }[] {
  const v = values.filter(Number.isFinite);
  if (v.length < 2) return [];
  const mean = v.reduce((a, b) => a + b, 0) / v.length;
  const sd = Math.sqrt(v.reduce((a, b) => a + (b - mean) ** 2, 0) / (v.length - 1));
  const iqr = quantile(v, 0.75) - quantile(v, 0.25);
  const h = 0.9 * Math.min(sd || Infinity, (iqr || Infinity) / 1.34) * v.length ** -0.2 || (hi - lo) / 20 || 1;
  const c = 1 / (v.length * h * Math.sqrt(2 * Math.PI));
  return Array.from({ length: n + 1 }, (_, i) => {
    const x = lo + ((hi - lo) * i) / n;
    let s = 0;
    for (const p of v) s += Math.exp(-0.5 * ((x - p) / h) ** 2);
    return { x, y: s * c };
  });
}

/** The index of the value in `xs` nearest to `x` (for hover). */
export function nearest(xs: number[], x: number): number {
  let best = 0;
  for (let i = 1; i < xs.length; i++) if (Math.abs(xs[i] - x) < Math.abs(xs[best] - x)) best = i;
  return best;
}

export function fmtPct(v: number, d = 1): string { return `${(v * 100).toFixed(d)}%`; }
export function fmtEur(v: number): string {
  return Math.abs(v) >= 1e6 ? `€${(v / 1e6).toFixed(2)}M` : Math.abs(v) >= 1e4 ? `€${(v / 1e3).toFixed(1)}k` : `€${Math.round(v).toLocaleString("en")}`;
}
export function fmtNum(v: number): string {
  return Math.abs(v) >= 1e4 ? `${(v / 1e3).toFixed(1)}k` : Number(v.toPrecision(4)).toLocaleString("en");
}
