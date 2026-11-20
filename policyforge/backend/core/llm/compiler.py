"""Compile a natural-language intent into a typed, validated policy draft.

1. Ask the model for a `CompileOutput` (JSON constrained to its schema): scope, rule, a mandate draft, assumptions,
   clarifying questions, plain-language interpretation notes and confidence per field.
2. Parse it, validate it with Pydantic (types, bounds, the closed vocabulary), build the `Policy`, and run the
   deterministic validator against the network and the constitution.
3. If anything fails, send the errors back and ask again: **at most two retries**. Every attempt is recorded.
4. A second call turns the compiled DSL back into plain language, shown next to the original intent.

Nothing the model returns is executed. It only ever becomes data, which is checked before anyone can use it.
"""

from __future__ import annotations

import json
import re
from datetime import UTC, datetime, timedelta

from pydantic import Field, ValidationError

from core.domain.assumption import Assumption
from core.domain.common import Id, Model
from core.domain.constitution import Constitution
from core.domain.mandate import ActionKind, AuthorityLimit, EscalationRule, Mandate
from core.domain.network import Network
from core.domain.policy import DecisionRule, Policy, PolicyStatus, Provenance, Scope
from core.llm.mock import trace_key
from core.llm.prompts import BACK_TRANSLATE_SYSTEM, COMPILE_SYSTEM, compile_message, prompt_hash
from core.llm.provider import LLMError, LLMProvider, Message
from core.llm.schema import api_schema
from core.validate.policy import Issue, errors, validate_policy

MAX_RETRIES = 2


class MandateDraft(Model):
    """The mandate as the model writes it: a term in days instead of dates (the compiler sets the dates)."""

    owner: str = Field(min_length=1, max_length=80)
    approver: str = Field(min_length=1, max_length=80)
    agent_id: Id
    autonomy: list[AuthorityLimit] = Field(default_factory=list, max_length=20)
    escalation: list[EscalationRule] = Field(default_factory=list, max_length=50)
    prohibited_actions: list[ActionKind] = Field(default_factory=list, max_length=20)
    term_days: int = Field(default=90, ge=1, le=366, description="Days until the mandate expires")
    review_triggers: list[Id] = Field(default_factory=list, max_length=50)


class FieldConfidence(Model):
    scope: float = Field(ge=0, le=1)
    rule: float = Field(ge=0, le=1)
    mandate: float = Field(ge=0, le=1)
    assumptions: float = Field(ge=0, le=1)


class CompileOutput(Model):
    """What the model must return."""

    name: str = Field(min_length=1, max_length=120, description="A short name for the policy")
    scope: Scope
    rule: DecisionRule
    mandate: MandateDraft
    assumptions: list[Assumption] = Field(default_factory=list, max_length=20)
    clarifying_questions: list[str] = Field(default_factory=list, max_length=3,
                                            description="Only for ambiguities that change the rule materially")
    interpretation_notes: str = Field(min_length=1, max_length=2000,
                                      description="What the rule will do, in plain language, for the user to confirm")
    confidence: FieldConfidence


class Attempt(Model):
    number: int
    errors: list[str] = Field(default_factory=list)


class CompileResult(Model):
    policy: Policy
    clarifying_questions: list[str]
    interpretation_notes: str
    confidence: FieldConfidence
    back_translation: str
    warnings: list[Issue]
    attempts: list[Attempt]
    model: str
    prompt_hash: str


class CompileError(RuntimeError):
    def __init__(self, message: str, attempts: list[Attempt]) -> None:
        super().__init__(message)
        self.attempts = attempts


SCHEMA = api_schema(CompileOutput)
PROMPT_HASH = prompt_hash(SCHEMA)


def _slug(name: str) -> str:
    s = re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")[:48]
    return s if s and s[0].isalpha() else f"policy-{s}".strip("-")


def _pydantic_errors(e: ValidationError) -> list[str]:
    return [f"{'.'.join(str(p) for p in err['loc']) or '(root)'}: {err['msg']}" for err in e.errors()]


def build_policy(out: CompileOutput, intent: str, con: Constitution, model: str, now: datetime) -> Policy:
    m = out.mandate
    mandate = Mandate(owner=m.owner, approver=m.approver, agent_id=m.agent_id, autonomy=m.autonomy,
                      escalation=m.escalation, prohibited_actions=m.prohibited_actions, valid_from=now,
                      expires_at=now + timedelta(days=m.term_days), review_triggers=m.review_triggers)
    return Policy(id=_slug(out.name), name=out.name, version=1, status=PolicyStatus.draft, intent_text=intent,
                  scope=out.scope, rule=out.rule, mandate=mandate, assumptions=out.assumptions,
                  constitution_ref=con.ref,
                  provenance=Provenance(compiler_model=model, prompt_hash=PROMPT_HASH, created_at=now,
                                        updated_at=now))


def compile_intent(intent: str, *, provider: LLMProvider, net: Network, constitution: Constitution,
                   existing: list[Policy] | None = None, answers: dict[str, str] | None = None,
                   now: datetime | None = None) -> CompileResult:
    now = now or datetime.now(UTC)
    key = trace_key(intent, answers)
    messages: list[Message] = [{"role": "user", "content": compile_message(intent, net, constitution,
                                                                           existing or [], answers)}]
    attempts: list[Attempt] = []
    for n in range(1, MAX_RETRIES + 2):
        problems: list[str] = []
        try:
            resp = provider.generate(system=COMPILE_SYSTEM, messages=messages, schema=SCHEMA, purpose="compile",
                                     trace_key=key)
        except LLMError as e:
            attempts.append(Attempt(number=n, errors=[f"provider: {e}"]))
            raise CompileError(f"the model could not compile the intent: {e}", attempts) from e
        policy: Policy | None = None
        out: CompileOutput | None = None
        try:
            data = json.loads(resp.text)
            out = CompileOutput.model_validate(data)
            policy = build_policy(out, intent, constitution, resp.model, now)
        except json.JSONDecodeError as e:
            problems.append(f"the answer is not valid JSON: {e.msg} at position {e.pos}")
        except ValidationError as e:
            problems += _pydantic_errors(e)
        issues: list[Issue] = []
        if policy is not None:
            issues = validate_policy(policy, net, constitution)
            problems += [f"{i.path}: {i.message}" for i in errors(issues)]
        attempts.append(Attempt(number=n, errors=problems))
        if not problems and policy is not None and out is not None:
            back = translate_back(policy, provider, key)
            return CompileResult(policy=policy, clarifying_questions=out.clarifying_questions,
                                 interpretation_notes=out.interpretation_notes, confidence=out.confidence,
                                 back_translation=back, warnings=[i for i in issues if i.severity == "warning"],
                                 attempts=attempts, model=resp.model, prompt_hash=PROMPT_HASH)
        if n <= MAX_RETRIES:
            messages = [*messages, {"role": "assistant", "content": resp.text},
                        {"role": "user", "content": "Your answer was rejected by the validator:\n"
                         + "\n".join(f"- {p}" for p in problems)
                         + "\nReturn the complete corrected JSON. Use only ids and variables from the context."}]
    raise CompileError(f"the intent could not be compiled into a valid policy after {len(attempts)} attempts",
                       attempts)


def translate_back(policy: Policy, provider: LLMProvider, key: str) -> str:
    body = policy.model_dump_json(include={"name", "scope", "rule", "mandate", "assumptions"}, exclude_none=True)
    try:
        resp = provider.generate(system=BACK_TRANSLATE_SYSTEM, messages=[{"role": "user", "content": body}],
                                 schema=None, purpose="back_translate", trace_key=key)
    except LLMError as e:
        return f"(back-translation unavailable: {e})"
    return resp.text.strip()
