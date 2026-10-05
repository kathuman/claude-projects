/*
 * review.js — grading the moves of a game from engine evaluations. Browser + Node.
 *
 * An evaluation is { cp, mate } from White's point of view: cp in centipawns, mate = moves to mate
 * (positive: White mates) or null. Moves are graded by how much they lower the mover's winning chances,
 * the measure Lichess uses: winning chances = 2 / (1 + e^(-0.00368208 · cp)) − 1, from −1 to +1.
 * A drop of 0.1 is an inaccuracy, 0.2 a mistake, 0.3 a blunder. Accuracy per move follows Lichess's
 * formula on win percentage (50 + 50 · chances): 103.1668 · e^(−0.04354 · drop) − 3.1669.
 */
(function (root, factory) {
  if (typeof module !== "undefined" && module.exports) module.exports = factory();
  else root.ChessReview = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";
  var MATE_CP = 100000;

  // an engine score (side to move's view, as UCI reports it) as White's evaluation
  function fromEngine(score, turn) {
    var s = turn === "w" ? 1 : -1;
    if (score.mate != null) {
      // "mate 0": the side to move is already mated
      if (score.mate === 0) return { cp: -s * MATE_CP, mate: null, over: true };
      return { cp: s * (score.mate > 0 ? 1 : -1) * (MATE_CP - Math.abs(score.mate)), mate: s * score.mate };
    }
    return { cp: s * score.cp, mate: null };
  }
  function winChance(ev) {
    if (ev.cp >= MATE_CP / 2) return 1;
    if (ev.cp <= -MATE_CP / 2) return -1;
    var cp = Math.max(-1000, Math.min(1000, ev.cp));
    return 2 / (1 + Math.exp(-0.00368208 * cp)) - 1;
  }
  // how much a move lowered the mover's winning chances (0 … 2)
  function drop(before, after, mover) {
    var s = mover === "w" ? 1 : -1;
    return Math.max(0, s * (winChance(before) - winChance(after)));
  }
  function grade(before, after, mover, played, best) {
    var d = drop(before, after, mover);
    var kind = played === best ? "best" : d >= 0.3 ? "blunder" : d >= 0.2 ? "mistake" : d >= 0.1 ? "inaccuracy" : "good";
    return { kind: kind, drop: d };
  }
  function moveAccuracy(before, after, mover) {
    var a = 103.1668 * Math.exp(-0.04354 * 50 * drop(before, after, mover)) - 3.1669;
    return Math.max(0, Math.min(100, a));
  }
  // evals: n + 1 evaluations (before every move and after the last); moves: [{ uci, best, mover, book }]
  function review(evals, moves) {
    var sides = { w: { acc: [], inaccuracy: 0, mistake: 0, blunder: 0 }, b: { acc: [], inaccuracy: 0, mistake: 0, blunder: 0 } };
    var graded = moves.map(function (m, i) {
      // a book move is labelled "book" — unless the engine calls it a mistake (the book has traps too,
      // fool's mate among them, and a learner should hear about those)
      var g = grade(evals[i], evals[i + 1], m.mover, m.uci, m.best);
      if (m.book && g.kind !== "mistake" && g.kind !== "blunder") g.kind = "book";
      g.accuracy = moveAccuracy(evals[i], evals[i + 1], m.mover);
      var side = sides[m.mover];
      side.acc.push(g.accuracy);
      if (side[g.kind] != null) side[g.kind]++;
      return g;
    });
    ["w", "b"].forEach(function (c) {
      var a = sides[c].acc;
      sides[c].accuracy = a.length ? a.reduce(function (x, y) { return x + y; }, 0) / a.length : null;
      delete sides[c].acc;
    });
    return { moves: graded, w: sides.w, b: sides.b };
  }
  // "+0.45", "−1.20", "#3", "#−2"
  function format(ev) {
    if (ev.mate != null) return "#" + (ev.mate < 0 ? "−" + -ev.mate : ev.mate);
    if (ev.over) return ev.cp > 0 ? "1-0" : "0-1";
    var v = ev.cp / 100;
    return (v > 0 ? "+" : v < 0 ? "−" : "") + Math.abs(v).toFixed(2);
  }
  var SYMBOL = { inaccuracy: "?!", mistake: "?", blunder: "??" };
  return { fromEngine: fromEngine, winChance: winChance, drop: drop, grade: grade, moveAccuracy: moveAccuracy, review: review, format: format, SYMBOL: SYMBOL, MATE_CP: MATE_CP };
});
