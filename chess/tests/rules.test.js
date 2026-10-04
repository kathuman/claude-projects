// Rules module checks — run with: node chess/tests/rules.test.js
// Perft (move-path counts) against the published values for three standard positions.
const R = require("../src/rules.js");
let pass = 0, fail = 0;
function check(name, cond, detail) { if (cond) pass++; else fail++; console.log((cond ? "ok   " : "FAIL ") + name + (detail !== undefined ? "  → " + detail : "")); }
const cases = [
  ["start position", R.START_FEN, [20, 400, 8902, 197281]],
  ["Kiwipete (castling, en passant, promotion, pins)", "r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1", [48, 2039, 97862]],
  ["position 3 (en passant and check edge cases)", "8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1", [14, 191, 2812, 43238]],
];
for (const [name, fen, counts] of cases) {
  const pos = R.fromFEN(fen);
  counts.forEach((n, i) => { const got = R.perft(pos, i + 1); check(`perft ${name}, depth ${i + 1} = ${n}`, got === n, got); });
}
check("FEN round trip", R.toFEN(R.fromFEN(cases[1][1])) === cases[1][1]);
const p = R.fromFEN(R.START_FEN), e4 = R.findMove(p, "e4");
check("SAN lookup and en passant square after a double step", e4 && R.toFEN(R.play(p, e4)).split(" ")[3] === "e3");
const mate = R.fromFEN("6k1/5ppp/8/8/8/8/8/R5K1 w - - 0 1"), ra8 = R.findMove(mate, "Ra8");
check("back-rank mate: Ra8 is mate and its SAN ends in #", R.toSAN(mate, ra8) === "Ra8#" && R.isMate(R.play(mate, ra8)));
check("stalemate detected", R.status(R.fromFEN("7k/5Q2/6K1/8/8/8/8/8 b - - 0 1")).stalemate);
console.log(pass + "/" + (pass + fail) + " checks passed");
process.exit(fail ? 1 : 0);
