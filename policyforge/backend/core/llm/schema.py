"""Turn a Pydantic model's JSON Schema into one that structured outputs accept.

Structured outputs support objects, arrays, scalars, enum/const, anyOf/allOf and $ref/$defs, and require
`additionalProperties: false` on every object. They do not support numeric bounds, string lengths, patterns, array
lengths, or recursion. Those constraints are dropped here and re-checked by Pydantic when the answer comes back, so
nothing is lost: the bounds still bind, they are just enforced on our side.
"""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel

DROP = frozenset({
    "minimum", "maximum", "exclusiveMinimum", "exclusiveMaximum", "multipleOf",
    "minLength", "maxLength", "pattern", "minItems", "maxItems", "uniqueItems",
    "title", "default", "discriminator", "examples",
})


def _clean(node: Any) -> Any:
    if isinstance(node, list):
        return [_clean(x) for x in node]
    if not isinstance(node, dict):
        return node
    out: dict[str, Any] = {}
    for k, v in node.items():
        if k in DROP:
            continue
        if k == "oneOf":
            out["anyOf"] = _clean(v)
        elif k in ("properties", "$defs"):
            out[k] = {name: _clean(sub) for name, sub in v.items()}
        else:
            out[k] = _clean(v)
    if out.get("type") == "object" or "properties" in out:
        out["additionalProperties"] = False
    return out


def api_schema(model: type[BaseModel]) -> dict[str, Any]:
    cleaned: dict[str, Any] = _clean(model.model_json_schema(mode="validation"))
    return cleaned


def unsupported_keys(node: Any, path: str = "$") -> list[str]:
    """Paths of anything structured outputs would reject (for tests)."""
    found: list[str] = []
    if isinstance(node, list):
        for i, x in enumerate(node):
            found += unsupported_keys(x, f"{path}[{i}]")
    elif isinstance(node, dict):
        for k, v in node.items():
            if k in DROP or k == "oneOf":
                found.append(f"{path}.{k}")
            if k == "additionalProperties" and v is not False:
                found.append(f"{path}.additionalProperties")
            found += unsupported_keys(v, f"{path}.{k}")
        if (node.get("type") == "object" or "properties" in node) and node.get("additionalProperties") is not False:
            found.append(f"{path} (object without additionalProperties: false)")
    return found
