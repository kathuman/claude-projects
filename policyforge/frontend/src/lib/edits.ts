// Graph edits that keep the network consistent: adding a node gives it valid defaults, deleting cascades to the
// lanes, sourcing shares, markets and overrides that refer to it, renaming updates every reference. All pure.

import { greatCircleKm, ROAD_FACTOR } from "./projection";
import type { AnyNode, Dc, Lane, Market, Network, NodeGroup, Plant, Sku, Supplier } from "./types";
import { NEXT, NODE_GROUPS } from "./types";

export const ID_RE = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/;

export function findNode(net: Network, id: string): { group: NodeGroup; index: number; node: AnyNode } | null {
  for (const group of NODE_GROUPS) {
    const index = (net[group] as AnyNode[]).findIndex((n) => n.id === id);
    if (index >= 0) return { group, index, node: (net[group] as AnyNode[])[index] };
  }
  return null;
}

export function allIds(net: Network): Set<string> {
  return new Set([...NODE_GROUPS.flatMap((g) => (net[g] as AnyNode[]).map((n) => n.id))]);
}

export function uniqueId(taken: Set<string>, prefix: string): string {
  for (let i = 1; ; i++) {
    const id = `${prefix}${i}`;
    if (!taken.has(id)) return id;
  }
}

const PREFIX: Record<NodeGroup, string> = { suppliers: "SUP_", plants: "PLANT_", dcs: "DC_", markets: "MKT_" };
const LABEL: Record<NodeGroup, string> = { suppliers: "Supplier", plants: "Plant", dcs: "DC", markets: "Market" };

/** A new node with valid field values; references (sourcing, served_by) point at the first candidates. */
export function newNode(net: Network, group: NodeGroup, at?: { lat: number; lon: number }): AnyNode {
  const id = uniqueId(allIds(net), PREFIX[group]);
  const location = { x_km: 0, y_km: 0, ...(at ? { lat: round(at.lat, 2), lon: round(at.lon, 2) } : {}) };
  const name = `${LABEL[group]} ${id.slice(PREFIX[group].length)}`;
  switch (group) {
    case "suppliers":
      return { id, name, location, capacity_per_period: 5000, unit_cost_index: 1, fill_rate_mean: 0.97,
        fill_rate_sd: 0.03, ordering_cost: 100 } satisfies Supplier;
    case "plants":
      return { id, name, location, capacity_per_period: 5000, production_cost_per_unit: 0.3,
        skus: net.skus.length ? [net.skus[0].id] : [],
        sourcing: net.suppliers.length ? [{ supplier: net.suppliers[0].id, share: 1 }] : [] } satisfies Plant;
    case "dcs":
      return { id, name, location, storage_capacity: 30000 } satisfies Dc;
    case "markets":
      return { id, name, region: "", location, size_factor: 0.1,
        served_by: net.dcs.length ? net.dcs[0].id : "" } satisfies Market;
  }
}

export function addNode(net: Network, group: NodeGroup, at?: { lat: number; lon: number }): [Network, string] {
  const node = newNode(net, group, at);
  return [{ ...net, [group]: [...(net[group] as AnyNode[]), node] }, node.id];
}

export function newSku(net: Network): Sku {
  const id = uniqueId(new Set(net.skus.map((s) => s.id)), "S");
  return { id, name: `SKU ${id}`, abc_class: "B", category: "ambient", shelf_life_days: null, unit_cost: 2,
    holding_cost_per_unit_period: 0.02, backorder_penalty_per_unit_period: 0.5, lost_sale_penalty_per_unit: 0,
    unmet_demand: "backorder", base_demand: 500, demand_cv: 0.3, seasonality_amplitude: 0,
    seasonality_peak_period: 0, weight_kg: 1 };
}

/** Delete a node and everything that only made sense with it. */
export function removeNode(net: Network, id: string): Network {
  const found = findNode(net, id);
  if (!found) return net;
  const out: Network = { ...net, [found.group]: (net[found.group] as AnyNode[]).filter((n) => n.id !== id) };
  out.lanes = net.lanes.filter((l) => l.origin !== id && l.destination !== id);
  if (found.group === "suppliers") {
    out.plants = net.plants.map((p) => {
      if (!p.sourcing.some((s) => s.supplier === id)) return p;
      return { ...p, sourcing: renormalise(p.sourcing.filter((s) => s.supplier !== id)) };
    });
  }
  if (found.group === "dcs") {
    out.markets = net.markets.map((m) => (m.served_by === id ? { ...m, served_by: "" } : m));
  }
  if (found.group === "markets") out.demand_overrides = net.demand_overrides.filter((o) => o.market !== id);
  return out;
}

export function renormalise(shares: { supplier: string; share: number }[]): { supplier: string; share: number }[] {
  const total = shares.reduce((a, s) => a + s.share, 0);
  if (shares.length === 0) return shares;
  if (total <= 0) return shares.map((s, i) => ({ ...s, share: i === 0 ? 1 : 0 }));
  const out = shares.map((s) => ({ ...s, share: round(s.share / total, 4) }));
  const drift = round(1 - out.reduce((a, s) => a + s.share, 0), 4); // keep the sum exactly 1
  out[0] = { ...out[0], share: round(out[0].share + drift, 4) };
  return out;
}

/** Rename a node and every reference to it. Refuses ids that are invalid or taken. */
export function renameNode(net: Network, from: string, to: string): Network | string {
  if (from === to) return net;
  if (!ID_RE.test(to)) return "an id starts with a letter and uses letters, digits, _ and - only";
  if (allIds(net).has(to)) return `${to} is already used`;
  const found = findNode(net, from);
  if (!found) return `no node ${from}`;
  const swap = (x: string) => (x === from ? to : x);
  return {
    ...net,
    [found.group]: (net[found.group] as AnyNode[]).map((n) => (n.id === from ? { ...n, id: to } : n)),
    lanes: net.lanes.map((l) => ({ ...l, origin: swap(l.origin), destination: swap(l.destination) })),
    plants: (found.group === "plants" ? (net.plants.map((p) => (p.id === from ? { ...p, id: to } : p)))
      : net.plants).map((p) => ({ ...p, sourcing: p.sourcing.map((s) => ({ ...s, supplier: swap(s.supplier) })) })),
    markets: (found.group === "markets" ? net.markets.map((m) => (m.id === from ? { ...m, id: to } : m))
      : net.markets).map((m) => ({ ...m, served_by: swap(m.served_by) })),
    demand_overrides: net.demand_overrides.map((o) => ({ ...o, market: swap(o.market) })),
  };
}

export function renameSku(net: Network, from: string, to: string): Network | string {
  if (from === to) return net;
  if (!ID_RE.test(to)) return "an id starts with a letter and uses letters, digits, _ and - only";
  if (net.skus.some((s) => s.id === to)) return `${to} is already used`;
  const swap = (x: string) => (x === from ? to : x);
  return {
    ...net,
    skus: net.skus.map((s) => (s.id === from ? { ...s, id: to } : s)),
    plants: net.plants.map((p) => ({ ...p, skus: p.skus.map(swap) })),
    demand_overrides: net.demand_overrides.map((o) => ({ ...o, sku: swap(o.sku) })),
  };
}

export function removeSku(net: Network, id: string): Network {
  return {
    ...net,
    skus: net.skus.filter((s) => s.id !== id),
    plants: net.plants.map((p) => ({ ...p, skus: p.skus.filter((k) => k !== id) })),
    demand_overrides: net.demand_overrides.filter((o) => o.sku !== id),
  };
}

export function suggestDistance(net: Network, origin: string, destination: string): number | null {
  const a = findNode(net, origin)?.node.location;
  const b = findNode(net, destination)?.node.location;
  if (a?.lat == null || a.lon == null || b?.lat == null || b.lon == null) return null;
  return Math.round(greatCircleKm(a.lat, a.lon, b.lat, b.lon) * ROAD_FACTOR);
}

/** Why a lane cannot be drawn from `origin` to `destination`, or null if it can. */
export function laneRefusal(net: Network, origin: string, destination: string): string | null {
  const a = findNode(net, origin);
  const b = findNode(net, destination);
  if (!a || !b) return "both ends must be nodes";
  if (NEXT[a.group] !== b.group) return `lanes go supplier → plant → DC → market, not ${a.group} → ${b.group}`;
  if (net.lanes.some((l) => l.origin === origin && l.destination === destination)) return "that lane exists";
  return null;
}

/** Draw a lane. A DC → market lane also makes that DC the market's server, replacing its old DC lane. */
export function connect(net: Network, origin: string, destination: string): [Network, string] | string {
  const refusal = laneRefusal(net, origin, destination);
  if (refusal) return refusal;
  const km = suggestDistance(net, origin, destination) ?? 300;
  const short = (x: string) => x.replace(/^(SUP|PLANT|DC|MKT)_/, "");
  const taken = new Set(net.lanes.map((l) => l.id));
  let id = `L_${short(origin)}_${short(destination)}`;
  if (taken.has(id) || !ID_RE.test(id)) id = uniqueId(taken, `${id.slice(0, 50)}_`);
  const lane: Lane = { id, origin, destination, mode: "road",
    lead_time_days: { kind: "gamma", mu: Math.max(1, Math.round(km / 500 + 1)), cv: 0.1 },
    cost_per_unit: Math.max(0.01, round(km * 0.00035, 2)), distance_km: km, expedite: null };
  let out: Network = { ...net, lanes: [...net.lanes, lane] };
  const dest = findNode(net, destination)!;
  if (dest.group === "markets") {
    const old = (dest.node as Market).served_by;
    out = { ...out, lanes: out.lanes.filter((l) => l.id === id || !(old !== origin && l.origin === old && l.destination === destination)),
      markets: out.markets.map((m) => (m.id === destination ? { ...m, served_by: origin } : m)) };
  }
  if (dest.group === "plants") {
    out = { ...out, plants: out.plants.map((p) => (p.id === destination && !p.sourcing.some((s) => s.supplier === origin)
      ? { ...p, sourcing: [...p.sourcing, { supplier: origin, share: 0 }] } : p)) };
  }
  return [out, id];
}

export function removeLane(net: Network, id: string): Network {
  return { ...net, lanes: net.lanes.filter((l) => l.id !== id) };
}

export function moveNode(net: Network, group: NodeGroup, from: number, to: number): Network {
  const list = (net[group] as AnyNode[]).slice();
  const [x] = list.splice(from, 1);
  list.splice(Math.max(0, Math.min(list.length, to)), 0, x);
  return { ...net, [group]: list };
}

export function emptyNetwork(name = "New network"): Network {
  return { name, currency: "EUR", period_days: 7, skus: [], suppliers: [], plants: [], dcs: [], markets: [],
    lanes: [], demand_overrides: [], emission_factors: { road: 0.105, rail: 0.028, sea: 0.016, air: 0.6,
      express_road: 0.15 } };
}

export function round(x: number, d: number): number {
  const f = 10 ** d;
  return Math.round(x * f) / f;
}
