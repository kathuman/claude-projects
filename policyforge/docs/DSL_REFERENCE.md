# DSL reference

Generated from the Pydantic models by `python -m core.domain.schema_export`; do not edit by hand.

A **policy** is a decision rule plus the mandate of the agent that executes it, the assumptions it rests on,
and its provenance. The LLM compiler may produce instances of this schema only. Rules may read only the
state variables below; assumptions may also use the exogenous ones.

## Variable vocabulary

| Variable | Kind | Unit | Bounds | Qualifier | Meaning |
|---|---|---|---|---|---|
| `inventory_position` | state | units | -1e+07 .. 1e+07 | node_or_none | on-hand + pipeline - backorder |
| `on_hand` | state | units | 0 .. 1e+07 | node_or_none | physical stock at the node |
| `backorders` | state | units | 0 .. 1e+07 | node_or_none | unfilled demand owed to customers |
| `pipeline` | state | units | 0 .. 1e+07 | node_or_none | ordered, not yet received |
| `forecast` | state | units/period | 0 .. 1e+07 | node_or_none | expected demand per period |
| `observed_lead_time` | state | days | 0 .. 730 | supplier | lead time of recent receipts |
| `supplier_fill_rate` | state | fraction | 0 .. 1 | supplier | share of ordered quantity shipped |
| `capacity_utilisation` | state | fraction | 0 .. 1 | node | plant output / plant capacity |
| `demand` | exogenous | units/period | 0 .. 1e+07 | node_or_none | customer demand per period |
| `lead_time` | exogenous | days | 0 .. 730 | supplier | supplier lead time |
| `supplier_capacity` | exogenous | units/period | 0 .. 1e+07 | supplier | supplier output per period |
| `plant_capacity` | exogenous | units/period | 0 .. 1e+07 | node | plant output per period |

## Authority limits

| Kind | Unit | Maximum |
|---|---|---|
| `order_qty_change_pct` | % vs previous order | 100 |
| `expedite_spend_per_period` | EUR per period | 1e+07 |
| `consecutive_sourcing_switches` | switches | 52 |
| `volume_shift_pct` | % of volume | 100 |
| `parameter_drift_pct` | % vs approved value | 100 |

## Constitution metrics

| Metric | Unit | Bounds |
|---|---|---|
| `fill_rate` | fraction | 0 .. 1 |
| `otif` | fraction | 0 .. 1 |
| `backorder_units` | units | 0 .. 1e+09 |
| `stockout_periods` | periods | 0 .. 10000 |
| `expedite_spend` | EUR | 0 .. 1e+09 |
| `total_cost` | EUR | 0 .. 1e+11 |
| `inventory_days` | days | 0 .. 3650 |
| `co2_tonnes` | t CO2e | 0 .. 1e+07 |

## Policy

| Field | Type | Required | Bounds | Default | Description |
|---|---|---|---|---|---|
| `id` | `string` | yes |  |  | Identifier |
| `name` | `string` | yes | ≤ 120 chars |  |  |
| `version` | `integer` |  | ≥ 1, ≤ 10000 | 1 |  |
| `status` | [PolicyStatus](#policystatus) |  |  | "draft" |  |
| `intent_text` | `string` | yes | ≤ 4000 chars |  | The original natural-language intent |
| `scope` | [Scope](#scope) | yes |  |  |  |
| `rule` | [BaseStock](#basestock) \| [MinMax](#minmax) \| [AllocationRule](#allocationrule) \| [ExpediteTrigger](#expeditetrigger) \| [SourcingSwitch](#sourcingswitch) \| [Composite](#composite) | yes |  |  |  |
| `mandate` | [Mandate](#mandate) | yes |  |  |  |
| `assumptions` | list of [Assumption](#assumption) |  | ≤ 50 items |  |  |
| `constitution_ref` | `string` | yes | ≤ 80 chars |  | Constitution id@version the policy was tested against |
| `provenance` | [Provenance](#provenance) |  |  |  |  |

## ActionKind

Actions that can be prohibited outright.

One of: `add_new_supplier`, `change_supplier_master_data`, `cancel_customer_orders`, `change_customer_priorities`, `exceed_storage_capacity`, `expedite_by_air`, `change_policy_parameters`, `ship_expired_stock`

## AllocationRule

How a node shares scarce stock among the nodes it serves.

| Field | Type | Required | Bounds | Default | Description |
|---|---|---|---|---|---|
| `type` | `"allocation"` |  |  | "allocation" |  |
| `method` | `fair_share` \| `priority` \| `proportional_to_demand` | yes |  |  |  |
| `priority` | list of `string` |  | ≤ 50 items |  | Served nodes, first = most protected |
| `reservation_pct` | `number` |  | ≥ 0, ≤ 100 | 0 | Share of stock held back for priority nodes |

## Assumption

`variable op threshold` (or `variable ~ distribution`), e.g. `lead_time[supplier_B] < 21 days`.

| Field | Type | Required | Bounds | Default | Description |
|---|---|---|---|---|---|
| `id` | `string` | yes |  |  | Identifier |
| `statement` | `string` | yes | ≤ 500 chars |  | The assumption in plain language |
| `variable` | [VarRef](#varref) | yes |  |  | A state or exogenous variable |
| `operator` | `lt` \| `le` \| `gt` \| `ge` \| `null` |  |  | null | With a threshold |
| `threshold` | `number` \| `null` |  | ≥ -1e+07, ≤ 1e+07 | null | In the variable's unit |
| `distribution` | [Deterministic](#deterministic) \| [Normal](#normal) \| [Gamma](#gamma) \| [Triangular](#triangular) \| [Discrete](#discrete) \| `null` |  |  | null | The assumed distribution of the variable |
| `source` | `user_stated` \| `compiler_inferred` | yes |  |  |  |
| `confidence` | `number` | yes | ≥ 0, ≤ 1 |  | How sure the source is, 0..1 |

## AuthorityLimit

A bound on what the agent may do without asking.

| Field | Type | Required | Bounds | Default | Description |
|---|---|---|---|---|---|
| `kind` | [LimitKind](#limitkind) | yes |  |  |  |
| `value` | `number` | yes | ≥ 0, ≤ 1e+07 |  | In the unit of the kind (see LIMIT_SPECS) |

## BaseStock

Order up to a target inventory position every review period.

| Field | Type | Required | Bounds | Default | Description |
|---|---|---|---|---|---|
| `type` | `"base_stock"` |  |  | "base_stock" |  |
| `target` | [Units](#units) \| [DaysOfCover](#daysofcover) | yes |  |  |  |
| `review_period` | `integer` |  | ≥ 1, ≤ 13 | 1 | Periods between reviews |

## Composite

Several rules, applied in order: a later rule refines the actions of earlier ones in its scope.

| Field | Type | Required | Bounds | Default | Description |
|---|---|---|---|---|---|
| `type` | `"composite"` |  |  | "composite" |  |
| `rules` | list of [BaseStock](#basestock) \| [MinMax](#minmax) \| [AllocationRule](#allocationrule) \| [ExpediteTrigger](#expeditetrigger) \| [SourcingSwitch](#sourcingswitch) | yes | ≤ 10 items |  |  |

## Condition

`var op threshold`, holding for `for_periods` consecutive periods. Only state variables are allowed.

| Field | Type | Required | Bounds | Default | Description |
|---|---|---|---|---|---|
| `var` | [VarRef](#varref) | yes |  |  |  |
| `op` | `lt` \| `le` \| `gt` \| `ge` | yes |  |  |  |
| `threshold` | `number` | yes | ≥ -1e+07, ≤ 1e+07 |  | In the variable's unit (see the vocabulary) |
| `for_periods` | `integer` |  | ≥ 1, ≤ 52 | 1 | Consecutive periods the condition must hold |

## ConditionTrigger

| Field | Type | Required | Bounds | Default | Description |
|---|---|---|---|---|---|
| `kind` | `"condition"` |  |  | "condition" |  |
| `condition` | [Condition](#condition) | yes |  |  |  |

## CoverageBelow

| Field | Type | Required | Bounds | Default | Description |
|---|---|---|---|---|---|
| `kind` | `"coverage_below"` |  |  | "coverage_below" |  |
| `days` | `number` | yes | ≥ 0, ≤ 365 |  | Expedite when stock covers fewer days than this |

## DaysOfCover

| Field | Type | Required | Bounds | Default | Description |
|---|---|---|---|---|---|
| `unit` | `"days_of_cover"` |  |  | "days_of_cover" |  |
| `value` | `number` | yes | ≥ 0, ≤ 365 |  | Days of expected demand |

## Deterministic

| Field | Type | Required | Bounds | Default | Description |
|---|---|---|---|---|---|
| `kind` | `"deterministic"` |  |  | "deterministic" |  |
| `value` | `number` | yes | ≥ 0, ≤ 1e+07 |  |  |

## Discrete

| Field | Type | Required | Bounds | Default | Description |
|---|---|---|---|---|---|
| `kind` | `"discrete"` |  |  | "discrete" |  |
| `values` | list of `number` | yes | ≤ 50 items |  |  |
| `probs` | list of `number` | yes | ≤ 50 items |  |  |

## EscalationRule

When to hand a decision back to a person.

| Field | Type | Required | Bounds | Default | Description |
|---|---|---|---|---|---|
| `trigger` | [LimitBreach](#limitbreach) \| [ConditionTrigger](#conditiontrigger) | yes |  |  |  |
| `severity` | [Severity](#severity) | yes |  |  |  |
| `escalate_to` | `owner` \| `approver` |  |  | "owner" |  |
| `note` | `string` |  | ≤ 500 chars | "" |  |

## ExpediteTrigger

When to pay for faster transport.

| Field | Type | Required | Bounds | Default | Description |
|---|---|---|---|---|---|
| `type` | `"expedite"` |  |  | "expedite" |  |
| `condition` | [ProjectedStockout](#projectedstockout) \| [CoverageBelow](#coveragebelow) | yes |  |  |  |
| `mode` | `air` \| `express_road` | yes |  |  |  |
| `cost_cap_per_period` | `number` | yes | ≥ 0, ≤ 1e+07 |  | EUR of expedite cost allowed per period |

## Gamma

Gamma by mean and coefficient of variation (a common way to state lead-time variability).

| Field | Type | Required | Bounds | Default | Description |
|---|---|---|---|---|---|
| `kind` | `"gamma"` |  |  | "gamma" |  |
| `mu` | `number` | yes | > 0, ≤ 1e+07 |  | Mean |
| `cv` | `number` | yes | > 0, ≤ 5 |  | Coefficient of variation (sd / mean) |

## LimitBreach

| Field | Type | Required | Bounds | Default | Description |
|---|---|---|---|---|---|
| `kind` | `"limit_breach"` |  |  | "limit_breach" |  |
| `limit` | [LimitKind](#limitkind) | yes |  |  |  |

## LimitKind

One of: `order_qty_change_pct`, `expedite_spend_per_period`, `consecutive_sourcing_switches`, `volume_shift_pct`, `parameter_drift_pct`

## Mandate

| Field | Type | Required | Bounds | Default | Description |
|---|---|---|---|---|---|
| `owner` | `string` | yes | ≤ 80 chars |  | The person accountable for the policy |
| `approver` | `string` | yes | ≤ 80 chars |  | The person who signs it off |
| `agent_id` | `string` | yes |  |  | The agent that executes the policy |
| `autonomy` | list of [AuthorityLimit](#authoritylimit) |  | ≤ 20 items |  |  |
| `escalation` | list of [EscalationRule](#escalationrule) |  | ≤ 50 items |  |  |
| `prohibited_actions` | list of [ActionKind](#actionkind) |  | ≤ 20 items |  |  |
| `valid_from` | `string` |  |  |  |  |
| `expires_at` | `string` | yes |  |  | Mandatory; defaults to valid_from + 90 days |
| `review_triggers` | list of `string` |  | ≤ 50 items |  | Monitor ids forcing re-review |

## MinMax

(s, S): when the inventory position is at or below s, order up to S.

| Field | Type | Required | Bounds | Default | Description |
|---|---|---|---|---|---|
| `type` | `"min_max"` |  |  | "min_max" |  |
| `reorder_point` | [Units](#units) \| [DaysOfCover](#daysofcover) | yes |  |  | s |
| `order_up_to` | [Units](#units) \| [DaysOfCover](#daysofcover) | yes |  |  | S |

## Normal

Normal, truncated at zero when sampled.

| Field | Type | Required | Bounds | Default | Description |
|---|---|---|---|---|---|
| `kind` | `"normal"` |  |  | "normal" |  |
| `mu` | `number` | yes | ≥ 0, ≤ 1e+07 |  | Mean |
| `sigma` | `number` | yes | ≥ 0, ≤ 1e+07 |  | Standard deviation |

## PolicyStatus

One of: `draft`, `tested`, `approved`, `deployed`, `retired`

## ProjectedStockout

| Field | Type | Required | Bounds | Default | Description |
|---|---|---|---|---|---|
| `kind` | `"projected_stockout"` |  |  | "projected_stockout" |  |
| `within_periods` | `integer` | yes | ≥ 1, ≤ 26 |  | Expedite if a stockout is projected within this many periods |

## Provenance

| Field | Type | Required | Bounds | Default | Description |
|---|---|---|---|---|---|
| `compiler_model` | `string` \| `null` |  |  | null | Model id that compiled the intent |
| `prompt_hash` | `string` \| `null` |  |  | null | SHA-256 of the prompt |
| `created_at` | `string` |  |  |  |  |
| `updated_at` | `string` |  |  |  |  |
| `editor` | `string` |  | ≤ 80 chars | "local-user" |  |

## Scope

Where a policy applies. An empty list puts no restriction on that dimension.

| Field | Type | Required | Bounds | Default | Description |
|---|---|---|---|---|---|
| `nodes` | list of `string` |  | ≤ 100 items |  |  |
| `skus` | list of `string` |  | ≤ 200 items |  |  |
| `sku_classes` | list of `A` \| `B` \| `C` |  | ≤ 3 items |  |  |
| `categories` | list of `chilled` \| `ambient` |  | ≤ 2 items |  |  |
| `suppliers` | list of `string` |  | ≤ 50 items |  |  |
| `lanes` | list of `string` |  | ≤ 500 items |  |  |

## Severity

One of: `low`, `medium`, `high`, `critical`

## SourcingSwitch

Move volume from a primary to a secondary supplier when a trigger holds; switch back when allowed.

| Field | Type | Required | Bounds | Default | Description |
|---|---|---|---|---|---|
| `type` | `"sourcing_switch"` |  |  | "sourcing_switch" |  |
| `primary` | `string` | yes |  |  | Identifier |
| `secondary` | `string` | yes |  |  | Identifier |
| `trigger` | [Condition](#condition) | yes |  |  |  |
| `shift_fraction` | `number` |  | ≥ 0, ≤ 1 | 1 | Share of the primary's volume moved |
| `switch_back` | [Condition](#condition) \| `null` |  |  | null | When to return; none = stay switched |
| `min_dwell_periods` | `integer` |  | ≥ 0, ≤ 104 | 0 | Periods to stay switched at least |

## Triangular

| Field | Type | Required | Bounds | Default | Description |
|---|---|---|---|---|---|
| `kind` | `"triangular"` |  |  | "triangular" |  |
| `low` | `number` | yes | ≥ 0, ≤ 1e+07 |  |  |
| `mode` | `number` | yes | ≥ 0, ≤ 1e+07 |  |  |
| `high` | `number` | yes | ≥ 0, ≤ 1e+07 |  |  |

## Units

| Field | Type | Required | Bounds | Default | Description |
|---|---|---|---|---|---|
| `unit` | `"units"` |  |  | "units" |  |
| `value` | `number` | yes | ≥ 0, ≤ 1e+07 |  | Units of the SKU |

## VarRef

A variable with its qualifiers, written like `lead_time[supplier_B]` or `on_hand[DC_N, S01]`.

| Field | Type | Required | Bounds | Default | Description |
|---|---|---|---|---|---|
| `var` | [Variable](#variable) | yes |  |  | A name from the fixed vocabulary |
| `supplier` | `string` \| `null` |  |  | null | Supplier id, for supplier variables |
| `node` | `string` \| `null` |  |  | null | Plant, DC or market id, for node variables |
| `sku` | `string` \| `null` |  |  | null | SKU id; empty means summed over the SKUs in scope |

## Variable

One of: `inventory_position`, `on_hand`, `backorders`, `pipeline`, `forecast`, `observed_lead_time`, `supplier_fill_rate`, `capacity_utilisation`, `demand`, `lead_time`, `supplier_capacity`, `plant_capacity`

