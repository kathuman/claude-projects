// What the app remembers between visits, in the browser's localStorage: the parameters, the last result, and how far
// the winding has got for each sequence. Everything is wrapped in try/catch: storage can be blocked (private windows,
// strict privacy settings) or full, and the app must work the same without it — it just forgets.
//
// The last result keeps what is needed to show the thread again, reopen the threading mode and download the
// instructions, CSV and template: the parameters, the sequence and the metrics. The processed target (about 2 MB) is
// left out to stay well inside storage limits; the project file is the way to keep that.

import type { Metrics } from "../core/metrics";
import type { StopReason } from "../core/solver";
import type { UiParams } from "./params";

export interface StorageLike { getItem(k: string): string | null; setItem(k: string, v: string): void; removeItem(k: string): void }

export const KEYS = { params: "sa-params-v1", last: "sa-last-v1", thread: "sa-thread-v1-" };

export interface LastResult {
  params: UiParams;
  sequence: number[];
  metrics: Metrics;
  stopReason: StopReason;
  cacheMode: "flat" | "lru";
  cacheBytes: number;
  sourceName: string;
}

function store(): StorageLike | null {
  try { return typeof localStorage !== "undefined" ? localStorage : null; } catch { return null; }
}

function read<T>(key: string, s: StorageLike | null = store()): T | null {
  try { const v = s?.getItem(key); return v ? (JSON.parse(v) as T) : null; } catch { return null; }
}
function write(key: string, value: unknown, s: StorageLike | null = store()): boolean {
  try { s?.setItem(key, JSON.stringify(value)); return !!s; } catch { return false; }
}

export const saveParams = (p: UiParams, s?: StorageLike | null) => write(KEYS.params, p, s);
/** Saved parameters merged over the defaults, so a parameter added in a later version gets its default. */
export function loadParams(defaults: UiParams, s?: StorageLike | null): UiParams {
  const p = read<Partial<UiParams>>(KEYS.params, s);
  if (!p || typeof p !== "object") return { ...defaults };
  const out = { ...defaults };
  for (const k of Object.keys(defaults) as (keyof UiParams)[]) if (typeof p[k] === "number" && Number.isFinite(p[k])) (out[k] as number) = p[k] as number;
  return out;
}

export const saveLast = (r: LastResult, s?: StorageLike | null) => write(KEYS.last, r, s);
export function loadLast(s?: StorageLike | null): LastResult | null {
  const r = read<LastResult>(KEYS.last, s);
  if (!r || !Array.isArray(r.sequence) || !r.params || !r.metrics) return null;
  if (r.sequence.some((n) => !Number.isInteger(n) || n < 0 || n >= r.params.nails)) return null;
  return r;
}

export const saveThreadPos = (id: string, p: number, s?: StorageLike | null) => write(KEYS.thread + id, p, s);
export function loadThreadPos(id: string, s?: StorageLike | null): number {
  const p = read<number>(KEYS.thread + id, s);
  return typeof p === "number" && Number.isFinite(p) ? p : 0;
}
