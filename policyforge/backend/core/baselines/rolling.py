"""The plan-based comparator: a linear program over a short horizon, re-solved every k periods (receding horizon).

At each re-planning period, for each replication, the LP takes the *observed* state (stock, pipeline totals,
backorders and the forecast) and plans orders for the next `horizon` periods against the **expected** forecast:
- DC orders arrive after the lane's mean lead time and are shipped from plant stock;
- plant material orders arrive after the sourcing-weighted mean lead time, at the suppliers' expected fill rate,
  queue for production, and are produced within the plant's weekly capacity;
- pipelines are assumed to arrive evenly over the lead time (policies see pipeline totals, not schedules).

It minimises holding cost, plus backorder or lost-sale penalties, plus a penalty on unshipped DC orders at plants.
The first `every` periods of the plan are executed, then it plans again. Supplier shares stay at the plants' normal
split. Solved with HiGHS through Pyomo's persistent interface, one model reused with mutable parameters.

This is how a planning system works: one best plan for one expected future, re-done often. It has no safety stock
by construction, which is the point of comparing it with policies built for many futures.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

import numpy as np
import pyomo.environ as pyo
from pyomo.contrib.appsi.solvers import Highs

from core.baselines.incumbent import incumbent_policies
from core.baselines.naive import mean_lead_periods
from core.sim.executors import Observation
from core.sim.layout import F, Layout
from core.sim.program import Program, compile_program

PLANT_BACKLOG_PENALTY = 5.0  # EUR per unit-period of DC orders a plant could not ship
DC_HOLDING_WEIGHT = 1.2  # DC stock costs 20 % more to hold than plant stock (tie-breaker)
EARLY_ORDER_COST = 1e-5  # EUR per unit per period of earliness (tie-breaker)
SAFETY_PENALTY_SHARE = 0.5  # a unit below the safety target costs half a unit short


@dataclass
class RollingOptimiser:
    lay: Layout
    R: int
    horizon: int = 8
    every: int = 4
    safety_days_dc: float = 7.0  # safety-stock targets the plan tries to hold, days of forecast (D028)
    safety_days_plant: float = 14.0
    solves: int = 0
    failures: int = 0
    statuses: dict[str, int] = field(default_factory=dict)
    plan: F = field(init=False)
    _m: Any = field(init=False, repr=False)
    _solver: Any = field(init=False, repr=False)

    def __post_init__(self) -> None:
        self.plan = np.zeros((self.R, self.every, self.lay.N, self.lay.K))
        self._build()

    # ---------------------------------------------------------------- the model
    def _build(self) -> None:
        lay, H = self.lay, self.horizon
        lead = mean_lead_periods(lay)
        self._dc = [(d, k) for d in range(lay.D) for k in range(lay.K)]
        self._pl = [(p, k) for p in range(lay.P) for k in range(lay.K) if lay.makes[p, k]]
        self._l_dc = {c: int(lead[lay.P + c[0], c[1]]) for c in self._dc}
        self._l_pl = {p: max(1, round(float(lead[p][lay.makes[p]].mean()))) for p in range(lay.P)}
        # expected share of a material order that arrives: the plant's sourcing-weighted mean supplier fill rate
        self._yield = {p: float(lay.base_share[p] @ lay.supplier_fill_mean) for p in range(lay.P)}
        m = pyo.ConcreteModel()
        J = range(1, H + 1)  # future periods t+1 .. t+H
        Q = range(H)  # orders placed at the end of t+0 .. t+H−1
        # The state enters as variables whose bounds are set to the observed value before each solve (lower =
        # upper bound). Pyomo builds the model once; each re-solve only changes column bounds in HiGHS, which keeps
        # the basis warm (D028).
        m.net0 = pyo.Var(self._dc, bounds=(0, 0))
        m.arr_dc = pyo.Var(self._dc, J, bounds=(0, 0))
        m.fc = pyo.Var(self._dc, bounds=(0, 0))
        m.inv0_pl = pyo.Var(self._pl, bounds=(0, 0))
        m.owed0 = pyo.Var(self._pl, bounds=(0, 0))
        m.arr_pl = pyo.Var(self._pl, J, bounds=(0, 0))
        m.fc_pl = pyo.Var(self._pl, bounds=(0, 0))

        m.q_dc = pyo.Var(self._dc, Q, domain=pyo.NonNegativeReals)
        m.q_pl = pyo.Var(self._pl, Q, domain=pyo.NonNegativeReals)
        m.inv_dc = pyo.Var(self._dc, J, domain=pyo.NonNegativeReals)
        m.bo_dc = pyo.Var(self._dc, J, domain=pyo.NonNegativeReals)
        m.inv_pl = pyo.Var(self._pl, [0, *J], domain=pyo.NonNegativeReals)
        m.bl_pl = pyo.Var(self._pl, [0, *J], domain=pyo.NonNegativeReals)
        m.wip = pyo.Var(self._pl, J, domain=pyo.NonNegativeReals)
        m.ss_dc = pyo.Var(self._dc, J, domain=pyo.NonNegativeReals)  # shortfall below the safety target
        m.ss_pl = pyo.Var(self._pl, J, domain=pyo.NonNegativeReals)
        m.prod = pyo.Var(self._pl, J, domain=pyo.NonNegativeReals)

        def dc_balance(mm: Any, d: int, k: int, j: int) -> Any:
            prev = mm.net0[d, k] if j == 1 else mm.inv_dc[d, k, j - 1] - mm.bo_dc[d, k, j - 1]
            lag = j - self._l_dc[(d, k)]
            new = mm.q_dc[d, k, lag] if 0 <= lag < H else 0
            return mm.inv_dc[d, k, j] - mm.bo_dc[d, k, j] == prev + mm.arr_dc[d, k, j] + new - mm.fc[d, k]

        m.dc_balance = pyo.Constraint(self._dc, J, rule=dc_balance)

        def shipped(mm: Any, p: int, k: int, i: int) -> Any:  # DC orders placed at the end of t+i, shipped then
            return sum(mm.q_dc[d, k, i] for d in range(lay.D) if lay.dc_source[d, k] == p)

        def pl0(mm: Any, p: int, k: int) -> Any:
            return mm.inv_pl[p, k, 0] - mm.bl_pl[p, k, 0] == mm.inv0_pl[p, k] - mm.owed0[p, k] - shipped(mm, p, k, 0)

        m.pl0 = pyo.Constraint(self._pl, rule=pl0)

        def pl_balance(mm: Any, p: int, k: int, j: int) -> Any:
            out = shipped(mm, p, k, j) if j < H else 0
            return (mm.inv_pl[p, k, j] - mm.bl_pl[p, k, j]
                    == mm.inv_pl[p, k, j - 1] - mm.bl_pl[p, k, j - 1] + mm.prod[p, k, j] - out)

        m.pl_balance = pyo.Constraint(self._pl, J, rule=pl_balance)

        def wip_balance(mm: Any, p: int, k: int, j: int) -> Any:
            prev = 0 if j == 1 else mm.wip[p, k, j - 1]
            lag = j - self._l_pl[p]
            new = self._yield[p] * mm.q_pl[p, k, lag] if 0 <= lag < H else 0
            return mm.wip[p, k, j] == prev + mm.arr_pl[p, k, j] + new - mm.prod[p, k, j]

        m.wip_balance = pyo.Constraint(self._pl, J, rule=wip_balance)
        pdays = lay.period_days
        m.safety_dc = pyo.Constraint(self._dc, J, rule=lambda mm, d, k, j: mm.ss_dc[d, k, j] >= (
            self.safety_days_dc / pdays) * mm.fc[d, k] - mm.inv_dc[d, k, j])
        m.safety_pl = pyo.Constraint(self._pl, J, rule=lambda mm, p, k, j: mm.ss_pl[p, k, j] >= (
            self.safety_days_plant / pdays) * mm.fc_pl[p, k] - mm.inv_pl[p, k, j])
        m.capacity = pyo.Constraint(range(lay.P), J, rule=lambda mm, p, j: sum(
            mm.prod[p, k, j] for (pp, k) in self._pl if pp == p) <= float(lay.plant_cap[p]))

        pen = np.where(lay.lost_sale, lay.lost_penalty, lay.backorder_penalty)
        # Tie-breakers, as a planning system would have: stock at a DC costs a little more than at a plant (so goods
        # move just in time), and an order costs a hair more the earlier it is placed (so orders are not batched
        # early for no reason). Without them the LP is degenerate and HiGHS returns arbitrary lumpy plans (D028).
        h = lay.holding
        m.obj = pyo.Objective(expr=(
            sum(DC_HOLDING_WEIGHT * float(h[k]) * m.inv_dc[d, k, j] + float(pen[k]) * m.bo_dc[d, k, j]
                for (d, k) in self._dc for j in J)
            + sum(float(h[k]) * (m.inv_pl[p, k, j] + 0.5 * m.wip[p, k, j])
                  + PLANT_BACKLOG_PENALTY * m.bl_pl[p, k, j] for (p, k) in self._pl for j in J)
            + sum(PLANT_BACKLOG_PENALTY * m.bl_pl[p, k, 0] for (p, k) in self._pl)
            + sum(EARLY_ORDER_COST * (H - i) * m.q_dc[d, k, i] for (d, k) in self._dc for i in Q)
            + sum(EARLY_ORDER_COST * (H - i) * m.q_pl[p, k, i] for (p, k) in self._pl for i in Q)
            + sum(SAFETY_PENALTY_SHARE * float(pen[k]) * m.ss_dc[d, k, j] for (d, k) in self._dc for j in J)
            + sum(SAFETY_PENALTY_SHARE * float(pen[k]) * m.ss_pl[p, k, j] for (p, k) in self._pl for j in J)
        ), sense=pyo.minimize)
        self._m = m
        solver = Highs()
        solver.set_instance(m)  # Pyomo hands the model to HiGHS once
        self._appsi = solver  # keep the persistent interface (and its variable map) alive
        self._h = solver._solver_model  # the highspy model behind the persistent interface
        self._h.setOptionValue("output_flag", False)
        col = solver._pyomo_var_to_solver_var_map

        def cols(var: Any, keys: list[Any]) -> np.ndarray:
            return np.array([col[id(var[key])] for key in keys], dtype=np.int32)

        jj = list(range(1, H + 1))
        self._c_net0, self._c_fc = cols(m.net0, self._dc), cols(m.fc, self._dc)
        self._c_arr_dc = np.array([cols(m.arr_dc, [(*c, j) for j in jj]) for c in self._dc])
        self._c_inv0, self._c_owed0 = cols(m.inv0_pl, self._pl), cols(m.owed0, self._pl)
        self._c_fc_pl = cols(m.fc_pl, self._pl)
        self._c_arr_pl = np.array([cols(m.arr_pl, [(*c, j) for j in jj]) for c in self._pl])
        self._c_qdc = np.array([cols(m.q_dc, [(*c, i) for i in range(self.every)]) for c in self._dc])
        self._c_qpl = np.array([cols(m.q_pl, [(*c, i) for i in range(self.every)]) for c in self._pl])
        self._dc_n = np.array([lay.P + d for d, _ in self._dc])
        self._dc_k = np.array([k for _, k in self._dc])
        self._pl_n = np.array([p for p, _ in self._pl])
        self._pl_k = np.array([k for _, k in self._pl])
        self._dc_lead = np.array([self._l_dc[c] for c in self._dc])
        self._pl_lead = np.array([self._l_pl[p] for p, _ in self._pl])

    # ---------------------------------------------------------------- planning
    def _solve(self, r: int, obs: Observation) -> F:
        lay, H = self.lay, self.horizon
        j = np.arange(1, H + 1)[None, :]
        net0 = obs.on_hand[r, self._dc_n, self._dc_k] - obs.backorders[r, self._dc_n, self._dc_k]
        fc = obs.forecast[r, self._dc_n, self._dc_k]
        arr_dc = np.where(j <= self._dc_lead[:, None],
                          (obs.pipeline[r, self._dc_n, self._dc_k] / self._dc_lead)[:, None], 0.0)
        inv0 = obs.on_hand[r, self._pl_n, self._pl_k]
        owed0 = obs.backorders[r, self._pl_n, self._pl_k]
        arr_pl = np.where(j <= self._pl_lead[:, None],
                          (obs.pipeline[r, self._pl_n, self._pl_k] / self._pl_lead)[:, None], 0.0)
        fc_pl = obs.forecast[r, self._pl_n, self._pl_k]
        idx = np.concatenate([self._c_net0, self._c_fc, self._c_arr_dc.ravel(), self._c_inv0, self._c_owed0,
                              self._c_arr_pl.ravel(), self._c_fc_pl])
        val = np.concatenate([net0, fc, arr_dc.ravel(), inv0, owed0, arr_pl.ravel(), fc_pl]).astype(np.float64)
        self._h.changeColsBounds(idx.size, idx, val, val)
        self._h.run()
        self.solves += 1
        status = self._h.modelStatusToString(self._h.getModelStatus()).lower()
        self.statuses[status] = self.statuses.get(status, 0) + 1
        out = np.zeros((self.every, lay.N, lay.K))
        if status != "optimal":
            self.failures += 1
            return out
        x = np.asarray(self._h.getSolution().col_value)
        out[:, self._dc_n, self._dc_k] = np.maximum(0.0, x[self._c_qdc]).T
        out[:, self._pl_n, self._pl_k] = np.maximum(0.0, x[self._c_qpl]).T
        return out

    def __call__(self, obs: Observation, t: int) -> F:
        i = t % self.every
        if i == 0:
            for r in range(obs.on_hand.shape[0]):
                self.plan[r] = self._solve(r, obs)
        out: F = self.plan[:, i]
        return out


def rolling_program(lay: Layout, R: int, horizon: int = 8, every: int = 4, safety_days_dc: float = 7.0,
                    safety_days_plant: float = 14.0) -> tuple[Program, RollingOptimiser]:
    """A program whose orders come from the rolling optimiser (allocation and sourcing stay at the defaults)."""
    prog = compile_program(lay, incumbent_policies(lay))
    opt = RollingOptimiser(lay, R, horizon=horizon, every=every, safety_days_dc=safety_days_dc,
                           safety_days_plant=safety_days_plant)
    prog.decider = opt
    return prog, opt
