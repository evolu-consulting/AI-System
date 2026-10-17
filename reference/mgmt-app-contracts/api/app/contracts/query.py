import json
import logging
from collections.abc import Generator

from app.contracts.clock import today_vn
from app.contracts.tools import SearchClauses, openai_specs, run_tool, search_clauses
from app.llm_openai import openai_client
from app.query.rerank import rerank
from app.settings import settings

log = logging.getLogger(__name__)
_ROUNDS, _MAX_CALLS = 3, 6

PLANNER_SYSTEM = """You gather facts to answer a question about the company's purchase and service contracts.
Call the tools you need; you may call several. Prefer find_contracts / contract_facts / amendments_of /
price_history for parties, dates, values and prices, margins for what we sell, its margin, where it is bought and
which sales are at risk, and search_clauses for what a clause says.
Today is {today}. When you have enough, reply without calling tools."""

_CONTRACT_SYSTEM = """You answer questions about the company's contracts.
Use ONLY the numbered context. Every number, date and price you state must appear in the context; never compute or
guess one. After each claim cite the context number like [2]. If a context item is marked [chưa xác nhận], say the
data is not yet confirmed. If the context does not answer the question, say so plainly. Answer in the language of
the question.
Hôm nay là {today}. Khi hỏi giá hoặc điều khoản 'hiện tại', chỉ dùng mục đang hiệu lực hôm nay; nếu có giá đã bị phụ lục thay thế, nêu giá mới và ghi chú giá cũ."""


def contract_system(today: str) -> str:
    return _CONTRACT_SYSTEM.format(today=today)


def fallback(question: str, restrict: list[str] | None) -> list[dict]:
    items = search_clauses(SearchClauses(query=question), restrict, today_vn().isoformat())
    return rerank(question, items) if items else []


_STEP = {"find_contracts": "Tìm hợp đồng", "contract_facts": "Đọc hợp đồng", "amendments_of": "Xem phụ lục",
         "price_history": "Tra lịch sử giá", "search_clauses": "Tìm điều khoản",
         "margins": "Tính lãi & nguồn hàng"}


def _step(name: str, args_json: str) -> str:
    """What the planner is doing, in words the asker reads while waiting."""
    try:
        arg = next((f"hạn chót trong {v} ngày" if k == "due_within_days" else
                    ", ".join(map(str, v)) if isinstance(v, list) else str(v)
                    for k, v in json.loads(args_json or "{}").items() if k != "limit" and v not in (None, [], "")), "")
    except ValueError:
        arg = ""
    return f"{_STEP.get(name, name)}: {arg}" if arg else _STEP.get(name, name)


def gather(question: str, restrict: list[str] | None, today: str | None = None) -> list[dict]:
    g = gather_steps(question, restrict, today)
    while True:
        try:
            next(g)
        except StopIteration as done:
            return done.value


def gather_steps(question: str, restrict: list[str] | None,
                 today: str | None = None) -> Generator[str, None, list[dict]]:
    """Yields a label per tool call while gathering; returns the gathered items."""
    today = today or today_vn().isoformat()
    if settings.fake_llm or settings.llm_provider != "openai":
        yield _STEP["search_clauses"]
        return fallback(question, restrict)
    messages = [{"role": "system", "content": PLANNER_SYSTEM.format(today=today)},
                {"role": "user", "content": question}]
    items: list[dict] = []
    calls = 0
    try:
        for _ in range(_ROUNDS):
            r = openai_client().chat.completions.create(model=settings.openai_chat_model, temperature=0,
                                                        messages=messages, tools=openai_specs())
            msg = r.choices[0].message
            if not msg.tool_calls:
                break
            messages.append(msg.model_dump(exclude_none=True))
            for tc in msg.tool_calls:
                calls += 1
                if calls <= _MAX_CALLS:
                    yield _step(tc.function.name, tc.function.arguments)
                got = run_tool(tc.function.name, tc.function.arguments, restrict, today) if calls <= _MAX_CALLS else []
                items += got
                messages.append({"role": "tool", "tool_call_id": tc.id,
                                 "content": json.dumps([{"contract_id": g["doc_id"], "text": g["text"]} for g in got],
                                                      ensure_ascii=False)[:20000]})
    except Exception:  # noqa: BLE001 - keep what was gathered; clause search only if nothing was
        log.warning("contract planner failed", exc_info=True)
    if items:   # the planner may narrow to the wrong contracts; the question's own clause hits stay as a backstop
        items += fallback(question, restrict)[:4]
    seen, unique = set(), []
    for it in items:
        key = (it["doc_id"], it["text"])
        if key not in seen:
            seen.add(key)
            unique.append(it)
    return unique[:20] or fallback(question, restrict)
