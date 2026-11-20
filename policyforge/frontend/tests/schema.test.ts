import { describe, expect, it } from "vitest";
import { applyOps } from "../src/lib/paths";
import { bounds, FieldChecker, fieldsAt, prepare, schemaAt } from "../src/lib/schema";
import { broken, foodnet, networkSchema } from "./fixtures";

const checker = new FieldChecker(networkSchema());

describe("browser field checks against the shared broken networks", () => {
  it("accepts FoodNet", () => {
    expect(checker.check(foodnet())).toEqual([]);
  });

  for (const c of broken()) {
    if (c.browser) {
      it(`rejects ${c.name} at ${c.expect.path}, in Pydantic's words`, () => {
        const issues = checker.check(applyOps(foodnet(), c.ops));
        const hit = issues.filter((i) => i.path === c.expect.path);
        expect(hit.map((i) => i.path), JSON.stringify(issues)).toContain(c.expect.path);
        expect(hit.some((i) => i.message.includes(c.expect.message)), JSON.stringify(hit)).toBe(true);
      });
    } else {
      it(`leaves ${c.name} to the server (a cross-field or reference rule)`, () => {
        const issues = checker.check(applyOps(foodnet(), c.ops));
        expect(issues.filter((i) => i.path === c.expect.path)).toEqual([]);
      });
    }
  }

  it("the browser covers every schema-level case in the set", () => {
    expect(broken().filter((c) => c.browser).length).toBeGreaterThanOrEqual(5);
  });
});

describe("schema rewrites", () => {
  it("turns a discriminated union into tag-guarded branches", () => {
    const p = prepare(networkSchema());
    const lt = p.$defs.Lane.properties.lead_time_days;
    expect(lt.oneOf).toBeUndefined();
    expect(lt.properties.kind.enum).toContain("gamma");
    expect(lt.allOf).toHaveLength(5);
  });

  it("reports a bad lead time inside the union branch, not the union", () => {
    const net = foodnet();
    net.lanes[0].lead_time_days = { kind: "gamma", mu: 21, cv: 0 };
    expect(checker.check(net)).toEqual([{ path: "lanes.0.lead_time_days.cv", message: "Input should be greater than 0" }]);
    (net.lanes[0] as any).lead_time_days = { kind: "beta", mu: 2 };
    expect(checker.check(net)[0]).toMatchObject({ path: "lanes.0.lead_time_days.kind" });
  });

  it("nullable fields accept null and check bounds otherwise", () => {
    const net = foodnet();
    net.skus[0].shelf_life_days = 0;
    expect(checker.check(net)).toEqual([{ path: "skus.0.shelf_life_days", message: "Input should be greater than or equal to 1" }]);
    net.lanes[0].expedite = null;
    net.skus[0].shelf_life_days = 21;
    expect(checker.check(net)).toEqual([]);
  });

  it("names extra and wrongly typed fields", () => {
    const net: any = foodnet();
    net.dcs[0].colour = "red";
    net.markets[0].size_factor = "big";
    expect(checker.check(net)).toEqual([
      { path: "dcs.0.colour", message: "Extra inputs are not permitted" },
      { path: "markets.0.size_factor", message: "Input should be a valid number" }]);
  });
});

describe("generated forms read the schema", () => {
  const s = networkSchema();
  const net = foodnet();

  it("lists a lane's fields with kinds, bounds and descriptions", () => {
    const f = fieldsAt(s, net, "lanes.0");
    expect(f.map((x) => x.key)).toEqual(["id", "origin", "destination", "mode", "lead_time_days", "cost_per_unit",
      "distance_km", "expedite"]);
    const cost = f.find((x) => x.key === "cost_per_unit")!;
    expect([cost.kind, cost.description, bounds(cost.schema)]).toEqual(["number", "EUR per unit moved", "≥ 0, ≤ 10000"]);
    expect(f.find((x) => x.key === "mode")!.kind).toBe("enum");
    expect(f.find((x) => x.key === "lead_time_days")!.kind).toBe("union");
    expect(f.find((x) => x.key === "expedite")!).toMatchObject({ nullable: true, kind: "object" });
  });

  it("follows a union to the branch of the current value", () => {
    expect(fieldsAt(s, net, "lanes.0.lead_time_days").map((x) => x.key)).toEqual(["kind", "mu", "cv"]);
    expect(bounds(schemaAt(s, net, "lanes.0.lead_time_days.cv")!)).toBe("> 0, ≤ 5");
    expect(fieldsAt(s, net, "suppliers.0.location").map((x) => x.key)).toEqual(["x_km", "y_km", "lat", "lon"]);
    expect(fieldsAt(s, net, "skus.0").find((x) => x.key === "shelf_life_days")).toMatchObject({ nullable: true, kind: "integer" });
  });
});
