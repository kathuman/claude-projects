// Undo and redo over immutable states. Every edit pushes the new state; consecutive edits with the same `key`
// within `mergeMs` (typing in one field) collapse into one step, so undo goes back a whole field edit.

export interface History<T> {
  past: T[];
  present: T;
  future: T[];
  lastKey: string | null;
  lastAt: number;
}

export const LIMIT = 200;

export function start<T>(present: T): History<T> {
  return { past: [], present, future: [], lastKey: null, lastAt: 0 };
}

export function push<T>(h: History<T>, next: T, key: string | null = null, now = 0, mergeMs = 800): History<T> {
  if (next === h.present) return h;
  const merge = key !== null && key === h.lastKey && now - h.lastAt < mergeMs && h.past.length > 0;
  const past = merge ? h.past : [...h.past, h.present].slice(-LIMIT);
  return { past, present: next, future: [], lastKey: key, lastAt: now };
}

export function undo<T>(h: History<T>): History<T> {
  if (h.past.length === 0) return h;
  return { past: h.past.slice(0, -1), present: h.past[h.past.length - 1], future: [h.present, ...h.future],
    lastKey: null, lastAt: 0 };
}

export function redo<T>(h: History<T>): History<T> {
  if (h.future.length === 0) return h;
  return { past: [...h.past, h.present], present: h.future[0], future: h.future.slice(1), lastKey: null, lastAt: 0 };
}

/** Replace the whole state (open a file, load a version): undoable, like any edit. */
export function reset<T>(h: History<T>, next: T): History<T> {
  return push(h, next, null);
}

export const canUndo = <T,>(h: History<T>) => h.past.length > 0;
export const canRedo = <T,>(h: History<T>) => h.future.length > 0;
