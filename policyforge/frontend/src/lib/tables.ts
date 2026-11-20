// The spreadsheet views: columns per table (the same columns as the CSV templates of
// backend/core/domain/network_io.py), cell text ↔ values, and paste from Excel (tab-separated) with errors by cell.

import { distFromText, distToText } from "./distribution";
import { round } from "./edits";
import type { DemandOverride, Lane, Network } from "./types";

export type TableName = "skus" | "suppliers" | "plants" | "dcs" | "markets" | "lanes" | "demand_overrides";
export const TABLES: TableName[] = ["skus", "suppliers", "plants", "dcs", "markets", "lanes", "demand_overrides"];

type Row = Record<string, any>;

export interface Column {
  key: string;
  type: "string" | "number" | "integer" | "nullable-number" | "nullable-integer" | "list" | "sourcing" | "dist"
    | "nullable-string";
  get: (row: Row) => string;
  set: (row: Row, text: string) => Row; // throws Error with a message on bad text
}

const num = (v: unknown) => (v === null || v === undefined ? "" : String(v));

function parseNumber(text: string, integer: boolean): number {
  const t = text.trim().replace(/\s/g, "");
  // Accept decimal commas from European Excel when there is no other comma ("0,5")
  const v = Number(/^-?\d+,\d+$/.test(t) ? t.replace(",", ".") : t);
  if (t === "" || Number.isNaN(v)) throw new Error(`"${text}" is not a number`);
  if (integer && !Number.isInteger(v)) throw new Error(`"${text}" is not a whole number`);
  return v;
}

const plain = (key: string, type: Column["type"] = "string"): Column => ({
  key, type,
  get: (r) => num(r[key]),
  set: (r, t) => {
    let v: any = t.trim();
    if (type === "number" || type === "integer") v = parseNumber(t, type === "integer");
    if (type === "nullable-number" || type === "nullable-integer") {
      v = t.trim() === "" ? null : parseNumber(t, type === "nullable-integer");
    }
    if (type === "nullable-string") v = t.trim() === "" ? null : t.trim();
    return { ...r, [key]: v };
  },
});

const loc = (key: "lat" | "lon" | "x_km" | "y_km"): Column => ({
  key, type: key === "lat" || key === "lon" ? "nullable-number" : "number",
  get: (r) => num(r.location?.[key]),
  set: (r, t) => {
    const v = t.trim() === "" ? (key === "lat" || key === "lon" ? null : 0) : parseNumber(t, false);
    return { ...r, location: { ...r.location, [key]: v } };
  },
});

const LOC = [loc("lat"), loc("lon"), loc("x_km"), loc("y_km")];

const distCol = (key: string, nested?: "expedite"): Column => ({
  key: nested ? `expedite_${key}` : key, type: "dist",
  get: (r) => {
    const d = nested ? r.expedite?.[key] : r[key];
    return d ? distToText(d) : "";
  },
  set: (r, t) => {
    if (nested) {
      if (t.trim() === "") return { ...r, expedite: null };
      return { ...r, expedite: { mode: "express_road", cost_multiplier: 2, ...r.expedite, [key]: distFromText(t) } };
    }
    return { ...r, [key]: distFromText(t) };
  },
});

export const COLUMNS: Record<TableName, Column[]> = {
  skus: [plain("id"), plain("name"), plain("abc_class"), plain("category"), plain("shelf_life_days", "nullable-integer"),
    plain("unit_cost", "number"), plain("holding_cost_per_unit_period", "number"),
    plain("backorder_penalty_per_unit_period", "number"), plain("lost_sale_penalty_per_unit", "number"),
    plain("unmet_demand"), plain("base_demand", "number"), plain("demand_cv", "number"),
    plain("seasonality_amplitude", "number"), plain("seasonality_peak_period", "integer"), plain("weight_kg", "number")],
  suppliers: [plain("id"), plain("name"), ...LOC, plain("capacity_per_period", "number"),
    plain("unit_cost_index", "number"), plain("fill_rate_mean", "number"), plain("fill_rate_sd", "number"),
    plain("ordering_cost", "number")],
  plants: [plain("id"), plain("name"), ...LOC, plain("capacity_per_period", "number"),
    plain("production_cost_per_unit", "number"),
    { key: "skus", type: "list", get: (r) => (r.skus ?? []).join(" "),
      set: (r, t) => ({ ...r, skus: t.split(/[\s,;]+/).filter(Boolean) }) },
    { key: "sourcing", type: "sourcing",
      get: (r) => (r.sourcing ?? []).map((s: any) => `${s.supplier}=${s.share}`).join(" "),
      set: (r, t) => ({ ...r, sourcing: parseSourcing(t) }) }],
  dcs: [plain("id"), plain("name"), ...LOC, plain("storage_capacity", "number")],
  markets: [plain("id"), plain("name"), plain("region"), ...LOC, plain("size_factor", "number"), plain("served_by")],
  lanes: [plain("id"), plain("origin"), plain("destination"), plain("mode"), plain("distance_km", "number"),
    plain("cost_per_unit", "number"), distCol("lead_time_days"),
    { key: "expedite_mode", type: "nullable-string", get: (r) => r.expedite?.mode ?? "",
      set: (r, t) => (t.trim() === "" ? { ...r, expedite: null }
        : { ...r, expedite: { lead_time_days: { kind: "gamma", mu: 3, cv: 0.1 }, cost_multiplier: 2, ...r.expedite,
          mode: t.trim() } }) },
    distCol("lead_time_days", "expedite"),
    { key: "expedite_cost_multiplier", type: "nullable-number", get: (r) => num(r.expedite?.cost_multiplier),
      set: (r, t) => (t.trim() === "" ? r : { ...r, expedite: { mode: "express_road",
        lead_time_days: { kind: "gamma", mu: 3, cv: 0.1 }, ...r.expedite, cost_multiplier: parseNumber(t, false) } }) }],
  demand_overrides: [plain("market"), plain("sku"), plain("mean", "number"), plain("cv", "nullable-number")],
};

export function parseSourcing(text: string): { supplier: string; share: number }[] {
  return text.split(/[\s,;]+/).filter(Boolean).map((part) => {
    const m = /^([A-Za-z][\w-]*)=([\d.]+)$/.exec(part);
    if (!m) throw new Error(`write sourcing as SUPPLIER=share, e.g. SUP_A=0.5 SUP_B=0.5, not "${part}"`);
    return { supplier: m[1], share: Number(m[2]) };
  });
}

/** Excel puts tab-separated cells on the clipboard, with quotes around cells that hold tabs or newlines. */
export function parseTsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  const s = text.replace(/\r\n?/g, "\n");
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quoted) {
      if (c === '"' && s[i + 1] === '"') { cell += '"'; i++; } else if (c === '"') quoted = false; else cell += c;
    } else if (c === '"' && cell === "") quoted = true;
    else if (c === "\t") { row.push(cell); cell = ""; } else if (c === "\n") { row.push(cell); rows.push(row); row = []; cell = ""; } else cell += c;
  }
  if (cell !== "" || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

export interface CellError { row: number; column: string; message: string }

const BLANK: Record<TableName, () => Row> = {
  skus: () => ({ id: "", name: "", abc_class: "B", category: "ambient", shelf_life_days: null, unit_cost: 1,
    holding_cost_per_unit_period: 0, backorder_penalty_per_unit_period: 0, lost_sale_penalty_per_unit: 0,
    unmet_demand: "backorder", base_demand: 0, demand_cv: 0, seasonality_amplitude: 0, seasonality_peak_period: 0,
    weight_kg: 1 }),
  suppliers: () => ({ id: "", name: "", location: { x_km: 0, y_km: 0 }, capacity_per_period: 1, unit_cost_index: 1,
    fill_rate_mean: 1, fill_rate_sd: 0, ordering_cost: 0 }),
  plants: () => ({ id: "", name: "", location: { x_km: 0, y_km: 0 }, capacity_per_period: 1,
    production_cost_per_unit: 0, skus: [], sourcing: [] }),
  dcs: () => ({ id: "", name: "", location: { x_km: 0, y_km: 0 }, storage_capacity: 1 }),
  markets: () => ({ id: "", name: "", region: "", location: { x_km: 0, y_km: 0 }, size_factor: 0, served_by: "" }),
  lanes: () => ({ id: "", origin: "", destination: "", mode: "road", lead_time_days: { kind: "deterministic", value: 1 },
    cost_per_unit: 0, distance_km: 0, expedite: null } satisfies Lane),
  demand_overrides: () => ({ market: "", sku: "", mean: 0, cv: null } satisfies DemandOverride),
};

/**
 * Paste a block of cells with its top-left at (row, col). Rows past the end are added. A first row that repeats the
 * column names is taken as a header and maps the columns by name instead.
 */
export function paste(net: Network, table: TableName, atRow: number, atCol: number, cells: string[][]):
  { net: Network; errors: CellError[]; rows: number } {
  const cols = COLUMNS[table];
  let block = cells.filter((r) => r.some((c) => c.trim() !== ""));
  let mapping: (Column | undefined)[] = block[0]?.map((_, j) => cols[atCol + j]) ?? [];
  const header = block[0]?.map((c) => c.trim());
  if (header && header.every((h) => cols.some((c) => c.key === h))) {
    mapping = header.map((h) => cols.find((c) => c.key === h));
    block = block.slice(1);
    atCol = 0;
  }
  const rows = (net[table] as Row[]).slice();
  const errors: CellError[] = [];
  block.forEach((cellsInRow, i) => {
    const r = atRow + i;
    let row = rows[r] ?? BLANK[table]();
    cellsInRow.forEach((text, j) => {
      const col = mapping[j];
      if (!col) return;
      try { row = col.set(row, text); } catch (e) { errors.push({ row: r, column: col.key, message: (e as Error).message }); }
    });
    rows[r] = row;
  });
  return { net: { ...net, [table]: rows }, errors, rows: block.length };
}

/** Copy rows as tab-separated text with a header, for Excel. */
export function copy(net: Network, table: TableName): string {
  const cols = COLUMNS[table];
  const esc = (s: string) => (/[\t\n"]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
  return [cols.map((c) => c.key).join("\t"),
    ...(net[table] as Row[]).map((r) => cols.map((c) => esc(c.get(r))).join("\t"))].join("\n");
}

export function blankRow(table: TableName): Row {
  return BLANK[table]();
}

// ---------------------------------------------------------------- the market × SKU demand grid
export interface DemandCell { mean: number; overridden: boolean; base: number }

export function demandGrid(net: Network): DemandCell[][] {
  return net.markets.map((m) => net.skus.map((s) => {
    const base = round(s.base_demand * m.size_factor, 4);
    const o = net.demand_overrides.find((x) => x.market === m.id && x.sku === s.id);
    return { mean: o ? o.mean : base, overridden: !!o, base };
  }));
}

/** Set one market × SKU mean: equal to base × size factor removes the override, anything else sets one. */
export function setDemand(net: Network, market: string, sku: string, mean: number | null): Network {
  const rest = net.demand_overrides.filter((o) => !(o.market === market && o.sku === sku));
  const m = net.markets.find((x) => x.id === market);
  const s = net.skus.find((x) => x.id === sku);
  if (mean === null || !m || !s || Math.abs(mean - s.base_demand * m.size_factor) < 1e-9) {
    return { ...net, demand_overrides: rest };
  }
  const old = net.demand_overrides.find((o) => o.market === market && o.sku === sku);
  return { ...net, demand_overrides: [...rest, { market, sku, mean, cv: old?.cv ?? null }] };
}
