// A path-level diff, the same as backend/core/registry/diff.py (lists by index), used to compare the draft in the
// Studio with a saved version without a round trip. A missing key equals null, as Pydantic fills defaults on save.

export interface Change { path: string; op: "added" | "removed" | "changed"; before?: unknown; after?: unknown }

const isObj = (x: unknown): x is Record<string, unknown> => x !== null && typeof x === "object" && !Array.isArray(x);

function items(x: Record<string, unknown> | unknown[]): Map<string, unknown> {
  return new Map(Array.isArray(x) ? x.map((v, i) => [String(i), v]) : Object.entries(x));
}

function same(a: unknown, b: unknown): boolean {
  return (a ?? null) === (b ?? null);
}

export function jsonDiff(a: unknown, b: unknown, path = ""): Change[] {
  const bothArrays = Array.isArray(a) && Array.isArray(b);
  if (bothArrays || (isObj(a) && isObj(b))) {
    const ia = items(a as never);
    const ib = items(b as never);
    const out: Change[] = [];
    for (const k of [...ia.keys(), ...[...ib.keys()].filter((k) => !ia.has(k))]) {
      const p = path ? `${path}.${k}` : k;
      const va = ia.get(k);
      const vb = ib.get(k);
      if (!ib.has(k) || (vb === undefined)) {
        if (va !== null && va !== undefined) out.push({ path: p, op: "removed", before: va });
      } else if (!ia.has(k) || va === undefined) {
        if (vb !== null) out.push({ path: p, op: "added", after: vb });
      } else out.push(...jsonDiff(va, vb, p));
    }
    return out;
  }
  return same(a, b) ? [] : [{ path: path || "(root)", op: "changed", before: a, after: b }];
}
