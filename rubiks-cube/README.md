# Cube Studio

A 3×3 cube in the browser: scramble it from a truly random position, then watch a short solution play out move by
move, found by Kociemba's two-phase algorithm and checked by an independent model of the cube.

**Live:** https://kathuman.github.io/claude-projects/rubiks-cube/ · version 1.1.0 · method in [about.html](about.html)

## What it does

- **A 3D cube** you can drag to look at from any side, or leave spinning, plus a flat net of all six faces. Either
  can be the large view. Face letters can be shown on the stickers.
- **Scramble** draws a position uniformly at random from all 43,252,003,274,489,856,000 and gives the moves that
  make it: the solver's solution of that position, played backwards. This is how competition scrambles are made.
- **Solve** finds a solution with Kociemba's two-phase algorithm, usually 20 to 22 moves in a few tens of
  milliseconds. The length is given in face turns and in quarter turns.
- **The move sequence** plays like a video: play and pause, step, jump to either end, drag the scrubber, or click
  any move. The speed can be set; reduced-motion settings are respected.
- **Turn it yourself:**
  - drag a sticker to turn its layer the way you drag it, or drag the background to look around;
  - keys: U R F D L B, M E S and X Y Z, with Shift for the other way;
  - buttons for every face, slice and rotation.
- **Type moves** to play them or to set up a cube (spaces and brackets optional; wide turns as `Rw` or `r`).
- **Undo and redo** (also Ctrl+Z, Ctrl+Y). The move list is the history.
- **Copy link** opens the same cube with the same move list (`?setup=…&alg=…`).
- Cubes turned as a whole are solved too: the solution starts by turning them back to the standard hold.
- **Other keys:** Space plays or pauses, ← and → step.
- The AI Projects blueprint look, dark by default, with a light theme.

## How it works

- **The model** (`src/model.js`) is the cube as 54 stickers in the solver's order (U R F D L B). Every sticker has a
  position and an outward direction, and each move turns the stickers in its layers a quarter turn about its axis.
  So face turns, slices (M E S), wide turns and rotations (x y z) all come from the same geometry.
- **Notation** (`src/notation.js`) reads, inverts and tidies move sequences and counts them in face turns (HTM),
  quarter turns (QTM) and slice turns (STM).
- **The solver** is [cubejs](https://github.com/ldez/cubejs) (MIT), running in a Web Worker
  (`vendor/solver-worker.js`), which also makes the random-position scrambles.
- **The 3D view** is 26 small cubes drawn with CSS 3D transforms. A move animates the turning layer, then the
  stickers are redrawn from the model.

## Files

```
index.html, styles.css, app.js   the page
about.html                       notation, the numbers, the method, versions
src/model.js                     the cube: stickers, geometry, moves
src/notation.js                  reading, inverting, tidying and counting moves
vendor/                          cubejs (cube.js, solve.js, MIT) and the solver worker
tests/                           node test suites (cubejs.js loads the solver into Node)
tools/browser-check.cjs          drives the page in a real browser
```

## Tests

```bash
cd rubiks-cube && npm test
```

The model on its own: every move four times is no move, a move and its inverse cancel, opposite faces commute,
(R U R′ U′)×6 is no move, R U has order 105, the superflip sequence gives the superflip, and slices, wide turns and
rotations equal the face turns they stand for. The model agrees with the solver library on 300 random sequences.
The solver, checked by the model: 1,000 random positions are solved in at most 22 moves, every random-position
scramble makes exactly its position, and the superflip is solved.

The browser check (42 checks) covers:
- the theme and the facts;
- a scramble whose net and 3D stickers match the model exactly;
- stepping and keys;
- a solution played to a solved cube;
- the views and the labels;
- turning by buttons, keys and sticker drags;
- undo, redo, and a new move after an undo;
- typed moves and a mistyped one;
- set-up, a link round trip, and solving a cube turned as a whole;
- phone width.

```bash
python -m http.server 8766          # from the repository root
PW=<path to playwright or playwright-core> CHROME=<chrome.exe> node rubiks-cube/tools/browser-check.cjs
```

## Roadmap

1.2 your own cube, painted on the net or
scanned with the camera · 1.3 the shortest possible solutions · 1.4 a LEGO MINDSTORMS Robot Inventor solving robot:
a turntable and two tilting arms, colour-sensor scanning, an animated plan and a Pybricks program · 2.0 learn to
solve it: the beginner's method and CFOP.

## Credits

The solver is cubejs by Petri Lehtinen and Ludovic Fernandez (MIT licence), after Herbert Kociemba's two-phase
algorithm. Built with [Claude](https://claude.com). Part of [AI Projects](https://kathuman.github.io/claude-projects/).
