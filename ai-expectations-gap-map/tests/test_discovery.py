"""Tests for finding rising terms that are not on the board. Run: python -m unittest discover -s tests"""
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))
import discover_candidates as dc  # noqa: E402


def docs(titles_by_month: dict[str, list[str]]) -> list[dict]:
    return [{"title": t, "url": f"https://example.org/{i}-{m}", "month": m}
            for m, ts in titles_by_month.items() for i, t in enumerate(ts)]


FILLER = [f"Unrelated story number {w}" for w in "abcdefghijklmnopqrstuvwxyz"]


class Phrases(unittest.TestCase):
    def test_noun_phrases_only(self):
        p = dc.phrases("Flow matching beats diffusion: GPT-6 Astra and OpenAI's rogue agent hacked three companies")
        self.assertIn("flow matching", p)
        self.assertNotIn("gpt-6 astra", p)             # version number: a product
        self.assertFalse(any("openai's" in x for x in p))  # possessive: a company
        self.assertFalse(any("hacked" in x for x in p))    # past tense: a news story
        self.assertFalse(any("three" in x for x in p))
        self.assertNotIn("matching beats", p)          # "beats" is a headline verb
        self.assertFalse(any(x.startswith("and ") or x.endswith(" and") for x in p))

    def test_no_phrase_across_punctuation(self):
        self.assertNotIn("matching diffusion", dc.phrases("Flow matching: diffusion"))


class Ranking(unittest.TestCase):
    def setUp(self):
        L = docs({
            "2026-07": ["Neural operators for weather", "Scaling neural operators", "Rogue agents in the wild"] + FILLER,
            "2026-08": ["Neural operators meet PDEs", "Fast neural operators", "Rogue agents again", "Rogue agents again"] + FILLER,
            "2026-09": ["Neural operators at scale", "Neural operators, revisited", "Rogue agents everywhere",
                        "Self driving trucks", "Self driving trucks rollout", "Self driving trucks pilot",
                        "AI agents everywhere", "AI agents at work", "AI agents ship",
                        "Language model zoo", "Language model zoo two", "Language model zoo three"] + FILLER,
        })
        P = docs({"2026-04": ["Neural operators intro", "Rogue agents"] + FILLER, "2026-05": FILLER, "2026-06": FILLER})
        self.sources = {"hn": {"L": L, "P": P}}
        self.known = {"ai agents"}

    def ranked(self, **kw):
        args = dict(known=self.known, ignore={"language model zoo"}, min_count=3, min_rise=1.5, min_months=2)
        args.update(kw)
        return {c["phrase"]: c for c in dc.rank(self.sources, **args)}

    def test_rising_in_several_months_is_found(self):
        r = self.ranked()
        self.assertIn("neural operators", r)
        self.assertEqual(r["neural operators"]["sources"]["hn"]["now"], 6)
        self.assertEqual(r["neural operators"]["sources"]["hn"]["before"], 1)

    def test_one_month_spike_is_not_a_trend(self):
        self.assertNotIn("self driving trucks", self.ranked())
        self.assertNotIn("driving trucks", self.ranked())
        self.assertIn("self driving trucks", self.ranked(min_months=1))

    def test_known_and_ignored_terms_are_dropped(self):
        r = self.ranked()
        self.assertNotIn("ai agents", r)
        self.assertNotIn("language model zoo", r)
        self.assertNotIn("rogue agents", self.ranked(ignore_words={"rogue"}))

    def test_reposts_count_once(self):
        self.assertEqual(self.ranked()["rogue agents"]["sources"]["hn"]["now"], 3)

    def test_examples_are_kept(self):
        ex = self.ranked()["neural operators"]["examples"]
        self.assertTrue(1 <= len(ex) <= 3 and all("neural operators" in e["title"].lower() for e in ex))

    def test_shorter_phrase_inside_a_longer_one_is_merged(self):
        src = {"hn": {"L": docs({"2026-08": ["Diffusion language models win"] * 1 + ["Diffusion language models scale",
                                              "Diffusion language models fast"], "2026-09": ["Diffusion language models now",
                                              "Diffusion language models again"]}), "P": docs({"2026-05": FILLER})}}
        r = {c["phrase"] for c in dc.rank(src, set(), set(), 3, 1.5, 2)}
        self.assertIn("diffusion language models", r)
        self.assertNotIn("diffusion language", r)
        self.assertNotIn("language models", r)


class History(unittest.TestCase):
    def test_months_accumulate_and_are_kept(self):
        h = dc.update_history({}, "2026-09", ["a", "b"])
        h = dc.update_history(h, "2026-10", ["a"])
        h = dc.update_history(h, "2026-10", ["a"])
        self.assertEqual(h, {"a": ["2026-09", "2026-10"], "b": ["2026-09"]})


class EndToEnd(unittest.TestCase):
    def test_fixture_run_writes_candidates_and_summary(self):
        with tempfile.TemporaryDirectory() as d:
            out, summary = Path(d) / "c.json", Path(d) / "s.md"
            r = subprocess.run([sys.executable, str(ROOT / "scripts/discover_candidates.py"), "--end", "2026-09",
                                "--fixture", str(ROOT / "tests/fixtures/discovery_sample.json"),
                                "--out", str(out), "--summary", str(summary)], capture_output=True, text=True)
            self.assertEqual(r.returncode, 0, r.stderr)
            doc = json.loads(out.read_text(encoding="utf-8"))
            names = [c["phrase"] for c in doc["candidates"]]
            self.assertIn("neural operators", names)
            c = doc["candidates"][names.index("neural operators")]
            self.assertEqual(c["wikipedia"]["title"], "Neural operators")
            self.assertEqual(c["seen"], ["2026-09"])
            self.assertNotIn("big tech", names)  # its Wikipedia article is about companies
            self.assertIn("### Candidates to consider", summary.read_text(encoding="utf-8"))


if __name__ == "__main__":
    unittest.main()
