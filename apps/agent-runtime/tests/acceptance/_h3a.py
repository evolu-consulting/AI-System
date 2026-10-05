"""WRK-FR-22 · WRK-FR-15 · hạ tầng int H3a (test-plan H3a §2.1, test-plan-py §2). Không chứa test.

Hộp đen: `hub.provider_state` (owner), file chỉ thị probe `fake-cli` (`AGENT_RT_FAKE_PROBE_FILE`,
plan-runtime §5) + file đếm `<file>.calls`, log JSON stdout của Runtime (mẫu `startup_int_test`),
`/proc` (con probe). Không sửa `_rt.py`/`_proc.py` (khoá H1).
"""

from __future__ import annotations

import json
from collections.abc import AsyncGenerator, Callable
from contextlib import asynccontextmanager
from datetime import datetime
from pathlib import Path
from typing import Any

from tests.acceptance._proc import Runtime
from tests.acceptance._rt import FAKE, cmdline, owner_db_url, pg_connect, wait_until
from tests.acceptance.conftest import Ctx

WAIT_S = 15.0  # test-plan-py §2: chờ theo điều kiện ≤ 15 s
WARN = ("warn", "warning")
Row = dict[str, Any]


def probe_file(ctx: Ctx) -> Path:
    return ctx.box.root / "probe.txt"


def write_probe(ctx: Ctx, text: str) -> None:
    probe_file(ctx).write_text(f"{text}\n")


def calls(ctx: Ctx) -> list[str]:
    """Dòng `auth`/`turn` cha ghi vào `<file>.calls` (vắng ⇒ [])."""
    f = Path(f"{probe_file(ctx)}.calls")
    return [x.strip() for x in f.read_text().splitlines() if x.strip()] if f.exists() else []


def probe_env(probe_s: int, timeout_s: int = 10, **extra: str) -> dict[str, str]:
    """Env probe biên dev (PL6, N1): timeout mặc định 10 s, chỉ ca treo đặt 2."""
    return {
        "AGENT_RT_PROBE_S": str(probe_s),
        "AGENT_RT_PROBE_LOGGED_OUT_S": "1",
        "AGENT_RT_PROBE_TIMEOUT_S": str(timeout_s),
        **extra,
    }


def start(
    ctx: Ctx, probe_s: int, worker: str = "qc-1", timeout_s: int = 10, **extra: str
) -> Runtime:
    env = probe_env(probe_s, timeout_s, **extra)
    env["AGENT_RT_FAKE_PROBE_FILE"] = str(probe_file(ctx))
    return ctx.runtime(worker, **env)


async def state(ctx: Ctx) -> dict[str, Any] | None:
    row = await ctx.conn.fetchrow("select * from hub.provider_state where provider_key = $1", FAKE)
    return dict(row) if row else None


async def set_state(ctx: Ctx, status: str, **cols: str) -> None:
    """UPSERT hàng `fake-cli`; `cols` = biểu thức SQL (vd `last_ok_at="now()"`)."""
    names = ["status", *cols]
    vals = ["$2", *cols.values()]
    sets = ", ".join(f"{n} = excluded.{n}" for n in names)
    await ctx.conn.execute(
        f"""insert into hub.provider_state (provider_key, {", ".join(names)})
            values ($1, {", ".join(vals)}) on conflict (provider_key) do update set {sets}""",
        FAKE,
        status,
    )


async def db_now(ctx: Ctx) -> datetime:
    return await ctx.conn.fetchval("select now()")


async def until_state(
    ctx: Ctx, what: str, ok: Callable[[Row], bool], limit_s: float = WAIT_S
) -> Row:
    """Chờ hàng `provider_state` thoả `ok(row)`."""

    async def cond() -> dict[str, Any] | None:
        row = await state(ctx)
        return row if row is not None and ok(row) else None

    return await wait_until(cond, limit_s, f"provider_state {what}", ctx.alive)


async def until_probed_after(ctx: Ctx, mark: datetime, limit_s: float = WAIT_S) -> dict[str, Any]:
    """Mốc DB (test-plan §1 "Thời gian"): `last_probe_at ≥ mark`."""
    return await until_state(
        ctx,
        f"last_probe_at ≥ {mark}",
        lambda r: r["last_probe_at"] is not None and r["last_probe_at"] >= mark,
        limit_s,
    )


async def until_calls(ctx: Ctx, step: str, n: int = 1, limit_s: float = WAIT_S) -> list[str]:
    async def cond() -> list[str] | None:
        got = calls(ctx)
        return got if got.count(step) >= n else None

    return await wait_until(cond, limit_s, f".calls có ≥ {n} '{step}'", ctx.alive)


def logs(rt: Runtime, event: str | None = None) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for line in rt.stdout().splitlines():
        if line.startswith("{"):
            try:
                out.append(json.loads(line))
            except ValueError:
                continue
    return [x for x in out if event is None or x.get("event") == event]


async def until_log(
    ctx: Ctx, rt: Runtime, event: str, n: int = 1, limit_s: float = WAIT_S, **fields: str
) -> list[dict[str, Any]]:
    """F6: chờ theo dòng log cần có (không đọc một lần rồi kết luận)."""

    async def cond() -> list[dict[str, Any]] | None:
        want = {k.rstrip("_"): v for k, v in fields.items()}  # `from_` ⇒ `from`
        got = [x for x in logs(rt, event) if all(x.get(k) == v for k, v in want.items())]
        return got if len(got) >= n else None

    return await wait_until(cond, limit_s, f"log {event} {fields} ×{n}", ctx.alive)


async def until_ready(ctx: Ctx, limit_s: float = WAIT_S) -> None:
    """Mốc sẵn sàng = manifest `agent_types` (mẫu `startup_int_test`)."""

    async def cond() -> bool:
        return bool(await ctx.conn.fetchval("select count(*) from hub.agent_types"))

    await wait_until(cond, limit_s, "manifest agent_types", ctx.alive)


def _ppid(pid: int) -> int | None:
    try:
        raw = Path(f"/proc/{pid}/stat").read_text()
    except OSError:
        return None
    rest = raw[raw.rfind(")") + 2 :].split()
    return None if rest[0] == "Z" else int(rest[1])


def probe_children(rt: Runtime) -> list[int]:
    """Pid con probe (`…probe.child`) do Runtime `rt` spawn (ppid = pid Runtime)."""
    out: list[int] = []
    for p in Path("/proc").iterdir():
        if (
            p.name.isdigit()
            and _ppid(int(p.name)) == rt.proc.pid
            and "probe" in cmdline(int(p.name))
        ):
            out.append(int(p.name))
    return out


def alive(pid: int) -> bool:
    return _ppid(pid) is not None


@asynccontextmanager
async def owner_conn() -> AsyncGenerator[Any]:
    """Kết nối owner thứ hai (khoá/transaction riêng, không đóng băng `now()` của `ctx.conn`)."""
    conn = await pg_connect(owner_db_url())
    try:
        yield conn
    finally:
        await conn.close()


async def advisory_probe_locks(ctx: Ctx) -> int:
    """Khoá phiên `hub.provider.probe` (plan-db §3, 2 khoá int4 ⇒ `objsubid = 2`)."""
    return await ctx.conn.fetchval(
        """select count(*) from pg_locks where locktype = 'advisory' and objsubid = 2
             and classid::bigint = ((hashtext('hub.provider.probe')::bigint + 4294967296)
                                    % 4294967296)"""
    )
