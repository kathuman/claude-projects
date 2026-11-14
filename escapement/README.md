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
node escapement/tests/i18n.test.js      # every string translated, placeholders and tags kept
node escapement/tests/release.test.js   # ?v= on every script and on the model
```

## Limits

The motion follows the escapement's rules rather than simulating forces and contact, so the pallets do not visibly
touch each tooth, the swing does not change with the spring's force, and friction is not modelled.
