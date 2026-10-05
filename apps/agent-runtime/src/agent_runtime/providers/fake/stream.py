"""WRK-FR-03 · R19–R21, R25 · H2b PY-04 (plan-runtime §6): `fake-cli` phát `Delta` như `claude-sub`.

`#fake:stream[=<n>]` (n 1–50, mặc định 5) — chỉ khi `payload.stream is True` ∧ không phải lần thử
lại định dạng: dựng JSON cuối (Orchestrator `Final.text`; agent `structured`, khoá theo thứ tự
`status` → `text`, `ensure_ascii=False`), cắt `n` đoạn đều theo code point, mỗi đoạn qua
`StreamScanner` cùng mode ⇒ `Delta`, cách nhau 50 ms; rồi `Final` như cũ. `delegate`/`ask`/
`need_input` ⇒ scanner tự `off`. Biến thể: `#fake:stream-order=text-first` (JSON đặt `text` trước
khoá vai ⇒ 0 delta), `#fake:stream-diverge` (chữ stream đổi ký tự đầu, `Final` đúng),
`#fake:stream-badjson` (sau stream, `Final` JSON hỏng). `#fake:answer-len=<n>` đệm/cắt `body`.
"""

from __future__ import annotations

import asyncio
import json
from typing import Any

from agent_runtime.providers.base import Delta, Emit, Final, ProviderJob
from agent_runtime.providers.stream_scan import StreamScanner

STREAM_DEFAULT, STREAM_MAX = 5, 50
STREAM_GAP_S = 0.05
ANSWER_LEN_MAX = 64_000
BAD_TEXT_JSON = '{"decision": "answer", "text": '
BAD_AGENT_JSON = '{"status": "done", "text": '


def _int(raw: str | None, default: int, lo: int, hi: int) -> int:
    try:
        value = int(raw or default)
    except ValueError:
        value = default
    return min(hi, max(lo, value))


def sized(body: str, found: dict[str, str], filler: str) -> str:
    """`#fake:answer-len=<n>`: đệm (lặp `filler`) / cắt `body` đúng `n` ký tự (n ≤ 64 000)."""
    if "answer-len" not in found:
        return body
    n = _int(found["answer-len"], len(body), 1, ANSWER_LEN_MAX)
    out = body
    while len(out) < n:
        out += " " + filler
    return out[:n]


def text_first(found: dict[str, str]) -> bool:
    return found.get("stream-order") == "text-first"


def orchestrator_answer(body: str, found: dict[str, str]) -> str:
    if text_first(found):
        return json.dumps({"text": body, "decision": "answer"}, ensure_ascii=False)
    return json.dumps({"decision": "answer", "text": body}, ensure_ascii=False)


def agent_doc(res: dict[str, Any], found: dict[str, str]) -> dict[str, Any]:
    """Thứ tự khoá của JSON agent (`text-first` ⇒ `text` trước `status`)."""
    if text_first(found) and "text" in res:
        return {"text": res["text"], **{k: v for k, v in res.items() if k != "text"}}
    return res


def _doc(final: Final, found: dict[str, str]) -> str:
    if final.kind == "text":
        return final.text or ""
    return json.dumps(agent_doc(final.structured or {}, found), ensure_ascii=False)


def _diverge(final: Final, found: dict[str, str]) -> str:
    """Chữ stream = `text` đổi ký tự đầu (Hub thấy lệch tiền tố, `delta_mismatch`)."""
    if final.kind == "text":
        data = json.loads(final.text or "{}")
    else:
        data = agent_doc(dict(final.structured or {}), found)
    text = str(data.get("text") or "")
    if text:
        data["text"] = ("B" if text[0] != "B" else "C") + text[1:]
    return json.dumps(data, ensure_ascii=False)


def _segments(doc: str, n: int) -> list[str]:
    size = -(-len(doc) // n) if doc else 1
    return [doc[i : i + size] for i in range(0, len(doc), size)]


def streaming(job: ProviderJob, found: dict[str, str]) -> bool:
    return "stream" in found and job.payload.stream is True and job.retry_prompt is None


async def stream_final(job: ProviderJob, found: dict[str, str], final: Final, emit: Emit) -> Final:
    """Khi `streaming`: phát `Delta` của JSON cuối rồi trả `Final` cần phát (`stream-badjson` ⇒
    bản hỏng); ngược lại trả nguyên `final`."""
    if not streaming(job, found):
        return final
    doc = _diverge(final, found) if "stream-diverge" in found else _doc(final, found)
    scanner = StreamScanner("orchestrator" if final.kind == "text" else "agent")
    for i, part in enumerate(_segments(doc, _int(found["stream"], STREAM_DEFAULT, 1, STREAM_MAX))):
        if i:
            await asyncio.sleep(STREAM_GAP_S)
        text = "".join(scanner.feed(part))
        if text and scanner.kind is not None:
            await emit(Delta(kind=scanner.kind, text=text))
    return badjson_final(final, found)


def badjson_final(final: Final, found: dict[str, str]) -> Final:
    """`#fake:stream-badjson` (gọi khi `streaming`): `Final` JSON hỏng — Orchestrator `text`, agent
    `raw_json` (`structured=None`) ⇒ Hub `stream_unparsed`; Runtime không thử lại (R21)."""
    if "stream-badjson" not in found:
        return final
    if final.kind == "text":
        return Final(kind="text", text=BAD_TEXT_JSON, raw_json=BAD_TEXT_JSON)
    return Final(kind="agent_result", raw_json=BAD_AGENT_JSON)
