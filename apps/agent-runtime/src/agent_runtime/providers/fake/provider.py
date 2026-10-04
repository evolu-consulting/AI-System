"""WRK-FR-04 · WRK-FR-05 · WRK-FR-10 · AC-W02 · AC-W03 · AC-W10 · AC-W11 · Provider giả `fake-cli`
(plan-runtime-fake §7). Chạy trong job host như provider thật; chỉ nạp khi `APP_ENV` ∈
{development, test} (`providers/registry.py`). Session giả (`remember`/`recall`/`lost-session`,
`sessions.py`) chỉ khi `use_session` — AC-W04, H1-R23 (PY-11).
"""

from __future__ import annotations

import asyncio
import json
import os
from pathlib import Path
from typing import cast

from agent_runtime.providers.base import (
    Emit,
    Final,
    Progress,
    ProviderJob,
    RateLimit,
    Session,
    ToolUse,
    UsageEv,
)
from agent_runtime.providers.fake.directives import (
    clean,
    directives,
    message_of,
    seconds,
    task_without_delegate,
    usage_pair,
)
from agent_runtime.providers.fake.sessions import load, new_id, save
from agent_runtime.providers.fake.state import bump_badjson
from agent_runtime.sandbox.hook import SandboxPolicy, make_path_guard

KEY = "fake-cli"
FAKE_TAIL = (
    "Đây là phần đuôi cố định của provider giả fake-cli, đủ dài để Hub cắt thành nhiều "
    "đoạn delta khi phát luồng trả lời cho người dùng cuối trong các bài kiểm thử."
)
BAD_JSON = '{"status": "done", "text": '


async def _sleep(total_s: float, emit: Emit) -> None:
    done = 0.0
    while done < total_s:
        step = min(1.0, total_s - done)
        await asyncio.sleep(step)
        done += step
        await emit(Progress(label=f"fake sleep {int(done)}s"))


async def _guarded(job: ProviderJob, tool: str, tool_input: dict[str, object]) -> str | None:
    """Gọi hook thật; deny → lý do, allow → None."""
    policy = SandboxPolicy(
        str(job.payload.job_id),
        Path(job.work_dir),
        tuple(Path(p) for p in job.forbidden_roots),
        frozenset(job.payload.allowed_tools),
    )
    out = await make_path_guard(policy)({"tool_name": tool, "tool_input": tool_input}, None, None)
    spec = cast("dict[str, object]", out.get("hookSpecificOutput") or {})
    if spec.get("permissionDecision") == "deny":
        return str(spec.get("permissionDecisionReason"))
    return None


def _read_len(job: ProviderJob, raw: str) -> int:
    try:
        return len(Path(job.work_dir, raw).read_text(errors="replace"))
    except OSError:
        return 0


async def _body(job: ProviderJob, msg: str, found: dict[str, str], emit: Emit) -> str:
    if "read" in found:
        denied = await _guarded(job, "Read", {"file_path": found["read"]})
        return "denied" if denied else f"read: {_read_len(job, found['read'])} chars"
    if "tool" in found:
        await emit(ToolUse(name=found["tool"]))
        denied = await _guarded(job, found["tool"], {})
        return f"denied:{denied}" if denied else "allowed"
    if "env" in found:
        return "env: " + ",".join(sorted(os.environ))
    return f"echo: {clean(msg)} {FAKE_TAIL}".replace("echo:  ", "echo: ")


def _orchestrator(msg: str, found: dict[str, str], body: str) -> Final:
    if "delegate" in found:
        task = task_without_delegate(msg) or "tiếp tục"
        text = json.dumps({"decision": "delegate", "agent": found["delegate"], "task": task})
    elif "ask" in found:
        text = json.dumps({"decision": "ask", "question": "Bạn muốn gì?", "choices": ["A", "B"]})
    else:
        text = json.dumps({"decision": "answer", "text": body}, ensure_ascii=False)
    return Final(kind="text", text=text)


def _agent(found: dict[str, str], body: str) -> Final:
    if "partial" in found:
        res = {"status": "partial", "text": body, "missing": "thiếu dữ liệu"}
    elif "need_input" in found or "ask" in found:
        res = {"status": "need_input", "question": "Bạn chọn gì?", "choices": ["A", "B"]}
    else:
        res = {"status": "done", "text": body}
    return Final(kind="agent_result", structured=res)


async def _session(
    job: ProviderJob, found: dict[str, str], kind: str, emit: Emit
) -> dict[str, str] | None:
    """`use_session`: resume/lưu session giả, phát `session`. None = resume lỗi (đã phát `final`
    lỗi, trước mọi `tool_use` — runner dựng lại từ history)."""
    if not job.payload.use_session:
        return {}
    sid = job.resume_session_id
    data = load(job.work_dir, sid) if sid else {}
    if sid and (data is None or "lost-session" in found):
        await emit(
            Final.model_validate(
                {
                    "kind": kind,
                    "is_error": True,
                    "subtype": "error_during_execution",
                    "errors": ["No conversation found with session ID"],
                }
            )
        )
        return None
    data = dict(data or {})
    sid = sid or new_id()
    if "remember" in found:
        data["word"] = found["remember"]
    save(job.work_dir, sid, data)
    await emit(Session(session_id=sid))
    return data


async def _ratelimit(found: dict[str, str], kind: str, emit: Emit) -> None:
    ts = int(found["ratelimit"]) if found["ratelimit"].isdigit() else None
    await emit(RateLimit(status="rejected", resets_at=ts))
    await emit(
        Final.model_validate(
            {
                "kind": kind,
                "is_error": True,
                "subtype": "rate_limit",
                "api_error_status": 429,
                "errors": ["rate limited"],
            }
        )
    )


async def _badjson(job: ProviderJob, found: dict[str, str], emit: Emit) -> bool:
    """`#fake:badjson=<n>`: n lần đầu của run trả JSON hỏng (bộ đếm theo run). True = đã phát."""
    limit = int(found["badjson"]) if found.get("badjson", "").isdigit() else 0
    if not (limit and bump_badjson(job.work_dir, str(job.payload.run_id), limit)):
        return False
    text_out = job.payload.output == "text"
    kind = "text" if text_out else "agent_result"
    await emit(Final(kind=kind, raw_json=BAD_JSON, text=BAD_JSON if text_out else None))
    return True


async def _side_effects(job: ProviderJob, found: dict[str, str], emit: Emit) -> None:
    """`spawn-child`, `usage`, `sleep` — trước khi trả kết quả."""
    if "spawn-child" in found:
        # Cùng process group với job host (không start_new_session) — AC-W10.
        await asyncio.create_subprocess_exec(
            "sleep",
            "300",
            cwd=job.work_dir,
            stdin=asyncio.subprocess.DEVNULL,
            stdout=asyncio.subprocess.DEVNULL,  # không giữ pipe giao thức của job host
        )
    # usage trước sleep: huỷ giữa chừng vẫn có usage đã báo (H1-R25).
    if "usage" in found:
        tin, tout = usage_pair(found["usage"])
        await emit(UsageEv.model_validate({"in": tin, "out": tout, "model": "fake"}))
    if "sleep" in found:
        await _sleep(seconds(found["sleep"]), emit)


async def _finish(emit: Emit, final: Final, *, reported: bool) -> None:
    """CLI thật luôn kèm usage ở kết quả cuối (plan-runtime §8: `usage_logs` chỉ khi có) → chưa có
    `#fake:usage` thì phát usage mặc định 10,20 như chỉ thị không số (plan-runtime-fake §7)."""
    if not reported:
        await emit(UsageEv.model_validate({"in": 10, "out": 20, "model": "fake"}))
    await emit(final)


class FakeProvider:
    key = KEY

    async def run(self, job: ProviderJob, emit: Emit) -> None:
        text_out = job.payload.output == "text"
        kind = "text" if text_out else "agent_result"
        msg = message_of(job.payload.prompt, orchestrator=text_out)
        found = directives(msg)
        if "crash" in found:
            os._exit(3)
        memory = await _session(job, found, kind, emit)
        if memory is None:
            return
        if text_out and "delegate" in found:
            # Orchestrator chỉ quyết định; chỉ thị khác (sleep, usage…) theo `task` tới agent (S1).
            if not await _badjson(job, found, emit):
                await _finish(emit, _orchestrator(msg, found, ""), reported=False)
            return
        await _side_effects(job, found, emit)
        if "ratelimit" in found:
            await _ratelimit(found, kind, emit)
            return
        if await _badjson(job, found, emit):
            return
        body = await _body(job, msg, found, emit)
        if "recall" in found:
            body = f"recall: {memory.get('word', '')}"
        final = _orchestrator(msg, found, body) if text_out else _agent(found, body)
        await _finish(emit, final, reported="usage" in found)
