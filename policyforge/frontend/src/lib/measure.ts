// Colour the diagram and the map by a measure. Each measure gives elements a value, a label, and a position
// 0 (good) … 1 (bad) on the heat scale; elements without a value stay neutral.

import { mean } from "./distribution";
import type { Network } from "./types";

export type MeasureName = "none" | "utilisation" | "cost" | "lead_time" | "fill_rate";
export const MEASURES: { name: MeasureName; label: string; needs?: "health" | "quick" }[] = [
  { name: "none", label: "No colour" },
  { name: "utilisation", label: "Utilisation", needs: "health" },
  { name: "cost", label: "Cost" },
  { name: "lead_time", label: "Lead time" },
  { name: "fill_rate", label: "Fill rate (quick test)", needs: "quick" },
];

export interface Value { t: number; label: string }

export interface Inputs {
  plantLoad?: Record<string, number>;
  supplierLoad?: Record<string, number>;
  fillByMarket?: Record<string, number>;
  fillByDc?: Record<string, number>;
}

const unit = (x: number) => Math.round(Math.max(0, Math.min(1, x)) * 1e6) / 1e6;
const pct = (x: number) => `${Math.round(x * 100)}%`;
const spread = (vals: [string, number][], fmt: (v: number) => string, out: Map<string, Value>, prefix: string) => {
  if (!vals.length) return;
  const lo = Math.min(...vals.map((v) => v[1]));
  const hi = Math.max(...vals.map((v) => v[1]));
  for (const [id, v] of vals) out.set(`${prefix}:${id}`, { t: hi > lo ? (v - lo) / (hi - lo) : 0, label: fmt(v) });
};

/** Values by element key ("node:PLANT_N", "lane:L_A_N"). */
export function measure(net: Network, name: MeasureName, inp: Inputs): Map<string, Value> {
  const out = new Map<string, Value>();
  switch (name) {
    case "utilisation":
      // 70% and below is comfortable, 100% is the limit
      for (const [id, v] of Object.entries({ ...inp.plantLoad, ...inp.supplierLoad })) {
        out.set(`node:${id}`, { t: unit((v - 0.7) / 0.3), label: pct(v) });
      }
      break;
    case "cost":
      spread(net.lanes.map((l) => [l.id, l.cost_per_unit]), (v) => `€${v.toFixed(2)}/u`, out, "lane");
      spread(net.plants.map((p) => [p.id, p.production_cost_per_unit]), (v) => `€${v.toFixed(2)}/u`, out, "node");
      spread(net.suppliers.map((s) => [s.id, s.unit_cost_index]), (v) => `×${v.toFixed(2)}`, out, "node");
      break;
    case "lead_time":
      spread(net.lanes.map((l) => [l.id, mean(l.lead_time_days)]), (v) => `${v.toFixed(1)} d`, out, "lane");
      break;
    case "fill_rate":
      // 99% and above is good, 90% and below is bad
      for (const [id, v] of Object.entries({ ...inp.fillByMarket, ...inp.fillByDc })) {
        out.set(`node:${id}`, { t: unit((0.99 - v) / 0.09), label: pct(v) });
      }
      break;
    default:
  }
  return out;
}
