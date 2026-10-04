"""WRK-FR-23 · WRK-NFR-04 · Unit test cleanup (mtime) + file log 0600, không nội dung."""

import asyncio
import json
import os
import stat
from pathlib import Path

from agent_runtime.providers.base import Final, Progress, ToolUse, UsageEv
from agent_runtime.queue.cleanup import CleanupConfig, cleanup_once, run_cleanup
from agent_runtime.runtimes.cli.joblog import append_envelope, event_envelope

NOW = 2_000_000_000.0
H = 3600.0


def _mk(p: Path, age_s: float, *, is_dir: bool = True) -> Path:
    if is_dir:
        p.mkdir(parents=True)
        (p / "f.txt").write_text("x")
    else:
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text("{}")
    os.utime(p, (NOW - age_s, NOW - age_s))
    return p


def _cfg(tmp_path: Path) -> CleanupConfig:
    return CleanupConfig(tmp_path / "work", tmp_path / "logs", 3600)


def test_wrk_fr_23_work_older_than_24h_removed(tmp_path: Path) -> None:
    cfg = _cfg(tmp_path)
    old = _mk(cfg.work_root / "job-old", 25 * H)
    new = _mk(cfg.work_root / "job-new", 23 * H)
    assert cleanup_once(cfg, frozenset(), NOW) == (1, 0)
    assert not old.exists() and new.exists()


def test_wrk_fr_23_held_job_dir_kept_even_if_old(tmp_path: Path) -> None:
    cfg = _cfg(tmp_path)
    held = _mk(cfg.work_root / "job-run", 99 * H)
    assert cleanup_once(cfg, frozenset({"job-run"}), NOW) == (0, 0)
    assert held.exists()


def test_wrk_fr_23_fake_state_entries_by_mtime(tmp_path: Path) -> None:
    cfg = _cfg(tmp_path)
    old = _mk(cfg.work_root / ".fake-state" / "r1.json", 30 * H, is_dir=False)
    new = _mk(cfg.work_root / ".fake-state" / "r2.json", 1 * H, is_dir=False)
    cleanup_once(cfg, frozenset(), NOW)
    assert not old.exists() and new.exists()
    assert (cfg.work_root / ".fake-state").is_dir()


def test_wrk_fr_13_mcp_config_files_by_mtime(tmp_path: Path) -> None:
    """H2a §4.2: file MCP sót (`.mcp/<job_id>.json`, có token) quá 24 h bị xoá; thư mục giữ."""
    cfg = _cfg(tmp_path)
    old = _mk(cfg.work_root / ".mcp" / "j1.json", 25 * H, is_dir=False)
    new = _mk(cfg.work_root / ".mcp" / "j2.json", 1 * H, is_dir=False)
    os.utime(cfg.work_root / ".mcp", (NOW - 99 * H, NOW - 99 * H))
    cleanup_once(cfg, frozenset(), NOW)
    assert not old.exists() and new.exists()


def test_wrk_nfr_04_logs_older_than_7_days_removed(tmp_path: Path) -> None:
    cfg = _cfg(tmp_path)
    old = _mk(cfg.log_dir / "2026-01-01", 8 * 24 * H)
    new = _mk(cfg.log_dir / "2026-01-05", 6 * 24 * H)
    other = _mk(cfg.log_dir / "keep-me", 30 * 24 * H)
    assert cleanup_once(cfg, frozenset(), NOW) == (0, 1)
    assert not old.exists() and new.exists() and other.exists()


def test_wrk_fr_23_symlink_not_followed(tmp_path: Path) -> None:
    cfg = _cfg(tmp_path)
    target = _mk(tmp_path / "outside", 99 * H)
    cfg.work_root.mkdir(parents=True)
    link = cfg.work_root / "job-link"
    link.symlink_to(target, target_is_directory=True)
    os.utime(link, (NOW - 99 * H, NOW - 99 * H), follow_symlinks=False)
    cleanup_once(cfg, frozenset(), NOW)
    assert (target / "f.txt").exists() and not link.exists()


def test_wrk_fr_23_missing_dirs_ok(tmp_path: Path) -> None:
    assert cleanup_once(_cfg(tmp_path), frozenset(), NOW) == (0, 0)


async def test_wrk_fr_23_loop_runs_once_at_start(tmp_path: Path) -> None:
    cfg = CleanupConfig(tmp_path / "work", tmp_path / "logs", 3600)
    old = _mk(cfg.work_root / "job-old", 99 * H)
    os.utime(old, (1, 1))
    task = asyncio.create_task(run_cleanup(cfg, lambda: []))
    for _ in range(100):
        if not old.exists():
            break
        await asyncio.sleep(0.02)
    task.cancel()
    assert not old.exists()


def test_wrk_nfr_04_envelope_has_no_content() -> None:
    assert event_envelope(Progress(label="secret label")) == {"type": "progress"}
    assert event_envelope(ToolUse(name="Read")) == {"type": "tool_use", "tool_name": "Read"}
    u = event_envelope(UsageEv.model_validate({"type": "usage", "in": 3, "out": 4}))
    assert u["usage"] == {"in": 3, "out": 4, "cache_read": 0, "cache_write": 0}
    f = event_envelope(Final(kind="text", text="TOP SECRET", errors=["a"]))
    assert "TOP SECRET" not in json.dumps(f) and f["errors"] == 1


def test_wrk_nfr_04_events_log_mode_0600(tmp_path: Path) -> None:
    path = tmp_path / "2026-10-04" / "j1.events.jsonl"
    append_envelope(path, ToolUse(name="Bash"))
    append_envelope(path, Final(kind="text", text="SECRET"))
    lines = path.read_text().splitlines()
    assert [json.loads(x)["type"] for x in lines] == ["tool_use", "final"]
    assert "SECRET" not in path.read_text()
    if os.name == "posix":
        assert stat.S_IMODE(path.stat().st_mode) == 0o600
