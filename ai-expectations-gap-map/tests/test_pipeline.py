"""Tests for the signal pipeline and data validation. Run: python -m unittest discover -s tests"""
import datetime as dt
import json
import subprocess
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))
import update_signals as us  # noqa: E402

FIX = json.loads((ROOT / "tests/fixtures/raw_sample.json").read_text())
FIX.pop("_comment", None)


class Periods(unittest.TestCase):
    def test_windows(self):
        p = us.periods("2026-10")
        self.assertEqual(p["label"], "2026-10")
        self.assertEqual(p["L"], (dt.date(2026, 8, 1), dt.date(2026, 10, 31)))
        self.assertEqual(p["P"], (dt.date(2026, 5, 1), dt.date(2026, 7, 31)))

    def test_year_boundary(self):
        p = us.periods("2027-01")
        self.assertEqual(p["L"], (dt.date(2026, 11, 1), dt.date(2027, 1, 31)))
        self.assertEqual(p["P"], (dt.date(2026, 8, 1), dt.date(2026, 10, 31)))


class Indices(unittest.TestCase):
    def setUp(self):
        self.out = us.compute_indices(FIX)

    def test_range(self):
        for k, v in self.out.items():
            for f in ("expectations_index", "evidence_index"):
                if v[f] is not None:
                    self.assertGreaterEqual(v[f], 0, k)
                    self.assertLessEqual(v[f], 100, k)

    def test_missing_sources_give_none(self):
        empty = {"a": {}, "b": {}, "c": {}}
        out = us.compute_indices(empty)
        self.assertTrue(all(v["expectations_index"] is None for v in out.values()))

    def test_more_attention_scores_higher(self):
        base = {"wikipedia_views": 1000, "wikipedia_views_prior": 1000, "hn_stories": 10, "hn_stories_prior": 10,
                "arxiv_papers": None, "pypi_downloads": None}
        raw = {"low": dict(base), "mid": {**base, "wikipedia_views": 10000, "hn_stories": 100},
               "high": {**base, "wikipedia_views": 100000, "hn_stories": 1000}}
        out = us.compute_indices(raw)
        self.assertLess(out["low"]["expectations_index"], out["mid"]["expectations_index"])
        self.assertLess(out["mid"]["expectations_index"], out["high"]["expectations_index"])

    def test_evidence_only_where_pypi(self):
        for k, r in FIX.items():
            if not r.get("pypi_downloads"):
                self.assertIsNone(self.out[k]["evidence_index"], k)


class Validation(unittest.TestCase):
    def test_repo_data_valid(self):
        r = subprocess.run([sys.executable, str(ROOT / "scripts/validate_data.py")], capture_output=True, text=True)
        self.assertEqual(r.returncode, 0, r.stdout)


if __name__ == "__main__":
    unittest.main()
