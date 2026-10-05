"""HUB-FR-27 · WRK-BR-04 · Kết quả có cấu trúc (plan-runtime §4, plan.md §2.3 `JobOutput`).

Agent (`output="agent_result"`): `Final.structured` → pydantic `AgentResult` (sinh từ contract);
Orchestrator (`output="text"`): `text` nguyên văn (Hub tự parse/retry — plan-db §8 R3).
"""

from __future__ import annotations

from typing import Any

from pydantic import ValidationError

from agent_runtime.contracts.hub import AgentResult, JobPayload1
from agent_runtime.providers.base import Confirm, Final

MAX_TEXT = 64_000
HINT_MAX = 300


def validation_hint(final: Final) -> str:
    """Lý do JSON sai (≤ 300 ký tự, không chép nội dung model) để nhắc ở lần thử lại."""
    if final.structured is None:
        return "không phải một đối tượng JSON hợp lệ"
    try:
        AgentResult.model_validate(final.structured)
    except ValidationError as err:
        parts = [
            f"{'.'.join(str(p) for p in e['loc']) or '(gốc)'}: {e['type']}" for e in err.errors()
        ]
        return "; ".join(parts)[:HINT_MAX]
    return ""


def _model_asked(final: Final) -> AgentResult | None:
    """Kết quả agent hợp lệ có `status == "need_input"` (model tự hỏi), ngược lại None."""
    if final.is_error:
        return None
    try:
        result = AgentResult.model_validate(final.structured)
    except ValidationError:
        return None
    return result if result.root.status == "need_input" else None


def confirmation_forced(payload: JobPayload1, final: Final | None, confirm: Confirm | None) -> bool:
    """§5 #4: kết quả agent bị thay bằng `need_input` của Hub (để log `job.confirmation_forced`)."""
    if payload.output != "agent_result" or confirm is None or final is None:
        return False
    return _model_asked(final) is None


def forced_need_input(confirm: Confirm) -> dict[str, Any]:
    """`job.result.output` = `need_input{question, choices}` của Hub (HUB-FR-95 §5 #4)."""
    forced = {"status": "need_input", "question": confirm.question, "choices": [*confirm.choices]}
    return {"kind": "agent_result", "result": forced}


def build_output(
    payload: JobPayload1, final: Final, confirm: Confirm | None = None
) -> dict[str, Any] | None:
    """`job.result.output`; sai hình → None (runner thử lại 1 lần rồi `invalid_output`).
    HUB-FR-95 §5 #4: agent có `confirm` (Hub từ chối tool `side_effect`) mà kết quả ≠
    `need_input` (kể cả JSON hỏng / `is_error`) → `need_input{question, choices}` của Hub;
    `need_input` của model → giữ."""
    if confirm is not None and payload.output == "agent_result":
        asked = _model_asked(final)
        if asked is not None:
            return {"kind": "agent_result", "result": asked.model_dump(mode="json")}
        return forced_need_input(confirm)
    if payload.output == "text":
        text = final.text if final.text is not None else final.raw_json
        if text is None or len(text) > MAX_TEXT:
            return None
        return {"kind": "text", "text": text}
    try:
        result = AgentResult.model_validate(final.structured)
    except ValidationError:
        return None
    return {"kind": "agent_result", "result": result.model_dump(mode="json")}
