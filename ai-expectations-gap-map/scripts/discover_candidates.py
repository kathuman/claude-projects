#!/usr/bin/env python3
"""Find AI terms that are rising in public attention but are not on the board yet.

Reads the titles of AI stories on Hacker News and of AI papers on arXiv for the last three complete months and the
three before, counts the two- and three-word phrases in them, drops phrases the board already tracks and the noise
terms listed in settings.json (discovery.ignore), and keeps phrases that are frequent, rising, and present in at least
two of the three months (a one-week news story is not a trend). Version-numbered names (GPT-6, K3) and possessives
are skipped as product names, and so is a match whose Wikipedia article describes a company, a person or a product.
Each candidate gets a description from Wikipedia where an article matches, and a few example titles.

Writes data/candidates.json (this month's candidates, and every month each phrase has been a candidate) and appends a
"Candidates to consider" section to the refresh summary. Nothing is added to the board: that stays an analyst
decision. This step is advisory: if a source fails it reports what it could, and never fails the refresh.

Usage:
  python scripts/discover_candidates.py [--end YYYY-MM] [--summary refresh-summary.md]
  python scripts/discover_candidates.py --fixture tests/fixtures/discovery_sample.json   # no network, for tests
Standard library only.
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import math
import re
import sys
import time
import urllib.parse
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from update_signals import DATA, Fetcher, periods  # noqa: E402

STOP = set("""a an and are as at be by can do does for from has have how i if in into is it its just more my new no not of
on or our out so than that the their them they this to up us vs was we what when which who why will with without you your
via using use used towards toward based beyond under over about across between through after before can't don't
show ask tell hn launch launching introducing announcing
one two three four five six seven eight nine ten first second third dozens hundreds thousands millions""".split())
# words that make a phrase a news headline, not the name of a technology
NEWS = set("""says said say wants want launches launched raises raised hires hired sues sued bans banned beats beat
warns warned admits claims claimed reveals revealed reportedly""".split())
# a Wikipedia short description like these means the phrase names an organisation, a person or a product
NOT_TECH = re.compile(r"\b(company|corporation|firm|startup|businessman|businessperson|entrepreneur|executive|politician|"
                      r"film|album|song|video game|television|novel|band|chatbot|software product|website|newspaper)\b", re.I)
# the article has to be about computing to describe an AI technology
COMPUTING = re.compile(r"artificial intelligence|machine learning|neural|comput|algorithm|software|data|statistic|robot|"
                       r"language model|learning|program", re.I)
SPLIT = re.compile(r"[:;,.!?()\[\]\"“”‘’—–|/]+|\s-\s")
TOKEN = re.compile(r"[a-z0-9][a-z0-9+#\-']*")


# ---------------------------------------------------------------- phrases
def phrases(title: str) -> set[str]:
    """The two- and three-word phrases in a title, not crossing punctuation, not starting or ending on a stop word."""
    out = set()
    for chunk in SPLIT.split(title.lower()):
        words = TOKEN.findall(chunk)
        for n in (2, 3):
            for i in range(len(words) - n + 1):
                g = words[i:i + n]
                # version numbers and possessives name products and companies, a past tense or "says" a news story;
                # technologies are named by noun phrases
                if g[0] in STOP or g[-1] in STOP or len(set(g)) < n or any(re.search(r"\d|'s$", w) for w in g):
                    continue
                if any(w in NEWS or (w.endswith("ed") and len(w) > 4) for w in g):
                    continue
                out.add(" ".join(g))
    return out


def known_terms(cfg: dict) -> set[str]:
    """Everything the board already tracks: names and the signal queries, lower case."""
    terms = set()
    for t in cfg["technologies"]:
        terms.add(t["name"].lower())
        s = t.get("signals", {})
        terms.update(q.lower() for q in s.get("hn", []))
        terms.update(q.lower() for q in s.get("wikipedia", []))
        if s.get("arxiv"):
            terms.add(s["arxiv"].lower())
    return {re.sub(r"\s*\(.*?\)", "", x).strip() for x in terms if x}


def is_known(phrase: str, known: set[str]) -> bool:
    return any(phrase in k or k in phrase for k in known)


def count(titles: list[dict]) -> tuple[dict[str, int], dict[str, list[dict]], dict[str, set]]:
    """Distinct titles containing each phrase (a repost counts once), up to three examples, and the months it was in."""
    n: dict[str, int] = {}
    ex: dict[str, list[dict]] = {}
    months: dict[str, set] = {}
    seen = set()
    for d in titles:
        key = " ".join(TOKEN.findall(d["title"].lower()))
        if key in seen:
            continue
        seen.add(key)
        for g in phrases(d["title"]):
            n[g] = n.get(g, 0) + 1
            months.setdefault(g, set()).add(d.get("month"))
            if len(ex.setdefault(g, [])) < 3:
                ex[g].append(d)
    return n, ex, months


def rank(sources: dict[str, dict], known: set[str], ignore: set[str], min_count: int, min_rise: float,
         min_months: int = 2, ignore_words: set[str] = frozenset()) -> list[dict]:
    """sources: {name: {"L": [docs], "P": [docs]}}, each doc {title, url, month}. A phrase qualifies in a source when it
    appears in at least min_count distinct titles in the last three months, in at least min_months of those months, and
    its share of titles rose at least min_rise times (a phrase absent before counts as risen). Phrases with a word in
    ignore_words (companies, countries) are skipped. Score: titles per thousand of the source × log2(1 + rise), summed
    over sources, so a large sample (Hacker News) does not crowd out a smaller one (arXiv)."""
    found: dict[str, dict] = {}
    for src, docs in sources.items():
        nl, nP = max(1, len(docs["L"])), max(1, len(docs["P"]))
        cl, exl, ml = count(docs["L"])
        cp, _, _ = count(docs["P"])
        for g, c in cl.items():
            if c < min_count or len(ml[g]) < min_months or g in ignore or is_known(g, known):
                continue
            if any(w in ignore_words for w in g.split()):
                continue
            prior = cp.get(g, 0)
            rise = (c / nl) / max(prior / nP, 0.5 / nP)
            if rise < min_rise:
                continue
            f = found.setdefault(g, {"phrase": g, "score": 0.0, "examples": [], "sources": {}})
            f["sources"][src] = {"now": c, "before": prior, "rise": round(rise, 1)}
            f["score"] += 1000 * c / nl * math.log2(1 + rise)
            f["examples"] += exl[g][: 3 - len(f["examples"])]
    # a two-word phrase inside a three-word one that carries most of its count is the same topic: keep the longer
    out = sorted(found.values(), key=lambda x: -x["score"])
    keep = []
    for f in out:
        g = f["phrase"]
        longer = [k for k in keep if g in k["phrase"] and k["score"] >= 0.7 * f["score"]]
        if longer:
            continue
        keep = [k for k in keep if not (k["phrase"] in g and f["score"] >= 0.7 * k["score"])]
        keep.append(f)
    for f in keep:
        f["score"] = round(f["score"], 1)
    return keep


# ---------------------------------------------------------------- sources
def hn_titles(f: Fetcher, queries: list[str], window: tuple[dt.date, dt.date]) -> list[dict]:
    a = int(dt.datetime.combine(window[0], dt.time.min, dt.timezone.utc).timestamp())
    b = int(dt.datetime.combine(window[1], dt.time.max, dt.timezone.utc).timestamp())
    seen: dict[str, dict] = {}
    for q in queries:
        qs = urllib.parse.urlencode({"query": q, "tags": "story", "hitsPerPage": 1000, "restrictSearchableAttributes": "title",
                                     "numericFilters": f"created_at_i>={a},created_at_i<={b}"})
        js = f.get("https://hn.algolia.com/api/v1/search?" + qs)
        for h in (js or {}).get("hits", []):
            if h.get("title"):
                month = dt.datetime.fromtimestamp(h.get("created_at_i", 0), dt.timezone.utc).strftime("%Y-%m")
                seen[h["objectID"]] = {"title": h["title"], "url": f"https://news.ycombinator.com/item?id={h['objectID']}",
                                       "month": month}
    return list(seen.values())


def arxiv_titles(f: Fetcher, cats: list[str], window: tuple[dt.date, dt.date], n: int) -> list[dict]:
    """A sample of n paper titles per month of the window (the most recent of each month: arXiv lists by date)."""
    out = []
    y, m = window[0].year, window[0].month
    while (y, m) <= (window[1].year, window[1].month):
        first = dt.date(y, m, 1)
        last = (dt.date(y + (m == 12), m % 12 + 1, 1) - dt.timedelta(days=1))
        q = "(" + " OR ".join(f"cat:{c}" for c in cats) + f") AND submittedDate:[{first:%Y%m%d}0000 TO {last:%Y%m%d}2359]"
        url = "https://export.arxiv.org/api/query?" + urllib.parse.urlencode(
            {"search_query": q, "max_results": n, "sortBy": "submittedDate", "sortOrder": "descending"})
        body = f.get(url, kind="text")
        time.sleep(3)  # arXiv asks for 3 s between calls
        for entry in re.findall(r"<entry>(.*?)</entry>", body or "", re.S):
            t = re.search(r"<title>(.*?)</title>", entry, re.S)
            i = re.search(r"<id>(.*?)</id>", entry, re.S)
            if t:
                out.append({"title": " ".join(t.group(1).split()), "url": i.group(1).strip() if i else "", "month": f"{y:04d}-{m:02d}"})
        y, m = y + (m == 12), m % 12 + 1
    return out


def wikipedia_summary(f: Fetcher, phrase: str) -> dict | None:
    """The Wikipedia article for the phrase: the page of that name (following Wikipedia's own redirects, so
    "autonomous driving" finds "Self-driving car"), else a search hit named by the phrase itself. It must be about
    computing; an article about a company, a person or a product marks the phrase as not a technology."""
    norm = lambda x: re.sub(r"[-\s]+", " ", x.lower()).strip()
    stem = lambda x: " ".join(w.rstrip("s") for w in norm(x).split())
    titles = []
    direct = set()  # Wikipedia's own page (or redirect) for the phrase: no need to check its field
    qs = urllib.parse.urlencode({"action": "query", "titles": phrase[:1].upper() + phrase[1:], "redirects": 1, "format": "json"})
    js = f.get("https://en.wikipedia.org/w/api.php?" + qs)
    for pg in (js or {}).get("query", {}).get("pages", {}).values():
        if "missing" not in pg and "invalid" not in pg:
            titles.append(pg["title"])
            direct.add(pg["title"])
    qs = urllib.parse.urlencode({"action": "query", "list": "search", "srsearch": phrase, "srlimit": 5, "format": "json"})
    js = f.get("https://en.wikipedia.org/w/api.php?" + qs)
    titles += [h["title"] for h in (js or {}).get("query", {}).get("search", [])
               if stem(phrase) in stem(h["title"]) or stem(h["title"]) in stem(phrase)]
    for title in dict.fromkeys(titles):
        js = f.get("https://en.wikipedia.org/api/rest_v1/page/summary/" + urllib.parse.quote(title.replace(" ", "_"), safe=""))
        if not js or js.get("type") == "disambiguation" or not js.get("extract"):
            continue
        if NOT_TECH.search(js.get("description", "")):
            return {"not_technology": js.get("description")}
        if title not in direct and not COMPUTING.search(js.get("description", "") + " " + js["extract"]):
            continue  # same name, another field (a pistol called Astra Model 900)
        return {"title": js.get("title", title), "extract": js["extract"], "description": js.get("description", ""),
                "url": js.get("content_urls", {}).get("desktop", {}).get("page", f"https://en.wikipedia.org/wiki/{title}")}
    return None


# ---------------------------------------------------------------- outputs
def update_history(prev: dict, period: str, phrases_now: list[str]) -> dict:
    """Every month each phrase has been a candidate, kept for good."""
    hist = {k: list(v) for k, v in prev.items()}
    for g in phrases_now:
        if period not in hist.setdefault(g, []):
            hist[g].append(period)
            hist[g].sort()
    return hist


def summary_section(cands: list[dict], period: str) -> str:
    lines = ["", "### Candidates to consider", ""]
    if not cands:
        return "\n".join(lines + ["No rising term outside the board this month.", ""])
    lines += ["Terms rising in AI story and paper titles that the board does not track. Most are noise (product names, "
              "one-off news); add one only if it names a technology worth scoring (README: Adding a technology).", "",
              "| Term | Hacker News now / before | arXiv now / before | Months seen | Wikipedia |", "|---|---:|---:|---:|---|"]
    for c in cands:
        s = c["sources"]
        cell = lambda k: f"{s[k]['now']} / {s[k]['before']}" if k in s else "–"
        wiki = f"[{c['wikipedia']['title']}]({c['wikipedia']['url']})" if c.get("wikipedia") else "–"
        lines.append(f"| {c['phrase']} | {cell('hn')} | {cell('arxiv')} | {len(c['seen'])} | {wiki} |")
    return "\n".join(lines + [""])


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--end", help="Last complete month, YYYY-MM (default: previous month)")
    ap.add_argument("--fixture", help="JSON with titles per source and window, and Wikipedia summaries; skips network")
    ap.add_argument("--summary", help="Markdown file to append the candidates section to")
    ap.add_argument("--out", default=str(DATA / "candidates.json"))
    args = ap.parse_args()

    cfg = json.loads((DATA / "technologies.json").read_text(encoding="utf-8"))
    d = json.loads((DATA / "settings.json").read_text(encoding="utf-8"))["discovery"]
    p = periods(args.end)
    f = Fetcher()
    if args.fixture:
        fx = json.loads(Path(args.fixture).read_text(encoding="utf-8"))
        sources = {k: fx[k] for k in ("hn", "arxiv") if k in fx}
        wiki = lambda g: fx.get("wikipedia", {}).get(g)
    else:
        sources = {
            "hn": {"L": hn_titles(f, d["hn_queries"], p["L"]), "P": hn_titles(f, d["hn_queries"], p["P"])},
            "arxiv": {"L": arxiv_titles(f, d["arxiv_categories"], p["L"], d["arxiv_sample"]),
                      "P": arxiv_titles(f, d["arxiv_categories"], p["P"], d["arxiv_sample"])},
        }
        wiki = lambda g: wikipedia_summary(f, g)
    sources = {k: v for k, v in sources.items() if v["L"] and v["P"]}  # a source that failed is left out

    ranked = rank(sources, known_terms(cfg), {x.lower() for x in d.get("ignore", [])}, d["min_count"], d["min_rise"],
                  d.get("min_months", 2), {x.lower() for x in d.get("ignore_words", [])})
    cands = []
    for c in ranked[: 3 * d["max_candidates"]]:  # bounded Wikipedia lookups
        if len(cands) >= d["max_candidates"]:
            break
        w = wiki(c["phrase"])
        if w and w.get("not_technology"):
            continue  # an organisation, a person or a product
        if w and any((k.get("wikipedia") or {}).get("title") == w["title"] for k in cands):
            continue  # another wording of a candidate already kept ("open weight", "open-weight ai")
        c["wikipedia"] = w
        cands.append(c)

    out = Path(args.out)
    prev = json.loads(out.read_text(encoding="utf-8")) if out.exists() else {}
    history = update_history(prev.get("history", {}), p["label"], [c["phrase"] for c in cands])
    for c in cands:
        c["seen"] = history[c["phrase"]]
    doc = {
        "generated": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"),
        "period": p["label"],
        "method": "Two- and three-word phrases in AI story titles (Hacker News) and AI paper titles (arXiv), last three "
                  "months against the three before; kept when frequent and rising, and not already on the board.",
        "documents": {k: {"now": len(v["L"]), "before": len(v["P"])} for k, v in sources.items()},
        "candidates": cands,
        "history": history,
        "errors": f.errors[:50],
    }
    out.write_text(json.dumps(doc, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")
    if args.summary:
        with open(args.summary, "a", encoding="utf-8") as fh:
            fh.write(summary_section(cands, p["label"]))
    print(f"{len(cands)} candidates for {p['label']} from "
          + ", ".join(f"{k}: {v['now']} titles" for k, v in doc["documents"].items()) + f"; {f.failures}/{f.calls} failed requests")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as e:  # advisory: never fail the refresh
        print(f"Candidate discovery skipped: {type(e).__name__}: {e}", file=sys.stderr)
        sys.exit(0)
