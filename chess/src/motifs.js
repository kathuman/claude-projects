/*
 * motifs.js — names the tactic in a move, using the Lichess puzzle-theme names, so mistakes found in game
 * review ("you allowed a fork", "you missed a back-rank mate") feed the same per-theme profile as puzzles.
 * Browser + Node: ChessMotifs.detect(R, pos, move) -> e.g. ["fork"], ["backRankMate", "mateIn1"], [].
 *
 * Heuristics, deliberately conservative (a false "fork" would send a learner to the wrong practice):
 *   mate          the move mates (backRankMate / smotheredMate when the pattern fits)
 *   fork          the moved piece, safe on its square (or giving check), attacks two or more enemy pieces
 *                 that are each worth more than it or undefended (the king counts)
 *   hangingPiece  the move captures an undefended piece worth 3 or more
 *   pin / skewer  a moved bishop, rook or queen attacks a piece with a more valuable one behind it on the
 *                 same line (pin), or a more valuable piece with a lesser one behind it (skewer)
 *   discoveredAttack / discoveredCheck   moving uncovers a line from another piece to the king or to a
 *                 piece worth 5 or more, or an undefended piece worth 3 or more
 *   promotion     the move promotes
 */
(function (root, factory) {
  if (typeof module !== "undefined" && module.exports) module.exports = factory();
  else root.ChessMotifs = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";
  var VALUE = { P: 1, N: 3, B: 3, R: 5, Q: 9, K: 100 };
  var DIAG = [[-1, -1], [-1, 1], [1, -1], [1, 1]], STRAIGHT = [[-1, 0], [1, 0], [0, -1], [0, 1]];
  function val(p) { return VALUE[p.toUpperCase()]; }
  function other(c) { return c === "w" ? "b" : "w"; }
  function inB(r, c) { return r >= 0 && r < 8 && c >= 0 && c < 8; }

  // enemy pieces a piece on (r, c) attacks
  function targets(R, board, r, c) {
    var me = R.colorOf(board[r][c]);
    return R.attacks(board, r, c).filter(function (s) { var q = board[s[0]][s[1]]; return q && R.colorOf(q) !== me; });
  }
  // what a slider on (r, c) sees along its lines: [first piece square, second piece square] per line
  function rays(board, r, c) {
    var t = board[r][c].toUpperCase(), dirs = t === "B" ? DIAG : t === "R" ? STRAIGHT : t === "Q" ? DIAG.concat(STRAIGHT) : [];
    return dirs.map(function (d) {
      var hits = [], rr = r + d[0], cc = c + d[1];
      while (inB(rr, cc) && hits.length < 2) { if (board[rr][cc]) hits.push([rr, cc]); rr += d[0]; cc += d[1]; }
      return hits;
    });
  }

  function detect(R, pos, move) {
    var out = [], after = R.play(pos, move), b0 = pos.board, b1 = after.board;
    var me = pos.turn, them = other(me), tr = move[2], tc = move[3], mover = b1[tr][tc];
    function add(t) { if (out.indexOf(t) < 0) out.push(t); }

    if (R.isMate(after)) {
      var k = R.kingPos(b1, them), home = them === "w" ? 7 : 0, mt = mover.toUpperCase();
      // back rank: mated on its home rank along that rank, boxed in by its own pieces in front
      if (k[0] === home && (mt === "R" || mt === "Q") && tr === home) {
        var fr = home === 7 ? 6 : 1, own = 0, squares = 0;
        for (var fc = k[1] - 1; fc <= k[1] + 1; fc++) if (inB(fr, fc)) { squares++; if (b1[fr][fc] && R.colorOf(b1[fr][fc]) === them) own++; }
        if (own >= Math.min(2, squares - 1)) add("backRankMate");
      }
      if (mt === "N") {
        var boxed = true;
        for (var dr = -1; dr <= 1; dr++) for (var dc = -1; dc <= 1; dc++) {
          if (!dr && !dc) continue;
          var r2 = k[0] + dr, c2 = k[1] + dc;
          if (inB(r2, c2) && !(b1[r2][c2] && R.colorOf(b1[r2][c2]) === them)) boxed = false;
        }
        if (boxed) add("smotheredMate");
      }
      add("mateIn1");
      return out;
    }
    if (move[4] === "promo") add("promotion");

    // capturing an undefended piece
    var cap = b0[tr][tc];
    if (cap && val(cap) >= 3 && !R.attackedBy(b0, tr, tc, them)) add("hangingPiece");

    // fork
    var check = R.inCheck(after), safe = check || !R.attackedBy(b1, tr, tc, them);
    if (safe && mover.toUpperCase() !== "K") {
      var forked = targets(R, b1, tr, tc).filter(function (s) {
        var q = b1[s[0]][s[1]];
        return q.toUpperCase() === "K" || val(q) > val(mover) || (val(q) >= 3 && !R.attackedBy(b1, s[0], s[1], them));
      });
      if (forked.length >= 2) add("fork");
    }

    // pin and skewer along the moved piece's lines
    rays(b1, tr, tc).forEach(function (h) {
      if (h.length < 2) return;
      var a = b1[h[0][0]][h[0][1]], z = b1[h[1][0]][h[1][1]];
      if (R.colorOf(a) !== them || R.colorOf(z) !== them) return;
      var zt = z.toUpperCase(), at = a.toUpperCase();
      // pin: to the king or queen, and the pinned piece is worth winning (more than the pinner, or loose)
      if (at !== "K" && (zt === "K" || zt === "Q") && val(z) > val(a) && (val(a) > val(mover) || !R.attackedBy(b1, h[0][0], h[0][1], them))) add("pin");
      // skewer: through the king or queen to a piece worth 3 or more behind it
      // (the skewering piece must be safe, and the piece behind worth winning: loose, or worth more)
      else if ((at === "K" || (at === "Q" && val(mover) < 9)) && val(a) > val(z) && val(z) >= 3 && !R.attackedBy(b1, tr, tc, them) &&
        (val(z) > val(mover) || !R.attackedBy(b1, h[1][0], h[1][1], them))) add("skewer");
    });

    // a line opened for another piece
    for (var r = 0; r < 8; r++) for (var c = 0; c < 8; c++) {
      var p = b1[r][c];
      if (!p || R.colorOf(p) !== me || (r === tr && c === tc) || "BRQ".indexOf(p.toUpperCase()) < 0) continue;
      var before = {};
      if (b0[r][c] === p) targets(R, b0, r, c).forEach(function (s) { before[s[0] + "," + s[1]] = true; });
      targets(R, b1, r, c).forEach(function (s) {
        if (before[s[0] + "," + s[1]]) return;
        var q = b1[s[0]][s[1]];
        if (q.toUpperCase() === "K") add("discoveredCheck");
        else if (val(q) >= 5 || (val(q) >= 3 && !R.attackedBy(b1, s[0], s[1], them))) add("discoveredAttack");
      });
    }
    return out;
  }

  // a mate the engine found, as a theme ("mateIn2" …, capped at 5 like Lichess)
  function mateTheme(n) { return "mateIn" + Math.min(5, Math.max(1, Math.abs(n))); }

  return { detect: detect, mateTheme: mateTheme, VALUE: VALUE };
});
