# Tube Flow — a validated lattice-Boltzmann flow lab

By [kathuman](https://github.com/kathuman). Flow through a tube past a sphere — or an ellipsoid, cylinder,
disc, cube, a bar across the tube, a wing section (NACA airfoil at an angle of attack), or your own STL shape — in 3D, with real fluids and units, live
measurements, Reynolds sweeps against published curves, saved runs and VTK export. Live: https://kathuman.github.io/claude-projects/tube-flow-sim/

## Files

- `index.html` — the page: case setup (fluid, tube, body, inflow), 3D view, measurements, and the
  workbench: Reynolds sweeps plotted against Schiller–Naumann and the Haberman–Sayre wall-corrected
  Stokes drag, saved runs (this browser's storage, plus JSON export/import) with side-by-side comparison,
  and exports — CSV and JSON time series, VTK (legacy binary structured points: velocity, gauge pressure,
  solid mask, in SI units) for ParaView.
- `src/lbm.js` — the solver (browser + Node), D3Q19 lattice Boltzmann:
  - TRT collision where the grid Reynolds number u·Δx/ν is low (its walls sit exactly where they
    should at any viscosity), regularised BGK where it is high (stability at τ → ½);
  - curved walls by linear interpolated bounce-back (Bouzidi): every lattice link knows where it
    crosses the sphere or the tube wall; the tube wall can slide along the axis (moving-sphere frame);
  - velocity inlet and pressure outlet by non-equilibrium extrapolation — mass is conserved without
    renormalisation; an outlet sponge (raised viscosity in the last 12%) damps pressure waves;
  - the flow starts from the inflow profile and speed changes are eased in, so there are no
    start-up shocks;
  - forces on the body and the wall by momentum exchange; per-cross-section wall force.
  - bodies (`makeBody`): sphere and ellipsoid with exact link crossings; cylinder, disc, cube and a bar
    across the tube by bisection on an inside test; closed triangle meshes (`parseSTL`, binary or ASCII)
    scaled to the chosen width, with an inside test by ray parity over binned triangles and a
    watertightness check. Re and C_d use the body's width and frontal area.
  - wing sections: NACA 4-digit airfoils (symmetric or cambered) pivoting about the quarter chord at an angle of
    attack, wall to wall (2D section) or of finite span; chord = 2a, planform area chord × span as the reference.
    Links between two fluid nodes that pass through a part thinner than a cell (the trailing edge) bounce back
    too (`crossThin`, wings and meshes) — without them flow leaks through the trailing edge and camber makes
    almost no lift. `thinAirfoil(naca)` gives α_L0 and 2π(α − α_L0) for comparison.
    On the page, a wing turns the view (the world group rotates so lift points up and the default camera
    looks along the span at the profile); the axial slice can lie in the profile plane (mid-span) or the
    planform plane, with the body cut away on the camera's side of the slice; and a chart shows the
    surface pressure coefficient C_p along the chord at mid-span (read 1.5 cells off the surface, p∞ from
    1.5 chords upstream). Integrated around the section it gives C_L 0.73 against 0.78 from the total
    force (NACA 0012, 8°, Re 400; the rest is skin friction). The wing blocks 15% of the tube (more, counting
    the thick boundary layers at Re 400), so the flow speeds up past it and C_p is lower all round than in open air.
  - inflow: developed (parabolic), uniform plug, or pulsatile — the flow rate swings sinusoidally at a
    chosen amplitude and Womersley number α = R√(ω/ν).
  - `caseToLattice()` maps a physical case (fluid, tube, sphere, speed) onto the grid at Mach ≤ 0.17
    and τ ≥ 0.51, and flags cases the grid can't resolve instead of running them wrongly.
- `src/lbm-gpu.js` — the same scheme on the GPU (WebGPU compute: collide, stream, per-link
  interpolated bounce-back with momentum exchange, inlet, outlet; populations stored
  direction-major). Geometry comes from the CPU solver (`geometryOnly`), readouts (forces, cross-
  sections, wake axis, slice, a downsampled field, mass) are gathered on the GPU and read back a few
  times a second. Used automatically when the browser has WebGPU; the CPU worker is the fallback.
- `src/view.js` — the 3D view (three.js r186, vendored in `vendor/three`): tracers; dye carried by the
  flow (MacCormack semi-Lagrangian advection on the streamed velocity field, released from a rake or
  the sphere, ray-marched as a 3D texture); Q-criterion vortex surfaces (surface nets, one-sided
  differences at walls, coloured by the sense of rotation); streamlines from a rake (RK2); axial slice
  (speed, vorticity, pressure, optionally time-averaged) and a movable cross-section; WebM recording.
  It runs on whatever the solver streams, so every view works on both the GPU and the CPU solver.
- `src/sim-worker.js` — runs the CPU solver in a Web Worker and streams the field and the measurements.
- `src/labs.js` — five guided labs (Stokes' law and the walls, separation and the wake bubble, shape and
  drag, vortex shedding, pulsatile flow and the Womersley number): steps that point at the control
  involved, tick themselves off from the live state, and can be done for you.
- `validation.html` — the validation report: every case with its reference, tolerance, result and a plot;
  recorded results from `tests/validation-results.json`, re-runnable in the browser
  (`src/validation.js` in `src/validation-worker.js`), plus GPU/CPU parity (`src/gpu-parity.js`) and the
  sphere-wake benchmark.
- `tests/lbm.test.js` — validation (below); `tests/validation.test.js` — the report's suite, including
  grid convergence (writes `tests/validation-results.json`); `tests/gpu.test.js` + `gpu-parity.html` — GPU vs CPU
  parity; `tests/benchmark.js` + `gpu-bench.html` — long GPU runs against published sphere data.

## Validation

`node tube-flow-sim/tests/lbm.test.js`:

| Check | Reference | Result |
|---|---|---|
| Pipe-flow velocity profile | Hagen–Poiseuille | within 0.5% of the centre-line speed |
| Pipe-flow pressure gradient | 4μu_c/R² | within 4% |
| Mass flux along the tube, total mass | conservation | 0.1%, 10⁻⁷ |
| Stokes drag on a sphere moving along a tube (λ = 0.3) | Haberman–Sayre wall-corrected Stokes drag | within 3.4% with the sphere 6 cells across (1.8% at 8.4 cells) |
| Pressure + momentum flux vs. forces on sphere and wall | momentum balance | within 2.1% |
| Recirculation bubble | absent at Re 5, grows from Re 60 to 120 | yes |
| Steady state at Re 100, speed changes | no lingering waves | steady to 1%, inlet density within 1.5% |
| Case mapping | Re, Mach, τ, force/pressure scales | exact |
| Ellipsoid 2:1, axial cylinder 1.5:1, cube | solid cells vs. volume | −0.1%, −3.2%, −2.8% |
| Link crossings by bisection (generic shapes) | exact sphere intersections | 3·10⁻⁸ |
| STL cube (binary = ASCII) | cube primitive | identical cells; frontal area exact |
| STL sphere (5120 triangles), Stokes drag | exact sphere | −0.1% |
| Uniform inflow | develops into Poiseuille flow | centre/mean 1.07 at the inlet → 1.94 (2 exact) |
| Pulsatile inflow, 40% amplitude | imposed flow rate | amplitude 0.397, lag 2.9° |
| Wing NACA 0012, cells vs. section area × span | 0.684·t·c² | −5.6% (trailing edge thinner than a cell) |
| Thin-airfoil zero-lift angle, NACA 2412 | −2.077° | −2.077° |
| NACA 0012, α = 0 / 6° (Re 600, uniform stream) | no lift / thin-airfoil 0.66 | 6·10⁻¹⁶ / C_L 0.73 (the tube's walls raise it) |
| Camber at α = 0: NACA 4412, 2412 | lift, 4412 > 2412 > 0 | C_L 0.167, 0.098 (≈ 40% of inviscid at Re 600) |
| Short wing, aspect ratio 0.6, α = 6° | slender-wing theory C_L ≈ (πA/2)·α ≈ 0.10 | C_L 0.16 at Re 600 (0.099 at Re 200); 4.6× less than wall to wall |

### Grid convergence (`tests/validation.test.js`)

| Study | Grids | Result |
|---|---|---|
| Pipe flow, RMS velocity-profile error | 8, 12, 16, 24, 32 cells across | observed order **1.84** |
| Pipe flow, flow rate | 8 → 16 → 32 cells (ratio 2) | order 2.28; Richardson-extrapolated flow rate within **0.18%** of exact; GCI 0.83% |
| Stokes drag with wall factor (λ = 0.3) | sphere 6, 7.5, 9, 9.6 cells across | −3.3, −2.6, −4.1, −1.8% — scatter ±1% |

The drag on a small body does not converge monotonically: where its surface falls between lattice nodes
scatters it by about ±1%, more than the resolution trend at 6–10 cells across, so Richardson
extrapolation doesn't apply (ASME V&V 20 calls this oscillatory convergence); the spread is reported as
the uncertainty — about ±3% for bodies 6–10 cells across. Below about 6 cells the error grows fast (12%
low at 4.8 cells), which is why the app flags grids that can't resolve a case.

### GPU solver

`tests/gpu.test.js` (Playwright + a WebGPU-capable Chromium) runs both solvers on the same cases —
pipe flow with TRT and with regularised collision, and the moving-sphere frame — and requires the
same flow: velocity within 2·10⁻⁵ (5·10⁻⁴ of the speed at Re 1, float32 summation order), body drag
within 0.01%, mass within 10⁻⁶ — also for a cube with pulsatile inflow and a bar across the tube with
uniform inflow (the inflow speed of every step in a batch is passed to the GPU, so pulses match exactly). On a laptop's integrated GPU (Intel Xe) it runs ~160 million lattice
updates per second — a 1.25-million-cell grid at ~130 steps/s.

### Benchmark: sphere in nearly unbounded flow (GPU)

`tests/benchmark.js`: moving-sphere frame, blockage 0.2, sphere 16 cells across, 1.8 million cells,
compared with Johnson & Patel (1999, J. Fluid Mech. 378, 19–70):

| Re | Quantity | Simulation | Johnson & Patel (unbounded sphere) |
|---|---|---|---|
| 100 | recirculation length L/d | **0.86** | 0.88 |
| 100 | drag coefficient C_d | 1.20 | 1.09 — the tube's 20% blockage raises the drag |
| 300 | wake | steady, asymmetric (oblique) | steady planar-symmetric from Re ≈ 210 |
| 300 | mean lift coefficient | **0.066** | ≈ 0.065 |
| 300 | drag coefficient C_d | 0.82 | 0.66 (blockage) |

| 376 | wake | periodic vortex shedding | periodic shedding above Re ≈ 270 |
| 376 | Strouhal number St | **0.150** | 0.137 at Re 300, rising toward ~0.17 at Re 500 |

The symmetry-breaking of the wake and its side force are reproduced closely, and the wake sheds
vortices at a Strouhal number in the published range. The blockage delays the onset: at Re 300 the
oblique wake stays steady (open-flow shedding starts at Re ≈ 270). In the app's default pipe-flow
configuration (sphere 30% of the tube, parabolic inflow) shedding is weak at Re 450 (St 0.135) and
clear by Re 500 — the GPU "Unsteady wake" preset.

## Roadmap

- **v2** — validated solver, real units, measurements (drag, lift, Strouhal, pressure drop,
  recirculation, mass balance), measured regime, CSV export, kathuman credit.
- **v3** — GPU solver (WebGPU), parity-tested against the CPU solver; grids up to 96 cells
  across the tube (sphere ~20–30 cells); wake symmetry-breaking and unsteady wakes resolved; benchmark against Johnson & Patel.
  (LES for higher Reynolds numbers moves to a later version.)
- **v4** — visualisation: dye, vortex surfaces, streamlines, movable cross-section,
  time-averaged slice, video recording, three.js r186.
- **v5** — experiment workbench: shapes and STL import, inflow options (parabolic, uniform,
  pulsatile), Reynolds sweeps against literature curves, saved runs and comparison, VTK/CSV/JSON export.
- **v6 (current)** — trust and teaching: validation report page (re-runnable in the browser), grid-convergence
  studies with Richardson extrapolation and GCI, five guided labs.
