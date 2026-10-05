/*
 * rules.js — the chess rules for the play app (chess/index.html), the course and the tests; browser + Node.
 *
 * Move generation, positions from and to FEN, making moves on a position object, SAN and lenient move
 * input, checkmate/stalemate, the draw rules (repetition keys, insufficient material), PGN in and out,
 * and squares attacked by a piece. tests/rules.test.js checks it by perft against published counts.
 *
 * Board: board[r][c], r = 0 is rank 8, c = 0 is file a; pieces "KQRBNP" white, "kqrbnp" black.
 * A move is [fr, fc, tr, tc, flag, extra]; flag in {null, "double", "ep", "promo", "O-O", "O-O-O"}.
 * A position: { board, turn, castling: {K,Q,k,q}, enPassant: [r,c] | null, halfmove, fullmove }.
 */
(function (root, factory) {
  if (typeof module !== "undefined" && module.exports) module.exports = factory();
  else root.ChessRules = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";
  var FILES = "abcdefgh";
  var KNIGHT_DELTAS = [[-2,-1],[-2,1],[-1,-2],[-1,2],[1,-2],[1,2],[2,-1],[2,1]];
  var DIAG_DIRS = [[-1,-1],[-1,1],[1,-1],[1,1]];
  var STRAIGHT_DIRS = [[-1,0],[1,0],[0,-1],[0,1]];
  var START_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

  function inBounds(r, c) { return r >= 0 && r < 8 && c >= 0 && c < 8; }
  function colorOf(piece) { if (piece == null) return null; return piece === piece.toUpperCase() ? "w" : "b"; }
  function opponent(color) { return color === "w" ? "b" : "w"; }
  function squareName(r, c) { return FILES[c] + (8 - r); }
  function parseSquare(s) { return [8 - Number(s[1]), FILES.indexOf(s[0])]; }
  function cloneBoard(b) { return b.map(function (row) { return row.slice(); }); }

  function kingPos(board, color) {
    var target = color === "w" ? "K" : "k";
    for (var r = 0; r < 8; r++) for (var c = 0; c < 8; c++) if (board[r][c] === target) return [r, c];
    return null;
  }

  function attackedBy(board, r, c, byColor) {
    var knightPiece = byColor === "w" ? "N" : "n";
    for (var i = 0; i < KNIGHT_DELTAS.length; i++) {
      var rr = r + KNIGHT_DELTAS[i][0], cc = c + KNIGHT_DELTAS[i][1];
      if (inBounds(rr, cc) && board[rr][cc] === knightPiece) return true;
    }
    var kingPiece = byColor === "w" ? "K" : "k";
    for (var dr = -1; dr <= 1; dr++) for (var dc = -1; dc <= 1; dc++) {
      if (dr === 0 && dc === 0) continue;
      var r2 = r + dr, c2 = c + dc;
      if (inBounds(r2, c2) && board[r2][c2] === kingPiece) return true;
    }
    var pawnPiece = byColor === "w" ? "P" : "p";
    var pawnDr = byColor === "w" ? 1 : -1;
    for (var pdc = -1; pdc <= 1; pdc += 2) {
      var pr = r + pawnDr, pc = c + pdc;
      if (inBounds(pr, pc) && board[pr][pc] === pawnPiece) return true;
    }
    var bishopLike = byColor === "w" ? "BQ" : "bq";
    for (var d1 = 0; d1 < DIAG_DIRS.length; d1++) {
      var brr = r + DIAG_DIRS[d1][0], bcc = c + DIAG_DIRS[d1][1];
      while (inBounds(brr, bcc)) {
        var p1 = board[brr][bcc];
        if (p1 != null) { if (bishopLike.indexOf(p1) !== -1) return true; break; }
        brr += DIAG_DIRS[d1][0]; bcc += DIAG_DIRS[d1][1];
      }
    }
    var rookLike = byColor === "w" ? "RQ" : "rq";
    for (var d2 = 0; d2 < STRAIGHT_DIRS.length; d2++) {
      var rrr = r + STRAIGHT_DIRS[d2][0], rcc = c + STRAIGHT_DIRS[d2][1];
      while (inBounds(rrr, rcc)) {
        var p2 = board[rrr][rcc];
        if (p2 != null) { if (rookLike.indexOf(p2) !== -1) return true; break; }
        rrr += STRAIGHT_DIRS[d2][0]; rcc += STRAIGHT_DIRS[d2][1];
      }
    }
    return false;
  }

  function pseudoMovesFor(board, r, c, castling, enPassant) {
    var piece = board[r][c];
    if (piece == null) return [];
    var color = colorOf(piece);
    var ptype = piece.toUpperCase();
    var moves = [];
    if (ptype === "P") {
      var dr = color === "w" ? -1 : 1;
      var startRow = color === "w" ? 6 : 1;
      var promoRow = color === "w" ? 0 : 7;
      var rr = r + dr, cc = c;
      if (inBounds(rr, cc) && board[rr][cc] == null) {
        if (rr === promoRow) { ["Q","R","B","N"].forEach(function (pp) { moves.push([r,c,rr,cc,"promo",pp]); }); }
        else moves.push([r, c, rr, cc, null, null]);
        if (r === startRow) {
          var rr2 = r + 2 * dr;
          if (board[rr2][cc] == null) moves.push([r, c, rr2, cc, "double", null]);
        }
      }
      [-1, 1].forEach(function (dc) {
        var rr2 = r + dr, cc2 = c + dc;
        if (!inBounds(rr2, cc2)) return;
        var target = board[rr2][cc2];
        if (target != null && colorOf(target) !== color) {
          if (rr2 === promoRow) { ["Q","R","B","N"].forEach(function (pp) { moves.push([r,c,rr2,cc2,"promo",pp]); }); }
          else moves.push([r, c, rr2, cc2, null, null]);
        } else if (enPassant && enPassant[0] === rr2 && enPassant[1] === cc2) {
          moves.push([r, c, rr2, cc2, "ep", null]);
        }
      });
    } else if (ptype === "N") {
      for (var i = 0; i < KNIGHT_DELTAS.length; i++) {
        var nrr = r + KNIGHT_DELTAS[i][0], ncc = c + KNIGHT_DELTAS[i][1];
        if (inBounds(nrr, ncc)) {
          var nt = board[nrr][ncc];
          if (nt == null || colorOf(nt) !== color) moves.push([r, c, nrr, ncc, null, null]);
        }
      }
    } else if (ptype === "B" || ptype === "R" || ptype === "Q") {
      var dirs = [];
      if (ptype === "B" || ptype === "Q") dirs = dirs.concat(DIAG_DIRS);
      if (ptype === "R" || ptype === "Q") dirs = dirs.concat(STRAIGHT_DIRS);
      for (var d = 0; d < dirs.length; d++) {
        var srr = r + dirs[d][0], scc = c + dirs[d][1];
        while (inBounds(srr, scc)) {
          var st = board[srr][scc];
          if (st == null) moves.push([r, c, srr, scc, null, null]);
          else { if (colorOf(st) !== color) moves.push([r, c, srr, scc, null, null]); break; }
          srr += dirs[d][0]; scc += dirs[d][1];
        }
      }
    } else if (ptype === "K") {
      for (var kdr = -1; kdr <= 1; kdr++) for (var kdc = -1; kdc <= 1; kdc++) {
        if (kdr === 0 && kdc === 0) continue;
        var krr = r + kdr, kcc = c + kdc;
        if (inBounds(krr, kcc)) {
          var kt = board[krr][kcc];
          if (kt == null || colorOf(kt) !== color) moves.push([r, c, krr, kcc, null, null]);
        }
      }
      var row = color === "w" ? 7 : 0;
      if (r === row && c === 4) {
        var kside = color === "w" ? "K" : "k";
        var qside = color === "w" ? "Q" : "q";
        var rook = color === "w" ? "R" : "r";
        var opp = opponent(color);
        if (castling[kside] && board[row][5] == null && board[row][6] == null && board[row][7] === rook) {
          if (!(attackedBy(board, row, 4, opp) || attackedBy(board, row, 5, opp) || attackedBy(board, row, 6, opp))) {
            moves.push([r, c, row, 6, "O-O", null]);
          }
        }
        if (castling[qside] && board[row][1] == null && board[row][2] == null && board[row][3] == null && board[row][0] === rook) {
          if (!(attackedBy(board, row, 4, opp) || attackedBy(board, row, 3, opp) || attackedBy(board, row, 2, opp))) {
            moves.push([r, c, row, 2, "O-O-O", null]);
          }
        }
      }
    }
    return moves;
  }

  function applyMoveTo(board, move, castling) {
    var r = move[0], c = move[1], rr = move[2], cc = move[3], flag = move[4], extra = move[5];
    var piece = board[r][c];
    var color = colorOf(piece);
    if (piece.toUpperCase() === "K") {
      if (color === "w") { castling.K = false; castling.Q = false; } else { castling.k = false; castling.q = false; }
    }
    if (piece.toUpperCase() === "R") {
      if (r === 7 && c === 0) castling.Q = false;
      else if (r === 7 && c === 7) castling.K = false;
      else if (r === 0 && c === 0) castling.q = false;
      else if (r === 0 && c === 7) castling.k = false;
    }
    var captured = board[rr][cc];
    if (captured && captured.toUpperCase() === "R") {
      if (rr === 7 && cc === 0) castling.Q = false;
      else if (rr === 7 && cc === 7) castling.K = false;
      else if (rr === 0 && cc === 0) castling.q = false;
      else if (rr === 0 && cc === 7) castling.k = false;
    }
    board[r][c] = null;
    if (flag === "ep") { board[r][cc] = null; board[rr][cc] = piece; }
    else if (flag === "promo") { board[rr][cc] = color === "w" ? extra : extra.toLowerCase(); }
    else { board[rr][cc] = piece; }
    if (flag === "O-O") { board[r][5] = board[r][7]; board[r][7] = null; }
    else if (flag === "O-O-O") { board[r][3] = board[r][0]; board[r][0] = null; }
  }

  function generateLegalMoves(board, castling, enPassant, color) {
    var legal = [];
    for (var r = 0; r < 8; r++) for (var c = 0; c < 8; c++) {
      var p = board[r][c];
      if (p && colorOf(p) === color) {
        var pm = pseudoMovesFor(board, r, c, castling, enPassant);
        for (var i = 0; i < pm.length; i++) {
          var b2 = cloneBoard(board);
          var cast2 = Object.assign({}, castling);
          applyMoveTo(b2, pm[i], cast2);
          var kp = kingPos(b2, color);
          // (teaching positions may have no king at all: then nothing can be in check)
          if (!kp || !attackedBy(b2, kp[0], kp[1], opponent(color))) legal.push(pm[i]);
        }
      }
    }
    return legal;
  }

  function inCheckBoard(board, color) {
    var kp = kingPos(board, color);
    return kp != null && attackedBy(board, kp[0], kp[1], opponent(color));
  }

  // ---------------------------------------------------------------- positions
  function fromFEN(fen) {
    var parts = fen.trim().split(/\s+/), rows = parts[0].split("/");
    if (rows.length !== 8) throw new Error("FEN needs 8 ranks: " + fen);
    var board = rows.map(function (row) {
      var out = [];
      for (var i = 0; i < row.length; i++) {
        var ch = row[i];
        if (/[1-8]/.test(ch)) for (var k = 0; k < +ch; k++) out.push(null);
        else if (/[kqrbnpKQRBNP]/.test(ch)) out.push(ch);
        else throw new Error("bad FEN character '" + ch + "': " + fen);
      }
      if (out.length !== 8) throw new Error("FEN rank has " + out.length + " squares: " + fen);
      return out;
    });
    var cs = parts[2] || "-";
    return {
      board: board, turn: parts[1] === "b" ? "b" : "w",
      castling: { K: cs.indexOf("K") >= 0, Q: cs.indexOf("Q") >= 0, k: cs.indexOf("k") >= 0, q: cs.indexOf("q") >= 0 },
      enPassant: parts[3] && parts[3] !== "-" ? parseSquare(parts[3]) : null,
      halfmove: +(parts[4] || 0), fullmove: +(parts[5] || 1)
    };
  }
  function toFEN(pos) {
    var rows = pos.board.map(function (row) {
      var s = "", e = 0;
      row.forEach(function (p) { if (p == null) e++; else { if (e) s += e; e = 0; s += p; } });
      return s + (e ? e : "");
    });
    var cs = (pos.castling.K ? "K" : "") + (pos.castling.Q ? "Q" : "") + (pos.castling.k ? "k" : "") + (pos.castling.q ? "q" : "");
    return rows.join("/") + " " + pos.turn + " " + (cs || "-") + " " + (pos.enPassant ? squareName(pos.enPassant[0], pos.enPassant[1]) : "-") + " " + pos.halfmove + " " + pos.fullmove;
  }
  function clonePos(pos) {
    return { board: cloneBoard(pos.board), turn: pos.turn, castling: Object.assign({}, pos.castling), enPassant: pos.enPassant ? pos.enPassant.slice() : null, halfmove: pos.halfmove, fullmove: pos.fullmove };
  }
  function legalMoves(pos) { return generateLegalMoves(pos.board, pos.castling, pos.enPassant, pos.turn); }
  function inCheck(pos) { return inCheckBoard(pos.board, pos.turn); }
  // the position after a move (the input is not changed)
  function play(pos, move) {
    var next = clonePos(pos), piece = pos.board[move[0]][move[1]], capture = pos.board[move[2]][move[3]] != null || move[4] === "ep";
    applyMoveTo(next.board, move, next.castling);
    next.enPassant = move[4] === "double" ? [(move[0] + move[2]) / 2, move[1]] : null;
    next.halfmove = piece.toUpperCase() === "P" || capture ? 0 : pos.halfmove + 1;
    if (pos.turn === "b") next.fullmove = pos.fullmove + 1;
    next.turn = opponent(pos.turn);
    return next;
  }
  function status(pos) {
    var moves = legalMoves(pos), check = inCheck(pos);
    return { check: check, mate: check && moves.length === 0, stalemate: !check && moves.length === 0, moves: moves };
  }
  function isMate(pos) { var s = status(pos); return s.mate; }

  // ---------------------------------------------------------------- notation
  function toSAN(pos, move) {
    var after = play(pos, move), st = status(after);
    var suffix = st.mate ? "#" : (st.check ? "+" : "");
    var r = move[0], c = move[1], rr = move[2], cc = move[3], flag = move[4], extra = move[5];
    if (flag === "O-O") return "O-O" + suffix;
    if (flag === "O-O-O") return "O-O-O" + suffix;
    var board = pos.board, ptype = board[r][c].toUpperCase(), dest = squareName(rr, cc);
    var captured = board[rr][cc] != null || flag === "ep";
    if (ptype === "P") return (captured ? FILES[c] + "x" + dest : dest) + (flag === "promo" ? "=" + extra : "") + suffix;
    var others = legalMoves(pos).filter(function (m) {
      return m[2] === rr && m[3] === cc && !(m[0] === r && m[1] === c) && board[m[0]][m[1]].toUpperCase() === ptype;
    });
    var dis = "";
    if (others.length) {
      var sameFile = others.some(function (m) { return m[1] === c; }), sameRank = others.some(function (m) { return m[0] === r; });
      dis = !sameFile ? FILES[c] : !sameRank ? String(8 - r) : FILES[c] + String(8 - r);
    }
    return ptype + dis + (captured ? "x" : "") + dest + suffix;
  }
  function toUCI(move) { return squareName(move[0], move[1]) + squareName(move[2], move[3]) + (move[4] === "promo" ? move[5].toLowerCase() : ""); }
  // a move given as SAN ("Nf3", "exd5", "O-O", "e8=Q+") or UCI ("g1f3", "e7e8q"); null if not legal
  function findMove(pos, text) {
    var t = String(text).trim().replace(/[+#!?]+$/, "");
    var moves = legalMoves(pos);
    if (/^[a-h][1-8][a-h][1-8][qrbn]?$/.test(t)) {
      return moves.filter(function (m) { return toUCI(m) === t; })[0] || null;
    }
    return moves.filter(function (m) { return toSAN(pos, m).replace(/[+#]$/, "") === t; })[0] || null;
  }
  // A UCI move from a trusted source (the engine's lines, the opening book) turned into a move array
  // without generating every legal move: the flag follows from the pieces. Use findMove for anything typed.
  function fromUCI(pos, uci) {
    var a = parseSquare(uci.slice(0, 2)), b = parseSquare(uci.slice(2, 4)), piece = pos.board[a[0]][a[1]];
    if (!piece) return null;
    var t = piece.toUpperCase(), flag = null, extra = null;
    if (t === "K" && Math.abs(b[1] - a[1]) === 2) flag = b[1] > a[1] ? "O-O" : "O-O-O";
    else if (t === "P" && uci.length > 4) { flag = "promo"; extra = uci[4].toUpperCase(); }
    else if (t === "P" && Math.abs(b[0] - a[0]) === 2) flag = "double";
    else if (t === "P" && a[1] !== b[1] && !pos.board[b[0]][b[1]]) flag = "ep";
    return [a[0], a[1], b[0], b[1], flag, extra];
  }

  // A typed move, read leniently: "nf3", "e2-e4", "0-0", "e8q", "exd5". SAN is tried first; a lowercase
  // "b" is a pawn move when one fits ("bxc3") and otherwise a bishop move. null if nothing legal matches.
  function parseMove(pos, text) {
    var t = String(text).trim().replace(/[+#!?]+$/, "").replace(/0/g, "O").replace(/^o-o(-o)?$/i, function (s) { return s.toUpperCase(); });
    if (!t) return null;
    var u = t.replace(/^([a-h][1-8])[-x:]?([a-h][1-8])=?([qrbnQRBN])?$/, function (_, a, b, p) { return a + b + (p ? p.toLowerCase() : ""); });
    var m = findMove(pos, u);
    if (m) return m;
    var san = t.replace(/^([a-h](?:x[a-h])?[18])=?([qrbnQRBN])$/, function (_, s, p) { return s + "=" + p.toUpperCase(); });
    m = findMove(pos, san);
    if (m) return m;
    if (/^[nrqkb]/.test(san)) return findMove(pos, san[0].toUpperCase() + san.slice(1));
    return null;
  }

  // ---------------------------------------------------------------- draws
  // The position as it counts for repetition: pieces, side to move, castling rights, and the en-passant
  // square only when an en-passant capture is actually legal (FIDE art. 9.2).
  function positionKey(pos) {
    var f = toFEN(pos).split(" ");
    var ep = pos.enPassant && legalMoves(pos).some(function (m) { return m[4] === "ep"; }) ? f[3] : "-";
    return f[0] + " " + f[1] + " " + f[2] + " " + ep;
  }
  // No sequence of legal moves can mate: K v K, K + one minor v K, or only bishops all on one square colour.
  function insufficientMaterial(pos) {
    var minors = [], bishopColours = {};
    for (var r = 0; r < 8; r++) for (var c = 0; c < 8; c++) {
      var p = pos.board[r][c];
      if (!p || p.toUpperCase() === "K") continue;
      if ("PRQprq".indexOf(p) >= 0) return false;
      minors.push(p);
      if (p.toUpperCase() === "B") bishopColours[(r + c) % 2] = true;
    }
    if (minors.length <= 1) return true;
    var onlyBishops = minors.every(function (p) { return p.toUpperCase() === "B"; });
    return onlyBishops && Object.keys(bishopColours).length === 1;
  }
  // Can this side still mate at all? (used when the other side's flag falls: FIDE art. 6.9)
  function canMate(pos, color) {
    var pieces = [];
    for (var r = 0; r < 8; r++) for (var c = 0; c < 8; c++) {
      var p = pos.board[r][c];
      if (p && colorOf(p) === color && p.toUpperCase() !== "K") pieces.push(p.toUpperCase());
    }
    if (!pieces.length) return false;
    if (pieces.length === 1 && (pieces[0] === "B" || pieces[0] === "N")) {
      // a lone minor mates only with help from the opponent's own pieces
      for (var r2 = 0; r2 < 8; r2++) for (var c2 = 0; c2 < 8; c2++) {
        var q = pos.board[r2][c2];
        if (q && colorOf(q) !== color && q.toUpperCase() !== "K") return true;
      }
      return false;
    }
    return true;
  }

  // A FEN that can be played from: parses, one king each, no pawns on the first or last rank, and the side
  // that just moved is not in check. Castling rights that the pieces contradict are dropped.
  // Returns { pos } or { error }.
  function loadFEN(fen) {
    var pos;
    try { pos = fromFEN(fen); } catch (e) { return { error: e.message }; }
    var count = { K: 0, k: 0 };
    for (var r = 0; r < 8; r++) for (var c = 0; c < 8; c++) {
      var p = pos.board[r][c];
      if (p === "K" || p === "k") count[p]++;
      if ((p === "P" || p === "p") && (r === 0 || r === 7)) return { error: "a pawn on the first or last rank" };
    }
    if (count.K !== 1 || count.k !== 1) return { error: "each side needs exactly one king" };
    if (inCheckBoard(pos.board, opponent(pos.turn))) return { error: "the side not to move is in check" };
    var b = pos.board, cs = pos.castling;
    if (b[7][4] !== "K") { cs.K = false; cs.Q = false; }
    if (b[0][4] !== "k") { cs.k = false; cs.q = false; }
    if (b[7][7] !== "R") cs.K = false;
    if (b[7][0] !== "R") cs.Q = false;
    if (b[0][7] !== "r") cs.k = false;
    if (b[0][0] !== "r") cs.q = false;
    if (pos.enPassant) {
      var er = pos.enPassant[0], ec = pos.enPassant[1], pawn = pos.turn === "w" ? "p" : "P";
      var ok = (pos.turn === "w" ? er === 2 : er === 5) && b[pos.turn === "w" ? 3 : 4][ec] === pawn;
      if (!ok) pos.enPassant = null;
    }
    return { pos: pos };
  }

  // ---------------------------------------------------------------- PGN
  // Reads one game. Tags, comments, variations, NAGs and move numbers are understood; the main line is
  // replayed through the rules, so an illegal move is reported with its number.
  // Returns { tags, startFen, moves, sans, result } or { error }.
  function parsePGN(text) {
    var tags = {}, body = String(text).replace(/\r/g, "");
    body = body.replace(/^\s*\[(\w+)\s+"((?:[^"\\]|\\.)*)"\]\s*$/gm, function (_, k, v) { tags[k] = v.replace(/\\(.)/g, "$1"); return ""; });
    body = body.replace(/\{[^}]*\}/g, " ").replace(/;[^\n]*/g, " ");
    var prev;
    do { prev = body; body = body.replace(/\([^()]*\)/g, " "); } while (body !== prev);
    body = body.replace(/\$\d+/g, " ");
    var startFen = tags.FEN || START_FEN, loaded = loadFEN(startFen);
    if (loaded.error) return { error: "the starting position (FEN tag): " + loaded.error };
    var pos = loaded.pos, moves = [], sans = [], result = tags.Result || "*";
    var tokens = body.split(/\s+/).filter(Boolean);
    for (var i = 0; i < tokens.length; i++) {
      var t = tokens[i];
      if (/^(1-0|0-1|1\/2-1\/2|\*)$/.test(t)) { result = t; continue; }
      t = t.replace(/^\d+\.+/, "");
      if (!t || /^\.+$/.test(t)) continue;
      var m = parseMove(pos, t);
      if (!m) {
        return { error: "move " + pos.fullmove + (pos.turn === "w" ? ". " : "... ") + t + " is not legal here" };
      }
      sans.push(toSAN(pos, m));
      moves.push(m);
      pos = play(pos, m);
    }
    return { tags: tags, startFen: startFen, moves: moves, sans: sans, result: result };
  }
  // game: { tags (any extra), startFen, sans, result }. Seven-tag roster first, movetext wrapped at 80.
  function toPGN(game) {
    var start = game.startFen || START_FEN, pos = fromFEN(start), result = game.result || "*";
    var tags = Object.assign({ Event: "Casual game", Site: "?", Date: "????.??.??", Round: "-", White: "?", Black: "?" }, game.tags || {});
    tags.Result = result;
    if (start !== START_FEN) { tags.SetUp = "1"; tags.FEN = start; }
    var order = ["Event", "Site", "Date", "Round", "White", "Black", "Result"];
    Object.keys(tags).forEach(function (k) { if (order.indexOf(k) < 0) order.push(k); });
    var head = order.map(function (k) { return "[" + k + ' "' + String(tags[k]).replace(/(["\\])/g, "\\$1") + '"]'; }).join("\n");
    var words = [], n = pos.fullmove, white = pos.turn === "w";
    game.sans.forEach(function (s, i) {
      if (white) words.push(n + ". " + s);
      else { words.push(i === 0 ? n + "... " + s : s); n++; }
      white = !white;
    });
    words.push(result);
    var lines = [], line = "";
    words.join(" ").split(" ").forEach(function (w) {
      if (line && line.length + 1 + w.length > 80) { lines.push(line); line = w; } else line = line ? line + " " + w : w;
    });
    lines.push(line);
    return head + "\n\n" + lines.join("\n") + "\n";
  }

  // squares a piece on (r, c) attacks (for lessons on piece movement)
  function attacks(board, r, c) {
    var out = [], piece = board[r][c]; if (!piece) return out;
    var color = colorOf(piece);
    for (var rr = 0; rr < 8; rr++) for (var cc = 0; cc < 8; cc++) {
      if (rr === r && cc === c) continue;
      var b = cloneBoard(board); b[rr][cc] = color === "w" ? "p" : "P"; // probe: an enemy piece there
      var pm = pseudoMovesFor(b, r, c, { K: false, Q: false, k: false, q: false }, null);
      if (pm.some(function (m) { return m[2] === rr && m[3] === cc && m[4] !== "double" && !(piece.toUpperCase() === "P" && m[3] === c); })) out.push([rr, cc]);
    }
    return out;
  }
  function perft(pos, depth) {
    if (depth === 0) return 1;
    var moves = legalMoves(pos), n = 0;
    if (depth === 1) return moves.length;
    for (var i = 0; i < moves.length; i++) n += perft(play(pos, moves[i]), depth - 1);
    return n;
  }

  return {
    START_FEN: START_FEN, FILES: FILES, fromFEN: fromFEN, toFEN: toFEN, legalMoves: legalMoves, play: play, status: status,
    inCheck: inCheck, isMate: isMate, toSAN: toSAN, toUCI: toUCI, findMove: findMove, parseMove: parseMove, fromUCI: fromUCI, attacks: attacks, perft: perft,
    squareName: squareName, parseSquare: parseSquare, colorOf: colorOf, attackedBy: attackedBy, kingPos: kingPos,
    positionKey: positionKey, insufficientMaterial: insufficientMaterial, canMate: canMate, loadFEN: loadFEN,
    parsePGN: parsePGN, toPGN: toPGN, clonePos: clonePos
  };
});
