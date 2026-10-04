/*
 * course.js — the chess course as data: five levels of lessons, each a list of steps. All wording lives
 * in i18n/<lang>.js under the step's key `k` (k, k.hint, k.ok, k.o1… for quiz options), so lessons
 * and translations stay independent. tests/course.test.js checks every position and solution.
 *
 * Step types
 *   explain  a position to look at (marks: highlighted squares, arrows: "e2e4 g1f3")
 *   click    click a named square (target)
 *   squares  click every square the piece on `from` can move to (computed from the rules)
 *   move     play the solution: `solution` is a line of SAN moves, the learner plays the 1st, 3rd…
 *            and the course replies with the 2nd, 4th…; `accept` lists other correct first moves;
 *            goal "mate" accepts any mating move at the learner's last turn, "any" any legal move.
 *            engine: true → the test checks the first move against Stockfish.
 *   quiz     choose an answer (options: number of choices, answer: index of the correct one)
 */
(function (root) {
  "use strict";
  var EMPTY = "8/8/8/8/8/8/8/8 w - - 0 1";
  var START = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
  root.CHESS_COURSE = {
    levels: [
      { id: "beginner", lessons: [
        { id: "board", steps: [
          { k: "board.intro", type: "explain", fen: START, marks: "a1 h1 a8 h8" },
          { k: "board.coords", type: "explain", fen: EMPTY, marks: "e4", arrows: "e1e4 a4e4" },
          { k: "board.clickE4", type: "click", fen: EMPTY, target: "e4" },
          { k: "board.clickH1", type: "click", fen: EMPTY, target: "h1" },
          { k: "board.quiz", type: "quiz", options: 3, answer: 1 }
        ]},
        { id: "setup", steps: [
          { k: "setup.pieces", type: "explain", fen: START },
          { k: "setup.queen", type: "explain", fen: START, marks: "d1 d8" },
          { k: "setup.quiz", type: "quiz", fen: START, options: 3, answer: 0 }
        ]},
        { id: "rook", steps: [
          { k: "rook.intro", type: "explain", fen: "8/8/8/8/3R4/8/8/8 w - - 0 1", arrows: "d4d8 d4d1 d4a4 d4h4" },
          { k: "rook.squares", type: "squares", fen: "8/8/8/8/3R4/8/8/8 w - - 0 1", from: "d4" },
          { k: "rook.blocked", type: "squares", fen: "8/8/3p4/8/1P1R2p1/8/8/8 w - - 0 1", from: "d4" },
          { k: "rook.capture", type: "move", fen: "8/1p6/8/8/1R6/8/8/8 w - - 0 1", solution: ["Rxb7"] }
        ]},
        { id: "bishop", steps: [
          { k: "bishop.intro", type: "explain", fen: "8/8/8/8/3B4/8/8/8 w - - 0 1", arrows: "d4h8 d4a7 d4a1 d4g1" },
          { k: "bishop.squares", type: "squares", fen: "8/8/8/8/3B4/8/8/8 w - - 0 1", from: "d4" },
          { k: "bishop.capture", type: "move", fen: "8/8/5n2/8/3B4/8/8/8 w - - 0 1", solution: ["Bxf6"] }
        ]},
        { id: "queen", steps: [
          { k: "queen.intro", type: "explain", fen: "8/8/8/8/3Q4/8/8/8 w - - 0 1", arrows: "d4d8 d4h8 d4h4 d4g1 d4d1 d4a1 d4a4 d4a7" },
          { k: "queen.squares", type: "squares", fen: "8/8/8/8/3Q4/8/8/8 w - - 0 1", from: "d4" },
          { k: "queen.capture", type: "move", fen: "3r4/8/8/8/7Q/8/8/8 w - - 0 1", solution: ["Qxd8"] }
        ]},
        { id: "knight", steps: [
          { k: "knight.intro", type: "explain", fen: "8/8/8/8/3N4/8/8/8 w - - 0 1", marks: "b5 b3 c6 c2 e6 e2 f5 f3" },
          { k: "knight.squares", type: "squares", fen: "8/8/8/8/3N4/8/8/8 w - - 0 1", from: "d4" },
          { k: "knight.jump", type: "squares", fen: "8/8/8/2ppp3/2pNp3/2ppp3/8/8 w - - 0 1", from: "d4" },
          { k: "knight.capture", type: "move", fen: "8/8/8/8/8/5b2/8/4N3 w - - 0 1", solution: ["Nxf3"] }
        ]},
        { id: "king", steps: [
          { k: "king.intro", type: "explain", fen: "8/8/8/8/4K3/8/8/8 w - - 0 1", marks: "d5 e5 f5 d4 f4 d3 e3 f3" },
          { k: "king.squares", type: "squares", fen: "8/8/8/8/4K3/8/8/8 w - - 0 1", from: "e4" },
          { k: "king.safe", type: "squares", fen: "8/8/8/3r4/8/4K3/8/8 w - - 0 1", from: "e3" }
        ]},
        { id: "pawn", steps: [
          { k: "pawn.intro", type: "explain", fen: "8/8/8/8/8/8/4P3/8 w - - 0 1", arrows: "e2e3 e2e4" },
          { k: "pawn.first", type: "squares", fen: "8/8/8/8/8/8/4P3/8 w - - 0 1", from: "e2" },
          { k: "pawn.capture", type: "squares", fen: "8/8/8/3p1p2/4P3/8/8/8 w - - 0 1", from: "e4" },
          { k: "pawn.blocked", type: "quiz", fen: "8/8/8/4p3/4P3/8/8/8 w - - 0 1", options: 3, answer: 1 }
        ]},
        { id: "check", steps: [
          { k: "check.intro", type: "explain", fen: "4r2k/8/8/8/8/8/8/4K2R w - - 0 1", arrows: "e8e1" },
          { k: "check.escape", type: "move", fen: "4r2k/8/8/8/8/8/8/4K2R w - - 0 1", goal: "any", solution: ["Kd2"] },
          { k: "check.mate", type: "explain", fen: "R5k1/5ppp/8/8/8/8/8/6K1 b - - 0 1", arrows: "a8g8" },
          { k: "check.mateTask", type: "move", fen: "6k1/5ppp/8/8/8/8/8/R5K1 w - - 0 1", goal: "mate", solution: ["Ra8"] }
        ]}
      ]},
      { id: "basic", lessons: [
        { id: "castling", steps: [
          { k: "castling.intro", type: "explain", fen: "4k3/8/8/8/8/8/PPPPPPPP/R3K2R w KQ - 0 1", arrows: "e1g1 h1f1" },
          { k: "castling.short", type: "move", fen: "4k3/8/8/8/8/8/PPPPPPPP/R3K2R w KQ - 0 1", solution: ["O-O"] },
          { k: "castling.long", type: "move", fen: "4k3/8/8/8/8/8/PPPPPPPP/R3K2R w KQ - 0 1", solution: ["O-O-O"] },
          { k: "castling.quiz", type: "quiz", options: 3, answer: 2 }
        ]},
        { id: "enpassant", steps: [
          { k: "enpassant.intro", type: "explain", fen: "4k3/8/8/3pP3/8/8/8/4K3 w - d6 0 1", arrows: "d7d5 e5d6" },
          { k: "enpassant.task", type: "move", fen: "4k3/8/8/3pP3/8/8/8/4K3 w - d6 0 1", solution: ["exd6"] }
        ]},
        { id: "promotion", steps: [
          { k: "promotion.intro", type: "explain", fen: "4k3/1P6/8/8/8/8/8/4K3 w - - 0 1", arrows: "b7b8" },
          { k: "promotion.task", type: "move", fen: "4k3/1P6/8/8/8/8/8/4K3 w - - 0 1", solution: ["b8=Q"] }
        ]},
        { id: "draws", steps: [
          { k: "draws.stalemate", type: "quiz", fen: "7k/5Q2/6K1/8/8/8/8/8 b - - 0 1", options: 3, answer: 1 },
          { k: "draws.others", type: "explain", fen: "8/8/4k3/8/8/3K4/8/8 w - - 0 1" },
          { k: "draws.avoid", type: "move", fen: "7k/8/5QK1/8/8/8/8/8 w - - 0 1", goal: "mate", solution: ["Qf8"] }
        ]},
        { id: "values", steps: [
          { k: "values.intro", type: "explain", fen: "8/8/8/8/8/8/8/QRBNP3 w - - 0 1" },
          { k: "values.quiz", type: "quiz", options: 3, answer: 0 },
          { k: "values.hanging", type: "move", fen: "4k3/8/2p5/3r4/n7/8/8/3QK3 w - - 0 1", solution: ["Qxa4"], engine: true }
        ]},
        { id: "notation", steps: [
          { k: "notation.intro", type: "explain", fen: "rnbqkbnr/pppppppp/8/8/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 0 1", marks: "e4 f3" },
          { k: "notation.quiz1", type: "quiz", options: 3, answer: 0 },
          { k: "notation.quiz2", type: "quiz", options: 3, answer: 1 }
        ]},
        { id: "mates", steps: [
          { k: "mates.queen", type: "move", fen: "7k/8/6K1/8/8/3Q4/8/8 w - - 0 1", goal: "mate", solution: ["Qd8"] },
          { k: "mates.rook", type: "move", fen: "6k1/8/6K1/8/8/8/8/R7 w - - 0 1", goal: "mate", solution: ["Ra8"] },
          { k: "mates.scholar", type: "move", fen: "r1bqkb1r/pppp1ppp/2n2n2/4p2Q/2B1P3/8/PPPP1PPP/RNB1K1NR w KQkq - 4 4", goal: "mate", solution: ["Qxf7"] }
        ]}
      ]},
      { id: "intermediate", lessons: [
        { id: "opening", steps: [
          { k: "opening.intro", type: "explain", fen: START, marks: "d4 e4 d5 e5" },
          { k: "opening.quiz", type: "quiz", fen: "rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2", options: 3, answer: 0 },
          { k: "opening.develop", type: "move", fen: "r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 2 3", solution: ["Bc4"], accept: ["Bb5", "d4", "Nc3"], engine: "accept" }
        ]},
        { id: "forks", steps: [
          { k: "forks.knight", type: "move", fen: "r3k3/6pp/8/1N6/8/8/PP6/4K3 w - - 0 1", solution: ["Nc7", "Kd7", "Nxa8"], engine: true },
          { k: "forks.pawn", type: "move", fen: "4k3/pp4pp/8/2r1n3/8/3P4/PP4PP/R3K3 w Q - 0 1", solution: ["d4"], engine: true }
        ]},
        { id: "pins", steps: [
          { k: "pins.intro", type: "explain", fen: "4k3/8/2n5/1B6/8/8/8/4K3 b - - 0 1", arrows: "b5e8" },
          { k: "pins.task", type: "move", fen: "4k3/8/2n5/8/8/8/8/4KB2 w - - 0 1", solution: ["Bb5"] }
        ]},
        { id: "skewers", steps: [
          { k: "skewers.task", type: "move", fen: "8/8/8/8/4k2q/8/8/R1K5 w - - 0 1", solution: ["Ra4", "Kf5", "Rxh4"], engine: true }
        ]},
        { id: "discovered", steps: [
          { k: "discovered.intro", type: "explain", fen: "3q4/8/7k/8/3N4/8/8/3QK3 w - - 0 1", arrows: "d1d8 d4f5" },
          { k: "discovered.task", type: "move", fen: "3q4/8/7k/8/3N4/8/8/3QK3 w - - 0 1", solution: ["Nf5", "Kg6", "Qxd8"], engine: true }
        ]},
        { id: "backrank", steps: [
          { k: "backrank.task", type: "move", fen: "6k1/5ppp/8/8/8/8/5PPP/3R2K1 w - - 0 1", goal: "mate", solution: ["Rd8"] },
          { k: "backrank.luft", type: "explain", fen: "6k1/5pp1/7p/8/8/7P/5PP1/3R2K1 w - - 0 1", marks: "h6 h3" }
        ]},
        { id: "kqk", steps: [
          { k: "kqk.method", type: "explain", fen: "8/8/8/3k4/8/8/2Q5/2K5 w - - 0 1", marks: "c6 c5 c4 c3" },
          { k: "kqk.task", type: "move", fen: "k7/7Q/1K6/8/8/8/8/8 w - - 0 1", goal: "mate", solution: ["Qb7"] }
        ]}
      ]},
      { id: "upper", lessons: [
        { id: "structure", steps: [
          { k: "structure.intro", type: "explain", fen: "4k3/pp4pp/8/3P4/8/2P5/P1P3PP/4K3 w - - 0 1", marks: "d5 c2 c3" },
          { k: "structure.quiz", type: "quiz", fen: "4k3/pp4pp/8/3P4/8/2P5/P1P3PP/4K3 w - - 0 1", options: 3, answer: 0 }
        ]},
        { id: "outposts", steps: [
          { k: "outposts.intro", type: "explain", fen: "r4rk1/pp3ppp/3p4/2pN4/2P1P3/8/PP3PPP/R4RK1 w - - 0 1", marks: "d5" },
          { k: "outposts.quiz", type: "quiz", options: 3, answer: 1 }
        ]},
        { id: "kingpawn", steps: [
          { k: "kingpawn.front", type: "move", fen: "4k3/8/4K3/4P3/8/8/8/8 w - - 0 1", solution: ["Kd6"], accept: ["Kf6"], engine: "accept" },
          { k: "kingpawn.opposition", type: "quiz", fen: "8/8/3k4/8/3K4/3P4/8/8 b - - 0 1", options: 3, answer: 0 }
        ]},
        { id: "square", steps: [
          { k: "square.intro", type: "explain", fen: "7k/8/8/8/1p6/8/5K2/8 w - - 0 1", marks: "b4 c4 d4 e4 b1 c1 d1 e1 e3 e2" },
          { k: "square.task", type: "move", fen: "7k/8/8/8/1p6/8/5K2/8 w - - 0 1", solution: ["Ke2"], accept: ["Ke1", "Ke3"], engine: "accept" }
        ]},
        { id: "defender", steps: [
          { k: "defender.intro", type: "explain", fen: "5rk1/5ppp/5n2/6BQ/8/3B4/5PPP/6K1 w - - 0 1", arrows: "f6h7 d3h7 h5h7" },
          { k: "defender.task", type: "move", fen: "5rk1/5ppp/5n2/6BQ/8/3B4/5PPP/6K1 w - - 0 1", solution: ["Bxf6", "gxf6", "Qxh7"], goal: "mate", engine: true }
        ]},
        { id: "openfile", steps: [
          { k: "openfile.task", type: "move", fen: "2r2rk1/pp3ppp/4p3/3p4/3P4/4P3/PP3PPP/R4RK1 w - - 0 1", solution: ["Rfc1"], accept: ["Rac1"] }
        ]}
      ]},
      { id: "advanced", lessons: [
        { id: "calculation", steps: [
          { k: "calculation.method", type: "explain", fen: "3r2k1/5ppp/8/8/8/8/4RPPP/4R1K1 w - - 0 1" },
          { k: "calculation.task", type: "move", fen: "3r2k1/5ppp/8/8/8/8/4RPPP/4R1K1 w - - 0 1", solution: ["Re8", "Rxe8", "Rxe8"], goal: "mate", engine: true }
        ]},
        { id: "lucena", steps: [
          { k: "lucena.intro", type: "explain", fen: "1K6/1P2k3/8/8/8/8/2r5/3R4 w - - 0 1", marks: "d1 d2 d3 d4" },
          { k: "lucena.task", type: "move", fen: "1K6/1P2k3/8/8/8/8/2r5/3R4 w - - 0 1", solution: ["Rd4"], engine: "lucena" }
        ]},
        { id: "philidor", steps: [
          { k: "philidor.intro", type: "explain", fen: "4k3/8/r7/4PK2/8/8/8/7R w - - 0 1", marks: "a6 b6 c6 d6 e6 f6 g6 h6" },
          { k: "philidor.quiz", type: "quiz", fen: "4k3/8/r7/4PK2/8/8/8/7R w - - 0 1", options: 3, answer: 2 }
        ]},
        { id: "prophylaxis", steps: [
          { k: "prophylaxis.intro", type: "explain", fen: START },
          { k: "prophylaxis.quiz", type: "quiz", options: 3, answer: 1 }
        ]},
        { id: "converting", steps: [
          { k: "converting.intro", type: "explain", fen: "4k3/pp3ppp/8/8/8/8/PPR2PPP/4K3 w - - 0 1" },
          { k: "converting.quiz", type: "quiz", options: 3, answer: 0 }
        ]},
        { id: "plan", steps: [
          { k: "plan.intro", type: "explain", fen: START },
          { k: "plan.play", type: "explain", fen: START, link: "../index.html" }
        ]}
      ]}
    ]
  };
})(typeof self !== "undefined" ? self : this);
