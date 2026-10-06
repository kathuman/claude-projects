/*
 * levels.js — the worlds and levels of "Chess for kids". `par` is the fewest moves (three stars); the test
 * (tests/kids.test.js) recomputes every par by search, so each level is solvable and three stars are
 * always possible. Checkmate levels are Lichess puzzles (CC0, ids noted) with exactly one mating move.
 *
 * types: stars (collect every star), capture (take every sleepy black piece), escape (bring the king to the
 * flag without stepping onto a guarded square), promote (walk the pawn to the end), mate (find mate in one),
 * pawnwars (a pawns-only game against the computer).
 */
(function (root) {
  "use strict";
  root.CHESS_KIDS = {
    worlds: [
      { id: "rook", piece: "R", levels: [
        { id: "rook1", type: "stars", piece: "R", from: "a1", stars: "a6 f6", par: 2 },
        { id: "rook2", type: "stars", piece: "R", from: "a1", stars: "a8 h8 h1", rocks: "d1", par: 3 },
        { id: "rook3", type: "stars", piece: "R", from: "d4", stars: "b7 g2 g7", rocks: "d6 f4 b4", par: 4 }
      ]},
      { id: "bishop", piece: "B", levels: [
        { id: "bishop1", type: "stars", piece: "B", from: "c1", stars: "h6 e3", par: 2 },
        { id: "bishop2", type: "stars", piece: "B", from: "d4", stars: "a1 h8 g1", par: 4 },
        { id: "bishop3", type: "stars", piece: "B", from: "f1", stars: "a6 c8 h5", rocks: "e2", par: 6 }
      ]},
      { id: "queen", piece: "Q", levels: [
        { id: "queen1", type: "stars", piece: "Q", from: "d1", stars: "d8 h4 a4", par: 3 },
        { id: "queen2", type: "stars", piece: "Q", from: "a1", stars: "h8 b7 g2 e5", rocks: "d4 c3", par: 6 }
      ]},
      { id: "king", piece: "K", levels: [
        { id: "king1", type: "stars", piece: "K", from: "e1", stars: "e3 f4 d4", par: 5 },
        { id: "king2", type: "escape", piece: "K", from: "e1", flag: "e8", enemies: "r:a4 b:h6", rocks: "c4", par: 7 }
      ]},
      { id: "knight", piece: "N", levels: [
        { id: "knight1", type: "stars", piece: "N", from: "b1", stars: "c3 d5", par: 2 },
        { id: "knight2", type: "stars", piece: "N", from: "g1", stars: "f3 e5 g6 h8", par: 4 },
        { id: "knight3", type: "stars", piece: "N", from: "a1", stars: "b3 c5 e6 h8", rocks: "c2 b2", par: 6 }
      ]},
      { id: "pawn", piece: "P", levels: [
        { id: "pawn1", type: "promote", piece: "P", from: "e2", par: 5 },
        { id: "pawn2", type: "promote", piece: "P", from: "b2", enemies: "p:b4 n:c3", par: 6 },
        { id: "pawnwars", type: "pawnwars", fen: "8/pppppppp/8/8/8/8/PPPPPPPP/8 w - - 0 1" }
      ]},
      { id: "capture", piece: "N", levels: [
        { id: "capture1", type: "capture", piece: "R", from: "a1", enemies: "p:a5 n:e5 b:e8", par: 3 },
        { id: "capture2", type: "capture", piece: "B", from: "c1", enemies: "p:f4 n:d6 r:b8", par: 3 },
        { id: "capture3", type: "capture", piece: "N", from: "b1", enemies: "p:c3 p:e4 b:f6 q:g8", par: 4 },
        { id: "capture4", type: "capture", piece: "Q", from: "d1", enemies: "p:d7 n:h5 b:a4 r:a8 r:h1", rocks: "d4", par: 5 }
      ]},
      { id: "mate", piece: "Q", levels: [
        { id: "mate1", type: "mate", fen: "8/rR6/8/8/k1K5/8/8/8 w - - 0 68", solution: "b7a7" },        // Lichess ACdC3
        { id: "mate2", type: "mate", fen: "R7/8/8/8/8/6p1/1r5k/5K2 w - - 0 64", solution: "a8h8" },      // TFSs3
        { id: "mate3", type: "mate", fen: "5k2/8/5PK1/8/5r1p/8/R7/8 w - - 4 57", solution: "a2a8" },    // Ut518
        { id: "mate4", type: "mate", fen: "1k6/nBn5/1K6/8/8/6B1/8/8 w - - 0 50", solution: "g3c7" },    // KcKrJ
        { id: "mate5", type: "mate", fen: "8/5p1p/4b1k1/1Q6/5K2/r7/8/8 w - - 0 45", solution: "b5g5" }, // qUg3u
        { id: "mate6", type: "mate", fen: "6k1/8/4KB2/7R/8/4prr1/8/8 w - - 1 62", solution: "h5h8" }    // 0virU
      ]}
    ]
  };
})(typeof self !== "undefined" ? self : this);
