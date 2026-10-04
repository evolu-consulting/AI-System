"""HUB-FR-27 · WRK-BR-04 · `result.py` + `prompt.py` + thử lại 1 lần của `_Run` (đơn vị)."""

from __future__ import annotations

from agent_runtime.providers.base import Final, UsageEv
from agent_runtime.runtimes.cli.prompt import retry_prompt
from agent_runtime.runtimes.cli.result import HINT_MAX, validation_hint
from agent_runtime.runtimes.cli.runner import _Seen  # pyright: ignore[reportPrivateUsage]


def test_hub_fr_27_hint_names_fields_without_content() -> None:
    f = Final(kind="agent_result", structured={"status": "partial", "text": "bí mật"})
    hint = validation_hint(f)
    assert hint and "bí mật" not in hint and len(hint) <= HINT_MAX


def test_hub_fr_27_hint_for_unparsable_json() -> None:
    f = Final(kind="agent_result", raw_json='{"status": "done", "text": ')
    assert "JSON" in validation_hint(f)


def test_hub_fr_27_hint_empty_when_valid() -> None:
    f = Final(kind="agent_result", structured={"status": "done", "text": "x"})
    assert validation_hint(f) == ""


def test_wrk_br_04_retry_prompt_resumed_vs_fresh() -> None:
    resumed = retry_prompt("làm A", "text: missing", resumed=True)
    assert "text: missing" in resumed and "làm A" not in resumed and "Không gọi công cụ" in resumed
    fresh = retry_prompt("làm A", "x" * 1000, resumed=False)
    assert fresh.startswith("làm A") and len(fresh) < 1000


def test_hub_fr_27_usage_carried_across_retry() -> None:
    seen = _Seen(usage=UsageEv.model_validate({"in": 3, "out": 4}), session_id="s1")
    seen.final = Final(kind="agent_result")
    seen.next_attempt()
    assert seen.final is None and seen.session_id == "s1"
    assert (seen.tokens().input_tokens, seen.tokens().output_tokens) == (3, 4)
    seen.usage = UsageEv.model_validate({"in": 1, "out": 2})
    assert (seen.tokens().input_tokens, seen.tokens().output_tokens) == (4, 6)
