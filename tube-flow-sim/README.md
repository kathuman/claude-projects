# Tube Flow — a validated lattice-Boltzmann flow lab

By [kathuman](https://github.com/kathuman). Flow through a tube past a sphere, in 3D, with real fluids
and units and live measurements. Live: https://kathuman.github.io/claude-projects/tube-flow-sim/

## Files

- `index.html` — the page: case setup, 3D view (three.js), tracers, slices, measurements panel.
- `src/lbm.js` — the solver (browser + Node), D3Q19 lattice Boltzmann:
  - TRT collision where the grid Reynolds number u·Δx/ν is low (its walls sit exactly where they
    should at any viscosity), regularised BGK where it is high (stability at τ → ½);
  - curved walls by linear interpolated bounce-back (Bouzidi): every lattice link knows where it
    crosses the sphere or the tube wall; the tube wall can slide along the axis (moving-sphere frame);
  - velocity inlet and pressure outlet by non-equilibrium extrapolation — mass is conserved without
    renormalisation; an outlet sponge (raised viscosity in the last 12%) damps pressure waves;
  - the flow starts from the inflow profile and speed changes are eased in, so there are no
    start-up shocks;
  - forces on the sphere and the wall by momentum exchange; per-cross-section wall force.
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
- `tests/lbm.test.js` — validation (below); `tests/gpu.test.js` + `gpu-parity.html` — GPU vs CPU
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

### GPU solver

`tests/gpu.test.js` (Playwright + a WebGPU-capable Chromium) runs both solvers on the same cases —
pipe flow with TRT and with regularised collision, and the moving-sphere frame — and requires the
same flow: velocity within 2·10⁻⁵ (5·10⁻⁴ of the speed at Re 1, float32 summation order), sphere drag
within 0.01%, mass within 10⁻⁶. On a laptop's integrated GPU (Intel Xe) it runs ~160 million lattice
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
- **v4 (current)** — visualisation: dye, vortex surfaces, streamlines, movable cross-section,
  time-averaged slice, video recording, three.js r186.
- **v5** — experiment workbench: shapes and STL import, inflow options, parameter sweeps against
  literature curves, batch runs, saved runs, VTK/CSV/JSON export.
- **v6** — trust and teaching: validation report page, grid-convergence studies, guided labs.
