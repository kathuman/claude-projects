# FoodNet: the synthetic network

FoodNet is a **fictional** food manufacturer. All numbers are invented for testing and demonstration; no real
company is described.

- **Files:** `network.yaml` holds the data. `network.schema.json` is the JSON Schema, generated from the Pydantic
  model `core.domain.network.Network`; regenerate it with `python -m core.domain.schema_export`.
- **Loading:** `core.domain.network.load_foodnet()` loads and validates the network.

## Shape

```
SUP_A (cheap, slow, reliable) ─┐
SUP_B (mid, variable)         ─┼─▶ PLANT_N ─┐        ┌─▶ DC_N ─▶ MKT_N1, MKT_N2
SUP_C (dear, fast, small)     ─┘   PLANT_S ─┴─(all)──┼─▶ DC_C ─▶ MKT_C1, MKT_C2
                                                     └─▶ DC_S ─▶ MKT_S1, MKT_S2
```

Every supplier has a lane to both plants, and both plants have a lane to every DC. Each DC buys each SKU from
the **nearest plant that makes it**. Each market is served by one DC.

## Units

| Quantity | Unit |
|---|---|
| Stock, orders, demand | units (cases) of a SKU |
| Money | EUR |
| Lead time, shelf life | days |
| Demand and capacity rates | units per period; one period is `period_days` days (7: a week) |
| Distances, locations | km, on a flat fictional grid |
| Emission factors | kg CO2e per tonne-km |

## Fields

### Top level

| Field | Meaning |
|---|---|
| `name` | Name of the network. |
| `currency` | Always `EUR`. |
| `period_days` | Length of one simulation period, in days. |
| `demand_overrides` | Optional exact demand for a market and SKU pair (`mean`, optional `cv`), replacing the default formula below. |
| `emission_factors` | kg CO2e per tonne-km for `road`, `rail`, `sea`, `air` and `express_road`. |

### `skus`

| Field | Meaning |
|---|---|
| `id`, `name` | Identifier and display name. |
| `abc_class` | `A`, `B` or `C` (by volume and importance). Constitution constraints can target a class. |
| `category` | `chilled` or `ambient`. |
| `shelf_life_days` | Chilled SKUs only. Stock older than this spoils. |
| `unit_cost` | Value of one unit, in EUR. |
| `holding_cost_per_unit_period` | EUR per unit in stock per period. Chilled SKUs cost more to hold because of refrigeration. |
| `backorder_penalty_per_unit_period` | EUR per unit of demand still owed, per period. |
| `lost_sale_penalty_per_unit` | EUR per unit of demand lost. |
| `unmet_demand` | `backorder` (customers wait) or `lost_sale` (the sale is gone). Chilled SKUs and impulse goods are lost sales. |
| `base_demand` | Network-wide mean demand in units per period, before the market split. |
| `demand_cv` | Coefficient of variation of demand per market and period. |
| `seasonality_amplitude`, `seasonality_peak_period` | Demand follows `1 + amplitude · cos(2π (t − peak) / 52)`. |
| `weight_kg` | Shipping weight of one unit, used for CO2. |

The mean demand of a market for a SKU is `base_demand × market.size_factor`, unless an override sets it.

### `suppliers`

| Field | Meaning |
|---|---|
| `location` | `x_km`, `y_km` on the grid. |
| `capacity_per_period` | Units of material per period across all SKUs. Orders beyond capacity are cut back pro rata. |
| `unit_cost_index` | Multiplier on a SKU's `unit_cost` for material bought from this supplier. |
| `fill_rate_mean`, `fill_rate_sd` | Share of each order actually shipped (random per period). The short part is not delivered later. |
| `ordering_cost` | EUR per order placed. |

The three suppliers:
- **SUP_A** is cheap (0.90×), slow (about 21–24 days) and reliable (99 % fill).
- **SUP_B** is mid-priced (1.00×) with variable lead times (12–15 days, CV 0.35) and a 93 % fill rate that varies.
- **SUP_C** is expensive (1.30×) and fast (3–4 days), but small: 2,000 units per period.

### `plants`

| Field | Meaning |
|---|---|
| `capacity_per_period` | Units of finished goods per period, shared by all SKUs. |
| `production_cost_per_unit` | EUR per unit produced. |
| `skus` | The SKUs the plant can make. S03 and S04 are made in both plants. |
| `sourcing` | The normal split of material by supplier; the shares sum to 1. SUP_C has no normal share: it is the backup. |

Both plants run at about 70 % of capacity on average, so seasonal peaks fit, but a capacity loss bites.

### `dcs`

| Field | Meaning |
|---|---|
| `storage_capacity` | Units the DC can hold. |

### `markets`

| Field | Meaning |
|---|---|
| `region` | `North`, `Central` or `South`. Allocation rules can protect a region ("protect the North market"). |
| `size_factor` | Share of every SKU's base demand that arises here. The six factors sum to 1. |
| `served_by` | The DC that delivers to this market. |

### `lanes`

| Field | Meaning |
|---|---|
| `origin`, `destination` | Supplier → plant, plant → DC, or DC → market. |
| `mode` | `road`, `rail`, `sea`, `air` or `express_road`. |
| `lead_time_days` | A distribution: `deterministic`, `normal`, `gamma` (mean and CV), `triangular` or `discrete`. Each order draws its own lead time. |
| `cost_per_unit` | EUR per unit moved. |
| `distance_km` | Used for CO2: `weight (t) × km × factor`. |
| `expedite` | Optional faster option: `mode`, its own `lead_time_days`, and a `cost_multiplier` on `cost_per_unit`. |

DC → market lanes carry cost and distance only: deliveries to markets happen within the period.
