"""Ready-made domain objects for FoodNet: a default constitution and one example policy per rule type.

Used by tests and as starting points in the app. The demo's constitution (§10 of the brief) is
`default_constitution()`: chilled service ≥ 97 %, expedite ≤ €20k per month, service → resilience → cost → carbon.
"""

from __future__ import annotations

from datetime import UTC, datetime

from core.domain.assumption import Assumption
from core.domain.condition import Condition
from core.domain.constitution import Constitution, ConstraintScope, HardConstraint, Metric, Objective, RiskAttitude
from core.domain.mandate import DEFAULT_TERM, AuthorityLimit, EscalationRule, LimitBreach, LimitKind, Mandate, Severity
from core.domain.policy import (
    AllocationRule,
    BaseStock,
    Composite,
    CoverageBelow,
    DaysOfCover,
    DecisionRule,
    ExpediteTrigger,
    MinMax,
    Policy,
    Provenance,
    Scope,
    SourcingSwitch,
)
from core.domain.vocabulary import Variable, VarRef

EPOCH = datetime(2027, 1, 4, tzinfo=UTC)  # a fixed date, so examples are reproducible


def default_constitution() -> Constitution:
    return Constitution(
        id="foodnet-constitution",
        version=1,
        name="FoodNet operating constitution",
        hard_constraints=[
            HardConstraint(id="chilled-service", metric=Metric.fill_rate, scope=ConstraintScope(category="chilled"),
                           op="ge", threshold=0.97, description="Chilled SKUs: fill rate at least 97 %"),
            HardConstraint(id="tier-a-service", metric=Metric.fill_rate, scope=ConstraintScope(sku_class="A"),
                           op="ge", threshold=0.95, description="Class A SKUs: fill rate at least 95 %"),
            HardConstraint(id="expedite-budget", metric=Metric.expedite_spend, op="le", threshold=20000,
                           window="month", description="Expedite spend at most €20,000 in any month"),
            HardConstraint(id="dc-inventory-days", metric=Metric.inventory_days, scope=ConstraintScope(), op="le",
                           threshold=35, description="No DC holds more than 35 days of stock on average"),
        ],
        priorities=[Objective.service, Objective.resilience, Objective.cost, Objective.carbon],
        soft_weights={Objective.service: 0.4, Objective.resilience: 0.3, Objective.cost: 0.2, Objective.carbon: 0.1},
        risk=RiskAttitude(measure="cvar", level=0.95),
        breach_alpha=0.05,
        created_at=EPOCH,
    )


def example_mandate(agent_id: str = "replenishment-agent-01") -> Mandate:
    return Mandate(
        owner="Planning manager",
        approver="Head of supply chain",
        agent_id=agent_id,
        autonomy=[
            AuthorityLimit(kind=LimitKind.order_qty_change_pct, value=15),
            AuthorityLimit(kind=LimitKind.expedite_spend_per_period, value=5000),
        ],
        escalation=[
            EscalationRule(trigger=LimitBreach(limit=LimitKind.order_qty_change_pct), severity=Severity.medium),
        ],
        valid_from=EPOCH,
        expires_at=EPOCH + DEFAULT_TERM,
    )


def example_rules() -> dict[str, DecisionRule]:
    lead_b = VarRef(var=Variable.observed_lead_time, supplier="SUP_B")
    fill_b = VarRef(var=Variable.supplier_fill_rate, supplier="SUP_B")
    switch = SourcingSwitch(
        primary="SUP_B", secondary="SUP_C",
        trigger=Condition(var=fill_b, op="lt", threshold=0.9, for_periods=3),
        shift_fraction=0.3,
        switch_back=Condition(var=fill_b, op="ge", threshold=0.95, for_periods=2),
        min_dwell_periods=4,
    )
    return {
        "base_stock": BaseStock(target=DaysOfCover(value=14)),
        "min_max": MinMax(reorder_point=DaysOfCover(value=7), order_up_to=DaysOfCover(value=21)),
        "allocation": AllocationRule(method="priority", priority=["MKT_N1", "MKT_N2"], reservation_pct=10),
        "expedite": ExpediteTrigger(condition=CoverageBelow(days=3), mode="express_road", cost_cap_per_period=4000),
        "sourcing_switch": switch,
        "composite": Composite(rules=[
            BaseStock(target=DaysOfCover(value=14)),
            ExpediteTrigger(condition=CoverageBelow(days=3), mode="express_road", cost_cap_per_period=4000),
            SourcingSwitch(primary="SUP_B", secondary="SUP_A",
                           trigger=Condition(var=lead_b, op="gt", threshold=21, for_periods=2)),
        ]),
    }


def example_policy(rule_type: str = "base_stock") -> Policy:
    return Policy(
        id=f"example-{rule_type.replace('_', '-')}",
        name=f"Example {rule_type}",
        intent_text=f"An example {rule_type} policy for FoodNet.",
        scope=Scope(nodes=["DC_N", "DC_C", "DC_S"]),
        rule=example_rules()[rule_type],
        mandate=example_mandate(),
        assumptions=[
            Assumption(id="lt-b", statement="Supplier B lead time stays under 21 days",
                       variable=VarRef(var=Variable.lead_time, supplier="SUP_B"), operator="lt", threshold=21,
                       source="user_stated", confidence=0.8),
        ],
        constitution_ref=default_constitution().ref,
        provenance=Provenance(created_at=EPOCH, updated_at=EPOCH),
    )
