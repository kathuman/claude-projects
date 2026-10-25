# Chess

Chess in the browser, against a friend or Stockfish, with a coach, game review, puzzles, a course and a kids' mode.

**Live:** https://kathuman.github.io/claude-projects/chess/ · version 1.9.2

## The pages

| Page | What it is | Version |
|---|---|---|
| [Play](https://kathuman.github.io/claude-projects/chess/) (this folder) | the game: friend or Stockfish, coach, review, analysis | 1.9.2 |
| [Learn chess](course/) | a course in eight levels, 54 lessons, six languages | 1.6.0 |
| [Puzzles](puzzles/) | 44,943 Lichess puzzles with a personal Glicko-2 rating | 1.2.0 |
| [My training](train/) | the learner's dashboard and weekly plan | 1.1.0 |
| [Chess for kids](kids/) | eight little worlds for young children, read aloud | 1.1.0 |

Each sub-page has its own README.

## Play

- **Opponents:** a friend on the same screen, or [Stockfish](https://stockfishchess.org) 18 at eight strengths
  (1, Beginner, to 8, the engine's full strength), playing either colour. Strength and side can change mid-game.
- **The full rules:**
  - castling, en passant and promotion to any piece;
  - check, checkmate and stalemate;
  - automatic draws by threefold repetition, the 50-move rule and insufficient material.
- **Resign and draw offers.** Against Stockfish, a draw offer is accepted only when the engine isn't better.
- **Clocks** from bullet (1 min) to classical (30 min + 20 s), with increments. A flag fall is a draw when the other
  side cannot mate.
- **Typed moves** in algebraic notation (`e4`, `Nf3`, `O-O`, `e8=Q`) or from-and-to squares (`e2e4`).
- **The coach** (against Stockfish) checks each move before it is played. It warns before a mistake and names the
  tactic it allows, then lets you take the move back, see why, or play it anyway. It also gives hints and shows the
  opponent's threats. "On" warns before mistakes; "Light" warns before blunders and gives three hints a game. It
  steps back on its own when it is hardly needed.
- **Game review:** Stockfish goes through the finished game on your device. You get:
  - a graph of the winning chances and an accuracy score for each side;
  - every move graded (inaccuracy, mistake, blunder, book);
  - key moments with the better move, and a retry to find it yourself.
- **Analysis:** Stockfish's three best lines, the opening's name and book moves, and with seven pieces or fewer the
  [Lichess tablebase](https://tablebase.lichess.ovh) result with perfect play.
- **Your training profile.** Reviewed games feed it: every mistake is labelled with the tactic it allowed or missed
  and comes back as a puzzle in spaced repetition.
- **Save and share:** copy or download PGN, copy FEN, copy a link that replays the game. Load a pasted PGN or FEN.
  Links accept `?fen=`, `?moves=`, `?pgn=` and `&opponent=engine`; the course uses them for its "Play this position
  against Stockfish" buttons.
- **Look:**
  - seven board colours;
  - classic glyph pieces or Staunton pieces (a detailed SVG set in 2D, modelled pieces in 3D);
  - a 3D view you can tilt and turn;
  - light and dark themes.

The page's own "How to play" and "How the code is built" sections explain each feature in detail.

## How it works

- **Rules.** The chess rules live in one shared module, `src/rules.js`: pure functions over an 8×8 array of piece
  letters. The play page, the course, the puzzles, the kids' mode and the tests all use it. Move generation is
  checked by perft against the published counts.
- **Engine.** Stockfish is the lite, single-threaded WebAssembly build, run in a Web Worker over UCI and loaded only
  when needed. Its moves are checked against the page's own list of legal moves. A second engine worker handles
  review, analysis and the coach.
- **Review grading** (`src/review.js`) follows Lichess: a move's grade depends on how much it lowers the mover's
  winning chances, and accuracy uses Lichess's per-move formula.
- **Tactic names** (`src/motifs.js`) are tuned against Lichess-labelled puzzles.
- **The learner profile** (`src/profile.js`) is kept in the browser: results, themes, spaced repetition and the
  weekly plan.
- **Opening names** come from the CC0 [Lichess opening catalogue](https://github.com/lichess-org/chess-openings),
  built into `src/openings-data.js`.
- **The 3D view** turns the same board with CSS 3D transforms. The modelled Staunton set is drawn with three.js.

The page began as a port of a Python/Tkinter two-player game, kept here as `chess_game.py` for reference.

## Files

```
index.html          the play page
theme.css           the shared look (dark by default), linked by every chess page
src/                rules, review grading, tactic motifs, openings, puzzles, learner profile, kids' helpers
course/  puzzles/  train/  kids/   the other pages (each with a README)
engine/             Stockfish 18 lite single-threaded WASM (GPL v3, see engine/README.md)
pieces/cburnett/    Staunton piece SVGs (Cburnett, Wikimedia Commons)
vendor/three.min.js three.js, for the modelled 3D pieces (MIT, see vendor/THREE-LICENSE)
tests/              node test scripts, plus the builders for the openings and puzzle data
chess_game.py       the original Python/Tkinter game
```

## Tests

```bash
node chess/tests/rules.test.js      # 47 checks: move generation, perft, draws, notation, PGN/FEN
node chess/tests/course.test.js     # 284 checks: every lesson, solution and opening drill
node chess/tests/review.test.js     # 21 checks: grading and accuracy
node chess/tests/puzzles.test.js    # 24 checks: the puzzle data and Glicko-2 ratings
node chess/tests/profile.test.js    # 34 checks: the learner profile and weekly plan
node chess/tests/kids.test.js       # 88 checks: every kids' level is solvable, the kids' computer players
```

498 checks in all, run on every change by the `chess-ci.yml` workflow. With `CHROME` set, the course test also checks
its puzzles against Stockfish.

## Credits

- Stockfish (GPL v3), through [stockfish.js](https://github.com/nmrugg/stockfish.js).
- The [Lichess](https://lichess.org) puzzle database and opening catalogue (CC0), and the Lichess tablebase.
- Cburnett's piece set (Wikimedia Commons).
- [three.js](https://threejs.org) (MIT).

Built with [Claude](https://claude.com). Part of [AI Projects](https://kathuman.github.io/claude-projects/).
