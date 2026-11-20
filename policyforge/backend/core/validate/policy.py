"""Deterministic checks of a policy against the network and the constitution.

The schema already guarantees types, bounds and a closed vocabulary. This validator checks what the schema cannot:
- that every id a policy names exists, and is the right kind of thing;
- that the scope covers something the rule acts on;
- that the policy is tested against the active constitution;
- plus warnings for rules that are valid but probably wrong: cover below the lead time, an expedite cap that could
  overspend the monthly budget, a volume shift the mandate will block with nobody told.

Errors make the compiler retry (the model sees them); warnings go to the person signing the policy off.
"""

from __future__ import annotations

from typing import Literal

from pydantic import Field

from core.domain.common import Model
from core.domain.condition import Condition
from core.domain.constitution import Constitution, Metric
from core.domain.mandate import LimitBreach, LimitKind
from core.domain.network import Network
from core.domain.policy import (
    AllocationRule,
    BaseStock,
    DaysOfCover,
    ExpediteTrigger,
    MinMax,
    Policy,
    SourcingSwitch,
)
from core.domain.vocabulary import Variable, VarRef

WEEKS_PER_MONTH = 52 / 12


class Issue(Model):
    severity: Literal["error", "warning"]
    path: str = Field(description="Where in the policy, e.g. rule.rules[1].secondary")
    message: str
    code: str


def errors(issues: list[Issue]) -> list[Issue]:
    return [i for i in issues if i.severity == "error"]


class _Checker:
    def __init__(self, policy: Policy, net: Network, constitution: Constitution) -> None:
        self.p, self.net, self.con = policy, net, constitution
        self.issues: list[Issue] = []
        self.sku_ids = {s.id for s in net.skus}
        self.supplier_ids = {s.id for s in net.suppliers}
        self.plant_ids = {p.id for p in net.plants}
        self.dc_ids = {d.id for d in net.dcs}
        self.market_ids = {m.id for m in net.markets}
        self.lane_ids = {ln.id for ln in net.lanes}

    def add(self, severity: Literal["error", "warning"], path: str, message: str, code: str) -> None:
        self.issues.append(Issue(severity=severity, path=path, message=message, code=code))

    # ---------------------------------------------------------------- scope
    def scoped_skus(self) -> list[str]:
        sc = self.p.scope
        return [s.id for s in self.net.skus
                if (not sc.skus or s.id in sc.skus) and (not sc.sku_classes or s.abc_class in sc.sku_classes)
                and (not sc.categories or s.category in sc.categories)]

    def scoped_nodes(self, kinds: set[str]) -> list[str]:
        nodes = self.p.scope.nodes
        ids = (self.plant_ids if "plant" in kinds else set()) | (self.dc_ids if "dc" in kinds else set())
        return sorted(n for n in ids if not nodes or n in nodes)

    def cells(self) -> list[tuple[str, str]]:
        skus = self.scoped_skus()
        out = [(d, s) for d in self.scoped_nodes({"dc"}) for s in skus]
        for p in self.net.plants:
            if p.id in self.scoped_nodes({"plant"}):
                out += [(p.id, s) for s in skus if s in p.skus]
        return out

    def check_scope(self) -> None:
        sc = self.p.scope
        known = self.plant_ids | self.dc_ids | self.market_ids
        for i, n in enumerate(sc.nodes):
            if n not in known:
                self.add("error", f"scope.nodes[{i}]", f"{n} is not a plant, DC or market of {self.net.name}",
                         "unknown_node")
        for i, s in enumerate(sc.skus):
            if s not in self.sku_ids:
                self.add("error", f"scope.skus[{i}]", f"{s} is not a SKU of {self.net.name}", "unknown_sku")
        for i, s in enumerate(sc.suppliers):
            if s not in self.supplier_ids:
                self.add("error", f"scope.suppliers[{i}]", f"{s} is not a supplier", "unknown_supplier")
        for i, ln in enumerate(sc.lanes):
            if ln not in self.lane_ids:
                self.add("error", f"scope.lanes[{i}]", f"{ln} is not a lane", "unknown_lane")
        if not self.scoped_skus():
            self.add("error", "scope", "no SKU matches the scope's SKUs, classes and categories", "empty_scope")

    # ---------------------------------------------------------------- references in conditions
    def check_ref(self, ref: VarRef, path: str) -> None:
        if ref.supplier is not None and ref.supplier not in self.supplier_ids:
            self.add("error", f"{path}.supplier", f"{ref.supplier} is not a supplier", "unknown_supplier")
        if ref.node is not None:
            if ref.var in (Variable.capacity_utilisation, Variable.plant_capacity):
                if ref.node not in self.plant_ids:
                    self.add("error", f"{path}.node", f"{ref.var} needs a plant; {ref.node} is not one",
                             "wrong_node_kind")
            elif ref.node not in self.plant_ids | self.dc_ids | self.market_ids:
                self.add("error", f"{path}.node", f"{ref.node} is not a node", "unknown_node")
        if ref.sku is not None and ref.sku not in self.sku_ids:
            self.add("error", f"{path}.sku", f"{ref.sku} is not a SKU", "unknown_sku")

    def check_condition(self, c: Condition | None, path: str) -> None:
        if c is not None:
            self.check_ref(c.var, f"{path}.var")

    # ---------------------------------------------------------------- lead times, for cover warnings
    def lead_days(self, node: str, skus: list[str]) -> float:
        """Replenishment lead time as the simulator applies it: whole periods (at least one), in days. A plant's is
        the sourcing-weighted mean over its suppliers; a DC's the longest lane among the SKUs in scope."""
        pd = self.net.period_days

        def whole(days: float) -> float:
            return max(1, -(-days // pd)) * pd

        if node in self.plant_ids:
            plant = next(p for p in self.net.plants if p.id == node)
            total = 0.0
            for sh in plant.sourcing:
                ln = self.net.lane(sh.supplier, node)
                if ln is not None:
                    total += sh.share * whole(ln.lead_time_days.mean())
            return total
        days = []
        for s in skus:
            ln = self.net.lane(self.net.source_plant(node, s), node)
            if ln is not None:
                days.append(whole(ln.lead_time_days.mean()))
        return max(days) if days else 0.0

    def check_cover(self, days: float, review: int, path: str) -> None:
        """Warn when cover cannot even span the replenishment time: orders are placed after the period's demand and
        arrive whole periods later, so a base stock must cover the lead time plus any review periods beyond one."""
        skus = self.scoped_skus()
        pd = self.net.period_days
        for node in self.scoped_nodes({"plant", "dc"}):
            node_skus = skus if node in self.dc_ids else [
                s for s in skus if s in next(p for p in self.net.plants if p.id == node).skus]
            if not node_skus:
                continue
            need = self.lead_days(node, node_skus) + (review - 1) * pd
            if days < need:
                extra = f" plus {review - 1} more week(s) between reviews" if review > 1 else ""
                self.add("warning", path,
                         f"{days:g} days of cover at {node} is below its replenishment time (about {need:.0f} days: "
                         f"the lead time in whole weeks{extra}): expect chronic shortages", "cover_below_lead_time")

    # ---------------------------------------------------------------- rules
    def check_rule(self, rule: object, path: str) -> None:
        if isinstance(rule, BaseStock):
            if not self.cells():
                self.add("error", "scope", "the scope covers no stock the rule could replenish", "scope_no_stock")
            if isinstance(rule.target, DaysOfCover):
                self.check_cover(rule.target.value, rule.review_period, f"{path}.target")
        elif isinstance(rule, MinMax):
            if not self.cells():
                self.add("error", "scope", "the scope covers no stock the rule could replenish", "scope_no_stock")
            if isinstance(rule.order_up_to, DaysOfCover):
                self.check_cover(rule.order_up_to.value, 1, f"{path}.order_up_to")
        elif isinstance(rule, AllocationRule):
            self.check_allocation(rule, path)
        elif isinstance(rule, ExpediteTrigger):
            self.check_expedite(rule, path)
        elif isinstance(rule, SourcingSwitch):
            self.check_sourcing(rule, path)

    def check_allocation(self, rule: AllocationRule, path: str) -> None:
        named = self.p.scope.nodes
        dcs = [n for n in named if n in self.dc_ids] if named else sorted(self.dc_ids)
        plants = [n for n in named if n in self.plant_ids]  # with no nodes named, allocation applies at the DCs
        if not dcs and not plants:
            self.add("error", "scope.nodes", "an allocation rule needs a DC or plant that ships to others",
                     "allocation_no_node")
        served = {m.id for m in self.net.markets if m.served_by in dcs}
        for i, x in enumerate(rule.priority):
            if x in served or (plants and x in self.dc_ids):
                continue
            if x in self.market_ids:
                self.add("error", f"{path}.priority[{i}]", f"{x} is not served by the DCs in scope ({', '.join(dcs)})",
                         "priority_not_served")
            else:
                self.add("error", f"{path}.priority[{i}]", f"{x} is not a market (or a DC, for a plant) of "
                         f"{self.net.name}", "unknown_priority")

    def check_expedite(self, rule: ExpediteTrigger, path: str) -> None:
        cells = self.cells()
        if not cells:
            self.add("error", "scope", "the scope covers no stock that could be expedited", "scope_no_stock")
            return
        modes = set()
        for node, sku in cells:
            ln = (self.net.lane(self.net.source_plant(node, sku), node) if node in self.dc_ids else None)
            if node in self.plant_ids:
                plant = next(p for p in self.net.plants if p.id == node)
                for sh in plant.sourcing:
                    sl = self.net.lane(sh.supplier, node)
                    if sl is not None and sl.expedite is not None:
                        modes.add(sl.expedite.mode)
            elif ln is not None and ln.expedite is not None:
                modes.add(ln.expedite.mode)
        if not modes:
            self.add("warning", path, "no lane into the scope has an expedite option: the rule can never act",
                     "no_expedite_option")
        elif rule.mode not in modes:
            self.add("warning", f"{path}.mode", f"the lanes in scope offer {', '.join(sorted(modes))}, not "
                     f"{rule.mode}; the simulator uses each lane's own expedite option", "expedite_mode_unavailable")
        for c in self.con.hard_constraints:
            if c.metric == Metric.expedite_spend and c.op == "le":
                per_month = rule.cost_cap_per_period * WEEKS_PER_MONTH
                if c.window == "month" and per_month > c.threshold:
                    self.add("warning", f"{path}.cost_cap_per_period",
                             f"€{rule.cost_cap_per_period:,.0f} a week can reach €{per_month:,.0f} a month, above the "
                             f"constitution's €{c.threshold:,.0f} ({c.id})", "expedite_cap_above_budget")

    def check_sourcing(self, rule: SourcingSwitch, path: str) -> None:
        for field in ("primary", "secondary"):
            sid = getattr(rule, field)
            if sid not in self.supplier_ids:
                self.add("error", f"{path}.{field}", f"{sid} is not a supplier of {self.net.name}", "unknown_supplier")
        self.check_condition(rule.trigger, f"{path}.trigger")
        self.check_condition(rule.switch_back, f"{path}.switch_back")
        if rule.primary not in self.supplier_ids or rule.secondary not in self.supplier_ids:
            return
        named = [p for p in self.p.scope.nodes if p in self.plant_ids]
        plants = [p for p in self.net.plants if not named or p.id in named]
        buying = [p for p in plants if any(sh.supplier == rule.primary and sh.share > 0 for sh in p.sourcing)]
        if not buying:
            self.add("warning", f"{path}.primary", f"no plant in scope normally buys from {rule.primary}: there is "
                     "no volume to shift", "primary_not_used")
        for p in buying:
            if self.net.lane(rule.secondary, p.id) is None:
                self.add("error", f"{path}.secondary", f"{rule.secondary} has no lane to {p.id}", "no_secondary_lane")

    # ---------------------------------------------------------------- mandate and assumptions
    def check_mandate(self) -> None:
        m = self.p.mandate
        breach_rules = {e.trigger.limit for e in m.escalation if isinstance(e.trigger, LimitBreach)}
        for i, e in enumerate(m.escalation):
            if e.trigger.kind == "condition":
                self.check_condition(e.trigger.condition, f"mandate.escalation[{i}].trigger.condition")
        for r in self.p.simple_rules():
            if isinstance(r, SourcingSwitch):
                lim = m.limit(LimitKind.volume_shift_pct)
                if lim is not None and r.shift_fraction * 100 > lim + 1e-9:
                    tail = ("it must escalate to its owner beyond that" if LimitKind.volume_shift_pct in breach_rules
                            else "and no escalation rule tells anyone; add one")
                    self.add("warning", "mandate.autonomy",
                             f"the rule shifts {r.shift_fraction:.0%} of volume but the agent may shift only {lim:g} % "
                             f"on its own: {tail}", "shift_beyond_mandate")
            if isinstance(r, ExpediteTrigger):
                lim = m.limit(LimitKind.expedite_spend_per_period)
                if lim is not None and r.cost_cap_per_period > lim + 1e-9 \
                        and LimitKind.expedite_spend_per_period not in breach_rules:
                    self.add("warning", "mandate.autonomy",
                             f"the rule may spend €{r.cost_cap_per_period:,.0f} a week but the agent only €{lim:,.0f} "
                             "on its own, and no escalation rule covers the difference", "expedite_beyond_mandate")

    def run(self) -> list[Issue]:
        if self.p.constitution_ref != self.con.ref:
            self.add("error", "constitution_ref", f"tested against {self.p.constitution_ref}, but the active "
                     f"constitution is {self.con.ref}", "constitution_mismatch")
        self.check_scope()
        for i, r in enumerate(self.p.simple_rules()):
            path = "rule" if len(self.p.simple_rules()) == 1 and self.p.rule.type != "composite" else f"rule.rules[{i}]"
            self.check_rule(r, path)
        self.check_mandate()
        for i, a in enumerate(self.p.assumptions):
            self.check_ref(a.variable, f"assumptions[{i}].variable")
        return self.issues


def validate_policy(policy: Policy, net: Network, constitution: Constitution) -> list[Issue]:
    return _Checker(policy, net, constitution).run()
