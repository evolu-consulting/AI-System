"""Adapter contract (dry, anthropic, claude_cli) and model swapping. Never calls a paid API: the anthropic
adapter gets a fake client and the CLI adapter a fake subprocess runner."""
from __future__ import annotations

import json
import os
import subprocess
import sys
from types import SimpleNamespace as NS

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from kh_worker.budget import Budget  # noqa: E402
from kh_worker.llm import (DEFAULT_MODEL, AnthropicLLM, ClaudeCliLLM, DryLLM, LLMConfigError, LLMError,  # noqa: E402
                           LLMRefusal, LLMRequest, Metered, OAUTH_IDENTITY, instance_from_schema, make_llm,
                           parse_json_text)

SCHEMA = {"type": "object",
          "properties": {"items": {"type": "array", "items": {"type": "object"}}, "note": {"type": "string"},
                         "kind": {"enum": ["lesson", "fact"]}},
          "required": ["items", "kind"], "additionalProperties": False}


@pytest.fixture(autouse=True)
def _no_key(monkeypatch):
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    for k in ("KH_WORKER_LLM", "KH_WORKER_MODEL", "KH_WORKER_DRY_FIXTURE", "KH_WORKER_EFFORT"):
        monkeypatch.delenv(k, raising=False)


# ------------------------------------------------------------------------------------------- contract
def _contract(llm):
    assert isinstance(llm.name, str) and isinstance(llm.model, str) and isinstance(llm.billed, bool)
    assert llm.count_tokens("s", "u", SCHEMA) > 0
    r = llm.complete("system", "user", SCHEMA, max_tokens=500)
    assert r.adapter == llm.name and isinstance(r.usage, dict) and r.cost_usd >= 0
    return r


def test_dry_contract_and_schema_instance():
    r = _contract(DryLLM())
    assert r.json == {"items": [], "kind": "lesson"} and r.billed is False and r.model == DEFAULT_MODEL


def test_dry_fixture_and_responder(tmp_path, monkeypatch):
    fx = tmp_path / "fx.json"
    fx.write_text(json.dumps({"items": [{"text": "x"}], "kind": "fact"}), encoding="utf-8")
    monkeypatch.setenv("KH_WORKER_DRY_FIXTURE", str(fx))
    llm = make_llm("dry")
    assert llm.complete("s", "u", SCHEMA).json["kind"] == "fact"
    rsp = DryLLM(responder=lambda s, u, sc: {"items": [], "kind": "lesson", "note": u})
    assert rsp.complete("s", "hello", SCHEMA).json["note"] == "hello"


def test_model_swap_through_env_with_dry(monkeypatch):
    monkeypatch.setenv("KH_WORKER_LLM", "dry")
    assert make_llm().model == "claude-opus-5-5"
    monkeypatch.setenv("KH_WORKER_MODEL", "claude-sonnet-5")
    llm = make_llm()
    assert llm.model == "claude-sonnet-5" and llm.name == "dry"
    # the cheaper model is estimated cheaper by the budget
    big = "x" * 30000
    e_opus = Metered(DryLLM("claude-opus-5-5"), Budget()).estimate("s", big, SCHEMA, 3000)
    e_son = Metered(llm, Budget()).estimate("s", big, SCHEMA, 3000)
    assert e_son == pytest.approx(e_opus / 2)


def test_make_llm_unknown_and_anthropic_without_key():
    with pytest.raises(LLMConfigError):
        make_llm("openai")
    with pytest.raises(LLMConfigError, match="ANTHROPIC_API_KEY"):
        make_llm("anthropic")


def test_instance_from_schema_handles_common_keywords():
    assert instance_from_schema({"type": "array", "minItems": 2, "items": {"type": "integer", "minimum": 3}}) == [3, 3]
    assert instance_from_schema({"anyOf": [{"type": "string"}, {"type": "null"}]}) == ""
    assert instance_from_schema({"type": ["null", "boolean"]}) is False


def test_parse_json_text():
    assert parse_json_text('```json\n{"a": 1}\n```') == {"a": 1}
    assert parse_json_text('Here it is: {"a": [1]} done') == {"a": [1]}
    with pytest.raises(LLMError):
        parse_json_text("no json here")


# ------------------------------------------------------------------------------------------- anthropic (fake client)
class _FakeMessages:
    def __init__(self, reply):
        self.reply, self.calls = reply, []

    def create(self, **kw):
        self.calls.append(kw)
        return self.reply

    def count_tokens(self, **kw):
        return NS(input_tokens=1234)


def _msg(text, stop="end_turn", model="claude-opus-5-5", usage=None):
    return NS(content=[NS(type="thinking", thinking=""), NS(type="text", text=text)], stop_reason=stop, model=model,
              usage=NS(**(usage or {"input_tokens": 1000, "output_tokens": 200, "cache_read_input_tokens": 0,
                                    "cache_creation_input_tokens": 0})))


def _client(reply):
    beta = _FakeMessages(reply)
    plain = _FakeMessages(reply)
    return NS(beta=NS(messages=beta), messages=plain), beta, plain


def test_anthropic_request_shape_and_cost():
    client, beta, _ = _client(_msg(json.dumps({"items": [], "kind": "fact"})))
    llm = AnthropicLLM(client=client)
    r = _contract(llm)
    kw = beta.calls[0]
    assert kw["model"] == "claude-opus-5-5" and kw["thinking"] == {"type": "adaptive"}
    assert kw["output_config"]["effort"] == "medium"
    assert kw["output_config"]["format"] == {"type": "json_schema", "schema": SCHEMA}
    assert kw["betas"] == ["server-side-fallback-2026-07-01"] and kw["extra_body"] == {"fallbacks": "default"}
    assert r.json == {"items": [], "kind": "fact"}
    assert r.cost_usd == pytest.approx((1000 * 4 + 200 * 20) / 1e6)
    assert llm.count_tokens("s", "u", SCHEMA) > 1234           # schema overhead added


def test_anthropic_oauth_token_opens_the_system_with_claude_codes_identity():
    client, beta, _ = _client(_msg(json.dumps({"items": [], "kind": "fact"})))
    llm = AnthropicLLM(client=client)
    llm.oauth = True
    _contract(llm)
    system = beta.calls[0]["system"]
    assert system[0]["text"] == OAUTH_IDENTITY and system[1]["type"] == "text" and len(system) == 2


def test_anthropic_without_fallbacks_uses_plain_messages_and_model_swap():
    client, beta, plain = _client(_msg('{"items": [], "kind": "fact"}', model="claude-sonnet-5"))
    llm = AnthropicLLM("claude-sonnet-5", client=client, fallbacks=False, effort="low")
    llm.complete("s", "u", SCHEMA)
    assert beta.calls == [] and plain.calls[0]["model"] == "claude-sonnet-5"
    assert plain.calls[0]["output_config"]["effort"] == "low"


def test_anthropic_fallback_model_is_priced_at_the_dearer_model():
    client, _, _ = _client(_msg('{"items": [], "kind": "fact"}', model="claude-opus-4-8"))
    r = AnthropicLLM(client=client).complete("s", "u", SCHEMA)
    assert r.cost_usd == pytest.approx((1000 * 5 + 200 * 25) / 1e6)


def test_anthropic_refusal_is_booked_then_raised():
    client, _, _ = _client(_msg("", stop="refusal"))
    b = Budget()
    with pytest.raises(LLMRefusal):
        Metered(AnthropicLLM(client=client), b).complete("s", "u", SCHEMA)
    assert b.calls == 1 and b.run_spent_usd > 0 and b.reserved_usd == 0


def test_anthropic_transport_error_releases_the_hold():
    class Boom(_FakeMessages):
        def create(self, **kw):
            raise ConnectionError("network down")
    client = NS(beta=NS(messages=Boom(None)), messages=Boom(None))
    b = Budget()
    with pytest.raises(LLMError):
        Metered(AnthropicLLM(client=client), b).complete("s", "u", SCHEMA)
    assert b.reserved_usd == 0 and b.run_spent_usd == 0


def test_anthropic_batch_half_price_and_results_by_id():
    ok = NS(custom_id="b", result=NS(type="succeeded", message=_msg('{"items": [], "kind": "fact"}')))
    bad = NS(custom_id="a", result=NS(type="errored"))
    state = {"n": 0}

    class Batches:
        def __init__(self):
            self.created = None

        def create(self, requests):
            self.created = requests
            return NS(id="batch1", processing_status="in_progress")

        def retrieve(self, bid):
            state["n"] += 1
            return NS(id=bid, processing_status="ended")

        def results(self, bid):
            return iter([ok, bad])

    batches = Batches()
    client = NS(beta=NS(messages=None), messages=NS(batches=batches, count_tokens=lambda **k: NS(input_tokens=10)))
    llm = AnthropicLLM(client=client, sleep=lambda s: None)
    out = Metered(llm, Budget()).complete_many([LLMRequest("s", "u", SCHEMA, 100, "a"),
                                                LLMRequest("s", "u", SCHEMA, 100, "b")])
    assert [r.custom_id for r in out] == ["a", "b"]
    assert out[0].error == "errored" and out[1].json["kind"] == "fact"
    assert out[1].cost_usd == pytest.approx((1000 * 4 + 200 * 20) / 1e6 / 2)
    assert "fallbacks" not in json.dumps(batches.created) and state["n"] == 1


# ------------------------------------------------------------------------------------------- claude_cli (fake runner)
def _runner(stdout, code=0, seen=None):
    def run(argv, **kw):
        if seen is not None:
            seen.update(argv=argv, **kw)
            with open(argv[argv.index("--system-prompt-file") + 1], encoding="utf-8") as fh:
                seen["system"] = fh.read()
        return subprocess.CompletedProcess(argv, code, stdout=stdout, stderr="")
    return run


def _cli_out(**kw):
    base = {"type": "result", "subtype": "success", "is_error": False, "result": "",
            "total_cost_usd": 0.0123, "usage": {"input_tokens": 50, "output_tokens": 20}}
    base.update(kw)
    return json.dumps(base)


def test_cli_argv_stdin_and_structured_output():
    seen = {}
    llm = ClaudeCliLLM(runner=_runner(_cli_out(structured_output={"items": [], "kind": "fact"}), seen=seen))
    r = Metered(llm, Budget(cap_run_usd=2.0)).complete("SYSTEM RULES", "the logs", SCHEMA, max_tokens=100)
    a = seen["argv"]
    assert a[1:2] == ["-p"] and a[a.index("--output-format") + 1] == "json"
    assert a[a.index("--model") + 1] == "claude-opus-5-5" and a[a.index("--effort") + 1] == "medium"
    assert json.loads(a[a.index("--json-schema") + 1]) == SCHEMA
    assert a[a.index("--tools") + 1] == "" and "--no-session-persistence" in a and "--strict-mcp-config" in a
    assert a[a.index("--setting-sources") + 1] == "project"
    assert 0 < float(a[a.index("--max-budget-usd") + 1]) <= 2.0
    assert seen["input"] == "the logs" and seen["system"] == "SYSTEM RULES"
    assert r.json == {"items": [], "kind": "fact"} and r.cost_usd == pytest.approx(0.0123) and r.billed


def test_cli_parses_result_text_and_reports_errors():
    llm = ClaudeCliLLM(runner=_runner(_cli_out(result='```json\n{"items": [], "kind": "lesson"}\n```')))
    assert llm.complete("s", "u", SCHEMA).json["kind"] == "lesson"
    bad = ClaudeCliLLM(runner=_runner(_cli_out(is_error=True, subtype="error_max_budget_usd"), code=1))
    with pytest.raises(LLMError, match="error_max_budget_usd"):
        Metered(bad, Budget()).complete("s", "u", SCHEMA)
    with pytest.raises(LLMError, match="no JSON"):
        ClaudeCliLLM(runner=_runner("not json", code=2)).complete("s", "u", SCHEMA)


def test_cli_missing_binary_and_timeout():
    def missing(argv, **kw):
        raise FileNotFoundError(argv[0])

    def slow(argv, **kw):
        raise subprocess.TimeoutExpired(argv, 1)
    with pytest.raises(LLMConfigError):
        ClaudeCliLLM(binary="no-such-claude", runner=missing).complete("s", "u", SCHEMA)
    with pytest.raises(LLMError, match="timed out"):
        ClaudeCliLLM(runner=slow).complete("s", "u", SCHEMA)


def test_cli_selected_by_env(monkeypatch):
    monkeypatch.setenv("KH_WORKER_LLM", "claude_cli")
    monkeypatch.setenv("KH_WORKER_MODEL", "claude-sonnet-5")
    llm = make_llm()
    assert isinstance(llm, ClaudeCliLLM) and llm.model == "claude-sonnet-5"
