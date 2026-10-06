/*
 * kids.js — the logic behind "Chess for kids" (chess/kids/), browser + Node.
 *
 * A level puts one "hero" piece (White) on a board with targets: stars to collect, sleepy black pieces to
 * capture (they never move), rocks that block the way, and for the king a flag to reach without walking
 * into an attacked square. Moves follow the real rules (src/rules.js); only the hero moves.
 *   position(level)   -> a rules position for the level's start
 *   heroMoves(...)    -> the hero's legal moves
 *   solve(level)      -> fewest moves to finish (breadth-first search), or -1 if impossible
 *   stars(level, n)   -> 3 stars at the best count, 2 a little over, 1 otherwise
 * Rocks are stored as white pawns on the rules board (they block, cannot be taken by the hero) and drawn
 * as rocks; the hero is always White and it is always White's turn.
 * Pawn wars: pawnAI(R, pos, level) picks a move for the computer in a pawns-only game.
 */
(function (root, factory) {
  if (typeof module !== "undefined" && module.exports) module.exports = factory();
  else root.ChessKids = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";
  function sqs(s) { return (s || "").split(/\s+/).filter(Boolean); }
  function parse(R, s) { return R.parseSquare(s); }

  // targets: stars (squares) and enemies ("n:f3"); the level is done when all are taken (or the flag reached)
  function position(R, lv) {
    var board = [];
    for (var r = 0; r < 8; r++) board.push([null, null, null, null, null, null, null, null]);
    var h = parse(R, lv.from);
    board[h[0]][h[1]] = lv.piece;
    sqs(lv.rocks).forEach(function (s) { var q = parse(R, s); board[q[0]][q[1]] = "P"; });
    sqs(lv.enemies).forEach(function (e) { var q = parse(R, e.slice(2)); board[q[0]][q[1]] = e[0]; });
    return { board: board, turn: "w", castling: { K: false, Q: false, k: false, q: false }, enPassant: null, halfmove: 0, fullmove: 1 };
  }
  function heroMoves(R, pos, hero) {
    return R.legalMoves(pos).filter(function (m) { return m[0] === hero[0] && m[1] === hero[1]; });
  }
  // the hero moves; it stays White's turn (the black pieces are asleep)
  function move(R, pos, m) {
    var next = R.play(pos, m);
    next.turn = "w"; next.enPassant = null;
    return next;
  }

  // breadth-first search over (hero square, targets left); returns the fewest moves, or -1
  function solve(R, lv) { return search(R, lv).dist; }
  // the first move of a shortest way to finish from the current state (for Help)
  function nextMove(R, lv, pos, hero, starsLeft) { return search(R, lv, pos, hero, starsLeft).first; }
  function search(R, lv, startPos, startHero, startLeft) {
    var start = startPos || position(R, lv), stars = sqs(lv.stars).map(function (s) { return parse(R, s); });
    var flag = lv.flag ? parse(R, lv.flag) : null;
    var hero = startHero || parse(R, lv.from);
    function key(pos, h, left) {
      var en = [];
      for (var r = 0; r < 8; r++) for (var c = 0; c < 8; c++) { var p = pos.board[r][c]; if (p && R.colorOf(p) === "b") en.push(r * 8 + c); }
      return h[0] * 8 + h[1] + "|" + left.join(",") + "|" + en.join(",");
    }
    function done(pos, h, left) {
      if (flag) return h[0] === flag[0] && h[1] === flag[1];
      if (lv.type === "promote") return pos.board[h[0]][h[1]] !== "P" || h[0] === 0;
      var enemies = 0;
      for (var r = 0; r < 8; r++) for (var c = 0; c < 8; c++) { var p = pos.board[r][c]; if (p && R.colorOf(p) === "b") enemies++; }
      return left.length === 0 && enemies === 0;
    }
    // starsLeft: the squares still holding a star ("a6 f6"), when searching from the middle of a level
    var left0 = startLeft ? stars.map(function (_, i) { return i; }).filter(function (i) { return startLeft.indexOf(R.squareName(stars[i][0], stars[i][1])) >= 0; })
      : stars.map(function (_, i) { return i; });
    var queue = [[start, hero, left0, 0, null]], seen = {};
    seen[key(start, hero, left0)] = true;
    while (queue.length) {
      var cur = queue.shift(), pos = cur[0], h = cur[1], left = cur[2], d = cur[3], first = cur[4];
      if (d > 30) break;
      var ms = heroMoves(R, pos, h);
      for (var i = 0; i < ms.length; i++) {
        var m = ms[i], np = move(R, pos, m), nh = [m[2], m[3]], f = first || m;
        var nl = left.filter(function (j) { return !(stars[j][0] === nh[0] && stars[j][1] === nh[1]); });
        if (done(np, nh, nl)) return { dist: d + 1, first: f };
        var k = key(np, nh, nl);
        if (!seen[k]) { seen[k] = true; queue.push([np, nh, nl, d + 1, f]); }
      }
    }
    return { dist: -1, first: null };
  }
  // is the level finished? (stars and enemies gone, flag reached, or pawn promoted)
  function finished(R, lv, pos, hero, starsLeft) {
    if (lv.flag) return R.squareName(hero[0], hero[1]) === lv.flag;
    if (lv.type === "promote") return hero[0] === 0;
    for (var r = 0; r < 8; r++) for (var c = 0; c < 8; c++) { var p = pos.board[r][c]; if (p && R.colorOf(p) === "b") return false; }
    return starsLeft.length === 0;
  }
  function stars(par, n) { return n <= par ? 3 : n <= par + 2 ? 2 : 1; }

  // ---- pawn wars: pawns only, the first to reach the last rank wins
  function pawnAI(R, pos, level, rnd) {
    rnd = rnd || Math.random;
    var moves = R.legalMoves(pos);
    if (!moves.length) return null;
    if (level === "easy" && rnd() < 0.35) return moves[Math.floor(rnd() * moves.length)];
    var me = pos.turn, them = me === "w" ? "b" : "w", dir = me === "w" ? -1 : 1;
    var scored = moves.map(function (m) {
      var s = rnd() * 0.5, after = R.play(pos, m), tr = m[2], tc = m[3];
      if (m[4] === "promo") s += 1000;
      if (pos.board[tr][tc] || m[4] === "ep") s += 12;
      // how far forward
      s += (me === "w" ? 7 - tr : tr) * 1.5;
      // walking into a capture that isn't paid back
      var attacked = R.attackedBy(after.board, tr, tc, them), defended = R.attackedBy(after.board, tr, tc, me);
      if (attacked && !defended) s -= 15; else if (attacked) s -= 4;
      // a passed pawn (no enemy pawn ahead on this or a neighbouring file) is worth pushing
      var passed = true;
      for (var r = tr + dir; r >= 0 && r < 8; r += dir) for (var dc = -1; dc <= 1; dc++) {
        var c = tc + dc, q = c >= 0 && c < 8 ? after.board[r][c] : null;
        if (q && q.toUpperCase() === "P" && R.colorOf(q) === them) passed = false;
      }
      if (passed) s += 6;
      return [s, m];
    });
    scored.sort(function (a, b) { return b[0] - a[0]; });
    return scored[0][1];
  }
  // who has won a pawn war: "w", "b" or null (a side that cannot move loses)
  function pawnWinner(R, pos) {
    for (var c = 0; c < 8; c++) {
      if (pos.board[0][c] && R.colorOf(pos.board[0][c]) === "w") return "w";
      if (pos.board[7][c] && R.colorOf(pos.board[7][c]) === "b") return "b";
    }
    var any = { w: 0, b: 0 };
    pos.board.forEach(function (row) { row.forEach(function (p) { if (p) any[R.colorOf(p)]++; }); });
    if (!any.w) return "b";
    if (!any.b) return "w";
    if (!R.legalMoves(pos).length) return pos.turn === "w" ? "b" : "w";
    return null;
  }

  // ---- a whole game against a gentle computer
  var VALUE = { P: 1, N: 3, B: 3, R: 5, Q: 9, K: 0 };
  function val(p) { return VALUE[p.toUpperCase()]; }
  // material (plus a little for central pawns and pieces) from the side to move's point of view
  function evaluate(R, pos) {
    var s = 0;
    for (var r = 0; r < 8; r++) for (var c = 0; c < 8; c++) {
      var p = pos.board[r][c];
      if (!p) continue;
      var v = val(p) + ((r >= 2 && r <= 5 && c >= 2 && c <= 5 && p.toUpperCase() !== "K") ? 0.1 : 0);
      s += R.colorOf(p) === pos.turn ? v : -v;
    }
    return s;
  }
  function ordered(R, pos) {
    return R.legalMoves(pos).map(function (m) {
      var t = pos.board[m[2]][m[3]];
      return [m, (t ? 10 * val(t) - val(pos.board[m[0]][m[1]]) : 0) + (m[4] === "promo" ? 80 : 0)];
    }).sort(function (a, b) { return b[1] - a[1]; }).map(function (x) { return x[0]; });
  }
  // negamax with alpha-beta; mate scores beat any material, sooner mates beat later ones
  function negamax(R, pos, depth, alpha, beta) {
    var moves = ordered(R, pos);
    if (!moves.length) return R.inCheck(pos) ? -1000 - depth : 0;
    if (depth === 0) return evaluate(R, pos);
    var best = -Infinity;
    for (var i = 0; i < moves.length; i++) {
      var s = -negamax(R, R.play(pos, moves[i]), depth - 1, -beta, -alpha);
      if (s > best) best = s;
      if (s > alpha) alpha = s;
      if (alpha >= beta) break;
    }
    return best;
  }
  // levels: "sleepy" (often random, likes captures), "friendly" (looks at the reply, sometimes slips),
  // "clever" (three plies ahead, never misses a mate in one)
  function kidAI(R, pos, level, rnd) {
    rnd = rnd || Math.random;
    var moves = ordered(R, pos);
    if (!moves.length) return null;
    function pick(list) { return list[Math.floor(rnd() * list.length)]; }
    if (level === "sleepy") {
      var mates = moves.filter(function (m) { return R.isMate(R.play(pos, m)); });
      if (mates.length && rnd() < 0.5) return mates[0];
      if (rnd() < 0.55) return pick(moves);
      var caps = moves.filter(function (m) { return pos.board[m[2]][m[3]]; });
      return caps.length ? caps[0] : pick(moves);
    }
    var depth = level === "clever" ? 3 : 2;
    var scored = moves.map(function (m) { return [-negamax(R, R.play(pos, m), depth - 1, -Infinity, Infinity), m]; });
    scored.sort(function (a, b) { return b[0] - a[0]; });
    var top = scored[0][0];
    if (level === "friendly" && top < 900 && rnd() < 0.25 && scored.length > 1) return scored[1][1]; // a small slip now and then
    var near = scored.filter(function (x) { return x[0] >= top - (level === "clever" ? 0.05 : 0.4); });
    return pick(near)[1];
  }
  // the cheapest enemy piece that can capture on (r, c) right now, or null
  function cheapestAttacker(R, pos, r, c, enemy) {
    var p = R.clonePos(pos); p.turn = enemy; p.enPassant = null;
    var best = null;
    R.legalMoves(p).forEach(function (m) {
      if (m[2] === r && m[3] === c) { var a = p.board[m[0]][m[1]]; if (!best || val(a) < val(best)) best = a; }
    });
    return best;
  }
  function defended(R, pos, r, c, color) {
    // is the piece on (r, c) protected? (would its side be able to recapture there)
    var p = R.clonePos(pos), piece = p.board[r][c];
    p.board[r][c] = color === "w" ? "p" : "P"; // pretend an enemy pawn stands there
    p.turn = color; p.enPassant = null;
    var ok = R.legalMoves(p).some(function (m) { return m[2] === r && m[3] === c; });
    p.board[r][c] = piece;
    return ok;
  }
  // would the piece that just moved be lost? { attacker } when the opponent can take it for less than it is
  // worth (or for free), else null
  function hanging(R, pos, r, c) {
    var piece = pos.board[r][c];
    if (!piece || piece.toUpperCase() === "K" || val(piece) < 3) return null;
    var me = R.colorOf(piece), enemy = me === "w" ? "b" : "w";
    var a = cheapestAttacker(R, pos, r, c, enemy);
    if (!a) return null;
    if (val(a) < val(piece) || !defended(R, pos, r, c, me)) return { attacker: a, piece: piece };
    return null;
  }
  // the learner's pieces (worth 3 or more) that the opponent can win right now
  function dangers(R, pos, color) {
    var out = [];
    for (var r = 0; r < 8; r++) for (var c = 0; c < 8; c++) {
      var p = pos.board[r][c];
      if (p && R.colorOf(p) === color) { var h = hanging(R, pos, r, c); if (h) out.push({ r: r, c: c, piece: p, attacker: h.attacker }); }
    }
    return out.sort(function (a, b) { return val(b.piece) - val(a.piece); });
  }

  return { kidAI: kidAI, evaluate: evaluate, hanging: hanging, dangers: dangers,
    position: position, heroMoves: heroMoves, move: move, solve: solve, nextMove: nextMove, finished: finished, stars: stars, pawnAI: pawnAI, pawnWinner: pawnWinner, squares: sqs };
});
