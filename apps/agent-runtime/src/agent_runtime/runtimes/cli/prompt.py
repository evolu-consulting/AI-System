"""HUB-FR-27 · Prompt lần thử lại khi JSON agent hỏng (plan-runtime §4)."""

from __future__ import annotations

from agent_runtime.runtimes.cli.result import HINT_MAX

REMINDER = (
    "Câu trả lời trước không đúng định dạng ({hint}). Chỉ trả MỘT đối tượng JSON, không thêm "
    'chữ ngoài JSON: {{"status":"done","text":"..."}} | '
    '{{"status":"partial","text":"...","missing":"..."}} | '
    '{{"status":"need_input","question":"...","choices":["..."]}}. Không gọi công cụ.'
)


def retry_prompt(original: str, hint: str, *, resumed: bool) -> str:
    """Có resume: chỉ nhắc định dạng; không: kèm lại yêu cầu gốc (không còn ngữ cảnh)."""
    note = REMINDER.format(hint=hint[:HINT_MAX] or "JSON sai")
    return note if resumed else f"{original}\n\n{note}"
