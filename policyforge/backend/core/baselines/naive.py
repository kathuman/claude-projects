"""The naive baseline: a fixed base stock of mean demand × mean lead time, in units, for every cell.

No safety stock and no forecast: the textbook straw man. The lead time is the one the simulator applies, in whole
periods (at least 1). A plant's is the sourcing-weighted mean over its suppliers (D024).
"""

from __future__ import annotations

import numpy as np

from core.domain.examples import EPOCH
from core.domain.mandate import DEFAULT_TERM, Mandate
from core.domain.policy import BaseStock, Policy, Scope, Units
from core.sim.layout import F, Layout


def mean_lead_periods(lay: Layout) -> F:
    """[N, K] mean replenishment lead time of each cell, in periods."""
    out = np.zeros((lay.N, lay.K))
    for p in range(lay.P):
        lt = sum(lay.base_share[p, s] * float(lay.days_to_periods(np.array([lay.lanes[lay.sp_lane[p, s]]
                                                                           .lead_time_days.mean()]))[0])
                 for s in range(lay.S) if lay.sp_lane[p, s] >= 0 and lay.base_share[p, s] > 0)
        out[p] = lt
    for d in range(lay.D):
        for k in range(lay.K):
            ln = lay.lanes[lay.pd_lane[lay.dc_source[d, k], d]]
            out[lay.P + d, k] = float(lay.days_to_periods(np.array([ln.lead_time_days.mean()]))[0])
    return out


def naive_policies(lay: Layout) -> list[Policy]:
    target = lay.mean_node_demand() * mean_lead_periods(lay)
    mandate = Mandate(owner="system", approver="system", agent_id="naive", valid_from=EPOCH,
                      expires_at=EPOCH + DEFAULT_TERM)
    out = []
    for n, node in enumerate(lay.node_ids):
        for k, sku in enumerate(lay.sku_ids):
            if not lay.cell[n, k]:
                continue
            out.append(Policy(id=f"naive-{node}-{sku}", name=f"naive {node} {sku}",
                              intent_text="Naive base stock: mean demand × mean lead time.",
                              scope=Scope(nodes=[node], skus=[sku]),
                              rule=BaseStock(target=Units(value=round(float(target[n, k]), 6))),
                              mandate=mandate, constitution_ref="none"))
    return out
