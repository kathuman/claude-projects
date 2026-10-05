/*
 * puzzles.js — puzzle logic for chess/puzzles/: ratings, move checking, choosing puzzles. Browser + Node.
 *
 * A puzzle (Lichess format) is [id, fen, moves, rating, themes]. The FEN is the position before the
 * opponent's move; moves are UCI, the first is the opponent's and the solver plays every second move from
 * the second on. As on Lichess, any move that gives checkmate is also accepted.
 *
 * The solver's rating is Glicko-2 (Glickman 2012), one rating period per puzzle, against the puzzle's
 * rating with a fixed deviation. A clean solve scores 1; a wrong move, the solution or a hint score 0.
 */
(function (root, factory) {
  if (typeof module !== "undefined" && module.exports) module.exports = factory();
  else root.ChessPuzzles = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";
  var SCALE = 173.7178, TAU = 0.75, PUZZLE_RD = 75, MIN_RD = 45, MAX_RD = 350;

  function newRating() { return { r: 1500, rd: 300, vol: 0.09 }; }

  // Glicko-2 update for one result (score 1 = solved, 0 = failed) against a puzzle of rating `opp`
  function rate(player, opp, score) {
    var mu = (player.r - 1500) / SCALE, phi = player.rd / SCALE, sigma = player.vol;
    var muj = (opp - 1500) / SCALE, phij = PUZZLE_RD / SCALE;
    var g = 1 / Math.sqrt(1 + 3 * phij * phij / (Math.PI * Math.PI));
    var E = 1 / (1 + Math.exp(-g * (mu - muj)));
    var v = 1 / (g * g * E * (1 - E));
    var delta = v * g * (score - E);
    // new volatility (Illinois algorithm, step 5 of Glickman's paper)
    var a = Math.log(sigma * sigma), eps = 1e-6;
    function f(x) {
      var ex = Math.exp(x), d = phi * phi + v + ex;
      return ex * (delta * delta - phi * phi - v - ex) / (2 * d * d) - (x - a) / (TAU * TAU);
    }
    var A = a, B;
    if (delta * delta > phi * phi + v) B = Math.log(delta * delta - phi * phi - v);
    else { var k = 1; while (f(a - k * TAU) < 0) k++; B = a - k * TAU; }
    var fA = f(A), fB = f(B);
    while (Math.abs(B - A) > eps) {
      var C = A + (A - B) * fA / (fB - fA), fC = f(C);
      if (fC * fB <= 0) { A = B; fA = fB; } else fA = fA / 2;
      B = C; fB = fC;
    }
    var sigma2 = Math.exp(A / 2);
    var phiStar = Math.sqrt(phi * phi + sigma2 * sigma2);
    var phi2 = 1 / Math.sqrt(1 / (phiStar * phiStar) + 1 / v);
    var mu2 = mu + phi2 * phi2 * g * (score - E);
    return {
      r: Math.round((mu2 * SCALE + 1500) * 10) / 10,
      rd: Math.max(MIN_RD, Math.min(MAX_RD, phi2 * SCALE)),
      vol: Math.min(0.1, sigma2)
    };
  }
  function expected(player, opp) {
    var mu = (player.r - 1500) / SCALE, muj = (opp - 1500) / SCALE, phij = PUZZLE_RD / SCALE;
    var g = 1 / Math.sqrt(1 + 3 * phij * phij / (Math.PI * Math.PI));
    return 1 / (1 + Math.exp(-g * (mu - muj)));
  }

  // ---- solving
  // start: the position before the opponent's move, plus everything needed to step through the puzzle
  function start(R, puzzle) {
    var pos = R.fromFEN(puzzle[1]), moves = puzzle[2].split(" ");
    return { pos: pos, moves: moves, ply: 0, side: pos.turn === "w" ? "b" : "w", done: false, failed: false };
  }
  // is `move` (a move array) right at this point? the expected move, or any checkmate
  function isRight(R, s, move) {
    var u = R.toUCI(move);
    if (u === s.moves[s.ply]) return true;
    return R.isMate(R.play(s.pos, move));
  }
  // play the next move of the solution (the opponent's reply, or the answer when shown)
  function advance(R, s) {
    var m = R.findMove(s.pos, s.moves[s.ply]);
    s.pos = R.play(s.pos, m);
    s.ply++;
    if (s.ply >= s.moves.length) s.done = true;
    return m;
  }
  // the solver plays `move`; returns "wrong", "right" (the opponent replies next) or "solved"
  function tryMove(R, s, move) {
    if (!isRight(R, s, move)) { s.failed = true; return "wrong"; }
    var mate = R.isMate(R.play(s.pos, move));
    s.pos = R.play(s.pos, move);
    s.ply++;
    if (mate || s.ply >= s.moves.length) { s.done = true; return "solved"; }
    return "right";
  }

  // ---- choosing puzzles
  // a puzzle near `target` that hasn't been seen; the window widens until something fits
  function pick(list, target, seen, rnd, filter) {
    rnd = rnd || Math.random;
    for (var w = 60; w <= 3000; w *= 2) {
      var fit = list.filter(function (p) { return Math.abs(p[3] - target) <= w && !seen[p[0]] && (!filter || filter(p)); });
      if (fit.length) return fit[Math.floor(rnd() * fit.length)];
    }
    return null;
  }
  // the 200-point bands (index.json) to load for a target rating: its own and the nearer neighbour
  function bandsFor(index, target) {
    var bs = index.bands, i = bs.findIndex(function (b) { return target >= b.from && target < b.to; });
    if (i < 0) i = target < bs[0].from ? 0 : bs.length - 1;
    var b = bs[i], other = target - b.from < 100 ? i - 1 : i + 1;
    return [b].concat(bs[other] ? [bs[other]] : []);
  }
  // the same puzzle for everyone on a given day (UTC date string "2026-10-05")
  function dailyIndex(dateStr, n) {
    var h = 2166136261;
    for (var i = 0; i < dateStr.length; i++) { h ^= dateStr.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
    return h % n;
  }
  // timed run: the difficulty climbs with every solved puzzle
  function runTarget(solved) { return Math.min(2600, 700 + solved * 70); }

  return { newRating: newRating, rate: rate, expected: expected, start: start, isRight: isRight, advance: advance, tryMove: tryMove,
    pick: pick, bandsFor: bandsFor, dailyIndex: dailyIndex, runTarget: runTarget, PUZZLE_RD: PUZZLE_RD };
});
