// Tierwise — world-map geometry: projection both ways, great-circle routes (including over the date line), and the
// views that fit the network, the world and a zoom.
const G = require("../src/geo.js"), N = require("../src/network.js"), P = require("../src/plan.js");
let pass = 0, fail = 0;
function check(name, cond, detail) { if (cond) pass++; else { fail++; console.log("FAIL " + name + (detail !== undefined ? "  → " + JSON.stringify(detail) : "")); } }
const near = (a, b, t) => Math.abs(a - b) <= t;

check("projection: the corners and the centre", JSON.stringify(G.project(-180, 90)) === "[0,0]" && JSON.stringify(G.project(180, -90)) === "[1000,500]" && JSON.stringify(G.project(0, 0)) === "[500,250]");
check("projection: back and forth", [[-99.13, 19.43], [175.28, -37.79], [-8.47, 51.9]].every(([lon, lat]) => { const p = G.project(lon, lat), b = G.unproject(p[0], p[1]); return near(b[0], lon, 1e-9) && near(b[1], lat, 1e-9); }));
check("projection: a point on the copy of the world to the right is the same place", near(G.unproject(1000 + 500, 250)[0], 0, 1e-9) && near(G.unproject(-250, 250)[0], 90, 1e-9));
{
  const r = G.greatCircle({ lat: 0, lon: 0 }, { lat: 0, lon: 90 }, 4);
  check("great circle: along the equator it stays on the equator, evenly spaced", r.length === 5 && r.every((c, i) => near(c[1], 0, 1e-9) && near(c[0], 22.5 * i, 1e-9)));
  const n = G.greatCircle({ lat: 50, lon: -100 }, { lat: 50, lon: 80 }, 10);
  check("great circle: between two places on opposite sides at 50°N it passes over the pole", Math.max(...n.map((c) => c[1])) > 89);
  const cork = { lat: 51.9, lon: -8.47 }, ham = { lat: -37.79, lon: 175.28 }, gc = G.greatCircle(cork, ham, 64);
  check("great circle: it starts and ends at the two places", near(gc[0][0], cork.lon, 1e-9) && near(gc[0][1], cork.lat, 1e-9) && near(((gc[64][0] + 540) % 360) - 180, ham.lon, 1e-6) && near(gc[64][1], ham.lat, 1e-9));
  const ros = { lat: -32.95, lon: -60.65 }, hz = G.greatCircle(ham, ros, 40);
  check("great circle: Hamilton to Rosario crosses the date line going east, without a jump", hz.every((c, i) => i === 0 || Math.abs(c[0] - hz[i - 1][0]) < 20) && hz[hz.length - 1][0] > 180);
  const pts = G.routePoints(ham, ros, 40);
  check("a route over the date line is drawn twice, once from each edge", JSON.stringify(G.copies(pts)) === "[0,-1000]" && JSON.stringify(G.copies(G.routePoints(cork, { lat: 39.47, lon: -0.38 }, 8))) === "[0]");
  // the arc's length matches the planner's distance
  let km = 0; for (let i = 1; i < gc.length; i++) km += P.distanceKm({ lat: gc[i - 1][1], lon: gc[i - 1][0] }, { lat: gc[i][1], lon: gc[i][0] });
  check("great circle: its length is the planner's great-circle distance", near(km, P.distanceKm(cork, ham), 5), [km, P.distanceKm(cork, ham)]);
}
{
  const sites = N.base().sites, v = G.fit(sites, 2.2);
  check("fit: every site of the example inside the view, at the asked shape", sites.every((s) => { const p = G.project(s.lon, s.lat); return p[0] >= v.x && p[0] <= v.x + v.w && p[1] >= v.y && p[1] <= v.y + v.h; }) && near(v.w / v.h, 2.2, 1e-9), v);
  const eu = G.fit([{ lat: 51.9, lon: -8.47 }, { lat: 39.47, lon: -0.38 }, { lat: 49.18, lon: -0.37 }], 2.2);
  check("fit: a European network gets a close view", eu.w < 150 && eu.x > 420 && eu.x < 480, eu);
  check("fit: a single place gets a minimum view around it", (() => { const s = G.fit([{ lat: 10, lon: 10 }], 2); return s.w >= 60 && near(s.x + s.w / 2, G.project(10, 10)[0], 1e-6); })());
  const w = G.world(2.2);
  check("world: the whole width", w.x === 0 && w.w === 1000 && near(w.h, 1000 / 2.2, 1e-9));
  const z = G.zoom(w, 2, 500, 250);
  check("zoom: twice as close about a point keeps that point in place", near(z.w, 500, 1e-9) && near((500 - z.x) / z.w, (500 - w.x) / w.w, 1e-9));
  check("zoom: limits", G.zoom(w, 1000).w >= 30 && G.zoom(w, 0.001).w <= 1050);
  check("clamp: the view cannot leave the map", (() => { const c = G.clamp({ x: 5000, y: -900, w: 200, h: 100 }); return c.x <= 1300 && c.y >= -10; })());
}
console.log(pass + "/" + (pass + fail) + " checks passed");
process.exit(fail ? 1 : 0);
