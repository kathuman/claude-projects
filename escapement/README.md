# Escapement

**Live:** https://kathuman.github.io/claude-projects/escapement/

How a mechanical clock keeps time, shown with one clock running live in 3D. The clock is a spring-driven skeleton
bracket clock with a Graham deadbeat escapement and a half-second pendulum. English, Spanish (Latin America) and
Danish.

## What it does

- **The clock, running.** The Blender model turns in the browser exactly as the kinematics say. The pendulum swings,
  the escape wheel stands still while locked and moves half a tooth at each impulse, and every other wheel follows
  through its ratio. It runs at ¼× (slow motion), 1× (with an optional tick), 60× or 3600×; parts too fast to follow
  at a speed are drawn faint rather than flickering. *One beat* steps through a single tick, and *Show the time now*
  sets the hands to the clock on your computer. The spring runs down after 48 hours of clock time and must be wound
  in the Power tab.
- **Every part explained.** Click any of the 20 parts in the picture or the list to see its name, its job, an
  explanation and its numbers (teeth, leaves, turn time, direction). Parts behind the chapter ring are shown with the
  front taken off.
- **The power path.** A pulse runs along the path from the mainspring through the barrel, centre, third and escape
  wheels to the anchor, crutch and pendulum, and along the branch from the centre arbor through the motion work to
  the hands.
- **A real Graham escapement.** The pallets are traced from the motion: seen from the swinging anchor, the tip of the
  engaged tooth draws the locking arc (an arc about the pallet arbor: no recoil) and the impulse face, so every tooth meets
  the pallets exactly. The teeth lean forward 12° with undercut backs. A test steps through whole beats to check that no
  tooth ever passes into a pallet.
- **The gear train, drawn.** In the Gear train tab, the real tooth outlines turn with the clock (going train or motion
  work), beside a step for every mesh: who drives whom, the ratio, the centre distance and the turn times.
- **Making the gears** (`gears.html`). For every gear (seven wheels, five pinions) and the anchor: the tooth form,
  materials, tools, how each kind is made, a dimensioned drawing with an enlarged tooth, cutting data, dividing-head and
  division-plate settings, plate-hole positions, and 1:1 SVG and DXF files to cut by wire EDM, CNC or laser.
- **Tabs.** *Keeping time* has a pendulum calculator (`T = 2π√(L/g)`; 1 mm longer loses about 3 minutes a day).
  *The escapement* covers the three phases (locked, unlock and impulse, drop), with the current one lit. *Gear train*
  has a table of every arbor with its turns so far, and the ratio chain 96/12 × 80/8 × 72/6 = 960. *Power* covers
  the 48-hour reserve, what is left in the spring, and the force-for-speed trade.

## The clock

| | |
|---|---|
| Pendulum | 1 s full swing (half-second beat), L = 248.4 mm, ±3° |
| Going train | barrel 96 → centre 12/80 → third 8/72 → escape 6/30 |
| Turns | escape wheel 30 s, third 6 min, centre 1 h, barrel 8 h |
| Motion work | cannon 12 → minute wheel 36/8 → hour wheel 32 (÷12) |
| Mainspring | 6 turns = 48 h |

## Files

| Path | What it is |
|---|---|
| `src/clock.js` | The one specification and the kinematics: tooth counts, modules, arbor positions computed from the centre distances, and `pose(t)`, the angle of every moving part |
| `src/escapement.js` | The Graham escapement: the escape wheel's teeth, and the pallets and anchor traced from the motion |
| `src/gears.js` | Every gear: outlines, cutting data, dividing settings, SVG and DXF |
| `gears.html`, `gears-page.js` | The *Making the gears* page |
| `src/parts.js` | The parts catalogue: names, roles, explanations, the model nodes of each part, the power path, and which nodes move |
| `app.js`, `index.html`, `style.css` | The page (three.js, vendored in `vendor/three`) |
| `i18n.js`, `i18n-es.js`, `i18n-da.js` | Languages |
| `blender/build_clock.py` | Builds the whole clock in headless Blender from `blender/spec.json`, adds drivers, saves `skeleton_clock.blend` and exports `models/clock.glb` |
| `blender/check_motion.py` | Checks the Blender drivers against `src/clock.js` frame by frame |
| `tools/spec_json.js`, `tools/expected_poses.js` | Write the spec and the expected angles for the Blender scripts |

Rebuild the model:

```
node escapement/tools/spec_json.js > escapement/blender/spec.json
blender -b --factory-startup --python escapement/blender/build_clock.py -- escapement/blender/spec.json escapement/blender/skeleton_clock.blend escapement/models/clock.glb
node escapement/tools/expected_poses.js > expected.json
blender -b escapement/blender/skeleton_clock.blend --python escapement/blender/check_motion.py -- expected.json
```

## Tests

```
node escapement/tests/clock.test.js     # geometry, ratios, clearances, deadbeat stepping, timekeeping
node escapement/tests/parts.test.js     # catalogue against the model and the Blender drivers
node escapement/tests/gears.test.js     # tooth form = the model's, meshing, cutting data, dividing, SVG/DXF
node escapement/tests/escapement.test.js  # no tooth passes into a pallet over whole beats; deadbeat locking
node escapement/tests/i18n.test.js      # every string translated, placeholders and tags kept
node escapement/tests/release.test.js   # ?v= on every script and on the model
```

## Limits

The motion follows the escapement's rules rather than simulating forces: the pallets are shaped so the teeth meet them
exactly, but the swing does not change with the spring's force, and friction is not modelled. The manufacturing notes
are worked out from the model, not a certified drawing.
