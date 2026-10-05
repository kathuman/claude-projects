/*
 * openings.js — opening names and book moves, from lichess-org/chess-openings (CC0; src/openings-data.js).
 *
 * Positions are matched by placement, side to move and castling rights (en passant left out), so a
 * transposition gets its name whatever the move order. Browser + Node:
 *   var book = ChessOpenings.create(ChessRules, CHESS_OPENINGS_DATA);
 *   book.lookup(pos)        -> { eco, name } or null
 *   book.opening(positions) -> the last named position of a game (its opening), or null
 *   book.moves(pos)         -> [{ uci, lines, name }] known continuations, most lines first
 */
(function (root, factory) {
  if (typeof module !== "undefined" && module.exports) module.exports = factory();
  else root.ChessOpenings = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";
  function create(R, data) {
    function key(pos) { var f = R.toFEN(pos).split(" "); return f[0] + " " + f[1] + " " + f[2]; }
    var named = {}, book = {}, start = R.fromFEN(R.START_FEN);
    data.split("\n").forEach(function (line) {
      var p = line.split("\t"), ucis = p[2] ? p[2].split(" ") : [], pos = start;
      for (var i = 0; i < ucis.length; i++) {
        var k = key(pos), b = book[k] || (book[k] = {});
        b[ucis[i]] = (b[ucis[i]] || 0) + 1;
        pos = R.play(pos, R.fromUCI(pos, ucis[i]));
      }
      var end = key(pos);
      // a position reached by several lines keeps the shortest line's name (the most general one)
      if (!named[end] || ucis.length < named[end].ply) named[end] = { eco: p[0], name: p[1], ply: ucis.length };
    });
    function lookup(pos) { var n = named[key(pos)]; return n ? { eco: n.eco, name: n.name } : null; }
    return {
      size: Object.keys(named).length,
      lookup: lookup,
      opening: function (positions) {
        for (var i = positions.length - 1; i >= 0; i--) { var n = lookup(positions[i]); if (n) return n; }
        return null;
      },
      moves: function (pos) {
        var b = book[key(pos)] || {};
        return Object.keys(b).map(function (u) {
          return { uci: u, lines: b[u], name: lookup(R.play(pos, R.fromUCI(pos, u))) };
        }).sort(function (x, y) { return y.lines - x.lines; });
      },
      inBook: function (pos, uci) { var b = book[key(pos)]; return !!(b && b[uci]); }
    };
  }
  return { create: create };
});
