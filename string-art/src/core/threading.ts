// What the threading mode shows at each point of the winding.
//
// Position p is the number of lines already wound (0 … total). The thread is at nail sequence[p]; the next line goes
// to sequence[p + 1], which is the number shown large. "Previous" are the nails already visited just before (most
// recent last); "next" are the ones after the next, so the winder can read ahead. At p = total the piece is finished.

export interface ThreadingView {
  done: number;
  total: number;
  /** the nail the thread is at */
  from: number;
  /** the nail to go to now, or null when finished */
  to: number | null;
  /** nails visited before `from`, oldest first (up to three) */
  prev: number[];
  /** the nails after `to` (up to three) */
  next: number[];
  finished: boolean;
}

export function clampPosition(p: number, total: number): number {
  return Math.max(0, Math.min(total, Math.round(Number.isFinite(p) ? p : 0)));
}

export function threadingView(seq: Uint16Array, p: number): ThreadingView {
  const total = Math.max(0, seq.length - 1), done = clampPosition(p, total);
  const prev: number[] = [], next: number[] = [];
  for (let k = Math.max(0, done - 3); k < done; k++) prev.push(seq[k]);
  for (let k = done + 2; k <= Math.min(total, done + 4); k++) next.push(seq[k]);
  return { done, total, from: seq[done], to: done < total ? seq[done + 1] : null, prev, next, finished: done >= total };
}
