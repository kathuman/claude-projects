import { describe, expect, it } from "vitest";
import { formatRoute, parseRoute } from "../src/lib/route";
import { FieldChecker } from "../src/lib/schema";
import { branches, defaultValue, mapKeys, move, resolve, switchBranch } from "../src/lib/schemaDefaults";
import { constitutionSchema, policySchema } from "./fixtures";

describe("routes", () => {
  it("parse and format hash routes", () => {
    expect(parseRoute("#/author?policy=p1&version=2")).toEqual({ area: "author", params: { policy: "p1", version: "2" } });
    expect(parseRoute("")).toEqual({ area: "network", params: {} });
    expect(parseRoute("#/nowhere")).toEqual({ area: "network", params: {} });
    expect(formatRoute("stress", { policy: "x y", version: 3, empty: "" })).toBe("#/stress?policy=x+y&version=3");
    expect(parseRoute(formatRoute("registry", { policy: "a/b" })).params.policy).toBe("a/b");
  });
});

describe("schema defaults", () => {
  const P = policySchema();
  const C = constitutionSchema();
  it("give every policy rule kind a valid starting value", () => {
    const ruleSchema = resolve(P, P.properties.rule);
    const kinds = branches(P, ruleSchema).map((b) => b.tag);
    expect(kinds).toEqual(["allocation", "base_stock", "composite", "expedite", "min_max", "sourcing_switch"]);
    const check = new FieldChecker({ ...P.$defs.BaseStock, $defs: P.$defs });
    expect(check.check(defaultValue(P, P.$defs.BaseStock))).toEqual([]);
    const comp = defaultValue(P, P.$defs.Composite) as { type: string; rules: unknown[] };
    expect(comp.type).toBe("composite");
    expect(comp.rules).toHaveLength(1); // minItems 1
  });
  it("switch a union's kind keeping shared fields", () => {
    const ruleSchema = resolve(P, P.properties.rule);
    const old = { type: "base_stock", target: { unit: "days_of_cover", value: 14 }, review_period: 2 };
    const mm = switchBranch(P, ruleSchema, "min_max", old) as Record<string, unknown>;
    expect(Object.keys(mm).sort()).toEqual(["order_up_to", "reorder_point", "type"]); // nothing that does not apply
    const same = switchBranch(P, ruleSchema, "base_stock", old) as Record<string, unknown>;
    expect(same).toEqual(old); // the fields a kind shares with itself are kept
    expect(switchBranch(P, ruleSchema, "nope", old)).toBe(old);
  });
  it("read map keys and constitution defaults", () => {
    expect(mapKeys(C, C.properties.soft_weights)).toEqual(["service", "resilience", "cost", "carbon"]);
    expect(defaultValue(C, C.properties.soft_weights)).toEqual({ service: 0, resilience: 0, cost: 0, carbon: 0 });
    const hc = defaultValue(C, C.$defs.HardConstraint) as Record<string, unknown>;
    expect(Object.keys(hc)).toEqual(expect.arrayContaining(["id", "metric", "op", "threshold"]));
    expect(defaultValue(C, C.properties.breach_alpha)).toBe(0.05);
  });
  it("move items", () => {
    expect(move(["a", "b", "c"], 2, 0)).toEqual(["c", "a", "b"]);
    expect(move(["a", "b"], 0, 9)).toEqual(["b", "a"]);
  });
});

import { bandPath, fmtEur, fmtPct, kde, linear, linePath, nearest, niceTicks, padded, quantile } from "../src/lib/chart";

describe("chart geometry", () => {
  it("ticks, scales and domains", () => {
    expect(niceTicks(0, 1, 4)).toEqual([0, 0.25, 0.5, 0.75, 1]);
    expect(niceTicks(0.9, 1, 4)).toEqual([0.9, 0.925, 0.95, 0.975, 1]);
    expect(niceTicks(3, 3)).toEqual([3]);
    expect(niceTicks(NaN, 1)).toEqual([]);
    expect(linear(0, 10, 0, 100)(2.5)).toBe(25);
    expect(padded([1, 3], 0.5)).toEqual([0, 4]);
    expect(padded([])).toEqual([0, 1]);
    expect(padded([5])[0]).toBeLessThan(5);
  });
  it("paths, quantiles, density and hover", () => {
    expect(linePath([0, 1], [2, 3])).toBe("M0.0,2.0L1.0,3.0");
    expect(bandPath([0, 1], [0, 0], [1, 1])).toBe("M0.0,1.0L1.0,1.0L1.0,0.0L0.0,0.0Z");
    expect(quantile([3, 1, 2], 0.5)).toBe(2);
    expect(quantile([], 0.5)).toBeNaN();
    const d = kde([0, 0.1, -0.1, 0.2, -0.2, 0], -1, 1, 40);
    const area = d.reduce((a, p, i) => (i ? a + ((p.y + d[i - 1].y) / 2) * (p.x - d[i - 1].x) : a), 0);
    expect(area).toBeCloseTo(1, 1);
    expect(d[20].y).toBeGreaterThan(d[0].y);
    expect(kde([1], 0, 2)).toEqual([]);
    expect(nearest([0, 10, 20], 12)).toBe(1);
    expect([fmtPct(0.9534), fmtEur(31234), fmtEur(512), fmtEur(2.5e6)]).toEqual(["95.3%", "€31.2k", "€512", "€2.50M"]);
  });
});

describe("policy field checks", () => {
  it("accept a nullable union left empty, and catch a bad branch", () => {
    const P = policySchema();
    const check = new FieldChecker(P);
    const a = { id: "a", statement: "x", variable: { var: "lead_time", supplier: "SUP_B" }, operator: "lt", threshold: 7,
      distribution: null, source: "user_stated", confidence: 0.5 };
    const one = new FieldChecker({ ...P.$defs.Assumption, $defs: P.$defs });
    expect(one.check(a)).toEqual([]);
    expect(one.check({ ...a, distribution: { kind: "gamma", mu: 0, cv: 0.1 } })).toEqual([
      { path: "distribution.mu", message: "Input should be greater than 0" }]);
    expect(check.check({})).not.toEqual([]);
  });
  it("accept a nullable enum left empty (the constitution's scopes)", () => {
    const C = constitutionSchema();
    const check = new FieldChecker(C);
    const con = { id: "c", name: "c", priorities: ["service", "resilience", "cost", "carbon"],
      soft_weights: { service: 0.4, resilience: 0.3, cost: 0.2, carbon: 0.1 },
      hard_constraints: [{ id: "h", metric: "fill_rate", scope: { sku_class: null, category: "chilled", sku: null, node: null },
        op: "ge", threshold: 0.97, window: "horizon" }] };
    expect(check.check(con)).toEqual([]);
    expect(check.check({ ...con, hard_constraints: [{ ...con.hard_constraints[0], scope: { sku_class: "D" } }] })[0])
      .toMatchObject({ path: "hard_constraints.0.scope.sku_class" });
  });
});
