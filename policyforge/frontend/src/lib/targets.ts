// From an error path ("plants.1.sourcing.0.supplier") to the element it is about (plant PLANT_S, field
// "sourcing"), so the diagram, map, tables and inspector can show the message where the problem is.

import type { Issue, Network, NodeGroup } from "./types";

export type Target =
  | { kind: "node"; group: NodeGroup; index: number; id: string; field: string }
  | { kind: "lane"; index: number; id: string; field: string }
  | { kind: "sku"; index: number; id: string; field: string }
  | { kind: "override"; index: number; field: string }
  | { kind: "network"; field: string };

const GROUPS = new Set(["suppliers", "plants", "dcs", "markets"]);

export function targetOf(net: Network, path: string): Target {
  const [head, idx, ...rest] = path.split(".");
  const index = Number(idx);
  const field = rest.join(".");
  if (GROUPS.has(head) && Number.isInteger(index)) {
    const node = (net[head as NodeGroup] as { id: string }[])[index];
    return { kind: "node", group: head as NodeGroup, index, id: node?.id ?? `${head}.${idx}`, field };
  }
  if (head === "lanes" && Number.isInteger(index)) {
    return { kind: "lane", index, id: net.lanes[index]?.id ?? `lanes.${idx}`, field };
  }
  if (head === "skus" && Number.isInteger(index)) {
    return { kind: "sku", index, id: net.skus[index]?.id ?? `skus.${idx}`, field };
  }
  if (head === "demand_overrides" && Number.isInteger(index)) return { kind: "override", index, field };
  return { kind: "network", field: path };
}

/** A stable key for an element, used to look up its issues: "node:PLANT_N", "lane:L_A_N", "sku:S01". */
export function elementKey(t: Target): string {
  switch (t.kind) {
    case "node": return `node:${t.id}`;
    case "lane": return `lane:${t.id}`;
    case "sku": return `sku:${t.id}`;
    case "override": return `override:${t.index}`;
    case "network": return "network";
  }
}

export function issuesByElement(net: Network, issues: Issue[]): Map<string, Issue[]> {
  const out = new Map<string, Issue[]>();
  for (const i of issues) {
    const k = elementKey(targetOf(net, i.path));
    out.set(k, [...(out.get(k) ?? []), i]);
  }
  return out;
}

/** Issues on one field of one element (for the inspector), matching the field or anything inside it. */
export function issuesOnField(net: Network, issues: Issue[], key: string, field: string): Issue[] {
  return issues.filter((i) => {
    const t = targetOf(net, i.path);
    return elementKey(t) === key && "field" in t && (t.field === field || t.field.startsWith(`${field}.`));
  });
}

/** A health finding names its target by id (a node, SKU or lane id); map it to the same keys. */
export function healthKey(net: Network, target: string): string {
  if (net.skus.some((s) => s.id === target)) return `sku:${target}`;
  if (net.lanes.some((l) => l.id === target)) return `lane:${target}`;
  return `node:${target}`;
}
