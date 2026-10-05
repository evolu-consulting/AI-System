"""WRK-FR-04 · WRK-FR-05 · WRK-FR-10 · AC-W02 · AC-W03 · AC-W10 · AC-W11 · Provider giả `fake-cli`
(plan-runtime-fake §7). Chạy trong job host như provider thật; chỉ nạp khi `APP_ENV` ∈
{development, test} (`providers/registry.py`). Session giả (`remember`/`recall`/`lost-session`,
`sessions.py`) chỉ khi `use_session` — AC-W04, H1-R23 (PY-11).
H2a (PY-06, `plan-runtime` §6): `#fake:tool=<key>` với key ∈ `payload.mcp.tools` (job có file MCP)
→ `tool_use{mcp__hub__<key>}` → hook (policy có `mcp_tools`) → `tools/call` thật (`mcp_call.py`);
`CONFIRMATION_REQUIRED` → `Confirm` (cha ép `need_input`). Key ngoài danh sách → nghĩa H1.
`#fake:mcp-list` → `tools/list`. Orchestrator: câu đồng ý → delegate lại theo tin trước (S01).
H2b (PY-04, `plan-runtime` §6): `#fake:stream*`/`answer-len` (`stream.py`), `#fake:turns=<n>` (n
`UsageEv` cộng dồn trước `sleep`), `#fake:is-error=<rate|auth|refused|error>` (`Final.is_error` chữ
cố định, không `RateLimit`, usage `{in:10, out:0}` trừ khi có `#fake:usage`; chỉ `refused` (và giá
trị lạ) kèm `stop_reason="refusal"` — TC-8); agent nhận câu đồng ý
không chỉ thị → chạy lại tin user trước trong `payload.history`.
H2c (PY-04, `plan-runtime` §6, `files.py`): `#fake:files` (dòng `<tên>:<sha>` của `attachments/`),
`#fake:out=<a>,…`/`out-size`/`out-link` (ghi thẳng `out/`, sau `sleep`), `#fake:write=<path>` (hook
thật `Write`, PL9 — sau `sleep`: P51 đặt symlink trong lúc ngủ).
H3a (PY-02, `plan-runtime` §5): `#fake:ratelimit=<ts>[,<type>]` (`rejected` kèm loại cửa sổ),
`#fake:ratewarn=<util>[,<ts>]` (`allowed_warning` rồi chạy tiếp như `ok`).
"""

from __future__ import annotations

import asyncio
import json
import os
from pathlib import Path
from typing import cast

from agent_runtime.providers.base import (
    Confirm,
    Emit,
    Final,
    Progress,
    ProviderJob,
    RateLimit,
    Session,
    ToolUse,
    UsageEv,
)
from agent_runtime.providers.claude.mcp import job_mcp_tools, read_bearer, tool_name
from agent_runtime.providers.fake.directives import (
    agreed_message,
    clean,
    directives,
    message_of,
    ratelimit_args,
    ratewarn_args,
    redelegate_message,
    seconds,
    task_without_delegate,
    tool_args,
    turns,
    usage_pair,
)
from agent_runtime.providers.fake.files import files_text, write_file, write_outputs
from agent_runtime.providers.fake.mcp_call import call_tool, list_tools
from agent_runtime.providers.fake.sessions import load, new_id, save
from agent_runtime.providers.fake.state import bump_badjson
from agent_runtime.providers.fake.stream import (
    STREAM_GAP_S,
    agent_doc,
    orchestrator_answer,
    sized,
    stream_final,
)
from agent_runtime.sandbox.hook import SandboxPolicy, make_path_guard

KEY = "fake-cli"
FAKE_TAIL = (
    "Đây là phần đuôi cố định của provider giả fake-cli, đủ dài để Hub cắt thành nhiều "
    "đoạn delta khi phát luồng trả lời cho người dùng cuối trong các bài kiểm thử."
)
BAD_JSON = '{"status": "done", "text": '
MCP_PROGRESS = "Đang gọi công cụ"  # = nhãn `claude-sub` (§4.4)
IS_ERROR_TEXT = {  # test-plan L2: mẫu rate / auth (`patterns.py`) / không mẫu
    "rate": "You've hit your usage limit",
    "auth": "Not logged in · Please run /login",
    "refused": "I can't help with that.",
    "error": "API Error: 500 Internal server error",  # TC-8: lỗi provider, không tín hiệu từ chối
}


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
        mcp_tools=frozenset(job_mcp_tools(job)),
        out_id=job.out_dir_id,
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


def _mcp_target(job: ProviderJob, found: dict[str, str]) -> tuple[str, str, str] | None:
    """(url, Authorization, key) khi job có MCP và `#fake:tool=<key>` ∈ `payload.mcp.tools`."""
    mcp, path, key = job.payload.mcp, job.mcp_config_path, found.get("tool")
    if mcp is None or path is None or key is None or tool_name(key) not in job_mcp_tools(job):
        return None
    return mcp.url, read_bearer(path) or "", key


async def _mcp_tool(job: ProviderJob, msg: str, target: tuple[str, str, str], emit: Emit) -> str:
    url, auth, key = target
    name = tool_name(key)
    await emit(ToolUse(name=name))
    await emit(Progress(label=MCP_PROGRESS))
    args = tool_args(msg)
    if args is None:
        return "bad_args"
    denied = await _guarded(job, name, args)
    if denied:
        return f"denied:{denied}"
    got = await call_tool(url, auth, key, dict(args))
    if isinstance(got, Confirm):
        await emit(got)  # cha ép `need_input{question, choices}` (§5 #4)
        return "confirmation_required"
    return got


async def _mcp_list(job: ProviderJob) -> str:
    if job.payload.mcp is None or job.mcp_config_path is None or not job_mcp_tools(job):
        return "mcp_unavailable"
    return await list_tools(job.payload.mcp.url, read_bearer(job.mcp_config_path) or "")


async def _mcp_first(job: ProviderJob, msg: str, found: dict[str, str], emit: Emit) -> str | None:
    """Gọi MCP **trước** `sleep`/`usage` (job còn `running` sau lời gọi — P01, P24); None = không
    có chỉ thị MCP áp dụng (giữ nghĩa H1)."""
    if (target := _mcp_target(job, found)) is not None:
        return await _mcp_tool(job, msg, target, emit)
    if "mcp-list" in found:
        return await _mcp_list(job)
    return None


async def _write(job: ProviderJob, raw: str) -> str:
    """H2c `#fake:write=<path>` (PL9): hook thật với `Write {file_path}` — cho ⇒ ghi, `written`."""
    denied = await _guarded(job, "Write", {"file_path": raw})
    if denied:
        return f"denied:{denied}"
    write_file(job.work_dir, raw)
    return "written"


async def _body(job: ProviderJob, msg: str, found: dict[str, str], emit: Emit) -> str:
    if "files" in found:
        return files_text(job.work_dir)
    if "write" in found:
        return await _write(job, found["write"])
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
        text = orchestrator_answer(body, found)
    return Final(kind="text", text=text)


def _agent(found: dict[str, str], body: str) -> Final:
    if "partial" in found:
        res = {"status": "partial", "text": body, "missing": "thiếu dữ liệu"}
    elif "need_input" in found or "ask" in found:
        res = {"status": "need_input", "question": "Bạn chọn gì?", "choices": ["A", "B"]}
    else:
        res = {"status": "done", "text": body}
    return Final(kind="agent_result", structured=agent_doc(res, found))


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
    ts, rate_type = ratelimit_args(found["ratelimit"])
    await emit(RateLimit(status="rejected", resets_at=ts, rate_limit_type=rate_type))
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
    if "ratewarn" in found:  # H3a: `allowed_warning` rồi chạy tiếp như `ok`
        util, ts = ratewarn_args(found["ratewarn"])
        await emit(RateLimit(status="allowed_warning", resets_at=ts, utilization=util))
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
    if "usage" in found:  # H2b `#fake:turns=<n>`: lượt k báo k×in, k×out (cộng dồn, AC-09)
        tin, tout = usage_pair(found["usage"])
        for k in range(1, turns(found) + 1):
            if k > 1:
                await asyncio.sleep(STREAM_GAP_S)
            await emit(UsageEv.model_validate({"in": k * tin, "out": k * tout, "model": "fake"}))
    if "sleep" in found:
        await _sleep(seconds(found["sleep"]), emit)
    write_outputs(job.work_dir, found)  # H2c `#fake:out*`: sau `sleep`, trước kết quả (§6)


async def _early_end(job: ProviderJob, found: dict[str, str], kind: str, emit: Emit) -> bool:
    """`ratelimit`, `is-error`, `badjson` — True = đã phát `final`."""
    if "ratelimit" in found:
        await _ratelimit(found, kind, emit)
        return True
    if "is-error" in found:  # F4 (L2): không `RateLimit` — cha phân loại theo chữ result
        if "usage" not in found:
            await emit(UsageEv.model_validate({"in": 10, "out": 0, "model": "fake"}))
        key = found["is-error"] if found["is-error"] in IS_ERROR_TEXT else "refused"
        stop = "refusal" if key == "refused" else None
        final = {"kind": kind, "is_error": True, "text": IS_ERROR_TEXT[key], "stop_reason": stop}
        await emit(Final.model_validate(final))
        return True
    return await _badjson(job, found, emit)


def _message(job: ProviderJob, text_out: bool) -> str:
    """Tin để đọc chỉ thị: Orchestrator "Đồng ý" → delegate lại (S01, TD #47, tag); agent "Đồng ý"
    không chỉ thị → tin user trước trong `payload.history`."""
    msg = message_of(job.payload.prompt, orchestrator=text_out)
    if text_out:
        return redelegate_message(job.payload.prompt, msg) or msg
    history = [(h.role, h.content) for h in job.payload.history]
    return agreed_message(msg, history) or msg


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
        msg = _message(job, text_out)
        found = directives(msg)
        if "crash" in found:
            os._exit(3)
        memory = await _session(job, found, kind, emit)
        if memory is None:
            return
        if text_out and "delegate" in found:
            # Orchestrator chỉ quyết định; chỉ thị khác (sleep, usage…) theo `task` tới agent (S1).
            if not await _badjson(job, found, emit):
                final = await stream_final(job, found, _orchestrator(msg, found, ""), emit)
                await _finish(emit, final, reported=False)
            return
        mcp_body = None if text_out else await _mcp_first(job, msg, found, emit)
        await _side_effects(job, found, emit)
        if await _early_end(job, found, kind, emit):
            return
        body = mcp_body if mcp_body is not None else await _body(job, msg, found, emit)
        if "recall" in found:
            body = f"recall: {memory.get('word', '')}"
        body = sized(body, found, FAKE_TAIL)
        final = _orchestrator(msg, found, body) if text_out else _agent(found, body)
        final = await stream_final(job, found, final, emit)
        await _finish(emit, final, reported="usage" in found)
