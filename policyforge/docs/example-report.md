# Evaluation report c917489a1d7ad608

- **Candidate:** b-to-c-switch
- **Network:** FoodNet · **Constitution:** foodnet-constitution@1 (α = 5%, risk: CVAR at 95%)
- **Scenarios:** default-suite, 8 scenarios · **Replications:** 500 × 104 periods, seed 42, first 8 periods left out
- **Policies:** candidate, incumbent, naive, rolling_opt · created 2026-11-19 18:24 UTC in 48 s

## Verdict: APPROVE

- **info:** Under North plant capacity loss, breaches “Chilled SKUs: fill rate at least 97 %” in 14.0% of replications, as the incumbent does (14.0%): not made worse by this policy.
- **info:** Under Correlated shock, breaches “Chilled SKUs: fill rate at least 97 %” in 41.8% of replications, fewer than the incumbent's 48.8%: improved by this policy.
- **info:** Under Correlated shock, breaches “Class A SKUs: fill rate at least 95 %” in 7.0% of replications, fewer than the incumbent's 48.8%: improved by this policy.
- **info:** Under Noisy, delayed signals, breaches “Chilled SKUs: fill rate at least 97 %” in 94.6% of replications, as the incumbent does (94.8%): not made worse by this policy.
- **info:** Better than the incumbent on service, the first priority where they differ: fill rate (CVaR) 95.3% against 94.6%.

Candidate against incumbent, in the constitution's priority order (averaged over scenarios):

| Objective | Measure | Candidate | Incumbent | Outcome |
|---|---|---|---|---|
| service | fill_rate (cvar) | 95.3% | 94.6% | better |
| resilience | peak_service_loss (cvar) | 34.5% | 38.0% | better |
| cost | cost_per_week (cvar) | €31,310 | €31,214 | same |
| carbon | co2_t (mean) | 34.7 | 34.9 | same |

## Constitution

Share of replications breaching each hard constraint. A constraint passes when the share is at most α.

| Scenario | Constraint | candidate | incumbent | naive | rolling_opt |
|---|---|---|---|---|---|
| Baseline | Chilled SKUs: fill rate at least 97 % | 0% ✓ | 0% ✓ | 100% ✗ | 94% ✗ |
| Baseline | Class A SKUs: fill rate at least 95 % | 0% ✓ | 0% ✓ | 100% ✗ | 2% ✓ |
| Baseline | Expedite spend at most €20,000 in any month | 0% ✓ | 0% ✓ | 0% ✓ | 0% ✓ |
| Baseline | No DC holds more than 35 days of stock on average | 0% ✓ | 0% ✓ | 0% ✓ | 0% ✓ |
| North demand surge | Chilled SKUs: fill rate at least 97 % | 0% ✓ | 0% ✓ | 100% ✗ | 98% ✗ |
| North demand surge | Class A SKUs: fill rate at least 95 % | 0% ✓ | 0% ✓ | 100% ✗ | 100% ✗ |
| North demand surge | Expedite spend at most €20,000 in any month | 0% ✓ | 0% ✓ | 0% ✓ | 0% ✓ |
| North demand surge | No DC holds more than 35 days of stock on average | 0% ✓ | 0% ✓ | 0% ✓ | 0% ✓ |
| Ambient promotion spike | Chilled SKUs: fill rate at least 97 % | 0% ✓ | 0% ✓ | 100% ✗ | 98% ✗ |
| Ambient promotion spike | Class A SKUs: fill rate at least 95 % | 0% ✓ | 0% ✓ | 100% ✗ | 100% ✗ |
| Ambient promotion spike | Expedite spend at most €20,000 in any month | 0% ✓ | 0% ✓ | 0% ✓ | 0% ✓ |
| Ambient promotion spike | No DC holds more than 35 days of stock on average | 0% ✓ | 0% ✓ | 0% ✓ | 0% ✓ |
| Supplier B outage | Chilled SKUs: fill rate at least 97 % | 0% ✓ | 0% ✓ | 100% ✗ | 100% ✗ |
| Supplier B outage | Class A SKUs: fill rate at least 95 % | 0% ✓ | 0% ✓ | 100% ✗ | 100% ✗ |
| Supplier B outage | Expedite spend at most €20,000 in any month | 0% ✓ | 0% ✓ | 0% ✓ | 0% ✓ |
| Supplier B outage | No DC holds more than 35 days of stock on average | 0% ✓ | 0% ✓ | 0% ✓ | 0% ✓ |
| Supplier B lead-time creep | Chilled SKUs: fill rate at least 97 % | 0% ✓ | 0% ✓ | 100% ✗ | 100% ✗ |
| Supplier B lead-time creep | Class A SKUs: fill rate at least 95 % | 0% ✓ | 0% ✓ | 100% ✗ | 100% ✗ |
| Supplier B lead-time creep | Expedite spend at most €20,000 in any month | 0% ✓ | 0% ✓ | 0% ✓ | 0% ✓ |
| Supplier B lead-time creep | No DC holds more than 35 days of stock on average | 0% ✓ | 0% ✓ | 0% ✓ | 0% ✓ |
| North plant capacity loss | Chilled SKUs: fill rate at least 97 % | 14% ✗ | 14% ✗ | 100% ✗ | 98% ✗ |
| North plant capacity loss | Class A SKUs: fill rate at least 95 % | 0% ✓ | 0% ✓ | 100% ✗ | 98% ✗ |
| North plant capacity loss | Expedite spend at most €20,000 in any month | 0% ✓ | 0% ✓ | 0% ✓ | 0% ✓ |
| North plant capacity loss | No DC holds more than 35 days of stock on average | 0% ✓ | 0% ✓ | 0% ✓ | 0% ✓ |
| Correlated shock | Chilled SKUs: fill rate at least 97 % | 42% ✗ | 49% ✗ | 100% ✗ | 96% ✗ |
| Correlated shock | Class A SKUs: fill rate at least 95 % | 7% ✗ | 49% ✗ | 100% ✗ | 46% ✗ |
| Correlated shock | Expedite spend at most €20,000 in any month | 0% ✓ | 0% ✓ | 0% ✓ | 0% ✓ |
| Correlated shock | No DC holds more than 35 days of stock on average | 0% ✓ | 0% ✓ | 0% ✓ | 0% ✓ |
| Noisy, delayed signals | Chilled SKUs: fill rate at least 97 % | 95% ✗ | 95% ✗ | 100% ✗ | 100% ✗ |
| Noisy, delayed signals | Class A SKUs: fill rate at least 95 % | 2% ✓ | 2% ✓ | 100% ✗ | 100% ✗ |
| Noisy, delayed signals | Expedite spend at most €20,000 in any month | 0% ✓ | 0% ✓ | 0% ✓ | 0% ✓ |
| Noisy, delayed signals | No DC holds more than 35 days of stock on average | 0% ✓ | 0% ✓ | 0% ✓ | 0% ✓ |

## Key results by scenario

Each cell is the mean over replications, with the 5th–95th percentile range in brackets.

### Baseline

Seasonal stochastic demand, normal lead times and fill rates.

| Metric | candidate | incumbent | naive | rolling_opt (subsample) |
|---|---|---|---|---|
| Fill rate (fraction) | 98.2% (97.8%–98.6%) | 98.2% (97.8%–98.6%) | 73.7% (71.2%–76.1%) | 94.7% (93.8%–95.5%) |
| Fill rate (category chilled) (fraction) | 98.5% (97.8%–99.1%) | 98.5% (97.8%–99.1%) | 80.5% (78.7%–82.2%) | 96.3% (95.5%–96.9%) |
| OTIF (lines met in full) (fraction) | 91.0% (89.9%–92.1%) | 91.0% (89.9%–92.1%) | 36.0% (33.7%–38.3%) | 82.5% (80.9%–84.5%) |
| Total cost per week (EUR/week) | €30,764 (€30,471–€31,041) | €30,677 (€30,405–€30,921) | €31,017 (€30,736–€31,284) | €30,564 (€30,329–€30,845) |
| Worst monthly expedite spend (EUR/month) | €0 (€0–€0) | €0 (€0–€0) | €0 (€0–€0) | €0 (€0–€0) |
| Peak service loss after the shock (fraction) | — | — | — | — |
| Time to recover service (periods) | — | — | — | — |
| Bullwhip ratio, DC orders (ratio) | 1.94 (1.76–2.12) | 1.94 (1.76–2.12) | 1.87 (1.42–2.40) | 100.02 (80.51–129.89) |
| Emissions (t CO2e) | 34.6 (34.3–34.9) | 34.8 (34.5–35.0) | 32.9 (32.6–33.1) | 34.5 (34.2–34.8) |
| Escalations (count) | 0.00 (0.00–0.00) | 0.00 (0.00–0.00) | 0.00 (0.00–0.00) | 0.00 (0.00–0.00) |

Regret against the best policy in each replication (mean):

| Policy | Cost regret over the horizon (EUR) | Fill-rate regret |
|---|---|---|
| candidate | €8,385 | 0.0% |
| incumbent | €21 | 0.0% |
| naive | €32,594 | 24.5% |

### North demand surge

Demand in the North markets rises 30 % from week 30 for 16 weeks.

| Metric | candidate | incumbent | naive | rolling_opt (subsample) |
|---|---|---|---|---|
| Fill rate (fraction) | 98.1% (97.7%–98.5%) | 98.1% (97.7%–98.5%) | 70.5% (68.0%–72.9%) | 89.2% (87.1%–91.4%) |
| Fill rate (category chilled) (fraction) | 98.5% (97.9%–99.1%) | 98.5% (97.9%–99.1%) | 79.1% (77.4%–80.9%) | 96.2% (95.5%–96.9%) |
| OTIF (lines met in full) (fraction) | 90.9% (89.8%–92.0%) | 90.9% (89.8%–92.0%) | 34.2% (31.9%–36.4%) | 79.4% (77.4%–81.4%) |
| Total cost per week (EUR/week) | €31,288 (€30,986–€31,573) | €31,175 (€30,912–€31,416) | €31,743 (€31,447–€32,028) | €31,408 (€31,070–€31,808) |
| Worst monthly expedite spend (EUR/month) | €0 (€0–€0) | €0 (€0–€0) | €0 (€0–€0) | €0 (€0–€0) |
| Peak service loss after the shock (fraction) | 3.5% (1.7%–5.4%) | 3.5% (1.7%–5.4%) | 34.6% (24.1%–45.8%) | 27.4% (23.3%–31.8%) |
| Time to recover service (periods) | 34.30 (3.00–74.00) | 33.91 (3.00–73.05) | 40.24 (24.00–74.00) | 40.82 (32.45–51.65) |
| Bullwhip ratio, DC orders (ratio) | 1.56 (1.44–1.68) | 1.56 (1.44–1.68) | 1.15 (0.93–1.37) | 40.33 (33.05–48.81) |
| Emissions (t CO2e) | 35.1 (34.8–35.4) | 35.3 (35.0–35.5) | 33.2 (33.0–33.5) | 35.0 (34.7–35.3) |
| Escalations (count) | 0.00 (0.00–0.00) | 0.00 (0.00–0.00) | 0.00 (0.00–0.00) | 0.00 (0.00–0.00) |

Regret against the best policy in each replication (mean):

| Policy | Cost regret over the horizon (EUR) | Fill-rate regret |
|---|---|---|
| candidate | €10,842 | 0.0% |
| incumbent | €0 | 0.0% |
| naive | €54,507 | 27.7% |

### Ambient promotion spike

Ambient demand doubles for 3 weeks from week 40.

| Metric | candidate | incumbent | naive | rolling_opt (subsample) |
|---|---|---|---|---|
| Fill rate (fraction) | 95.5% (94.2%–96.7%) | 95.2% (93.9%–96.3%) | 68.0% (65.6%–70.3%) | 86.4% (83.7%–88.6%) |
| Fill rate (category chilled) (fraction) | 98.4% (97.8%–99.0%) | 98.4% (97.8%–99.0%) | 80.2% (78.4%–81.9%) | 96.2% (95.5%–96.8%) |
| OTIF (lines met in full) (fraction) | 87.8% (86.3%–89.4%) | 87.4% (85.9%–89.0%) | 34.2% (31.9%–36.5%) | 77.3% (75.5%–79.4%) |
| Total cost per week (EUR/week) | €31,548 (€31,250–€31,840) | €31,399 (€31,112–€31,681) | €32,157 (€31,846–€32,480) | €31,679 (€31,400–€32,031) |
| Worst monthly expedite spend (EUR/month) | €0 (€0–€0) | €0 (€0–€0) | €0 (€0–€0) | €0 (€0–€0) |
| Peak service loss after the shock (fraction) | 37.5% (22.6%–54.1%) | 40.8% (24.9%–56.5%) | 58.6% (51.7%–64.8%) | 56.8% (51.7%–62.1%) |
| Time to recover service (periods) | 10.10 (8.00–13.00) | 11.00 (9.00–14.05) | 24.19 (14.00–35.00) | 31.58 (25.45–37.75) |
| Bullwhip ratio, DC orders (ratio) | 1.70 (1.63–1.76) | 1.70 (1.63–1.76) | 0.95 (0.86–1.04) | 7.16 (6.09–8.38) |
| Emissions (t CO2e) | 35.3 (35.0–35.6) | 35.6 (35.3–35.9) | 33.7 (33.4–33.9) | 35.4 (35.1–35.6) |
| Escalations (count) | 0.00 (0.00–0.00) | 0.00 (0.00–0.00) | 0.00 (0.00–0.00) | 0.00 (0.00–0.00) |

Regret against the best policy in each replication (mean):

| Policy | Cost regret over the horizon (EUR) | Fill-rate regret |
|---|---|---|
| candidate | €14,335 | 0.0% |
| incumbent | €0 | 0.3% |
| naive | €72,836 | 27.5% |

### Supplier B outage

Supplier B loses 80 % of its capacity from week 20 for 8 weeks.

| Metric | candidate | incumbent | naive | rolling_opt (subsample) |
|---|---|---|---|---|
| Fill rate (fraction) | 98.2% (97.8%–98.6%) | 98.0% (97.5%–98.4%) | 69.4% (66.9%–71.8%) | 90.0% (86.9%–92.3%) |
| Fill rate (category chilled) (fraction) | 98.4% (97.8%–99.0%) | 98.4% (97.8%–99.0%) | 79.2% (77.5%–80.9%) | 95.9% (94.9%–96.7%) |
| OTIF (lines met in full) (fraction) | 91.0% (89.9%–92.1%) | 90.4% (89.1%–91.6%) | 33.2% (31.0%–35.5%) | 77.8% (75.4%–79.9%) |
| Total cost per week (EUR/week) | €30,768 (€30,492–€31,051) | €30,581 (€30,316–€30,827) | €31,219 (€30,930–€31,497) | €30,686 (€30,405–€31,021) |
| Worst monthly expedite spend (EUR/month) | €0 (€0–€0) | €0 (€0–€0) | €0 (€0–€0) | €0 (€0–€0) |
| Peak service loss after the shock (fraction) | 3.3% (1.5%–5.2%) | 4.8% (1.9%–9.7%) | 49.0% (39.5%–57.7%) | 36.1% (27.6%–45.3%) |
| Time to recover service (periods) | 45.89 (6.00–84.00) | 30.64 (11.00–81.00) | 20.02 (15.00–44.00) | 37.48 (30.00–46.10) |
| Bullwhip ratio, DC orders (ratio) | 1.94 (1.76–2.12) | 1.94 (1.76–2.13) | 2.21 (1.71–2.79) | 94.20 (74.62–114.81) |
| Emissions (t CO2e) | 34.6 (34.3–34.9) | 34.9 (34.7–35.2) | 32.9 (32.7–33.1) | 34.6 (34.4–34.9) |
| Escalations (count) | 0.00 (0.00–0.00) | 0.00 (0.00–0.00) | 0.00 (0.00–0.00) | 0.00 (0.00–0.00) |

Regret against the best policy in each replication (mean):

| Policy | Cost regret over the horizon (EUR) | Fill-rate regret |
|---|---|---|
| candidate | €17,889 | 0.0% |
| incumbent | €0 | 0.2% |
| naive | €61,190 | 28.8% |

### Supplier B lead-time creep

Supplier B's lead times double, ramping up over 10 weeks from week 20.

| Metric | candidate | incumbent | naive | rolling_opt (subsample) |
|---|---|---|---|---|
| Fill rate (fraction) | 96.9% (95.6%–97.8%) | 96.7% (95.3%–97.6%) | 40.4% (37.4%–43.4%) | 81.7% (76.1%–86.6%) |
| Fill rate (category chilled) (fraction) | 98.4% (97.7%–99.0%) | 98.3% (97.7%–99.0%) | 71.6% (69.8%–73.3%) | 95.6% (94.8%–96.4%) |
| OTIF (lines met in full) (fraction) | 86.6% (83.7%–89.0%) | 85.9% (83.0%–88.4%) | 19.1% (17.3%–21.0%) | 70.1% (66.5%–73.2%) |
| Total cost per week (EUR/week) | €30,257 (€29,983–€30,548) | €30,178 (€29,922–€30,430) | €32,955 (€32,601–€33,339) | €30,826 (€30,280–€31,567) |
| Worst monthly expedite spend (EUR/month) | €0 (€0–€0) | €0 (€0–€0) | €0 (€0–€0) | €0 (€0–€0) |
| Peak service loss after the shock (fraction) | 11.5% (4.1%–24.6%) | 12.5% (4.6%–26.4%) | 56.9% (49.8%–63.2%) | 33.3% (24.2%–44.8%) |
| Time to recover service (periods) | 55.66 (23.00–84.00) | 56.19 (23.00–84.00) | 83.89 (84.00–84.00) | 82.56 (72.45–84.00) |
| Bullwhip ratio, DC orders (ratio) | 1.94 (1.74–2.14) | 1.94 (1.74–2.14) | 2.68 (2.02–3.45) | 94.47 (72.18–117.97) |
| Emissions (t CO2e) | 34.4 (34.1–34.7) | 34.6 (34.3–34.8) | 31.9 (31.7–32.2) | 34.2 (33.9–34.5) |
| Escalations (count) | 0.00 (0.00–0.00) | 0.00 (0.00–0.00) | 0.00 (0.00–0.00) | 0.00 (0.00–0.00) |

Regret against the best policy in each replication (mean):

| Policy | Cost regret over the horizon (EUR) | Fill-rate regret |
|---|---|---|
| candidate | €7,662 | 0.0% |
| incumbent | €1 | 0.2% |
| naive | €266,592 | 56.5% |

### North plant capacity loss

The North plant loses half its capacity from week 30 for 12 weeks.

| Metric | candidate | incumbent | naive | rolling_opt (subsample) |
|---|---|---|---|---|
| Fill rate (fraction) | 96.8% (95.8%–97.6%) | 96.7% (95.8%–97.6%) | 71.5% (69.0%–74.0%) | 90.4% (87.9%–93.0%) |
| Fill rate (category chilled) (fraction) | 97.6% (96.7%–98.5%) | 97.6% (96.6%–98.5%) | 78.5% (76.7%–80.4%) | 95.8% (94.9%–96.5%) |
| OTIF (lines met in full) (fraction) | 89.3% (88.0%–90.6%) | 89.3% (88.0%–90.6%) | 34.9% (32.6%–37.2%) | 79.7% (77.6%–81.7%) |
| Total cost per week (EUR/week) | €30,626 (€30,328–€30,906) | €30,542 (€30,264–€30,790) | €31,189 (€30,901–€31,477) | €30,722 (€30,339–€31,103) |
| Worst monthly expedite spend (EUR/month) | €0 (€0–€0) | €0 (€0–€0) | €0 (€0–€0) | €0 (€0–€0) |
| Peak service loss after the shock (fraction) | 23.6% (13.8%–31.6%) | 23.9% (14.1%–31.8%) | 31.7% (20.9%–43.8%) | 27.6% (22.5%–31.4%) |
| Time to recover service (periods) | 19.13 (17.00–23.00) | 19.20 (17.00–23.05) | 40.79 (18.00–74.00) | 38.80 (28.00–47.55) |
| Bullwhip ratio, DC orders (ratio) | 1.93 (1.71–2.15) | 1.93 (1.71–2.15) | 1.88 (1.44–2.40) | 90.55 (69.33–117.56) |
| Emissions (t CO2e) | 34.5 (34.2–34.8) | 34.6 (34.4–34.9) | 32.7 (32.4–32.9) | 34.5 (34.2–34.7) |
| Escalations (count) | 0.00 (0.00–0.00) | 0.00 (0.00–0.00) | 0.00 (0.00–0.00) | 0.00 (0.00–0.00) |

Regret against the best policy in each replication (mean):

| Policy | Cost regret over the horizon (EUR) | Fill-rate regret |
|---|---|---|
| candidate | €8,103 | 0.0% |
| incumbent | €1 | 0.0% |
| naive | €62,150 | 25.2% |

### Correlated shock

In half the futures, Suppliers A and B lose 60 % of capacity, their lead times rise 50 %, and North and Central demand jumps 20 %, all at once, for 8 weeks starting between weeks 15 and 60.

| Metric | candidate | incumbent | naive | rolling_opt (subsample) |
|---|---|---|---|---|
| Fill rate (fraction) | 96.6% (93.2%–98.5%) | 94.0% (88.3%–98.5%) | 68.8% (62.1%–75.5%) | 87.6% (76.4%–95.4%) |
| Fill rate (category chilled) (fraction) | 97.4% (95.4%–99.0%) | 96.9% (94.3%–99.0%) | 78.1% (74.4%–81.9%) | 95.3% (93.5%–96.8%) |
| OTIF (lines met in full) (fraction) | 88.5% (84.0%–91.9%) | 86.0% (79.1%–91.8%) | 33.4% (29.2%–37.7%) | 76.9% (68.4%–84.3%) |
| Total cost per week (EUR/week) | €30,987 (€30,528–€31,448) | €31,032 (€30,449–€31,650) | €31,803 (€30,774–€32,948) | €31,356 (€30,366–€32,797) |
| Worst monthly expedite spend (EUR/month) | €0 (€0–€0) | €0 (€0–€0) | €0 (€0–€0) | €0 (€0–€0) |
| Peak service loss after the shock (fraction) | 48.4% (19.5%–72.6%) | 80.8% (75.8%–85.3%) | 64.4% (54.2%–73.1%) | 65.1% (57.5%–73.0%) |
| Time to recover service (periods) | 17.60 (15.00–22.00) | 22.55 (20.00–27.00) | 28.34 (21.00–48.00) | 51.87 (43.10–67.90) |
| Bullwhip ratio, DC orders (ratio) | 1.88 (1.53–2.17) | 1.96 (1.61–2.40) | 1.63 (1.00–2.29) | 75.86 (33.72–124.57) |
| Emissions (t CO2e) | 34.6 (34.2–34.8) | 34.8 (34.5–35.1) | 32.8 (32.6–33.1) | 34.6 (34.3–34.9) |
| Escalations (count) | 0.00 (0.00–0.00) | 0.00 (0.00–0.00) | 0.00 (0.00–0.00) | 0.00 (0.00–0.00) |

Regret against the best policy in each replication (mean):

| Policy | Cost regret over the horizon (EUR) | Fill-rate regret |
|---|---|---|
| candidate | €4,291 | 0.0% |
| incumbent | €8,644 | 2.6% |
| naive | €82,673 | 27.8% |

### Noisy, delayed signals

Observed demand carries 30 % noise and information arrives 2 weeks later.

| Metric | candidate | incumbent | naive | rolling_opt (subsample) |
|---|---|---|---|---|
| Fill rate (fraction) | 93.5% (92.7%–94.3%) | 93.5% (92.6%–94.2%) | 67.0% (64.4%–69.5%) | 19.6% (19.1%–20.2%) |
| Fill rate (category chilled) (fraction) | 96.1% (95.0%–97.0%) | 96.1% (95.1%–97.0%) | 83.4% (82.0%–84.9%) | 60.3% (58.8%–62.1%) |
| OTIF (lines met in full) (fraction) | 77.9% (76.3%–79.4%) | 77.8% (76.2%–79.4%) | 41.3% (39.3%–43.4%) | 15.2% (14.2%–16.1%) |
| Total cost per week (EUR/week) | €31,186 (€30,855–€31,521) | €31,064 (€30,735–€31,377) | €31,316 (€31,042–€31,622) | €37,656 (€36,893–€38,379) |
| Worst monthly expedite spend (EUR/month) | €0 (€0–€0) | €0 (€0–€0) | €0 (€0–€0) | €0 (€0–€0) |
| Peak service loss after the shock (fraction) | — | — | — | — |
| Time to recover service (periods) | — | — | — | — |
| Bullwhip ratio, DC orders (ratio) | 5.53 (4.42–6.82) | 5.53 (4.42–6.82) | 3.49 (2.79–4.33) | 92.61 (69.92–118.31) |
| Emissions (t CO2e) | 34.4 (34.1–34.7) | 34.6 (34.3–34.9) | 33.1 (32.9–33.3) | 30.6 (30.4–30.9) |
| Escalations (count) | 0.00 (0.00–0.00) | 0.00 (0.00–0.00) | 0.00 (0.00–0.00) | 0.00 (0.00–0.00) |

Regret against the best policy in each replication (mean):

| Policy | Cost regret over the horizon (EUR) | Fill-rate regret |
|---|---|---|
| candidate | €12,138 | 0.0% |
| incumbent | €361 | 0.1% |
| naive | €24,552 | 26.6% |

## Notes

- Rolling optimisation ran on the first 50 of 500 replications (the same futures), re-planning every 4 periods over 8; its regret is not computed.
