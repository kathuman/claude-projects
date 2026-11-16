// Where everything goes on the base and the platter, in mm, from the same parameters the CAD script uses
// (hardware/cad/build_machine.py). Origin: the turntable's axis; +Y towards the tower (nail 0). The drawings on the build
// page and the tests use these numbers; the tests check them against what FreeCAD wrote to parts.json.

import { drive, PARAMS, type Params } from "./drive";

export interface Circle { x: number; y: number; r: number }
export interface Rect { x0: number; y0: number; x1: number; y1: number }

export interface BaseLayout {
  outline: Rect;
  cutout: Circle[];               // the through cut-out is the convex hull of these circles
  bearing: Rect;                  // the bearing's square plate
  bearingScrews: Circle[];
  accessHole: Circle;             // drilled where one of the bearing's top-plate holes falls (mark on assembly)
  motor: { x: number; y: number }; // turntable motor axis (motor hangs under the base)
  motorPlate: Rect;               // on the underside
  motorSlots: [Circle, Circle][]; // slotted screw holes for the motor plate, from–to
  hall: Rect;
  hallScrews: Circle[];
  extrusion: Rect;
  towerScrews: Circle[];
  feet: Circle[];
  controller: Rect;
  supply: Rect;
}

export function baseLayout(p: Params = PARAMS): BaseLayout {
  const b = p.base, dr = drive(p), mx = -dr.centre, s = p.bearing.size / 2, q = p.bearing.screwSquare / 2;
  const exY0 = p.tower.y + 10, exW = p.tower.extrusion[1], exD = p.tower.extrusion[0];
  const my = -p.platter.magnetRadius;
  return {
    outline: { x0: -b.width / 2, y0: -b.front, x1: b.width / 2, y1: b.back },
    cutout: [{ x: 0, y: 0, r: 62 }, { x: mx, y: 0, r: 16 }],
    bearing: { x0: -s, y0: -s, x1: s, y1: s },
    bearingScrews: [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([i, j]) => ({ x: i * q, y: j * q, r: 2.25 })),
    accessHole: { x: 0, y: -q, r: 10 },
    motor: { x: mx, y: 0 },
    motorPlate: { x0: mx - 40, y0: -35, x1: mx + 40, y1: 35 },
    motorSlots: [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([i, j]) => [
      { x: mx + i * 33 - 4, y: j * 28, r: 2.25 }, { x: mx + i * 33 + 4, y: j * 28, r: 2.25 }] as [Circle, Circle]),
    hall: { x0: -10, y0: my - 12, x1: 10, y1: my + 12 },
    hallScrews: [{ x: 0, y: my - 7, r: 2.25 }, { x: 0, y: my + 7.5, r: 2.25 }],
    extrusion: { x0: -exW / 2, y0: exY0, x1: exW / 2, y1: exY0 + exD },
    towerScrews: [-1, 1].map((i) => ({ x: i * (exW / 2 + 32), y: exY0 + exD / 2, r: 2.25 })),
    feet: [[-1, -b.front + 45], [1, -b.front + 45], [-1, b.back - 45], [1, b.back - 45]].map(([i, y]) => ({ x: i * (b.width / 2 - 45), y, r: 20 })),
    controller: { x0: -b.width / 2 + 30, y0: b.back - 170, x1: -b.width / 2 + 150, y1: b.back - 80 },
    supply: { x0: b.width / 2 - 150, y0: b.back - 150, x1: b.width / 2 - 30, y1: b.back - 90 }
  };
}

export interface PlatterLayout {
  radius: number;
  dowel: Circle;
  magnet: Circle;                 // blind hole on the underside, 3 mm deep
  buttonScrews: Circle[];         // turn buttons, on top, round the rim
  pulleyScrews: Circle[];         // turntable pulley, on the underside
  boardRadius: number;
}

export function platterLayout(p: Params = PARAMS): PlatterLayout {
  const rb = p.board.diameter / 2 + 3 + 10;           // the turn button's pivot: 3 mm off the board, mid-column
  return {
    radius: p.platter.diameter / 2,
    dowel: { x: 0, y: 0, r: p.platter.dowel / 2 },
    magnet: { x: 0, y: -p.platter.magnetRadius, r: p.platter.magnetDiameter / 2 },
    buttonScrews: [0, 120, 240].map((d) => ({ x: rb * Math.cos((d * Math.PI) / 180), y: rb * Math.sin((d * Math.PI) / 180), r: 2 })),
    pulleyScrews: [0, 1, 2, 3, 4, 5].map((k) => ({ x: 60 * Math.cos((k * Math.PI) / 3), y: 60 * Math.sin((k * Math.PI) / 3), r: 2 })),
    boardRadius: p.board.diameter / 2
  };
}

/** How far below the base the turntable motor reaches, and how tall the feet must be to clear the floor. */
export function motorHang(p: Params = PARAMS): { hang: number; clearance: number } {
  const hang = 6 + p.motor.length;                    // motor plate + motor body, below the base's underside
  return { hang, clearance: p.base.footHeight - hang };
}
