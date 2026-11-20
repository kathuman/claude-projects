"""Instant health checks for a network, for the Network Studio: numbers a planner should see while editing.

These are not errors (the network is valid); they are signs it may not work well:
- plant and supplier load against capacity, at mean demand and the normal sourcing split;
- chilled shelf life against the time stock spends in transit and at the DC;
- suppliers with no normal volume (backups), markets with no demand;
- lane distances far from the straight-line distance between their ends.
"""

from __future__ import annotations

import math
from typing import Literal

from core.domain.common import Model
from core.domain.network import Network

ROAD_FACTOR = 1.25  # road distance ≈ great-circle distance × this factor


class Finding(Model):
    severity: Literal["info", "warning"]
    target: str | None  # the node, lane or SKU it concerns
    message: str
    value: float | None = None


class Health(Model):
    findings: list[Finding]
    plant_load: dict[str, float]  # share of capacity used at mean demand
    supplier_load: dict[str, float]


def great_circle_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp, dl = p2 - p1, math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 6371.0 * 2 * math.asin(min(1.0, math.sqrt(a)))


def suggested_distance_km(net: Network, origin: str, destination: str) -> float | None:
    """Great-circle distance × a road factor, when both ends have coordinates."""
    loc = {x.id: x.location for g in (net.suppliers, net.plants, net.dcs, net.markets) for x in g}
    a, b = loc.get(origin), loc.get(destination)
    if a is None or b is None or a.lat is None or b.lat is None or a.lon is None or b.lon is None:
        return None
    return round(great_circle_km(a.lat, a.lon, b.lat, b.lon) * ROAD_FACTOR, 0)


def check(net: Network) -> Health:
    from core.sim.layout import build_layout

    lay = build_layout(net)
    out = lay.mean_node_demand()  # [N, K] units per period
    findings: list[Finding] = []
    plant_load: dict[str, float] = {}
    for p, plant in enumerate(net.plants):
        load = float(out[p].sum() / plant.capacity_per_period)
        plant_load[plant.id] = round(load, 4)
        if load > 1:
            findings.append(Finding(severity="warning", target=plant.id, value=load,
                                    message=f"{plant.id} needs {load:.0%} of its capacity at mean demand: it cannot "
                                    "keep up"))
        elif load > 0.85:
            findings.append(Finding(severity="warning", target=plant.id, value=load,
                                    message=f"{plant.id} runs at {load:.0%} of capacity at mean demand: little room "
                                    "for peaks"))
    supplier_load: dict[str, float] = {}
    for s, sup in enumerate(net.suppliers):
        demand = sum(float(lay.base_share[p, s]) * float(out[p].sum()) for p in range(lay.P))
        load = demand / sup.capacity_per_period
        supplier_load[sup.id] = round(load, 4)
        if demand == 0:
            findings.append(Finding(severity="info", target=sup.id, value=0.0,
                                    message=f"{sup.id} has no normal volume: a backup supplier"))
        elif load > 0.9:
            findings.append(Finding(severity="warning", target=sup.id, value=load,
                                    message=f"{sup.id} is loaded to {load:.0%} of its capacity in normal times"))
    for sku in net.skus:
        if sku.shelf_life_days is None:
            continue
        worst = 0.0
        for d in net.dcs:
            ln = net.lane(net.source_plant(d.id, sku.id), d.id)
            if ln is not None:
                worst = max(worst, ln.lead_time_days.mean())
        need = worst + net.period_days  # in transit, then at least a week at the DC
        if sku.shelf_life_days < need + net.period_days:
            findings.append(Finding(severity="warning", target=sku.id, value=float(sku.shelf_life_days),
                                    message=f"{sku.id} keeps {sku.shelf_life_days} days; transit and a week at the DC "
                                    f"take about {need:.0f}, leaving little time to sell"))
    for m in net.markets:
        if m.size_factor == 0 and not any(o.market == m.id for o in net.demand_overrides):
            findings.append(Finding(severity="info", target=m.id, value=0.0, message=f"{m.id} has no demand"))
    for ln in net.lanes:
        sug = suggested_distance_km(net, ln.origin, ln.destination)
        if sug and sug > 0 and (ln.distance_km < 0.5 * sug or ln.distance_km > 2 * sug):
            findings.append(Finding(severity="info", target=ln.id, value=ln.distance_km,
                                    message=f"{ln.id} is {ln.distance_km:g} km; its ends are about {sug:g} km apart "
                                    "by road"))
    return Health(findings=findings, plant_load=plant_load, supplier_load=supplier_load)
