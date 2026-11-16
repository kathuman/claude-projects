// The machine's hardware: the drive maths, agreement between the parameters, the web numbers, the CAD output
// (parts.json, the STL files, the GLB) and the machine settings the G-code uses.
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { beltLength, centreDistance, drive, grblSettings, GRBL_MAX_RATE, PARAMS, pitchDiameter } from "../src/hardware/drive";
import { baseLayout, motorHang, platterLayout } from "../src/hardware/layout";
import { DEFAULT_MACHINE, gapMm } from "../src/machine/config";

const pub = join(__dirname, "..", "web", "public", "hardware");
const parts = JSON.parse(readFileSync(join(pub, "parts.json"), "utf8")) as { centreDistance: number; boardTop: number; parts: { id: string; qty: number; file: string; size: number[]; volume: number; triangles: number }[] };

/** Read a binary or ASCII STL: triangle count and bounding box. */
function readStl(file: string): { tris: number; min: number[]; max: number[] } {
  const b = readFileSync(file);
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  const see = (x: number, y: number, z: number) => { [x, y, z].forEach((v, i) => { min[i] = Math.min(min[i], v); max[i] = Math.max(max[i], v); }); };
  const n = b.readUInt32LE(80);
  if (b.length === 84 + n * 50) {
    for (let i = 0; i < n; i++) for (let v = 0; v < 3; v++) { const o = 84 + i * 50 + 12 + v * 12; see(b.readFloatLE(o), b.readFloatLE(o + 4), b.readFloatLE(o + 8)); }
    return { tris: n, min, max };
  }
  const txt = b.toString("utf8");
  let tris = 0;
  for (const m of txt.matchAll(/vertex\s+(\S+)\s+(\S+)\s+(\S+)/g)) see(+m[1], +m[2], +m[3]);
  tris = (txt.match(/facet normal/g) || []).length;
  return { tris, min, max };
}

describe("drive maths", () => {
  it("pitch diameters and belt length agree with their inverse", () => {
    expect(pitchDiameter(20, 2)).toBeCloseTo(40 / Math.PI, 12);
    const D = pitchDiameter(160, 2), d = pitchDiameter(20, 2);
    const C = centreDistance(400, D, d);
    expect(beltLength(C, D, d)).toBeCloseTo(400, 6);
    expect(Number.isNaN(centreDistance(100, D, d))).toBe(true);    // too short to go round
  });
  it("matches the machine settings the G-code uses", () => {
    const dr = drive();
    expect(dr.ratio).toBe(8);
    expect(dr.xSteps).toBeCloseTo(DEFAULT_MACHINE.xSteps, 2);
    expect(dr.ySteps).toBe(DEFAULT_MACHINE.ySteps);
    expect(dr.zSteps).toBe(DEFAULT_MACHINE.zSteps);
    const P = PARAMS;
    expect(P.board.nailCircle).toBe(DEFAULT_MACHINE.boardMm);
    expect(P.board.nails).toBe(DEFAULT_MACHINE.nails);
    expect(P.board.nailDiameter).toBe(DEFAULT_MACHINE.nailMm);
    expect(P.board.nailHeight).toBe(DEFAULT_MACHINE.nailHeightMm);
    expect(P.guide.tubeOD).toBe(DEFAULT_MACHINE.guideMm);
  });
  it("has the torque, the speed and the belt grip to spare", () => {
    const dr = drive();
    expect(dr.safety).toBeGreaterThan(2);
    expect(Math.max(dr.xRate, dr.yRate, dr.zRate)).toBeLessThan(GRBL_MAX_RATE * 0.5);
    expect(dr.meshTeeth).toBeGreaterThanOrEqual(6);
    expect(dr.xRpm).toBeLessThan(600);
    expect(dr.resolutionMm).toBeLessThan(0.1);
  });
  it("lists the GRBL settings with the same steps and speeds", () => {
    const s = Object.fromEntries(grblSettings().map(([k]) => k.split("=")));
    expect(Number(s.$100)).toBeCloseTo(drive().xSteps, 3);
    expect(Number(s.$110)).toBe(60 * 60);
    expect(s.$20).toBe("0");
  });
});

describe("layout", () => {
  it("fits: the platter on the base, the board on the platter, the motor above the floor", () => {
    const P = PARAMS, b = baseLayout(), pl = platterLayout();
    expect(P.platter.diameter).toBeLessThanOrEqual(P.base.width);
    expect(pl.buttonScrews[0].x + 10).toBeLessThanOrEqual(pl.radius);      // the turn button stands on the platter
    expect(pl.buttonScrews[0].x - 10).toBeGreaterThan(pl.boardRadius);     // beside the board
    expect(motorHang().clearance).toBeGreaterThan(10);
    expect(b.extrusion.y0).toBeGreaterThan(P.platter.diameter / 2);         // the tower clears the platter
    expect(b.extrusion.y1).toBeLessThan(b.outline.y1);
    expect(gapMm(DEFAULT_MACHINE) - P.guide.tubeOD).toBeGreaterThan(1.5);
  });
  it("puts the turntable motor where FreeCAD did", () => {
    expect(-baseLayout().motor.x).toBeCloseTo(parts.centreDistance, 1);
    expect(parts.boardTop).toBe(PARAMS.bearing.height + PARAMS.platter.thickness + PARAMS.board.thickness);
  });
});

describe("CAD output", () => {
  it("has every printed part as an STL that matches its listed size and sits on the bed", () => {
    expect(parts.parts.length).toBeGreaterThanOrEqual(13);
    for (const p of parts.parts) {
      const f = join(pub, p.file);
      expect(existsSync(f), p.file).toBe(true);
      const s = readStl(f);
      expect(s.tris, p.id).toBe(p.triangles);
      expect(s.min[2]).toBeCloseTo(0, 3);
      for (let i = 0; i < 3; i++) expect(s.max[i] - s.min[i]).toBeCloseTo(p.size[i], 0);
      expect(Math.max(...p.size), p.id).toBeLessThanOrEqual(220);            // fits a common 220 mm bed
      expect(p.volume).toBeGreaterThan(0);
    }
  });
  it("prints every part the right way up: its centre of mass in the lower half", () => {
    for (const p of parts.parts) {
      const b = readFileSync(join(pub, p.file)), n = b.readUInt32LE(80);
      let V = 0, Z = 0;
      for (let i = 0; i < n; i++) {
        const v = [0, 1, 2].map((t) => [0, 1, 2].map((k) => b.readFloatLE(84 + i * 50 + 12 + t * 12 + k * 4)));
        const [a, c, d] = v, vol = (a[0] * (c[1] * d[2] - c[2] * d[1]) - a[1] * (c[0] * d[2] - c[2] * d[0]) + a[2] * (c[0] * d[1] - c[1] * d[0])) / 6;
        V += vol; Z += (vol * (a[2] + c[2] + d[2])) / 4;
      }
      expect(V / 1000, p.id).toBeCloseTo(p.volume, 0);
      expect(Z / V / p.size[2], p.id).toBeLessThanOrEqual(0.52);
    }
  });
  it("has an assembly GLB with named parts and the FreeCAD model", () => {
    const b = readFileSync(join(pub, "machine.glb"));
    expect(b.toString("ascii", 0, 4)).toBe("glTF");
    const j = JSON.parse(b.subarray(20, 20 + b.readUInt32LE(12)).toString()) as { nodes: { name?: string }[] };
    const names = j.nodes.map((n) => n.name ?? "");
    for (const n of ["W_base", "W_platter", "B_nail_board", "N_nails", "P_turntable_pulley", "P_guide_arm", "T_brass_guide_tube", "M_x_motor", "T_thread_cone", "P_tensioner_bracket"]) expect(names).toContain(n);
    expect(b.length).toBeLessThan(4e6);
    expect(existsSync(join(pub, "string-art-machine.FCStd"))).toBe(true);
  });
});
