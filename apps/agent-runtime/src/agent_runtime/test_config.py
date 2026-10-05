"""WRK-NFR-04 · WRK-BR-02 · Settings (plan-runtime §1.4)."""

from pathlib import Path

import pytest
from pydantic import ValidationError

from agent_runtime.config import load_settings

DB = "postgres://agent_runtime:agent_runtime_dev_pw@localhost:5432/ai_system"
REDIS = "redis://:redis_pw@localhost:6379/0"
_VARS = (
    "APP_ENV",
    "REDIS_URL",
    "LOG_LEVEL",
    "AGENT_RT_DATABASE_URL",
    "AGENT_RT_WORKER_ID",
    "AGENT_RT_PROVIDERS",
    "AGENT_RT_WORK_DIR",
    "AGENT_RT_LOG_DIR",
    "AGENT_RT_CLEANUP_S",
    "AGENT_RT_CLI_PATH",
    "AGENT_RT_HUB_URL",
    "AGENT_RT_DIFY_READ_TIMEOUT_S",
    "AGENT_RT_DIFY_STOP_TIMEOUT_S",
    "AGENT_RT_HEARTBEAT_S",
    "AGENT_RT_ORPHAN_S",
    "AGENT_RT_PROBE_S",
    "AGENT_RT_PROBE_LOGGED_OUT_S",
    "AGENT_RT_PROBE_TIMEOUT_S",
    "AGENT_RT_COOLDOWN_DEFAULT_S",
    "AGENT_RT_FAKE_PROBE_FILE",
)


@pytest.fixture(autouse=True)
def base_env(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    for name in _VARS:
        monkeypatch.delenv(name, raising=False)
    monkeypatch.setenv("APP_ENV", "test")
    monkeypatch.setenv("HOME", str(tmp_path))
    monkeypatch.setenv("REDIS_URL", REDIS)
    monkeypatch.setenv("AGENT_RT_DATABASE_URL", DB)


def test_wrk_nfr_04_defaults_and_home_from_env(tmp_path: Path) -> None:
    s = load_settings()
    assert s.home == tmp_path
    assert s.cleanup_s == 3600
    assert s.work_dir == Path("/home/worker/work")
    assert s.providers == ()
    assert s.worker_id


def test_wrk_nfr_04_reads_agent_rt_vars(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("AGENT_RT_CLEANUP_S", "60")
    monkeypatch.setenv("AGENT_RT_PROVIDERS", " claude-sub, fake-cli ,")
    monkeypatch.setenv("AGENT_RT_WORKER_ID", "w1")
    monkeypatch.setenv("AGENT_RT_CLI_PATH", "")  # rỗng = không đặt
    s = load_settings()
    assert (s.cleanup_s, s.worker_id, s.cli_path) == (60, "w1", None)
    assert s.providers == ("claude-sub", "fake-cli")


@pytest.mark.parametrize(
    ("name", "value"),
    [
        ("HOME", "relative/home"),
        ("AGENT_RT_WORK_DIR", "/mnt/d/work"),
        ("AGENT_RT_WORK_DIR", "/home/x/../../mnt/c"),
        ("AGENT_RT_WORK_DIR", "work"),
        ("AGENT_RT_CLEANUP_S", "0"),
        ("APP_ENV", "staging"),
    ],
)
def test_wrk_nfr_04_invalid_env_rejected(
    monkeypatch: pytest.MonkeyPatch, name: str, value: str
) -> None:
    monkeypatch.setenv(name, value)
    with pytest.raises(ValidationError):
        load_settings()


def test_wrk_nfr_04_database_url_required(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("AGENT_RT_DATABASE_URL")
    with pytest.raises(ValidationError):
        load_settings()


def test_wrk_nfr_04_fake_cli_forbidden_in_production(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("APP_ENV", "production")
    monkeypatch.setenv("AGENT_RT_PROVIDERS", "claude-sub,fake-cli")
    with pytest.raises(ValidationError):
        load_settings()
    monkeypatch.setenv("AGENT_RT_PROVIDERS", "claude-sub")
    assert load_settings().providers == ("claude-sub",)


def test_wrk_br_02_secrets_masked_in_repr_and_summary() -> None:
    s = load_settings()
    assert "agent_runtime_dev_pw" not in repr(s)
    summary = s.safe_summary()
    assert summary["database_url"] == "postgres://agent_runtime:***@localhost:5432/ai_system"
    assert summary["redis_url"] == "redis://:***@localhost:6379/0"
    assert "redis_pw" not in str(summary)


def test_wrk_fr_06_dify_env_defaults_and_hub_url(monkeypatch: pytest.MonkeyPatch) -> None:
    """PY-02 · plan-runtime §8: `AGENT_RT_HUB_URL` bắt buộc khi có `dify`; timeout mặc định."""
    s = load_settings()
    assert (s.hub_url, s.dify_read_timeout_s, s.dify_stop_timeout_s) == (None, 30.0, 2.0)
    monkeypatch.setenv("AGENT_RT_PROVIDERS", "claude-sub,dify")
    with pytest.raises(ValidationError, match="AGENT_RT_HUB_URL"):
        load_settings()
    monkeypatch.setenv("AGENT_RT_HUB_URL", "http://localhost:4000/")
    monkeypatch.setenv("AGENT_RT_DIFY_READ_TIMEOUT_S", "5")
    s = load_settings()
    assert (s.hub_url, s.dify_read_timeout_s) == ("http://localhost:4000", 5.0)
    assert s.safe_summary()["hub_url"] == "http://localhost:4000"


@pytest.mark.parametrize(
    ("name", "value"),
    [
        ("AGENT_RT_HUB_URL", "localhost:4000"),
        ("AGENT_RT_HUB_URL", "ftp://hub"),
        ("AGENT_RT_DIFY_READ_TIMEOUT_S", "0"),
        ("AGENT_RT_DIFY_STOP_TIMEOUT_S", "-1"),
    ],
)
def test_wrk_fr_06_dify_env_invalid(monkeypatch: pytest.MonkeyPatch, name: str, value: str) -> None:
    monkeypatch.setenv(name, value)
    with pytest.raises(ValidationError):
        load_settings()


@pytest.mark.parametrize(
    ("heartbeat", "orphan", "needle"),
    [
        ("10", "5", "AGENT_RT_ORPHAN_S=5"),
        ("10", "19.9", "AGENT_RT_ORPHAN_S"),
        ("30", "120", "AGENT_RT_HEARTBEAT_S=30"),
        ("45", "600", "AGENT_RT_HEARTBEAT_S"),
    ],
)
def test_review1_c2_orphan_heartbeat_rejected(
    monkeypatch: pytest.MonkeyPatch, heartbeat: str, orphan: str, needle: str
) -> None:
    monkeypatch.setenv("AGENT_RT_HEARTBEAT_S", heartbeat)
    monkeypatch.setenv("AGENT_RT_ORPHAN_S", orphan)
    with pytest.raises(ValidationError, match=needle):
        load_settings()


@pytest.mark.parametrize(("heartbeat", "orphan"), [("10", "60"), ("10", "20"), ("1", "5")])
def test_review1_c2_orphan_heartbeat_accepted(
    monkeypatch: pytest.MonkeyPatch, heartbeat: str, orphan: str
) -> None:
    monkeypatch.setenv("AGENT_RT_HEARTBEAT_S", heartbeat)
    monkeypatch.setenv("AGENT_RT_ORPHAN_S", orphan)
    s = load_settings()
    assert (s.heartbeat_s, s.orphan_s) == (float(heartbeat), float(orphan))


def test_wrk_fr_22_probe_defaults_and_summary() -> None:
    """PY-00 · plan-runtime H3a §6: mặc định probe 20 phút."""
    s = load_settings()
    assert (s.probe_s, s.probe_logged_out_s, s.probe_timeout_s, s.cooldown_default_s) == (
        1200,
        60,
        60,
        1800,
    )
    assert s.fake_probe_file is None
    summary = s.safe_summary()
    assert (summary["probe_s"], summary["cooldown_default_s"]) == (1200, 1800)


@pytest.mark.parametrize(
    ("env", "name", "value", "ok"),
    [
        ("production", "AGENT_RT_PROBE_S", "0", True),
        ("production", "AGENT_RT_PROBE_S", "59", False),
        ("production", "AGENT_RT_PROBE_S", "60", True),
        ("production", "AGENT_RT_PROBE_S", "3601", False),
        ("test", "AGENT_RT_PROBE_S", "1", True),
        ("test", "AGENT_RT_PROBE_S", "-1", False),
        ("production", "AGENT_RT_PROBE_LOGGED_OUT_S", "9", False),
        ("production", "AGENT_RT_PROBE_LOGGED_OUT_S", "600", True),
        ("test", "AGENT_RT_PROBE_LOGGED_OUT_S", "1", True),
        ("test", "AGENT_RT_PROBE_LOGGED_OUT_S", "601", False),
        ("production", "AGENT_RT_PROBE_TIMEOUT_S", "9", False),
        ("test", "AGENT_RT_PROBE_TIMEOUT_S", "1", True),
        ("test", "AGENT_RT_PROBE_TIMEOUT_S", "301", False),
        ("production", "AGENT_RT_COOLDOWN_DEFAULT_S", "59", False),
        ("production", "AGENT_RT_COOLDOWN_DEFAULT_S", "86400", True),
        ("test", "AGENT_RT_COOLDOWN_DEFAULT_S", "1", True),
        ("test", "AGENT_RT_COOLDOWN_DEFAULT_S", "0", False),
    ],
)
def test_wrk_fr_22_probe_env_bounds_by_app_env(
    monkeypatch: pytest.MonkeyPatch, env: str, name: str, value: str, ok: bool
) -> None:
    monkeypatch.setenv("APP_ENV", env)
    monkeypatch.setenv(name, value)
    if ok:
        load_settings()
    else:
        with pytest.raises(ValidationError, match=name):
            load_settings()


def test_wrk_fr_22_fake_probe_file(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("AGENT_RT_FAKE_PROBE_FILE", "rel/probe.txt")
    with pytest.raises(ValidationError, match="AGENT_RT_FAKE_PROBE_FILE"):
        load_settings()
    monkeypatch.setenv("AGENT_RT_FAKE_PROBE_FILE", "/tmp/probe.txt")
    assert load_settings().fake_probe_file == Path("/tmp/probe.txt")
    monkeypatch.setenv("APP_ENV", "production")
    with pytest.raises(ValidationError, match="AGENT_RT_FAKE_PROBE_FILE"):
        load_settings()
