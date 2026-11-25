# The integration spec's own decision logic (2026-11-25, section 5), kept as a
# reference for src/frontier.js. The code below is the spec's, verbatim, with
# one addition: interpolate(), which the spec calls but does not define
# (straight lines between the archetypes ordered by F, held flat at the ends).
#
#   python frontier_reference.py archetypes.json < sites.json > results.json
# reads a JSON list of site inputs and writes a JSON list of results.
import json, sys

def lin(x, a, b):
    return max(0.0, min(1.0, (x - a) / (b - a)))

GROWTH = {"low": 0.0, "medium": 0.5, "high": 1.0}

def interpolate(pts, f):
    if f <= pts[0]["F"]: return pts[0]["E"]
    if f >= pts[-1]["F"]: return pts[-1]["E"]
    for i in range(1, len(pts)):
        if f <= pts[i]["F"]:
            t = (f - pts[i - 1]["F"]) / (pts[i]["F"] - pts[i - 1]["F"])
            return pts[i - 1]["E"] + t * (pts[i]["E"] - pts[i - 1]["E"])
    return pts[-1]["E"]

def recommend(site, catalogue):
    flex = [
        ("demand_cv_weekly", lin(site["demand_cv_weekly"], 0.10, 0.60), 0.25),
        ("annual_sku_churn", lin(site["annual_sku_churn"], 0.05, 0.40), 0.20),
        ("lease_horizon_years", lin(site["lease_horizon_years"], 15, 3), 0.25),
        ("peak_to_average_ratio", lin(site["peak_to_average_ratio"], 1.3, 3.0), 0.15),
        ("growth_uncertainty", GROWTH[site["growth_uncertainty"]], 0.15),
    ]
    eff = [
        lin(site["rent_eur_per_m2_year"], 50, 200) * 0.40,
        lin(site["labour_cost_eur_per_hour"], 10, 40) * 0.35,
        lin(site["order_lines_per_day"], 5000, 100000) * 0.25,
    ]
    F_req = 100 * sum(v * w for _, v, w in flex)
    P = sum(eff)
    F_t = max(0.0, min(100.0, F_req - 30 * (P - 0.5)))

    feasible, excluded = [], []
    for a in catalogue["archetypes"]:
        c = a["constraints"]
        if site["lease_horizon_years"] < c["min_lease_years"]:
            excluded.append({"id": a["id"], "reason": "lease horizon below minimum"})
        elif site["share_skus_outside_container"] > c["max_share_skus_outside_container"]:
            excluded.append({"id": a["id"], "reason": "too many SKUs outside container"})
        elif c["requires_flat_floor"] and not site["flat_floor"]:
            excluded.append({"id": a["id"], "reason": "flat floor required"})
        else:
            feasible.append(a)

    def pick(ft):
        return sorted(feasible, key=lambda a: (abs(a["F"] - ft), -a["E"]))

    ranked = pick(F_t)
    boundary = any(pick(min(100, max(0, F_t + d)))[0]["id"] != ranked[0]["id"] for d in (-10, 10))
    pts = sorted(catalogue["archetypes"], key=lambda a: a["F"])
    E_site = interpolate(pts, F_t)  # piecewise linear on (F, E)
    drivers = sorted(flex, key=lambda d: d[1] * d[2], reverse=True)
    return {
        "F_required": round(F_req, 1), "efficiency_pressure": round(P, 2),
        "F_target": round(F_t, 1), "recommended": ranked[0]["id"],
        "runner_up": ranked[1]["id"] if len(ranked) > 1 else None,
        "boundary_case": boundary, "excluded": excluded,
        "site_point": {"F": round(F_t, 1), "E": round(E_site, 1)},
        "drivers": [{"input": n, "normalized": round(v, 2), "weight": w} for n, v, w in drivers],
        "exact": {"F_required": F_req, "efficiency_pressure": P, "F_target": F_t, "E_site": E_site},
    }

if __name__ == "__main__":
    catalogue = json.load(open(sys.argv[1], encoding="utf-8"))
    sites = json.load(sys.stdin)
    json.dump([recommend(s, catalogue) for s in sites], sys.stdout)
