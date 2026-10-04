# ruff: noqa: T201 — spike in kết quả ra stdout
"""PY-S1 · WRK-FR-13 — spike MCP Hub với Claude CLI thật trong WSL (không thuộc package/test).

Server MCP giả (`mcp_fake.py`, stdlib `http.server`, JSON-RPC thường, không SSE, `GET` → 405, không
`Mcp-Session-Id`) ghi mọi request. Token MCP truyền bằng file cấu hình 0600
(`mcp_servers=<path>`), so với dạng dict (argv). 10 điểm: `plan-runtime.md` §4.6.
Chạy: xem `spikes/README.md`. Kết quả: `docs/specs/H2a-dify-command/spike-s1.md`.
"""

from __future__ import annotations

import asyncio
import json
import os
import sys
import threading
import time
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
)
from mcp_fake import TOKEN, FakeMcp, start_server

ROOT = Path(os.environ.get("SPIKE_ROOT", "/tmp/spike-mcp"))
WORK, OUT, CFG_DIR = ROOT / "work", ROOT / "out", ROOT / ".mcp"
REAL_HOME = os.environ.get("HOME", "/home/worker")
KNOWN_TOOLS = (
    "Read Write Edit NotebookEdit Glob Grep LS Bash WebFetch WebSearch Agent Task TodoWrite "
    "MultiEdit Skill SlashCommand BashOutput KillShell ExitPlanMode"
).split()
FLAT_SCHEMA = {
    "type": "object",
    "properties": {
        "status": {"type": "string", "enum": ["done", "partial", "need_input"]},
        "text": {"type": "string"},
        "question": {"type": "string"},
        "choices": {"type": "array", "items": {"type": "string"}, "maxItems": 6},
    },
    "required": ["status"],
    "additionalProperties": False,
}
MCP_BLOCK = (
    "\nNếu một tool trả lỗi có `code: CONFIRMATION_REQUIRED` thì dừng, không gọi lại tool, "
    "trả status `need_input` với đúng `question` và `choices` trong lỗi."
)
API_CALLS = {"n": 0}


# ---------- quan sát argv (#10) ----------
class ArgvWatch(threading.Thread):
    """Quét /proc của mọi process cùng user: token có trên cmdline không."""

    def __init__(self) -> None:
        super().__init__(daemon=True)
        self.stop = threading.Event()
        self.hits: dict[int, str] = {}
        self.mcp_args: dict[int, str] = {}
        self.me = os.getpid()

    def run(self) -> None:
        while not self.stop.is_set():
            for p in (int(x) for x in os.listdir("/proc") if x.isdigit()):
                self._scan(p)
            time.sleep(0.05)

    def _scan(self, pid: int) -> None:
        try:
            raw = Path(f"/proc/{pid}/cmdline").read_bytes().decode(errors="replace")
        except OSError:
            return
        if pid == self.me:
            return
        args = raw.split("\0")
        if TOKEN in raw:
            self.hits[pid] = args[0]
        if "--mcp-config" in args:
            i = args.index("--mcp-config")
            self.mcp_args[pid] = mask(args[i + 1] if i + 1 < len(args) else "")[:200]

    def report(self) -> dict[str, Any]:
        return {"token_in_cmdline_pids": self.hits, "mcp_config_args": self.mcp_args}


# ---------- tiện ích ----------
def mask(s: str) -> str:
    return s.replace(TOKEN, "***TOKEN***")


def write_cfg(url: str, name: str = "job1") -> Path:
    CFG_DIR.mkdir(parents=True, exist_ok=True)
    os.chmod(CFG_DIR, 0o700)
    path = CFG_DIR / f"{name}.json"
    path.unlink(missing_ok=True)
    cfg = {"mcpServers": {"hub": server_dict(url)}}
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, "w") as f:
        json.dump(cfg, f)
    return path


def server_dict(url: str) -> dict[str, Any]:
    return {"type": "http", "url": url, "headers": {"Authorization": f"Bearer {TOKEN}"}}


def make_opts(mcp: Any, allowed: list[str], **kw: Any) -> ClaudeAgentOptions:
    env = {"ENABLE_CLAUDEAI_MCP_SERVERS": "false", "NO_PROXY": "localhost,127.0.0.1"}
    env |= kw.pop("env", {})
    return ClaudeAgentOptions(
        cwd=str(WORK),
        setting_sources=[],
        permission_mode="dontAsk",
        max_turns=kw.pop("max_turns", 6),
        tools=["Read"],
        allowed_tools=["Read", *allowed],
        disallowed_tools=[t for t in KNOWN_TOOLS if t != "Read"],
        mcp_servers=mcp,
        strict_mcp_config=True,
        env=env,
        extra_args={"debug": "mcp"} if os.environ.get("SPIKE_DEBUG") else {},
        **kw,
    )


def make_hook(log: list[dict[str, Any]]) -> dict[str, Any]:
    async def hook(input_data: Any, tool_use_id: str | None, context: Any) -> dict[str, Any]:
        name = input_data.get("tool_name")
        deny = str(name).endswith("hook-deny")
        log.append({"tool_name": name, "tool_input": input_data.get("tool_input"), "deny": deny})
        if not deny:
            return {}
        out = {"hookEventName": "PreToolUse", "permissionDecision": "deny"}
        return {"hookSpecificOutput": out | {"permissionDecisionReason": "tool_not_allowed"}}

    return {"PreToolUse": [HookMatcher(matcher=None, hooks=[hook], timeout=10)]}


def summarize(msgs: list[Any]) -> dict[str, Any]:
    out: list[Any] = []
    res: dict[str, Any] = {}
    for m in msgs:
        if isinstance(m, SystemMessage) and m.subtype == "init":
            d = m.data
            keys = ("tools", "mcp_servers", "claude_code_version", "permissionMode")
            out.append({"init": {k: d.get(k) for k in keys}})
        elif isinstance(m, AssistantMessage):
            out.append(
                [
                    {"tool_use": b.name, "input": b.input}
                    if isinstance(b, ToolUseBlock)
                    else {type(b).__name__: str(getattr(b, "text", ""))[:400]}
                    for b in m.content
                ]
            )
        elif isinstance(m, UserMessage) and isinstance(m.content, list):
            out.append(
                [
                    {"tool_result": b.content, "is_error": b.is_error}
                    for b in m.content
                    if isinstance(b, ToolResultBlock)
                ]
            )
        elif isinstance(m, ResultMessage):
            keys = ("subtype", "is_error", "num_turns", "result", "structured_output", "session_id")
            res = {k: getattr(m, k, None) for k in keys}
    return {"messages": out, "result": res}


async def _status_only(opts: ClaudeAgentOptions) -> dict[str, Any]:
    async with ClaudeSDKClient(options=opts) as client:
        for _ in range(20):  # chờ hết `pending`
            st = await client.get_mcp_status()
            if all(s["status"] != "pending" for s in st["mcpServers"]):
                break
            await asyncio.sleep(0.5)
        return {"mcp_status": st}


async def _run_query(opts: ClaudeAgentOptions, prompt: str) -> dict[str, Any]:
    API_CALLS["n"] += 1
    msgs: list[Any] = []
    async with ClaudeSDKClient(options=opts) as client:
        await client.query(prompt)
        msgs.extend([m async for m in client.receive_response()])
    return summarize(msgs)


async def run(srv: FakeMcp, opts: ClaudeAgentOptions, prompt: str | None = None) -> dict[str, Any]:
    stderr: list[str] = []
    opts.stderr = stderr.append
    watch = ArgvWatch()
    watch.start()
    t0 = time.time()
    try:
        rep = await (_run_query(opts, prompt) if prompt else _status_only(opts))
    except Exception as e:  # noqa: BLE001 — spike: ghi nguyên văn
        rep = {"exception": f"{type(e).__name__}: {str(e)[:600]}"}
    rep["elapsed_s"] = round(time.time() - t0, 1)
    await asyncio.sleep(0.3)
    watch.stop.set()
    watch.join()
    return rep | {"argv": watch.report(), "server_log": srv.log, "stderr": stderr[-10:]}


# ---------- ca không tốn API (connect + get_mcp_status, không query) ----------
async def c_init_file() -> dict[str, Any]:
    """#1 #2 #5 #8 #10: file 0600 + strict + env tắt connector."""
    srv = start_server()
    cfg = write_cfg(srv.url)
    mode = oct(cfg.stat().st_mode & 0o777)
    rep = await run(srv, make_opts(str(cfg), ["mcp__hub__translate-en"]))
    return {"cfg_mode": mode} | rep


async def c_init_argv() -> dict[str, Any]:
    """Đối chứng #10: dict → `--mcp-config <json>` trên argv."""
    srv = start_server()
    return await run(srv, make_opts({"hub": server_dict(srv.url)}, []))


async def c_init_discover() -> dict[str, Any]:
    """#8: server trả `server/discover` (2026-07-28) thay vì -32601."""
    srv = start_server("discover")
    return await run(srv, make_opts(str(write_cfg(srv.url, "jdisc")), []))


async def c_call_discover() -> dict[str, Any]:
    """#8: `tools/call` dưới chế độ 2026-07-28 (header, `_meta`)."""
    srv = start_server("discover")
    opts = make_opts(str(write_cfg(srv.url, "jcd")), ["mcp__hub__translate-en"], max_turns=3)
    prompt = "Gọi mcp__hub__translate-en với text='chào' đúng một lần rồi chép nguyên văn kết quả."
    return await run(srv, opts, prompt)


async def c_init_401() -> dict[str, Any]:
    srv = start_server("401")
    return await run(srv, make_opts(str(write_cfg(srv.url, "j401")), []))


async def c_init_down() -> dict[str, Any]:
    srv = start_server()
    url = srv.url
    srv.shutdown()
    srv.server_close()
    return await run(srv, make_opts(str(write_cfg(url, "jdown")), []))


# ---------- ca tốn API ----------
async def c_call() -> dict[str, Any]:
    """#3 #4 #5 #6: allowed có/thiếu, hook allow/deny, args tới server."""
    srv = start_server()
    log: list[dict[str, Any]] = []
    allowed = ["mcp__hub__translate-en", "mcp__hub__hook-deny"]
    opts = make_opts(str(write_cfg(srv.url, "jcall")), allowed, hooks=make_hook(log))
    prompt = (
        "Lần lượt gọi đúng ba tool, mỗi tool một lần, không gọi tool nào khác: "
        "1) mcp__hub__translate-en với text='xin chào thế giới'; "
        "2) mcp__hub__secret-tool với x=7; 3) mcp__hub__hook-deny với y=9. "
        "Rồi trả lời ngắn: kết quả/thông báo lỗi nguyên văn của từng tool."
    )
    return await run(srv, opts, prompt) | {"hook_log": log}


async def c_confirm() -> dict[str, Any]:
    """#7: isError + content[0] JSON + content[1] + structuredContent (marker)."""
    srv = start_server()
    opts = make_opts(
        str(write_cfg(srv.url, "jconf")),
        ["mcp__hub__confirm-send"],
        system_prompt="Bạn là trợ lý công việc." + MCP_BLOCK,
        output_format={"type": "json_schema", "schema": FLAT_SCHEMA},
    )
    prompt = (
        "Gửi email báo cáo tuần tới boss@example.com bằng tool mcp__hub__confirm-send. "
        "Trong trường `text` chép nguyên văn MỌI trường và giá trị bạn thấy trong kết quả tool "
        "(kể cả trường lạ như marker nếu có)."
    )
    return await run(srv, opts, prompt)


async def c_timeout() -> dict[str, Any]:
    """Timeout tool: server ngủ SLOW_S giây, CLI `MCP_TOOL_TIMEOUT`=4000 ms."""
    srv = start_server()
    opts = make_opts(
        str(write_cfg(srv.url, "jslow")),
        ["mcp__hub__slow-tool"],
        env={"MCP_TOOL_TIMEOUT": "4000"},
        max_turns=3,
    )
    prompt = (
        "Gọi mcp__hub__slow-tool với n=1 đúng một lần (không thử lại), "
        "rồi chép nguyên văn kết quả/lỗi."
    )
    return await run(srv, opts, prompt)


def token_leaks() -> dict[str, Any]:
    """Token có nằm trong ~/.claude (transcript, debug) không."""
    hits = []
    for p in (Path(REAL_HOME) / ".claude").rglob("*"):
        try:
            if (
                p.is_file()
                and p.stat().st_size < 50_000_000
                and TOKEN in p.read_text(errors="ignore")
            ):
                hits.append(str(p))
        except OSError:
            continue
    return {"files_with_token": hits}


CASES = {
    "init-file": c_init_file,
    "init-argv": c_init_argv,
    "init-discover": c_init_discover,
    "call-discover": c_call_discover,
    "init-401": c_init_401,
    "init-down": c_init_down,
    "call": c_call,
    "confirm": c_confirm,
    "timeout": c_timeout,
}


async def main(names: list[str]) -> None:
    for d in (WORK, OUT):
        d.mkdir(parents=True, exist_ok=True)
    for name in names:
        text = mask(json.dumps(await CASES[name](), ensure_ascii=False, indent=1, default=str))
        (OUT / f"{name}.json").write_text(text)
        print(f"===== {name} =====\n{text}")
    print(mask(json.dumps(token_leaks())))
    for p in CFG_DIR.glob("*.json"):
        p.unlink()
    print(f"API calls: {API_CALLS['n']}", file=sys.stderr)


if __name__ == "__main__":
    asyncio.run(main(sys.argv[1:] or list(CASES)))
