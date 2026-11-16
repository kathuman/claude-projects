// The sequence as CSV: one row per line wound, with its physical length on the board.
import { chordLengthMm } from "../core/geometry";

export function sequenceCsv(sequence: Uint16Array, nails: number, boardMm: number): string {
  const rows = ["step,from_nail,to_nail,chord_length_mm"];
  for (let s = 1; s < sequence.length; s++) {
    rows.push(`${s},${sequence[s - 1]},${sequence[s]},${chordLengthMm(sequence[s - 1], sequence[s], nails, boardMm).toFixed(1)}`);
  }
  return rows.join("\n") + "\n";
}
