"""Phase 4: the LLM compiler, the validator, the providers and the report narrative."""

from __future__ import annotations

import json
from datetime import UTC, datetime
from pathlib import Path
from types import SimpleNamespace
from typing import Any

import anthropic
import pytest

from core.domain.constitution import Constitution
from core.domain.examples import default_constitution, example_policy
from core.domain.network import load_foodnet
from core.domain.policy import Policy
from core.domain.scenario import ScenarioSet
from core.evaluate.run import evaluate
from core.llm import anthropic_provider
from core.llm.anthropic_provider import AnthropicProvider
from core.llm.compiler import MAX_RETRIES, PROMPT_HASH, SCHEMA, CompileError, CompileOutput, compile_intent
from core.llm.mock import MockMissingError, MockProvider, load_fixtures, trace_key
from core.llm.narrative import allowed_numbers, invented_numbers, narrate, report_view
from core.llm.prompts import compile_message, prompt_hash
from core.llm.provider import LLMError, LLMRefusalError, LLMTruncatedError
from core.llm.schema import api_schema, unsupported_keys
from core.sim.scenarios import default_suite
from core.validate.policy import validate_policy

INTENTS = Path(__file__).parent / "fixtures" / "intents"
FIXTURES = sorted(INTENTS.glob("*.json"))
NET = load_foodnet()
CON = default_constitution()
NOW = datetime(2027, 1, 4, tzinfo=UTC)


def compile_with(mock: MockProvider, intent: str, **kw: Any):  # type: ignore[no-untyped-def]
    return compile_intent(intent, provider=mock, net=NET, constitution=CON, now=NOW, **kw)


# ---------------------------------------------------------------- the 20 golden intents
def test_there_are_twenty_golden_intents() -> None:
    assert len(FIXTURES) == 20


@pytest.mark.parametrize("path", FIXTURES, ids=[p.stem for p in FIXTURES])
def test_golden_intent_compiles_to_the_expected_dsl(path: Path) -> None:
    fx = json.loads(path.read_text(encoding="utf-8"))
    mock = load_fixtures(INTENTS)
    res = compile_with(mock, fx["intent"])
    exp = fx["expected"]
    p = res.policy
    assert p.scope.model_dump(mode="json") == exp["scope"]
    assert p.rule.model_dump(mode="json") == exp["rule"]
    assert [a.model_dump(mode="json") for a in p.mandate.autonomy] == exp["autonomy"]
    assert [str(a) for a in p.mandate.prohibited_actions] == exp["prohibited_actions"]
    assert len(p.assumptions) == exp["assumptions"]
    assert len(res.clarifying_questions) == exp["questions"]
    assert len(res.attempts) == exp["attempts"]
    # the policy is a well-formed draft with full provenance
    assert p.status == "draft" and p.version == 1 and p.intent_text == fx["intent"]
    assert p.constitution_ref == CON.ref
    assert p.provenance.compiler_model == "mock-replay" and p.provenance.prompt_hash == PROMPT_HASH
    assert p.mandate.valid_from == NOW and (p.mandate.expires_at - NOW).days == 90
    assert res.back_translation == fx["back_translation"]
    assert res.interpretation_notes and 0 <= res.confidence.rule <= 1
    # it passes the deterministic validator, and survives a JSON round trip
    assert not [i for i in validate_policy(p, NET, CON) if i.severity == "error"]
    assert Policy.model_validate_json(p.model_dump_json()) == p


def test_the_demo_intent_compiles_as_the_brief_describes() -> None:
    """§10: a composite with a sourcing switch and mandate limits, three assumptions, one clarifying question."""
    fx = json.loads(next(INTENTS.glob("05-*.json")).read_text(encoding="utf-8"))
    res = compile_with(load_fixtures(INTENTS), fx["intent"])
    assert res.policy.rule.type == "composite" and res.policy.rule.rules[0].type == "sourcing_switch"
    assert res.policy.mandate.limit("volume_shift_pct") == 30  # type: ignore[arg-type]
    assert len(res.policy.assumptions) == 3 and len(res.clarifying_questions) == 1
    assert any("spare capacity" in a.statement for a in res.policy.assumptions)
    assert {a.source for a in res.policy.assumptions} == {"user_stated", "compiler_inferred"}


def test_warnings_reach_the_user_without_blocking() -> None:
    mock = load_fixtures(INTENTS)
    fx = json.loads(next(INTENTS.glob("19-*.json")).read_text(encoding="utf-8"))
    res = compile_with(mock, fx["intent"])
    assert res.warnings and all(w.code == "cover_below_lead_time" for w in res.warnings)
    assert len(res.attempts) == 1


# ---------------------------------------------------------------- vocabulary and retries
def test_references_outside_the_vocabulary_are_rejected_and_retried() -> None:
    fx = json.loads(next(INTENTS.glob("20-*.json")).read_text(encoding="utf-8"))
    mock = load_fixtures(INTENTS)
    res = compile_with(mock, fx["intent"])
    first = res.attempts[0].errors
    assert any("competitor_price" in e or "assumptions.0.variable.var" in e for e in first)
    assert res.attempts[1].errors == []
    retry_msg = mock.calls[1]["messages"][-1]["content"]
    assert "rejected by the validator" in retry_msg and "assumptions.0.variable.var" in retry_msg
    assert mock.calls[1]["messages"][-2]["role"] == "assistant"


def _good_answer() -> dict[str, Any]:
    fx = json.loads(next(INTENTS.glob("06-*.json")).read_text(encoding="utf-8"))
    out: dict[str, Any] = fx["responses"][-1]
    return out


def test_unknown_ids_are_rejected_by_the_validator_and_passed_back() -> None:
    bad = _good_answer()
    bad["scope"] = {**bad["scope"], "nodes": ["PLANT_X"]}
    mock = MockProvider()
    mock.add("compile", "intent", bad, _good_answer())
    mock.add("back_translate", "intent", "ok")
    res = compile_with(mock, "intent")
    assert len(res.attempts) == 2
    assert any("PLANT_X is not a plant, DC or market" in e for e in res.attempts[0].errors)


def test_compiling_fails_after_two_retries_with_every_attempt_recorded() -> None:
    bad = _good_answer()
    bad["rule"] = {"type": "base_stock", "target": {"unit": "days_of_cover", "value": 900}}  # beyond 365 days
    mock = MockProvider()
    mock.add("compile", "intent", bad, "not json at all", bad)
    with pytest.raises(CompileError) as e:
        compile_with(mock, "intent")
    attempts = e.value.attempts
    assert len(attempts) == MAX_RETRIES + 1 == 3
    assert any("less than or equal to 365" in x for x in attempts[0].errors)
    assert any("not valid JSON" in x for x in attempts[1].errors)
    assert len(mock.calls) == 3


def test_provider_failure_stops_compiling_and_back_translation_failure_does_not() -> None:
    with pytest.raises(CompileError, match="could not compile"):
        compile_with(MockProvider(), "nothing recorded")
    mock = MockProvider()
    mock.add("compile", "intent", _good_answer())  # no back-translation recorded
    res = compile_with(mock, "intent")
    assert res.back_translation.startswith("(back-translation unavailable")


def test_answers_to_questions_change_the_call() -> None:
    mock = MockProvider()
    key = trace_key("intent", {"How much?": "Half"})
    mock.add("compile", key, _good_answer())
    mock.add("back_translate", key, "ok")
    res = compile_with(mock, "intent", answers={"How much?": "Half"})
    assert res.policy.name
    assert "Q: How much?\nA: Half" in mock.calls[0]["messages"][0]["content"]
    with pytest.raises(MockMissingError):
        mock.generate(system="", messages=[], schema=None, purpose="compile", trace_key="other")


# ---------------------------------------------------------------- validator
def _with(policy: Policy, **changes: Any) -> Policy:
    return Policy.model_validate({**json.loads(policy.model_dump_json()), **changes})


def test_validator_catches_what_the_schema_cannot() -> None:
    base = example_policy("base_stock")
    codes = {i.code for i in validate_policy(_with(base, constitution_ref="other@1"), NET, CON)}
    assert "constitution_mismatch" in codes
    s = json.loads(base.model_dump_json())
    s["scope"] = {**s["scope"], "nodes": ["DC_X"], "skus": ["S99"], "suppliers": ["SUP_X"], "lanes": ["L_X"]}
    codes = {i.code for i in validate_policy(Policy.model_validate(s), NET, CON)}
    assert {"unknown_node", "unknown_sku", "unknown_supplier", "unknown_lane", "empty_scope"} <= codes
    s = json.loads(base.model_dump_json())
    s["scope"] = {**s["scope"], "nodes": ["MKT_N1"]}
    assert "scope_no_stock" in {i.code for i in validate_policy(Policy.model_validate(s), NET, CON)}

    alloc = json.loads(example_policy("allocation").model_dump_json())
    alloc["rule"]["priority"] = ["MKT_S1", "NOWHERE"]
    alloc["scope"]["nodes"] = ["DC_N"]
    codes = [i.code for i in validate_policy(Policy.model_validate(alloc), NET, CON)]
    assert "priority_not_served" in codes and "unknown_priority" in codes

    sw = json.loads(example_policy("sourcing_switch").model_dump_json())
    sw["rule"]["secondary"] = "SUP_Z"
    assert "unknown_supplier" in {i.code for i in validate_policy(Policy.model_validate(sw), NET, CON)}
    sw = json.loads(example_policy("sourcing_switch").model_dump_json())
    sw["rule"]["primary"], sw["rule"]["secondary"] = "SUP_C", "SUP_A"
    sw["rule"]["trigger"]["var"]["supplier"] = "SUP_C"
    sw["rule"]["switch_back"]["var"]["supplier"] = "SUP_C"
    assert "primary_not_used" in {i.code for i in validate_policy(Policy.model_validate(sw), NET, CON)}

    ex = json.loads(example_policy("expedite").model_dump_json())
    ex["rule"]["cost_cap_per_period"] = 9000
    ex["rule"]["mode"] = "air"
    ex["scope"]["nodes"] = ["DC_N"]
    codes = {i.code for i in validate_policy(Policy.model_validate(ex), NET, CON)}
    assert {"expedite_cap_above_budget", "expedite_beyond_mandate"} <= codes

    a = json.loads(base.model_dump_json())
    a["assumptions"][0]["variable"]["supplier"] = "SUP_Q"
    assert "unknown_supplier" in {i.code for i in validate_policy(Policy.model_validate(a), NET, CON)}
    a = json.loads(base.model_dump_json())
    a["assumptions"][0]["variable"] = {"var": "capacity_utilisation", "node": "DC_N"}
    a["assumptions"][0]["threshold"] = 0.9
    assert "wrong_node_kind" in {i.code for i in validate_policy(Policy.model_validate(a), NET, CON)}


def test_shift_beyond_the_mandate_is_flagged() -> None:
    fx = json.loads(next(INTENTS.glob("05-*.json")).read_text(encoding="utf-8"))
    ans = fx["responses"][-1]
    ans["rule"]["rules"][0]["shift_fraction"] = 0.6
    mock = MockProvider()
    mock.add("compile", fx["intent"], ans)
    mock.add("back_translate", fx["intent"], "ok")
    res = compile_with(mock, fx["intent"])
    w = [x for x in res.warnings if x.code == "shift_beyond_mandate"]
    assert w and "escalate" in w[0].message
    ans["mandate"]["escalation"] = []
    mock2 = MockProvider()
    mock2.add("compile", fx["intent"], ans)
    res2 = compile_with(mock2, fx["intent"])
    assert any("no escalation rule" in x.message for x in res2.warnings)


# ---------------------------------------------------------------- schema and prompts
def test_the_api_schema_is_accepted_by_structured_outputs() -> None:
    assert unsupported_keys(SCHEMA) == []
    blob = json.dumps(SCHEMA)
    assert '"oneOf"' not in blob and '"minimum"' not in blob and '"anyOf"' in blob
    assert unsupported_keys({"type": "object", "properties": {"x": {"type": "number", "minimum": 0}}}) != []
    assert set(SCHEMA["required"]) >= {"name", "scope", "rule", "mandate", "interpretation_notes", "confidence"}
    # the bounds are still enforced on the way back
    with pytest.raises(Exception, match="less than or equal to 1"):
        CompileOutput.model_validate({**_good_answer(), "confidence": {"scope": 2, "rule": 1, "mandate": 1,
                                                                       "assumptions": 1}})


def test_prompt_hash_tracks_the_template_and_schema() -> None:
    assert len(PROMPT_HASH) == 64 and prompt_hash(SCHEMA) == PROMPT_HASH
    assert prompt_hash({"type": "object"}) != PROMPT_HASH
    msg = compile_message("Keep cover", NET, CON, [example_policy()], None)
    for part in ("SUP_C", "MKT_N1", "region North", "chilled", "Active constitution", "supplier_fill_rate",
                 "Existing policies", "Intent:\nKeep cover"):
        assert part in msg


def test_api_schema_handles_plain_models() -> None:
    s = api_schema(Constitution)
    assert unsupported_keys(s) == []


# ---------------------------------------------------------------- the Anthropic provider, against a stand-in client
class FakeMessages:
    def __init__(self, response: Any = None, error: Exception | None = None) -> None:
        self.response, self.error, self.calls = response, error, []

    def create(self, **kw: Any) -> Any:
        self.calls.append(kw)
        if self.error:
            raise self.error
        return self.response


def fake_client(response: Any = None, error: Exception | None = None) -> Any:
    return SimpleNamespace(beta=SimpleNamespace(messages=FakeMessages(response, error)))


def reply(text: str, stop: str = "end_turn") -> Any:
    return SimpleNamespace(content=[SimpleNamespace(type="thinking", thinking=""), SimpleNamespace(type="text",
                                                                                                   text=text)],
                           stop_reason=stop, model="claude-opus-5-5", stop_details=None,
                           usage=SimpleNamespace(input_tokens=10, output_tokens=5))


def test_anthropic_provider_request_shape(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("LLM_MODEL", raising=False)
    client = fake_client(reply('{"a": 1}'))
    p = AnthropicProvider(client=client)
    assert p.model_id == "claude-opus-5-5"
    r = p.generate(system="sys", messages=[{"role": "user", "content": "hi"}], schema={"type": "object"},
                   purpose="compile", trace_key="k")
    assert r.text == '{"a": 1}' and r.stop_reason == "end_turn" and r.input_tokens == 10
    call = client.beta.messages.calls[0]
    assert call["model"] == "claude-opus-5-5" and call["system"] == "sys"
    assert call["output_config"] == {"effort": "high", "format": {"type": "json_schema", "schema": {"type": "object"}}}
    assert call["fallbacks"] == "default" and call["betas"] == [anthropic_provider.FALLBACK_BETA]
    assert "tool_choice" not in call and "thinking" not in call and "temperature" not in call
    p.generate(system="s", messages=[], schema=None, purpose="back_translate", trace_key="k")
    assert client.beta.messages.calls[1]["output_config"] == {"effort": "low"}
    monkeypatch.setenv("LLM_MODEL", "claude-sonnet-5-5")
    assert AnthropicProvider(client=client).model_id == "claude-sonnet-5-5"
    no_fb = AnthropicProvider(client=fake_client(reply("x")), fallbacks=False)
    no_fb.generate(system="s", messages=[], schema=None, purpose="narrative", trace_key="k")
    assert "fallbacks" not in no_fb._client.beta.messages.calls[0]


def test_anthropic_provider_raises_on_refusal_truncation_and_api_errors() -> None:
    with pytest.raises(LLMRefusalError):
        AnthropicProvider(client=fake_client(reply("", "refusal"))).generate(
            system="s", messages=[], schema=None, purpose="compile", trace_key="k")
    with pytest.raises(LLMTruncatedError):
        AnthropicProvider(client=fake_client(reply("{", "max_tokens"))).generate(
            system="s", messages=[], schema=None, purpose="compile", trace_key="k")
    import httpx2
    req = httpx2.Request("POST", "https://api.anthropic.com/v1/messages")
    for err, text in [
        (anthropic.AuthenticationError("bad key", response=httpx2.Response(401, request=req), body=None),
         "credentials"),
        (anthropic.RateLimitError("slow down", response=httpx2.Response(429, request=req), body=None), "rate limited"),
        (anthropic.BadRequestError("bad schema", response=httpx2.Response(400, request=req), body=None), "rejected"),
        (anthropic.NotFoundError("no model", response=httpx2.Response(404, request=req), body=None), "not available"),
        (anthropic.InternalServerError("boom", response=httpx2.Response(500, request=req), body=None), "500"),
        (anthropic.APIConnectionError(request=req), "could not reach"),
    ]:
        with pytest.raises(LLMError, match=text):
            AnthropicProvider(client=fake_client(error=err)).generate(
                system="s", messages=[], schema=None, purpose="compile", trace_key="k")


# ---------------------------------------------------------------- the narrative
@pytest.fixture(scope="module")
def small_report():  # type: ignore[no-untyped-def]
    from examples.first_stress_test import candidate_policy

    one = ScenarioSet(id="two", name="two", scenarios=default_suite().scenarios[:2])
    return evaluate(candidate_policy(), CON, one, replications=8, periods=40, baselines=("incumbent",))


def test_narrative_numbers_must_come_from_the_report(small_report) -> None:  # type: ignore[no-untyped-def]
    view = report_view(small_report)
    fill = view["comparison"][0]["candidate"]
    ok = f"Verdict: {view['verdict']}. Worst-case fill rate {fill * 100:.1f}% at α = {view['breach_alpha'] * 100:.0f}%."
    assert invented_numbers(ok, view) == []
    assert invented_numbers("Fill rate rose to 99.9% and saved €123,456.", view) == ["99.9%", "123,456"]
    assert f"{fill * 100:.1f}%" in allowed_numbers(view)

    mock = MockProvider()
    mock.add("narrative", small_report.id, "It saves €123,456 a year.", ok)
    n = narrate(small_report, mock)
    assert n.accepted and n.attempts == 2 and n.text == ok
    assert "123,456" in mock.calls[1]["messages"][-1]["content"]
    stubborn = MockProvider()
    stubborn.add("narrative", small_report.id, "It saves €123,456 a year.")
    n = narrate(small_report, stubborn)
    assert not n.accepted and n.text is None and n.invented == ["123,456"]
    assert narrate(small_report, MockProvider()).text is None  # provider failure: no summary
