# Epicycles

Turn a picture into one closed line, then draw that line with two chains of turning circles. The chain above the
picture sets x, the chain to its left sets y. It starts with one circle per side, then two, then three and so on,
so you can watch the drawing converge.

**Live:** https://kathuman.github.io/claude-projects/epicycles/

## What it does

- **Pictures.** Text you type, a heart, a star, a gear, your own drawing, or any uploaded picture. The picture is read
  in the browser tab and never uploaded.
- **One closed line.** The outline (Otsu threshold) or the edges (Canny-style: blur, Sobel, one-pixel ridges, a threshold
  well above the grain, measured as the median gradient, and hysteresis) of the picture, thinned to up to 3,000 points and joined into a single cycle: a nearest-neighbour tour, then 2-opt until no reversal shortens it.
  The cycle is resampled to 1,024 points evenly spaced along its length.
  An upload with two clear tones is traced by its outline, any other picture by its edges, and a dark background is
  detected from the border. A picture with nothing to trace leaves the previous one in place.
- **Two series.** `x(t) = a₀ + Σ r_k cos(k t + φ_k)`, and the same for `y(t)`, with up to 500 terms each.
  Term k is one circle: radius r_k, starting angle φ_k, turning k times per cycle.
- **Sequence.** One full cycle with 1 circle per side, then 2, 3 … 10, 12, 15, 20 … 500. Earlier counts stay faded.
  Or fix the count, or click the error chart to jump to any count.
- **Order.** Series order (k = 1, 2, 3 …) or largest circles first.
- **Zoom and move** while it draws: scroll or pinch to zoom about the pointer, drag to move, double-click (or 0) to
  fit, + and − buttons or keys, arrow keys to move. **Follow pen** keeps the pen in the middle, so you can zoom in up
  to ×400 on the smallest circles; the pen's path is sampled more finely as you zoom.
- **Read-outs.** The RMS distance from the traced line (exact, by Parseval), the error for every count (chart and
  table), the equations with their first terms, and each circle's radius, phase and speed.
- **Download SVG** of the curve at the current count.

## Taylor or Fourier?

The circles are a Fourier series. A Taylor series in time cannot close a loop. With `z = e^{it}`, though,
`x(t) = Re Σ A_k z^k` with `A_k = r_k e^{iφ_k}`: a power (Taylor) series in z. Each power z^k goes round k times as
fast, so a term's place in the expansion sets its circle's speed.

## Files

```
index.html          — page and styles
about.html          — about page
app.js              — picture loading, animation, drawing, read-outs
src/fourier.js      — the maths: tracing, tour, resampling, series, error (UMD, also runs in Node)
tests/fourier.test.js
```

## Tests

```
node epicycles/tests/fourier.test.js
```

The tests check that a circle needs exactly one circle per side and pure harmonics land on their own k, that the
full series rebuilds a square, that the error never grows as circles are added and equals the measured RMS
distance, that largest-first is never worse than series order, that the chain tips equal the truncated series, that
the tour visits every point once and 2-opt never lengthens it (and recovers a shuffled circle exactly), that the
resampling is even, and that a drawn ring is traced along its edges and drawn to within 15 % by 100 circles.
