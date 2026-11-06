// Turbine Lab — the physics behind the page (window.TLphys in the browser, module.exports in Node).
// Pure functions only: no DOM, no three.js. Units are SI unless the name says otherwise (kW, rpm).
//
//   Head-driven machines (Pelton, Francis):   P = ρ · g · Q · H · η
//   Current-driven machines (in-stream Kaplan and the wind twins):   P = ½ · ρ · A · v³ · Cp
//
// The efficiency curves are typical shapes for each kind of machine (in the style of the ESHA small-hydro guide), not
// the curve of any one machine: what they teach is the shape — how much each kind loses away from its rated flow.
(function (root) {
  "use strict";
  var G = 9.81, RHO_WATER = 1000, RHO_AIR = 1.225, BETZ = 16 / 27;

  // ---- efficiency against load (fraction of rated flow, or of rated current speed for in-stream machines)
  var LOADS = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0];
  var CURVES = {
    pelton:    [0.78, 0.85, 0.88, 0.895, 0.90, 0.905, 0.907, 0.907, 0.905, 0.90],
    francis:   [0.25, 0.45, 0.62, 0.75, 0.83, 0.88, 0.915, 0.935, 0.94, 0.925],
    kaplan:    [0.60, 0.80, 0.86, 0.89, 0.91, 0.92, 0.925, 0.93, 0.93, 0.925],
    propeller: [0.10, 0.20, 0.35, 0.50, 0.62, 0.73, 0.82, 0.89, 0.93, 0.92]
  };
  function clamp(x, a, b) { return x < a ? a : x > b ? b : x; }
  // linear interpolation in the table; below 10 % load the curve falls linearly to zero at no load
  function efficiency(kind, load) {
    var c = CURVES[kind]; if (!c) throw new Error("unknown turbine kind: " + kind);
    var q = clamp(load, 0, 1);
    if (q <= LOADS[0]) return c[0] * q / LOADS[0];
    var i = Math.min(LOADS.length - 2, Math.floor((q - LOADS[0]) / 0.1 + 1e-9));
    var t = (q - LOADS[i]) / (LOADS[i + 1] - LOADS[i]);
    return c[i] + t * (c[i + 1] - c[i]);
  }
  function peakEfficiency(kind) { return Math.max.apply(null, CURVES[kind]); }

  // ---- power
  function hydroPower(Q, H, eta, rho) { return (rho || RHO_WATER) * G * Q * H * eta; }           // W
  function kineticPower(v, A, cp, rho) { return 0.5 * (rho || RHO_WATER) * A * v * v * v * cp; } // W
  function discArea(D) { return Math.PI * D * D / 4; }

  // ---- Pelton: jet and bucket
  // Jet speed from the head (Cv: nozzle velocity coefficient). A bucket moving at u turns the relative flow by θ and
  // keeps a fraction k of its speed; Euler's turbine equation then gives the hydraulic efficiency
  //   ηh = 2 · x · (1 − x) · (1 − k·cos θ),  x = u / c.   With k = 1 and θ = 180° the best is x = ½, ηh = 1.
  function jetVelocity(H, cv) { return (cv == null ? 0.98 : cv) * Math.sqrt(2 * G * H); }
  function peltonEfficiency(x, k, thetaDeg) {
    var kk = k == null ? 0.9 : k, th = (thetaDeg == null ? 165 : thetaDeg) * Math.PI / 180;
    return Math.max(0, 2 * x * (1 - x) * (1 - kk * Math.cos(th)));
  }
  function jetDiameter(Q, c) { return Math.sqrt(4 * Q / (Math.PI * c)); }

  // ---- speeds
  function rpmFromTipSpeed(u, D) { return 60 * u / (Math.PI * D); }
  // Francis: peripheral speed u1 = ku · √(2gH) at the runner inlet
  function francisRpm(H, D, ku) { return rpmFromTipSpeed((ku == null ? 0.75 : ku) * Math.sqrt(2 * G * H), D); }
  // in-stream rotor: tip-speed ratio λ = ωR / v
  function rotorRpm(v, D, tsr) { return (tsr == null ? 4 : tsr) * v / (D / 2) * 60 / (2 * Math.PI); }
  // nearest synchronous generator speed at or below n for a 50 Hz grid: 3000 / pole pairs
  function synchronousRpm(n, hz) { var f = hz || 50, p = Math.max(1, Math.ceil(60 * f / n)); return 60 * f / p; }

  // ---- specific speed: metric Ns = n · √P(kW) / H^1.25 (n in rpm). Each kind of runner works well in its own band.
  function specificSpeed(nRpm, PkW, H) { return nRpm * Math.sqrt(PkW) / Math.pow(H, 1.25); }
  var NS_BANDS = { pelton: [8, 35], francis: [60, 400], kaplan: [300, 1000] };
  function nsKinds(ns) { return Object.keys(NS_BANDS).filter(function (k) { return ns >= NS_BANDS[k][0] && ns <= NS_BANDS[k][1]; }); }

  // ---- which turbine for a site: approximate head–flow envelopes, as on manufacturers' selection charts
  // (flow m³/s, head m). Overlaps are real: near a border more than one kind works and the choice turns on cost.
  var ZONES = {
    pelton:  [[0.02, 50], [0.02, 1800], [10, 1800], [40, 700], [40, 300], [8, 120], [1.5, 50]],
    francis: [[0.5, 10], [0.3, 40], [0.3, 300], [2, 700], [30, 700], [300, 350], [800, 100], [800, 30], [150, 10]],
    kaplan:  [[1, 1.5], [1, 20], [5, 70], [200, 70], [1000, 40], [1000, 1.5]]
  };
  function logPoly(poly) { return poly.map(function (p) { return [Math.log10(p[0]), Math.log10(p[1])]; }); }
  function inside(pt, poly) {
    var x = pt[0], y = pt[1], c = false;
    for (var i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      var xi = poly[i][0], yi = poly[i][1], xj = poly[j][0], yj = poly[j][1];
      if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) c = !c;
    }
    return c;
  }
  function edgeDistance(pt, poly) {
    var best = Infinity;
    for (var i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      var ax = poly[j][0], ay = poly[j][1], bx = poly[i][0], by = poly[i][1], dx = bx - ax, dy = by - ay;
      var t = clamp(((pt[0] - ax) * dx + (pt[1] - ay) * dy) / (dx * dx + dy * dy), 0, 1);
      var ex = ax + t * dx - pt[0], ey = ay + t * dy - pt[1];
      best = Math.min(best, Math.sqrt(ex * ex + ey * ey));
    }
    return best;
  }
  // every kind whose zone holds the site, best first (deepest inside the zone, in decades); an empty list means no
  // conventional turbine fits (too little head: an in-stream machine, or too much water for the head: several units)
  function selectTurbine(Q, H) {
    var pt = [Math.log10(Q), Math.log10(H)];
    return Object.keys(ZONES).map(function (k) { var poly = logPoly(ZONES[k]); return { kind: k, inside: inside(pt, poly), depth: edgeDistance(pt, poly) }; })
      .filter(function (r) { return r.inside; })
      .sort(function (a, b) { return b.depth - a.depth; })
      .map(function (r) { return { kind: r.kind, depth: r.depth }; });
  }

  // ---- water against air
  // dynamic pressure of a stream, written as the height of a water column ("equivalent head")
  function equivalentHead(v, rho) { return (rho || RHO_WATER) * v * v / (2 * RHO_WATER * G); }
  // the air speed that carries as much power through the same area as water at vWater
  function matchingAirSpeed(vWater) { return vWater * Math.cbrt(RHO_WATER / RHO_AIR); }

  root.TLphys = {
    G: G, RHO_WATER: RHO_WATER, RHO_AIR: RHO_AIR, BETZ: BETZ,
    LOADS: LOADS, CURVES: CURVES, NS_BANDS: NS_BANDS, ZONES: ZONES,
    efficiency: efficiency, peakEfficiency: peakEfficiency,
    hydroPower: hydroPower, kineticPower: kineticPower, discArea: discArea,
    jetVelocity: jetVelocity, peltonEfficiency: peltonEfficiency, jetDiameter: jetDiameter,
    rpmFromTipSpeed: rpmFromTipSpeed, francisRpm: francisRpm, rotorRpm: rotorRpm, synchronousRpm: synchronousRpm,
    specificSpeed: specificSpeed, nsKinds: nsKinds, selectTurbine: selectTurbine,
    equivalentHead: equivalentHead, matchingAirSpeed: matchingAirSpeed
  };
  if (typeof module !== "undefined" && module.exports) module.exports = root.TLphys;
})(typeof self !== "undefined" ? self : this);
