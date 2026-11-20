import { describe, expect, it } from "vitest";
import { addNode, connect, emptyNetwork, findNode, laneRefusal, moveNode, newSku, removeLane, removeNode,
  removeSku, renameNode, renameSku, renormalise, suggestDistance } from "../src/lib/edits";
import * as H from "../src/lib/history";
import { applyOps, getAt, removeAt, setAt } from "../src/lib/paths";
import type { Network } from "../src/lib/types";
import { foodnet } from "./fixtures";

describe("paths", () => {
  it("reads and writes without touching the original", () => {
    const net = foodnet();
    const next = setAt(net, "lanes.3.lead_time_days.mu", 30);
    expect(getAt(next, "lanes.3.lead_time_days.mu")).toBe(30);
    expect(getAt(net, "lanes.3.lead_time_days.mu")).not.toBe(30);
    expect(next.skus).toBe(net.skus); // untouched branches are shared
    expect(removeAt(net, "lanes.2").lanes).toHaveLength(net.lanes.length - 1);
    expect(applyOps(net, [{ op: "append", path: "demand_overrides", value: { market: "MKT_N1", sku: "S01", mean: 1 } }])
      .demand_overrides).toHaveLength(1);
  });
});

describe("history", () => {
  it("undo and redo restore exact states", () => {
    const a = foodnet();
    let h = H.start(a);
    const b = setAt(a, "name", "B");
    const c = setAt(b, "name", "C");
    h = H.push(H.push(h, b), c);
    expect(H.undo(h).present).toBe(b);
    expect(H.undo(H.undo(h)).present).toBe(a);
    expect(H.redo(H.undo(H.undo(h))).present).toBe(b);
    expect(H.push(H.undo(h), a).future).toEqual([]); // a new edit drops the redo branch
    expect(H.undo(H.start(a)).present).toBe(a);
  });

  it("typing in one field is one undo step", () => {
    const a = foodnet();
    let h = H.start(a);
    h = H.push(h, setAt(a, "name", "F"), "name", 1000);
    h = H.push(h, setAt(a, "name", "Fo"), "name", 1200);
    h = H.push(h, setAt(a, "name", "Foo"), "name", 1300);
    expect(h.past).toHaveLength(1);
    expect(H.undo(h).present).toBe(a);
    h = H.push(h, setAt(a, "name", "X"), "name", 5000); // a pause starts a new step
    expect(h.past).toHaveLength(2);
  });
});

describe("graph edits", () => {
  it("adds nodes with valid defaults and fresh ids", () => {
    const [net, id] = addNode(foodnet(), "plants", { lat: 48.123, lon: 2.456 });
    expect(id).toBe("PLANT_1");
    const p = findNode(net, id)!.node as Network["plants"][number];
    expect(p.location).toEqual({ x_km: 0, y_km: 0, lat: 48.12, lon: 2.46 });
    expect(p.sourcing).toEqual([{ supplier: "SUP_A", share: 1 }]);
    expect(addNode(net, "plants")[1]).toBe("PLANT_2");
  });

  it("deleting a supplier cascades to lanes and renormalises sourcing", () => {
    const net = removeNode(foodnet(), "SUP_A");
    expect(net.lanes.some((l) => l.origin === "SUP_A")).toBe(false);
    expect(net.plants[0].sourcing).toEqual([{ supplier: "SUP_B", share: 1 }]);
    expect(net.plants[1].sourcing).toEqual([{ supplier: "SUP_B", share: 1 }]);
  });

  it("deleting a DC leaves its markets unserved, deleting a market drops its overrides", () => {
    let net = removeNode(foodnet(), "DC_N");
    expect(net.markets.filter((m) => m.served_by === "")).toHaveLength(2);
    net = { ...foodnet(), demand_overrides: [{ market: "MKT_S1", sku: "S01", mean: 5 }] };
    expect(removeNode(net, "MKT_S1").demand_overrides).toEqual([]);
  });

  it("renaming updates every reference", () => {
    const net = renameNode(foodnet(), "SUP_B", "SUP_BETA") as Network;
    expect(JSON.stringify(net)).not.toContain('"SUP_B"');
    expect(net.plants[0].sourcing[1].supplier).toBe("SUP_BETA");
    const net2 = renameNode(foodnet(), "DC_C", "DC_CENTRE") as Network;
    expect(net2.markets.filter((m) => m.served_by === "DC_CENTRE")).toHaveLength(2);
    expect(renameNode(foodnet(), "DC_C", "DC_N")).toBe("DC_N is already used");
    expect(renameNode(foodnet(), "DC_C", "9x")).toMatch(/starts with a letter/);
    const net3 = renameSku(foodnet(), "S03", "S03X") as Network;
    expect(net3.plants.every((p) => !p.skus.includes("S03") && p.skus.includes("S03X"))).toBe(true);
    expect(removeSku(foodnet(), "S03").plants[0].skus).not.toContain("S03");
  });

  it("connects only in the allowed direction, and moves markets between DCs", () => {
    const net = foodnet();
    expect(laneRefusal(net, "SUP_A", "DC_N")).toMatch(/supplier → plant/);
    expect(laneRefusal(net, "SUP_A", "PLANT_N")).toBe("that lane exists");
    const [moved, id] = connect(net, "DC_C", "MKT_N1") as [Network, string];
    expect(id).toBe("L_C_N1");
    expect(moved.markets[0].served_by).toBe("DC_C");
    expect(moved.lanes.some((l) => l.origin === "DC_N" && l.destination === "MKT_N1")).toBe(false);
    // reconnecting a market to the DC that already serves it (its lane was missing) keeps the new lane
    const missing = { ...net, lanes: net.lanes.filter((l) => l.id !== "L_DCS_S2") };
    const [fixed, fid] = connect(missing, "DC_S", "MKT_S2") as [Network, string];
    expect(fixed.lanes.find((l) => l.id === fid)).toMatchObject({ origin: "DC_S", destination: "MKT_S2", distance_km: 105 });
    const [, sid] = addNode(net, "suppliers", { lat: 52, lon: 5 });
    const [withSup] = addNode(net, "suppliers", { lat: 52, lon: 5 });
    const [linked] = connect(withSup, sid, "PLANT_N") as [Network, string];
    expect(linked.plants[0].sourcing.at(-1)).toEqual({ supplier: sid, share: 0 });
    expect(removeLane(linked, linked.lanes.at(-1)!.id).lanes).toHaveLength(net.lanes.length);
  });

  it("suggests the same lane distances as Python (FoodNet's lanes follow its map)", () => {
    const net = foodnet();
    for (const l of net.lanes) expect(suggestDistance(net, l.origin, l.destination), l.id).toBe(l.distance_km);
  });

  it("keeps shares summing to exactly 1", () => {
    const s = renormalise([{ supplier: "A", share: 1 }, { supplier: "B", share: 1 }, { supplier: "C", share: 1 }]);
    expect(s.reduce((a, x) => a + x.share, 0)).toBeCloseTo(1, 10);
    expect(renormalise([{ supplier: "A", share: 0 }])).toEqual([{ supplier: "A", share: 1 }]);
  });

  it("reorders a column", () => {
    expect(moveNode(foodnet(), "dcs", 0, 2).dcs.map((d) => d.id)).toEqual(["DC_C", "DC_S", "DC_N"]);
  });

  it("starts empty and adds SKUs", () => {
    const net = emptyNetwork();
    const s = newSku(net);
    expect([s.id, s.category, s.shelf_life_days]).toEqual(["S1", "ambient", null]);
  });
});
