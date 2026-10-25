# Othello

Othello (reversi) in the browser: play the computer or a friend on a 6×6, 8×8 or 10×10 board.

**Live:** https://kathuman.github.io/claude-projects/othello/

## What it does

- **Opponents:** the computer (Easy, Medium, Hard or Expert; you choose Black or White) or two players taking turns
  on one device.
- **The rules:** a move must trap one or more of the opponent's discs in a straight line (across, down or diagonal)
  between the new disc and another of yours, and every trapped disc flips. A player with no legal move passes. The
  game ends when neither side can move, and the side with more discs wins.
- **Hints** showing the legal moves (on or off), undo, a move list, and the move number, empty squares and legal
  moves so far.
- **Board sizes:** 6×6, 8×8 (standard) or 10×10.
- **Looks:** six disc colour schemes, six board finishes, light and dark themes, remembered between visits.

## How it works

The whole game is one HTML file with no build step and no libraries. Its script is split into layers that never
reach across each other:

- **Rules:** pure functions over a 2-D array where 1 is Black, −1 White and 0 empty, so the opponent of `color` is
  always `-color`. `flipsFor` walks the eight directions from a square and keeps each run of opponent discs that ends
  on one of yours; that one function is the whole rulebook. `legalMoves`, `applyMove` and `counts` build on it.
- **Computer player:** `evaluate` scores a position from weighted square values, mobility (how many moves each side
  has) and a large bonus for corners, weighted differently in the opening, middle game and endgame. `negamax`
  searches with alpha-beta pruning and tries promising squares first. The difficulty sets the search depth (Easy is
  mostly random, Expert looks about six moves ahead), and near the end it solves the position exactly.
  `buildWeights(n)` makes the square values for any board size from each square's distance to the edges and corners.
- **Screen:** everything that changes lives on one `state` object, and `render()` redraws the board from it. Undo
  restores whole-board snapshots instead of un-flipping discs.

The page's "How the code is built" section explains each part in more detail.

## Files

```
index.html   the game: rules, computer player, board and controls
```

Built with [Claude](https://claude.com). Part of [AI Projects](https://kathuman.github.io/claude-projects/).
