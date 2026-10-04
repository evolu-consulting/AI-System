"""WRK-BR-07 · WRK-BR-02 · WRK-FR-11 · WRK-FR-12 · AC-W11 · H1-R21 · P17–P19: sandbox qua
`fake-cli`.

`#fake:read=` / `#fake:tool=` đi qua đúng hook `PreToolUse` thật (plan-runtime-fake §7, Q-T3).
`HOME` = thư mục tạm có file mồi chứa canary (Q-T4) — không bao giờ đụng `~/.claude` thật.
"""

from __future__ import annotations

import json
import os
from pathlib import Path

import pytest

from tests.acceptance._proc import CANARY, SECRET_ENV
from tests.acceptance._rt import BETA, agent_text, events, proc_environ
from tests.acceptance.conftest import Ctx

pytestmark = pytest.mark.int

OTHER_JOB = "c3000000-0000-4000-8000-0000000000aa"
FORBIDDEN_PREFIX = ("AGENT_RT_", "DATABASE_URL", "JWT_", "HUB_")
FORBIDDEN_EXACT = {"REDIS_URL", "ANTHROPIC_API_KEY"}


def read_targets(ctx: Ctx) -> dict[str, str]:
    """Đường dẫn bị chặn (P17). Thư mục job khác + symlink trong đó tạo trước khi chạy."""
    other = ctx.box.work / OTHER_JOB
    other.mkdir()
    (other / "secret.txt").write_text(CANARY)
    os.symlink(ctx.box.home / ".claude" / ".credentials.json", other / "cred-link")
    return {
        "claude": f"{ctx.box.home}/.claude/.credentials.json",
        "dotdot_home": "../../home/.claude/.credentials.json",
        "codex": f"{ctx.box.home}/.codex/x",
        "mnt": "/mnt/c/Users/x/.ssh/id_rsa",
        "other_job": f"../{OTHER_JOB}/secret.txt",
        "symlink": f"../{OTHER_JOB}/cred-link",
    }


def all_logs(ctx: Ctx) -> str:
    parts = [p.read_text(errors="replace") for p in ctx.box.logs.rglob("*") if p.is_file()]
    parts += [rt.stdout() + rt.err.read_text(errors="replace") for rt in ctx.runtimes]
    return "\n".join(parts)


@pytest.mark.parametrize(
    "target", ["claude", "dotdot_home", "codex", "mnt", "other_job", "symlink"]
)
async def test_wrk_ac_w11_read_outside_denied(ctx: Ctx, target: str) -> None:
    """AC-W11 · `#fake:read=<path>` ngoài `work/<job_id>` → hook từ chối (`done{text:"denied"}`);
    canary không có trong `result`, Redis `run:<id>`, file log, stdout/stderr Runtime."""
    path = read_targets(ctx)[target]
    job = await ctx.job(tenant=BETA, prompt=f"#fake:read={path}")
    ctx.runtime()
    row = await ctx.until_status(job, ["succeeded"], 15)
    assert agent_text(row) == "denied"
    assert CANARY not in json.dumps(row["result"], default=str)
    assert CANARY not in json.dumps(await events(ctx.rd, job.run_id))
    assert CANARY not in all_logs(ctx)


async def test_wrk_br_02_job_host_env_and_cwd(ctx: Ctx) -> None:
    """BR-02 · job host: khoá env ∩ {`AGENT_RT_*`, `REDIS_URL`, `DATABASE_URL*`,
    `ANTHROPIC_API_KEY`,
    `JWT_*`, `HUB_*`} = ∅ (đọc `/proc/<pgid>/environ`); `cwd` = `work/<job_id>`; `HOME` = HOME
    cha."""
    job = await ctx.job(tenant=BETA, prompt="#fake:sleep=30")
    ctx.runtime()
    pgid = int((await ctx.until_running(job))["pgid"])
    env = proc_environ(pgid)
    bad = {k for k in env if k in FORBIDDEN_EXACT or k.startswith(FORBIDDEN_PREFIX)}
    assert bad == set()
    assert Path(os.readlink(f"/proc/{pgid}/cwd")) == ctx.box.work / job.id
    assert env.get("HOME") == str(ctx.box.home)
    assert not set(SECRET_ENV.values()) & set(env.values())


async def test_wrk_br_02_fake_env_directive(ctx: Ctx) -> None:
    """BR-02 · `#fake:env` (provider thấy env gì) → không khoá secret nào trong danh sách trả về."""
    job = await ctx.job(tenant=BETA, prompt="#fake:env")
    ctx.runtime()
    text = agent_text(await ctx.until_status(job, ["succeeded"], 15))
    assert "HOME" in text and "PATH" in text
    for k in [*FORBIDDEN_EXACT, *FORBIDDEN_PREFIX, *SECRET_ENV]:
        assert k not in text


@pytest.mark.parametrize(
    ("tool", "allowed", "want"),
    [
        ("Bash", ["Read", "Grep", "Glob"], "denied:tool_not_allowed"),
        ("Agent", ["Read", "Grep", "Glob"], "denied:tool_not_allowed"),
        ("Grep", ["Read"], "denied:tool_not_allowed"),
        ("Read", ["Read"], "allowed"),
    ],
)
async def test_wrk_fr_12_tool_not_allowed(
    ctx: Ctx, tool: str, allowed: list[str], want: str
) -> None:
    """FR-12 · `#fake:tool=<name>` qua hook thật: tool ngoài `allowed_tools`, `Bash`, `Agent` →
    `denied:tool_not_allowed`; tool trong danh sách (không đường dẫn) → `allowed` (đối chứng)."""
    job = await ctx.job(tenant=BETA, prompt=f"#fake:tool={tool}", allowed_tools=allowed)
    ctx.runtime()
    assert agent_text(await ctx.until_status(job, ["succeeded"], 15)) == want
