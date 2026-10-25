# Network Design Visuals

A working library of the charts and maps used in supply chain network design, from the plots that go in a status
deck to the analyses that drive a network study.

**Live:** https://kathuman.github.io/claude-projects/supply-chain-viz/

## What it does

Network design asks where to make things, where to hold them, and how they should flow to customers at the lowest
total cost for a target service level. Each of those questions has a picture that makes the answer clear. The
library shows 17 of them, in four tiers, all drawn live with hover read-outs:

| Tier | Visuals |
|---|---|
| Foundational | Regional demand bars · Cost-to-serve stack · Facility and demand map · Demand over time |
| Operational | Origin–destination flow map · Echelon flow (Sankey) · Lane cost matrix · Cost concentration (Pareto) |
| Analytical | Capacitated network graph · Service-level coverage · Cost–service frontier · Sensitivity tornado |
| Strategic | Centre of gravity and greenfield · Catchment assignment · Animated flow · Network evolution · Disruption impact matrix |

Every visual runs on the same small synthetic network (5 suppliers, 3 plants, 5 distribution centres and 12 demand
regions), so the same facts are shown again as the questions get harder. The data is illustrative.

## How it works

- **One network for all.** The network is defined once at the top of the page's script; every visual derives its
  numbers from it.
- **Transit and flows.** Transit time grows with distance (one day plus a fixed amount per unit of distance). The
  Sankey flows balance: each region's inflow equals its demand, allocated back up the chain.
- **Capacity.** The catchment and disruption views give each distribution centre a market-facing capacity. A failed
  centre's demand is rerouted to the others within those limits, and only the extra shortfall the failure causes is
  counted.
- **Drawing and colours.** Everything is drawn as inline SVG with no libraries. Colours follow a fixed data-viz
  palette (a blue sequential scale, a fixed order for categories and reserved status colours), and light and dark
  themes redraw the active visual.

## Files

```
index.html   the library: data, the 17 visuals, navigation and themes
```

Built with [Claude](https://claude.com). Part of [AI Projects](https://kathuman.github.io/claude-projects/).
