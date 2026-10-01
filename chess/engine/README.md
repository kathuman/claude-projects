# Stockfish engine (vendored)

`stockfish-18-lite-single.js` + `.wasm` are unmodified files from the
[`stockfish`](https://www.npmjs.com/package/stockfish) npm package v18.0.8
(Stockfish.js by Nathan Rugg / Chess.com, a WebAssembly build of
[Stockfish](https://stockfishchess.org) 18). The "lite, single-threaded" flavour
is used because it is ~7 MB and needs no cross-origin-isolation headers, so it
runs on GitHub Pages.

Licensed under the GNU GPL v3 — see `COPYING.txt`. Source:
https://github.com/nmrugg/stockfish.js
