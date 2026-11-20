// The network as the engine reads it (backend/core/domain/network.py). The JSON Schema exported from the Python
// models is the authority; these types only help the editor's code.

export type Dist =
  | { kind: "deterministic"; value: number }
  | { kind: "normal"; mu: number; sigma: number }
  | { kind: "gamma"; mu: number; cv: number }
  | { kind: "triangular"; low: number; mode: number; high: number }
  | { kind: "discrete"; values: number[]; probs: number[] };

export type Mode = "road" | "rail" | "sea" | "air" | "express_road";

export interface Location { x_km: number; y_km: number; lat?: number | null; lon?: number | null }

export interface Sku {
  id: string; name: string; abc_class: "A" | "B" | "C"; category: "chilled" | "ambient";
  shelf_life_days?: number | null; unit_cost: number; holding_cost_per_unit_period: number;
  backorder_penalty_per_unit_period: number; lost_sale_penalty_per_unit: number;
  unmet_demand: "backorder" | "lost_sale"; base_demand: number; demand_cv: number;
  seasonality_amplitude: number; seasonality_peak_period: number; weight_kg: number;
}

export interface Supplier {
  id: string; name: string; location: Location; capacity_per_period: number; unit_cost_index: number;
  fill_rate_mean: number; fill_rate_sd: number; ordering_cost: number;
}

export interface Plant {
  id: string; name: string; location: Location; capacity_per_period: number; production_cost_per_unit: number;
  skus: string[]; sourcing: { supplier: string; share: number }[];
}

export interface Dc { id: string; name: string; location: Location; storage_capacity: number }

export interface Market {
  id: string; name: string; region: string; location: Location; size_factor: number; served_by: string;
}

export interface Lane {
  id: string; origin: string; destination: string; mode: Mode; lead_time_days: Dist; cost_per_unit: number;
  distance_km: number;
  expedite?: { mode: "air" | "express_road"; lead_time_days: Dist; cost_multiplier: number } | null;
}

export interface DemandOverride { market: string; sku: string; mean: number; cv?: number | null }

export interface Network {
  name: string; currency: "EUR"; period_days: number; skus: Sku[]; suppliers: Supplier[]; plants: Plant[];
  dcs: Dc[]; markets: Market[]; lanes: Lane[]; demand_overrides: DemandOverride[];
  emission_factors: Record<Mode, number>;
}

export type NodeGroup = "suppliers" | "plants" | "dcs" | "markets";
export const NODE_GROUPS: NodeGroup[] = ["suppliers", "plants", "dcs", "markets"];
export type AnyNode = Supplier | Plant | Dc | Market;

/** Which group may ship to which: the only lane directions the engine accepts. */
export const NEXT: Record<NodeGroup, NodeGroup | null> = {
  suppliers: "plants", plants: "dcs", dcs: "markets", markets: null,
};

/** A located error or warning: `path` is dotted, as the Python side reports it (e.g. "markets.0.served_by"). */
export interface Issue { path: string; message: string; level: "field" | "reference" | "health"; severity: "error" | "warning" | "info" }
