"""Networks as CSV tables (for spreadsheets) and back, with errors reported by table, row and column.

Tables: `network` (settings as key, value), `skus`, `suppliers`, `plants`, `dcs`, `markets`, `lanes` and
`demand_overrides`. Lists are written with spaces (`S01 S02`), sourcing as `SUP_A=0.5 SUP_B=0.5`, and lead-time
distributions in a compact form a person can type: `gamma(21, 0.08)`, `normal(5, 1)`, `triangular(1, 2, 4)`,
`deterministic(1)`, `discrete(1 2 3 | 0.2 0.5 0.3)`.
"""

from __future__ import annotations

import csv
import io
import re
from typing import Any

from pydantic import ValidationError

from core.domain.common import Model
from core.domain.distributions import Deterministic, Discrete, Gamma, Normal, Triangular
from core.domain.network import Network, NetworkData, reference_problems

TABLES = ("network", "skus", "suppliers", "plants", "dcs", "markets", "lanes", "demand_overrides")
LOC = ("lat", "lon", "x_km", "y_km")
COLUMNS: dict[str, tuple[str, ...]] = {
    "skus": ("id", "name", "abc_class", "category", "shelf_life_days", "unit_cost", "holding_cost_per_unit_period",
             "backorder_penalty_per_unit_period", "lost_sale_penalty_per_unit", "unmet_demand", "base_demand",
             "demand_cv", "seasonality_amplitude", "seasonality_peak_period", "weight_kg"),
    "suppliers": ("id", "name", *LOC, "capacity_per_period", "unit_cost_index", "fill_rate_mean", "fill_rate_sd",
                  "ordering_cost"),
    "plants": ("id", "name", *LOC, "capacity_per_period", "production_cost_per_unit", "skus", "sourcing"),
    "dcs": ("id", "name", *LOC, "storage_capacity"),
    "markets": ("id", "name", "region", *LOC, "size_factor", "served_by"),
    "lanes": ("id", "origin", "destination", "mode", "distance_km", "cost_per_unit", "lead_time_days",
              "expedite_mode", "expedite_lead_time_days", "expedite_cost_multiplier"),
    "demand_overrides": ("market", "sku", "mean", "cv"),
}
INTS = {"shelf_life_days", "seasonality_peak_period", "period_days"}


class TableError(Model):
    table: str | None
    row: int | None  # 1 = the first data row (the line after the header)
    column: str | None
    message: str


# ---------------------------------------------------------------- distributions as text
def dist_to_text(d: Any) -> str:
    if isinstance(d, Deterministic):
        return f"deterministic({d.value:g})"
    if isinstance(d, Normal):
        return f"normal({d.mu:g}, {d.sigma:g})"
    if isinstance(d, Gamma):
        return f"gamma({d.mu:g}, {d.cv:g})"
    if isinstance(d, Triangular):
        return f"triangular({d.low:g}, {d.mode:g}, {d.high:g})"
    if isinstance(d, Discrete):
        return f"discrete({' '.join(f'{v:g}' for v in d.values)} | {' '.join(f'{p:g}' for p in d.probs)})"
    raise TypeError(d)


DIST = re.compile(r"^\s*(\w+)\s*\((.*)\)\s*$")


def dist_from_text(text: str) -> dict[str, Any]:
    m = DIST.match(text or "")
    if not m:
        raise ValueError(f"write a distribution like gamma(21, 0.08) or triangular(1, 2, 4), not {text!r}")
    kind, args = m.group(1).lower(), m.group(2)
    if kind == "discrete":
        if "|" not in args:
            raise ValueError("discrete needs values | probabilities, e.g. discrete(1 2 | 0.4 0.6)")
        vals, probs = args.split("|", 1)
        return {"kind": "discrete", "values": [float(x) for x in vals.split()],
                "probs": [float(x) for x in probs.split()]}
    nums = [float(x) for x in args.replace(",", " ").split()]
    names = {"deterministic": ("value",), "normal": ("mu", "sigma"), "gamma": ("mu", "cv"),
             "triangular": ("low", "mode", "high")}.get(kind)
    if names is None:
        raise ValueError(f"unknown distribution {kind!r}: use deterministic, normal, gamma, triangular or discrete")
    if len(nums) != len(names):
        raise ValueError(f"{kind} takes {len(names)} number(s): {', '.join(names)}")
    return {"kind": kind, **dict(zip(names, nums, strict=True))}


# ---------------------------------------------------------------- network → tables
def _num(v: Any) -> str:
    if v is None:
        return ""
    if isinstance(v, float) and v.is_integer():
        return str(int(v))
    return str(v)


def to_rows(net: NetworkData) -> dict[str, list[dict[str, str]]]:
    def loc(x: Any) -> dict[str, str]:
        return {"lat": _num(x.location.lat), "lon": _num(x.location.lon), "x_km": _num(x.location.x_km),
                "y_km": _num(x.location.y_km)}

    ef = net.emission_factors
    out: dict[str, list[dict[str, str]]] = {
        "network": [{"key": "name", "value": net.name}, {"key": "currency", "value": net.currency},
                    {"key": "period_days", "value": str(net.period_days)}]
        + [{"key": f"emission_{m}", "value": _num(getattr(ef, m))}
           for m in ("road", "rail", "sea", "air", "express_road")],
        "skus": [{c: _num(getattr(s, c)) for c in COLUMNS["skus"]} for s in net.skus],
        "suppliers": [{"id": s.id, "name": s.name, **loc(s),
                       **{c: _num(getattr(s, c)) for c in COLUMNS["suppliers"][6:]}} for s in net.suppliers],
        "plants": [{"id": p.id, "name": p.name, **loc(p), "capacity_per_period": _num(p.capacity_per_period),
                    "production_cost_per_unit": _num(p.production_cost_per_unit), "skus": " ".join(p.skus),
                    "sourcing": " ".join(f"{sh.supplier}={_num(sh.share)}" for sh in p.sourcing)} for p in net.plants],
        "dcs": [{"id": d.id, "name": d.name, **loc(d), "storage_capacity": _num(d.storage_capacity)} for d in net.dcs],
        "markets": [{"id": m.id, "name": m.name, "region": m.region, **loc(m), "size_factor": _num(m.size_factor),
                     "served_by": m.served_by} for m in net.markets],
        "lanes": [{"id": ln.id, "origin": ln.origin, "destination": ln.destination, "mode": ln.mode,
                   "distance_km": _num(ln.distance_km), "cost_per_unit": _num(ln.cost_per_unit),
                   "lead_time_days": dist_to_text(ln.lead_time_days),
                   "expedite_mode": ln.expedite.mode if ln.expedite else "",
                   "expedite_lead_time_days": dist_to_text(ln.expedite.lead_time_days) if ln.expedite else "",
                   "expedite_cost_multiplier": _num(ln.expedite.cost_multiplier) if ln.expedite else ""}
                  for ln in net.lanes],
        "demand_overrides": [{"market": o.market, "sku": o.sku, "mean": _num(o.mean), "cv": _num(o.cv)}
                             for o in net.demand_overrides],
    }
    return out


def to_csv(net: NetworkData) -> dict[str, str]:
    """One CSV text per table."""
    out = {}
    for name, rows in to_rows(net).items():
        buf = io.StringIO()
        cols = ("key", "value") if name == "network" else COLUMNS[name]
        w = csv.DictWriter(buf, fieldnames=list(cols), lineterminator="\n")
        w.writeheader()
        w.writerows(rows)
        out[name] = buf.getvalue()
    return out


# ---------------------------------------------------------------- tables → network
def _read(text: str) -> list[dict[str, str]]:
    sample = text[:2000]
    delim = "\t" if sample.count("\t") > sample.count(",") else (";" if sample.count(";") > sample.count(",") else ",")
    return [{(k or "").strip(): (v or "").strip() for k, v in r.items()}
            for r in csv.DictReader(io.StringIO(text.lstrip("﻿")), delimiter=delim)]


def _value(col: str, raw: str) -> Any:
    if raw == "":
        return None
    if col in INTS:
        return int(float(raw.replace(",", ".")))
    try:
        return float(raw.replace(",", "."))
    except ValueError:
        return raw


def read_csv(tables: dict[str, str]) -> tuple[dict[str, Any], list[TableError]]:
    """Read CSV texts into a network document, as far as the cells can be read; errors are cells that could not be."""
    errors: list[TableError] = []
    rows = {name: _read(text) for name, text in tables.items() if name in TABLES}
    unknown = sorted(set(tables) - set(TABLES))
    for name in unknown:
        errors.append(TableError(table=name, row=None, column=None, message=f"unknown table {name!r}"))
    settings = {r.get("key", ""): r.get("value", "") for r in rows.get("network", [])}
    data: dict[str, Any] = {
        "name": settings.get("name", "Imported network"),
        "currency": settings.get("currency", "EUR") or "EUR",
        "period_days": int(settings.get("period_days") or 7),
        "emission_factors": {m: float(settings.get(f"emission_{m}") or 0) for m in
                             ("road", "rail", "sea", "air", "express_road")},
        "demand_overrides": [],
    }

    def loc(r: dict[str, str]) -> dict[str, Any]:
        return {k: v for k in LOC if (v := _value(k, r.get(k, ""))) is not None}

    def plain(name: str, skip: tuple[str, ...] = ()) -> list[dict[str, Any]]:
        out = []
        for r in rows.get(name, []):
            out.append({c: v for c in COLUMNS[name] if c not in skip and c not in LOC
                        and (v := _value(c, r.get(c, ""))) is not None})
        return out

    data["skus"] = plain("skus")
    for name in ("suppliers", "dcs", "markets"):
        data[name] = [{**d, "location": loc(r)} for d, r in zip(plain(name), rows.get(name, []), strict=True)]
    data["plants"] = []
    for i, r in enumerate(rows.get("plants", []), start=1):
        sourcing = []
        for part in r.get("sourcing", "").split():
            sup, _, share = part.partition("=")
            try:
                sourcing.append({"supplier": sup, "share": float(share.replace(",", "."))})
            except ValueError:
                errors.append(TableError(table="plants", row=i, column="sourcing",
                                         message=f"write sourcing as SUP_A=0.5 SUP_B=0.5, not {part!r}"))
        d = {c: v for c in ("id", "name", "capacity_per_period", "production_cost_per_unit")
             if (v := _value(c, r.get(c, ""))) is not None}
        data["plants"].append({**d, "location": loc(r), "skus": r.get("skus", "").split(), "sourcing": sourcing})
    data["lanes"] = []
    for i, r in enumerate(rows.get("lanes", []), start=1):
        lane: dict[str, Any] = {c: v for c in ("id", "origin", "destination", "mode", "distance_km", "cost_per_unit")
                                if (v := _value(c, r.get(c, ""))) is not None}
        try:
            lane["lead_time_days"] = dist_from_text(r.get("lead_time_days", ""))
        except ValueError as e:
            errors.append(TableError(table="lanes", row=i, column="lead_time_days", message=str(e)))
        if r.get("expedite_mode"):
            try:
                lane["expedite"] = {"mode": r["expedite_mode"],
                                    "lead_time_days": dist_from_text(r.get("expedite_lead_time_days", "")),
                                    "cost_multiplier": _value("x", r.get("expedite_cost_multiplier", ""))}
            except ValueError as e:
                errors.append(TableError(table="lanes", row=i, column="expedite_lead_time_days", message=str(e)))
        data["lanes"].append(lane)
    data["demand_overrides"] = plain("demand_overrides")
    return data, errors


def from_csv(tables: dict[str, str]) -> tuple[Network | None, list[TableError]]:
    """Build a network from CSV texts. Returns (network or None, errors by table, row and column)."""
    data, errors = read_csv(tables)
    if errors:
        return None, errors
    try:
        base = NetworkData.model_validate(data)
    except ValidationError as e:
        for err in e.errors():
            loc_ = list(err["loc"])
            table = str(loc_[0]) if loc_ else None
            row = loc_[1] + 1 if len(loc_) > 1 and isinstance(loc_[1], int) else None
            column = ".".join(str(x) for x in loc_[2:]) or None
            errors.append(TableError(table=table, row=row, column=column, message=err["msg"]))
        return None, errors
    problems = reference_problems(base)
    if problems:
        for pr in problems:
            parts = pr.path.split(".")
            errors.append(TableError(table=parts[0], row=int(parts[1]) + 1 if len(parts) > 1 and parts[1].isdigit()
                                     else None, column=".".join(parts[2:]) or None, message=pr.message))
        return None, errors
    return Network.model_validate(base.model_dump()), []
