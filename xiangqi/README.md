# Xiangqi

Xiangqi (Chinese chess) in the browser, against a friend or Fairy-Stockfish, with classic problems from a book of
1570.

**Live:** https://kathuman.github.io/claude-projects/xiangqi/ · version 1.4.0

## What it does

- **Opponents:** a friend on the same screen, or [Fairy-Stockfish](https://fairy-stockfish.github.io), one of the
  strongest Xiangqi engines, at eight strengths (1, Beginner, to 8, full strength), playing Red or Black.
- **The full rules:**
  - the palace, the river, the hobbled horse, the elephant's eye, the cannon's screen;
  - the flying-general rule (the generals may never face each other on an open file);
  - stalemate loses;
  - a threefold repetition loses for the side that gave check on every move of the cycle (perpetual check) and is
    otherwise a draw.

  Perpetual chasing is not adjudicated.
- **The move list in WXF notation** (for example `C2=5`, the Central Cannon).
- **Classic problems:**
  - 135 mating problems from 《适情雅趣》 (*Shiqing Yaqu*, 1570), the oldest surviving Xiangqi problem collection,
    grouped by length;
  - the Four Great Endgames (江湖四大名局), 18th–19th-century studies that look like easy wins for Red but are draws
    with best play: hold the draw against the engine, or step through the book line.

  Each problem has a hint, a retry and the solution. A winning move other than the book's is accepted when
  Fairy-Stockfish confirms it still forces mate in time. Solved problems are remembered.
- **Look:**
  - six boards (Blueprint, Wood, Bamboo, Rice paper, Jade, Charcoal);
  - Chinese characters or Western letters (K A E H R C P) on the pieces;
  - a 3D view you can tilt and turn;
  - light and dark themes.

The page's own "How to play" and "How the code is built" sections explain the rules and the code in detail.

## How it works

- **Rules.** Pure functions over a 10×9 array of piece letters, the same letters Fairy-Stockfish uses in its FEN.
  - A move is legal when, after it, the mover's general is not attacked and the generals do not face each other.
  - The move generator was checked by perft against the published counts (44, 1,920, 79,666 and 3,290,240 positions
    at depths 1 to 4).
- **Engine.** The Fairy-Stockfish WebAssembly build is downloaded only when you first choose the computer, and the
  page talks to it in UCI (`setoption name UCI_Variant value xiangqi`). Its replies are checked against the page's
  own legal moves.
  - The build is multi-threaded, so it needs `SharedArrayBuffer`, which browsers allow only on cross-origin isolated
    pages. GitHub Pages cannot send the headers that requires, so
    [coi-serviceworker](https://github.com/gzuidhof/coi-serviceworker) (MIT) adds them. It installs on the first
    visit and reloads the page once.
- **Problems.** The positions and book lines were taken from xiangqiqipu.com and replayed through the page's own
  rules. Each was then given to Fairy-Stockfish to confirm that the mate can be forced in the stated number of moves.
  135 of the book's 247 winning lines passed; in the rest Black has a defence the book missed (for the short ones,
  an exhaustive search confirmed this).
- **The 3D view** is the same board turned with CSS 3D transforms, so everything works the same in it.

## Files

```
index.html                 the game: rules, notation, engine link, problems, board and controls
theme.css                  the shared look (dark by default), kept in step with chess/theme.css
coi-serviceworker.js       enables cross-origin isolation on GitHub Pages (MIT, see coi-serviceworker.LICENSE)
vendor/fairy-stockfish/    Fairy-Stockfish WebAssembly build (GPL v3, see its README and COPYING.txt)
```

To run it locally, serve the folder over HTTP (for example `python -m http.server`). The engine and the service
worker do not work from `file://`.

## Credits

Fairy-Stockfish (GPL v3), by Fabian Fichter and the Stockfish developers; coi-serviceworker (MIT) by Guido Zuidhof;
the classic problems from 《适情雅趣》 by way of xiangqiqipu.com. Built with [Claude](https://claude.com). Part of
[AI Projects](https://kathuman.github.io/claude-projects/).
