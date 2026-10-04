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

// typed moves
const sp = R.fromFEN(R.START_FEN);
[["e4", "e2e4"], ["e2e4", "e2e4"], ["e2-e4", "e2e4"], ["nf3", "g1f3"], ["Nf3", "g1f3"], ["N", null], ["e5", null]].forEach(([t, uci]) => {
  const m = R.parseMove(sp, t);
  check(`typed move "${t}" → ${uci}`, uci === null ? m === null : m && R.toUCI(m) === uci);
});
const bp = R.fromFEN("4k3/8/8/8/8/2n5/1P6/4K3 w - - 0 1");
check('"bxc3" is the b-pawn capture', R.toUCI(R.parseMove(bp, "bxc3")) === "b2c3");
const bb = R.fromFEN("4k3/8/8/8/8/8/8/1B2K3 w - - 0 1");
check('"bc2" falls back to the bishop', R.toUCI(R.parseMove(bb, "bc2")) === "b1c2");
const castle = R.fromFEN("4k3/8/8/8/8/8/8/R3K2R w KQ - 0 1");
check('"0-0" and "o-o-o" castle', R.parseMove(castle, "0-0")[4] === "O-O" && R.parseMove(castle, "o-o-o")[4] === "O-O-O");
const promo = R.fromFEN("8/4P3/8/8/8/8/k7/4K3 w - - 0 1");
check('"e8q", "e8=N" and "e7e8r" promote', R.parseMove(promo, "e8q")[5] === "Q" && R.parseMove(promo, "e8=N")[5] === "N" && R.parseMove(promo, "e7e8r")[5] === "R");

// draws
const im = (f) => R.insufficientMaterial(R.fromFEN(f));
check("insufficient: K v K", im("8/8/4k3/8/8/4K3/8/8 w - - 0 1"));
check("insufficient: K+N v K", im("8/8/4k3/8/8/4K3/8/6N1 w - - 0 1"));
check("insufficient: K+B v K+B, same colour", im("8/8/4k3/2b5/8/4K3/8/6B1 w - - 0 1")); // c5 and g1 are both dark
check("not insufficient: K+B v K+B, opposite colours", !im("8/8/4k3/1b6/8/4K3/8/6B1 w - - 0 1"));
check("not insufficient: K+N+N v K", !im("8/8/4k3/8/8/4K3/8/5NN1 w - - 0 1"));
check("not insufficient: a pawn", !im("8/8/4k3/8/8/4K3/4P3/8 w - - 0 1"));
check("canMate: lone knight v bare king — no", !R.canMate(R.fromFEN("8/8/4k3/8/8/4K3/8/6N1 w - - 0 1"), "w"));
check("canMate: lone knight v king and pawn — yes", R.canMate(R.fromFEN("8/4p3/4k3/8/8/4K3/8/6N1 w - - 0 1"), "w"));
check("canMate: a rook — yes", R.canMate(R.fromFEN("8/8/4k3/8/8/4K3/8/6R1 w - - 0 1"), "w"));
// threefold: Nf3 Nf6 Ng1 Ng8 twice brings the start position back for the third time
let rp = R.fromFEN(R.START_FEN); const keys = [R.positionKey(rp)];
"Nf3 Nf6 Ng1 Ng8 Nf3 Nf6 Ng1 Ng8".split(" ").forEach((s) => { rp = R.play(rp, R.findMove(rp, s)); keys.push(R.positionKey(rp)); });
check("threefold: start position occurs three times", keys.filter((k) => k === keys[0]).length === 3);
check("halfmove clock counts the knight moves", rp.halfmove === 8);
// en passant counts for repetition only when it can be played
const afterE4 = R.play(sp, R.findMove(sp, "e4"));
check("e3 ep square ignored in the repetition key (no black pawn can take)", R.positionKey(afterE4).endsWith(" -"));

// FEN loading
check("loadFEN rejects two white kings", !!R.loadFEN("4k3/8/8/8/8/8/8/K3K3 w - - 0 1").error);
check("loadFEN rejects the side not to move in check", !!R.loadFEN("4k3/4R3/8/8/8/8/8/4K3 w - - 0 1").error);
check("loadFEN drops castling rights the pieces contradict", R.toFEN(R.loadFEN("4k3/8/8/8/8/8/8/4K2R w KQkq - 0 1").pos).split(" ")[2] === "K");
check("loadFEN rejects garbage", !!R.loadFEN("hello").error);

// PGN
const pgnText = `[Event "Test"]
[White "A"]
[Black "B"]

1. e4 e5 {a comment} 2. Nf3 (2. f4 exf4) Nc6 $1 3. Bb5 a6 4. Ba4 Nf6 5. 0-0 Be7 1-0`;
const g = R.parsePGN(pgnText);
check("PGN: tags, comments, variations, NAGs, castling with zeros", !g.error && g.sans.join(" ") === "e4 e5 Nf3 Nc6 Bb5 a6 Ba4 Nf6 O-O Be7" && g.tags.White === "A" && g.result === "1-0", g.error || g.sans.join(" "));
const out = R.toPGN({ tags: { White: "A", Black: "B" }, sans: g.sans, result: g.result });
const g2 = R.parsePGN(out);
check("PGN round trip", !g2.error && g2.sans.join(" ") === g.sans.join(" ") && g2.result === "1-0" && /\[Result "1-0"\]/.test(out));
const fenGame = R.toPGN({ startFen: "4k3/8/8/8/8/8/4P3/4K3 b - - 0 7", sans: ["Kd7", "e4"], result: "*" });
check("PGN from a position: SetUp/FEN tags and '7... Kd7'", /\[SetUp "1"\]/.test(fenGame) && /7\.\.\. Kd7 8\. e4 \*/.test(fenGame));
check("PGN from a position reads back", R.parsePGN(fenGame).sans.join(" ") === "Kd7 e4");
const bad = R.parsePGN("1. e4 e5 2. Ke3");
check("PGN: an illegal move is reported with its number", bad.error === "move 2. Ke3 is not legal here", bad.error);

console.log(pass + "/" + (pass + fail) + " checks passed");
process.exit(fail ? 1 : 0);
