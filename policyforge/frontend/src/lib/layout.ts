// The diagram: four columns (suppliers → plants → DCs → markets), nodes in list order, lanes as curves.
// Reordering a column in the diagram reorders the list, so the layout is the data.

import type { AnyNode, Network, NodeGroup } from "./types";
import { NODE_GROUPS } from "./types";

export const COL_W = 230;
export const NODE_W = 150;
export const NODE_H = 46;
export const GAP = 18;
export const TOP = 44;

export interface Placed { id: string; group: NodeGroup; index: number; x: number; y: number }

export function placeNodes(net: Network): Map<string, Placed> {
  const out = new Map<string, Placed>();
  NODE_GROUPS.forEach((group, c) => {
    (net[group] as AnyNode[]).forEach((n, i) => {
      out.set(n.id, { id: n.id, group, index: i, x: 20 + c * COL_W, y: TOP + i * (NODE_H + GAP) });
    });
  });
  return out;
}

export function diagramSize(net: Network): { width: number; height: number } {
  const rows = Math.max(1, ...NODE_GROUPS.map((g) => (net[g] as AnyNode[]).length));
  return { width: 20 + 3 * COL_W + NODE_W + 20, height: TOP + rows * (NODE_H + GAP) + 20 };
}

/** A lane's path: from the right edge of the origin to the left edge of the destination. */
export function lanePath(a: Placed, b: Placed): string {
  const x1 = a.x + NODE_W;
  const y1 = a.y + NODE_H / 2;
  const x2 = b.x;
  const y2 = b.y + NODE_H / 2;
  const dx = (x2 - x1) / 2;
  return `M${x1},${y1} C${x1 + dx},${y1} ${x2 - dx},${y2} ${x2},${y2}`;
}

/** The row a dragged node lands in, from the y of the pointer. */
export function rowAt(y: number, count: number): number {
  return Math.max(0, Math.min(count - 1, Math.round((y - TOP - NODE_H / 2) / (NODE_H + GAP))));
}

/** Colour scale for measures: 0 → good (green) … 1 → bad (red), through amber. */
export function heat(t: number): string {
  const x = Math.max(0, Math.min(1, t));
  const stops = [[126, 226, 168], [255, 210, 122], [248, 113, 113]];
  const seg = x < 0.5 ? 0 : 1;
  const f = x < 0.5 ? x * 2 : (x - 0.5) * 2;
  const c = stops[seg].map((v, i) => Math.round(v + (stops[seg + 1][i] - v) * f));
  return `rgb(${c[0]},${c[1]},${c[2]})`;
}
