# AI Expectations Gap Map

An interactive board that replaces the hype-cycle curve with two measurable axes: **market expectations** (vertical) and **demonstrated value** (horizontal). The gap between them is the risk. Bubble size is business impact if the technology delivers. Five scenario drivers project the board forward with a small two-stock model.

Static site, no build step, no runtime dependencies. Part of [AI Projects](https://kathuman.github.io/claude-projects/), live at https://kathuman.github.io/claude-projects/ai-expectations-gap-map/. Data refreshed by GitHub Actions.

```
index.html              the board
about.html              methodology and update process (reads live values from data/)
assets/app.js           UI (ES module)
assets/model.js         pure model functions (tested in Node)
assets/accuracy.js      scores the frozen forecasts as they come due (tested in Node)
track.html, assets/track.js   the track record page
assets/about.js         fills the methodology page from the data files
assets/styles.css
data/assessments.csv    analyst scores: expectations, evidence, impact, reviewed, notes   ← edit by hand
data/technologies.json  per-technology config: sensitivities, growth rate, watch signal, signal queries
data/scenarios.json     drivers and preset scenarios
data/settings.json      blend weights, class thresholds, model constants, defaults
data/signals.json       generated monthly: latest collected signals                      ← written by the job
data/history.json       generated monthly: one snapshot per month, all kept              ← written by the job
data/ledger.json        generated monthly: the board and its forecasts, frozen          ← written by the job
scripts/update_signals.py   collects signals, computes indices, writes summary (stdlib only)
scripts/validate_data.py    blocks bad data from reaching the site
scripts/record_forecast.mjs freezes the month's forecasts in the ledger (Node, uses assets/model.js)
scripts/discover_candidates.py  finds rising terms the board does not track yet (advisory)
data/candidates.json    generated monthly: this month's candidates, and every month each was one  ← written by the job
assets/brand/           Estay Dynamics lockups (light and dark) and favicon
(repository root) .github/workflows/gap-map-*.yml   monthly refresh, tests, quarterly review reminder
```

## Where it runs

The board lives in the `claude-projects` repository, which GitHub Pages publishes from `main`: a change merged there
is live within a minute or two, so there is no deploy job of its own. Its workflows sit at the repository root:

- `gap-map-validate.yml`: data validation, the pipeline tests and the model tests on every change to this folder.
- `gap-map-refresh.yml`: the monthly signal refresh (below). It opens a pull request, which needs **Settings →
  Actions → General → Workflow permissions → Allow GitHub Actions to create and approve pull requests**, with read
  and write permissions. Run it once by hand (**Actions → AI Expectations Gap Map signal refresh → Run workflow**) to
  collect the first signals; "Blend" and "Signals only" become available once its pull request is merged.
- `gap-map-review.yml`: the quarterly analyst-review issue.

## How the data stays current

There are two kinds of data, updated on different cycles, and they are kept separate on purpose.

| What | Where | Who updates it | When |
|---|---|---|---|
| Attention and usage signals | `data/signals.json`, `data/history.json` | Monthly workflow, automatically | 05:17 UTC on the 3rd of each month |
| Expectations, evidence and impact scores | `data/assessments.csv` | You, by hand | Quarterly, or when a signal-refresh PR flags a gap |
| Sensitivities, signal queries, watch signals | `data/technologies.json` | You, by hand | When you add a technology or a query proves noisy |

### Monthly refresh (automatic, reviewed)

`gap-map-refresh.yml` runs `update_signals.py`, which collects for each technology, over the last three complete months and the three before:

- **Wikipedia page views** (Wikimedia REST API): public attention.
- **Hacker News stories** with the query in the title (Algolia HN API): practitioner attention.
- **arXiv papers** matching the query: research activity, shown but not scored.
- **PyPI downloads** of configured packages (pypistats.org): a usage proxy for evidence, where a package maps cleanly to the technology.

It turns these into two relative indices (0 = least in the set, 100 = most):

- **Attention index** = 0.4 · Wikipedia + 0.4 · Hacker News + 0.2 · momentum (each log-scaled and min-max normalised).
- **Usage proxy index** = PyPI downloads, log-scaled and normalised, only for technologies with packages configured.

The job validates the result and **opens a pull request** rather than publishing directly. The PR description lists the largest movers since last month and every technology where the signals disagree with your analyst score by more than `review_flag_gap` (default 15). Merge it as-is, or adjust `assessments.csv` in the same PR first. Merging to `main` republishes the site.

No API keys are needed. If more than half the requests fail (an API is down), the job aborts and opens nothing.

### Keeping score (automatic)

After collecting the signals, the monthly job runs `scripts/record_forecast.mjs`, which adds one record to
`data/ledger.json`: the analyst scores and signals as they stood, the board's starting positions, and the model's
forecast for every preset scenario at the horizons in `settings.json` (`track.horizons_months`: 3, 6, 12 and 24).
A record is never rewritten; a second run for the same month keeps the first (`--replace` overrides that by hand).

`track.html` scores every forecast that has come due against the board's position in the month it was aimed at,
and against a forecast that nothing moves (skill = 1 − error ÷ standing-still error). It also counts the right
quadrant, the right direction of expectations against the measured attention signals, and which scenario came
closest. The refresh pull request ends with a short track-record note. `data/history.json` now keeps every month.

### Finding new technologies (automatic, advisory)

The board only measures the technologies in `data/technologies.json`, so the monthly job also looks for what it is
missing. `scripts/discover_candidates.py` reads the titles of AI stories on Hacker News (the queries in
`settings.json` → `discovery.hn_queries`) and a sample of AI papers on arXiv for each month, counts the two- and
three-word phrases, and keeps those that:

- appear in at least `min_count` distinct titles (a repost counts once) in the last three months, in at least
  `min_months` of those months (a one-week news story is not a trend);
- rose at least `min_rise` times as a share of titles against the three months before;
- are not already on the board (names and signal queries), not in `ignore` (whole phrases) and contain no word in
  `ignore_words` (companies, products, countries);
- are noun phrases: version-numbered names (GPT-6), possessives and headline verbs ("says", past tenses) are skipped.

Each candidate gets a description from Wikipedia where an article is named by the phrase (an article about a company,
person or product drops the candidate), or example titles where there is none. The board shows them under "Rising,
not on the board yet", the refresh pull request lists them under "Candidates to consider", and
`data/candidates.json` keeps every month each phrase has been a candidate, so a trend that persists stands out from
a one-month blip. Nothing is added automatically: most candidates are noise. When one names a technology worth
scoring, add it as below; when the same noise keeps returning, add it to `ignore` or `ignore_words`. This step never
fails the refresh: if a source is down, it reports what it could.

### Quarterly analyst review (manual, prompted)

`gap-map-review.yml` opens an issue on the first day of each quarter. The issue lists every assessment not reviewed in 120 days, plus a checklist. To update a score, edit `data/assessments.csv` directly on GitHub (pencil icon), change the numbers and the `reviewed` date, and commit through a pull request. `gap-map-validate.yml` checks the file before you can merge.

### Adding a technology

1. Add an object to `data/technologies.json`: `id`, `name`, `description` (what it is, in a sentence or two),
   `supply_chain_example` (one concrete use in supply chain management), `gartner_phase_2026`, `base_rate`, `sensitivities` (all five drivers, −1 to 1), `watch_signal` and `signals` (Wikipedia article titles, Hacker News phrases, an arXiv phrase, PyPI packages; leave lists empty where nothing fits).
2. Add a row with the same `id` to `data/assessments.csv`.
3. Open a pull request. Validation fails if either half is missing.

## Running locally

```bash
python3 -m http.server 8000          # then open http://localhost:8000
python3 scripts/validate_data.py
python3 -m unittest discover -s tests
node --test tests/model.test.mjs
python3 scripts/update_signals.py --end 2026-10                                      # live collection
python3 scripts/update_signals.py --fixture tests/fixtures/raw_sample.json --end 2026-10  # offline, synthetic data
```

Opening `index.html` directly from disk will not work: browsers block `fetch` from `file://`.

The offline fixture is synthetic test data. Don't commit the `data/signals.json` it produces.

## Sharing a view

"Copy link to this view" encodes the scenario, drivers, horizon, correction speed, data mode and selected technology in the URL. Use it to send a specific future to a colleague or embed it in a deck.

## Known limitations

- **Attention is not adoption.** The attention index measures how much people look and talk, which is a proxy for expectations, not value. Evidence remains mostly an analyst judgement. The PyPI proxy covers only technologies with clean package mappings and overweights open-source Python ecosystems.
- **Queries are noisy.** "AGI" or "LLM" match a lot of unrelated noise; "AI factory" matches few stories. Read the review flags with that in mind and tune `signals` in `technologies.json` when a query misleads.
- **Indices are relative.** If everything gets more attention, the indices don't move. Look at the raw counts and momentum in the detail card for absolute change.
- **The model is a thinking tool.** Thresholds, sensitivities and the premium formula are judgement calls, kept in `settings.json` and `technologies.json` so you can change them without touching code.
- **Live collection has not been tested against the real APIs in this build.** Run the refresh workflow once by hand and read the failed-requests section of the PR before relying on it.

Starting assessments: analyst review, October 2026. Gartner's 2026 phases are included for comparison only and are not used in any calculation.
