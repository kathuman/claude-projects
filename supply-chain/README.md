# Chokepoint

A 3D globe of an illustrative global supply chain that flags the trade lanes crossing risk zones and proposes
routes around them, with the transit time, cost and CO₂ each reroute adds.

**Live:** https://kathuman.github.io/claude-projects/supply-chain/

The scenario is illustrative: the sites, lanes, zones and figures are a teaching example, not operational
intelligence.

## What it does

- **The globe.** Drag to turn it, scroll to zoom; Reset view brings it back. Coastlines, a grid, the network's sites
  (factories, hubs, markets), the world's main maritime chokepoints (Malacca, Bab-el-Mandeb, Suez, Hormuz,
  Gibraltar, the Cape of Good Hope, the Taiwan Strait and Panama, with indicative canal tolls) and five risk zones.
- **The network.** Factories in Shenzhen, Ho Chi Minh City, Hsinchu and Chennai; hubs in Singapore, Jebel Ali,
  Rotterdam and Los Angeles; markets in Santos and Frankfurt. Seven trade lanes, each with a primary route and
  alternatives (for example Suez against the Cape of Good Hope against sea–air through Jebel Ali).
- **Risk zones.** The Red Sea and Bab-el-Mandeb (high), the Strait of Hormuz, the South China Sea, the Taiwan Strait
  and the Black Sea approaches (elevated), each with a radius and a short summary.
- **Exposure.** The summary counts the lanes whose active route crosses a risk zone and the transit days and lane cost
  the chosen reroutes add. Select a lane or a zone, on the globe or in the lists, to see the options: every route's
  transit days, cost, CO₂ (indexed to the primary route), tolls and which zones it crosses.
- **Reroute at-risk lanes** switches every exposed lane to its fastest route that crosses no zone (the cheaper one on
  a tie); **Restore primary** switches them back. Any route can also be picked by hand.
- Light and dark themes.

## How it works

The globe is drawn on a canvas with an orthographic projection; the view is a centre longitude, a centre latitude and
a zoom. Routes are sequences of ports and sea waypoints joined by great-circle arcs (spherical interpolation). A
route crosses a zone when any point sampled along its arcs comes within the zone's radius of its centre. The
coastlines are Natural Earth 110 m (public domain), stored in `assets/land.json`.

## Files

```
index.html         the app: data, globe, risk checks, lists and details
assets/land.json   Natural Earth 110 m land outlines
```

Built with [Claude](https://claude.com). Part of [AI Projects](https://kathuman.github.io/claude-projects/).
