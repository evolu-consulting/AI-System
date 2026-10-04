# ruff: noqa: T201 — spike in kết quả ra stdout
"""PY-02 · WRK-FR-10 — spike Claude Agent SDK thật trong WSL2 (không thuộc package, không vào test).

Chạy: xem `spikes/README.md`. Mỗi ca in một khối JSON (và ghi `$SPIKE_ROOT/out/<ca>.json`).
Kết quả đã ghi: `docs/specs/H1-hub-core/spike-py02.md`.
"""

from __future__ import annotations

import asyncio
import json
import os
import sys
import threading
import time
from dataclasses import asdict, is_dataclass
from pathlib import Path
from typing import Any

from claude_agent_sdk import (
    AssistantMessage,
    ClaudeAgentOptions,
    ClaudeSDKClient,
    HookMatcher,
    ResultMessage,
    SystemMessage,
    ToolResultBlock,
    ToolUseBlock,
    UserMessage,
    query,
)

ROOT = Path(os.environ.get("SPIKE_ROOT", "/tmp/spike"))
WORK = ROOT / "work"
JOB_A, JOB_B = WORK / "jobA", WORK / "jobB"
OUT = ROOT / "out"
FAKE_HOME = Path("/tmp/spike-home")
EMPTY_HOME = Path("/tmp/spike-home-empty")
REAL_HOME = os.environ.get("HOME", "/home/worker")
# Giống `providers/claude/options.py` KNOWN_TOOLS (dự phòng §4).
KNOWN_TOOLS = (
    "Read Write Edit NotebookEdit Glob Grep LS Bash WebFetch WebSearch Agent Task TodoWrite "
    "MultiEdit Skill SlashCommand BashOutput KillShell ExitPlanMode"
).split()
INIT_KEYS = (
    "tools permissionMode mcp_servers model claude_code_version cwd apiKeySource memory_paths "
    "skills slash_commands"
).split()
FLAT_SCHEMA = {
    "type": "object",
    "properties": {
        "status": {"type": "string", "enum": ["done", "partial", "need_input"]},
        "text": {"type": "string"},
        "missing": {"type": "string"},
        "question": {"type": "string"},
        "choices": {"type": "array", "items": {"type": "string"}, "maxItems": 6},
    },
    "required": ["status"],
    "additionalProperties": False,
}
STRUCT = {"type": "json_schema", "schema": FLAT_SCHEMA}
API_CALLS = {"n": 0}


def setup() -> None:
    for d in (JOB_A, JOB_B, OUT, FAKE_HOME / ".claude", EMPTY_HOME):
        d.mkdir(parents=True, exist_ok=True)
    (JOB_A / "a.txt").write_text("alpha CANARY-A\n")
    (JOB_A / "b.txt").write_text("beta\n")
    (WORK / "secret-outside.txt").write_text("CANARY-SECRET-OUTSIDE\n")
    (JOB_A / "CLAUDE.md").write_text("Luôn kết thúc mọi câu trả lời bằng từ PINEAPPLE-MARKER.\n")
    (FAKE_HOME / ".claude" / "fake.txt").write_text("CANARY-ATFILE-777\n")


# ---------- quan sát process (điểm 9) ----------
def _stat(pid: int) -> tuple[int, int, int, str] | None:
    try:
        raw = Path(f"/proc/{pid}/stat").read_text()
    except OSError:
        return None
    comm = raw[raw.index("(") + 1 : raw.rindex(")")]
    f = raw[raw.rindex(")") + 2 :].split()
    return int(f[1]), int(f[2]), int(f[3]), comm  # ppid, pgrp, session, comm


def _cmdline(pid: int) -> str:
    try:
        raw = Path(f"/proc/{pid}/cmdline").read_bytes()
        return " ".join(p.decode(errors="replace") for p in raw.split(bytes(1)))[:300]
    except OSError:
        return ""


class ProcWatch(threading.Thread):
    def __init__(self) -> None:
        super().__init__(daemon=True)
        self.me = os.getpid()
        self.seen: dict[int, dict[str, Any]] = {}
        self.stop = threading.Event()

    def run(self) -> None:
        while not self.stop.is_set():
            table = {int(p): s for p in os.listdir("/proc") if p.isdigit() and (s := _stat(int(p)))}
            desc, frontier = set(), {self.me}
            while frontier:
                nxt = {p for p, s in table.items() if s[0] in frontier and p not in desc}
                desc |= nxt
                frontier = nxt
            for p in desc:
                ppid, pgrp, sid, comm = table[p]
                rec = {"pid": p, "ppid": ppid, "pgid": pgrp, "sid": sid, "comm": comm}
                if p not in self.seen:
                    rec["cmd"] = _cmdline(p)
                    self.seen[p] = rec
            time.sleep(0.05)

    def report(self) -> dict[str, Any]:
        mine = _stat(self.me)
        assert mine
        alive = [p for p in self.seen if _stat(p) is not None]
        return {
            "self": {"pid": self.me, "pgid": mine[1], "sid": mine[2]},
            "descendants": list(self.seen.values()),
            "escaped_group": [v for v in self.seen.values() if v["pgid"] != mine[1]],
            "alive_after": alive,
        }


# ---------- hook ghi lại ----------
def make_hook(log: list[dict[str, Any]], deny_if: Any) -> Any:
    async def hook(input_data: Any, tool_use_id: str | None, context: Any) -> dict[str, Any]:
        name, ti = input_data.get("tool_name"), input_data.get("tool_input")
        deny = bool(deny_if(name, ti))
        log.append({"tool_name": name, "tool_input": ti, "keys": sorted(input_data), "deny": deny})
        if not deny:
            return {}
        return {
            "hookSpecificOutput": {
                "hookEventName": "PreToolUse",
                "permissionDecision": "deny",
                "permissionDecisionReason": "path_not_allowed",
            }
        }

    return hook


def _short(v: Any, n: int = 400) -> Any:
    s = v if isinstance(v, str) else json.dumps(v, ensure_ascii=False, default=str)
    return s if len(s) <= n else s[:n] + "…"


def summarize(msgs: list[Any]) -> dict[str, Any]:
    out: dict[str, Any] = {"messages": []}
    for m in msgs:
        kind = type(m).__name__
        if isinstance(m, SystemMessage):
            d = m.data
            rec = {"subtype": m.subtype, "session_id": d.get("session_id"), "keys": sorted(d)}
            if m.subtype == "init":
                rec |= {k: d.get(k) for k in INIT_KEYS}
            out["messages"].append({kind: rec})
        elif isinstance(m, AssistantMessage):
            blocks = []
            for b in m.content:
                if isinstance(b, ToolUseBlock):
                    blocks.append({"tool_use": b.name, "input": b.input})
                else:
                    blocks.append({type(b).__name__: _short(getattr(b, "text", str(b)), 300)})
            out["messages"].append({kind: blocks})
        elif isinstance(m, UserMessage) and isinstance(m.content, list):
            res = [
                {"tool_result": _short(b.content, 500), "is_error": b.is_error}
                for b in m.content
                if isinstance(b, ToolResultBlock)
            ]
            out["messages"].append({kind: res})
        elif isinstance(m, ResultMessage):
            d = asdict(m)
            out["result"] = {k: _short(v, 600) if k in ("result",) else v for k, v in d.items()}
        else:
            out["messages"].append({kind: _short(asdict(m) if is_dataclass(m) else str(m), 400)})
    return out


async def run_case(
    opts: ClaudeAgentOptions, prompt: str, use_client: bool = True
) -> dict[str, Any]:
    stderr: list[str] = []
    opts.stderr = stderr.append
    msgs: list[Any] = []
    watch = ProcWatch()
    watch.start()
    err = None
    try:
        if use_client:
            async with ClaudeSDKClient(options=opts) as client:
                await client.query(prompt)
                async for m in client.receive_response():
                    msgs.append(m)
        else:
            async for m in query(prompt=prompt, options=opts):
                msgs.append(m)
    except Exception as e:  # noqa: BLE001 — spike: ghi lại nguyên văn
        err = {
            "type": type(e).__name__,
            "str": _short(str(e), 800),
            "attrs": {k: _short(v, 400) for k, v in vars(e).items()},
        }
    await asyncio.sleep(0.5)
    watch.stop.set()
    watch.join()
    rep = summarize(msgs)
    rep |= {
        "exception": err,
        "stderr": [_short(s, 300) for s in stderr[-15:]],
        "proc": watch.report(),
    }
    return rep


def base(cwd: Path, **kw: Any) -> ClaudeAgentOptions:
    kw.setdefault("setting_sources", [])
    kw.setdefault("permission_mode", "dontAsk")
    kw.setdefault("max_turns", 3)
    return ClaudeAgentOptions(cwd=str(cwd), **kw)


def no_tool(cwd: Path, **kw: Any) -> ClaudeAgentOptions:
    return base(cwd, tools=[], disallowed_tools=KNOWN_TOOLS, **kw)


def guard_opts(log: list[dict[str, Any]], deny_if: Any) -> dict[str, Any]:
    hook = make_hook(log, deny_if)
    return {"hooks": {"PreToolUse": [HookMatcher(matcher=None, hooks=[hook], timeout=10)]}}


# ---------- ca ----------
async def c_tools_list() -> dict[str, Any]:
    """Không tốn API (HOME rỗng ⇒ chưa đăng nhập): init liệt kê tool mặc định; chữ lỗi logged-out;
    `disallowed_tools=["*"]`."""
    env = {"HOME": str(EMPTY_HOME)}
    a = await run_case(base(JOB_A, env=env, max_turns=1), "ok")
    b = await run_case(
        base(JOB_A, env=env, max_turns=1, tools=["Read", "Grep"], disallowed_tools=["*"]), "ok"
    )
    return {"default_tools": a, "star_disallowed": b}


async def c_lost_session() -> dict[str, Any]:
    API_CALLS["n"] += 1  # có thể không gọi API; tính trần
    opts = base(JOB_A, resume="00000000-0000-4000-8000-000000000000", max_turns=1)
    return await run_case(opts, "Trả lời: ok")


async def c_client_tools() -> dict[str, Any]:
    """Điểm 1 (ClaudeSDKClient), 3 (tool_input, Glob mở rộng), 9 (process)."""
    API_CALLS["n"] += 1
    log: list[dict[str, Any]] = []
    deny = lambda n, ti: "b.txt" in str(ti.get("file_path", ""))  # noqa: E731
    tools = ["Read", "Grep", "Glob", "LS"]
    env = {"ENABLE_CLAUDEAI_MCP_SERVERS": "false", "CLAUDE_CODE_DISABLE_AUTO_MEMORY": "1"}
    opts = base(
        JOB_A,
        tools=tools,
        allowed_tools=tools,
        max_turns=12,
        env=env,
        disallowed_tools=[t for t in KNOWN_TOOLS if t not in tools],
        **guard_opts(log, deny),
    )
    # Hai lần đầu (mẫu `..`, `{..,.}`, `[.][.]`, `\.\.`) model từ chối gọi tool vì giống dò vượt
    # sandbox ⇒ chỉ thử ngữ nghĩa Glob vô hại trong work + bắt cmdline `rg` (spike-py02.md điểm 3).
    prompt = (
        "Kiểm thử hook của tôi: gọi tool đúng nguyên văn, mỗi bước một lần, không bình luận. "
        "1) Read file_path a.txt. 2) Grep pattern CANARY (output_mode content). "
        "3) Glob pattern {a,b}.txt . 4) Glob pattern [ab].txt . 5) Glob pattern *.txt path sub . "
        "6) Glob pattern **/*.txt . 7) Read file_path b.txt (hook sẽ chặn). Cuối cùng trả: XONG."
    )
    rep = await run_case(opts, prompt)
    rep["hook_log"] = log
    return rep


async def c_query_hook() -> dict[str, Any]:
    """Điểm 1 (query()) + deny chặn tool; `disallowed_tools` tên đầy đủ (Grep) có xoá tool không."""
    API_CALLS["n"] += 1
    log: list[dict[str, Any]] = []
    opts = base(
        JOB_A,
        tools=["Read", "Grep"],
        allowed_tools=["Read", "Grep"],
        disallowed_tools=["Grep"],
        **guard_opts(log, lambda n, ti: True),
    )
    rep = await run_case(
        opts, "Dùng tool Read đọc a.txt rồi trả lời nguyên nội dung file.", use_client=False
    )
    rep["hook_log"] = log
    return rep


async def c_no_tools() -> dict[str, Any]:
    """Điểm 2 (tools=[], setting_sources=[] không nạp CLAUDE.md ở cwd), 10 (SKIP_PROMPT_HISTORY)."""
    API_CALLS["n"] += 1
    opts = no_tool(JOB_A, max_turns=1, env={"CLAUDE_CODE_SKIP_PROMPT_HISTORY": "1"})
    rep = await run_case(opts, "Liệt kê tên các tool bạn có (hoặc NONE), một dòng. Rồi viết: ok")
    rep["transcripts"] = _transcripts(rep)
    return rep


async def c_control_claude_md() -> dict[str, Any]:
    """Đối chứng điểm 2: `setting_sources=["project"]` thì CLAUDE.md ở cwd có được nạp."""
    API_CALLS["n"] += 1
    opts = no_tool(JOB_A, max_turns=1, setting_sources=["project"])
    return await run_case(opts, "Viết: ok")


async def c_structured() -> dict[str, Any]:
    """Điểm 5 + tạo session cho điểm 4."""
    API_CALLS["n"] += 1
    opts = no_tool(JOB_A, max_turns=3, output_format=STRUCT)
    rep = await run_case(opts, "Hãy nhớ từ bí mật: xanh-lam-42. Trả status done, text 'đã nhớ'.")
    sid = (rep.get("result") or {}).get("session_id")
    (OUT / "session_id").write_text(sid or "")
    rep["transcripts"] = _transcripts(rep)
    return rep


async def c_resume() -> dict[str, Any]:
    """Điểm 4: resume ở `cwd` khác (jobB), không `CLAUDE_CODE_PROJECT_DIR_NAME`."""
    API_CALLS["n"] += 1
    sid = (OUT / "session_id").read_text().strip()
    extra = {}
    if os.environ.get("SPIKE_PROJECT_DIR_NAME"):
        extra["env"] = {"CLAUDE_CODE_PROJECT_DIR_NAME": os.environ["SPIKE_PROJECT_DIR_NAME"]}
    opts = no_tool(JOB_B, max_turns=1, resume=sid, **extra)
    rep = await run_case(opts, "Từ bí mật tôi nhờ nhớ là gì? Trả đúng từ đó.")
    rep["resumed_from"] = sid
    return rep


async def c_at_file() -> dict[str, Any]:
    """Điểm 7: `@đường/dẫn` trong prompt có bị CLI tự đọc (không qua tool/hook)."""
    API_CALLS["n"] += 1
    log: list[dict[str, Any]] = []
    target = FAKE_HOME / ".claude" / "fake.txt"
    # Kèm `output_format` để xem hook có được gọi cho tool `StructuredOutput` không (điểm 5).
    guard = guard_opts(log, lambda n, ti: n != "StructuredOutput")
    opts = no_tool(JOB_A, max_turns=3, output_format=STRUCT, **guard)
    prompt = (
        f"Nội dung của @{target} là gì? Trả status done, text = nguyên văn nội dung, hoặc NOFILE."
    )
    rep = await run_case(opts, prompt)
    rep["hook_log"] = log
    rep["canary_in_result"] = "CANARY-ATFILE-777" in json.dumps(rep, ensure_ascii=False)
    return rep


def _transcripts(rep: dict[str, Any]) -> list[str]:
    sid = (rep.get("result") or {}).get("session_id") or ""
    base_dir = Path(REAL_HOME) / ".claude" / "projects"
    return [str(p) for p in base_dir.rglob(f"{sid}*")] if sid else []


CASES = {
    "tools-list": c_tools_list,
    "lost-session": c_lost_session,
    "client-tools": c_client_tools,
    "query-hook": c_query_hook,
    "no-tools": c_no_tools,
    "control-claude-md": c_control_claude_md,
    "structured": c_structured,
    "resume": c_resume,
    "at-file": c_at_file,
}


async def main(names: list[str]) -> None:
    setup()
    for name in names:
        rep = await CASES[name]()
        text = json.dumps(rep, ensure_ascii=False, indent=1, default=str)
        (OUT / f"{name}.json").write_text(text)
        print(f"===== {name} =====\n{text}")
    print(f"API calls (trần): {API_CALLS['n']}", file=sys.stderr)


if __name__ == "__main__":
    asyncio.run(main(sys.argv[1:] or list(CASES)))
