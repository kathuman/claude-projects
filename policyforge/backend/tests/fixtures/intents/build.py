"""Writes the 20 golden intents as JSON fixtures (run: python -m tests.fixtures.intents.build from backend/).

Each fixture holds an intent, the model's recorded answer(s) (the mock provider replays them), the back-translation,
and the DSL the compiler must end up with. Intent 20 refers to something outside the vocabulary: its first recorded
answer is invalid and is rejected, which exercises the retry with errors passed back.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

HERE = Path(__file__).parent
D = ["DC_N", "DC_C", "DC_S"]
P = ["PLANT_N", "PLANT_S"]
J = dict[str, Any]


def days(v: float) -> J:
    return {"unit": "days_of_cover", "value": v}


def scope(**kw: Any) -> J:
    return {k: kw.get(k, []) for k in ("nodes", "skus", "sku_classes", "categories", "suppliers", "lanes")}


def cond(var: str, op: str, th: float, periods: int = 1, **q: str) -> J:
    return {"var": {"var": var, "supplier": q.get("supplier"), "node": q.get("node"), "sku": q.get("sku")},
            "op": op, "threshold": th, "for_periods": periods}


def limit(kind: str, value: float) -> J:
    return {"kind": kind, "value": value}


def breach(kind: str, severity: str = "medium", note: str = "") -> J:
    return {"trigger": {"kind": "limit_breach", "limit": kind}, "severity": severity, "escalate_to": "owner",
            "note": note}


def on_condition(c: J, severity: str, note: str = "") -> J:
    return {"trigger": {"kind": "condition", "condition": c}, "severity": severity, "escalate_to": "owner",
            "note": note}


def mandate(agent: str, autonomy: list[J] | None = None, escalation: list[J] | None = None,
            prohibited: list[str] | None = None, owner: str = "Planning manager") -> J:
    return {"owner": owner, "approver": "Head of supply chain", "agent_id": agent, "autonomy": autonomy or [],
            "escalation": escalation or [], "prohibited_actions": prohibited or [], "term_days": 90,
            "review_triggers": []}


def assume(aid: str, statement: str, var: str, op: str, th: float, source: str, conf: float, **q: str) -> J:
    return {"id": aid, "statement": statement,
            "variable": {"var": var, "supplier": q.get("supplier"), "node": q.get("node"), "sku": q.get("sku")},
            "operator": op, "threshold": th, "distribution": None, "source": source, "confidence": conf}


def out(name: str, sc: J, rule: J, md: J, assumptions: list[J], questions: list[str], notes: str,
        conf: tuple[float, float, float, float] = (0.9, 0.9, 0.85, 0.7)) -> J:
    return {"name": name, "scope": sc, "rule": rule, "mandate": md, "assumptions": assumptions,
            "clarifying_questions": questions, "interpretation_notes": notes,
            "confidence": dict(zip(("scope", "rule", "mandate", "assumptions"), conf, strict=True))}


def base_stock(d: float, review: int = 1) -> J:
    return {"type": "base_stock", "target": days(d), "review_period": review}


def switch(primary: str, secondary: str, trigger: J, shift: float, back: J | None, dwell: int) -> J:
    return {"type": "sourcing_switch", "primary": primary, "secondary": secondary, "trigger": trigger,
            "shift_fraction": shift, "switch_back": back, "min_dwell_periods": dwell}


def expedite(kind: str, value: float, mode: str, cap: float) -> J:
    c = {"kind": "projected_stockout", "within_periods": int(value)} if kind == "stockout" else {
        "kind": "coverage_below", "days": value}
    return {"type": "expedite", "condition": c, "mode": mode, "cost_cap_per_period": cap}


FILL_B = {"supplier": "SUP_B"}
INTENTS: list[tuple[str, str, list[J], str]] = []


def add(slug: str, intent: str, responses: list[J], back: str) -> None:
    INTENTS.append((slug, intent, responses, back))


add("chilled-cover-expedite-budget",
    "Keep two weeks of cover on chilled SKUs at all DCs, but never let expedite costs go over €20k a month.",
    [out("Chilled cover with an expedite budget", scope(nodes=D, categories=["chilled"]),
         {"type": "composite", "rules": [base_stock(14), expedite("stockout", 1, "express_road", 4600)]},
         mandate("replenishment-agent-01", [limit("expedite_spend_per_period", 4600)],
                 [breach("expedite_spend_per_period", "high", "Monthly expedite budget of EUR 20,000")]),
         [assume("chilled-demand-stable", "Chilled demand stays near its normal level", "demand", "le", 2400,
                 "compiler_inferred", 0.5)],
         ["You set a budget but not when to expedite. Should the agent expedite only when a DC is projected to run "
          "out within a week (my default), or earlier?"],
         "At every DC, order chilled SKUs up to 14 days of cover each week. When a DC is projected to run out within "
         "one week, expedite by express road, spending at most EUR 4,600 a week (EUR 20,000 a month).")],
    "Each week the agent orders chilled products at every DC up to 14 days of expected demand. If a DC is projected "
    "to run out within a week, it ships by express road, spending no more than EUR 4,600 a week. The agent may spend "
    "up to EUR 4,600 a week on expediting by itself and must escalate anything beyond that to the planning manager.")

add("b-misses-switch-to-c",
    "If Supplier B misses more than 10% of orders for three weeks running, move volume to Supplier C, and don't "
    "switch back for at least a month.",
    [out("Move volume from B to C when B under-delivers", scope(),
         switch("SUP_B", "SUP_C", cond("supplier_fill_rate", "lt", 0.9, 3, **FILL_B), 1.0,
                cond("supplier_fill_rate", "ge", 0.9, 2, **FILL_B), 4),
         mandate("sourcing-agent-01"),
         [assume("c-capacity", "Supplier C can absorb Supplier B's volume", "supplier_capacity", "ge", 4600,
                 "compiler_inferred", 0.3, supplier="SUP_C"),
          assume("b-fill-normal", "Supplier B normally ships at least 90% of what is ordered", "supplier_fill_rate",
                 "ge", 0.9, "user_stated", 0.7, supplier="SUP_B")],
         ["How much of Supplier B's volume should move to C? I assumed all of it, but Supplier C can supply only "
          "2,000 units a week."],
         "When Supplier B ships less than 90% of what is ordered for three weeks in a row, move all of B's volume to "
         "Supplier C. Stay with C for at least four weeks, then move back once B ships 90% or more for two weeks.",
         (0.8, 0.85, 0.7, 0.5))],
    "If Supplier B delivers less than 90% of its orders for three consecutive weeks, the agent moves all of B's "
    "volume to Supplier C, stays there for at least four weeks, and returns once B delivers at least 90% for two "
    "weeks running.")

add("protect-north",
    "When supply is short, protect the North market first, then share the rest fairly.",
    [out("Protect the North market in shortages", scope(nodes=["DC_N"]),
         {"type": "allocation", "method": "priority", "priority": ["MKT_N1", "MKT_N2"], "reservation_pct": 0},
         mandate("allocation-agent-01"), [],
         ["Both North markets are served by the North DC. Should North 1 come before North 2, or should they share "
          "equally before anyone else?"],
         "At the North DC, when stock is short, serve North 1 in full, then North 2, then share what is left fairly.",
         (0.85, 0.8, 0.9, 0.9))],
    "When the North DC cannot cover every order, the agent fills North 1 first, then North 2, and splits anything "
    "left in proportion to the remaining orders.")

add("order-change-mandate",
    "The replenishment agent can adjust order quantities by up to 15% on its own; anything bigger needs my sign-off.",
    [out("Replenishment orders within a 15% band", scope(nodes=D),
         base_stock(10), mandate("replenishment-agent-01", [limit("order_qty_change_pct", 15)],
                                 [breach("order_qty_change_pct", "medium", "Order changes above 15% need sign-off")]),
         [],
         ["Which rule should the agent run within this mandate? I kept the current one: 10 days of cover at every "
          "DC."],
         "Keep the current DC rule (order up to 10 days of cover each week). The agent may change an order by up to "
         "15% against its previous order; a bigger change goes to you for sign-off.",
         (0.7, 0.6, 0.95, 0.9))],
    "The agent keeps ordering up to 10 days of cover at each DC every week. It may change any order by up to 15% "
    "compared with the previous one on its own; larger changes must be escalated to the planning manager.")

add("demo-b-to-c-30",
    "If Supplier B misses more than 10% of orders for three weeks running, shift ambient volume to Supplier C, don't "
    "switch back for a month, and the sourcing agent can do this alone up to 30% of volume—beyond that, ask me.",
    [out("Shift ambient volume from B to C", scope(categories=["ambient"]),
         {"type": "composite", "rules": [
             switch("SUP_B", "SUP_C", cond("supplier_fill_rate", "lt", 0.9, 3, **FILL_B), 0.3,
                    cond("supplier_fill_rate", "ge", 0.9, 2, **FILL_B), 4)]},
         mandate("sourcing-agent-01", [limit("volume_shift_pct", 30)],
                 [breach("volume_shift_pct", "high", "Shifting more than 30% of volume needs approval")]),
         [assume("c-spare-capacity", "Supplier C has spare capacity of at least 30% of B's ambient volume",
                 "supplier_capacity", "ge", 1100, "compiler_inferred", 0.6, supplier="SUP_C"),
          assume("c-lead-time", "Supplier C's lead time stays under a week", "lead_time", "lt", 7,
                 "compiler_inferred", 0.7, supplier="SUP_C"),
          assume("b-recovers", "Supplier B returns to shipping at least 90% of orders", "supplier_fill_rate", "ge",
                 0.9, "user_stated", 0.6, supplier="SUP_B")],
         ["Should the agent ask you before going above 30%, or never go above 30% at all?"],
         "When Supplier B ships less than 90% of ambient orders for three weeks running, move 30% of B's ambient "
         "volume to Supplier C. Stay for at least four weeks, and move back once B ships 90% or more for two weeks. "
         "Moving more than 30% needs your approval.")],
    "If Supplier B delivers less than 90% of its orders for three weeks in a row, the agent moves 30% of B's ambient "
    "volume to Supplier C, keeps it there for at least four weeks, and moves it back once B delivers 90% or more for "
    "two weeks. The agent may shift up to 30% of volume itself; anything more must go to the planning manager.")

add("class-a-plants-3w",
    "Order up to 3 weeks of cover for class A SKUs at the plants, reviewed every week.",
    [out("Three weeks of cover for class A at the plants", scope(nodes=P, sku_classes=["A"]),
         base_stock(21), mandate("replenishment-agent-01"), [], [],
         "At both plants, each week, order class A SKUs up to 21 days of cover.", (0.95, 0.95, 0.8, 0.9))],
    "Every week the agent orders class A products at both plants up to 21 days of expected demand.")

add("minmax-crackers-spices",
    "Use a min-max rule at the DCs for crackers and spice mix: reorder when cover drops to 5 days, fill up to 15 days.",
    [out("Min-max for crackers and spice mix", scope(nodes=D, skus=["S08", "S09"]),
         {"type": "min_max", "reorder_point": days(5), "order_up_to": days(15)},
         mandate("replenishment-agent-01"), [], [],
         "At every DC, for crackers and spice mix: when cover falls to 5 days or less, order up to 15 days.")],
    "For crackers and spice mix at every DC, the agent reorders whenever stock covers 5 days or less, bringing it "
    "back up to 15 days.")

add("air-expedite-stockout",
    "Expedite by air if a DC is projected to run out within a week, but spend at most €3,000 a week.",
    [out("Air expediting before stockouts", scope(nodes=D),
         expedite("stockout", 1, "air", 3000),
         mandate("expedite-agent-01", [limit("expedite_spend_per_period", 3000)]), [], [],
         "When a DC is projected to run out within a week, expedite by air, spending at most EUR 3,000 a week.")],
    "If any DC is projected to run out within a week, the agent ships by air, spending no more than EUR 3,000 a "
    "week, which is also the most it may spend on its own.")

add("a-slow-switch-to-b",
    "If Supplier A's lead time goes above 30 days for two weeks, move half of its volume to Supplier B and switch "
    "back once it's under 25 days for a month.",
    [out("Move half of A's volume to B when A is slow", scope(),
         switch("SUP_A", "SUP_B", cond("observed_lead_time", "gt", 30, 2, supplier="SUP_A"), 0.5,
                cond("observed_lead_time", "lt", 25, 4, supplier="SUP_A"), 0),
         mandate("sourcing-agent-01"),
         [assume("b-headroom", "Supplier B can take half of Supplier A's volume", "supplier_capacity", "ge", 5000,
                 "compiler_inferred", 0.5, supplier="SUP_B")], [],
         "When Supplier A's observed lead time is above 30 days for two weeks, move half of A's volume to Supplier "
         "B; move it back once A's lead time is below 25 days for four weeks.")],
    "When Supplier A takes more than 30 days to deliver for two weeks in a row, the agent moves half of A's volume "
    "to Supplier B, and moves it back once A delivers in under 25 days for four consecutive weeks.")

add("central-proportional",
    "Share scarce stock at the Central DC in proportion to each market's normal demand, keeping 10% back for "
    "Central 1.",
    [out("Proportional allocation at the Central DC", scope(nodes=["DC_C"]),
         {"type": "allocation", "method": "proportional_to_demand", "priority": ["MKT_C1"], "reservation_pct": 10},
         mandate("allocation-agent-01"), [], [],
         "At the Central DC, when stock is short, hold 10% back for Central 1 and share the rest in proportion to "
         "each market's normal demand.")],
    "When the Central DC is short, the agent keeps 10% of the stock for Central 1 and shares the rest between "
    "Central 1 and Central 2 in proportion to their usual demand.")

add("ambient-10d-escalate-backorders",
    "Keep 10 days of cover on ambient SKUs at DCs; the agent may change orders by up to 20% without asking and must "
    "escalate to me if backorders at any DC exceed 2,000 units.",
    [out("Ambient cover with a backorder alarm", scope(nodes=D, categories=["ambient"]),
         base_stock(10),
         mandate("replenishment-agent-01", [limit("order_qty_change_pct", 20)],
                 [breach("order_qty_change_pct"),
                  on_condition(cond("backorders", "gt", 2000, 1, node="DC_N"), "high"),
                  on_condition(cond("backorders", "gt", 2000, 1, node="DC_C"), "high"),
                  on_condition(cond("backorders", "gt", 2000, 1, node="DC_S"), "high")]), [], [],
         "At every DC, order ambient SKUs up to 10 days of cover each week. Orders may change by up to 20% without "
         "asking; backorders above 2,000 units at any DC are escalated to you.")],
    "Each week the agent orders ambient products at every DC up to 10 days of cover. It may change an order by up "
    "to 20% on its own, and alerts the planning manager whenever a DC has more than 2,000 units on backorder.")

add("olive-oil-south",
    "Hold 4 weeks of cover for olive oil at the South plant.",
    [out("Four weeks of olive oil at the South plant", scope(nodes=["PLANT_S"], skus=["S07"]),
         base_stock(28), mandate("replenishment-agent-01"), [], [],
         "At the South plant, order olive oil up to 28 days of cover each week.")],
    "Every week the agent orders olive oil at the South plant up to 28 days of expected demand.")

add("no-air-for-chilled",
    "Never expedite chilled products by air.",
    [out("Chilled products: road expediting only", scope(nodes=D, categories=["chilled"]),
         expedite("coverage", 3, "express_road", 2000),
         mandate("expedite-agent-01", [limit("expedite_spend_per_period", 2000)], prohibited=["expedite_by_air"]),
         [], ["When should chilled products be expedited at all? I assumed: by express road when a DC holds less than "
              "3 days of cover, up to EUR 2,000 a week."],
         "Chilled products are never expedited by air. When a DC holds less than 3 days of cover, they may be "
         "expedited by express road, up to EUR 2,000 a week.", (0.9, 0.5, 0.9, 0.9))],
    "The agent may never expedite chilled products by air. When a DC has less than 3 days of chilled stock, it may "
    "send them by express road, spending up to EUR 2,000 a week.")

add("protect-infant-porridge",
    "Protect infant porridge: keep 3 weeks of cover at every DC and expedite by road when cover falls below 5 days, "
    "up to €1,500 a week.",
    [out("Protect infant porridge", scope(nodes=D, skus=["S10"]),
         {"type": "composite", "rules": [base_stock(21), expedite("coverage", 5, "express_road", 1500)]},
         mandate("replenishment-agent-01", [limit("expedite_spend_per_period", 1500)]), [], [],
         "At every DC, order infant porridge up to 21 days of cover each week; when cover falls below 5 days, "
         "expedite by express road, up to EUR 1,500 a week.")],
    "The agent orders infant porridge at every DC up to 21 days of cover each week, and ships it by express road "
    "whenever a DC drops below 5 days, spending up to EUR 1,500 a week.")

add("b-slow-north-quarter",
    "If Supplier B's lead time exceeds 21 days, shift a quarter of its volume at the North plant to Supplier C; "
    "switch back after two weeks below 18 days, staying switched at least 3 weeks.",
    [out("North plant: a quarter of B's volume to C when B is slow", scope(nodes=["PLANT_N"]),
         switch("SUP_B", "SUP_C", cond("observed_lead_time", "gt", 21, 1, supplier="SUP_B"), 0.25,
                cond("observed_lead_time", "lt", 18, 2, supplier="SUP_B"), 3),
         mandate("sourcing-agent-01"), [], [],
         "At the North plant, when Supplier B's observed lead time exceeds 21 days, move a quarter of B's volume to "
         "Supplier C; return after two weeks below 18 days, and stay at least three weeks.")],
    "At the North plant, as soon as Supplier B takes more than 21 days to deliver, the agent moves a quarter of B's "
    "volume to Supplier C, keeps it there for at least three weeks, and returns once B delivers in under 18 days for "
    "two weeks.")

add("central-7-14",
    "Keep cover for all SKUs at the Central DC between 7 and 14 days.",
    [out("Central DC between 7 and 14 days of cover", scope(nodes=["DC_C"]),
         {"type": "min_max", "reorder_point": days(7), "order_up_to": days(14)},
         mandate("replenishment-agent-01"), [], [],
         "At the Central DC, when any SKU's cover falls to 7 days or less, order it up to 14 days.")],
    "At the Central DC the agent reorders any product whose stock covers 7 days or less, bringing it up to 14 days.")

add("switch-twice-no-new-supplier",
    "The sourcing agent may switch suppliers at most twice without asking me, and must never add a new supplier.",
    [out("Bounded supplier switching", scope(),
         switch("SUP_B", "SUP_C", cond("supplier_fill_rate", "lt", 0.9, 3, **FILL_B), 0.5,
                cond("supplier_fill_rate", "ge", 0.9, 2, **FILL_B), 4),
         mandate("sourcing-agent-01", [limit("consecutive_sourcing_switches", 2)],
                 [breach("consecutive_sourcing_switches", "high")], prohibited=["add_new_supplier"]),
         [assume("b-fill-trigger", "A fill rate below 90% for three weeks is the right moment to switch",
                 "supplier_fill_rate", "lt", 0.9, "compiler_inferred", 0.3, supplier="SUP_B")],
         ["What should trigger a switch, and from which supplier to which? I assumed Supplier B to Supplier C when "
          "B ships less than 90% for three weeks.",
          "How much volume should a switch move? I assumed half."],
         "When Supplier B ships less than 90% for three weeks, move half of its volume to Supplier C (both assumed). "
         "The agent may make at most two switches on its own and may never add a new supplier.",
         (0.6, 0.4, 0.95, 0.3))],
    "The agent moves half of Supplier B's volume to Supplier C when B delivers less than 90% for three weeks, and "
    "back when B recovers. It may switch at most twice on its own; further switches go to the planning manager. It "
    "may never add a new supplier.")

add("south-plant-dc-order",
    "During shortages, serve DCs from the South plant in this order: South DC, Central DC, North DC.",
    [out("South plant serves DCs by priority", scope(nodes=["PLANT_S"]),
         {"type": "allocation", "method": "priority", "priority": ["DC_S", "DC_C", "DC_N"], "reservation_pct": 0},
         mandate("allocation-agent-01"), [], [],
         "At the South plant, when stock is short, fill the South DC's orders first, then the Central DC's, then "
         "the North DC's.")],
    "When the South plant cannot ship everything, the agent fills the South DC first, then the Central DC, then the "
    "North DC.")

add("pasta-sauce-12d-biweekly",
    "Order up to 12 days of cover on dry pasta and tomato sauce at all DCs, reviewing every two weeks.",
    [out("Pasta and sauce, fortnightly review", scope(nodes=D, skus=["S03", "S04"]),
         base_stock(12, review=2), mandate("replenishment-agent-01"), [], [],
         "At every DC, every two weeks, order dry pasta and tomato sauce up to 12 days of cover.")],
    "Every two weeks the agent orders dry pasta and tomato sauce at every DC up to 12 days of expected demand.")

INVALID_FIRST = out("Cereal cover tied to competitor prices", scope(nodes=D, skus=["S05"]),
                    {"type": "composite", "rules": [base_stock(21)]},
                    mandate("replenishment-agent-01",
                            escalation=[on_condition(cond("backorders", "gt", 500, 1), "low")]),
                    [assume("competitor", "Competitor prices drop 10%", "competitor_price", "lt", 0.9,
                            "user_stated", 0.9)], [],
                    "Raise cereal cover to 3 weeks when competitor prices drop 10%.")
add("competitor-price-out-of-vocabulary",
    "If competitor prices drop 10%, raise safety stock on cereal to 3 weeks.",
    [INVALID_FIRST,
     out("Three weeks of cover for cereal", scope(nodes=D, skus=["S05"]),
         base_stock(21), mandate("replenishment-agent-01"), [],
         ["PolicyForge cannot observe competitor prices. Should the agent hold 3 weeks of cover on cereal at all "
          "times, or only when you switch this policy on?"],
         "At every DC, order cereal up to 21 days of cover each week. Competitor prices cannot be observed, so the "
         "rule does not depend on them.", (0.9, 0.6, 0.8, 0.9))],
    "Every week the agent orders breakfast cereal at every DC up to 21 days of expected demand.")

EXPECTED_ATTEMPTS = {"competitor-price-out-of-vocabulary": 2}

# Answers to clarifying questions, recorded too, so the §10 demo's "answer it" step runs offline (answers/).
DEMO_QUESTION = "Should the agent ask you before going above 30%, or never go above 30% at all?"
DEMO_ANSWER = "Ask me before going above 30%."
ANSWERED = [("demo-b-to-c-30", {DEMO_QUESTION: DEMO_ANSWER})]


def answered(slug: str, answers: dict[str, str]) -> dict[str, Any]:
    intent, responses, back = next((i, r, b) for s, i, r, b in INTENTS if s == slug)
    final = dict(responses[-1])
    final["clarifying_questions"] = []
    final["interpretation_notes"] = (final["interpretation_notes"] + " You confirmed: above 30% the agent asks you "
                                     "first; it does not stop at 30%.")
    return {"id": f"{slug}-answered", "intent": intent, "answers": answers, "responses": [final],
            "back_translation": back}


def main() -> None:
    assert len(INTENTS) == 20, len(INTENTS)
    for i, (slug, intent, responses, back) in enumerate(INTENTS, start=1):
        final = responses[-1]
        fx = {
            "id": f"{i:02d}-{slug}",
            "intent": intent,
            "responses": responses,
            "back_translation": back,
            "expected": {
                "scope": final["scope"], "rule": final["rule"],
                "autonomy": final["mandate"]["autonomy"],
                "prohibited_actions": final["mandate"]["prohibited_actions"],
                "assumptions": len(final["assumptions"]), "questions": len(final["clarifying_questions"]),
                "attempts": EXPECTED_ATTEMPTS.get(slug, 1),
            },
        }
        (HERE / f"{i:02d}-{slug}.json").write_text(json.dumps(fx, indent=2, ensure_ascii=False) + "\n",
                                                   encoding="utf-8")
    (HERE / "answers").mkdir(exist_ok=True)
    for slug, answers in ANSWERED:
        (HERE / "answers" / f"{slug}.json").write_text(
            json.dumps(answered(slug, answers), indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
