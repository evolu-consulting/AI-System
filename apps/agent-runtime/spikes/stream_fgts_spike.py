# ruff: noqa: T201 — spike in kết quả ra stdout
"""Smoke H2b F1 · WRK-FR-03 — delta agent `StructuredOutput` dồn cục: agent như `assistant` seed
(`Read`/`Grep`, max_turns 30), `build_options` của `src/`, chạy `env -i` kèm đúng `CLI_QUIET_ENV`
của job host. `SPIKE_FGTS=0` bỏ / `=1` đặt `CLAUDE_CODE_ENABLE_FINE_GRAINED_TOOL_STREAMING` trong
`opts.env` ⇒ so thời điểm `input_json_delta` (1 lời gọi API, `num_turns` 2 mỗi lần). Kết quả:
`docs/specs/H2b-routing/smoke.md` "Điều tra delta agent". Dùng lại `stream_spike.py`.
"""

from __future__ import annotations

import asyncio
import json
import os
from pathlib import Path
from typing import Any

from stream_spike import ASK_LONG, OUT, WORK, drive, options, payload

FGTS = "CLAUDE_CODE_ENABLE_FINE_GRAINED_TOOL_STREAMING"
QUIET_KEYS = ("CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC", "DISABLE_TELEMETRY")


def timing(path: Path) -> dict[str, Any]:
    """Phân bố thời điểm `input_json_delta`: số mảnh trong N ms cuối, khoảng lặng lớn nhất."""
    rows = [json.loads(line) for line in path.read_text().splitlines()]
    ts = [r["t"] for r in rows if r.get("delta") == "input_json_delta"]
    if not ts:
        return {}
    gaps = [b - a for a, b in zip(ts, ts[1:], strict=False)]
    return {
        "count": len(ts), "first_ms": ts[0], "last_ms": ts[-1],
        "in_last_100ms": sum(1 for t in ts if t >= ts[-1] - 100),
        "gap_max_ms": round(max(gaps), 1) if gaps else None,
    }  # fmt: skip


async def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    WORK.mkdir(parents=True, exist_ok=True)
    fg = os.environ.get("SPIKE_FGTS", "0")
    prompt = f"Viết giới thiệu về sông Mekong ({ASK_LONG}). Không cần đọc tệp. Trả status done."
    sp = "Bạn là trợ lý hữu ích. Trả lời ngắn gọn, chính xác, bằng ngôn ngữ của người dùng."
    tools = ["Read", "Grep"]
    p = payload("agent_result", prompt=prompt, system_prompt=sp, allowed_tools=tools, max_turns=30)
    opts = options(p)
    env = {k: v for k, v in opts.env.items() if k != FGTS}
    if fg == "1":
        env[FGTS] = "1"
    opts.env = env
    name = f"agent-tools-fgts{fg}"
    rep = await drive(name, opts, prompt)
    rep |= {"env_fgts": env.get(FGTS), "quiet_env": {k: os.environ.get(k) for k in QUIET_KEYS}}
    rep["so_timing"] = timing(OUT / f"{name}.jsonl")
    text = json.dumps(rep, ensure_ascii=False, indent=1, default=str)
    (OUT / f"{name}.json").write_text(text)
    print(text)


if __name__ == "__main__":
    asyncio.run(main())
