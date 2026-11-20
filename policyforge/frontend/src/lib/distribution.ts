// Lead-time distributions: the text form used in CSV files (mirrors backend/core/domain/network_io.py) and the
// shape shown in the inspector's preview (mean, a high quantile, and a density curve).

import type { Dist } from "./types";

const num = (x: number) => String(Number(x.toPrecision(6))); // Python's {:g} for the values lead times take

export function distToText(d: Dist): string {
  switch (d.kind) {
    case "deterministic": return `deterministic(${num(d.value)})`;
    case "normal": return `normal(${num(d.mu)}, ${num(d.sigma)})`;
    case "gamma": return `gamma(${num(d.mu)}, ${num(d.cv)})`;
    case "triangular": return `triangular(${num(d.low)}, ${num(d.mode)}, ${num(d.high)})`;
    case "discrete": return `discrete(${d.values.map(num).join(" ")} | ${d.probs.map(num).join(" ")})`;
  }
}

const ARGS: Record<string, string[]> = {
  deterministic: ["value"], normal: ["mu", "sigma"], gamma: ["mu", "cv"], triangular: ["low", "mode", "high"],
};

export function distFromText(text: string): Dist {
  const m = /^\s*([a-z]+)\s*\((.*)\)\s*$/.exec(text);
  if (!m) throw new Error(`write a distribution like gamma(21, 0.08), not "${text}"`);
  const [, kind, body] = m;
  if (kind === "discrete") {
    const parts = body.split("|");
    if (parts.length !== 2) throw new Error("write discrete(values | probabilities), e.g. discrete(1 2 3 | 0.2 0.5 0.3)");
    const [values, probs] = parts.map((p) => p.trim().split(/\s+/).filter(Boolean).map(Number));
    if (values.some(Number.isNaN) || probs.some(Number.isNaN)) throw new Error("discrete values must be numbers");
    return { kind: "discrete", values, probs };
  }
  const names = ARGS[kind];
  if (!names) throw new Error(`unknown distribution ${kind}: use ${Object.keys(ARGS).join(", ")} or discrete`);
  const nums = body.split(",").map((s) => Number(s.trim()));
  if (nums.length !== names.length || nums.some(Number.isNaN)) {
    throw new Error(`${kind} takes ${names.length} number${names.length > 1 ? "s" : ""}: ${names.join(", ")}`);
  }
  return Object.fromEntries([["kind", kind], ...names.map((n, i) => [n, nums[i]])]) as Dist;
}

export function mean(d: Dist): number {
  switch (d.kind) {
    case "deterministic": return d.value;
    case "normal": case "gamma": return d.mu;
    case "triangular": return (d.low + d.mode + d.high) / 3;
    case "discrete": return d.values.reduce((a, v, i) => a + v * (d.probs[i] ?? 0), 0);
  }
}

export function sd(d: Dist): number {
  switch (d.kind) {
    case "deterministic": return 0;
    case "normal": return d.sigma;
    case "gamma": return d.mu * d.cv;
    case "triangular": {
      const { low: a, mode: c, high: b } = d;
      return Math.sqrt((a * a + b * b + c * c - a * b - a * c - b * c) / 18);
    }
    case "discrete": {
      const m = mean(d);
      return Math.sqrt(d.values.reduce((a, v, i) => a + (v - m) ** 2 * (d.probs[i] ?? 0), 0));
    }
  }
}

function lnGamma(z: number): number { // Lanczos
  const g = 7;
  const c = [0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059,
    12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7];
  if (z < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * z)) - lnGamma(1 - z);
  z -= 1;
  let x = c[0];
  for (let i = 1; i < g + 2; i++) x += c[i] / (z + i);
  const t = z + g + 0.5;
  return 0.5 * Math.log(2 * Math.PI) + (z + 0.5) * Math.log(t) - t + Math.log(x);
}

/** Density at x (continuous kinds); for discrete, the probability mass at x. */
export function density(d: Dist, x: number): number {
  switch (d.kind) {
    case "deterministic": return x === d.value ? 1 : 0;
    case "normal": return d.sigma > 0 ? Math.exp(-(((x - d.mu) / d.sigma) ** 2) / 2) / (d.sigma * Math.sqrt(2 * Math.PI)) : 0;
    case "gamma": {
      if (x <= 0) return 0;
      const k = 1 / (d.cv * d.cv);
      const theta = d.mu / k;
      return Math.exp((k - 1) * Math.log(x) - x / theta - lnGamma(k) - k * Math.log(theta));
    }
    case "triangular": {
      const { low: a, mode: c, high: b } = d;
      if (x < a || x > b || b === a) return 0;
      return x < c ? (2 * (x - a)) / ((b - a) * (c - a || 1)) : (2 * (b - x)) / ((b - a) * (b - c || 1));
    }
    case "discrete": return d.values.reduce((s, v, i) => s + (v === x ? d.probs[i] ?? 0 : 0), 0);
  }
}

/** A curve to draw: points (x, density) over a sensible range, or bars for discrete/deterministic. */
export function curve(d: Dist, n = 60): { x: number; y: number }[] {
  if (d.kind === "deterministic") return [{ x: d.value, y: 1 }];
  if (d.kind === "discrete") return d.values.map((v, i) => ({ x: v, y: d.probs[i] ?? 0 }));
  const lo = d.kind === "triangular" ? d.low : Math.max(0, mean(d) - 4 * sd(d));
  const hi = d.kind === "triangular" ? d.high : mean(d) + 4 * sd(d);
  if (hi <= lo) return [{ x: lo, y: 1 }];
  return Array.from({ length: n + 1 }, (_, i) => {
    const x = lo + ((hi - lo) * i) / n;
    return { x, y: density(d, x) };
  });
}

/** The value below which a share `q` of lead times fall, by numeric integration of the curve. */
export function quantile(d: Dist, q: number): number {
  const pts = curve(d, 400);
  if (pts.length === 1) return pts[0].x;
  if (d.kind === "discrete") {
    const sorted = d.values.map((v, i) => [v, d.probs[i] ?? 0]).sort((a, b) => a[0] - b[0]);
    let acc = 0;
    for (const [v, p] of sorted) { acc += p; if (acc >= q - 1e-12) return v; }
    return sorted[sorted.length - 1][0];
  }
  const total = pts.reduce((a, p, i) => (i ? a + ((p.y + pts[i - 1].y) / 2) * (p.x - pts[i - 1].x) : a), 0);
  let acc = 0;
  for (let i = 1; i < pts.length; i++) {
    acc += ((pts[i].y + pts[i - 1].y) / 2) * (pts[i].x - pts[i - 1].x);
    if (acc / total >= q) return pts[i].x;
  }
  return pts[pts.length - 1].x;
}
