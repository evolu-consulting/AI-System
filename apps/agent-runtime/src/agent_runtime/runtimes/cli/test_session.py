"""WRK-FR-14 · WRK-BR-06 · H1-R23 · Luật session (plan-runtime §6, dự phòng §13)."""

from __future__ import annotations

import pytest

from agent_runtime.contracts.hub import JobPayload1
from agent_runtime.providers.base import Fatal, Final, RateLimit
from agent_runtime.runtimes.cli.outcome import Seen
from agent_runtime.runtimes.cli.session import resume_failed, session_key
from agent_runtime.runtimes.cli.test_runner import payload


def _payload(use_session: bool, output: str = "agent_result") -> JobPayload1:
    return payload(output).model_copy(update={"use_session": use_session})


def test_wrk_br_06_session_key_includes_tenant() -> None:
    p = _payload(True)
    k = session_key(p)
    assert k is not None
    assert (k.conversation_id, k.agent_id, k.provider_key, k.tenant_id) == (
        p.conversation_id,
        p.agent.id,
        p.provider_key,
        p.tenant_id,
    )


def test_hub_h1_r23_no_session_key() -> None:
    assert session_key(_payload(False)) is None
    assert session_key(_payload(True, "text")) is None  # Orchestrator


ERR = Final(kind="agent_result", is_error=True)
OK = Final(kind="agent_result", structured={"status": "done", "text": "x"})


@pytest.mark.parametrize(
    ("seen", "resumed", "want"),
    [
        (Seen(final=ERR), True, True),
        (Seen(fatal=Fatal(code="UPSTREAM_ERROR", msg="x")), True, True),
        (Seen(), True, True),  # thoát không final
        (Seen(final=ERR), False, False),  # không resume
        (Seen(final=OK), True, False),
        (Seen(final=ERR, tool_used=True), True, False),  # đã tool_use → BR-04
        (Seen(final=ERR, rate_limit=RateLimit(status="rejected")), True, False),
    ],
)
def test_hub_h1_r23_resume_failed(seen: Seen, resumed: bool, want: bool) -> None:
    assert resume_failed(seen, resumed) is want
