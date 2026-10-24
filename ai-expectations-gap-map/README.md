# AI Expectations Gap Map

An interactive board that replaces the hype-cycle curve with two measurable axes: **market expectations** (vertical) and **demonstrated value** (horizontal). The gap between them is the risk. Bubble size is business impact if the technology delivers. Five scenario drivers project the board forward with a small two-stock model.

Static site, no build step, no runtime dependencies. Hosted on GitHub Pages. Data refreshed by GitHub Actions.

```
index.html              the board
about.html              methodology and update process (reads live values from data/)
assets/app.js           UI (ES module)
assets/model.js         pure model functions (tested in Node)
assets/about.js         fills the methodology page from the data files
assets/styles.css
data/assessments.csv    analyst scores: expectations, evidence, impact, reviewed, notes   ← edit by hand
data/technologies.json  per-technology config: sensitivities, growth rate, watch signal, signal queries
data/scenarios.json     drivers and preset scenarios
data/settings.json      blend weights, class thresholds, model constants, defaults
data/signals.json       generated monthly: latest collected signals                      ← written by the job
data/history.json       generated monthly: one snapshot per month (trend lines)          ← written by the job
scripts/update_signals.py   collects signals, computes indices, writes summary (stdlib only)
scripts/validate_data.py    blocks bad data from reaching the site
.github/workflows/      deploy, monthly refresh, PR validation, quarterly review reminder
```

## Set up (about 10 minutes)

1. Create a new GitHub repository and push this folder to `main`.
   ```bash
   git init && git add . && git commit -m "Initial commit"
   git branch -M main
   git remote add origin git@github.com:<you>/ai-expectations-gap-map.git
   git push -u origin main
   ```
2. **Settings → Pages → Build and deployment → Source: GitHub Actions.**
3. **Settings → Actions → General → Workflow permissions:** select *Read and write permissions* and tick *Allow GitHub Actions to create and approve pull requests*. The monthly refresh needs this to open its pull request.
4. **Actions → Deploy site → Run workflow** for the first deploy. The URL appears in the run summary (`https://<you>.github.io/ai-expectations-gap-map/`).
5. **Actions → Monthly signal refresh → Run workflow** to collect the first signals now instead of waiting for the 3rd of next month. Review and merge the pull request it opens. "Blend" and "Signals only" become available after that.

Private repositories need a paid GitHub plan for Pages. For an internal-only board, use a private repo on GitHub Enterprise with Pages access control.

## How the data stays current

There are two kinds of data, updated on different cycles, and they are kept separate on purpose.

| What | Where | Who updates it | When |
|---|---|---|---|
| Attention and usage signals | `data/signals.json`, `data/history.json` | Monthly workflow, automatically | 05:17 UTC on the 3rd of each month |
| Expectations, evidence and impact scores | `data/assessments.csv` | You, by hand | Quarterly, or when a signal-refresh PR flags a gap |
| Sensitivities, signal queries, watch signals | `data/technologies.json` | You, by hand | When you add a technology or a query proves noisy |

### Monthly refresh (automatic, reviewed)

`refresh-data.yml` runs `update_signals.py`, which collects for each technology, over the last three complete months and the three before:

- **Wikipedia page views** (Wikimedia REST API): public attention.
- **Hacker News stories** with the query in the title (Algolia HN API): practitioner attention.
- **arXiv papers** matching the query: research activity, shown but not scored.
- **PyPI downloads** of configured packages (pypistats.org): a usage proxy for evidence, where a package maps cleanly to the technology.

It turns these into two relative indices (0 = least in the set, 100 = most):

- **Attention index** = 0.4 · Wikipedia + 0.4 · Hacker News + 0.2 · momentum (each log-scaled and min-max normalised).
- **Usage proxy index** = PyPI downloads, log-scaled and normalised, only for technologies with packages configured.

The job validates the result and **opens a pull request** rather than publishing directly. The PR description lists the largest movers since last month and every technology where the signals disagree with your analyst score by more than `review_flag_gap` (default 15). Merge it as-is, or adjust `assessments.csv` in the same PR first. Merging to `main` redeploys the site.

No API keys are needed. If more than half the requests fail (an API is down), the job aborts and opens nothing.

### Quarterly analyst review (manual, prompted)

`review-reminder.yml` opens an issue on the first day of each quarter. The issue lists every assessment not reviewed in 120 days, plus a checklist. To update a score, edit `data/assessments.csv` directly on GitHub (pencil icon), change the numbers and the `reviewed` date, and commit through a pull request. `validate.yml` checks the file before you can merge.

### Adding a technology

1. Add an object to `data/technologies.json`: `id`, `name`, `gartner_phase_2026`, `base_rate`, `sensitivities` (all five drivers, −1 to 1), `watch_signal` and `signals` (Wikipedia article titles, Hacker News phrases, an arXiv phrase, PyPI packages; leave lists empty where nothing fits).
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
