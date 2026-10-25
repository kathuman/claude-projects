# Go

Go (baduk, weiqi) in the browser: play the computer or a friend on one device, on a 9×9, 13×13 or 19×19 board.

**Live:** https://kathuman.github.io/claude-projects/go/

## What it does

- **Opponents:** the computer (three strengths: Gentle, Casual, Sharp; you choose Black or White) or two players
  taking turns on one device.
- **The full rules:** captures by removing the last liberty, no suicide unless it captures, and the ko rule (a single
  stone cannot be recaptured at once).
- **Pass, undo and a move list.**
- **Scoring:** two passes in a row end the game. Click any group both players agree is dead to remove it, then press
  Finish. Scoring is by area (your stones plus the empty points only your stones surround), and White adds the komi
  (0.5, 5.5, 6.5 or 7.5). The score updates live while groups are marked.
- **Looks:** five goban woods, coordinates on or off, light and dark themes, remembered between visits.

The computer plays a fast heuristic: fine for a casual game, not a match for a strong player.

## How it works

The whole game is one HTML file with no build step and no libraries. Its script is split into three layers:

- **Rules:** pure functions over a flat `Int8Array` (0 empty, 1 Black, −1 White). `groupAt` flood-fills a group and
  its liberties; `tryMove` returns the new board and the captured stones, or `null` for an illegal move (occupied,
  suicide or ko). Ko is checked against a hash of the earlier position.
- **Computer player:** `scoreMove` rates each candidate by stones captured, liberties gained, self-atari avoided, an
  attack on an opponent group in atari, and influence (a preference for the third and fourth lines early, then for
  points near the action). `chooseMove` picks among the best with a little randomness; the strength setting widens
  or narrows that choice. It passes only after you pass and when no move helps it.
- **Board:** one inline SVG redrawn from the board each time: grid, star points, stones, a ring on the last move, and
  territory dots and dead-stone marks while scoring. Undo restores whole-board snapshots.

## Files

```
index.html   the game: rules, computer player, board and controls
```

Built with [Claude](https://claude.com). Part of [AI Projects](https://kathuman.github.io/claude-projects/).
