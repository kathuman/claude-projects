"""The simulator: discrete time, vectorised over replications.

Order of events in each period t (as in the brief):
  1. receive arrivals (DC shipments into stock; supplier material into the plant production queue, then production
     up to the plant's capacity);
  2. observe demand;
  3. fulfil and allocate at the DCs (FIFO by age);
  4. record backorders or lost sales;
  5. policy decisions on the observed (possibly delayed and noisy) state;
  6. place orders: plants ship DC orders (and any backlog), plants order material from suppliers;
  7. advance the pipeline, age stock, spoil expired chilled stock.

An order placed in period t with a lead time of L periods arrives at the start of period t + L (L ≥ 1). Pipelines
are arrays indexed by periods-until-arrival: slot h arrives at the start of period t + 1 + h.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Literal

import numpy as np

from core.sim.executors import (
    EPS,
    Observation,
    SwitchState,
    allocate,
    apply_shares,
    holds,
    new_switch_state,
    order_up_to,
    persist,
    remove_fifo,
    replenishment_orders,
    sourcing_step,
)
from core.sim.layout import B, F, I, Layout
from core.sim.program import Program, Sourcing
from core.sim.scenarios.generate import Draws

COST_KEYS = ("holding", "ordering", "transport", "expedite", "purchase", "production", "penalty", "spoilage")
LIMIT_KEYS = ("order_qty_change_pct", "expedite_spend_per_period", "volume_shift_pct", "consecutive_sourcing_switches")


@dataclass(frozen=True)
class SimConfig:
    info_delay: int = 0  # periods; the scenario may add more
    on_limit: Literal["block", "flag"] = "block"  # actions beyond the mandate: clipped, or applied and flagged
    forecast_alpha: float = 0.3  # exponential smoothing of the observed demand signal
    # With an information delay, does the agent still know the orders it placed itself since the stale snapshot?
    # True (default): stock, demand and supplier state arrive late; the agent adds its own orders since then and
    # subtracts forecast demand over the delay (D026). False: everything is late, the textbook supply-line-blind
    # stressor, which is unstable for any delay ≥ 1.
    own_orders_known: bool = True
    # Forecast with each SKU's known seasonal profile: smooth the deseasonalised signal, then reseasonalise for the
    # next period (D030). Off by default: plain smoothing lags seasonal peaks.
    seasonal_forecast: bool = False


@dataclass
class SimResult:
    layout: Layout
    scenario_id: str
    seed: int
    R: int
    T: int
    policy_ids: list[str]
    demand: F  # [R, T, M, K]
    shipped: F  # [R, T, M, K] delivered to markets
    lost: F  # [R, T, M, K]
    backorders: F  # [R, T, M, K] at the end of the period
    orders: F  # [R, T, N, K] replenishment orders placed
    supplier_ordered: F  # [R, T, S]
    supplier_shipped: F  # [R, T, S]
    on_hand: F  # [R, T, N, K] at the end of the period
    receipts: F  # [R, T, N, K] into stock
    outflow: F  # [R, T, N, K] shipped out of stock
    spoiled: F  # [R, T, N, K]
    wip: F  # [R, T, P, K] material waiting for production, end of period
    material_in: F  # [R, T, P, K] material received from suppliers
    utilisation: F  # [R, T, P]
    expedited_units: F  # [R, T]
    cost: dict[str, F]  # each [R, T], EUR
    co2_t: F  # [R, T] tonnes CO2e
    limit_hits: dict[str, F]  # each [R, T]: actions beyond the mandate
    escalations: F  # [R, T]: limit hits plus escalation conditions that fired
    switches: F  # [R, T] sourcing switches made
    shocked: B  # [R, T]
    onset: I  # [R] first disrupted period of the scenario, −1 for none
    init_on_hand: F  # [R, N, K]
    init_wip: F  # [R, P, K]
    init_dc_pipeline: F  # [R, D, K] including unshipped DC orders
    init_material_pipeline: F  # [R, P, K]
    end_dc_pipeline: F
    end_material_pipeline: F
    notes: dict[str, list[str]] = field(default_factory=dict)

    @property
    def total_cost(self) -> F:
        out: F = sum((self.cost[k] for k in COST_KEYS), start=np.zeros((self.R, self.T)))
        return out


def simulate(lay: Layout, draws: Draws, prog: Program, cfg: SimConfig | None = None) -> SimResult:
    cfg = cfg or SimConfig()
    R, T = draws.R, draws.T
    P, D, N, K, M, S = lay.P, lay.D, lay.N, lay.K, lay.M, lay.S
    pdays = lay.period_days
    ar = np.arange(R)
    karr = np.arange(K)
    block = cfg.on_limit == "block"

    lt_p = lay.days_to_periods(draws.lt_days)
    exp_p = lay.days_to_periods(draws.exp_lt_days)
    H = int(max(lt_p.max(initial=1), exp_p.max(initial=1))) + 4
    A = max(2, int(lay.shelf_periods.max()) + 1)
    spoil_mask = lay.chilled[:, None] & (np.arange(A)[None, :] >= lay.shelf_periods[:, None])  # [K, A]
    markets_of = [np.flatnonzero(lay.market_dc == d) for d in range(D)]
    src_mask = np.stack([lay.dc_source == p for p in range(P)])  # [P, D, K]

    rep = prog.replenishment
    mean_out = lay.mean_node_demand()
    fc = np.broadcast_to(mean_out, (R, N, K)).copy()
    level = fc.copy()  # deseasonalised level, for seasonal forecasts
    tt = np.arange(T + 1)[:, None]
    season = 1.0 + lay.season_amp[None, :] * np.cos(2 * np.pi * (tt - lay.season_peak[None, :]) / 52.0)  # [T+1, K]

    # ---- initial state: pipelines at their mean flow, stock topped up to the target position
    pipe_dc = np.zeros((R, D, K, H))
    pipe_sup = np.zeros((R, P, S, K, H))
    ltq = np.zeros((R, P, S, H))  # quantity × lead-time days arriving, for the observed lead time
    ltn = np.zeros((R, P, S, H))
    for d in range(D):
        for k in range(K):
            p = lay.dc_source[d, k]
            ln = lay.lanes[lay.pd_lane[p, d]]
            lm = int(lay.days_to_periods(np.array([ln.lead_time_days.mean()]))[0])
            pipe_dc[:, d, k, :lm] = mean_out[P + d, k]
    for p in range(P):
        for s in range(S):
            li = lay.sp_lane[p, s]
            if li < 0 or lay.base_share[p, s] <= 0:
                continue
            days = lay.lanes[li].lead_time_days.mean()
            lm = int(lay.days_to_periods(np.array([days]))[0])
            flow = mean_out[p] * lay.makes[p] * lay.base_share[p, s]
            pipe_sup[:, p, s, :, :lm] = flow[None, :, None]
            ltn[:, p, s, :lm] = flow.sum()
            ltq[:, p, s, :lm] = flow.sum() * days
    big_s, _ = order_up_to(rep, fc, pdays)
    big_s = np.where(rep.kind > 0, big_s, 2 * mean_out[None])
    pipe_now = np.concatenate([pipe_sup.sum(axis=(2, 4)), pipe_dc.sum(-1)], axis=1)
    inv = np.zeros((R, N, K, A))
    inv[..., 0] = np.maximum(0.0, big_s - pipe_now) * lay.cell[None]
    wip = np.zeros((R, P, K))
    bo_m = np.zeros((R, M, K))
    owed = np.zeros((R, D, K))  # DC orders the plant has not shipped yet
    prev_q = np.zeros((R, N, K))
    last_req_p = np.broadcast_to(mean_out[:P], (R, P, K)).copy()
    fill_obs = np.broadcast_to(lay.supplier_fill_mean, (R, S)).copy()
    lt_obs = np.zeros((R, S))
    for s in range(S):
        lanes_s = [li for li in lay.sp_lane[:, s] if li >= 0]
        lt_obs[:, s] = np.mean([lay.lanes[li].lead_time_days.mean() for li in lanes_s]) if lanes_s else 0.0
    util = np.zeros((R, P))
    switch_states: list[SwitchState] = [new_switch_state(R) for _ in prog.sourcing]
    esc_counters = {(i, j): np.zeros(R) for i, mp in enumerate(prog.mandates) for j in range(len(mp.escalations))}
    delay = cfg.info_delay + draws.extra_delay
    obs_hist: list[Observation] = []
    cum_q = np.zeros((R, N, K))  # orders placed so far
    cum_hist: list[F] = []  # cum_q at each snapshot
    sig_hist: list[F] = []

    init = (inv.sum(-1).copy(), wip.copy(), pipe_dc.sum(-1) + owed, pipe_sup.sum(axis=(2, 4)))

    # ---- records
    def z(*shape: int) -> F:
        return np.zeros(shape)

    rec = {name: z(R, T, M, K) for name in ("shipped", "lost", "backorders")}
    rec |= {name: z(R, T, N, K) for name in ("orders", "on_hand", "receipts", "outflow", "spoiled")}
    rec_wip, rec_mat = z(R, T, P, K), z(R, T, P, K)
    rec_sreq, rec_sship, rec_util = z(R, T, S), z(R, T, S), z(R, T, P)
    cost = {k: z(R, T) for k in COST_KEYS}
    hits = {k: z(R, T) for k in LIMIT_KEYS}
    esc, co2, switches, expedited = z(R, T), z(R, T), z(R, T), z(R, T)

    for t in range(T):
        # 1. receive
        rec_dc = pipe_dc[..., 0].copy()
        pipe_dc[..., :-1] = pipe_dc[..., 1:]
        pipe_dc[..., -1] = 0.0
        inv[:, P:, :, 0] += rec_dc
        rec_sup = pipe_sup[..., 0].copy()
        pipe_sup[..., :-1] = pipe_sup[..., 1:]
        pipe_sup[..., -1] = 0.0
        got, got_days = ltn[..., 0].sum(axis=1), ltq[..., 0].sum(axis=1)
        for arr in (ltn, ltq):
            arr[..., :-1] = arr[..., 1:]
            arr[..., -1] = 0.0
        lt_obs = np.where(got > EPS, got_days / np.maximum(got, EPS), lt_obs)
        mat_in = rec_sup.sum(axis=2)
        wip += mat_in
        cap = lay.plant_cap[None] * draws.plant_cap[:, t]
        tot = wip.sum(-1)
        ratio = np.where(tot > cap, cap / np.maximum(tot, EPS), 1.0)
        prod = wip * ratio[..., None]
        wip -= prod
        inv[:, :P, :, 0] += prod
        util = prod.sum(-1) / lay.plant_cap[None]
        cost["production"][:, t] = (prod * lay.production_cost[None, :, None]).sum(axis=(1, 2))
        rec["receipts"][:, t] = np.concatenate([prod, rec_dc], axis=1)
        rec_mat[:, t] = mat_in

        # 2. observe demand; 3. fulfil and allocate at the DCs
        dem = draws.demand[:, t]
        req = dem + bo_m
        avail_d = inv[:, P:].sum(-1)
        ship_m = np.zeros((R, M, K))
        out_dc = np.zeros((R, D, K))
        for d in range(D):
            ms = markets_of[d]
            ship_m[:, ms] = allocate(req[:, ms], avail_d[:, d], prog.allocations.get(P + d), lay.demand_mean[ms])
            out_dc[:, d] = ship_m[:, ms].sum(axis=1)
        inv[:, P:] = remove_fifo(inv[:, P:], out_dc)
        unmet = req - ship_m
        # 4. backorders or lost sales
        lost = np.where(lay.lost_sale[None, None], unmet, 0.0)
        bo_m = np.where(lay.lost_sale[None, None], 0.0, unmet)
        cost["transport"][:, t] += (ship_m * lay.dm_cost[None, :, None]).sum(axis=(1, 2))
        co2[:, t] += (ship_m * lay.weight_t[None, None] * (lay.dm_km * lay.dm_co2)[None, :, None]).sum(axis=(1, 2))

        # 5. what the policies see
        bo_dc = np.stack([bo_m[:, markets_of[d]].sum(axis=1) for d in range(D)], axis=1)
        owed_p = np.einsum("rdk,pdk->rpk", owed, src_mask)
        on_hand = inv.sum(-1)
        pipeline = np.concatenate([wip + pipe_sup.sum(axis=(2, 4)), pipe_dc.sum(-1) + owed], axis=1)
        backorders = np.concatenate([owed_p, bo_dc], axis=1)
        signal_dc = np.stack([(dem * draws.signal[:, t])[:, markets_of[d]].sum(axis=1) for d in range(D)], axis=1)
        obs_hist.append(Observation(ip=on_hand + pipeline - backorders, on_hand=on_hand, backorders=backorders,
                                    pipeline=pipeline, forecast=fc, fill=fill_obs.copy(), lead_time=lt_obs.copy(),
                                    utilisation=util.copy()))
        sig_hist.append(np.concatenate([last_req_p, signal_dc], axis=1))
        cum_hist.append(cum_q.copy())
        seen = max(0, t - delay)
        if cfg.seasonal_forecast:
            level = cfg.forecast_alpha * sig_hist[seen] / season[seen][None, None] + (1 - cfg.forecast_alpha) * level
            fc = level * season[t + 1][None, None]
        else:
            fc = cfg.forecast_alpha * sig_hist[seen] + (1 - cfg.forecast_alpha) * fc
        past = obs_hist[seen]
        o = Observation(ip=past.ip, on_hand=past.on_hand, backorders=past.backorders, pipeline=past.pipeline,
                        forecast=fc, fill=past.fill, lead_time=past.lead_time, utilisation=past.utilisation)
        if seen < t and cfg.own_orders_known:
            # the agent's own orders since the snapshot are known; consumption since then is estimated from the
            # forecast, so the inventory position is unbiased (stale, not wrong on average)
            known = cum_q - cum_hist[seen]
            o = Observation(ip=past.ip + known - (t - seen) * fc, on_hand=past.on_hand, backorders=past.backorders,
                            pipeline=past.pipeline + known, forecast=fc, fill=past.fill, lead_time=past.lead_time,
                            utilisation=past.utilisation)

        # decisions: replenishment within the mandate
        if prog.decider is not None:  # a baseline that plans orders itself (e.g. rolling optimisation)
            q = prog.decider(o, t) * lay.cell[None]
        else:
            q = replenishment_orders(rep, o, t, pdays) * lay.cell[None]
            # The DC orders just placed are the plants' demand: plants see them before deciding (D025). The current
            # snapshot is updated in place, so a plant that sees the present (no delay) orders on it, and one
            # with a delay sees it when its delay has passed.
            new_p = np.einsum("rdk,pdk->rpk", q[:, P:], src_mask)
            now = obs_hist[t]
            now.ip[:, :P] -= new_p
            now.backorders[:, :P] += new_p
            if seen == t:
                q[:, :P] = replenishment_orders(rep, o, t, pdays)[:, :P] * lay.cell[None, :P]
        for mp in prog.mandates:
            if mp.order_change is None:
                continue
            own = (rep.owner == mp.policy)[None]
            lo, hi = prev_q * (1 - mp.order_change), prev_q * (1 + mp.order_change)
            hit = own & (prev_q > EPS) & (q > EPS) & ((q < lo - 1e-6) | (q > hi + 1e-6))
            hits["order_qty_change_pct"][:, t] += hit.sum(axis=(1, 2))
            if block:
                q = np.where(hit, np.clip(q, lo, hi), q)
        prev_q = np.where(q > EPS, q, prev_q)
        cum_q += q
        for (i, j), counter in esc_counters.items():
            cond, _ = prog.mandates[i].escalations[j]
            esc_counters[(i, j)] = persist(counter, holds(cond, o, lay))
            esc[:, t] += esc_counters[(i, j)] >= cond.for_periods
        rec["orders"][:, t] = q

        # sourcing switches (observed supplier state), then supplier shares
        active: list[tuple[Sourcing, SwitchState, float]] = []
        for src, st in zip(prog.sourcing, switch_states, strict=True):
            mp = prog.mandates[src.policy]
            change, over = sourcing_step(src, st, o, lay, mp.max_switches, block)
            switches[:, t] += change
            hits["consecutive_sourcing_switches"][:, t] += over
            frac = src.rule.shift_fraction
            if mp.volume_shift is not None and frac > mp.volume_shift + 1e-9:
                hits["volume_shift_pct"][:, t] += change & st.on
                if block:
                    frac = mp.volume_shift
            active.append((src, st, frac))
        shares = apply_shares(lay.base_share, active, R)

        # 6a. plants ship DC orders (backlog first, all owed together), within any allocation rule
        q_dc = q[:, P:]
        owed += q_dc
        last_req_p = np.einsum("rdk,pdk->rpk", q_dc, src_mask)
        avail_p = inv[:, :P].sum(-1)
        ship_pd = np.zeros((R, D, K))
        for p in range(P):
            reqp = owed * src_mask[p][None]
            ship_pd += allocate(reqp, avail_p[:, p], prog.allocations.get(p), mean_out[P:] * src_mask[p])
        out_p = np.einsum("rdk,pdk->rpk", ship_pd, src_mask)
        inv[:, :P] = remove_fifo(inv[:, :P], out_p)
        owed -= ship_pd
        owed = np.maximum(owed, 0.0)

        # expedite decisions at DC cells (on the observed state)
        exp_dc = np.zeros((R, D, K), dtype=bool)
        exp_plant = np.zeros((R, P, K), dtype=bool)
        trig_all = np.zeros((R, N, K), dtype=bool)
        for e in prog.expedites:
            if e.projected_stockout:
                n = int(e.param)
                soon = np.concatenate([wip + pipe_sup[..., :n].sum(axis=(2, 4)), pipe_dc[..., :n].sum(-1)], axis=1)
                trig = (o.on_hand + soon - n * fc) < 0
            else:
                trig = o.on_hand / np.maximum(fc / pdays, EPS) < e.param
            trig_all |= trig & e.cells[None]
        # cost of expediting each DC cell's shipment this period, capped per rule (cells taken in a fixed order)
        unit_exp = np.zeros((D, K))
        for d in range(D):
            for k in range(K):
                li = lay.pd_lane[lay.dc_source[d, k], d]
                unit_exp[d, k] = lay.lane_cost[li] * lay.exp_cost_mult[li] if lay.lane_has_expedite[li] else np.inf
        spend_t = np.zeros(R)
        for e in prog.expedites:
            mp = prog.mandates[e.policy]
            cap_e = e.cap if mp.expedite_spend is None or not block else min(e.cap, mp.expedite_spend)
            want = trig_all[:, P:] & e.cells[None, P:] & np.isfinite(unit_exp)[None]
            c = np.where(want, ship_pd * np.where(np.isfinite(unit_exp), unit_exp, 0.0)[None], 0.0).reshape(R, -1)
            ok = (np.cumsum(c, axis=1) <= cap_e + 1e-9) & (c > 0)
            exp_dc |= ok.reshape(R, D, K)
            spent = np.where(ok, c, 0.0).sum(axis=1)
            spend_t += spent
            if mp.expedite_spend is not None:
                hits["expedite_spend_per_period"][:, t] += spent > mp.expedite_spend + 1e-6

        # 6b. DC shipments into the pipeline
        for d in range(D):
            for p in range(P):
                kmask = src_mask[p, d]
                if not kmask.any():
                    continue
                li = lay.pd_lane[p, d]
                lc = np.where(exp_dc[:, d], exp_p[:, t, li][:, None], lt_p[:, t, li][:, None])
                qty = ship_pd[:, d] * kmask[None]
                pipe_dc[ar[:, None], d, karr[None, :], lc - 1] += qty
                is_exp = exp_dc[:, d] & kmask[None]
                normal = np.where(is_exp, 0.0, qty)
                fast = np.where(is_exp, qty, 0.0)
                cost["transport"][:, t] += normal.sum(-1) * lay.lane_cost[li]
                cost["expedite"][:, t] += fast.sum(-1) * lay.lane_cost[li] * lay.exp_cost_mult[li]
                expedited[:, t] += fast.sum(-1)
                km_w = lay.weight_t * lay.lane_km[li]
                co2[:, t] += (normal * km_w).sum(-1) * lay.lane_co2[li] + (fast * km_w).sum(-1) * lay.exp_co2[li]

        # 6c. plants order material; suppliers ship within capacity and their fill rate
        q_p = q[:, :P] * lay.makes[None]
        req_s = q_p[..., None] * shares  # [R, P, K, S]
        tot_s = req_s.sum(axis=(1, 2))
        cap_s = lay.supplier_cap[None] * draws.supplier_cap[:, t]
        scale = np.where(tot_s > cap_s, cap_s / np.maximum(tot_s, EPS), 1.0)
        shipped = req_s * (scale * draws.fill[:, t])[:, None, None, :]
        sent = shipped.sum(axis=(1, 2))
        fill_obs = np.where(tot_s > EPS, sent / np.maximum(tot_s, EPS), fill_obs)
        rec_sreq[:, t], rec_sship[:, t] = tot_s, sent
        exp_plant = trig_all[:, :P]
        for p in range(P):
            for s in range(S):
                li = lay.sp_lane[p, s]
                if li < 0:
                    continue
                qty = shipped[:, p, :, s]
                if not (qty > 0).any():
                    continue
                use_exp = exp_plant[:, p] & bool(lay.lane_has_expedite[li])
                lc = np.where(use_exp, exp_p[:, t, li][:, None], lt_p[:, t, li][:, None])
                days = np.where(use_exp, draws.exp_lt_days[:, t, li][:, None], draws.lt_days[:, t, li][:, None])
                pipe_sup[ar[:, None], p, s, karr[None, :], lc - 1] += qty
                at = (np.broadcast_to(ar[:, None], lc.shape), np.full(lc.shape, p), np.full(lc.shape, s), lc - 1)
                np.add.at(ltn, at, qty)
                np.add.at(ltq, at, qty * days)
                fast = np.where(use_exp, qty, 0.0)
                normal = qty - fast
                cost["purchase"][:, t] += (qty * lay.unit_cost[None]).sum(-1) * lay.supplier_cost_index[s]
                cost["transport"][:, t] += normal.sum(-1) * lay.lane_cost[li]
                cost["expedite"][:, t] += fast.sum(-1) * lay.lane_cost[li] * lay.exp_cost_mult[li]
                expedited[:, t] += fast.sum(-1)
                cost["ordering"][:, t] += (req_s[:, p, :, s].sum(-1) > EPS) * lay.ordering_cost[s]
                km_w = lay.weight_t * lay.lane_km[li]
                co2[:, t] += (normal * km_w).sum(-1) * lay.lane_co2[li] + (fast * km_w).sum(-1) * lay.exp_co2[li]

        # 7. age the stock; expired chilled stock spoils
        aged = np.zeros_like(inv)
        aged[..., 1:] = inv[..., :-1]
        aged[..., -1] += inv[..., -1]
        spoiled = (aged * spoil_mask[None, None]).sum(-1)
        inv = aged * ~spoil_mask[None, None]

        # costs and records for the period
        end_stock = inv.sum(-1)
        cost["holding"][:, t] = (end_stock * lay.holding[None, None]).sum(axis=(1, 2))
        cost["penalty"][:, t] = ((bo_m * lay.backorder_penalty[None, None]).sum(axis=(1, 2))
                                 + (lost * lay.lost_penalty[None, None]).sum(axis=(1, 2)))
        cost["spoilage"][:, t] = (spoiled * lay.unit_cost[None, None]).sum(axis=(1, 2))
        esc[:, t] += sum(h[:, t] for h in hits.values())
        rec["shipped"][:, t], rec["lost"][:, t], rec["backorders"][:, t] = ship_m, lost, bo_m
        rec["on_hand"][:, t], rec["spoiled"][:, t] = end_stock, spoiled
        rec["outflow"][:, t] = np.concatenate([out_p, out_dc], axis=1)
        rec_wip[:, t], rec_util[:, t] = wip, util
        co2[:, t] /= 1000.0  # kg → t

    return SimResult(
        layout=lay, scenario_id=draws.scenario_id, seed=draws.seed, R=R, T=T,
        policy_ids=[p.id for p in prog.policies], demand=draws.demand, shipped=rec["shipped"], lost=rec["lost"],
        backorders=rec["backorders"], orders=rec["orders"], supplier_ordered=rec_sreq, supplier_shipped=rec_sship,
        on_hand=rec["on_hand"], receipts=rec["receipts"], outflow=rec["outflow"], spoiled=rec["spoiled"],
        wip=rec_wip, material_in=rec_mat, utilisation=rec_util, expedited_units=expedited, cost=cost, co2_t=co2,
        limit_hits=hits, escalations=esc, switches=switches, shocked=draws.shocked if draws.shocked.size else
        np.zeros((R, T), dtype=bool),
        onset=draws.onset if draws.onset.size else np.full(R, -1, dtype=np.int64), init_on_hand=init[0],
        init_wip=init[1], init_dc_pipeline=init[2],
        init_material_pipeline=init[3], end_dc_pipeline=pipe_dc.sum(-1) + owed,
        end_material_pipeline=pipe_sup.sum(axis=(2, 4)), notes=prog.supported,
    )
