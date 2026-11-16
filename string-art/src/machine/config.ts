// The winding machine: a turntable carries the board, and a thread guide (a thin tube with the thread running through
// it) moves only along one fixed radius above the board's rim. Three axes:
//
//   X  the board's turn, in degrees. X = i · 360/N puts nail i under the guide. Nail numbers run clockwise seen from
//      the front, so a positive X turns the board anticlockwise and the numbers advance under the guide.
//   Y  the guide's position along its radius, in mm, measured from the nail circle: negative inside it, positive
//      outside. The guide waits inside the ring while the board turns and goes outside only to wrap a nail.
//   Z  the guide's height above the board, in mm.
//
// GRBL and Marlin treat every axis as linear, so X is set up with "steps per mm" equal to steps per degree; the
// controller then counts degrees as if they were millimetres. Nothing here touches the DOM or the language: the page
// turns the codes and numbers into words.

export interface MachineConfig {
  // the piece (from the result)
  nails: number;
  boardMm: number;          // nail-circle diameter
  threadMm: number;
  // the board
  nailMm: number;           // nail (or pin) diameter
  nailHeightMm: number;     // how far the nails stand above the board
  // the guide
  guideMm: number;          // outside diameter of the guide tube where it passes between nails
  insideMm: number;         // how far inside the nail circle the guide waits
  outsideMm: number;        // how far outside the nail circle it goes to wrap a nail
  zStartMm: number;         // height of the first wrap on each nail
  layerMm: number;          // how much higher each later wrap on the same nail is laid
  // motion (top speed and acceleration of each axis; the thread speed caps the board's turning speed)
  xSpeed: number;           // °/s
  xAccel: number;           // °/s²
  ySpeed: number;           // mm/s
  yAccel: number;           // mm/s²
  zSpeed: number;           // mm/s
  zAccel: number;           // mm/s²
  threadSpeed: number;      // mm/s: how fast thread may be pulled off the spool
  // the controller
  xSteps: number;           // motor steps per degree of board turn
  ySteps: number;           // steps per mm of guide travel
  zSteps: number;           // steps per mm of guide height
  pauseEvery: number;       // stop (M0) after every this many lines so the winding can be checked; 0 = never
}

export type MachineKey = Exclude<keyof MachineConfig, "nails" | "boardMm" | "threadMm">;

/**
 * Defaults for the recommended build: 600 mm board, 240 nails of 1.5 mm, a 2.5 mm guide tube, NEMA 17 motors at 16
 * microsteps. The turntable is belt-driven at 8:1 (3200 · 8 / 360 = 71.11 steps per degree), the guide carriage on a
 * GT2 belt with a 20-tooth pulley (80 steps/mm), the height on a T8 lead screw with 8 mm lead (400 steps/mm).
 */
export const DEFAULT_MACHINE: MachineConfig = {
  nails: 240, boardMm: 600, threadMm: 0.25,
  nailMm: 1.5, nailHeightMm: 18,
  guideMm: 2.5, insideMm: 8, outsideMm: 6, zStartMm: 3, layerMm: 0.3,
  xSpeed: 60, xAccel: 120, ySpeed: 40, yAccel: 400, zSpeed: 10, zAccel: 100, threadSpeed: 400,
  xSteps: 71.111, ySteps: 80, zSteps: 400, pauseEvery: 0
};

/** Degrees between neighbouring nails. */
export const pitchDeg = (c: Pick<MachineConfig, "nails">) => 360 / c.nails;

/** Straight-line distance between neighbouring nail centres, in mm. */
export const pitchMm = (c: Pick<MachineConfig, "nails" | "boardMm">) => c.boardMm * Math.sin(Math.PI / c.nails);

/** The open gap between neighbouring nails, in mm. */
export const gapMm = (c: Pick<MachineConfig, "nails" | "boardMm" | "nailMm">) => pitchMm(c) - c.nailMm;

/**
 * The board's top turning speed in °/s: the axis limit, or less if the rim would pull thread faster than the spool
 * allows. A point on the nail circle moves at ω·R, and the thread paid out is never faster than that.
 */
export function xSpeedLimit(c: MachineConfig): number {
  const byThread = (c.threadSpeed / (c.boardMm / 2)) * (180 / Math.PI);
  return Math.min(c.xSpeed, byThread);
}

/** The highest a wrap may be laid: 2 mm below the nail tops, so wraps never slide off. */
export const zTopMm = (c: MachineConfig) => c.nailHeightMm - 2;

/** Clean a stored or typed configuration: numbers only, finite and positive where they must be, else the default. */
export function sanitize(c: Partial<MachineConfig>, base: MachineConfig = DEFAULT_MACHINE): MachineConfig {
  const out = { ...base };
  for (const k of Object.keys(base) as (keyof MachineConfig)[]) {
    const v = c[k];
    if (typeof v !== "number" || !Number.isFinite(v)) continue;
    if (k === "pauseEvery" ? v < 0 : v <= 0) continue;
    out[k] = k === "nails" || k === "pauseEvery" ? Math.round(v) : v;
  }
  return out;
}
