"""HUB-FR-27 · WRK-BR-04 · Kết quả có cấu trúc (plan-runtime §4, plan.md §2.3 `JobOutput`).

Agent (`output="agent_result"`): `Final.structured` → pydantic `AgentResult` (sinh từ contract);
Orchestrator (`output="text"`): `text` nguyên văn (Hub tự parse/retry — plan-db §8 R3).
"""

from __future__ import annotations

from typing import Any

from pydantic import ValidationError

from agent_runtime.contracts.hub import AgentResult, JobPayload1
from agent_runtime.providers.base import Final

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


def build_output(payload: JobPayload1, final: Final) -> dict[str, Any] | None:
    """`job.result.output`; sai hình → None (runner thử lại 1 lần rồi `invalid_output`)."""
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
