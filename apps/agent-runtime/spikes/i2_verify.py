# ruff: noqa: T201 — spike in kết quả ra stdout
"""I2 sau PY-02 · WRK-BR-07 · WRK-FR-10 — xác minh bản sửa S1–S4, S6, S9 bằng Claude thật, dùng
**đúng** `build_options` + `neutralize_mentions` + `with_history` của `src/` (không thuộc test).

Ca: `prod-at-file` (1 lượt gọi model) · `prod-structured` (1 lượt) · `prod-orch` (HOME rỗng,
không gọi API).
Chạy như `sdk_spike.py` (README). Kết quả: `docs/specs/H1-hub-core/spike-py02.md` cột "Đã sửa".
"""

from __future__ import annotations

import asyncio
import json
import sys
from pathlib import Path
from typing import Any

from claude_agent_sdk import HookMatcher, ResultMessage, SystemMessage
from sdk_spike import EMPTY_HOME, FAKE_HOME, JOB_A, OUT, REAL_HOME, WORK, run_case, setup

from agent_runtime.contracts.hub import JobPayload1
from agent_runtime.providers.base import ProviderJob
from agent_runtime.providers.claude.mapping import init_model, usage_event
from agent_runtime.providers.claude.options import build_options
from agent_runtime.providers.context import neutralize_mentions, with_history

U = "00000000-0000-4000-8000-000000000001"
TILDE = Path(REAL_HOME) / ".spike-atfile-canary.txt"
CANARIES = {
    FAKE_HOME / ".claude" / "fake.txt": "CANARY-ATFILE-777",
    FAKE_HOME / ".claude" / "fake 2.txt": "CANARY-QUOTED-778",
    TILDE: "CANARY-TILDE-779",
    FAKE_HOME / ".claude" / "fake3.txt": "CANARY-CJK-780",
    FAKE_HOME / ".claude" / "fake4.txt": "CANARY-HIST-781",
    FAKE_HOME / ".claude" / "fake5.txt": "CANARY-SYS-782",
}


def payload(output: str, **over: Any) -> JobPayload1:
    data: dict[str, Any] = {
        "v": 1,
        "type": "agent.cli",
        "runtime": "agentic-cli",
        "job_id": "c3000000-0000-4000-8000-0000000000aa",
        "run_id": U,
        "step_id": U,
        "tenant_id": U,
        "user_id": U,
        "conversation_id": U,
        "flow_id": U,
        "feature_id": None,
        "agent_type_key": None,
        "mcp": None,
        "agent": {"id": U, "key": "coder", "role": "agent"},
        "provider_key": "claude-sub",
        "model": None,
        "step_index": 0,
        "max_turns": 1,  # S7: build_options nâng lên 2
        "profile_steps": [{"provider_key": "claude-sub", "model": None, "on": []}],
        "system_prompt": "Bạn là agent.",
        "prompt": "ok",
        "history": [],
        "use_session": False,
        "allowed_tools": ["Read", "Grep"],
        "output": output,
        "timeout_s": 600,
    }
    data.update(over)
    return JobPayload1.model_validate(data)


def job(p: JobPayload1) -> ProviderJob:
    roots = [REAL_HOME, "/mnt", str(WORK)]
    return ProviderJob(payload=p, work_dir=str(JOB_A), forbidden_roots=roots)


def record_hook(opts: Any, log: list[dict[str, Any]]) -> None:
    """Bọc hook thật của `build_options` để ghi lại tên tool + quyết định."""
    [matcher] = opts.hooks["PreToolUse"]
    [real] = matcher.hooks

    async def hook(input_data: Any, tool_use_id: Any, context: Any) -> Any:
        out = await real(input_data, tool_use_id, context)
        log.append({"tool_name": input_data.get("tool_name"), "deny": bool(out)})
        return out

    opts.hooks = {"PreToolUse": [HookMatcher(matcher=None, hooks=[hook], timeout=10)]}


def init_of(rep: dict[str, Any]) -> dict[str, Any]:
    for m in rep["messages"]:
        sm = m.get("SystemMessage")
        if sm and sm.get("subtype") == "init":
            return sm
    return {}


async def c_prod_at_file() -> dict[str, Any]:
    """S1 (mọi biến thể `@`, cả history + system_prompt), S2, S3, S4, S6, S7, S9."""
    for path, canary in CANARIES.items():
        path.write_text(canary + "\n")
    c = FAKE_HOME / ".claude"
    hist = [{"role": "user", "content": f"tệp cũ @{c / 'fake4.txt'}"}]
    prompt = (
        f'Nội dung các tệp: (1) @{c / "fake.txt"} (2) @"{c / "fake 2.txt"}" '
        f"(3) @~/{TILDE.name} (4) @./../secret-outside.txt (5) câu。@{c / 'fake3.txt'} "
        "(6) tệp trong ngữ cảnh trước (7) tệp trong system prompt. Trả status done, text = mỗi "
        "mục một dòng `n: <nguyên văn nội dung>` hoặc `n: NOFILE` nếu không thấy nội dung."
    )
    p = payload(
        "agent_result",
        prompt=prompt,
        history=hist,
        system_prompt=f"Bạn là agent. Tham khảo @{c / 'fake5.txt'}",
    )
    opts = build_options(job(p))
    log: list[dict[str, Any]] = []
    record_hook(opts, log)
    sent = neutralize_mentions(with_history(p.prompt, p.history))  # như provider.py
    try:
        rep = await run_case(opts, sent)
    finally:
        TILDE.unlink(missing_ok=True)
    rep["hook_log"] = log
    dump = json.dumps(rep, ensure_ascii=False)
    rep["leaked"] = [v for v in [*CANARIES.values(), "CANARY-SECRET-OUTSIDE"] if v in dump]
    rep["max_turns_sent"] = opts.max_turns
    return rep | s9(rep, opts)


def s9(rep: dict[str, Any], opts: Any) -> dict[str, Any]:
    """S9: model `usage` qua `init_model` + `usage_event` thật."""
    init = init_of(rep)
    res = rep.get("result") or {}
    if not res:
        return {"usage_model": None}
    msg = ResultMessage(**{k: v for k, v in res.items() if k in ResultMessage.__dataclass_fields__})
    sysmsg = SystemMessage(subtype="init", data={"model": init.get("model")})
    ev = usage_event(msg, init_model(sysmsg))
    return {
        "usage_model": ev.model if ev else None,
        "model_usage_keys": list((res.get("model_usage") or {}).keys()),
        "disallowed_sent": opts.disallowed_tools,
    }


async def c_prod_structured() -> dict[str, Any]:
    """S2 + S7: hook thật cho `StructuredOutput`; `max_turns=1` → gửi 2 vẫn đủ trả JSON."""
    p = payload("agent_result", prompt="Không dùng tool. Trả status done, text 'ok'.")
    opts = build_options(job(p))
    log: list[dict[str, Any]] = []
    record_hook(opts, log)
    rep = await run_case(opts, neutralize_mentions(p.prompt))
    res = rep.get("result") or {}
    keys = ("subtype", "is_error", "num_turns", "stop_reason", "structured_output")
    return {
        "hook_log": log,
        "max_turns_sent": opts.max_turns,
        "result": {k: res.get(k) for k in keys},
    }


async def c_prod_orch() -> dict[str, Any]:
    """S4: Orchestrator `disallowed_tools=["*"]` + env thật — HOME rỗng (không gọi API)."""
    opts = build_options(job(payload("text", allowed_tools=[])))
    opts.env = {**opts.env, "HOME": str(EMPTY_HOME)}
    rep = await run_case(opts, "ok")
    return {"init": init_of(rep), "disallowed_sent": opts.disallowed_tools, "env": opts.env}


CASES = {
    "prod-at-file": c_prod_at_file,
    "prod-structured": c_prod_structured,
    "prod-orch": c_prod_orch,
}


async def main(names: list[str]) -> None:
    setup()
    for name in names:
        rep = await CASES[name]()
        text = json.dumps(rep, ensure_ascii=False, indent=1, default=str)
        (OUT / f"{name}.json").write_text(text)
        print(f"===== {name} =====\n{text}")


if __name__ == "__main__":
    asyncio.run(main(sys.argv[1:] or list(CASES)))
