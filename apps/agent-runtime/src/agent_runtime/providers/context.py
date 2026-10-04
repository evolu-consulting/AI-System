"""WRK-FR-14 · WRK-BR-03 · H1-R23 · Khối "Ngữ cảnh trước" (plan-runtime §6): job agent không resume
session → prompt = `payload.history` (cũ → mới) + tin hiện tại.

`<history>` là **một dòng JSON** (không chứa xuống dòng thô) ⇒ tách tin hiện tại không nhập nhằng
(`fake-cli` chỉ đọc chỉ thị từ tin hiện tại, không đọc history).

WRK-BR-07 · spike PY-02 S1: CLI Claude coi `@<đường dẫn>` (`@/x`, `@~/x`, `@./x`, `@"a b"`) đứng đầu
chuỗi hoặc sau khoảng trắng / dấu câu CJK là mention và **tự đọc file** vào ngữ cảnh, không qua tool
hay hook (regex CLI 2.1.286: `@` ở đầu chuỗi hoặc sau khoảng trắng JS / U+3002 U+3001 U+FF1F
U+FF01). Chèn U+200B trước các `@` đó ⇒ không còn khớp; `@` giữa từ (email) giữ nguyên.
Đã xác minh bằng ca `prod-at-file` của spike.
"""

from __future__ import annotations

import json
import re

from agent_runtime.contracts.hub import HistoryItem

HEADER = "Ngữ cảnh trước (các tin gần nhất của hội thoại, cũ → mới):\n<history>\n"
_HIST_END = "\n</history>\n\n<message>\n"
_MSG_END = "\n</message>"
PROMPT_MAX = 200_000  # = JobPayload1.prompt max_length (con validate lại)
ITEM_MAX = 4_000  # mỗi tin ≤ 4000 ký tự như `<history>` của Orchestrator (plan.md §6.2)
ZWSP = "\u200b"
# Đầu chuỗi hoặc sau ký tự JS `\s` (Python `\s` + U+FEFF) / dấu câu CJK mà CLI chấp nhận.
_MENTION_AT = re.compile(r"(?:^|(?<=[\s\ufeff\u3002\u3001\uff1f\uff01]))@")


def neutralize_mentions(text: str) -> str:
    """Chèn U+200B trước `@` mà CLI có thể hiểu là mention (S1); idempotent."""
    return _MENTION_AT.sub(ZWSP + "@", text)


def _items(history: list[HistoryItem], budget: int) -> list[dict[str, str]]:
    """Giữ tin mới nhất vừa `budget` ký tự JSON; bỏ tin cũ trước."""
    kept: list[dict[str, str]] = []
    used = 2
    for h in reversed(history):
        item = {"role": h.role, "content": h.content[:ITEM_MAX]}
        size = len(json.dumps(item, ensure_ascii=False)) + 1
        if used + size > budget:
            break
        kept.append(item)
        used += size
    kept.reverse()
    return kept


def with_history(prompt: str, history: list[HistoryItem]) -> str:
    """Prompt kèm khối ngữ cảnh; không có history (hoặc không còn chỗ) → `prompt` nguyên."""
    budget = PROMPT_MAX - len(prompt) - len(HEADER) - len(_HIST_END) - len(_MSG_END)
    items = _items(history, budget)
    if not items:
        return prompt
    block = json.dumps(items, ensure_ascii=False)
    return f"{HEADER}{block}{_HIST_END}{prompt}{_MSG_END}"


def current_message(prompt: str) -> str:
    """Tin hiện tại của prompt dựng bởi `with_history`; prompt khác → nguyên văn."""
    if not prompt.startswith(HEADER) or not prompt.endswith(_MSG_END):
        return prompt
    cut = prompt.find(_HIST_END, len(HEADER))
    if cut < 0:
        return prompt
    return prompt[cut + len(_HIST_END) : -len(_MSG_END)]
