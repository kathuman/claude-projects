# Tech University Atlas

The technical universities in the QS World University Rankings 2027 on a 3D globe and a 2D map, coloured by rank.

**Live:** https://kathuman.github.io/claude-projects/tech-uni-atlas/

## What it does

- **Globe and map.** 242 universities in 68 countries. The 3D globe (globe.gl) raises a column at each one, taller for
  a better rank; the flat map uses the Equal Earth projection. Drag, zoom, click a point or a row in the list.
- **Filters.** Rank tier (top 100, 101–300, 301–600, 601–1000, 1001+), why a university is included, country and name.
- **Which universities count.** Its English name contains “tech” (186), its name contains “tec” with accents ignored
  (14, shown with a ring), or it is technical without either in its name (42, shown as a square): its own-language
  name means technical university or polytechnic, it belongs to a national technical-university network (TU9,
  TU Austria, 4TU, Nordic Five Tech, Malaysian Technical University Network), or it is a single-field engineering,
  mining, petroleum, aerospace or telecom university.
- **Theme.** The site's blueprint theme, dark by default; the sun button switches to a light map and is remembered.

## Data

- Ranks: QS World University Rankings 2027 (published 18 June 2026; 1,504 institutions), kept as published. A band such
  as 601–610 is tiered by its first number. Not affiliated with or endorsed by QS.
- Coordinates: compiled by Claude, not by a geocoding service. 210 on the main campus, 32 at city level (marked in the
  list).
- Country outlines: Natural Earth via johan/world.geo.json (public domain), simplified to about 50 m. Singapore, Hong
  Kong, Macau and Palestine are too small for these outlines; their points still show.

## Files

```
index.html               — page
style.css                — blueprint theme tokens (dark and light) and layout
app.js                   — filters, list, 3D globe, 2D Equal Earth map, theme switch
about.html               — about page
data/universities.js     — the 242 universities
data/countries.js        — country outlines
tests/data.test.js       — every record valid, no duplicates, reasons match names, about-page counts match the data
tests/release.test.js    — every local file loads with ?v=<version>, versions agree
```

Every local file is loaded with `?v=<version>` so a release never runs with old cached files; bump `VERSION` in
`app.js` and the `?v=` in `index.html` together.

## Tests

```
node tech-uni-atlas/tests/data.test.js
node tech-uni-atlas/tests/release.test.js
```
