# Cube Studio

A 3×3×3 Rubik's cube in the browser that scrambles itself and then shows the solution step by step, found by
Kociemba's two-phase algorithm.

**Live:** https://kathuman.github.io/claude-projects/rubiks-cube/

## What it does

- **A 3D cube** you can drag to turn and look at from any side, or watch spin on its own, plus a flat 2D net of all
  six faces. Face labels can be turned on.
- **Scramble** makes a random 25-move scramble (no move cancels the one before it).
- **Solve** finds a solution with the Kociemba two-phase solver. Any position can be solved in at most 20 moves
  (God's number); this solver finds short solutions fast, not always the shortest.
- **The move sequence** plays like a video: play and pause, step forward and back, jump to the start or end, or drag
  the scrubber. The speed can be set.
- **The readout** shows the cube's state, the solution's length and how long the search took.
- **Keyboard:** Space plays or pauses, ← and → step, S scrambles.

Colours follow the standard scheme: white opposite yellow, green opposite blue, red opposite orange.

## How it works

The cube is drawn with CSS 3D transforms: 26 small cubes whose faces carry the stickers, turned layer by layer. The
solver runs in a Web Worker (`vendor/solver-worker.js`) so the page stays responsive while it builds its tables and
searches. At start-up the page checks that a solved cube renders every face in a single colour.

## Files

```
index.html                 the page: the cube, the 2D net, controls and playback
vendor/cube.js, solve.js   cubejs: the cube model and the Kociemba two-phase solver
vendor/solver-worker.js    runs the solver off the main thread
vendor/LICENSE-cubejs      cubejs licence (MIT)
```

## Credits

The solver is [cubejs](https://github.com/ldez/cubejs) by Petri Lehtinen and Ludovic Fernandez (MIT licence), based
on Herbert Kociemba's two-phase algorithm. Built with [Claude](https://claude.com). Part of
[AI Projects](https://kathuman.github.io/claude-projects/).
