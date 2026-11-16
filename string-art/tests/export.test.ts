import { describe, expect, it } from "vitest";
import { sequenceCsv } from "../src/export/csv";
import { BLOCK, instructionsHtml, sequenceId } from "../src/export/instructions";
import { chordLengthMm } from "../src/core/geometry";

const seq = Uint16Array.from([0, 57, 140, 22, 180, 61, 200, 99, 13, 150, 77, 230, 31, 120, 5, 170, 44, 210, 88, 199, 66, 3, 125]);   // 22 lines
const input = { sequence: seq, nails: 240, boardMm: 600, threadMm: 0.25, minSkip: 20, threadM: 12.3, slackM: 1.2, version: "9.9.9", preview: null, date: "16 November 2026" };

describe("sequence CSV", () => {
  it("has a header and one row per line, with the chord length in mm", () => {
    const rows = sequenceCsv(seq, 240, 600).trim().split("\n");
    expect(rows[0]).toBe("step,from_nail,to_nail,chord_length_mm");
    expect(rows.length).toBe(seq.length);
    const [step, from, to, len] = rows[3].split(",");
    expect([Number(step), Number(from), Number(to)]).toEqual([3, 140, 22]);
    expect(Number(len)).toBeCloseTo(chordLengthMm(140, 22, 240, 600), 1);
  });
});

describe("winding instructions", () => {
  const html = instructionsHtml(input);
  const blocks = [...html.matchAll(/<li class="blk">([\s\S]*?)<\/li>/g)];

  it("puts the lines in numbered blocks of 10, each with a checkbox", () => {
    expect(blocks.length).toBe(Math.ceil(22 / BLOCK));
    expect(blocks.every((b) => /<input type="checkbox"/.test(b[1]))).toBe(true);
    expect(blocks[0][1]).toContain("1–10");
    expect(blocks[2][1]).toContain("21–22");
  });

  it("lists every nail after the start, in order", () => {
    const nails = blocks.flatMap((b) => [...b[1].matchAll(/<span>(\d+)<\/span>/g)].map((m) => Number(m[1])));
    expect(nails).toEqual(Array.from(seq.slice(1)));
  });

  it("says where to start, how the nails are numbered, and how much thread is needed", () => {
    expect(html).toContain("tie the thread to nail 0");
    expect(html).toContain("nail 0 at the top");
    expect(html).toContain("12 m, plus 1 m");
    expect(html).toContain("version 9.9.9");
  });

  it("is a complete, self-contained page", () => {
    expect(html.startsWith("<!doctype html>")).toBe(true);
    expect(html).not.toMatch(/<script src=|<link /);
    expect(html.trim().endsWith("</html>")).toBe(true);
  });

  it("remembers ticks under an id that depends on the sequence", () => {
    expect(sequenceId(seq)).toMatch(/^[0-9a-f]{8}$/);
    expect(sequenceId(seq)).toBe(sequenceId(Uint16Array.from(seq)));
    const other = Uint16Array.from(seq); other[5] = 62;
    expect(sequenceId(other)).not.toBe(sequenceId(seq));
    expect(html).toContain(`string-art-ticks-${sequenceId(seq)}`);
  });
});
