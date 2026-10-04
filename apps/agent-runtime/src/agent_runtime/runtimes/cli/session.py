"""WRK-FR-14 · WRK-BR-03 · WRK-BR-06 · H1-R23 — luật session job `agentic-cli` (plan-runtime §6).

Job agent có `use_session` mới dùng `cli_sessions` (Orchestrator không — H1-R23). Resume lỗi trước
`tool_use` đầu → dựng lại từ `history`: **mọi** lỗi (fatal, thoát không `final`, `final.is_error`)
trừ rate limit/đăng xuất. Spike PY-02 #8: mất session = `ResultError` "No conversation found…" trước
`tool_use` (khớp luật này).
"""

from __future__ import annotations

from agent_runtime.contracts.hub import JobPayload1
from agent_runtime.db.sessions_sql import SessionKey
from agent_runtime.runtimes.cli.outcome import Seen


def session_key(p: JobPayload1) -> SessionKey | None:
    """Khoá `cli_sessions` (luôn kèm `tenant_id` của payload — BR-06); None = không dùng session."""
    if not p.use_session or p.output != "agent_result":
        return None
    return SessionKey(p.conversation_id, p.agent.id, p.provider_key, p.tenant_id)


def resume_failed(seen: Seen, resumed: bool) -> bool:
    """Lần chạy có resume mà lỗi trước `tool_use` đầu ⇒ chạy lại không resume (H1-R23)."""
    if not resumed or seen.tool_used or seen.rate_limit is not None:
        return False
    return seen.fatal is not None or seen.final is None or seen.final.is_error
