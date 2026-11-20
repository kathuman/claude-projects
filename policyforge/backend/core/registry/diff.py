"""A path-level diff between two JSON documents (policy or network versions)."""

from __future__ import annotations

from typing import Any, Literal

from core.domain.common import Model


class Change(Model):
    path: str
    op: Literal["added", "removed", "changed"]
    before: Any = None
    after: Any = None


def _items(x: Any) -> dict[str, Any]:
    if isinstance(x, dict):
        return {str(k): v for k, v in x.items()}
    return {str(i): v for i, v in enumerate(x)}


def json_diff(a: Any, b: Any, path: str = "") -> list[Change]:
    """Every leaf that differs, as a dotted path (lists by index): added, removed or changed."""
    if isinstance(a, dict | list) and isinstance(b, dict | list) and type(a) is type(b):
        ia, ib = _items(a), _items(b)
        out: list[Change] = []
        for k in list(ia) + [k for k in ib if k not in ia]:
            p = f"{path}.{k}" if path else k
            if k not in ib:
                out.append(Change(path=p, op="removed", before=ia[k]))
            elif k not in ia:
                out.append(Change(path=p, op="added", after=ib[k]))
            else:
                out += json_diff(ia[k], ib[k], p)
        return out
    return [] if a == b else [Change(path=path or "(root)", op="changed", before=a, after=b)]
