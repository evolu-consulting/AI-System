"""P-b · PF-S2 · C6 · Cấu hình nguồn — đọc THẲNG env (tên đúng spec, KHÔNG prefix `AGENT_RT_`).

`HUB_SOURCE_GIT_HOSTS` (allowlist host git, mặc định `github.com,gitlab.com`) ·
`HUB_SOURCE_LOCAL_ROOTS` (gốc `local_path`, tách `:`/`,`) · `RUNTIME_SOURCE_CACHE_DIR` (mirror +
snapshot) · `RUNTIME_ENV` (≠`production` ⇒ truyền `GIT_CONFIG_*` xuống git, C6) ·
`RUNTIME_SOURCE_TEST_MODE` (`1` ⇒ bỏ kiểm DNS-IP-nội-bộ) · `RUNTIME_SOURCE_CACHE_MAX_MB` (LRU, D9) ·
`RUNTIME_AUTOFIX_MAX_MB/_FILES` (trần snapshot `caps=autofix`, P-c1 PC-R04; biên đã kiểm ở
`config.py`).
Tính năng nguồn BẬT khi có `RUNTIME_SOURCE_CACHE_DIR`; thiếu ⇒ `load()` trả None (Runtime cũ).
"""

from __future__ import annotations

import os
import re
from dataclasses import dataclass, field
from pathlib import Path

DEFAULT_GIT_HOSTS = ("github.com", "gitlab.com")
DEFAULT_CACHE_MAX_MB = 2048
DEFAULT_AUTOFIX_MAX_MB = 200
DEFAULT_AUTOFIX_MAX_FILES = 20000
_SPLIT = re.compile(r"[,:]")


@dataclass(frozen=True)
class SourceConfig:
    cache_dir: Path
    git_hosts: tuple[str, ...] = DEFAULT_GIT_HOSTS
    local_roots: tuple[Path, ...] = ()
    runtime_env: str = "production"
    test_mode: bool = False
    cache_max_mb: int = DEFAULT_CACHE_MAX_MB
    # GIT_CONFIG_* truyền xuống git (chỉ khi runtime_env != production) — C6 insteadOf fixture.
    git_config_env: dict[str, str] = field(default_factory=lambda: dict[str, str]())
    # P-c1 PC-R04: trần snapshot `caps=autofix` (`RUNTIME_AUTOFIX_MAX_MB/_FILES`, sau lọc PB-R07).
    autofix_max_mb: int = DEFAULT_AUTOFIX_MAX_MB
    autofix_max_files: int = DEFAULT_AUTOFIX_MAX_FILES

    @property
    def mirrors_dir(self) -> Path:
        return self.cache_dir / "mirrors"

    @property
    def snapshots_dir(self) -> Path:
        return self.cache_dir / "snapshots"

    @property
    def cache_max_bytes(self) -> int:
        return self.cache_max_mb * 1024 * 1024


def _hosts(raw: str | None) -> tuple[str, ...]:
    if not raw:
        return DEFAULT_GIT_HOSTS
    hosts = tuple(h.strip().lower() for h in raw.split(",") if h.strip())
    return hosts or DEFAULT_GIT_HOSTS


def _roots(raw: str | None) -> tuple[Path, ...]:
    if not raw:
        return ()
    return tuple(Path(p.strip()) for p in _SPLIT.split(raw) if p.strip())


def _git_config_env(env: dict[str, str]) -> dict[str, str]:
    """`GIT_CONFIG_COUNT` + `GIT_CONFIG_KEY_n`/`GIT_CONFIG_VALUE_n` (C6 insteadOf fixture)."""
    out: dict[str, str] = {}
    count = env.get("GIT_CONFIG_COUNT")
    if count and count.isdigit():
        out["GIT_CONFIG_COUNT"] = count
        for i in range(int(count)):
            for suffix in (f"GIT_CONFIG_KEY_{i}", f"GIT_CONFIG_VALUE_{i}"):
                if suffix in env:
                    out[suffix] = env[suffix]
    return out


def _posint(raw: str | None, default: int) -> int:
    return int(raw) if raw and raw.isdigit() and int(raw) > 0 else default


def load(env: dict[str, str] | None = None) -> SourceConfig | None:
    """None ⇒ tính năng nguồn tắt (không `RUNTIME_SOURCE_CACHE_DIR`)."""
    e = env if env is not None else dict(os.environ)
    cache_dir = e.get("RUNTIME_SOURCE_CACHE_DIR")
    if not cache_dir:
        return None
    runtime_env = (e.get("RUNTIME_ENV") or "production").strip().lower()
    max_mb = e.get("RUNTIME_SOURCE_CACHE_MAX_MB")
    return SourceConfig(
        cache_dir=Path(cache_dir),
        git_hosts=_hosts(e.get("HUB_SOURCE_GIT_HOSTS")),
        local_roots=_roots(e.get("HUB_SOURCE_LOCAL_ROOTS")),
        runtime_env=runtime_env,
        test_mode=e.get("RUNTIME_SOURCE_TEST_MODE") == "1",
        cache_max_mb=int(max_mb) if max_mb and max_mb.isdigit() else DEFAULT_CACHE_MAX_MB,
        git_config_env=_git_config_env(e) if runtime_env != "production" else {},
        autofix_max_mb=_posint(e.get("RUNTIME_AUTOFIX_MAX_MB"), DEFAULT_AUTOFIX_MAX_MB),
        autofix_max_files=_posint(e.get("RUNTIME_AUTOFIX_MAX_FILES"), DEFAULT_AUTOFIX_MAX_FILES),
    )
