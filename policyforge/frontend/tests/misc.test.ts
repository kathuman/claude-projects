import { describe, expect, it } from "vitest";
import { curve, distFromText, distToText, mean, quantile, sd } from "../src/lib/distribution";
import { diagramSize, heat, lanePath, placeNodes, rowAt } from "../src/lib/layout";
import { fit, greatCircleKm, greatCirclePoints, pan, project, unproject, zoomAt } from "../src/lib/projection";
import { defaultComponent, shift, span, summary } from "../src/lib/scenario";
import { copy, demandGrid, parseTsv, paste, setDemand } from "../src/lib/tables";
import { elementKey, healthKey, issuesByElement, issuesOnField, targetOf } from "../src/lib/targets";
import type { Dist } from "../src/lib/types";
import { foodnet } from "./fixtures";

describe("projection", () => {
  it("measures like Python", () => {
    expect(greatCircleKm(48.8566, 2.3522, 51.5074, -0.1278)).toBeCloseTo(343.5, 0);
  });
  it("round-trips screen and world, and zooms about the pointer", () => {
    const v = { scale: 10, ox: 170, oy: 30 };
    const [x, y] = project(v, 4.4, 51.2);
    expect(unproject(v, x, y).lat).toBeCloseTo(51.2, 9);
    const z = zoomAt(v, x, y, 2);
    expect(project(z, 4.4, 51.2)[0]).toBeCloseTo(x, 6);
    expect(pan(v, 10, 0).ox).toBeCloseTo(169, 9);
  });
  it("fits points and draws great circles", () => {
    const net = foodnet();
    const pts = net.markets.map((m) => ({ lat: m.location.lat!, lon: m.location.lon! }));
    const v = fit(pts, 800, 600);
    for (const p of pts) {
      const [x, y] = project(v, p.lon, p.lat);
      expect(x).toBeGreaterThan(0); expect(x).toBeLessThan(800); expect(y).toBeGreaterThan(0); expect(y).toBeLessThan(600);
    }
    const arc = greatCirclePoints(51.5, -0.1, 40.7, -74, 10);
    expect(arc).toHaveLength(11);
    expect(arc[5][1]).toBeGreaterThan(51); // London–New York bends north
    expect(fit([], 720, 360).scale).toBe(2);
  });
});

describe("distributions", () => {
  const cases = ["deterministic(1)", "normal(5, 1)", "gamma(12, 0.35)", "triangular(1, 2, 4)", "discrete(1 2 3 | 0.2 0.5 0.3)"];
  it("text round trips like the CSV files", () => {
    for (const t of cases) expect(distToText(distFromText(t))).toBe(t);
    expect(distToText({ kind: "gamma", mu: 21.0, cv: 0.08 })).toBe("gamma(21, 0.08)");
    expect(distToText({ kind: "normal", mu: 1 / 3, sigma: 1 })).toBe("normal(0.333333, 1)");
    for (const bad of ["gamma", "beta(1, 2)", "discrete(1 2)", "triangular(1, 2)"]) expect(() => distFromText(bad)).toThrow();
  });
  it("gives moments, a curve and quantiles", () => {
    const g: Dist = { kind: "gamma", mu: 20, cv: 0.1 };
    expect([mean(g), sd(g)]).toEqual([20, 2]);
    const area = curve(g, 400).reduce((a, p, i, arr) => (i ? a + ((p.y + arr[i - 1].y) / 2) * (p.x - arr[i - 1].x) : a), 0);
    expect(area).toBeCloseTo(1, 2);
    expect(quantile(g, 0.5)).toBeCloseTo(19.9, 0);
    expect(quantile({ kind: "normal", mu: 10, sigma: 2 }, 0.95)).toBeCloseTo(13.29, 0);
    expect(quantile({ kind: "discrete", values: [3, 1, 2], probs: [0.3, 0.2, 0.5] }, 0.9)).toBe(3);
    expect(sd({ kind: "triangular", low: 1, mode: 2, high: 3 })).toBeCloseTo(Math.sqrt(1 / 6), 9);
    expect(curve({ kind: "deterministic", value: 4 })).toEqual([{ x: 4, y: 1 }]);
  });
});

describe("tables", () => {
  it("parses Excel's clipboard, quotes included", () => {
    expect(parseTsv('a\tb\r\n"x\ty"\t"say ""hi"""\n')).toEqual([["a", "b"], ["x\ty", 'say "hi"']]);
  });
  it("copy then paste into an empty network rebuilds the table", () => {
    const net = foodnet();
    for (const t of ["skus", "suppliers", "plants", "dcs", "markets", "lanes"] as const) {
      const empty = { ...net, [t]: [] };
      const r = paste(empty, t, 0, 0, parseTsv(copy(net, t)));
      expect(r.errors).toEqual([]);
      expect(r.net[t], t).toEqual(net[t]);
    }
  });
  it("reports bad cells by row and column and keeps the rest", () => {
    const r = paste(foodnet(), "lanes", 1, 4, [["abc", "0,25", "gamma(21)"]]);
    expect(r.errors.map((e) => [e.row, e.column])).toEqual([[1, "distance_km"], [1, "lead_time_days"]]);
    expect(r.net.lanes[1].cost_per_unit).toBe(0.25); // decimal comma read
    const s = paste(foodnet(), "plants", 0, 9, [["SUP_A:1"]]);
    expect(s.errors[0].message).toMatch(/SUPPLIER=share/);
  });
  it("edits demand as base × size factor plus overrides", () => {
    const net = foodnet();
    const g = demandGrid(net);
    expect(g[0][0]).toEqual({ mean: 1200 * 0.22, overridden: false, base: 264 });
    const n2 = setDemand(net, "MKT_N1", "S01", 300);
    expect(demandGrid(n2)[0][0]).toMatchObject({ mean: 300, overridden: true });
    expect(setDemand(n2, "MKT_N1", "S01", 264).demand_overrides).toEqual([]);
  });
});

describe("targets", () => {
  const net = foodnet();
  it("maps error paths to elements", () => {
    expect(targetOf(net, "plants.1.sourcing.0.supplier")).toMatchObject({ kind: "node", id: "PLANT_S", field: "sourcing.0.supplier" });
    expect(elementKey(targetOf(net, "lanes.6.destination"))).toBe("lane:L_N_DCN");
    expect(elementKey(targetOf(net, "skus.2"))).toBe("sku:S03");
    expect(targetOf(net, "name")).toEqual({ kind: "network", field: "name" });
    expect(healthKey(net, "SUP_C")).toBe("node:SUP_C");
    const issues = [{ path: "markets.0.served_by", message: "x", level: "reference" as const, severity: "error" as const }];
    expect(issuesByElement(net, issues).get("node:MKT_N1")).toHaveLength(1);
    expect(issuesOnField(net, issues, "node:MKT_N1", "served_by")).toHaveLength(1);
    expect(issuesOnField(net, issues, "node:MKT_N1", "name")).toHaveLength(0);
  });
});

describe("diagram", () => {
  it("places four columns and finds drop rows", () => {
    const net = foodnet();
    const p = placeNodes(net);
    expect(p.get("MKT_S2")).toMatchObject({ group: "markets", index: 5 });
    expect(p.get("SUP_A")!.x).toBeLessThan(p.get("PLANT_N")!.x);
    expect(lanePath(p.get("SUP_A")!, p.get("PLANT_N")!)).toMatch(/^M/);
    expect(rowAt(p.get("MKT_C1")!.y + 20, 6)).toBe(2);
    expect(diagramSize(net).height).toBeGreaterThan(300);
    expect([heat(0), heat(1)]).toEqual(["rgb(126,226,168)", "rgb(248,113,113)"]);
  });
});

describe("scenarios", () => {
  const net = foodnet();
  it("defaults, spans, summaries and shifts", () => {
    const o = defaultComponent("supplier_outage", net, 20);
    expect(span(o, 52)).toEqual({ start: 20, end: 26 });
    expect(summary(o)).toBe("SUP_A loses 100% of capacity, periods 20–25");
    expect(shift(o, -30).window.start).toBe(0);
    const c = defaultComponent("correlated_shock", net, 10);
    expect(span(c, 52)).toEqual({ start: 10, end: 36, fuzzy: [10, 30] });
    expect(shift(c, -15)).toMatchObject({ earliest_start: 0, latest_start: 20 });
    expect(span(defaultComponent("lead_time_inflation", net, 5), 52)).toEqual({ start: 5, end: 52 });
    expect(summary(defaultComponent("signal_noise", net))).toMatch(/20%/);
  });
});

import { measure } from "../src/lib/measure";

describe("colour by measure", () => {
  const net = foodnet();
  it("scales each measure from good to bad", () => {
    const u = measure(net, "utilisation", { plantLoad: { PLANT_N: 0.7, PLANT_S: 1.0 }, supplierLoad: { SUP_C: 0 } });
    expect([u.get("node:PLANT_N")!.t, u.get("node:SUP_C")!.label]).toEqual([0, "0%"]);
    expect(u.get("node:PLANT_S")!.t).toBeCloseTo(1, 9);
    const lt = measure(net, "lead_time", {});
    expect(lt.get("lane:L_A_S")!.t).toBe(1); // the longest lane in FoodNet
    expect(lt.get("lane:L_A_S")!.label).toBe("24.0 d");
    const f = measure(net, "fill_rate", { fillByMarket: { MKT_N1: 0.995, MKT_S1: 0.9 } });
    expect([f.get("node:MKT_N1")!.t, f.get("node:MKT_S1")!.t]).toEqual([0, 1]);
    expect(measure(net, "cost", {}).size).toBe(net.lanes.length + net.plants.length + net.suppliers.length);
    expect(measure(net, "none", {}).size).toBe(0);
  });
});

import { jsonDiff } from "../src/lib/diff";
import { setAt } from "../src/lib/paths";

describe("diff", () => {
  it("lists exactly the changed leaves, like the registry", () => {
    const a = foodnet();
    let b = setAt(a, "lanes.3.lead_time_days.mu", 30);
    b = setAt(b, "markets.0.name", "Amsterdam");
    b = { ...b, dcs: b.dcs.slice(0, 2) };
    expect(jsonDiff(a, b)).toEqual([
      { path: "dcs.2", op: "removed", before: a.dcs[2] },
      { path: "markets.0.name", op: "changed", before: "North 1", after: "Amsterdam" },
      { path: "lanes.3.lead_time_days.mu", op: "changed", before: (a.lanes[3].lead_time_days as { mu: number }).mu, after: 30 },
    ]);
    expect(jsonDiff(a, a)).toEqual([]);
  });
  it("treats a missing optional field as null", () => {
    const a = foodnet();
    const b = setAt(a, "suppliers.0.location", { x_km: -400, y_km: 200, lat: 39.47, lon: -0.38 });
    const c = setAt(a, "lanes.0.expedite", undefined);
    expect(jsonDiff(setAt(a, "lanes.0.expedite", null), c)).toEqual([]);
    expect(jsonDiff(a, b)).toEqual([]);
  });
});
