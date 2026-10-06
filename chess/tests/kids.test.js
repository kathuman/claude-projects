// Chess for kids checks — run with: node chess/tests/kids.test.js
// Every level is solvable and its par (three stars) is exactly the fewest moves; checkmate levels have one
// mating move; Help always points along a shortest way; pawn wars play legal games to an end; every
// language has every word.
global.self = global;
const R = require("../src/rules.js"), K = require("../src/kids.js");
require("../kids/levels.js"); require("../kids/i18n.js");
const W = self.CHESS_KIDS.worlds, I = self.CHESS_KIDS_I18N;
let pass = 0, fail = 0;
function check(name, cond, detail) { if (cond) pass++; else fail++; if (!cond || process.env.VERBOSE) console.log((cond ? "ok   " : "FAIL ") + name + (detail !== undefined ? "  → " + detail : "")); }
const needed = new Set(["ui.title", "piece.R", "piece.B", "piece.Q", "piece.K", "piece.N", "piece.P"]);
let levels = 0;
for (const w of W) {
  needed.add("world." + w.id); needed.add("world." + w.id + ".intro");
  for (const L of w.levels) {
    levels++; needed.add("lvl." + L.type);
    const tag = w.id + " / " + L.id;
    if (L.type === "mate") {
      const pos = R.fromFEN(L.fen), mates = R.legalMoves(pos).filter((m) => R.isMate(R.play(pos, m)));
      check(tag + ": exactly one mating move, the listed one", mates.length === 1 && R.toUCI(mates[0]) === L.solution, mates.map(R.toUCI).join(","));
      continue;
    }
    if (L.type === "pawnwars") {
      // ten games of the computer against itself end with a winner, every move legal
      let ends = 0;
      for (let g = 0; g < 10; g++) {
        let pos = R.fromFEN(L.fen), n = 0, w = null;
        while (!(w = K.pawnWinner(R, pos)) && n < 200) { const m = K.pawnAI(R, pos, g % 2 ? "easy" : "hard"); if (!m || !R.legalMoves(pos).some((x) => R.toUCI(x) === R.toUCI(m))) break; pos = R.play(pos, m); n++; }
        if (w) ends++;
      }
      check(tag + ": computer-vs-computer games all reach a winner", ends === 10, ends + "/10");
      continue;
    }
    const best = K.solve(R, L);
    check(tag + ": solvable, par " + L.par + " is the fewest moves", best === L.par, "search says " + best);
    // following Help from the start finishes in exactly par moves
    let pos = K.position(R, L), hero = R.parseSquare(L.from), left = K.squares(L.stars), n = 0;
    while (!K.finished(R, L, pos, hero, left) && n < 40) {
      const m = K.nextMove(R, L, pos, hero, left);
      if (!m) break;
      pos = K.move(R, pos, m); hero = [m[2], m[3]]; left = left.filter((s) => s !== R.squareName(m[2], m[3])); n++;
    }
    check(tag + ": following Help finishes in par", K.finished(R, L, pos, hero, left) && n === L.par, n + " moves");
    // nothing starts on top of anything else, and the king never starts in check
    const sqs = [L.from].concat(K.squares(L.stars), K.squares(L.rocks), K.squares(L.enemies).map((e) => e.slice(2)), L.flag ? [L.flag] : []);
    check(tag + ": every square used once", new Set(sqs).size === sqs.length, sqs.join(" "));
    if (L.piece === "K") check(tag + ": the king does not start in check", !R.inCheck(K.position(R, L)));
  }
}
// the game opponents
const legal = (pos, m) => R.legalMoves(pos).some((x) => R.toUCI(x) === R.toUCI(m));
let allLegal = true, ends = 0;
for (const lv of ["sleepy", "friendly", "clever"]) {
  for (let g = 0; g < (lv === "clever" ? 1 : 3); g++) {
    let pos = R.fromFEN(R.START_FEN), n = 0;
    while (n < 160 && R.legalMoves(pos).length && !R.insufficientMaterial(pos) && pos.halfmove < 100) {
      const m = K.kidAI(R, pos, n % 2 ? "sleepy" : lv); if (!legal(pos, m)) { allLegal = false; break; } pos = R.play(pos, m); n++;
    }
    ends++;
  }
}
check("opponents: every move they pick is legal, over whole games", allLegal && ends === 7);
const m1 = R.fromFEN("6k1/5ppp/8/8/8/8/5PPP/3R2K1 w - - 0 1");
check("Friendly Fiona and Clever Owl never miss a mate in one", ["friendly", "clever"].every((lv) => [0, 1, 2, 3, 4].every(() => R.isMate(R.play(m1, K.kidAI(R, m1, lv))))));
const fq = R.fromFEN("4k3/8/8/3q4/8/8/3R4/4K3 w - - 0 1");
check("Clever Owl takes a free queen", R.toSAN(fq, K.kidAI(R, fq, "clever")) === "Rxd5");
const avoid = R.fromFEN("4k3/8/8/8/3p4/8/4Q3/4K3 w - - 0 1");
check("Clever Owl does not put its queen where a pawn takes it", [0, 1, 2, 3, 4].every(() => { const m = K.kidAI(R, avoid, "clever"); return !(m[2] === 5 && (m[3] === 2 || m[3] === 4)); }));
// dangers and hanging pieces
const hp = R.fromFEN("rnbqkbnr/ppppppp1/7p/6N1/8/8/PPPPPPPP/RNBQKB1R b KQkq - 1 2");
check("hanging: a knight attacked by a pawn is in danger", JSON.stringify(K.hanging(R, hp, 3, 6)) === JSON.stringify({ attacker: "p", piece: "N" }));
const safe = R.fromFEN("4k3/8/3r4/8/3N4/2P5/8/4K3 w - - 0 1");
check("hanging: a defended knight attacked only by a rook is safe", K.hanging(R, safe, 4, 3) === null);
const loose = R.fromFEN("4k3/8/3r4/8/3N4/8/8/4K3 w - - 0 1");
check("dangers: an undefended knight attacked by a rook is listed", K.dangers(R, loose, "w").length === 1 && K.dangers(R, loose, "w")[0].attacker === "r");
check("dangers: pawns and kings are never listed", K.dangers(R, R.fromFEN("4k3/8/8/3p4/4P3/8/8/4K3 w - - 0 1"), "w").length === 0);
const gameKeys = ["game.title", "game.sleepy", "game.friendly", "game.clever", "game.careful", "game.win", "game.lose", "game.draw", "game.danger", "game.medal"];
check("the game's words exist in English", gameKeys.every((k) => k in I.en));
check("stars: 3 at par, 2 within two, 1 after that", K.stars(4, 4) === 3 && K.stars(4, 3) === 3 && K.stars(4, 6) === 2 && K.stars(4, 7) === 1);
check(levels + " levels in " + W.length + " worlds", levels >= 20 && W.length === 8);
const en = Object.keys(I.en);
check("English has every word the levels use", [...needed].every((k) => k in I.en), [...needed].filter((k) => !(k in I.en)).join(", "));
for (const [lang, t] of Object.entries(I)) {
  if (lang === "en") continue;
  const missing = en.filter((k) => !(k in t)), extra = Object.keys(t).filter((k) => !(k in I.en));
  check(lang + ": every word translated, no unknown keys", !missing.length && !extra.length, missing.concat(extra).slice(0, 5).join(", "));
  const ph = Object.keys(t).filter((k) => ((I.en[k].match(/\{\w+\}/g) || []).filter((x) => x !== "{piece}").sort().join() !== (t[k].match(/\{\w+\}/g) || []).filter((x) => x !== "{piece}").sort().join()));
  check(lang + ": placeholders match English ({piece} may be left out)", !ph.length, ph.join(", "));
}
console.log(pass + "/" + (pass + fail) + " checks passed");
process.exit(fail ? 1 : 0);
