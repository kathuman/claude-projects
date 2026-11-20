// The scenario builder's model: components (backend/core/domain/scenario.py) with sensible defaults for the
// current network, where each sits on the timeline, and a one-line summary.

import type { Network } from "./types";

export type ComponentKind = "baseline_demand" | "demand_shift" | "supplier_outage" | "lead_time_inflation"
  | "plant_capacity_loss" | "correlated_shock" | "signal_noise";

export const KINDS: { kind: ComponentKind; label: string }[] = [
  { kind: "supplier_outage", label: "Supplier outage" },
  { kind: "lead_time_inflation", label: "Lead-time inflation" },
  { kind: "plant_capacity_loss", label: "Plant capacity loss" },
  { kind: "demand_shift", label: "Demand shift" },
  { kind: "correlated_shock", label: "Correlated shock" },
  { kind: "signal_noise", label: "Signal noise" },
  { kind: "baseline_demand", label: "Baseline demand" },
];

export type Component = Record<string, any> & { kind: ComponentKind };

export interface Scenario { id: string; name: string; description: string; components: Component[] }
export interface ScenarioSet { id: string; name: string; scenarios: Scenario[] }

export function defaultComponent(kind: ComponentKind, net: Network, start = 10): Component {
  const sup = net.suppliers[0]?.id ?? "";
  switch (kind) {
    case "baseline_demand": return { kind, seasonality: true };
    case "demand_shift": return { kind, window: { start, duration: 4 }, factor: 1.5, markets: [], skus: [], categories: [] };
    case "supplier_outage": return { kind, supplier: sup, window: { start, duration: 6 }, severity: 1 };
    case "lead_time_inflation": return { kind, supplier: sup, start, factor: 1.5, ramp_periods: 4 };
    case "plant_capacity_loss": return { kind, plant: net.plants[0]?.id ?? "", window: { start, duration: 4 }, severity: 0.5 };
    case "correlated_shock": return { kind, probability: 0.5, earliest_start: start, latest_start: start + 20, duration: 6,
      suppliers: sup ? [sup] : [], supply_severity: 0.5, lead_time_factor: 1.5, markets: [], demand_factor: 1 };
    case "signal_noise": return { kind, noise_cv: 0.2, extra_delay: 1 };
  }
}

/** Where a component sits on a timeline of `horizon` periods: [start, end) with `fuzzy` for random timing. */
export function span(c: Component, horizon: number): { start: number; end: number; fuzzy?: [number, number] } {
  const clip = (x: number) => Math.max(0, Math.min(horizon, x));
  switch (c.kind) {
    case "demand_shift": case "supplier_outage": case "plant_capacity_loss": {
      const s = c.window?.start ?? 0;
      return { start: clip(s), end: clip(c.window?.duration == null ? horizon : s + c.window.duration) };
    }
    case "lead_time_inflation": return { start: clip(c.start), end: horizon };
    case "correlated_shock": return { start: clip(c.earliest_start), end: clip(c.latest_start + c.duration),
      fuzzy: [clip(c.earliest_start), clip(c.latest_start)] };
    default: return { start: 0, end: horizon };
  }
}

const pct = (x: number) => `${Math.round(x * 100)}%`;
const win = (w: { start: number; duration?: number | null }) => (w.duration == null
  ? `from period ${w.start}` : `periods ${w.start}–${w.start + w.duration - 1}`);

export function summary(c: Component): string {
  switch (c.kind) {
    case "baseline_demand": return c.seasonality ? "seasonal demand (always applied)" : "flat demand";
    case "demand_shift": return `demand ×${c.factor} ${win(c.window)}${c.markets?.length ? ` in ${c.markets.join(", ")}` : ""}`;
    case "supplier_outage": return `${c.supplier} loses ${pct(c.severity)} of capacity, ${win(c.window)}`;
    case "lead_time_inflation": return `${c.supplier} lead times ×${c.factor} from period ${c.start}${c.ramp_periods ? `, over ${c.ramp_periods} periods` : ""}`;
    case "plant_capacity_loss": return `${c.plant} loses ${pct(c.severity)} of capacity, ${win(c.window)}`;
    case "correlated_shock": return `${pct(c.probability)} chance, starts ${c.earliest_start}–${c.latest_start}, lasts ${c.duration}: ${[...c.suppliers, ...c.markets].join(", ")}`;
    case "signal_noise": return `demand signal noise ${pct(c.noise_cv)}, ${c.extra_delay} extra period${c.extra_delay === 1 ? "" : "s"} of delay`;
  }
}

/** Shift a component in time (dragging it on the timeline). */
export function shift(c: Component, by: number): Component {
  const mv = (x: number) => Math.max(0, x + by);
  if (c.window) return { ...c, window: { ...c.window, start: mv(c.window.start) } };
  if (c.kind === "lead_time_inflation") return { ...c, start: mv(c.start) };
  if (c.kind === "correlated_shock") {
    const d = Math.max(by, -c.earliest_start);
    return { ...c, earliest_start: c.earliest_start + d, latest_start: c.latest_start + d };
  }
  return c;
}

export function emptyScenario(n: number): Scenario {
  return { id: `scenario-${n}`, name: `Scenario ${n}`, description: "", components: [] };
}
