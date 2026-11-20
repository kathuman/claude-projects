"""The incumbent: the policy running today, for the scope under test.

Until the registry exists (P5), FoodNet's incumbent is fixed here: base stock at 35 days of cover at every plant, and
at every DC 10 days for ambient SKUs and 12 for chilled ones (D022, D029). It meets the constitution under normal
conditions, as a deployed policy would, and is visibly fragile under shocks, so stress tests can tell policies apart.
The registry will return the deployed policies instead.
"""

from __future__ import annotations

from core.domain.policy import BaseStock, DaysOfCover, Policy, Scope
from core.sim.layout import Layout
from core.sim.program import background_policies

INCUMBENT_DC_DAYS = 10
INCUMBENT_PLANT_DAYS = 35
INCUMBENT_CHILLED_DC_DAYS = 12


def incumbent_policies(lay: Layout) -> list[Policy]:
    pols = background_policies(lay, dc_days=INCUMBENT_DC_DAYS, plant_days=INCUMBENT_PLANT_DAYS)
    out = [p.model_copy(update={"id": p.id.replace("background", "incumbent"),
                                "name": p.name.replace("background", "incumbent"),
                                "intent_text": "Incumbent base-stock rule."}) for p in pols]
    dcs = out[-1]
    out.append(dcs.model_copy(update={
        "id": "incumbent-dcs-chilled", "name": "incumbent-dcs-chilled",
        "scope": Scope(nodes=lay.dc_ids, categories=["chilled"]),
        "rule": BaseStock(target=DaysOfCover(value=INCUMBENT_CHILLED_DC_DAYS))}))
    return out
