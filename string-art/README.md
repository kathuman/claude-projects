# String Art

**Live:** https://kathuman.github.io/claude-projects/string-art/

Turns a picture into string art: one black thread wound from nail to nail around a circular board, thousands of
times, until its crossings draw the picture. The app works out the order of the nails, shows a physically realistic
preview, and gives you everything needed to build the piece by hand: a nail template at true size, printable winding
instructions, and a threading mode that calls out the next nail. Everything runs in the browser; pictures are never
uploaded. English, Spanish (Latin America) and Danish.

Version 1.0.0. Part of the [AI Projects](https://kathuman.github.io/claude-projects/) site, in `string-art/`.

## Using it

1. **Picture.** Upload a JPG, PNG or WebP, or use the sample portrait. Drag it under the board circle, zoom with the
   wheel, a pinch or the slider, and turn it with the slider.
2. **Adjust.** Brightness, contrast and gamma; a local contrast boost (CLAHE) for flat pictures; the importance brush
   to make eyes, a mouth or an edge count more (warm) or less (cool). "As the solver sees it" shows the result, with a
   warning if the contrast is low or the border is busy.
3. **Parameters.** Start from a preset ("Portrait – fine", "Portrait – bold", "High-contrast graphic") or set each
   parameter; every one has a ? that explains it. The settings are remembered for your next visit.
4. **Run.** The thread goes on live; pause, resume or cancel at any time. Compare it side by side with the target,
   hover over the thread for a loupe at true thread width, and read the quality numbers.
5. **Build.** Print the nail template (A4 or A3 pages, or one SVG sheet) at actual size and check the 100 mm square;
   download the winding instructions, the sequence as CSV, the preview as PNG, or a project file; then open the
   threading mode at the board.

## Setup

Run these inside `string-art/`:

```
npm install
npm run dev        # development server with live reload
npm test           # all tests, including the benchmark
npm run bench      # the benchmark alone: N = 240, K = 3000, 700 px
npm run typecheck
npm run build      # writes the static page to app/
```

## Deployment

The build is a static site: `npm run build` writes `app/` (two HTML pages, the scripts, the worker, the stylesheet and
the sample picture, all with content-hashed names and relative URLs), which can be served from any static host or
sub-path. On the AI Projects site, GitHub Pages serves the repository as it is, with no build step, so `app/` is
committed along with the source, and `string-art/index.html` forwards to it. CI type-checks, runs the tests, rebuilds,
and fails if the committed `app/` differs from a fresh build (the build is reproducible).

## How it works

**From picture to target.** The picture is decoded to linear light (the sRGB transfer curve undone), reduced to
Rec. 709 luminance Y, cropped (exact area averaging, or supersampled bilinear when turned) to the working resolution,
optionally given CLAHE and brightness/contrast/gamma on the sRGB-encoded scale, and turned into the target darkness
T = 1 − Y inside the nail circle. Linear light matters because thread coverage is a linear quantity: a pixel 30 %
covered by black thread reflects 70 % of the light.

**Nails and chords.** Nail i sits at angle −π/2 + 2πi/N, clockwise from the top, with coordinates rounded to 1/1024 px
so every browser rasterises the same chords. Each chord is drawn with Xiaolin Wu's anti-aliasing; diagonal chords get a
coverage factor k = length / major-axis extent (up to √2), because a 1-px-wide line covers 1/cos φ of each column it
crosses. All valid chords are precomputed into one flat buffer (5 bytes per pixel entry, about 112 MB at N = 240 and
700 px) if that fits the memory budget, or rasterised on demand with an LRU cache; both give identical results.

**Thread darkness.** Each pass hides a fraction a of whatever white is still showing:
C ← 1 − (1 − C)(1 − a), with a = min(1, α·k·w), w the Wu weight and α = clamp(thread / pixel size, 0.02, 1) × the
darkness factor. Crossings darken but never beyond black, and n passes give 1 − (1 − a)ⁿ.

**Greedy solver.** From the current nail, every allowed next nail (at least the minimum skip away, line not used up)
is scored by the exact reduction in importance-weighted squared error, Σ W·d·(2(T − C) − d) with d = a(1 − C),
optionally divided by length^β. The best is wound, and the search continues from its far end. It stops after K lines,
or when the best score stays below ε for 20 lines, in which case those last lines are dropped, since they made the
picture no better. Ties go to the lowest nail and sums run in a fixed order, so the same target and parameters always
give the same sequence. The solver runs in a Web Worker behind an asynchronous `Solver` interface whose result holds
one pass per thread colour, with room for connector lines, so a multi-colour or a global (least-squares then routed)
solver can be added without changing the page.

**Quality numbers.** RMSE between target and simulated board; SSIM with a 7 × 7 uniform window (the scikit-image
default; the original paper uses an 11 × 11 Gaussian); SSIM "seen from a distance" on slightly blurred images, since
string art is a fine texture that pixel-level SSIM mostly measures as noise; and the thread length, with 10 % more for
wrapping round the nails and slack.

**Preview.** The board is drawn at one pixel per thread width (600 mm with 0.25 mm thread gives 2400 px), each chord
a separate 1-px stroke, so crossings darken as real thread does; the screen shows it averaged down by repeated halving.

**Exports.** The nail template is drawn in millimetres (one viewBox unit per mm), with numbers set radially; for
paper it is tiled onto A4 or A3 pages with 15 mm overlaps, alignment crosses and a calibration square placed clear of
the nails. The project file stores the processed target bit for bit with an FNV-1a fingerprint, so reloading
reproduces the sequence exactly (re-decoding the original photo might not, in another browser).

## Choosing a picture

- **Strong contrast.** String art draws with differences between areas. A face lit from one side, against a plain
  light or dark background, works best. Flat, evenly lit pictures give a grey haze: raise the contrast or use the local
  contrast boost.
- **A plain border.** Every line starts and ends at the rim, so detail near the edge becomes clutter that crosses the
  whole board. Zoom in so the subject fills the circle and the background is quiet.
- **Large, simple shapes.** Eyes, the line of the mouth and the outline of the head carry a portrait. Fine texture
  (fabric, hair detail, foliage) does not survive; paint the important features up with the brush.
- **Faces close up.** A head and shoulders filling most of the circle reads better than a full figure.
- Check "As the solver sees it" and its warnings before running; the picture there is exactly what the solver aims for.

## Source layout

- `src/core/`: pure functions with no DOM, unit-tested in Node: geometry, Wu rasteriser, line cache, darkness model,
  solver interface, greedy solver, metrics, preprocessing, CLAHE, background check, importance mask, threading view.
- `src/worker/`: the solver worker and its typed message protocol (discriminated unions, transferred arrays).
- `src/export/`: winding instructions, CSV, the nail template (SVG and tiled pages), the project file.
- `src/ui/`: the page (main.ts), crop editor, parameters and presets, preview and loupe, threading mode, storage,
  image loading, languages (i18n*.ts).
- `web/`: the page sources (index.html, about.html).
- `app/`: the built page that GitHub Pages serves.
- `tests/`: Vitest, 90 tests, including the spec's acceptance checks and a benchmark (N = 240, K = 3000 at 700 px in
  about 5 s on a laptop; peak memory about 225 MB).

## License

MIT
