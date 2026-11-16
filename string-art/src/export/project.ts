// The project file: everything needed to reload a piece exactly.
//
// Exactness. The solver is deterministic for a given processed target (core/greedy.ts), but re-processing the
// original photo is not guaranteed to give the same target in another browser (JPEG decoders and colour management
// differ, and a turned crop uses the browser's sin/cos). So the file stores the processed target itself, bit for bit
// (Float32, base64), with an FNV-1a hash of those bytes, and the importance mask if one was painted. Loading checks the
// hash before using anything, and running the solver on the loaded target with the stored parameters reproduces the
// stored sequence exactly. The original photo is not stored (it may be large and private); to change the picture,
// upload it again.

import type { Prep } from "../core/preprocess";
import type { UiParams } from "../ui/params";

export const FORMAT = 1;

export interface ProjectFile {
  app: "string-art";
  format: number;
  version: string;
  saved: string;
  params: UiParams;
  prep: Prep;
  res: number;
  target: { hash: string; data: string };
  mask: string | null;
  sequence: number[];
}

/** FNV-1a (32-bit) over the bytes of an array: a fixed, portable fingerprint. */
export function hashBytes(a: ArrayBufferView): string {
  const b = new Uint8Array(a.buffer, a.byteOffset, a.byteLength);
  let h = 0x811c9dc5;
  for (let i = 0; i < b.length; i++) { h ^= b[i]; h = Math.imul(h, 0x01000193); }
  return (h >>> 0).toString(16).padStart(8, "0") + "-" + b.length.toString(16);
}

function toBase64(a: ArrayBufferView): string {
  const b = new Uint8Array(a.buffer, a.byteOffset, a.byteLength);
  let s = "";
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
  return btoa(s);
}
function fromBase64F32(s: string): Float32Array {
  const bin = atob(s), b = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) b[i] = bin.charCodeAt(i);
  if (b.length % 4) throw new Error("corrupt array");
  return new Float32Array(b.buffer);
}

export function saveProject(d: { params: UiParams; prep: Prep; res: number; target: Float32Array; mask: Float32Array | null; sequence: Uint16Array; version: string; saved: string }): string {
  const f: ProjectFile = {
    app: "string-art", format: FORMAT, version: d.version, saved: d.saved,
    params: d.params, prep: d.prep, res: d.res,
    target: { hash: hashBytes(d.target), data: toBase64(d.target) },
    mask: d.mask ? toBase64(d.mask) : null,
    sequence: Array.from(d.sequence)
  };
  return JSON.stringify(f);
}

export interface LoadedProject { file: ProjectFile; target: Float32Array; mask: Float32Array | null; sequence: Uint16Array }

/** Parse and check a project file; throws an Error whose message says what is wrong. */
export function loadProject(text: string): LoadedProject {
  let f: ProjectFile;
  try { f = JSON.parse(text); } catch { throw new Error("not-json"); }
  if (!f || f.app !== "string-art") throw new Error("not-project");
  if (f.format > FORMAT) throw new Error("newer-format");
  const target = fromBase64F32(f.target.data);
  if (target.length !== f.res * f.res) throw new Error("bad-size");
  if (hashBytes(target) !== f.target.hash) throw new Error("bad-hash");
  const mask = f.mask ? fromBase64F32(f.mask) : null;
  if (mask && mask.length !== target.length) throw new Error("bad-size");
  const sequence = Uint16Array.from(f.sequence);
  if (sequence.some((n) => n >= f.params.nails)) throw new Error("bad-sequence");
  return { file: f, target, mask, sequence };
}
