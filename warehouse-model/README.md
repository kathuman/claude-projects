# Warehouse Model — an interactive engineering reasoning environment

A parametric warehouse (storage racks, receiving/shipping docks, material flow) connecting
a real **FreeCAD** engineering model, a traceable **analytical model**, and a **live 3D
visualization** that all share one parameter source of truth. Change a slider and watch the
physical, mathematical and financial consequences update together — not a CAD viewer, a
reasoning environment.

**Live demo:** `https://kathuman.github.io/claude-projects/warehouse-model/web/`
*(deploys automatically — see [Deployment](#deployment) below)*

## Architecture

```text
data/parameters.json  (single source of truth — every input, its unit, range, description)
        │
        ├──────────────────────────┬─────────────────────────────┐
        ▼                          ▼                             ▼
freecad/create_model.py    web/src/calculations.js       web/src/app.js builds the
  → real FreeCAD model       → analytical model,            rail UI FROM the schema —
    (Spreadsheet + Part       same layout arithmetic,        no parameter is ever
    geometry), exports        every result carries a         hand-coded into the page
    warehouse_baseline.glb    `trace` of how it was derived   twice.
        │                          │
        ▼                          ▼
"Reference Model" view      KPI grid, charts, warnings,
(loads the real GLB,        traceability panel — all
 static, honestly labeled   driven by calculations.js,
 as not live)                recomputed on every change
        │                          │
        └────────────┬─────────────┘
                      ▼
         web/src/visualization.js "Live Parametric View"
         — procedural Three.js geometry, rebuilt from the
         same parameters + the same layout numbers, so it
         can actually move when you drag a slider
```

**Why two 3D views, and why neither is faking the other:** a GLB is a baked mesh — it
physically cannot resize itself when a parameter changes. So the interactive view you drag
sliders against ("Live Parametric View") is procedural Three.js geometry built from the same
`parameters.json` values and the same derived layout numbers `calculations.js` just computed.
The "Reference Model" toggle loads the *actual* tessellated export of
`freecad/warehouse_model.FCStd` — real FreeCAD geometry, proof the two layers describe the
same building — but it's static on purpose, and the app says so on screen rather than
pretending otherwise.

## Repository structure

```text
warehouse-model/
├── README.md                    this file
├── .gitignore                   FreeCAD backup/cache files
│
├── freecad/
│   ├── create_model.py          the authoritative parametric model generator
│   └── warehouse_model.FCStd    generated output (run the script to regenerate)
│
├── data/
│   └── parameters.json          single source of truth: every parameter, unit, range,
│                                 description, plus the rack-type table (depth, selectivity,
│                                 minimum aisle, planning ceiling, truck) — read by BOTH
│                                 create_model.py and the web app
│
├── tests/
│   ├── calculations.test.js     unit tests: hand-checked baseline, geometry invariants over
│   │                             3,000 random designs, cycle time vs a brute-force walk over
│   │                             every door/slot/level, behaviour and warning checks
│   ├── parity.test.js           runs create_model.py's layout code and calculations.js on
│   └── parity_layout.py           the same 400 random designs and requires identical rows
│
├── tools/
│   └── render_blueprint.js      writes web/assets/blueprint.svg (baseline) with the same
│                                 web/src/blueprint.js the page uses to draw the live plan
│
└── web/
    ├── index.html
    ├── style.css
    ├── models/
    │   └── warehouse_baseline.glb   generated output (exported by create_model.py)
    ├── assets/
    │   └── blueprint.svg            generated output (exported by tools/render_blueprint.js)
    ├── src/
    │   ├── model.js              parameter state management (load/get/set/reset)
    │   ├── calculations.js       the analytical model — pure functions, no DOM
    │   ├── visualization.js      three.js 3D view: instanced racks and pallets, heat map, routes,
    │   │                         and the reference GLB loader
    │   ├── blueprint.js          the dimensioned floor plan as SVG (browser + Node)
    │   └── app.js                wires them together; owns the DOM
    └── vendor/three/             three.js r186 (ES modules, via the page's import map) with the
                                  few add-ons used: GLTFLoader, OrbitControls, RoomEnvironment
```

**Deliberate deviations from a generic project template**, and why:

- **No `freecad/parameters.csv`.** `data/parameters.json` already is the single source of
  truth read by both FreeCAD and the web app. A second CSV copy of the same numbers would be
  exactly the "separate unrelated copy of the same parameter" this architecture exists to
  avoid.
- **No `scenarios.js` / `lessons.js` / `exercises.js` yet.** Scoped out as Phase 2 (see
  below) — empty stub files would just be clutter until they have real content.
- **No `.github/workflows/pages.yml`.** This project lives inside the `claude-projects`
  repo, whose GitHub Pages is already configured (branch-deploy, not Actions) and already
  serves every sub-app here automatically — a workflow file in this *subfolder* would not
  even be picked up by GitHub Actions (workflows must live at the repo root) and would be
  silent dead weight. If this ever becomes its own standalone repo, that's the point to add
  a real one.

## How to run

### 1. Regenerate the FreeCAD model (optional — a generated copy is already committed)

Requires [FreeCAD](https://www.freecad.org/) 1.0+. Run its Python (not your system Python —
FreeCAD's own modules only exist inside it):

```bash
# Windows
"C:\Program Files\FreeCAD 1.1\bin\freecadcmd.exe" freecad\create_model.py

# Linux / Mac (path varies by install)
freecadcmd freecad/create_model.py
```

This reads `data/parameters.json`, builds the model, saves `freecad/warehouse_model.FCStd`,
and exports `web/models/warehouse_baseline.glb`. Override any parameter for a one-off
regeneration without editing the JSON:

```bash
freecadcmd freecad/create_model.py --set warehouse_length=200 --set rack_type=double_deep
```

Open `warehouse_model.FCStd` in the FreeCAD GUI and expand **Parameters** to see the live
spreadsheet — edit a cell (e.g. `rack_height`) and recompute, and the bound geometry resizes.
The *count* of rack rows/bays is fixed at generation time (re-run the script to change it) —
see the docstring at the top of `create_model.py` for exactly why.

### 2. Regenerate the floor-plan blueprint (optional — a generated copy is already committed)

Pure Node, no FreeCAD needed — it reuses `web/src/calculations.js`'s tested layout
arithmetic directly:

```bash
node tools/render_blueprint.js
```

Writes `web/assets/blueprint.svg`, shown in the app under **Floor Plan (Blueprint)**. Like
the Reference Model 3D view, it's a snapshot of `data/parameters.json`'s baseline values —
regenerate it after changing the defaults, or point the script at a different parameter set.

### 3. Run the web app locally

Browsers block ES-module-like loading and GLB fetches over `file://`, so serve it:

```bash
# from the repo root (claude-projects/)
python -m http.server 8000
# then open http://localhost:8000/warehouse-model/web/
```

### 4. Deployment

Nothing to configure — this repo's GitHub Pages is already live at
`kathuman.github.io/claude-projects/`. Pushing to `main` republishes every sub-app,
including this one, within a minute or two.

## How to modify the model

Everything starts at **`data/parameters.json`**. Add, remove or re-range a parameter there
and:

- `freecad/create_model.py` picks it up automatically for the Spreadsheet and, if you wire a
  new geometry builder to it, the model.
- `web/src/app.js` builds its rail slider automatically (grouped by `category`, in the order
  `ParameterModel.CATEGORY_ORDER`) — no HTML to hand-edit.
- `web/src/calculations.js` is the only place to add a *new derived formula* — add a
  `compute*(...)` function there, following the existing pattern of returning a `trace`
  array, and call it from `computeAll`.

The one thing that is **not** live-editable from the JSON alone is the rack-row/bay *count*:
that's decided by `create_model.py`'s layout derivation at generation time (see the
docstring), mirrored exactly in `calculations.js`'s `computeLayout()`. If you change that
arithmetic, change it in both places — they're intentionally written with matching variable
names and order specifically so a side-by-side diff stays easy.

## Validation status

**VERIFIED** (actually run, output inspected, not assumed):

- FreeCAD 1.1.3 generation: ran `create_model.py` headlessly via `freecadcmd`, confirmed the
  object hierarchy (Structure / Equipment / Flow groups, 20 named rack rows (v2 baseline), 8 dock markers,
  floor/walls/roof), confirmed the Spreadsheet's aliased cells read back correctly, and
  confirmed the printed layout numbers (`storage_capacity = 5280` at the v2 baseline; `tests/parity.test.js` now checks this automatically on 400 random designs) match
  `calculations.js`'s own console output for the same default parameters — the CAD model and
  the analytical model are not just claimed to agree, they were checked to agree.
- Live re-parametrization: re-ran the generator with `--set rack_type=double_deep --set
  aisle_width=3.0` and confirmed rows and capacity match the web app for the same design
  (14 rows, `storage_capacity = 7392`).
- Real spreadsheet-expression binding: confirmed headlessly that editing a spreadsheet cell
  and recomputing resizes dependent geometry (not just Python variables masquerading as
  "parametric").
- GLB export: confirmed valid glTF 2.0 binary output (correct magic number, header length
  matches file size) and confirmed empirically — not assumed — that FreeCAD's exporter
  already converts internal mm to metres and Z-up to Y-up per the glTF spec (an earlier draft
  of this app applied its own redundant unit/axis conversion on load and rendered a building
  1000× too small; caught by inspecting the loaded scene's actual bounding box in a real
  browser, not by reasoning about it).
- Full web app: driven end-to-end with a headless Chromium session (Playwright) — parameter
  sliders change KPIs/charts/warnings/3D geometry correctly, component click-to-inspect
  works, the Reference Model toggle loads the real GLB and now visually matches the live
  view's structure/rack/dock styling, the overflow warning fires correctly when inventory is
  pushed past capacity, and the browser console showed zero errors across the full
  interaction sequence.
- Floor-plan blueprint (`tools/render_blueprint.js` → `web/assets/blueprint.svg`): confirmed
  the exact numbers on the drawing (capacity, rack row count, footprint) come from the same
  `computeAll()` call the rest of the app uses, not separately re-typed; rendered and
  screenshotted in a real browser (both standalone and embedded on the app page) to catch
  layout bugs — an early draft had a stray coordinate-system bug drawing a diagonal line
  across the title block and detail dimensions crowding the corner labels, both fixed and
  re-verified visually, not just by reading the SVG source.

**NOT VERIFIED:**

- Cross-browser testing beyond Chromium (Firefox/Safari should work — nothing used is
  Chromium-specific — but wasn't separately checked).
- Mobile/touch interaction beyond CSS breakpoints — the pointer events used should work on
  touch, but wasn't tested on an actual device.
- GitHub Pages deployment of *this specific* sub-app post-push (the parent repo's Pages
  pipeline is proven by every other sub-app already live there, but this one hasn't
  round-tripped through an actual push+Pages-rebuild+reload yet as of writing).

## The engineering model (v2)

- **Rack types** (`rack_types` in `parameters.json`): selective, double-deep, VNA, push-back and
  drive-in, each with lane depth, selectivity, the narrowest aisle its truck needs, and a planning
  ceiling (deep lanes hold one product each, so part-empty lanes waste space). Values are typical
  planning figures, not a specific manufacturer's.
- **Geometry**: rows stand `row | aisle | row` with a flue gap between back-to-back rows
  (NFPA 13 needs at least 150 mm). Dimensions are inside the walls; the footprint and its cost
  include the walls.
- **Vertical fit**: each level must hold `load_height` plus 0.25 m for the beam and lift-off gap,
  and the top load must stay `sprinkler_clearance` below the clear height (0.46 m standard,
  0.91 m ESFR).
- **Cycle time**: single-command trips under random storage, averaged exactly over every door,
  aisle, bay and level of the layout (rectilinear route: door → staging zone → aisle → bay).
  Lift time adds to driving because trucks lift after stopping. Checked against a brute-force walk
  over every slot in the tests.
- **Docks**: truck-based (pallets per truck, minutes per truck at a door), receiving and shipping
  separate, sized for the peak hour. The lift-truck fleet is sized for the peak hour too, divided by
  the share of each hour a truck really works.

Run the tests (Node; the parity test also needs a system Python 3, not FreeCAD):

```bash
node warehouse-model/tests/calculations.test.js
node warehouse-model/tests/parity.test.js
```

## Roadmap

- **v1** — Phase 1: FreeCAD model, analytical model with traceability, live 3D, KPIs, charts.
- **v2** — trustworthy core: the model above, unit and parity tests, live floor plan,
  typed values, metric/imperial, version badge.
- **v3 (current)** — a 3D view you can read: three.js r186 with image-based lighting and shadows;
  instanced uprights (every frame line and lane), beams (every level) and pallets, filled with the
  current inventory; a travel-time heat map of every position (from `slotTimes()`, whose average over
  all slots is tested to equal the headline cycle time); click a slot for its putaway/retrieval cycle
  and the route from and to the nearest doors; trailers at the busy doors. Renders only when
  something changes, and turns shadows off if frames stay slow.
- **v4** — operations: ABC slotting, cross-aisles, fishbone and U-flow layouts, dock queueing
  (Erlang C), hourly profile.
- **v5** — discrete-event simulation of trucks and lift trucks, animated, with Monte Carlo ranges.
- **v6** — decision support: scenarios, sensitivity, an optimiser, total cost of ownership,
  automation alternatives.
- **v7** — CAD/BIM and data: in-browser B-rep geometry, IFC export, SKU/order-line import.
