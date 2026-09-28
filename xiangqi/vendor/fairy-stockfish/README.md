# Fairy-Stockfish (vendored)

`stockfish.js`, `stockfish.wasm` and `stockfish.worker.js` are unmodified files from the
[`fairy-stockfish-nnue.wasm`](https://www.npmjs.com/package/fairy-stockfish-nnue.wasm)
npm package v1.1.12 — the WebAssembly build of
[Fairy-Stockfish](https://github.com/fairy-stockfish/Fairy-Stockfish) by Fabian Fichter
and contributors (see `AUTHORS`). Source: https://github.com/fairy-stockfish/fairy-stockfish.wasm

Licensed under the GNU GPL v3 — see `COPYING.txt`.

The build is multi-threaded (Emscripten pthreads), so it needs `SharedArrayBuffer` and
therefore a cross-origin-isolated page. `../../coi-serviceworker.js`
([coi-serviceworker](https://github.com/gzuidhof/coi-serviceworker) v0.1.7, MIT — see
`../../coi-serviceworker.LICENSE`) provides the COOP/COEP headers on GitHub Pages.
