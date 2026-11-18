"""Export JSON Schemas of the domain models and generate docs/DSL_REFERENCE.md from them.

Run: `python -m core.domain.schema_export` from backend/.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from pydantic import BaseModel

from core.domain.assumption import Assumption
from core.domain.constitution import METRICS, Constitution
from core.domain.mandate import LIMIT_SPECS, Mandate
from core.domain.network import Network
from core.domain.policy import Policy
from core.domain.vocabulary import VARIABLES

BACKEND = Path(__file__).resolve().parents[2]
ROOT = BACKEND.parent

TOP: dict[str, type[BaseModel]] = {
    "network": Network,
    "policy": Policy,
    "mandate": Mandate,
    "assumption": Assumption,
    "constitution": Constitution,
}

Schema = dict[str, Any]


def schemas() -> dict[str, Schema]:
    return {name: model.model_json_schema(mode="validation") for name, model in TOP.items()}


def _type(p: Schema) -> str:
    if "$ref" in p:
        return f"[{p['$ref'].split('/')[-1]}](#{p['$ref'].split('/')[-1].lower()})"
    if "const" in p:
        return f"`\"{p['const']}\"`"
    if "enum" in p:
        return " \\| ".join(f"`{v}`" for v in p["enum"])
    alts: list[Schema] = p.get("anyOf") or p.get("oneOf") or []
    if alts:
        return " \\| ".join(_type(x) for x in alts)
    t = p.get("type", "any")
    if t == "array":
        return f"list of {_type(p.get('items', {}))}"
    if t == "object" and "additionalProperties" in p:
        return f"map to {_type(p['additionalProperties'])}"
    return f"`{t}`"


def _bounds(p: Schema) -> str:
    for alt in p.get("anyOf", []):
        if alt.get("type") in ("number", "integer"):
            p = alt
    lo = p.get("minimum", p.get("exclusiveMinimum"))
    hi = p.get("maximum", p.get("exclusiveMaximum"))
    parts = []
    if lo is not None:
        parts.append(f"{'>' if 'exclusiveMinimum' in p else '≥'} {lo:g}")
    if hi is not None:
        parts.append(f"{'<' if 'exclusiveMaximum' in p else '≤'} {hi:g}")
    if "maxLength" in p:
        parts.append(f"≤ {p['maxLength']} chars")
    if "maxItems" in p:
        parts.append(f"≤ {p['maxItems']} items")
    return ", ".join(parts)


def _table(defn: Schema) -> list[str]:
    req = set(defn.get("required", []))
    rows = ["| Field | Type | Required | Bounds | Default | Description |", "|---|---|---|---|---|---|"]
    for name, p in defn.get("properties", {}).items():
        default = json.dumps(p["default"]) if "default" in p else ""
        desc = p.get("description", "").replace("|", "\\|")
        rows.append(f"| `{name}` | {_type(p)} | {'yes' if name in req else ''} | {_bounds(p)} | {default} | {desc} |")
    return rows


def dsl_reference() -> str:
    pol = schemas()["policy"]
    out = [
        "# DSL reference",
        "",
        "Generated from the Pydantic models by `python -m core.domain.schema_export`; do not edit by hand.",
        "",
        "A **policy** is a decision rule plus the mandate of the agent that executes it, the assumptions it rests on,",
        "and its provenance. The LLM compiler may produce instances of this schema only. Rules may read only the",
        "state variables below; assumptions may also use the exogenous ones.",
        "",
        "## Variable vocabulary",
        "",
        "| Variable | Kind | Unit | Bounds | Qualifier | Meaning |",
        "|---|---|---|---|---|---|",
    ]
    for v, s in VARIABLES.items():
        out.append(f"| `{v}` | {s.kind} | {s.unit} | {s.lo:g} .. {s.hi:g} | {s.needs} | {s.description} |")
    out += ["", "## Authority limits", "", "| Kind | Unit | Maximum |", "|---|---|---|"]
    for k, (unit, hi) in LIMIT_SPECS.items():
        out.append(f"| `{k}` | {unit} | {hi:g} |")
    out += ["", "## Constitution metrics", "", "| Metric | Unit | Bounds |", "|---|---|---|"]
    for m, ms in METRICS.items():
        out.append(f"| `{m}` | {ms.unit} | {ms.lo:g} .. {ms.hi:g} |")
    out += ["", "## Policy", "", *_table(pol), ""]
    for name, defn in sorted(pol.get("$defs", {}).items()):
        out += [f"## {name}", ""]
        if defn.get("description"):
            out += [defn["description"].strip(), ""]
        if "properties" in defn:
            out += [*_table(defn), ""]
        elif "enum" in defn:
            out += ["One of: " + ", ".join(f"`{v}`" for v in defn["enum"]), ""]
    return "\n".join(out)


def export() -> list[Path]:
    written = []
    out_dir = BACKEND / "schemas"
    out_dir.mkdir(exist_ok=True)
    for name, schema in schemas().items():
        p = out_dir / f"{name}.schema.json"
        p.write_text(json.dumps(schema, indent=2) + "\n", encoding="utf-8")
        written.append(p)
    p = BACKEND / "data" / "foodnet" / "network.schema.json"
    p.write_text(json.dumps(schemas()["network"], indent=2) + "\n", encoding="utf-8")
    written.append(p)
    p = ROOT / "docs" / "DSL_REFERENCE.md"
    p.parent.mkdir(exist_ok=True)
    p.write_text(dsl_reference() + "\n", encoding="utf-8")
    written.append(p)
    return written


if __name__ == "__main__":  # pragma: no cover
    for path in export():
        print(path)
