// Timing of single-axis moves with a trapezoidal speed profile: accelerate at a up to top speed v, cruise, brake at a.
// A move too short to reach v is a triangle. The machine makes one move at a time and stops between moves (no
// blending), which is what a controller does with M0-free G-code only roughly; it makes the estimate slightly
// pessimistic, which is the right side to err on for a winding time.

/** Time in seconds to move distance d (any sign) with top speed v and acceleration a. */
export function moveTime(d: number, v: number, a: number): number {
  const s = Math.abs(d);
  if (s === 0) return 0;
  const sAcc = (v * v) / a;                      // distance to reach v and brake again
  return s < sAcc ? 2 * Math.sqrt(s / a) : s / v + v / a;
}

/** The fraction of distance d covered after time t (0 … moveTime) of the same profile. */
export function moveFraction(t: number, d: number, v: number, a: number): number {
  const s = Math.abs(d), T = moveTime(d, v, a);
  if (s === 0 || t >= T) return 1;
  if (t <= 0) return 0;
  const sAcc = (v * v) / a;
  let x: number;
  if (s < sAcc) {                                // triangle: peak speed a·T/2 at the half-way time
    const h = T / 2;
    x = t <= h ? 0.5 * a * t * t : s - 0.5 * a * (T - t) * (T - t);
  } else {
    const ta = v / a;
    x = t <= ta ? 0.5 * a * t * t : t <= T - ta ? 0.5 * v * ta + v * (t - ta) : s - 0.5 * a * (T - t) * (T - t);
  }
  return Math.min(1, Math.max(0, x / s));
}
