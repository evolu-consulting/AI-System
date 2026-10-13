"""HUB-FR-126 · PC-R04 · P-c1 · snapshot `caps=autofix`: trần riêng + khoá cache riêng; bit
thực thi."""

from __future__ import annotations

import stat
from hashlib import sha256
from pathlib import Path

import pytest

from agent_runtime.sources import snapshot
from agent_runtime.sources.config import SourceConfig, load
from agent_runtime.sources.errors import SourceError
from agent_runtime.sources.filter import MAX_BYTES, MAX_FILES


def _cfg(tmp: Path, **kw: int) -> SourceConfig:
    return SourceConfig(cache_dir=tmp / "cache", **kw)  # pyright: ignore[reportArgumentType]


def test_pc_r04_allow_hash_source_unchanged_autofix_distinct() -> None:
    old = sha256("\n".join(sorted(["b", "a"])).encode()).hexdigest()[:16]
    assert snapshot.allow_hash(["a", "b"]) == old
    assert snapshot.allow_hash([], "autofix") != snapshot.allow_hash([])
    assert snapshot.as_caps("autofix") == "autofix"
    assert snapshot.as_caps(None) == snapshot.as_caps("x") == "source"


def test_pc_r04_ceiling_for(tmp_path: Path) -> None:
    src = snapshot.ceiling_for(_cfg(tmp_path))
    assert (src.max_files, src.max_bytes) == (MAX_FILES, MAX_BYTES)
    af = snapshot.ceiling_for(_cfg(tmp_path), "autofix")
    assert (af.max_files, af.max_bytes) == (20_000, 200 * 1024 * 1024)


def test_pc_r04_env_load() -> None:
    cfg = load({"RUNTIME_SOURCE_CACHE_DIR": "/c", "RUNTIME_AUTOFIX_MAX_MB": "7"})
    assert cfg is not None and (cfg.autofix_max_mb, cfg.autofix_max_files) == (7, 20_000)


def test_pc_r04_build_local_autofix_ceiling_and_exec_bit(tmp_path: Path) -> None:
    root = tmp_path / "repo"
    root.mkdir()
    for i in range(3):
        (root / f"f{i}.txt").write_text("x")
    (root / "run.sh").write_text("#!/bin/sh\n")
    (root / "run.sh").chmod(0o755)
    cfg = _cfg(tmp_path, autofix_max_files=3)
    with pytest.raises(SourceError) as ei:
        snapshot.build_local(cfg, tmp_path / "d1", root, [], snapshot.ceiling_for(cfg, "autofix"))
    assert ei.value.code == "SOURCE_TOO_LARGE"
    final = snapshot.local_dir(
        cfg, "t", root, [], "0d6c3a51-8f0e-4b8a-9d3e-1c2b3a4d5e6f", "autofix"
    )
    assert final != snapshot.local_dir(cfg, "t", root, [], "0d6c3a51-8f0e-4b8a-9d3e-1c2b3a4d5e6f")
    big = _cfg(tmp_path, autofix_max_files=10)
    snapshot.ensure(
        big,
        final,
        lambda tmp: snapshot.build_local(big, tmp, root, [], snapshot.ceiling_for(big, "autofix")),
    )
    assert stat.S_IMODE((final / "run.sh").stat().st_mode) == 0o555
    assert stat.S_IMODE((final / "f0.txt").stat().st_mode) == 0o444
