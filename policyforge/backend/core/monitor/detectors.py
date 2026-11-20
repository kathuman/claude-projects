"""Change detectors: CUSUM (one- and two-sided), the population stability index and the two-sample KS test.

All work on plain arrays and return where they first fire, so a monitor's history is a pure function of its data.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np
from scipy import stats

F = np.ndarray


@dataclass(frozen=True)
class Cusum:
    """`k` is the allowance and `h` the decision interval, both in units of the scale."""

    k: float = 0.5
    h: float = 4.0


def cusum_upper(z: F, c: Cusum = Cusum()) -> tuple[F, list[int]]:
    """One-sided CUSUM on standardised exceedances `z` (positive = towards a breach). NaN (no observation) leaves the
    statistic unchanged. It resets to 0 after each alarm. Returns the statistic and the indices of the alarms."""
    s = 0.0
    out = np.zeros(len(z))
    alarms: list[int] = []
    for i, x in enumerate(z):
        if not np.isnan(x):
            s = max(0.0, s + float(x) - c.k)
        out[i] = s
        if s > c.h:
            alarms.append(i)
            s = 0.0
    return out, alarms


def cusum_two_sided(z: F, c: Cusum = Cusum()) -> tuple[F, list[tuple[int, str]]]:
    """Two-sided CUSUM on standardised deviations from the reference mean. Alarms are (index, "up" or "down")."""
    hi, lo = cusum_upper(z, c), cusum_upper(-z, c)
    stat = np.maximum(hi[0], lo[0])
    alarms = sorted([(i, "up") for i in hi[1]] + [(i, "down") for i in lo[1]])
    return stat, alarms


def change_point(stat: F, alarm: int) -> int:
    """Where the change behind an alarm most likely began: the week after the statistic last stood at zero."""
    t = alarm
    while t > 0 and stat[t - 1] > 0:
        t -= 1
    return t


def cusum_max(z: F, k: float) -> F:
    """For each row of `z` ([R, T]), the largest value the two-sided CUSUM statistic reaches (no reset): the row
    raises an alarm at limit h exactly when this exceeds h."""
    hi = np.zeros(z.shape[0])
    lo = np.zeros(z.shape[0])
    top = np.zeros(z.shape[0])
    for t in range(z.shape[1]):
        x = z[:, t]
        ok = ~np.isnan(x)
        hi = np.where(ok, np.maximum(0.0, hi + np.nan_to_num(x) - k), hi)
        lo = np.where(ok, np.maximum(0.0, lo - np.nan_to_num(x) - k), lo)
        top = np.maximum(top, np.maximum(hi, lo))
    return top


def calibrate_limit(z_ref: F, k: float, target: float, floor: float) -> float:
    """The smallest limit h (at least `floor`, in steps of 0.5) at which at most `target` of the reference futures
    would raise a false alarm over the horizon."""
    top = cusum_max(z_ref, k)
    h = floor
    while h < 60 and float(np.mean(top > h)) > target:
        h += 0.5
    return h


def psi(reference: F, current: F, bins: int = 10) -> float:
    """Population stability index of `current` against `reference`, on the reference's quantile bins.
    Rule of thumb: < 0.1 stable, 0.1–0.25 some shift, > 0.25 a shift."""
    ref = reference[~np.isnan(reference)]
    cur = current[~np.isnan(current)]
    if len(ref) < bins or len(cur) == 0:
        return float("nan")
    edges = np.unique(np.quantile(ref, np.linspace(0, 1, bins + 1)))
    if len(edges) < 3:
        return float("nan")
    edges[0], edges[-1] = -np.inf, np.inf
    p = np.histogram(ref, edges)[0] / len(ref)
    q = np.histogram(cur, edges)[0] / len(cur)
    p, q = np.clip(p, 1e-4, None), np.clip(q, 1e-4, None)
    return float(np.sum((q - p) * np.log(q / p)))


def ks_pvalue(reference: F, current: F) -> float:
    """p-value of the two-sample Kolmogorov–Smirnov test (NaN when either side is empty)."""
    ref = reference[~np.isnan(reference)]
    cur = current[~np.isnan(current)]
    if len(ref) == 0 or len(cur) == 0:
        return float("nan")
    return float(stats.ks_2samp(ref, cur).pvalue)


def robust_scale(x: F, floor: float) -> float:
    """1.4826 × MAD (the standard deviation, for normal data, without being thrown by outliers), at least `floor`."""
    v = x[~np.isnan(x)]
    if len(v) == 0:
        return floor
    return max(floor, 1.4826 * float(np.median(np.abs(v - np.median(v)))))
