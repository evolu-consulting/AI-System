# ruff: noqa: T201 — spike in kết quả ra stdout
"""PY-S2 (H2b) · WRK-FR-03 · WRK-FR-17 — spike stream, Claude CLI thật trong WSL (ngoài package/
test); 9 điểm `docs/specs/H2b-routing/plan-runtime.md` §2. Dùng **đúng** `build_options` của `src/`
+ `include_partial_messages=True`; ghi message/`StreamEvent` (kiểu, khoá, độ dài — không nội dung)
vào JSONL. Ca: `orch` (1 lượt) · `agent` (`output_format`, 2 lượt) · `agent-kill` (+ `Read` + MCP
giả `mcp_fake.py`, kill con sau khối `StructuredOutput` lượt 2). Cách chạy: README; kết quả
`docs/specs/H2b-routing/spike-stream.md`.
"""

from __future__ import annotations

import asyncio
import contextlib
import json
import os
import signal
import sys
import time
from pathlib import Path
from typing import Any

from claude_agent_sdk import (
    AssistantMessage,
    ClaudeSDKClient,
    HookMatcher,
    RateLimitEvent,
    ResultMessage,
    StreamEvent,
    SystemMessage,
    ToolUseBlock,
)
from mcp_fake import TOKEN, start_server

from agent_runtime.contracts.hub import JobPayload1
from agent_runtime.providers.base import ProviderJob
from agent_runtime.providers.claude.options import build_options

ROOT = Path(os.environ.get("SPIKE_ROOT", "/tmp/spike-stream"))
WORK, OUT, CFG_DIR = ROOT / "work", ROOT / "out", ROOT / ".mcp"
REAL_HOME = os.environ.get("HOME", "/home/worker")
U = "00000000-0000-4000-8000-000000000001"
# Hub `orchestrator.prompt.ts` FORMAT_BLOCK nguyên văn (schema = z.toJSONSchema của Decision).


def _obj(**props: Any) -> dict[str, Any]:
    req = list(props)
    return {"type": "object", "properties": props, "required": req, "additionalProperties": False}


def _s(**kw: Any) -> dict[str, Any]:
    return {"type": "string", **kw}


DECISION_SCHEMA = {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "oneOf": [
        _obj(
            decision=_s(const="delegate"),
            agent=_s(pattern="^[a-z][a-z0-9-]{1,47}$"),
            task=_s(minLength=1, maxLength=8000),
        ),
        _obj(decision=_s(const="answer"), text=_s(minLength=1, maxLength=64000)),
        _obj(
            decision=_s(const="ask"),
            question=_s(minLength=1, maxLength=2000),
            choices={"maxItems": 6, "type": "array", "items": _s(minLength=1, maxLength=200)},
        ),
    ],
}
ORCH_FORMAT = (
    "Chỉ trả về MỘT object JSON theo JSON Schema sau, không chữ khác, không code fence: "
    + json.dumps(DECISION_SCHEMA, ensure_ascii=False, separators=(",", ":"))
    + ". `delegate` chỉ key trong <agents>; không agent phù hợp → `answer`; mơ hồ → `ask`; "
    "`waiting_for` khác null và tin là câu trả lời → `delegate` agent đó."
)
ASK_LONG = "khoảng 800 ký tự tiếng Việt, 3 đoạn"


def payload(output: str, **over: Any) -> JobPayload1:
    data: dict[str, Any] = {
        "v": 1, "type": "agent.cli", "runtime": "agentic-cli",
        "job_id": "c3000000-0000-4000-8000-0000000000bb",
        "run_id": U, "step_id": U, "tenant_id": U, "user_id": U, "conversation_id": U, "flow_id": U,
        "feature_id": None, "agent_type_key": None, "mcp": None,
        "agent": {"id": U, "key": "writer", "role": "agent"},
        "provider_key": "claude-sub",
        "model": None,  # profile seed `claude-sub-1`: model null (mặc định CLI)
        "step_index": 0, "max_turns": 1,
        "profile_steps": [{"provider_key": "claude-sub", "model": None, "on": []}],
        "system_prompt": "Bạn là agent viết.", "prompt": "ok", "history": [],
        "use_session": False, "allowed_tools": [], "output": output, "timeout_s": 600,
    }  # fmt: skip
    data.update(over)
    return JobPayload1.model_validate(data)


def options(p: JobPayload1) -> Any:
    job = ProviderJob(payload=p, work_dir=str(WORK), forbidden_roots=[REAL_HOME, "/mnt"])
    opts = build_options(job)
    opts.include_partial_messages = os.environ.get("SPIKE_NO_PARTIAL") != "1"  # đối chứng #6
    return opts


class Rec:  # ghi sự kiện (kiểu/khoá/độ dài) + gom chữ stream trong bộ nhớ để so sánh
    def __init__(self, name: str) -> None:
        self.t0 = time.monotonic()
        self.f = (OUT / f"{name}.jsonl").open("w")
        self.blocks: dict[tuple[str | None, int], dict[str, Any]] = {}
        self.deltas, self.asst, self.stream_usage, self.ratelimit = [], [], [], []
        self.sessions, self.parent_ids = set(), set()
        self.kinds: dict[str, int] = {}
        self.init: dict[str, Any] = {}
        self.msg_id: str | None = None
        self.result: ResultMessage | None = None
        self.t_result: float | None = None

    def ms(self) -> float:
        return round((time.monotonic() - self.t0) * 1000, 1)

    def log(self, rec: dict[str, Any]) -> None:
        self.f.write(json.dumps(rec, ensure_ascii=False, default=str) + "\n")

    def on(self, m: Any) -> None:
        kind = type(m).__name__
        self.kinds[kind] = self.kinds.get(kind, 0) + 1
        sid = getattr(m, "session_id", None) or (
            m.data.get("session_id") if isinstance(m, SystemMessage) else None
        )
        if sid:
            self.sessions.add(sid)
        if getattr(m, "parent_tool_use_id", None):
            self.parent_ids.add(m.parent_tool_use_id)
        rec: dict[str, Any] = {"t": self.ms(), "kind": kind}
        if isinstance(m, StreamEvent):
            rec |= self._stream(m.event)
        elif isinstance(m, AssistantMessage):
            blocks = [
                f"tool_use:{b.name}" if isinstance(b, ToolUseBlock) else type(b).__name__
                for b in m.content
            ]
            a = {"message_id": m.message_id, "usage": m.usage, "blocks": blocks, "t": rec["t"]}
            self.asst.append(a)
            rec |= a
        elif isinstance(m, SystemMessage):
            rec |= {"subtype": m.subtype, "keys": sorted(m.data)}
            if m.subtype == "init":
                self.init = {k: m.data.get(k) for k in ("model", "tools", "mcp_servers")}
                rec |= self.init
        elif isinstance(m, RateLimitEvent):
            info = m.rate_limit_info
            self.ratelimit.append({"keys": sorted(vars(info)) if hasattr(info, "__dict__") else []})
            rec |= {"info_type": type(info).__name__}
        elif isinstance(m, ResultMessage):
            self.result, self.t_result = m, rec["t"]
            so = m.structured_output
            rec |= {
                "subtype": m.subtype, "is_error": m.is_error, "num_turns": m.num_turns,
                "usage": m.usage, "result_len": len(m.result or ""),
                "structured_keys": list(so) if isinstance(so, dict) else None,
            }  # fmt: skip
        self.log(rec)

    def _stream(self, ev: dict[str, Any]) -> dict[str, Any]:
        et = ev.get("type")
        out: dict[str, Any] = {"ev": et}
        if et == "message_start":
            msg = ev.get("message") or {}
            self.msg_id = msg.get("id")
            out |= {"message_id": self.msg_id, "usage": msg.get("usage")}
            self.stream_usage.append({"at": "start", "id": self.msg_id, "u": msg.get("usage")})
        elif et == "message_delta":
            out |= {"usage": ev.get("usage"), "stop": (ev.get("delta") or {}).get("stop_reason")}
            self.stream_usage.append({"at": "delta", "id": self.msg_id, "u": ev.get("usage")})
        elif et == "content_block_start":
            cb = ev.get("content_block") or {}
            key = (self.msg_id, ev.get("index", -1))
            self.blocks[key] = {"type": cb.get("type"), "name": cb.get("name"), "buf": []}
            out |= {"index": key[1], "block": cb.get("type"), "name": cb.get("name")}
        elif et == "content_block_delta":
            d = ev.get("delta") or {}
            piece = d.get("text") or d.get("partial_json") or ""
            blk = self.blocks.get((self.msg_id, ev.get("index", -1)))
            if blk is not None:
                blk["buf"].append(piece)
            self.deltas.append({"t": self.ms(), "type": d.get("type"), "n": len(piece)})
            out |= {"index": ev.get("index"), "delta": d.get("type"), "n": len(piece)}
        elif et == "content_block_stop":
            out |= {"index": ev.get("index")}
        return out


def key_order(s: str, keys: tuple[str, ...]) -> dict[str, Any]:
    """Vị trí khoá cấp 1 trong chuỗi JSON đã nối (đủ cho spike) + phần trước `{`."""
    brace = s.find("{")
    pos = {k: s.find(f'"{k}"') for k in keys}
    seen = sorted((p, k) for k, p in pos.items() if p >= 0)
    return {"prefix_before_brace": s[: max(brace, 0)][:40], "order": [k for _, k in seen]}


def analyze(r: Rec) -> dict[str, Any]:
    res = r.result
    texts = ["".join(b["buf"]) for b in r.blocks.values() if b["type"] == "text"]
    so_blocks = [
        "".join(b["buf"])
        for b in r.blocks.values()
        if b["type"] == "tool_use" and b["name"] == "StructuredOutput"
    ]
    out: dict[str, Any] = {
        "kinds": r.kinds,
        "blocks": [{"type": b["type"], "name": b["name"]} for b in r.blocks.values()],
        "sessions": len(r.sessions), "parent_tool_use_ids": len(r.parent_ids),
        "rate_limit_events": r.ratelimit, "init": r.init,
    }  # fmt: skip
    ds = [d for d in r.deltas if d["type"] in ("text_delta", "input_json_delta")]
    if ds:
        gaps = [round(b["t"] - a["t"], 1) for a, b in zip(ds, ds[1:], strict=False)]
        sizes = [d["n"] for d in ds]
        out["delta"] = {
            "count": len(ds), "types": sorted({d["type"] for d in ds}),
            "first_ms": ds[0]["t"], "last_ms": ds[-1]["t"], "result_ms": r.t_result,
            "size_avg": round(sum(sizes) / len(sizes), 1), "size_max": max(sizes),
            "gap_avg_ms": round(sum(gaps) / len(gaps), 1) if gaps else None,
            "gap_max_ms": max(gaps) if gaps else None,
        }  # fmt: skip
    if texts:
        joined = "".join(texts)
        out["text_stream"] = {"len": len(joined), **key_order(joined, ("decision", "text"))}
        out["text_eq_result"] = res is not None and joined == res.result
        out["text_parses_json"] = _loads(joined.strip()) is not None
    for i, s in enumerate(so_blocks):
        out[f"structured_stream_{i}"] = {
            "len": len(s),
            **key_order(s, ("status", "text", "missing", "question", "choices")),
            "eq_structured_output": res is not None and _loads(s) == res.structured_output,
        }
    ids = [a["message_id"] for a in r.asst]
    per_id: dict[str, Any] = {}
    for a in r.asst:
        per_id.setdefault(a["message_id"], []).append(a["usage"])
    out["assistant_usage"] = {
        "messages": len(ids), "distinct_ids": len(set(ids)),
        "has_usage": all(a["usage"] for a in r.asst),
        "repeated_same_usage": all(len({json.dumps(u) for u in us}) == 1 for us in per_id.values()),
        "sum_dedup": _sum([us[-1] for us in per_id.values()]),
    }  # fmt: skip
    out["stream_usage"] = r.stream_usage
    if res is not None:
        out["result"] = {
            "subtype": res.subtype, "is_error": res.is_error, "num_turns": res.num_turns,
            "usage": {k: (res.usage or {}).get(k) for k in _UK},
            "session_matches": res.session_id in r.sessions, "result_len": len(res.result or ""),
            "structured_keys": list(res.structured_output or {}) or None,
        }  # fmt: skip
    return out


def _loads(s: str) -> Any:
    try:
        return json.loads(s)
    except ValueError:
        return None


_UK = ("input_tokens", "output_tokens", "cache_read_input_tokens", "cache_creation_input_tokens")


def _sum(us: list[dict[str, Any] | None]) -> dict[str, int]:
    return {k: sum(int((u or {}).get(k) or 0) for u in us) for k in _UK}


def kill_children() -> list[int]:
    """Kill mọi tiến trình con cháu (CLI) — như Runtime kill nhóm job host."""
    me, table = os.getpid(), {}
    for p in (int(x) for x in os.listdir("/proc") if x.isdigit()):
        with contextlib.suppress(OSError):
            raw = Path(f"/proc/{p}/stat").read_text()
            table[p] = int(raw[raw.rindex(")") + 2 :].split()[1])
    desc, frontier = set(), {me}
    while frontier:
        frontier = {p for p, pp in table.items() if pp in frontier and p not in desc}
        desc |= frontier
    for p in desc:
        with contextlib.suppress(OSError):
            os.kill(p, signal.SIGKILL)
    return sorted(desc)


def wrap_hook(opts: Any, log: list[str]) -> None:
    [matcher] = opts.hooks["PreToolUse"]
    [real] = matcher.hooks

    async def hook(input_data: Any, tool_use_id: Any, context: Any) -> Any:
        out = await real(input_data, tool_use_id, context)
        log.append(f"{input_data.get('tool_name')}:{'deny' if out else 'allow'}")
        return out

    opts.hooks = {"PreToolUse": [HookMatcher(matcher=None, hooks=[hook], timeout=10)]}


async def drive(name: str, opts: Any, prompt: str, kill_on_so: bool = False) -> dict[str, Any]:
    r, hooks, extra = Rec(name), [], {}
    wrap_hook(opts, hooks)
    opts.stderr = lambda _line: None
    try:
        async with ClaudeSDKClient(options=opts) as client:
            if opts.mcp_servers:
                for _ in range(20):  # chờ hết `pending`; S4 H2a: chỉ lấy status
                    st = await client.get_mcp_status()
                    if all(s.get("status") != "pending" for s in st.get("mcpServers") or []):
                        break
                    await asyncio.sleep(0.5)
                extra["mcp"] = [
                    {"name": s.get("name"), "status": s.get("status")}
                    for s in (st.get("mcpServers") or [])
                ]
            r.t0 = time.monotonic()
            await client.query(prompt)
            async for m in client.receive_response():
                r.on(m)
                if kill_on_so and _is_so(m):
                    extra["usage_before_kill"] = _sum(
                        list({a["message_id"]: a["usage"] for a in r.asst}.values())
                    )
                    extra["killed_pids"] = len(kill_children())
                    extra["killed_at_ms"] = r.ms()
    except Exception as e:  # noqa: BLE001 — spike ghi lỗi sau kill
        extra["error"] = f"{type(e).__name__}: {str(e)[:200]}"
    finally:
        r.f.close()
    return analyze(r) | extra | {"hooks": hooks}


def _is_so(m: Any) -> bool:
    return isinstance(m, AssistantMessage) and any(
        isinstance(b, ToolUseBlock) and b.name == "StructuredOutput" for b in m.content
    )


async def c_orch() -> dict[str, Any]:
    """#1, #4, #5 (text), #6, #7, #8 (session/RateLimit/Result) — Orchestrator, 1 lượt."""
    agents = [{"key": "coder", "description": "Viết và sửa code Python"}]
    msg = f"Giải thích vì sao bầu trời ban ngày có màu xanh ({ASK_LONG})."
    hint = {"last_agent": None, "waiting_for": None}
    parts = {"agents": agents, "flow_hint": hint, "history": [], "steps": [], "steps_left": 4}
    parts["message"] = msg  # như `orchestratorPrompt` (Hub)
    js = json.JSONEncoder(ensure_ascii=False, separators=(",", ":")).encode
    prompt = "\n".join(f"<{k}>\n{js(v)}\n</{k}>" for k, v in parts.items())
    p = payload("text", system_prompt=f"Bạn là Orchestrator.\n\n{ORCH_FORMAT}")
    return await drive("orch", options(p), prompt)


async def c_agent() -> dict[str, Any]:
    """#2, #3 (lần 1), #5 (json), #6, #8 (hook StructuredOutput) — agent, 2 lượt."""
    prompt = f"Không dùng tool. Viết giới thiệu về sông Mekong ({ASK_LONG}). Trả status done."
    return await drive("agent", options(payload("agent_result", prompt=prompt)), prompt)


async def c_agent_kill() -> dict[str, Any]:
    """#3 (lần 2), #8 (MCP + hook Read), #9 (kill sau khối StructuredOutput lượt 2)."""
    (WORK / "notes.txt").write_text("Hội An: phố cổ, đèn lồng, sông Thu Bồn, chùa Cầu.\n")
    prompt = (
        f"Dùng Read đọc tệp notes.txt rồi viết bài giới thiệu dựa trên ghi chú ({ASK_LONG}). "
        "Không dùng tool khác. Trả status done."
    )
    p = payload("agent_result", prompt=prompt, allowed_tools=["Read"], max_turns=3)
    opts = options(p)
    srv = start_server()
    CFG_DIR.mkdir(mode=0o700, parents=True, exist_ok=True)
    cfg = CFG_DIR / "job.json"
    cfg.unlink(missing_ok=True)
    fd = os.open(cfg, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, "w") as f:
        auth = {"Authorization": f"Bearer {TOKEN}"}
        json.dump({"mcpServers": {"hub": {"type": "http", "url": srv.url, "headers": auth}}}, f)
    opts.mcp_servers = str(cfg)
    opts.allowed_tools = [*opts.allowed_tools, "mcp__hub__translate-en"]
    opts.env = {**opts.env, "NO_PROXY": "localhost,127.0.0.1"}
    try:
        rep = await drive("agent-kill", opts, prompt, kill_on_so=True)
    finally:
        srv.shutdown()
    rep["mcp_requests"] = sorted({str((x.get("body") or {}).get("method")) for x in srv.log})
    return rep


CASES = {"orch": c_orch, "agent": c_agent, "agent-kill": c_agent_kill}


async def main(names: list[str]) -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    WORK.mkdir(parents=True, exist_ok=True)
    for name in names:
        rep = await CASES[name]()
        text = json.dumps(rep, ensure_ascii=False, indent=1, default=str).replace(TOKEN, "***")
        (OUT / f"{name}.json").write_text(text)
        print(f"===== {name} =====\n{text}")


if __name__ == "__main__":
    asyncio.run(main(sys.argv[1:] or list(CASES)))
