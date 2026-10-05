"""WRK-FR-22 · Probe quota (plan-runtime H3a §4): (a) `auth.py`, (b) `turn.py` + con `child.py`.

Phần chung phía cha: `ProbeHostCfg` (`rt §6`), thư mục probe, chỉ thị `fake-cli` (file đọc mỗi lượt)
và file đếm `<AGENT_RT_FAKE_PROBE_FILE>.calls` (`rt §5`, chỉ khi có env đó). Gói này được con probe
nạp (`probe.child`) nên không import `config`/`db`/`events`.
"""

from __future__ import annotations

from contextlib import suppress
from dataclasses import dataclass
from pathlib import Path
from typing import Literal

from agent_runtime.sandbox.env import TMP_SUBDIR

PROBE_MODULE = "agent_runtime.runtimes.cli.probe.child"
PROBE_SUBDIR = ".probe"
FAKE_READ_MAX = 4096
CallStep = Literal["auth", "turn"]


@dataclass(frozen=True)
class ProbeHostCfg:
    """`rt §6`: cấu hình probe phía cha (`main` dựng từ `Settings` — PY-04)."""

    python: str
    home: Path
    work_dir: Path
    app_env: str
    cli_path: str | None
    kill_grace_s: float
    timeout_s: float
    fake_file: Path | None = None


def probe_argv(python: str, key: str) -> list[str]:
    """Cmdline con probe (`…probe.child --provider=<key>`); ở đây, không ở `child.py`, để cha
    không nạp registry/SDK (~5 s, review H1 #8)."""
    return [python, "-m", PROBE_MODULE, f"--provider={key}"]


def probe_dir(cfg: ProbeHostCfg, key: str) -> Path:
    """`<work_dir>/.probe/<key>` 0700 + `TMP_SUBDIR` (tạo mỗi lượt — cleanup có thể đã xoá)."""
    path = cfg.work_dir / PROBE_SUBDIR / key
    path.mkdir(mode=0o700, parents=True, exist_ok=True)
    (path / TMP_SUBDIR).mkdir(mode=0o700, exist_ok=True)
    return path


def read_fake(cfg: ProbeHostCfg) -> str | None:
    """Dòng đầu file chỉ thị (đọc mỗi lượt); không có env/file/không đọc được ⇒ None (= `ok`)."""
    if cfg.fake_file is None:
        return None
    try:
        with cfg.fake_file.open(encoding="utf-8", errors="replace") as f:
            return f.read(FAKE_READ_MAX).partition("\n")[0]
    except OSError:
        return None


def note_call(cfg: ProbeHostCfg, step: CallStep) -> None:
    """`rt §5`: một dòng `auth`/`turn` trước mỗi bước — chỉ khi có `AGENT_RT_FAKE_PROBE_FILE`."""
    if cfg.fake_file is None:
        return
    with suppress(OSError), Path(f"{cfg.fake_file}.calls").open("a", encoding="utf-8") as f:
        f.write(f"{step}\n")
