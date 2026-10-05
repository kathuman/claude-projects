# Chess puzzles

Puzzle training for the [Chess](../) app. Live: https://kathuman.github.io/claude-projects/chess/puzzles/

- **44,943 puzzles** from the [Lichess puzzle database](https://database.lichess.org/#puzzles) (CC0), selected for
  quality (popularity ≥ 85, at least 300 plays, rating deviation ≤ 90), balanced across ratings 400–3000, and
  covering all 73 Lichess themes.
- **Rated training** with a personal Glicko-2 puzzle rating (the system Lichess uses). A clean solve is a win
  against the puzzle's rating; a wrong move, a hint or the solution is a loss.
- **Themes**: forks, pins, mates, endgames and 60 more. The course's tactics and endgame lessons link here
  (`?theme=fork`), so each lesson ends with practice at the learner's level.
- **Daily puzzle**, the same for everyone on a given day (`?mode=daily`), and **timed runs**: three minutes,
  rising difficulty, ten seconds off for a wrong move (`?mode=run`).
- **Your themes**: success rate per theme, weakest first.
- Solved puzzles open in the play app for analysis, or on Lichess.

Progress stays in the browser (`localStorage`, key `chess-puzzles-v1`).

## Files

- `index.html`, `app.js`: the page.
- `data/index.json` plus `data/pNNNN.json`: the puzzles, one file per 200-point rating band, loaded as needed.
  Each puzzle is `[id, fen, moves, rating, themes]` in Lichess's format: the FEN is the position before the
  opponent's move, and the moves are UCI, starting with the opponent's.
- `../src/puzzles.js`: Glicko-2, move checking (any checkmate is accepted, as on Lichess), choosing puzzles,
  the daily puzzle and the difficulty ladder for runs.

## Rebuilding the data

    node chess/tests/build-puzzles.js

This streams the ~300 MB database from Lichess without storing it, using Node 24's built-in zstd. The
pzstd frame headers are stripped first, because Node's decoder rejects them. The script then selects with a
fixed seed and replays every selected puzzle through `src/rules.js`. Takes about a minute.

## Tests

`node chess/tests/puzzles.test.js` checks:
- the rating maths;
- solving, including alternative mates and multi-move puzzles;
- choosing puzzles and the daily puzzle;
- the shipped data: bands, duplicates, replaying a sample, and coverage of the themes the course links to.
