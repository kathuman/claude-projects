# String Art

Turns a picture into string art: one continuous thread wound between nails on a circular frame. The app works out
the order of nails that best reproduces the picture, shows a realistic preview, and exports what you need to build it
by hand. Everything runs in the browser; nothing is uploaded.

**Live:** https://kathuman.github.io/claude-projects/string-art/

**Status:** version 0.2.0, milestone 2 of 5. You can upload a picture (or use the drawn sample), set every solver
parameter, run the solver in a Web Worker with live progress, pause, resume and cancel, watch the thread go on at true
thickness, compare it side by side with the target, and read the quality numbers. In English, Spanish and Danish.
Still to come: picture cropping and adjustments, CLAHE and an importance brush (M3); exports including a 1:1 nail
template and printable winding instructions (M4); the threading mode, saved settings and presets (M5).

Part of the [AI Projects](https://kathuman.github.io/claude-projects/) site, in `string-art/`.

## Setup

Run these inside `string-art/`:

```
npm install
npm test          # all tests, including the benchmark
npm run bench     # the benchmark alone: N = 240, K = 3000, 700 px
npm run typecheck
npm run dev       # development server
npm run build     # writes the static page to app/ (commit app/ with the source)
```

GitHub Pages serves the site straight from the repository, with no build step, so the built page in `app/` is
committed alongside the source. The page's source is `web/index.html` plus `src/`.

## How it works (so far)

- **Nails.** N nails on a circle, nail 0 at the top, numbered clockwise. Coordinates are rounded to 1/1024 px so every
  browser rasterises the same chords.
- **Chords.** Each chord is drawn with Xiaolin Wu's anti-aliasing. Diagonal chords get a coverage correction (up to
  √2) so they carry as much thread as their length says.
- **Darkness.** Threads hide the board multiplicatively: one more pass of opacity a turns darkness C into
  1 − (1 − C)(1 − a).
- **Solver.** From the current nail, take the chord that most reduces the importance-weighted squared error between
  target and preview, then continue from its far end. The solver stops after K lines, or when no chord has helped for
  20 steps; it then drops those last chords, since they made the picture no better.
- **Line cache.** All valid chords are precomputed into one flat buffer (5 bytes per pixel entry, about 112 MB at
  N = 240 and 700 px) if that fits the memory budget. Otherwise chords are computed on demand and kept in an LRU
  cache. Both give identical results.

- **Preview.** The board is drawn at one pixel per thread width (600 mm with 0.25 mm thread gives 2400 px), each
  chord a separate 1-px stroke, so crossings darken as real thread does. The screen shows it averaged down by repeated
  halving, close to what an eye sees from a distance.
- **Metrics.** RMSE, SSIM (7 × 7 uniform window), SSIM "seen from a distance" (both images blurred slightly first,
  since thread is a fine texture that pixel-level SSIM mostly measures as noise), thread length plus 10 % slack.

## Source layout

- `src/core/`: pure functions with no DOM (geometry, Wu rasteriser, line cache, darkness model, solver interface,
  greedy solver, metrics). They run in Node for the tests.
- `src/core/preprocess.ts`: sRGB to linear light, Rec. 709 luminance, area-average resampling, adjustments, target.
- `src/worker/`: the solver worker and its typed message protocol.
- `src/ui/`: the page (main.ts), parameters, thread preview, image loading, languages (i18n*.ts).
- `web/`: the page sources (index.html, about.html).
- `app/`: the built page that GitHub Pages serves. CI rebuilds it and fails if the committed copy differs.
- `tests/`: Vitest.

## License

MIT
