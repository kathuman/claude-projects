"""Re-run the stress test with the updated assumption: the network as observed, then the policy's evaluation on it.

An alarm says what it saw (its `update`). The observed network sets that part of the model to the observation:
- a supplier's capacity, lead time (all its lanes scaled) or fill rate;
- a plant's capacity;
- a market's demand (its size factor scaled).
State variables (stock, utilisation) describe the outcome rather than the world, so they change nothing; the report
says so.
"""

from __future__ import annotations

from typing import Any

from core.domain.common import Model
from core.domain.constitution import Constitution
from core.domain.distributions import Deterministic, Discrete, Gamma, Normal, Triangular
from core.domain.network import Network
from core.domain.policy import Policy
from core.domain.results import EvaluationReport
from core.domain.scenario import ScenarioSet
from core.sim.scenarios import default_suite


class Change(Model):
    path: str
    before: Any
    after: Any
    why: str


def _scale(d: Any, f: float) -> Any:
    if isinstance(d, Deterministic):
        return d.model_copy(update={"value": d.value * f})
    if isinstance(d, Normal):
        return d.model_copy(update={"mu": d.mu * f, "sigma": d.sigma * f})
    if isinstance(d, Gamma):
        return d.model_copy(update={"mu": d.mu * f})
    if isinstance(d, Triangular):
        return d.model_copy(update={"low": d.low * f, "mode": d.mode * f, "high": d.high * f})
    if isinstance(d, Discrete):
        return d.model_copy(update={"values": [v * f for v in d.values]})
    return d


def observed_network(net: Network, updates: list[dict[str, Any]],
                     week: int | None = None) -> tuple[Network, list[Change]]:
    """The network with each update applied, and the list of what changed."""
    data = net.model_dump(mode="python")
    changes: list[Change] = []
    sup = {s["id"]: s for s in data["suppliers"]}
    plants = {p["id"]: p for p in data["plants"]}
    markets = {m["id"]: m for m in data["markets"]}
    for u in updates:
        var, obs = u.get("variable"), u.get("observed")
        ratio = u.get("ratio")
        s_id, node = u.get("supplier"), u.get("node")
        if var == "supplier_capacity" and s_id in sup and obs is not None:
            i = list(sup).index(s_id)
            before = sup[s_id]["capacity_per_period"]
            sup[s_id]["capacity_per_period"] = round(max(1.0, obs), 1)
            changes.append(Change(path=f"suppliers.{i}.capacity_per_period", before=before,
                                  after=sup[s_id]["capacity_per_period"], why="reported capacity"))
        elif var == "supplier_fill_rate" and s_id in sup and obs is not None:
            i = list(sup).index(s_id)
            before = sup[s_id]["fill_rate_mean"]
            sup[s_id]["fill_rate_mean"] = round(min(1.0, max(0.0, obs)), 4)
            changes.append(Change(path=f"suppliers.{i}.fill_rate_mean", before=before,
                                  after=sup[s_id]["fill_rate_mean"], why="observed share of orders shipped"))
        elif var in ("lead_time", "observed_lead_time") and s_id in sup and (obs is not None or ratio is not None):
            lanes = [(j, ln) for j, ln in enumerate(net.lanes) if ln.origin == s_id]
            if not lanes:
                continue
            nominal = sum(ln.lead_time_days.mean() for _, ln in lanes) / len(lanes)
            f = float(ratio) if ratio is not None else float(obs or 0.0) / nominal
            for j, ln in lanes:
                before = ln.lead_time_days.model_dump()
                data["lanes"][j]["lead_time_days"] = _scale(ln.lead_time_days, f).model_dump()
                changes.append(Change(path=f"lanes.{j}.lead_time_days", before=before,
                                      after=data["lanes"][j]["lead_time_days"],
                                      why=f"observed lead times ×{f:.2f} of the model's"))
        elif var == "plant_capacity" and node in plants and obs is not None:
            i = list(plants).index(node)
            before = plants[node]["capacity_per_period"]
            plants[node]["capacity_per_period"] = round(max(1.0, obs), 1)
            changes.append(Change(path=f"plants.{i}.capacity_per_period", before=before,
                                  after=plants[node]["capacity_per_period"], why="reported capacity"))
        elif var == "demand" and node in markets and (ratio is not None or obs is not None):
            i = list(markets).index(node)
            if ratio is None:
                expected = sum(s.base_demand for s in net.skus) * markets[node]["size_factor"]
                ratio = obs / expected if expected > 0 else 1.0
            before = markets[node]["size_factor"]
            markets[node]["size_factor"] = round(min(10.0, before * ratio), 4)
            changes.append(Change(path=f"markets.{i}.size_factor", before=before, after=markets[node]["size_factor"],
                                  why=f"observed demand ×{ratio:.2f} of the model's"))
    suffix = f" (as observed at week {week})" if week is not None else " (as observed)"
    data["name"] = (net.name + suffix)[:80]
    return Network.model_validate(data), changes


class Retest(Model):
    alert_id: int | None = None
    policy_id: str
    policy_version: int
    changes: list[Change]
    notes: list[str]
    report: EvaluationReport


def retest(policy: Policy, constitution: Constitution, net: Network, updates: list[dict[str, Any]], *,
           week: int | None = None, scenarios: ScenarioSet | None = None, replications: int = 200,
           periods: int = 104, seed: int = 1, rolling_reps: int = 20) -> Retest:
    from core.evaluate.run import evaluate

    observed, changes = observed_network(net, updates, week)
    notes = []
    if not changes:
        notes.append("Nothing in the alert maps onto the model (a state variable, or no observation yet): the "
                     "stress test re-runs on the unchanged network.")
    report = evaluate(policy, constitution, scenarios or default_suite(), net=observed, replications=replications,
                      periods=periods, seed=seed, rolling_reps=rolling_reps)
    return Retest(policy_id=policy.id, policy_version=policy.version, changes=changes, notes=notes, report=report)
