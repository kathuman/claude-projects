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
 *   play     play an ending out against perfect defence (the Lichess tablebase, 7 pieces or fewer):
 *            goal "win" ends in checkmate or in a promotion that keeps the win; goal "draw" holds for
 *            `moves` moves. A move that changes the result is taken back with an explanation.
 *   Options: drill: true marks an opening line; `opening` names it, and the test checks the line
 *            against the Lichess opening catalogue (unless book: false). flip: true shows the board
 *            from Black's side; move and play steps flip by themselves when the learner plays Black.
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
        { id: "castling", practice: "castling", steps: [
          { k: "castling.intro", type: "explain", fen: "4k3/8/8/8/8/8/PPPPPPPP/R3K2R w KQ - 0 1", arrows: "e1g1 h1f1" },
          { k: "castling.short", type: "move", fen: "4k3/8/8/8/8/8/PPPPPPPP/R3K2R w KQ - 0 1", solution: ["O-O"] },
          { k: "castling.long", type: "move", fen: "4k3/8/8/8/8/8/PPPPPPPP/R3K2R w KQ - 0 1", solution: ["O-O-O"] },
          { k: "castling.quiz", type: "quiz", options: 3, answer: 2 }
        ]},
        { id: "enpassant", practice: "enPassant", steps: [
          { k: "enpassant.intro", type: "explain", fen: "4k3/8/8/3pP3/8/8/8/4K3 w - d6 0 1", arrows: "d7d5 e5d6" },
          { k: "enpassant.task", type: "move", fen: "4k3/8/8/3pP3/8/8/8/4K3 w - d6 0 1", solution: ["exd6"] }
        ]},
        { id: "promotion", practice: "promotion", steps: [
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
        { id: "mates", practice: "mateIn1", steps: [
          { k: "mates.queen", type: "move", fen: "7k/8/6K1/8/8/3Q4/8/8 w - - 0 1", goal: "mate", solution: ["Qd8"] },
          { k: "mates.rook", type: "move", fen: "6k1/8/6K1/8/8/8/8/R7 w - - 0 1", goal: "mate", solution: ["Ra8"] },
          { k: "mates.scholar", type: "move", fen: "r1bqkb1r/pppp1ppp/2n2n2/4p2Q/2B1P3/8/PPPP1PPP/RNB1K1NR w KQkq - 4 4", goal: "mate", solution: ["Qxf7"] }
        ]}
      ]},
      { id: "intermediate", lessons: [
        { id: "opening", practice: "opening", steps: [
          { k: "opening.intro", type: "explain", fen: START, marks: "d4 e4 d5 e5" },
          { k: "opening.quiz", type: "quiz", fen: "rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2", options: 3, answer: 0 },
          { k: "opening.develop", type: "move", fen: "r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 2 3", solution: ["Bc4"], accept: ["Bb5", "d4", "Nc3"], engine: "accept" }
        ]},
        { id: "forks", practice: "fork", steps: [
          { k: "forks.knight", type: "move", fen: "r3k3/6pp/8/1N6/8/8/PP6/4K3 w - - 0 1", solution: ["Nc7", "Kd7", "Nxa8"], engine: true },
          { k: "forks.pawn", type: "move", fen: "4k3/pp4pp/8/2r1n3/8/3P4/PP4PP/R3K3 w Q - 0 1", solution: ["d4"], engine: true }
        ]},
        { id: "pins", practice: "pin", steps: [
          { k: "pins.intro", type: "explain", fen: "4k3/8/2n5/1B6/8/8/8/4K3 b - - 0 1", arrows: "b5e8" },
          { k: "pins.task", type: "move", fen: "4k3/8/2n5/8/8/8/8/4KB2 w - - 0 1", solution: ["Bb5"] }
        ]},
        { id: "skewers", practice: "skewer", steps: [
          { k: "skewers.task", type: "move", fen: "8/8/8/8/4k2q/8/8/R1K5 w - - 0 1", solution: ["Ra4", "Kf5", "Rxh4"], engine: true }
        ]},
        { id: "discovered", practice: "discoveredAttack", steps: [
          { k: "discovered.intro", type: "explain", fen: "3q4/8/7k/8/3N4/8/8/3QK3 w - - 0 1", arrows: "d1d8 d4f5" },
          { k: "discovered.task", type: "move", fen: "3q4/8/7k/8/3N4/8/8/3QK3 w - - 0 1", solution: ["Nf5", "Kg6", "Qxd8"], engine: true }
        ]},
        { id: "backrank", practice: "backRankMate", steps: [
          { k: "backrank.task", type: "move", fen: "6k1/5ppp/8/8/8/8/5PPP/3R2K1 w - - 0 1", goal: "mate", solution: ["Rd8"] },
          { k: "backrank.luft", type: "explain", fen: "6k1/5pp1/7p/8/8/7P/5PP1/3R2K1 w - - 0 1", marks: "h6 h3" }
        ]},
        { id: "kqk", practice: "mateIn2", steps: [
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
        { id: "kingpawn", practice: "pawnEndgame", steps: [
          { k: "kingpawn.front", type: "move", fen: "4k3/8/4K3/4P3/8/8/8/8 w - - 0 1", solution: ["Kd6"], accept: ["Kf6"], engine: "accept" },
          { k: "kingpawn.opposition", type: "quiz", fen: "8/8/3k4/8/3K4/3P4/8/8 b - - 0 1", options: 3, answer: 0 }
        ]},
        { id: "square", practice: "pawnEndgame", steps: [
          { k: "square.intro", type: "explain", fen: "7k/8/8/8/1p6/8/5K2/8 w - - 0 1", marks: "b4 c4 d4 e4 b1 c1 d1 e1 e3 e2" },
          { k: "square.task", type: "move", fen: "7k/8/8/8/1p6/8/5K2/8 w - - 0 1", solution: ["Ke2"], accept: ["Ke1", "Ke3"], engine: "accept" }
        ]},
        { id: "defender", practice: "capturingDefender", steps: [
          { k: "defender.intro", type: "explain", fen: "5rk1/5ppp/5n2/6BQ/8/3B4/5PPP/6K1 w - - 0 1", arrows: "f6h7 d3h7 h5h7" },
          { k: "defender.task", type: "move", fen: "5rk1/5ppp/5n2/6BQ/8/3B4/5PPP/6K1 w - - 0 1", solution: ["Bxf6", "gxf6", "Qxh7"], goal: "mate", engine: true }
        ]},
        { id: "openfile", steps: [
          { k: "openfile.task", type: "move", fen: "2r2rk1/pp3ppp/4p3/3p4/3P4/4P3/PP3PPP/R4RK1 w - - 0 1", solution: ["Rfc1"], accept: ["Rac1"] }
        ]}
      ]},
      { id: "advanced", lessons: [
        { id: "calculation", practice: "long", steps: [
          { k: "calculation.method", type: "explain", fen: "3r2k1/5ppp/8/8/8/8/4RPPP/4R1K1 w - - 0 1" },
          { k: "calculation.task", type: "move", fen: "3r2k1/5ppp/8/8/8/8/4RPPP/4R1K1 w - - 0 1", solution: ["Re8", "Rxe8", "Rxe8"], goal: "mate", engine: true }
        ]},
        { id: "lucena", practice: "rookEndgame", steps: [
          { k: "lucena.intro", type: "explain", fen: "1K6/1P2k3/8/8/8/8/2r5/3R4 w - - 0 1", marks: "d1 d2 d3 d4" },
          { k: "lucena.task", type: "move", fen: "1K6/1P2k3/8/8/8/8/2r5/3R4 w - - 0 1", solution: ["Rd4"], engine: "lucena" }
        ]},
        { id: "philidor", practice: "rookEndgame", steps: [
          { k: "philidor.intro", type: "explain", fen: "4k3/8/r7/4PK2/8/8/8/7R w - - 0 1", marks: "a6 b6 c6 d6 e6 f6 g6 h6" },
          { k: "philidor.quiz", type: "quiz", fen: "4k3/8/r7/4PK2/8/8/8/7R w - - 0 1", options: 3, answer: 2 }
        ]},
        { id: "prophylaxis", steps: [
          { k: "prophylaxis.intro", type: "explain", fen: START },
          { k: "prophylaxis.quiz", type: "quiz", options: 3, answer: 1 }
        ]},
        { id: "converting", practice: "crushing", steps: [
          { k: "converting.intro", type: "explain", fen: "4k3/pp3ppp/8/8/8/8/PPR2PPP/4K3 w - - 0 1" },
          { k: "converting.quiz", type: "quiz", options: 3, answer: 0 }
        ]},
        { id: "plan", steps: [
          { k: "plan.intro", type: "explain", fen: START },
          { k: "plan.play", type: "explain", fen: START, link: "../index.html" }
        ]}
      ]},
      // ---- opening courses: the idea, then a drill of the main line (checked against the Lichess catalogue)
      { id: "openings", lessons: [
        { id: "italian", practice: "opening", steps: [
          { k: "italian.intro", type: "explain", fen: "r1bqkbnr/pppp1ppp/2n5/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R b KQkq - 3 3", arrows: "c4f7 c2c3 d2d4" },
          { k: "italian.drill", type: "move", fen: START, drill: true, opening: "Italian Game", solution: ["e4", "e5", "Nf3", "Nc6", "Bc4", "Bc5", "c3", "Nf6", "d3", "d6", "O-O", "O-O"] },
          { k: "italian.quiz", type: "quiz", options: 3, answer: 0 }
        ]},
        { id: "ruylopez", practice: "opening", steps: [
          { k: "ruylopez.intro", type: "explain", fen: "r1bqkbnr/pppp1ppp/2n5/1B2p3/4P3/5N2/PPPP1PPP/RNBQK2R b KQkq - 3 3", arrows: "b5c6 c6e5" },
          { k: "ruylopez.drill", type: "move", fen: START, drill: true, opening: "Ruy Lopez", solution: ["e4", "e5", "Nf3", "Nc6", "Bb5", "a6", "Ba4", "Nf6", "O-O", "Be7", "Re1", "b5", "Bb3", "d6", "c3", "O-O"] },
          { k: "ruylopez.quiz", type: "quiz", options: 3, answer: 0 }
        ]},
        { id: "queensgambit", practice: "opening", steps: [
          { k: "queensgambit.intro", type: "explain", fen: "rnbqkbnr/ppp1pppp/8/3p4/2PP4/8/PP2PPPP/RNBQKBNR b KQkq - 0 2", arrows: "c4d5" },
          { k: "queensgambit.drill", type: "move", fen: START, drill: true, opening: "Queen's Gambit Declined", solution: ["d4", "d5", "c4", "e6", "Nc3", "Nf6", "Bg5", "Be7", "e3", "O-O", "Nf3", "h6", "Bh4", "b6"] },
          { k: "queensgambit.quiz", type: "quiz", options: 3, answer: 0 }
        ]},
        { id: "london", practice: "opening", steps: [
          { k: "london.intro", type: "explain", fen: "rnbqkb1r/ppp1pppp/5n2/3p4/3P1B2/5N2/PPP1PPPP/RN1QKB1R b KQkq - 3 3", marks: "f4 d4 e3 c3" },
          { k: "london.drill", type: "move", fen: START, drill: true, opening: "London System", book: false, solution: ["d4", "d5", "Nf3", "Nf6", "Bf4", "e6", "e3", "c5", "c3", "Nc6", "Nbd2", "Bd6", "Bg3", "O-O", "Bd3"] },
          { k: "london.quiz", type: "quiz", options: 3, answer: 0 }
        ]},
        { id: "sicilian", practice: "opening", steps: [
          { k: "sicilian.intro", type: "explain", flip: true, fen: "rnbqkbnr/pp1ppppp/8/2p5/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2", arrows: "c5d4" },
          { k: "sicilian.drill", type: "move", fen: "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1", drill: true, opening: "Sicilian Defense: Najdorf", solution: ["c5", "Nf3", "d6", "d4", "cxd4", "Nxd4", "Nf6", "Nc3", "a6"] },
          { k: "sicilian.quiz", type: "quiz", options: 3, answer: 0 }
        ]},
        { id: "french", practice: "opening", steps: [
          { k: "french.intro", type: "explain", flip: true, fen: "rnbqkbnr/pppp1ppp/4p3/8/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2", arrows: "d7d5 c7c5", marks: "c8" },
          { k: "french.drill", type: "move", fen: "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1", drill: true, opening: "French Defense", solution: ["e6", "d4", "d5", "Nc3", "Nf6", "Bg5", "Be7", "e5", "Nfd7", "Bxe7", "Qxe7"] },
          { k: "french.quiz", type: "quiz", options: 3, answer: 0 }
        ]},
        { id: "carokann", practice: "opening", steps: [
          { k: "carokann.intro", type: "explain", flip: true, fen: "rnbqkbnr/pp1ppppp/2p5/8/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2", arrows: "d7d5 c8f5" },
          { k: "carokann.drill", type: "move", fen: "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1", drill: true, opening: "Caro-Kann Defense", solution: ["c6", "d4", "d5", "Nc3", "dxe4", "Nxe4", "Bf5", "Ng3", "Bg6", "h4", "h6"] },
          { k: "carokann.quiz", type: "quiz", options: 3, answer: 0 }
        ]},
        { id: "kingsindian", practice: "opening", steps: [
          { k: "kingsindian.intro", type: "explain", flip: true, fen: "rnbqk2r/ppp1ppbp/3p1np1/8/2PPP3/2N5/PP3PPP/R1BQKBNR w KQkq - 0 5", arrows: "g7d4 e7e5 f7f5" },
          { k: "kingsindian.drill", type: "move", fen: "rnbqkbnr/pppppppp/8/8/3P4/8/PPP1PPPP/RNBQKBNR b KQkq - 0 1", drill: true, opening: "King's Indian Defense", solution: ["Nf6", "c4", "g6", "Nc3", "Bg7", "e4", "d6", "Nf3", "O-O", "Be2", "e5"] },
          { k: "kingsindian.quiz", type: "quiz", options: 3, answer: 0 }
        ]}
      ]},
      // ---- middlegame plans; the practical tests are Lichess puzzles (ids in the comments), checked by Stockfish
      { id: "middlegame", lessons: [
        { id: "greekgift", practice: "sacrifice", steps: [
          { k: "greekgift.intro", type: "explain", fen: "r1bq1rk1/pp2nppp/2n1p3/3pP3/1b6/2NB1N2/P2B1PPP/R2QR1K1 w - - 5 12", arrows: "d3h7 f3g5 d1h5" },
          // Lichess puzzle Zd3DT
          { k: "greekgift.task1", type: "move", fen: "r1bq1rk1/ppp1nppp/1bn1p3/3pP3/3P4/P1NB1N2/1PPB1PPP/R2QK2R w KQ - 5 9", solution: ["Bxh7+", "Kxh7", "Ng5+"], engine: true },
          // Lichess puzzle vnssS (from a master game)
          { k: "greekgift.task2", type: "move", fen: "rn3rk1/p2qnppp/bp2p3/2ppP3/3P1P2/P1BB1N2/1PP3PP/R2QK2R w KQ - 5 11", solution: ["Bxh7+", "Kxh7", "Ng5+", "Kg8", "Qh5"], engine: true }
        ]},
        { id: "seventh", practice: "endgame", steps: [
          { k: "seventh.intro", type: "explain", fen: "2r3k1/pR3ppp/8/8/8/8/P4PPP/6K1 w - - 0 1", marks: "a7 f7 g7 h7", arrows: "b7f7" },
          // Lichess puzzle 4L3lu
          { k: "seventh.task", type: "move", fen: "8/pR3pk1/2p3pp/4N3/1P6/6P1/r4n1P/5K2 w - - 0 28", solution: ["Rxf7+", "Kg8", "Rxf2"], engine: true }
        ]},
        { id: "iqp", steps: [
          { k: "iqp.intro", type: "explain", fen: "r1bq1rk1/pp2bppp/2n1pn2/8/3P4/2NB1N2/PP3PPP/R1BQ1RK1 w - - 0 9", marks: "d4 d5 e5 c5" },
          { k: "iqp.quiz", type: "quiz", fen: "r1bq1rk1/pp2bppp/2n1pn2/8/3P4/2NB1N2/PP3PPP/R1BQ1RK1 w - - 0 9", options: 3, answer: 0 },
          { k: "iqp.quiz2", type: "quiz", fen: "r1bq1rk1/pp2bppp/2n1pn2/8/3P4/2NB1N2/PP3PPP/R1BQ1RK1 w - - 0 9", options: 3, answer: 1 }
        ]},
        { id: "badbishop", steps: [
          { k: "badbishop.intro", type: "explain", fen: "4k3/2b5/3p1p2/2pPpPp1/2P1P1P1/8/3N4/4K3 w - - 0 1", marks: "c5 d6 e5 f6 g5" },
          { k: "badbishop.quiz", type: "quiz", fen: "4k3/2b5/3p1p2/2pPpPp1/2P1P1P1/8/3N4/4K3 w - - 0 1", options: 3, answer: 1 }
        ]},
        { id: "minority", steps: [
          { k: "minority.intro", type: "explain", fen: "r1bq1rk1/pp1n1ppp/2p2n2/3p4/3P4/2NBPN2/PPQ2PPP/R3K2R w KQ - 0 10", arrows: "b2b4 b4b5", marks: "c6" },
          { k: "minority.quiz", type: "quiz", fen: "r1bq1rk1/pp1n1ppp/2p2n2/3p4/3P4/2NBPN2/PPQ2PPP/R3K2R w KQ - 0 10", options: 3, answer: 0 }
        ]}
      ]},
      // ---- endgame technique: play the ending out against perfect defence (the Lichess tablebase)
      { id: "endgames", lessons: [
        { id: "playkq", practice: "queenEndgame", steps: [
          { k: "playkq.intro", type: "explain", fen: "8/8/3k4/8/8/8/8/4K2Q w - - 0 1" },
          { k: "playkq.play", type: "play", goal: "win", fen: "8/8/3k4/8/8/8/8/4K2Q w - - 0 1" }
        ]},
        { id: "playkr", practice: "rookEndgame", steps: [
          { k: "playkr.intro", type: "explain", fen: "8/8/4k3/8/8/8/8/R3K3 w - - 0 1", arrows: "a1a5" },
          { k: "playkr.play", type: "play", goal: "win", fen: "8/8/4k3/8/8/8/8/R3K3 w - - 0 1" }
        ]},
        { id: "playkp", practice: "pawnEndgame", steps: [
          { k: "playkp.intro", type: "explain", fen: "4k3/8/4K3/4P3/8/8/8/8 w - - 0 1", marks: "d7 e7 f7" },
          { k: "playkp.play", type: "play", goal: "win", fen: "4k3/8/4K3/4P3/8/8/8/8 w - - 0 1" }
        ]},
        { id: "defendkp", practice: "pawnEndgame", steps: [
          { k: "defendkp.intro", type: "explain", flip: true, fen: "3k4/8/8/3K4/3P4/8/8/8 b - - 0 1" },
          { k: "defendkp.play", type: "play", goal: "draw", moves: 12, fen: "3k4/8/8/3K4/3P4/8/8/8 b - - 0 1" }
        ]},
        { id: "playlucena", practice: "rookEndgame", steps: [
          { k: "playlucena.intro", type: "explain", fen: "1K6/1P2k3/8/8/8/8/2r5/3R4 w - - 0 1", arrows: "d1d4" },
          { k: "playlucena.play", type: "play", goal: "win", fen: "1K6/1P2k3/8/8/8/8/2r5/3R4 w - - 0 1" }
        ]},
        { id: "holdphilidor", practice: "rookEndgame", steps: [
          { k: "holdphilidor.intro", type: "explain", flip: true, fen: "4k3/8/r7/4PK2/8/8/8/7R b - - 0 1", marks: "a6 b6 c6 d6 e6 f6 g6 h6" },
          { k: "holdphilidor.play", type: "play", goal: "draw", moves: 15, fen: "4k3/8/r7/4PK2/8/8/8/7R b - - 0 1" }
        ]}
      ]}
    ]
  };
})(typeof self !== "undefined" ? self : this);
