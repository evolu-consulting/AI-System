"""WRK-NFR-04 · WRK-BR-02 · Env của process cha (plan-runtime §1.4). Chỉ process cha import.

Secret (URL DB/Redis) giữ trong `SecretStr`; log dùng `Settings.safe_summary()` (đã che mật khẩu).
"""

import os
import socket
from pathlib import Path
from typing import Annotated, Literal, Self

from pydantic import Field, SecretStr, field_validator, model_validator
from pydantic_settings import BaseSettings, NoDecode, SettingsConfigDict

from agent_runtime.log import redact_url

AppEnv = Literal["development", "test", "production"]
LogLevel = Literal["debug", "info", "warning", "error"]
DEV_ONLY_PROVIDERS = frozenset({"fake-cli"})
_MNT = Path("/mnt")
HUB_ORPHAN_S = 60.0  # hằng ngưỡng orphan phía Hub (H1, `spec-decisions` X1)


def _norm_abs(value: Path, name: str) -> Path:
    if not value.is_absolute():
        raise ValueError(f"{name} phải là đường dẫn tuyệt đối")
    return Path(os.path.normpath(value))


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_prefix="AGENT_RT_",
        env_ignore_empty=True,
        extra="ignore",
        frozen=True,
    )

    app_env: AppEnv = Field(validation_alias="APP_ENV")
    home: Path = Field(validation_alias="HOME")
    redis_url: SecretStr = Field(validation_alias="REDIS_URL")
    log_level: LogLevel = Field(default="info", validation_alias="LOG_LEVEL")
    database_url: SecretStr
    worker_id: str = Field(default_factory=socket.gethostname, min_length=1, max_length=200)
    providers: Annotated[tuple[str, ...], NoDecode] = ()
    work_dir: Path = Path("/home/worker/work")
    log_dir: Path = Path("/home/worker/logs")
    poll_s: float = Field(default=1.0, gt=0)
    heartbeat_s: float = Field(default=10.0, gt=0)
    orphan_s: float = Field(default=60.0, gt=0)
    kill_grace_s: float = Field(default=3.0, gt=0)
    cleanup_s: float = Field(default=3600.0, gt=0)
    cli_path: Path | None = None
    # `workflow.async` (plan-runtime-dify §3.4): backoff giữa các lần thử, "2,8" = `policy.BACKOFF`.
    dify_backoff_s: Annotated[tuple[float, ...], NoDecode] = (2.0, 8.0)
    # plan-runtime §8: URL gốc Hub cho credential (Q5) — chỉ từ env, bắt buộc khi có `dify`.
    hub_url: str | None = Field(default=None, pattern=r"^https?://[^\s]+$", max_length=2048)
    dify_read_timeout_s: float = Field(default=30.0, gt=0)
    dify_stop_timeout_s: float = Field(default=2.0, gt=0)
    # H2b plan-runtime §8: gom `job.delta` (`DeltaPump`) — xả theo giờ / theo số ký tự.
    delta_flush_ms: int = Field(default=100, ge=10, le=1000)
    delta_flush_chars: int = Field(default=200, ge=1, le=4000)

    @field_validator("providers", mode="before")
    @classmethod
    def _split_providers(cls, value: object) -> object:
        if isinstance(value, str):
            return tuple(p.strip() for p in value.split(",") if p.strip())
        return value

    @field_validator("dify_backoff_s", mode="before")
    @classmethod
    def _split_backoff(cls, value: object) -> object:
        if isinstance(value, str):
            return tuple(float(p) for p in value.split(",") if p.strip())
        return value

    @field_validator("dify_backoff_s")
    @classmethod
    def _positive_backoff(cls, value: tuple[float, ...]) -> tuple[float, ...]:
        if not value or any(d <= 0 for d in value):
            raise ValueError("AGENT_RT_DIFY_BACKOFF_S: danh sách giây > 0, vd 2,8")
        return value

    @field_validator("hub_url")
    @classmethod
    def _strip_hub_url(cls, value: str | None) -> str | None:
        return value.rstrip("/") if value else value

    @field_validator("home", "log_dir")
    @classmethod
    def _absolute(cls, value: Path) -> Path:
        return _norm_abs(value, "đường dẫn")

    @field_validator("work_dir")
    @classmethod
    def _work_dir_not_mnt(cls, value: Path) -> Path:
        path = _norm_abs(value, "AGENT_RT_WORK_DIR")
        if path == _MNT or _MNT in path.parents:
            raise ValueError("AGENT_RT_WORK_DIR không được nằm dưới /mnt (ổ Windows)")
        return path

    @model_validator(mode="after")
    def _no_dev_provider_in_production(self) -> Self:
        if self.app_env == "production" and DEV_ONLY_PROVIDERS & set(self.providers):
            raise ValueError("fake-cli chỉ dùng khi APP_ENV là development|test")
        return self

    @model_validator(mode="after")
    def _hub_url_for_dify(self) -> Self:
        if "dify" in self.providers and not self.hub_url:
            raise ValueError("AGENT_RT_HUB_URL bắt buộc khi AGENT_RT_PROVIDERS có dify")
        return self

    @model_validator(mode="after")
    def _orphan_vs_heartbeat(self) -> Self:
        """Review 1 C2: ngưỡng orphan phải ≥ 2 nhịp heartbeat (một nhịp trễ không thành orphan), và
        heartbeat < 30 s vì Hub quét orphan với ngưỡng cố định 60 s (= 2 × 30)."""
        if self.heartbeat_s >= HUB_ORPHAN_S / 2:
            raise ValueError(
                f"AGENT_RT_HEARTBEAT_S={self.heartbeat_s:g} phải < {HUB_ORPHAN_S / 2:g} "
                f"(Hub coi job mồ côi sau {HUB_ORPHAN_S:g} s không heartbeat)"
            )
        if self.orphan_s < 2 * self.heartbeat_s:
            raise ValueError(
                f"AGENT_RT_ORPHAN_S={self.orphan_s:g} phải ≥ 2 × AGENT_RT_HEARTBEAT_S="
                f"{self.heartbeat_s:g} (= {2 * self.heartbeat_s:g})"
            )
        return self

    def safe_summary(self) -> dict[str, object]:
        """Cấu hình để log lúc khởi động — URL đã che mật khẩu."""
        return {
            "app_env": self.app_env,
            "worker_id": self.worker_id,
            "providers": list(self.providers),
            "database_url": redact_url(self.database_url.get_secret_value()),
            "redis_url": redact_url(self.redis_url.get_secret_value()),
            "work_dir": str(self.work_dir),
            "log_dir": str(self.log_dir),
            "home": str(self.home),
            "cleanup_s": self.cleanup_s,
            "hub_url": redact_url(self.hub_url) if self.hub_url else None,
        }


def load_settings() -> Settings:
    """Đọc env (không đọc file `.env`; systemd nạp `EnvironmentFile`)."""
    return Settings()  # pyright: ignore[reportCallIssue] — giá trị lấy từ env
