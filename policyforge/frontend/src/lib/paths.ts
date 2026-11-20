// Immutable reads and writes by dotted path ("lanes.3.lead_time_days.mu"), as used in error paths, the inspector
// and the shared broken-network fixtures. Writes copy only the objects along the path.

type Json = unknown;
const isIndex = (k: string) => /^\d+$/.test(k);

export function split(path: string): string[] {
  return path === "" ? [] : path.split(".");
}

export function getAt(doc: Json, path: string): Json {
  let node: Json = doc;
  for (const k of split(path)) {
    if (node === null || typeof node !== "object") return undefined;
    node = (node as Record<string, Json>)[k];
  }
  return node;
}

function update(node: Json, keys: string[], fn: (old: Json) => Json | typeof REMOVE): Json {
  if (keys.length === 0) return fn(node);
  const [k, ...rest] = keys;
  if (Array.isArray(node)) {
    const i = Number(k);
    const copy = node.slice();
    const v = update(copy[i], rest, fn);
    if (v === REMOVE) copy.splice(i, 1);
    else copy[i] = v;
    return copy;
  }
  const obj = { ...((node ?? {}) as Record<string, Json>) };
  const v = update(obj[k], rest, fn);
  if (v === REMOVE) delete obj[k];
  else obj[k] = v;
  return obj;
}

export const REMOVE = Symbol("remove");

export function setAt<T>(doc: T, path: string, value: Json): T {
  return update(doc, split(path), () => value) as T;
}

export function removeAt<T>(doc: T, path: string): T {
  return update(doc, split(path), () => REMOVE) as T;
}

export function appendAt<T>(doc: T, path: string, value: Json): T {
  return update(doc, split(path), (old) => [...((old as Json[]) ?? []), value]) as T;
}

/** The patch language of tests/fixtures/broken_networks.json (Python's tests apply the same). */
export interface Op { op: "set" | "remove" | "append"; path: string; value?: Json }

export function applyOps<T>(doc: T, ops: Op[]): T {
  return ops.reduce<T>((d, o) => (o.op === "set" ? setAt(d, o.path, o.value)
    : o.op === "remove" ? removeAt(d, o.path) : appendAt(d, o.path, o.value)), doc);
}

export { isIndex };
