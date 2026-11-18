"""Deterministic executors: one per decision-rule type. Each is a pure function over arrays shaped [R, ...].

Executors read the *observed* state (possibly delayed and noisy), never the truth, and never anything outside the
state vocabulary.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np

from core.domain.condition import Condition
from core.domain.vocabulary import Variable
from core.sim.layout import B, F, Layout
from core.sim.program import Allocation, Replenishment, Sourcing

EPS = 1e-9


@dataclass
class Observation:
    """What policies see: the state vocabulary as arrays."""

    ip: F  # [R, N, K] inventory position
    on_hand: F  # [R, N, K]
    backorders: F  # [R, N, K] owed downstream (DC: market backorders; plant: unshipped DC orders)
    pipeline: F  # [R, N, K] ordered, not yet received
    forecast: F  # [R, N, K] units per period
    fill: F  # [R, S] observed supplier fill rate
    lead_time: F  # [R, S] observed supplier lead time, days
    utilisation: F  # [R, P] plant output / capacity


# ---------------------------------------------------------------- BaseStock and MinMax
def order_up_to(rep: Replenishment, fc: F, period_days: int) -> tuple[F, F]:
    """(S, s) in units for every cell, given the forecast per period."""
    per_day = fc / period_days
    big_s = np.where(rep.target_days, rep.target * per_day, rep.target)
    small_s = np.where(rep.reorder_days, rep.reorder * per_day, rep.reorder)
    return big_s, small_s


def replenishment_orders(rep: Replenishment, obs: Observation, t: int, period_days: int) -> F:
    """Order quantities [R, N, K]: base stock orders up to S on review periods; (s, S) orders up to S at or below s."""
    big_s, small_s = order_up_to(rep, obs.forecast, period_days)
    gap = np.maximum(0.0, big_s - obs.ip)
    due = (t % rep.review) == 0
    base = np.where((rep.kind == 1) & due, gap, 0.0)
    minmax = np.where((rep.kind == 2) & (obs.ip <= small_s), gap, 0.0)
    out: F = base + minmax
    return out


# ---------------------------------------------------------------- AllocationRule
def fair_share(req: F, avail: F) -> F:
    """Everyone gets the same fraction of their request. req [R, C, K], avail [R, K]."""
    tot = req.sum(axis=1)
    frac = np.where(tot > EPS, np.minimum(1.0, avail / np.maximum(tot, EPS)), 0.0)
    out: F = req * frac[:, None, :]
    return out


def allocate(req: F, avail: F, rule: Allocation | None, weights: F) -> F:
    """Split available stock [R, K] over requests [R, C, K]. weights [C, K]: mean demand, for proportional_to_demand.

    priority: the priority list is served in order, then the rest share fairly.
    reservation: non-priority nodes together may take at most (1 − reservation) of the available stock.
    proportional_to_demand: shares follow mean demand (capped at each request); what is left goes fair share.
    """
    if rule is None:
        return fair_share(req, avail)
    ship = np.zeros_like(req)
    remaining = avail.copy()
    pri = rule.priority
    if rule.method == "priority":
        for c in pri:
            give = np.minimum(req[:, c], remaining)
            ship[:, c] = give
            remaining -= give
    elif pri and rule.reservation > 0:
        sub = np.zeros_like(req)
        sub[:, pri] = req[:, pri]
        ship += fair_share(sub, remaining)
        remaining -= ship.sum(axis=1)
    others = np.ones(req.shape[1], dtype=bool)
    if rule.method == "priority" or rule.reservation > 0:
        others[pri] = False
    allowance = np.minimum(remaining, (1.0 - rule.reservation) * avail) if rule.reservation > 0 else remaining
    rest = np.where(others[None, :, None], req, 0.0)
    if rule.method == "proportional_to_demand":
        w = np.where(others[:, None], weights, 0.0)
        wsum = w.sum(axis=0)
        share = np.where(wsum > EPS, w / np.maximum(wsum, EPS), 0.0)  # [C, K]
        first = np.minimum(rest, share[None] * allowance[:, None, :])
        ship += first
        left = allowance - first.sum(axis=1)
        ship += fair_share(rest - first, left)
    else:
        ship += fair_share(rest, allowance)
    out: F = np.minimum(ship, req)
    return out


def remove_fifo(inv: F, qty: F) -> F:
    """Take `qty` [...] out of aged stock `inv` [..., A], oldest first. Returns the new stock."""
    out = inv.copy()
    left = qty.copy()
    for a in range(inv.shape[-1] - 1, -1, -1):
        take = np.minimum(out[..., a], left)
        out[..., a] -= take
        left -= take
    return out


# ---------------------------------------------------------------- conditions
def value_of(cond: Condition, obs: Observation, lay: Layout) -> F:
    """The observed value [R] of a condition's variable."""
    ref = cond.var
    v = ref.var
    if v in (Variable.supplier_fill_rate, Variable.observed_lead_time):
        j = lay.supplier_ids.index(ref.supplier) if ref.supplier in lay.supplier_ids else -1
        if j < 0:
            return np.full(obs.fill.shape[0], np.nan)
        arr: F = (obs.fill if v == Variable.supplier_fill_rate else obs.lead_time)[:, j]
        return arr
    if v == Variable.capacity_utilisation:
        p = lay.plant_ids.index(ref.node) if ref.node in lay.plant_ids else -1
        return obs.utilisation[:, p] if p >= 0 else np.full(obs.fill.shape[0], np.nan)
    field = {Variable.inventory_position: obs.ip, Variable.on_hand: obs.on_hand, Variable.backorders: obs.backorders,
             Variable.pipeline: obs.pipeline, Variable.forecast: obs.forecast}[v]
    nodes = np.array([ref.node is None or n == ref.node for n in lay.node_ids])
    skus = np.array([ref.sku is None or s == ref.sku for s in lay.sku_ids])
    mask = nodes[:, None] & skus[None, :] & lay.cell
    total: F = (field * mask[None]).sum(axis=(1, 2))
    return total


def holds(cond: Condition, obs: Observation, lay: Layout) -> B:
    """Does the condition hold this period [R]? (Persistence is counted by the caller.)"""
    x = value_of(cond, obs, lay)
    th = cond.threshold
    with np.errstate(invalid="ignore"):
        cmp = {"lt": x < th, "le": x <= th, "gt": x > th, "ge": x >= th}[cond.op]
    ok: B = cmp & ~np.isnan(x)
    return ok


def persist(counter: F, now: B) -> F:
    """Count consecutive periods a condition has held."""
    out: F = np.where(now, counter + 1, 0)
    return out


# ---------------------------------------------------------------- SourcingSwitch
@dataclass
class SwitchState:
    on: B  # [R] currently switched to the secondary
    trig: F  # [R] periods the trigger has held
    back: F  # [R] periods the switch-back condition has held
    dwell: F  # [R] periods since the last switch
    switches: F  # [R] switches made since the start (for the mandate)


def new_switch_state(R: int) -> SwitchState:
    z = np.zeros(R)
    return SwitchState(on=np.zeros(R, dtype=bool), trig=z.copy(), back=z.copy(), dwell=np.full(R, 1e9),
                       switches=z.copy())


def sourcing_step(src: Sourcing, st: SwitchState, obs: Observation, lay: Layout,
                  max_switches: int | None, block: bool) -> tuple[B, B]:
    """Advance one sourcing switch by a period. Returns (switched now [R], blocked or flagged by the mandate [R])."""
    rule = src.rule
    st.trig = persist(st.trig, holds(rule.trigger, obs, lay))
    st.back = persist(st.back, holds(rule.switch_back, obs, lay)) if rule.switch_back else np.zeros_like(st.back)
    st.dwell += 1
    go = ~st.on & (st.trig >= rule.trigger.for_periods)
    ret = st.on & (st.dwell >= rule.min_dwell_periods)
    if rule.switch_back is not None:
        ret &= st.back >= rule.switch_back.for_periods
    else:
        ret &= False
    change = go | ret
    over = np.zeros_like(change)
    if max_switches is not None:
        over = change & (st.switches + 1 > max_switches)
        if block:
            change &= ~over
    st.on = np.where(change, ~st.on, st.on)
    st.dwell = np.where(change, 0, st.dwell)
    st.switches += change
    st.trig = np.where(change, 0, st.trig)
    st.back = np.where(change, 0, st.back)
    return change, over


def apply_shares(base: F, sources: list[tuple[Sourcing, SwitchState, float]], R: int) -> F:
    """Supplier shares [R, P, K, S] after the sourcing switches that are on (each with its shift fraction)."""
    P, S = base.shape
    K = sources[0][0].cells.shape[1] if sources else 1
    shares = np.broadcast_to(base[None, :, None, :], (R, P, K, S)).copy()
    for src, st, frac in sources:
        on = st.on[:, None, None] & src.cells[None]  # [R, P, K]
        moved = np.where(on, shares[..., src.primary] * frac, 0.0)
        shares[..., src.primary] -= moved
        shares[..., src.secondary] += moved
    return shares
