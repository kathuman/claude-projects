"""Prompts for the compiler, the back-translation and the report narrative.

The system prompts are fixed text (so they cache, and their hash identifies them). Everything that varies (the
network, the constitution, existing policies, the intent) goes in the user message.
"""

from __future__ import annotations

import hashlib
import json
from typing import Any

from core.domain.constitution import Constitution
from core.domain.mandate import LIMIT_SPECS, ActionKind
from core.domain.network import Network
from core.domain.policy import Policy
from core.domain.vocabulary import VARIABLES

COMPILE_SYSTEM = """\
You turn a supply chain manager's intent into a policy for an AI agent that will execute it. A policy is a decision \
rule, a mandate (what the agent may decide alone, and when it must escalate to a person), and the assumptions the \
rule depends on.

You answer only with JSON matching the schema you are given. You never write code. Your answer is checked by a \
deterministic validator; anything outside the schema, the vocabulary or the network is rejected.

How to compile:
- Use only ids that appear in the network context (nodes, SKUs, suppliers, lanes). Never invent an id.
- Rules may read only these state variables: inventory_position, on_hand, backorders, pipeline, forecast, \
observed_lead_time, supplier_fill_rate, capacity_utilisation. Assumptions may also use demand, lead_time, \
supplier_capacity and plant_capacity. If the intent depends on something outside this vocabulary (prices, \
weather, competitors...), do not reference it: compile what you can and ask a clarifying question that says what \
cannot be observed.
- Units: cover, lead times and shelf life in days; persistence ("three weeks running"), review periods and dwell \
times in periods of one week; money in EUR; fractions in 0..1 (a fill rate of 90 % is 0.9); percentages in \
mandate limits in 0..100.
- One rule, or a composite of several in order of precedence (at most one base_stock or min_max in a composite).
- Scope: list nodes, SKUs, SKU classes or categories the policy applies to; an empty list means no restriction. \
Map words to ids using the context ("the North market" = the markets in region North; "chilled" = category chilled).
- Mandate: owner and approver are roles unless the intent names people. Turn "can do X alone up to Y; beyond that \
ask me" into an authority limit plus an escalation rule on that limit's breach, escalating to the owner. Use \
term_days 90 unless the intent says otherwise.
- Assumptions: state every assumption the rule relies on, as a variable, an operator and a threshold (or a \
distribution). Mark the ones the user stated "user_stated" and the ones you inferred "compiler_inferred", with an \
honest confidence.
- Prefer asking to guessing: when the intent leaves out a threshold or quantity that materially changes the rule, \
still fill in a sensible default, mark the related assumption compiler_inferred with low confidence, and ask one \
clarifying question about it. Ask at most three questions, and none about details that do not change the rule.
- interpretation_notes: restate in plain language exactly what the rule will do, with its numbers, for the user \
to confirm.
- confidence: your confidence in scope, rule, mandate and assumptions, each 0..1.
"""

BACK_TRANSLATE_SYSTEM = """\
You restate a supply chain policy, given as JSON, in plain English for the manager who will sign it off. Say what \
the agent will do, when, how much, and what it must escalate, using the numbers and units in the JSON and no others. \
Do not add advice, do not judge the policy, and do not mention JSON or field names. Write one short paragraph, then \
the mandate in one sentence.\
"""

NARRATIVE_SYSTEM = """\
You summarise a policy evaluation report for a supply chain manager in at most 150 words. Use only numbers that \
appear in the report you are given, written as they appear (percentages as shown, euros as shown). Do not compute \
new numbers, round differently, or add any number that is not in the report. Lead with the verdict and its main \
reason; then the trade-offs that matter for the decision.\
"""


def prompt_hash(schema: dict[str, Any]) -> str:
    """SHA-256 of the compile prompt template and the schema it asks for (recorded in each policy's provenance)."""
    blob = COMPILE_SYSTEM + "\n" + json.dumps(schema, sort_keys=True)
    return hashlib.sha256(blob.encode("utf-8")).hexdigest()


def network_context(net: Network) -> str:
    lines = [f"Network: {net.name}. One period = {net.period_days} days. Money in {net.currency}.", "", "Suppliers:"]
    for s in net.suppliers:
        lines.append(f"- {s.id} ({s.name}): capacity {s.capacity_per_period:g} units/period, cost index "
                     f"{s.unit_cost_index:g}, fill rate {s.fill_rate_mean:.0%} ± {s.fill_rate_sd:.0%}")
    lines.append("Plants:")
    for p in net.plants:
        mix = ", ".join(f"{sh.supplier} {sh.share:.0%}" for sh in p.sourcing)
        lines.append(f"- {p.id} ({p.name}): capacity {p.capacity_per_period:g} units/period, makes "
                     f"{', '.join(p.skus)}; buys from {mix}")
    lines.append("Distribution centres:")
    for d in net.dcs:
        markets = ", ".join(m.id for m in net.markets if m.served_by == d.id)
        lines.append(f"- {d.id} ({d.name}): serves {markets}")
    lines.append("Markets:")
    for m in net.markets:
        lines.append(f"- {m.id} ({m.name}), region {m.region}, served by {m.served_by}")
    lines.append("SKUs:")
    for sku in net.skus:
        life = f", shelf life {sku.shelf_life_days} days" if sku.shelf_life_days else ""
        lines.append(f"- {sku.id} {sku.name}: class {sku.abc_class}, {sku.category}{life}, "
                     f"{sku.unmet_demand.replace('_', ' ')}")
    lines.append("Lanes (lead time in days, mean):")
    for ln in net.lanes:
        exp = f", expedite by {ln.expedite.mode}" if ln.expedite else ""
        lines.append(f"- {ln.id}: {ln.origin} → {ln.destination}, {ln.mode}, {ln.lead_time_days.mean():.0f} days{exp}")
    return "\n".join(lines)


def constitution_context(con: Constitution) -> str:
    lines = [f"Active constitution: {con.ref} ({con.name}).", "Hard constraints:"]
    lines += [f"- {c.id}: {c}" + (f" ({c.description})" if c.description else "") for c in con.hard_constraints]
    lines.append("Priorities, most important first: " + " > ".join(str(p) for p in con.priorities))
    lines.append(f"A policy breaching a hard constraint in more than {con.breach_alpha:.0%} of futures under normal "
                 "conditions cannot be approved.")
    return "\n".join(lines)


def vocabulary_context() -> str:
    lines = ["Variables (kind, unit, bounds, qualifier):"]
    for v, s in VARIABLES.items():
        lines.append(f"- {v}: {s.kind}, {s.unit}, {s.lo:g}..{s.hi:g}, needs {s.needs}: {s.description}")
    lines.append("Authority limits: " + "; ".join(f"{k} ({unit}, max {hi:g})" for k, (unit, hi) in
                                                  LIMIT_SPECS.items()))
    lines.append("Actions that can be prohibited: " + ", ".join(a.value for a in ActionKind))
    return "\n".join(lines)


def policies_context(policies: list[Policy]) -> str:
    if not policies:
        return "Existing policies: none."
    lines = ["Existing policies (deployed or under test):"]
    for p in policies:
        lines.append(f"- {p.id}: {p.name}. Scope {p.scope.model_dump(exclude_defaults=True)}; rule "
                     f"{p.rule.model_dump_json(exclude_defaults=True)}")
    return "\n".join(lines)


def compile_message(intent: str, net: Network, con: Constitution, policies: list[Policy],
                    answers: dict[str, str] | None) -> str:
    parts = [network_context(net), constitution_context(con), vocabulary_context(), policies_context(policies),
             f"Intent:\n{intent}"]
    if answers:
        parts.append("Answers to your clarifying questions:\n" + "\n".join(f"Q: {q}\nA: {a}" for q, a in
                                                                           answers.items()))
    return "\n\n".join(parts)
