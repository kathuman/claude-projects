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
│                                 description — read by BOTH create_model.py and the web app
│
└── web/
    ├── index.html
    ├── style.css
    ├── models/
    │   └── warehouse_baseline.glb   generated output (exported by create_model.py)
    ├── src/
    │   ├── model.js              parameter state management (load/get/set/reset)
    │   ├── calculations.js       the analytical model — pure functions, no DOM
    │   ├── visualization.js      Three.js: live procedural geometry + reference GLB loader
    │   └── app.js                wires the three together; owns the DOM
    └── vendor/
        ├── three.min.js          vendored (r128), no CDN dependency
        ├── GLTFLoader.js         vendored addon, matching r128
        └── LICENSE-three
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
freecadcmd freecad/create_model.py --set warehouse_length=200 --set aisle_width=2.4
```

Open `warehouse_model.FCStd` in the FreeCAD GUI and expand **Parameters** to see the live
spreadsheet — edit a cell (e.g. `rack_height`) and recompute, and the bound geometry resizes.
The *count* of rack rows/bays is fixed at generation time (re-run the script to change it) —
see the docstring at the top of `create_model.py` for exactly why.

### 2. Run the web app locally

Browsers block ES-module-like loading and GLB fetches over `file://`, so serve it:

```bash
# from the repo root (claude-projects/)
python -m http.server 8000
# then open http://localhost:8000/warehouse-model/web/
```

### 3. Deployment

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
  object hierarchy (Structure / Equipment / Flow groups, 22 named rack rows, 8 dock markers,
  floor/walls/roof), confirmed the Spreadsheet's aliased cells read back correctly, and
  confirmed the printed layout numbers (`storage_capacity = 5808` at baseline) match
  `calculations.js`'s own console output for the same default parameters — the CAD model and
  the analytical model are not just claimed to agree, they were checked to agree.
- Live re-parametrization: re-ran the generator with `--set warehouse_length=200 --set
  aisle_width=2.4` and confirmed the object count and capacity changed correctly
  (`storage_capacity = 14560`).
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

**NOT VERIFIED:**

- Cross-browser testing beyond Chromium (Firefox/Safari should work — nothing used is
  Chromium-specific — but wasn't separately checked).
- Mobile/touch interaction beyond CSS breakpoints — the pointer events used should work on
  touch, but wasn't tested on an actual device.
- GitHub Pages deployment of *this specific* sub-app post-push (the parent repo's Pages
  pipeline is proven by every other sub-app already live there, but this one hasn't
  round-tripped through an actual push+Pages-rebuild+reload yet as of writing).

## What's here (Phase 1) vs. what's next (Phase 2)

Phase 1 — built, tested, working: the parametric FreeCAD model, the analytical model with
full formula traceability, the live 3D visualization (plus the real FreeCAD reference view),
the KPI dashboard, two charts, engineering warnings, component inspection, and inline
explanations + guided experiment prompts.

Phase 2 — scoped out, not yet built, same architecture ready to receive it:

- **Lessons** — a progressive sequence gating later lessons behind earlier ones, built on
  top of the existing explanation panels.
- **Exercises** — multiple-choice questions with explained answers, likely living beside the
  existing "Guided experiments" panel.
- **Scenarios** — named, saved parameter snapshots (`model.getAll()` already returns exactly
  the payload a scenario needs) with a side-by-side comparison table.
- **Sensitivity analysis** — sweep one parameter, chart the effect on a chosen KPI; the
  `compute*` functions are already pure and cheap enough to call in a loop.
- **Before/after mode** — two scenarios' `computeAll()` results and two `Visualization`
  instances side by side.
- **CSV/JSON export** — `results` and `model.getAll()` are already plain serializable
  objects; this is close to a one-function addition.
