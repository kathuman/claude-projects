#!/usr/bin/env python3
"""Validate the data files before they reach the live site. Exits 1 on any error."""
from __future__ import annotations

import csv
import datetime as dt
import json
import sys
from pathlib import Path

DATA = Path(__file__).resolve().parent.parent / "data"
DRIVER_KEYS = {"capability", "capital", "regulation", "cost", "data"}


def main() -> int:
    errs: list[str] = []
    try:
        cfg = json.loads((DATA / "technologies.json").read_text(encoding="utf-8"))
        scen = json.loads((DATA / "scenarios.json").read_text(encoding="utf-8"))
        sets = json.loads((DATA / "settings.json").read_text(encoding="utf-8"))
        json.loads((DATA / "signals.json").read_text(encoding="utf-8"))
        json.loads((DATA / "history.json").read_text(encoding="utf-8"))
        ledger = json.loads((DATA / "ledger.json").read_text(encoding="utf-8")) if (DATA / "ledger.json").exists() else {"records": []}
    except Exception as e:
        print(f"ERROR: could not parse a JSON file: {e}")
        return 1

    ids = [t.get("id") for t in cfg.get("technologies", [])]
    if len(ids) != len(set(ids)):
        errs.append("technologies.json: duplicate ids")
    for t in cfg["technologies"]:
        tid = t.get("id", "?")
        for f in ("id", "name", "description", "supply_chain_example", "gartner_phase_2026", "base_rate", "sensitivities",
                  "watch_signal", "signals"):
            if f not in t:
                errs.append(f"technologies.json/{tid}: missing '{f}'")
        if not 0 <= t.get("base_rate", -1) <= 1:
            errs.append(f"technologies.json/{tid}: base_rate must be 0..1")
        s = t.get("sensitivities", {})
        if set(s) != DRIVER_KEYS:
            errs.append(f"technologies.json/{tid}: sensitivities must have exactly {sorted(DRIVER_KEYS)}")
        for k, v in s.items():
            if not -1 <= v <= 1:
                errs.append(f"technologies.json/{tid}: sensitivity {k}={v} outside -1..1")

    with open(DATA / "assessments.csv", newline="", encoding="utf-8") as fh:
        rows = list(csv.DictReader(fh))
    need = {"id", "expectations", "evidence", "impact", "reviewed", "notes"}
    if rows and not need <= set(rows[0]):
        errs.append(f"assessments.csv: columns must include {sorted(need)}")
    seen = set()
    for i, r in enumerate(rows, start=2):
        rid = r.get("id", "")
        if rid in seen:
            errs.append(f"assessments.csv line {i}: duplicate id '{rid}'")
        seen.add(rid)
        if rid not in ids:
            errs.append(f"assessments.csv line {i}: id '{rid}' not in technologies.json")
        for f in ("expectations", "evidence", "impact"):
            try:
                v = float(r.get(f, ""))
                if not 0 <= v <= 100:
                    raise ValueError
            except ValueError:
                errs.append(f"assessments.csv line {i} ({rid}): {f} must be a number 0..100, got '{r.get(f)}'")
        try:
            dt.date.fromisoformat(r.get("reviewed", ""))
        except ValueError:
            errs.append(f"assessments.csv line {i} ({rid}): reviewed must be YYYY-MM-DD")
    for tid in set(ids) - seen:
        errs.append(f"assessments.csv: no row for '{tid}' (it will not appear on the board)")

    dkeys = {d["key"] for d in scen.get("drivers", [])}
    if dkeys != DRIVER_KEYS:
        errs.append(f"scenarios.json: drivers must be exactly {sorted(DRIVER_KEYS)}")
    pids = [p.get("id") for p in scen.get("presets", [])]
    if len(pids) != len(set(pids)):
        errs.append("scenarios.json: duplicate preset ids")
    for p in scen.get("presets", []):
        for k, v in p.get("values", {}).items():
            if k not in DRIVER_KEYS or not -1 <= v <= 1:
                errs.append(f"scenarios.json/{p.get('id')}: bad value {k}={v}")
    if sets.get("defaults", {}).get("scenario") not in pids:
        errs.append("settings.json: defaults.scenario must match a preset id")
    t = sets.get("thresholds", {})
    if not (t.get("overheated_gap", 0) > 0 > t.get("underpriced_gap", 0)):
        errs.append("settings.json: overheated_gap must be > 0 and underpriced_gap < 0")
    for k in ("expectations_signal_weight", "evidence_signal_weight"):
        if not 0 <= sets.get("blend", {}).get(k, -1) <= 1:
            errs.append(f"settings.json: blend.{k} must be 0..1")

    hz = sets.get("track", {}).get("horizons_months", [])
    if not hz or any(not isinstance(h, int) or h <= 0 for h in hz):
        errs.append("settings.json: track.horizons_months must be a list of whole months > 0")
    periods = [r.get("period") for r in ledger.get("records", [])]
    if periods != sorted(set(periods)):
        errs.append("ledger.json: records must be in period order, one per period")
    for r in ledger.get("records", []):
        per = r.get("period", "?")
        for f in ("period", "made", "mode", "horizons", "settings", "technologies"):
            if f not in r:
                errs.append(f"ledger.json/{per}: missing '{f}'")
        for tid, t in r.get("technologies", {}).items():
            for sid, fc in t.get("forecast", {}).items():
                if len(fc) != len(r.get("horizons", [])) or any(not (0 <= v <= 100) for pair in fc for v in pair):
                    errs.append(f"ledger.json/{per}/{tid}/{sid}: one H, E pair per horizon, each 0..100")
            if len(t.get("start", [])) != 2:
                errs.append(f"ledger.json/{per}/{tid}: start must be [H, E]")

    for e in errs:
        print("ERROR:", e)
    print(f"{len(errs)} error(s); {len(rows)} assessments, {len(ids)} technologies, {len(pids)} scenarios, "
          f"{len(periods)} ledger records")
    return 1 if errs else 0


if __name__ == "__main__":
    sys.exit(main())
