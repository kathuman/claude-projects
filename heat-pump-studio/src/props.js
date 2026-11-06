// Heat Pump Studio — refrigerant properties from the CoolProp tables in data/refrigerants.js (window.HPSprops in the
// browser, module.exports in Node). Pure functions; units: T °C, p bar, h kJ/kg, s kJ/(kg·K), ρ kg/m³, v m³/kg.
//
//   fluid(name)          the property object for one refrigerant:
//     .sat(T)            saturated liquid and vapour at temperature T: p, hl, hv, sl, sv, dl, dv (linear in T, 0.5 K table)
//     .Tsat(p), .Tdew(p) bubble- and dew-point temperatures at pressure p (equal for pure fluids; R410A has a small glide)
//     .vapour(p, T)      superheated vapour at p and T ≥ Tsat(p): h, s, v (bilinear in ln p and superheat)
//     .vapourPS(p, s)    the vapour state at p with entropy s (isentropic compression): T, h, v
//     .vapourPH(p, h)    the vapour state at p with enthalpy h: T, s, v
//     .liquid(T, p)      subcooled liquid at T and p: h, s, ρ (bilinear in ln p and subcooling); without p, saturated at T
//     .Tmin, .Tmax       the range of the saturation table (Tmax = 1 K below the critical point)
(function (root) {
  "use strict";
  var DATA = root.HPS_REFRIGERANTS || (typeof require === "function" ? require("../data/refrigerants.js") : null);
  var cache = {};

  function lerp(a, b, t) { return a + (b - a) * t; }
  // index and fraction of x in an ascending array
  function locate(arr, x) {
    var lo = 0, hi = arr.length - 1;
    if (x <= arr[0]) return [0, (x - arr[0]) / (arr[1] - arr[0])];
    if (x >= arr[hi]) return [hi - 1, (x - arr[hi - 1]) / (arr[hi] - arr[hi - 1])];
    while (hi - lo > 1) { var m = (lo + hi) >> 1; if (arr[m] <= x) lo = m; else hi = m; }
    return [lo, (x - arr[lo]) / (arr[lo + 1] - arr[lo])];
  }

  function make(name) {
    var d = DATA[name]; if (!d) throw new Error("unknown refrigerant: " + name);
    var S = d.sat, G = d.sh;
    var Tmin = S.T0, Tmax = S.T0 + S.dT * (S.n - 1);
    var lnps = S.p.map(Math.log), lnpv = (S.pv || S.p).map(Math.log);
    function sat(T) {
      var x = (T - S.T0) / S.dT, i = Math.max(0, Math.min(S.n - 2, Math.floor(x))), t = x - i;
      var o = {};
      ["hl", "hv", "sl", "sv", "dl", "dv"].forEach(function (k) { o[k] = lerp(S[k][i], S[k][i + 1], t); });
      o.p = Math.exp(lerp(lnps[i], lnps[i + 1], t)); o.pv = Math.exp(lerp(lnpv[i], lnpv[i + 1], t)); o.T = T;
      return o;
    }
    function Tsat(p) {                                  // bubble point
      var L = locate(lnps, Math.log(p));
      return S.T0 + S.dT * (L[0] + L[1]);
    }
    function Tdew(p) {                                  // dew point: the vapour grid's superheat is measured from it
      var L = locate(lnpv, Math.log(p));
      return S.T0 + S.dT * (L[0] + L[1]);
    }
    var lnp0 = G.lnp[0], dlnp = G.lnp[1] - G.lnp[0], NP = G.lnp.length;
    function grid(p, dT) {
      var x = (Math.log(p) - lnp0) / dlnp, i = Math.max(0, Math.min(NP - 2, Math.floor(x))), t = x - i;
      var L = locate(G.dT, dT), j = L[0], u = L[1];
      function bil(tab) {
        return lerp(lerp(tab[i][j], tab[i][j + 1], u), lerp(tab[i + 1][j], tab[i + 1][j + 1], u), t);
      }
      return { h: bil(G.h), s: bil(G.s), v: bil(G.v) };
    }
    function vapour(p, T) {
      var dT = Math.max(0, T - Tdew(p)), r = grid(p, dT); r.T = Tdew(p) + dT; return r;
    }
    // solve along the isobar for the superheat that gives a target value of h or s (monotonic in superheat)
    function along(p, key, target) {
      var lo = 0, hi = G.dT[G.dT.length - 1];
      if (grid(p, lo)[key] >= target) return lo;
      for (var k = 0; k < 60; k++) { var m = (lo + hi) / 2; if (grid(p, m)[key] < target) lo = m; else hi = m; }
      return (lo + hi) / 2;
    }
    function vapourPS(p, s) { var dT = along(p, "s", s), r = grid(p, dT); r.T = Tdew(p) + dT; return r; }
    function vapourPH(p, h) { var dT = along(p, "h", h), r = grid(p, dT); r.T = Tdew(p) + dT; return r; }
    // subcooled liquid at pressure p and temperature T below saturation (bilinear in ln p and subcooling); without p,
    // the saturated liquid at T
    var LQ = d.lq;
    function liquid(T, p) {
      if (p == null || !LQ) { var o = sat(T); return { h: o.hl, s: o.sl, d: o.dl, T: T }; }
      var x = (Math.log(p) - lnp0) / dlnp, i = Math.max(0, Math.min(NP - 2, Math.floor(x))), t = x - i;
      var L = locate(LQ.dT, Math.max(0, Tsat(p) - T)), j = L[0], u = L[1];
      function bil(tab) { return lerp(lerp(tab[i][j], tab[i][j + 1], u), lerp(tab[i + 1][j], tab[i + 1][j + 1], u), t); }
      return { h: bil(LQ.h), s: bil(LQ.s), d: bil(LQ.d), T: T };
    }
    return {
      name: name, info: d, sat: sat, Tsat: Tsat, Tdew: Tdew, vapour: vapour, vapourPS: vapourPS, vapourPH: vapourPH, liquid: liquid,
      Tmin: Tmin, Tmax: Tmax, Tcrit: d.Tcrit, pcrit: d.pcrit,
      pmin: Math.exp(G.lnp[0]), pmax: Math.exp(G.lnp[NP - 1])
    };
  }
  function fluid(name) { return cache[name] || (cache[name] = make(name)); }
  function names() { return Object.keys(DATA); }

  root.HPSprops = { fluid: fluid, names: names };
  if (typeof module !== "undefined" && module.exports) module.exports = root.HPSprops;
})(typeof self !== "undefined" ? self : this);
