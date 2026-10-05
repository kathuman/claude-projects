// Game review and opening book checks — run with: node chess/tests/review.test.js
global.self = global;
const R = require("../src/rules.js"), V = require("../src/review.js"), O = require("../src/openings.js");
require("../src/openings-data.js");
let pass = 0, fail = 0;
function check(name, cond, detail) { if (cond) pass++; else fail++; console.log((cond ? "ok   " : "FAIL ") + name + (detail !== undefined ? "  → " + detail : "")); }
const play = (sans, fen) => { let p = R.fromFEN(fen || R.START_FEN); const out = [p]; sans.split(" ").filter(Boolean).forEach((s) => { p = R.play(p, R.findMove(p, s)); out.push(p); }); return out; };

// fromUCI agrees with the legal-move generator, flags included
const kiwi = R.fromFEN("r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1");
let same = true;
const walk = (pos, d) => { if (!d) return; R.legalMoves(pos).forEach((m) => { if (JSON.stringify(R.fromUCI(pos, R.toUCI(m))) !== JSON.stringify(m)) same = false; walk(R.play(pos, m), d - 1); }); };
walk(kiwi, 2);
const epPos = R.fromFEN("4k3/8/8/3pP3/8/8/8/4K3 w - d6 0 1");
check("fromUCI matches every legal move two plies deep in Kiwipete (castling, promotion, en passant)", same && R.fromUCI(epPos, "e5d6")[4] === "ep");

// opening book
const t0 = Date.now(), book = O.create(R, self.CHESS_OPENINGS_DATA), ms = Date.now() - t0;
check("opening book builds in under 1.5 s", ms < 1500, ms + " ms, " + book.size + " named positions");
const ruy = play("e4 e5 Nf3 Nc6 Bb5");
check("1. e4 e5 2. Nf3 Nc6 3. Bb5 is the Ruy Lopez (C60)", book.lookup(ruy[5]) && book.lookup(ruy[5]).eco === "C60" && /Ruy Lopez/.test(book.lookup(ruy[5]).name), JSON.stringify(book.lookup(ruy[5])));
const a = play("d4 d5 Nf3"), b = play("Nf3 d5 d4");
check("a transposition gets the same name", book.lookup(a[3]) && JSON.stringify(book.lookup(a[3])) === JSON.stringify(book.lookup(b[3])), book.lookup(a[3]) && book.lookup(a[3]).name);
const g = play("e4 e5 Nf3 Nc6 Bb5 a6 Ba4 Nf6 O-O Be7 h3");
check("a game's opening is its last named position", /Ruy Lopez/.test(book.opening(g).name), book.opening(g).name);
const firsts = book.moves(R.fromFEN(R.START_FEN)).map((m) => m.uci);
check("book moves from the start include e4, d4, c4 and Nf3", ["e2e4", "d2d4", "c2c4", "g1f3"].every((u) => firsts.includes(u)), firsts.slice(0, 6).join(" "));
check("inBook: 1. e4 yes; a Kiwipete middlegame has no book moves", book.inBook(R.fromFEN(R.START_FEN), "e2e4") && !book.inBook(kiwi, "e2a6") && book.moves(kiwi).length === 0);

// grading
const ev = (cp) => ({ cp, mate: null });
check("winning chances: 0 → 0, +1000 → about +0.95, mate → 1", V.winChance(ev(0)) === 0 && Math.abs(V.winChance(ev(1000)) - 0.951) < 0.01 && V.winChance(V.fromEngine({ mate: 3 }, "w")) === 1);
check("engine scores turn into White's view", V.fromEngine({ cp: 50 }, "b").cp === -50 && V.fromEngine({ mate: 2 }, "b").mate === -2 && V.fromEngine({ mate: 0 }, "w").cp < -50000);
check("the best move is 'best' whatever the drop", V.grade(ev(30), ev(-200), "w", "e2e4", "e2e4").kind === "best");
check("+0.3 → −3.0 for White is a blunder", V.grade(ev(30), ev(-300), "w", "a2a3", "e2e4").kind === "blunder");
check("+0.2 → −0.4 is an inaccuracy", V.grade(ev(20), ev(-40), "w", "a2a3", "e2e4").kind === "inaccuracy", V.drop(ev(20), ev(-40), "w").toFixed(3));
check("+0.2 → −1.2 is a mistake", V.grade(ev(20), ev(-120), "w", "a2a3", "e2e4").kind === "mistake", V.drop(ev(20), ev(-120), "w").toFixed(3));
check("a drop for Black reads the other way", V.grade(ev(-30), ev(300), "b", "a7a6", "e7e5").kind === "blunder" && V.grade(ev(-30), ev(-300), "b", "a7a6", "e7e5").kind === "good");
check("+8 → +6 in a won position is only 'good' (chances barely move)", V.grade(ev(800), ev(600), "w", "x", "y").kind === "good");
check("accuracy: a perfect move ≈ 100, a blunder far lower", V.moveAccuracy(ev(20), ev(20), "w") > 99.9 && V.moveAccuracy(ev(20), ev(-500), "w") < 20, V.moveAccuracy(ev(20), ev(-500), "w").toFixed(1));
const r = V.review([ev(20), ev(25), ev(-400), ev(-380)], [{ uci: "e2e4", best: "e2e4", mover: "w", book: true }, { uci: "f7f6", best: "e7e5", mover: "b" }, { uci: "a2a3", best: "d1h5", mover: "w" }]);
check("review: a book move, Black's move that swings +0.25 → −4.0 in Black's favour is 'good', and so is White's −4.0 → −3.8",
  r.moves[0].kind === "book" && r.moves[1].kind === "good" && r.moves[2].kind === "good", r.moves.map((m) => m.kind).join(" "));
const fool = V.review([ev(20), ev(-30), ev(-40), V.fromEngine({ mate: 1 }, "b"), V.fromEngine({ mate: 0 }, "w")],
  [{ uci: "f2f3", best: "e2e4", mover: "w", book: true }, { uci: "e7e5", best: "e7e5", mover: "b", book: true },
   { uci: "g2g4", best: "e1f2", mover: "w", book: true }, { uci: "d8h4", best: "d8h4", mover: "b", book: true }]);
check("review: a book move that blunders is still a blunder (fool's mate: 2. g4??)", fool.moves[2].kind === "blunder" && fool.moves[0].kind === "book" && fool.moves[3].kind === "book", fool.moves.map((m) => m.kind).join(" "));
const r3 = V.review([ev(20), ev(-300)], [{ uci: "f2f3", best: "e2e4", mover: "w" }]);
check("review: White's +0.2 → −3.0 counts as a blunder for White", r3.moves[0].kind === "blunder" && r3.w.blunder === 1 && r3.b.accuracy === null);
const r2 = V.review([ev(20), ev(400), ev(380)], [{ uci: "f7f6", best: "e7e5", mover: "w" }, { uci: "a7a6", best: "a7a6", mover: "b" }]);
check("review: counts and averages per side", r2.w.blunder === 0 && r2.b.accuracy > 99 && r2.w.accuracy > 99, JSON.stringify(r2.w));
check("format: +0.45, −1.20, #3, #−2", V.format(ev(45)) === "+0.45" && V.format(ev(-120)) === "−1.20" && V.format({ cp: 99997, mate: 3 }) === "#3" && V.format({ cp: -99998, mate: -2 }) === "#−2");
console.log(pass + "/" + (pass + fail) + " checks passed");
process.exit(fail ? 1 : 0);
