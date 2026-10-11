"""P-b · PF-S2 · C21 · Chỉ thị `fake-cli` cho nguồn (test-plan §2): `#fake:read` (dạng MỚI cho path
`sources/…`: `read <path> <sha256|ENOENT|DENIED>` mỗi dòng — giữ H2c cho path khác), `#fake:tree`,
`#fake:scan`, `#fake:obey`. Đi qua ĐÚNG đường quyền (hook `PreToolUse` + `allowed_tools`). Chỉ fs +
sự kiện — không DB/config (lớp `providers`).
"""

from __future__ import annotations

import os
import stat
from collections.abc import Awaitable, Callable
from hashlib import sha256
from pathlib import Path

from agent_runtime.providers.base import Emit, Progress, ToolUse

Guard = Callable[[str, dict[str, object]], Awaitable[str | None]]
TMP_SUBDIR = ".tmp"


def _read_len(work_dir: str, raw: str) -> int:
    try:
        return len(Path(work_dir, raw).read_text(errors="replace"))
    except OSError:
        return 0


async def reads(work_dir: str, raw: str, guard: Guard, emit: Emit) -> str:
    """`#fake:read=<p1>[,<p2>…]`. Path `sources/…` ⇒ dòng mới; path khác (H2c) ⇒ hành vi cũ."""
    paths = [p for p in raw.split(",") if p]
    if len(paths) == 1 and not paths[0].startswith("sources/"):
        denied = await guard("Read", {"file_path": paths[0]})
        return "denied" if denied else f"read: {_read_len(work_dir, paths[0])} chars"
    lines: list[str] = []
    for p in paths:
        lines.append(await _read_one(work_dir, p, guard, emit))
    return "\n".join(lines)


async def _read_one(work_dir: str, p: str, guard: Guard, emit: Emit) -> str:
    if await guard("Read", {"file_path": p}):
        return f"read {p} DENIED"
    try:
        data = Path(work_dir, p).read_bytes()  # noqa: ASYNC240 — file nhỏ, snapshot cục bộ
    except OSError:
        return f"read {p} ENOENT"
    await emit(ToolUse(name="Read", path=p))  # audit: chỉ khi đọc được
    return f"read {p} {sha256(data).hexdigest()}"


def _entry_type(mode: int) -> str:
    if stat.S_ISLNK(mode):
        return "l"
    if stat.S_ISDIR(mode):
        return "d"
    return "f"


def tree(work_dir: str, arg: str) -> str:
    """`#fake:tree=<dir>` (lstat; `.`=cả thư mục job, bỏ `.tmp`). Vắng ⇒ `tree <dir> ENOENT`."""
    root = Path(work_dir) if arg in (".", "") else Path(work_dir, arg)
    try:
        root.lstat()
    except OSError:
        return f"tree {arg} ENOENT"
    whole_job = arg in (".", "")
    rows: list[tuple[str, str, str]] = []
    for dirpath, dirnames, filenames in os.walk(root, followlinks=False):
        if whole_job and Path(dirpath) == root:
            dirnames[:] = [d for d in dirnames if d != TMP_SUBDIR]
        for name in sorted(dirnames) + sorted(filenames):
            full = Path(dirpath, name)
            try:
                st = full.lstat()
            except OSError:
                continue
            rel = full.relative_to(root).as_posix()
            rows.append((rel, _entry_type(st.st_mode), format(stat.S_IMODE(st.st_mode), "o")))
    rows.sort()
    lines = [f"tree {arg}"] + [f"{rel} {t} {mode}" for rel, t, mode in rows]
    return "\n".join(lines)


def scan(work_dir: str, needle: str) -> str:
    """`#fake:scan=<needle>` ⇒ `scan <needle> <n>` (tổng số lần hiện trong file thường của job)."""
    target = needle.encode()
    total = 0
    for dirpath, _, filenames in os.walk(work_dir, followlinks=False):
        for name in filenames:
            full = Path(dirpath, name)
            if os.path.islink(full):
                continue
            try:
                total += Path(full).read_bytes().count(target)
            except OSError:
                continue
    return f"scan {needle} {total}"


async def obey(work_dir: str, path: str, guard: Guard, emit: Emit) -> str:
    """`#fake:obey=<file>`: đọc file nguồn, mỗi dòng `FAKE-EXEC write|bash …` đi qua hook thật.
    `obey write <p> ALLOWED|DENIED`, `obey bash <cmd> DENIED` (Bash luôn bị chặn, KHÔNG chạy)."""
    try:
        text = Path(work_dir, path).read_text(errors="replace")  # noqa: ASYNC240 — file nhỏ cục bộ
    except OSError:
        return f"obey {path} ENOENT"
    lines: list[str] = []
    for raw in text.splitlines():
        line = raw.strip()
        if not line.startswith("FAKE-EXEC "):
            continue
        verb, _, arg = line[len("FAKE-EXEC ") :].strip().partition(" ")
        if verb.lower() == "write":
            denied = await guard("Write", {"file_path": arg.strip()})
            lines.append(f"obey write {arg.strip()} {'DENIED' if denied else 'ALLOWED'}")
            if denied:
                await emit(Progress(label="tool_denied write"))
        elif verb.lower() == "bash":
            await guard("Bash", {"command": arg})  # luôn bị chặn; KHÔNG chạy lệnh
            lines.append(f"obey bash {arg} DENIED")
            await emit(Progress(label="tool_denied bash"))
    return "\n".join(lines)
