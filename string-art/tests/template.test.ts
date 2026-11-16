import { describe, expect, it } from "vitest";
import { MARGIN, nailPositionsMm, PAPER, templatePages, templateSvg } from "../src/export/template";
import { hashBytes, loadProject, saveProject } from "../src/export/project";
import { GreedySolver } from "../src/core/greedy";
import { DEFAULT_UI } from "../src/ui/params";
import { NO_ADJUSTMENT } from "../src/core/preprocess";
import { portraitTarget, smallParams } from "./helpers";

const labels = { title: "Test template", calibration: "100 mm", page: (r: number, c: number) => `row ${r}, column ${c}` };

describe("nail template at true size", () => {
  const d = { nails: 240, boardMm: 600, labels };
  const svg = templateSvg(d);

  it("draws the nail circle with the board's diameter, in millimetres (within 0.1 mm)", () => {
    expect(svg).toMatch(/^<svg[^>]* width="[\d.]+mm" height="[\d.]+mm" viewBox="0 0 [\d.]+ [\d.]+"/);
    const [, w, vw] = svg.match(/width="([\d.]+)mm"[^>]*viewBox="0 0 ([\d.]+)/)!;
    expect(Number(w)).toBeCloseTo(Number(vw), 6);   // one viewBox unit is one millimetre
    const r = Number(svg.match(/<circle cx="0" cy="0" r="([\d.]+)"/)![1]);
    expect(Math.abs(2 * r - 600)).toBeLessThan(0.1);
  });

  it("marks every nail with a 1 mm dot on that circle and numbers it, nail 0 at the top", () => {
    const dots = [...svg.matchAll(/<circle cx="(-?[\d.]+)" cy="(-?[\d.]+)" r="0.5"/g)].map((m) => [Number(m[1]), Number(m[2])]);
    expect(dots.length).toBe(240);
    for (const [x, y] of dots) expect(Math.hypot(x, y)).toBeCloseTo(300, 2);
    expect(dots[0][0]).toBeCloseTo(0, 6); expect(dots[0][1]).toBeCloseTo(-300, 6);
    expect(dots[60][0]).toBeCloseTo(300, 6);   // a quarter of the way round is 3 o'clock: clockwise
    expect([...svg.matchAll(/<text [^>]*>(\d+)<\/text>/g)].map((m) => Number(m[1]))).toEqual(Array.from({ length: 240 }, (_, i) => i));
  });

  it("has a 100 mm calibration square and the 0° mark", () => {
    expect(svg).toMatch(/<rect [^>]*width="100" height="100"/);
    expect(svg).toMatch(/<path d="M0 -306V-294"/);
  });

  for (const paper of ["A4", "A3"] as const) {
    it(`tiles onto ${paper} pages at true size, covering every nail and its label`, () => {
      const pages = templatePages(d, paper), P = PAPER[paper];
      expect(pages.length).toBeGreaterThan(1);
      for (const p of pages) {
        expect(p.svg).toContain(`width="${P.w}mm" height="${P.h}mm" viewBox="0 0 ${P.w} ${P.h}"`);
        expect(p.w).toBe(P.w - 2 * MARGIN);
      }
      // every nail, with room for its number (8 mm outwards), lies inside some page's printed region
      const off = 300 + 16;
      for (const n of nailPositionsMm(240, 600)) {
        const len = Math.hypot(n.x, n.y), lx = off + n.x * (1 + 8 / len), ly = off + n.y * (1 + 8 / len), nx = off + n.x, ny = off + n.y;
        expect(pages.some((p) => nx >= p.x0 && nx <= p.x0 + p.w && ny >= p.y0 && ny <= p.y0 + p.h && lx >= p.x0 && lx <= p.x0 + p.w && ly >= p.y0 && ly <= p.y0 + p.h)).toBe(true);
      }
      // exactly one calibration square, and it covers no nail and no number
      const cals = pages.filter((p) => p.calibration);
      expect(cals.length + pages.filter((p) => p.row === 0).length).toBe(1);
      for (const p of cals) {
        const { x, y } = p.calibration!;
        for (const n of nailPositionsMm(240, 600)) {
          const len = Math.hypot(n.x, n.y);
          for (const k of [0, 3, 8, 12]) {   // the nail and points along its number
            const px = off + n.x * (1 + k / len), py = off + n.y * (1 + k / len);
            expect(px >= x && px <= x + 100 && py >= y && py <= y + 100).toBe(false);
          }
        }
      }
    });
  }

  it("skips pages with nothing on them", () => {
    const pages = templatePages({ nails: 240, boardMm: 900, labels }, "A4");
    const cols = Math.max(...pages.map((p) => p.col)), rows = Math.max(...pages.map((p) => p.row));
    expect(pages.length).toBeLessThan(cols * rows);   // the middle of a large ring is empty
  });
});

describe("project file", () => {
  const res = 120, T = portraitTarget(res), params = { ...DEFAULT_UI, ...smallParams({ maxLines: 150 }), workingRes: res };
  const prep = { crop: { cx: 1, cy: 2, size: 3, angle: 0.25 }, adj: { ...NO_ADJUSTMENT }, clahe: true, claheClip: 3 };

  it("reloads the target bit for bit, and the solver reproduces the stored sequence", async () => {
    const { workingRes: _r, ...sp } = params; void _r;
    const r = await new GreedySolver().run({ target: T, weights: null, res }, sp);
    const text = saveProject({ params, prep, res, target: T, mask: null, sequence: r.passes[0].sequence, version: "0.4.0", saved: "today" });
    const back = loadProject(text);
    expect(hashBytes(back.target)).toBe(hashBytes(T));
    expect(Array.from(back.target)).toEqual(Array.from(T));
    expect(back.file.prep).toEqual(prep);
    const again = await new GreedySolver().run({ target: back.target, weights: back.mask, res: back.file.res }, sp);
    expect(Array.from(again.passes[0].sequence)).toEqual(Array.from(back.sequence));
  });

  it("keeps the importance mask", () => {
    const W = new Float32Array(res * res).fill(1); W[5] = 2.5; W[9] = 0.2;
    const back = loadProject(saveProject({ params, prep, res, target: T, mask: W, sequence: new Uint16Array([0]), version: "x", saved: "y" }));
    expect(Array.from(back.mask!)).toEqual(Array.from(W));
  });

  it("refuses a damaged or foreign file", () => {
    const text = saveProject({ params, prep, res, target: T, mask: null, sequence: new Uint16Array([0, 50]), version: "x", saved: "y" });
    const f = JSON.parse(text);
    f.target.hash = "00000000-0";
    expect(() => loadProject(JSON.stringify(f))).toThrow("bad-hash");
    expect(() => loadProject("{}")).toThrow("not-project");
    expect(() => loadProject("not json")).toThrow("not-json");
    const g = JSON.parse(text); g.sequence = [0, 9999];
    expect(() => loadProject(JSON.stringify(g))).toThrow("bad-sequence");
  });
});
