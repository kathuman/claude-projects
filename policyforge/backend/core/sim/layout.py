"""The network as index arrays for the vectorised engine.

Stocking nodes are the plants followed by the DCs: node index `n < P` is a plant, `n ≥ P` is DC `n − P`. A *cell* is
a (node, SKU) pair that holds stock: every DC holds every SKU, and a plant holds the SKUs it makes.
"""

from __future__ import annotations

import math
from dataclasses import dataclass

import numpy as np
from numpy.typing import NDArray

from core.domain.network import Lane, Network

F = NDArray[np.float64]
I = NDArray[np.int64]  # noqa: E741 - short alias for integer arrays
B = NDArray[np.bool_]


@dataclass(frozen=True)
class Layout:
    net: Network
    period_days: int
    sku_ids: list[str]
    supplier_ids: list[str]
    plant_ids: list[str]
    dc_ids: list[str]
    market_ids: list[str]
    node_ids: list[str]  # plants then DCs
    # SKUs
    chilled: B  # [K]
    shelf_periods: I  # [K]; 0 for ambient (never spoils)
    lost_sale: B  # [K]
    unit_cost: F
    holding: F
    backorder_penalty: F
    lost_penalty: F
    weight_t: F  # tonnes per unit
    sku_class: list[str]
    # cells
    cell: B  # [N, K]: the node holds this SKU
    # markets
    market_dc: I  # [M] → DC index
    demand_mean: F  # [M, K] units per period
    demand_cv: F  # [M, K]
    season_amp: F  # [K]
    season_peak: I  # [K]
    # plants and suppliers
    plant_cap: F  # [P]
    production_cost: F  # [P]
    makes: B  # [P, K]
    supplier_cap: F  # [S]
    supplier_cost_index: F  # [S]
    supplier_fill_mean: F  # [S]
    supplier_fill_sd: F  # [S]
    ordering_cost: F  # [S]
    base_share: F  # [P, S]
    # DC sourcing
    dc_source: I  # [D, K] → plant index
    # lanes with lead times: supplier→plant and plant→DC, indexed 0..L−1
    lanes: list[Lane]
    sp_lane: I  # [P, S] → lane index, −1 when there is no lane
    pd_lane: I  # [P, D] → lane index, −1 when there is no lane
    lane_cost: F  # [L]
    lane_km: F  # [L]
    lane_co2: F  # [L] kg CO2e per tonne-km
    lane_has_expedite: B  # [L]
    exp_cost_mult: F  # [L]
    exp_co2: F  # [L]
    # DC → market delivery
    dm_cost: F  # [M]
    dm_km: F  # [M]
    dm_co2: F  # [M]

    @property
    def P(self) -> int:
        return len(self.plant_ids)

    @property
    def D(self) -> int:
        return len(self.dc_ids)

    @property
    def N(self) -> int:
        return len(self.node_ids)

    @property
    def K(self) -> int:
        return len(self.sku_ids)

    @property
    def M(self) -> int:
        return len(self.market_ids)

    @property
    def S(self) -> int:
        return len(self.supplier_ids)

    def mean_node_demand(self) -> F:
        """[N, K] mean outflow per period of each cell (DCs: their markets; plants: the DCs they supply)."""
        out = np.zeros((self.N, self.K))
        for m in range(self.M):
            out[self.P + self.market_dc[m]] += self.demand_mean[m]
        for d in range(self.D):
            for k in range(self.K):
                out[self.dc_source[d, k], k] += out[self.P + d, k]
        return out

    def days_to_periods(self, days: F) -> I:
        """Lead time in whole periods: at least 1 (an order arrives at the earliest next period)."""
        return np.maximum(1, np.ceil(days / self.period_days - 1e-9)).astype(np.int64)


def build_layout(net: Network) -> Layout:
    skus = net.skus
    K = len(skus)
    sup = [s.id for s in net.suppliers]
    pl = [p.id for p in net.plants]
    dcs = [d.id for d in net.dcs]
    mk = [m.id for m in net.markets]
    P, D, M, S = len(pl), len(dcs), len(mk), len(sup)
    pd = net.period_days

    lanes = [ln for ln in net.lanes if net.node_kind(ln.origin) != "dc"]
    lane_index = {(ln.origin, ln.destination): i for i, ln in enumerate(lanes)}
    sp_lane = np.array([[lane_index.get((s, p), -1) for s in sup] for p in pl], dtype=np.int64)
    pd_lane = np.array([[lane_index.get((p, d), -1) for d in dcs] for p in pl], dtype=np.int64)
    ef = net.emission_factors

    makes = np.array([[s.id in p.skus for s in skus] for p in net.plants])
    cell = np.vstack([makes, np.ones((D, K), dtype=bool)])
    base_share = np.zeros((P, S))
    for i, p in enumerate(net.plants):
        for sh in p.sourcing:
            base_share[i, sup.index(sh.supplier)] = sh.share
    dm = [net.lane(m.served_by, m.id) for m in net.markets]

    def f(xs: list[float]) -> F:
        return np.asarray(xs, dtype=np.float64)

    return Layout(
        net=net,
        period_days=pd,
        sku_ids=[s.id for s in skus],
        supplier_ids=sup,
        plant_ids=pl,
        dc_ids=dcs,
        market_ids=mk,
        node_ids=pl + dcs,
        chilled=np.array([s.category == "chilled" for s in skus]),
        shelf_periods=np.array(
            [max(1, math.floor(s.shelf_life_days / pd)) if s.shelf_life_days else 0 for s in skus], dtype=np.int64
        ),
        lost_sale=np.array([s.unmet_demand == "lost_sale" for s in skus]),
        unit_cost=f([s.unit_cost for s in skus]),
        holding=f([s.holding_cost_per_unit_period for s in skus]),
        backorder_penalty=f([s.backorder_penalty_per_unit_period for s in skus]),
        lost_penalty=f([s.lost_sale_penalty_per_unit for s in skus]),
        weight_t=f([s.weight_kg / 1000 for s in skus]),
        sku_class=[s.abc_class for s in skus],
        cell=cell,
        market_dc=np.array([dcs.index(m.served_by) for m in net.markets], dtype=np.int64),
        demand_mean=np.array([[net.demand_mean(m, s.id) for s in skus] for m in mk], dtype=np.float64).reshape(M, K),
        demand_cv=np.array([[net.demand_cv(m, s.id) for s in skus] for m in mk], dtype=np.float64).reshape(M, K),
        season_amp=f([s.seasonality_amplitude for s in skus]),
        season_peak=np.array([s.seasonality_peak_period for s in skus], dtype=np.int64),
        plant_cap=f([p.capacity_per_period for p in net.plants]),
        production_cost=f([p.production_cost_per_unit for p in net.plants]),
        makes=makes,
        supplier_cap=f([s.capacity_per_period for s in net.suppliers]),
        supplier_cost_index=f([s.unit_cost_index for s in net.suppliers]),
        supplier_fill_mean=f([s.fill_rate_mean for s in net.suppliers]),
        supplier_fill_sd=f([s.fill_rate_sd for s in net.suppliers]),
        ordering_cost=f([s.ordering_cost for s in net.suppliers]),
        base_share=base_share,
        dc_source=np.array([[pl.index(net.source_plant(d, s.id)) for s in skus] for d in dcs], dtype=np.int64),
        lanes=lanes,
        sp_lane=sp_lane,
        pd_lane=pd_lane,
        lane_cost=f([ln.cost_per_unit for ln in lanes]),
        lane_km=f([ln.distance_km for ln in lanes]),
        lane_co2=f([ef.factor(ln.mode) for ln in lanes]),
        lane_has_expedite=np.array([ln.expedite is not None for ln in lanes]),
        exp_cost_mult=f([ln.expedite.cost_multiplier if ln.expedite else 1.0 for ln in lanes]),
        exp_co2=f([ef.factor(ln.expedite.mode) if ln.expedite else 0.0 for ln in lanes]),
        dm_cost=f([ln.cost_per_unit if ln else 0.0 for ln in dm]),
        dm_km=f([ln.distance_km if ln else 0.0 for ln in dm]),
        dm_co2=f([ef.factor(ln.mode) if ln else 0.0 for ln in dm]),
    )
