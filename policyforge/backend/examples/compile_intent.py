"""Compile a plain-language intent into a policy, and show it next to its back-translation.

    python -m examples.compile_intent                         # the demo intent, offline (recorded answers)
    python -m examples.compile_intent --list                  # the 20 recorded intents
    python -m examples.compile_intent --pick 8                # recorded intent number 8
    python -m examples.compile_intent --live "Keep 3 weeks of cover on olive oil at every DC."

--live calls Claude (model from LLM_MODEL, default claude-opus-5-5). It needs Anthropic credentials, for example
ANTHROPIC_API_KEY. Without --live, only the recorded intents can be compiled.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from core.domain.examples import default_constitution
from core.domain.network import load_foodnet
from core.llm.compiler import CompileError, compile_intent
from core.llm.mock import load_fixtures
from core.llm.provider import LLMProvider

INTENTS = Path(__file__).resolve().parents[1] / "tests" / "fixtures" / "intents"


def recorded() -> list[str]:
    return [json.loads(p.read_text(encoding="utf-8"))["intent"] for p in sorted(INTENTS.glob("*.json"))]


def main() -> None:  # pragma: no cover - a command-line wrapper around compile_intent()
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("intent", nargs="?")
    ap.add_argument("--live", action="store_true", help="call Claude instead of replaying recorded answers")
    ap.add_argument("--list", action="store_true")
    ap.add_argument("--pick", type=int, default=5, help="number of a recorded intent (1-20)")
    args = ap.parse_args()
    intents = recorded()
    if args.list:
        for i, t in enumerate(intents, start=1):
            print(f"{i:2d}. {t}")
        return
    intent = args.intent or intents[args.pick - 1]
    provider: LLMProvider
    if args.live:
        from core.llm.anthropic_provider import AnthropicProvider

        provider = AnthropicProvider()
    else:
        provider = load_fixtures(INTENTS)
    try:
        res = compile_intent(intent, provider=provider, net=load_foodnet(), constitution=default_constitution())
    except CompileError as e:
        print(f"Could not compile: {e}")
        for a in e.attempts:
            print(f"  attempt {a.number}: " + "; ".join(a.errors))
        sys.exit(1)
    print(f"INTENT\n  {intent}\n\nBACK-TRANSLATION\n  {res.back_translation}\n")
    print(f"INTERPRETATION\n  {res.interpretation_notes}\n")
    if res.clarifying_questions:
        print("QUESTIONS\n" + "\n".join(f"  - {q}" for q in res.clarifying_questions) + "\n")
    if res.warnings:
        print("WARNINGS\n" + "\n".join(f"  - {w.message}" for w in res.warnings) + "\n")
    print(f"ATTEMPTS: {len(res.attempts)} · MODEL: {res.model} · PROMPT HASH: {res.prompt_hash[:12]}\n")
    print(res.policy.model_dump_json(indent=2, include={"name", "scope", "rule", "mandate", "assumptions"}))


if __name__ == "__main__":  # pragma: no cover
    main()
