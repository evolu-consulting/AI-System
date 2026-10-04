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

    @field_validator("providers", mode="before")
    @classmethod
    def _split_providers(cls, value: object) -> object:
        if isinstance(value, str):
            return tuple(p.strip() for p in value.split(",") if p.strip())
        return value

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
        }


def load_settings() -> Settings:
    """Đọc env (không đọc file `.env`; systemd nạp `EnvironmentFile`)."""
    return Settings()  # pyright: ignore[reportCallIssue] — giá trị lấy từ env
