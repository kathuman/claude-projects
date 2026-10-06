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
