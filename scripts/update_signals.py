#!/usr/bin/env python3
"""Collect public attention and usage signals for each technology.

Writes data/signals.json (latest), appends a snapshot to data/history.json,
and writes a Markdown summary for the refresh pull request.

Sources (all free, no API keys):
  - Wikipedia page views (Wikimedia REST API)        -> expectations
  - Hacker News story counts (Algolia HN Search API) -> expectations
  - arXiv paper counts (arXiv API)                   -> shown only, research activity
  - PyPI downloads (pypistats.org)                   -> evidence proxy, where configured

Indices are relative: each component is log-scaled and min-max normalised across
the technology set, so 0 and 100 mean "least" and "most" within this board.

Usage:
  python scripts/update_signals.py                     # live run
  python scripts/update_signals.py --end 2026-10       # fix the reporting month
  python scripts/update_signals.py --fixture raw.json  # no network, for tests
Standard library only.
"""
from __future__ import annotations

import argparse
import csv
import datetime as dt
import json
import math
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
UA = "ai-expectations-gap-map/1.0 (" + os.environ.get("SIGNALS_CONTACT", "https://github.com") + ")"
HISTORY_LIMIT = 60  # months kept in history.json


# ---------------------------------------------------------------- periods
def month_add(y: int, m: int, k: int) -> tuple[int, int]:
    t = y * 12 + (m - 1) + k
    return t // 12, t % 12 + 1


def periods(end: str | None) -> dict:
    """Last three complete months (L) and the three before (P)."""
    if end:
        ey, em = map(int, end.split("-"))
    else:
        today = dt.date.today()
        ey, em = month_add(today.year, today.month, -1)
    ls = month_add(ey, em, -2)
    pe = month_add(ey, em, -3)
    ps = month_add(ey, em, -5)

    def last_day(y, m):
        ny, nm = month_add(y, m, 1)
        return (dt.date(ny, nm, 1) - dt.timedelta(days=1)).day

    return {
        "label": f"{ey:04d}-{em:02d}",
        "L": (dt.date(*ls, 1), dt.date(ey, em, last_day(ey, em))),
        "P": (dt.date(*ps, 1), dt.date(*pe, last_day(*pe))),
    }


# ---------------------------------------------------------------- http
class Fetcher:
    def __init__(self):
        self.calls = 0
        self.failures = 0
        self.errors: list[str] = []

    def get(self, url: str, kind: str = "json", retries: int = 3):
        self.calls += 1
        for attempt in range(retries):
            try:
                req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "application/json, application/atom+xml"})
                with urllib.request.urlopen(req, timeout=30) as r:
                    body = r.read().decode("utf-8")
                return json.loads(body) if kind == "json" else body
            except urllib.error.HTTPError as e:
                if e.code == 404:
                    self.failures += 1
                    self.errors.append(f"404 {url}")
                    return None
                if e.code in (429, 500, 502, 503, 504) and attempt < retries - 1:
                    time.sleep(5 * (attempt + 1))
                    continue
                self.failures += 1
                self.errors.append(f"HTTP {e.code} {url}")
                return None
            except Exception as e:  # network, timeout, parse
                if attempt < retries - 1:
                    time.sleep(3 * (attempt + 1))
                    continue
                self.failures += 1
                self.errors.append(f"{type(e).__name__} {url}")
                return None


def wikipedia_views(f: Fetcher, article: str, p: dict) -> tuple[int, int] | None:
    title = urllib.parse.quote(article.replace(" ", "_"), safe="")
    start = p["P"][0].strftime("%Y%m%d")
    end = p["L"][1].strftime("%Y%m%d")
    url = (f"https://wikimedia.org/api/rest_v1/metrics/pageviews/per-article/en.wikipedia/"
           f"all-access/user/{title}/monthly/{start}00/{end}00")
    js = f.get(url)
    if not js or "items" not in js:
        return None
    L = P = 0
    for it in js["items"]:
        d = dt.datetime.strptime(it["timestamp"][:8], "%Y%m%d").date()
        if p["L"][0] <= d <= p["L"][1]:
            L += it["views"]
        elif p["P"][0] <= d <= p["P"][1]:
            P += it["views"]
    return L, P


def hn_stories(f: Fetcher, query: str, window: tuple[dt.date, dt.date]) -> int | None:
    a = int(dt.datetime.combine(window[0], dt.time.min, dt.timezone.utc).timestamp())
    b = int(dt.datetime.combine(window[1], dt.time.max, dt.timezone.utc).timestamp())
    qs = urllib.parse.urlencode({
        "query": f'"{query}"', "tags": "story", "hitsPerPage": 0,
        "restrictSearchableAttributes": "title",
        "numericFilters": f"created_at_i>={a},created_at_i<={b}",
    })
    js = f.get("https://hn.algolia.com/api/v1/search?" + qs)
    return None if js is None else int(js.get("nbHits", 0))


def arxiv_papers(f: Fetcher, query: str, window: tuple[dt.date, dt.date]) -> int | None:
    q = f'all:"{query}" AND submittedDate:[{window[0]:%Y%m%d}0000 TO {window[1]:%Y%m%d}2359]'
    url = "https://export.arxiv.org/api/query?" + urllib.parse.urlencode({"search_query": q, "max_results": 0})
    body = f.get(url, kind="text")
    time.sleep(3)  # arXiv asks for 3 s between calls
    if body is None:
        return None
    m = re.search(r"<opensearch:totalResults[^>]*>(\d+)<", body)
    return int(m.group(1)) if m else None


def pypi_last_month(f: Fetcher, pkg: str) -> int | None:
    js = f.get(f"https://pypistats.org/api/packages/{urllib.parse.quote(pkg)}/recent")
    time.sleep(1)
    if not js:
        return None
    return int(js.get("data", {}).get("last_month", 0))


def sum_opt(vals):
    vals = [v for v in vals if v is not None]
    return sum(vals) if vals else None


def collect_raw(tech: dict, p: dict, f: Fetcher) -> dict:
    s = tech.get("signals", {})
    wl, wp = [], []
    for art in s.get("wikipedia", []):
        r = wikipedia_views(f, art, p)
        if r:
            wl.append(r[0]); wp.append(r[1])
    hl = [hn_stories(f, q, p["L"]) for q in s.get("hn", [])]
    hp = [hn_stories(f, q, p["P"]) for q in s.get("hn", [])]
    ax = arxiv_papers(f, s["arxiv"], p["L"]) if s.get("arxiv") else None
    py = [pypi_last_month(f, k) for k in s.get("pypi", [])]
    return {
        "wikipedia_views": sum_opt(wl), "wikipedia_views_prior": sum_opt(wp),
        "hn_stories": sum_opt(hl), "hn_stories_prior": sum_opt(hp),
        "arxiv_papers": ax, "pypi_downloads": sum_opt(py),
    }


# ---------------------------------------------------------------- indices
def minmax_log(values: dict[str, float | None]) -> dict[str, float]:
    xs = {k: math.log1p(v) for k, v in values.items() if v is not None}
    if len(xs) < 3:
        return {}
    lo, hi = min(xs.values()), max(xs.values())
    if hi - lo < 1e-9:
        return {k: 0.5 for k in xs}
    return {k: (v - lo) / (hi - lo) for k, v in xs.items()}


def minmax(values: dict[str, float]) -> dict[str, float]:
    if len(values) < 3:
        return {}
    lo, hi = min(values.values()), max(values.values())
    if hi - lo < 1e-9:
        return {k: 0.5 for k in values}
    return {k: (v - lo) / (hi - lo) for k, v in values.items()}


def momentum(r: dict) -> float | None:
    parts = []
    for cur, prev in (("wikipedia_views", "wikipedia_views_prior"), ("hn_stories", "hn_stories_prior")):
        if r.get(cur) is not None and r.get(prev) is not None:
            parts.append(math.log((r[cur] + 1) / (r[prev] + 1)))
    return sum(parts) / len(parts) if parts else None


def compute_indices(raw: dict[str, dict]) -> dict[str, dict]:
    wiki = minmax_log({k: r.get("wikipedia_views") for k, r in raw.items()})
    hn = minmax_log({k: r.get("hn_stories") for k, r in raw.items()})
    mom_raw = {k: m for k, r in raw.items() if (m := momentum(r)) is not None}
    mom = minmax(mom_raw)
    pypi = minmax_log({k: r.get("pypi_downloads") for k, r in raw.items() if r.get("pypi_downloads")})
    out = {}
    for k, r in raw.items():
        comps = [(w, d[k]) for w, d in ((0.4, wiki), (0.4, hn), (0.2, mom)) if k in d]
        exp = 100 * sum(w * v for w, v in comps) / sum(w for w, _ in comps) if comps else None
        ev = 100 * pypi[k] if k in pypi else None
        raw_out = dict(r)
        raw_out["momentum"] = round(math.exp(mom_raw[k]) - 1, 4) if k in mom_raw else None
        out[k] = {
            "expectations_index": round(exp, 1) if exp is not None else None,
            "evidence_index": round(ev, 1) if ev is not None else None,
            "raw": raw_out,
        }
    return out


# ---------------------------------------------------------------- outputs
def load_assessments() -> dict[str, dict]:
    with open(DATA / "assessments.csv", newline="", encoding="utf-8") as fh:
        return {r["id"]: r for r in csv.DictReader(fh)}


def write_summary(path: Path, label: str, techs: dict, prev: dict | None, f: Fetcher, settings: dict, names: dict):
    A = load_assessments()
    flag = settings.get("review_flag_gap", 15)
    lines = [f"## Signal refresh for {label}", ""]
    lines.append(f"{f.calls} requests, {f.failures} failed.")
    lines.append("")
    if prev:
        moves = []
        for k, v in techs.items():
            a, b = v.get("expectations_index"), prev.get(k, {}).get("expectations_index")
            if a is not None and b is not None:
                moves.append((a - b, k, b, a))
        moves.sort(key=lambda x: -abs(x[0]))
        if moves:
            lines += ["### Largest moves in attention index", "", "| Technology | Previous | Now | Change |", "|---|---:|---:|---:|"]
            lines += [f"| {names[k]} | {b:.0f} | {a:.0f} | {d:+.0f} |" for d, k, b, a in moves[:8]]
            lines.append("")
    flags = []
    for k, v in techs.items():
        e = v.get("expectations_index")
        if e is not None and k in A and abs(e - float(A[k]["expectations"])) > flag:
            flags.append((abs(e - float(A[k]["expectations"])), k, float(A[k]["expectations"]), e, A[k]["reviewed"]))
    flags.sort(reverse=True)
    if flags:
        lines += [f"### Review: signals differ from analyst expectations by more than {flag}", "",
                  "| Technology | Analyst | Signals | Last reviewed |", "|---|---:|---:|---|"]
        lines += [f"| {names[k]} | {a:.0f} | {s:.0f} | {r} |" for _, k, a, s, r in flags]
        lines += ["", "Update `data/assessments.csv` in this pull request if the signal reflects a real shift, "
                      "and set `reviewed` to today. Leave it if the signal is noise (for example a query that matches unrelated stories)."]
        lines.append("")
    if f.errors:
        lines += ["<details><summary>Failed requests</summary>", "", *[f"- `{e}`" for e in f.errors[:50]], "", "</details>"]
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--end", help="Last complete month to report, YYYY-MM (default: previous month)")
    ap.add_argument("--fixture", help="JSON file of raw metrics per technology id; skips network")
    ap.add_argument("--summary", default=str(ROOT / "refresh-summary.md"))
    ap.add_argument("--max-failure-rate", type=float, default=0.5)
    args = ap.parse_args()

    cfg = json.loads((DATA / "technologies.json").read_text(encoding="utf-8"))
    settings = json.loads((DATA / "settings.json").read_text(encoding="utf-8"))
    names = {t["id"]: t["name"] for t in cfg["technologies"]}
    p = periods(args.end)
    f = Fetcher()

    if args.fixture:
        raw = {k: v for k, v in json.loads(Path(args.fixture).read_text(encoding="utf-8")).items()
               if isinstance(v, dict) and k in names}
    else:
        raw = {}
        for t in cfg["technologies"]:
            print(f"collecting {t['id']}", file=sys.stderr)
            raw[t["id"]] = collect_raw(t, p, f)
        if f.calls and f.failures / f.calls > args.max_failure_rate:
            print(f"Aborting: {f.failures}/{f.calls} requests failed", file=sys.stderr)
            print("\n".join(f.errors[:20]), file=sys.stderr)
            return 1

    techs = compute_indices(raw)
    signals = {
        "generated": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"),
        "period": p["label"],
        "window": {"current": [p["L"][0].isoformat(), p["L"][1].isoformat()],
                   "prior": [p["P"][0].isoformat(), p["P"][1].isoformat()]},
        "method": "Relative indices: log-scaled, min-max normalised across the set. "
                  "Expectations = 0.4 Wikipedia views + 0.4 HN stories + 0.2 momentum. Evidence = PyPI downloads where configured.",
        "technologies": techs,
        "errors": f.errors[:100],
    }
    (DATA / "signals.json").write_text(json.dumps(signals, indent=2) + "\n", encoding="utf-8")

    hist_path = DATA / "history.json"
    hist = json.loads(hist_path.read_text(encoding="utf-8")) if hist_path.exists() else {"snapshots": []}
    snaps = [s for s in hist["snapshots"] if s["period"] != p["label"]]
    prev = snaps[-1]["technologies"] if snaps else None
    snaps.append({"period": p["label"], "technologies": {
        k: {"expectations_index": v["expectations_index"], "evidence_index": v["evidence_index"]} for k, v in techs.items()}})
    snaps.sort(key=lambda s: s["period"])
    hist["snapshots"] = snaps[-HISTORY_LIMIT:]
    hist_path.write_text(json.dumps(hist, indent=1) + "\n", encoding="utf-8")

    write_summary(Path(args.summary), p["label"], techs, prev, f, settings, names)
    print(f"Wrote signals for {p['label']}: {len(techs)} technologies, {f.failures}/{f.calls} failed requests")
    return 0


if __name__ == "__main__":
    sys.exit(main())
