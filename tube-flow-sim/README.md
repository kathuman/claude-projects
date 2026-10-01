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
- `src/sim-worker.js` — runs the solver in a Web Worker and streams the field and the measurements.
- `tests/lbm.test.js` — validation (below).

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

## Roadmap

- **v2 (current)** — validated solver, real units, measurements (drag, lift, Strouhal, pressure drop,
  recirculation, mass balance), measured regime, CSV export, kathuman credit.
- **v3** — GPU solver (WebGPU) for grids of millions of cells: resolved vortex shedding, benchmarks
  against published sphere data (separation, wake length, Strouhal), optional LES.
- **v4** — visualisation: dye, vortex isosurfaces, streamlines, movable slices, time averages, video.
- **v5** — experiment workbench: shapes and STL import, inflow options, parameter sweeps against
  literature curves, batch runs, saved runs, VTK/CSV/JSON export.
- **v6** — trust and teaching: validation report page, grid-convergence studies, guided labs.
