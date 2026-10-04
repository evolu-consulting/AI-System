"""WRK-NFR-04 · Log JSON structlog (plan-runtime §9): `ts, level, event, job_id, run_id,
tenant_id, worker_id`. Mọi giá trị chuỗi đi qua `redact` (URL có mật khẩu, JWT, Bearer, khoá API,
khoá PEM); khoá tên nhạy cảm bị thay hẳn. Không log prompt, nội dung file, `tool_input`, env.
"""

import re
import sys
from collections.abc import Generator, Mapping
from contextlib import contextmanager
from typing import TextIO, cast

import structlog
from structlog.typing import EventDict, FilteringBoundLogger, WrappedLogger

REDACTED = "[REDACTED]"

_SECRET_KEYS = frozenset(
    {
        "password",
        "passwd",
        "secret",
        "token",
        "jwt",
        "api_key",
        "apikey",
        "authorization",
        "cookie",
        "set_cookie",
        "credentials",
        "private_key",
    }
)
_SECRET_SUFFIXES = ("_password", "_secret", "_token", "_api_key", "_private_key")

_URL_PASSWORD = re.compile(r"([a-zA-Z][a-zA-Z0-9+.\-]*://[^:/@\s]*):([^@\s/]+)@")
_STRING_RULES: tuple[tuple[re.Pattern[str], str], ...] = (
    (
        re.compile(r"-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----"),
        "[REDACTED_PEM]",
    ),
    (_URL_PASSWORD, r"\1:***@"),
    (re.compile(r"eyJ[A-Za-z0-9_\-]{4,}\.[A-Za-z0-9_\-]{4,}\.[A-Za-z0-9_\-]*"), "[REDACTED_JWT]"),
    (re.compile(r"(?i)\bbearer\s+[A-Za-z0-9._~+/=\-]+"), "Bearer [REDACTED]"),
    (re.compile(r"\bsk-[A-Za-z0-9_\-]{16,}"), "[REDACTED_KEY]"),
)


def redact_url(url: str) -> str:
    """Che mật khẩu trong URL dạng `scheme://user:pass@host` → `scheme://user:***@host`."""
    return _URL_PASSWORD.sub(r"\1:***@", url)


def redact_text(text: str) -> str:
    for pattern, repl in _STRING_RULES:
        text = pattern.sub(repl, text)
    return text


def _is_secret_key(key: str) -> bool:
    k = key.lower().replace("-", "_")
    return k in _SECRET_KEYS or k.endswith(_SECRET_SUFFIXES)


def redact(value: object) -> object:
    """Trả bản sao đã che: chuỗi theo `_STRING_RULES`, dict/list/tuple đệ quy."""
    if isinstance(value, str):
        return redact_text(value)
    if isinstance(value, Mapping):
        items = cast("Mapping[object, object]", value).items()
        return {
            k: REDACTED if isinstance(k, str) and _is_secret_key(k) else redact(v) for k, v in items
        }
    if isinstance(value, list | tuple):
        return [redact(v) for v in cast("list[object] | tuple[object, ...]", value)]
    return value


def redact_processor(_logger: WrappedLogger, _method: str, event_dict: EventDict) -> EventDict:
    out = redact(event_dict)
    return cast("EventDict", out)


def configure_logging(level: str, worker_id: str, stream: TextIO | None = None) -> None:
    """Cấu hình structlog JSON ra `stream` (mặc định stdout → journald)."""
    structlog.configure(
        processors=[
            structlog.contextvars.merge_contextvars,
            structlog.processors.add_log_level,
            structlog.processors.TimeStamper(fmt="iso", utc=True, key="ts"),
            structlog.processors.format_exc_info,
            redact_processor,
            structlog.processors.JSONRenderer(),
        ],
        wrapper_class=structlog.make_filtering_bound_logger(level),
        logger_factory=structlog.PrintLoggerFactory(file=stream or sys.stdout),
        cache_logger_on_first_use=False,
    )
    structlog.contextvars.clear_contextvars()
    structlog.contextvars.bind_contextvars(worker_id=worker_id)


def get_logger() -> FilteringBoundLogger:
    return cast("FilteringBoundLogger", structlog.get_logger())


@contextmanager
def bind_job(job_id: str, run_id: str | None, tenant_id: str) -> Generator[None]:
    """Gắn `job_id`, `run_id`, `tenant_id` cho mọi dòng log trong khối (contextvars)."""
    with structlog.contextvars.bound_contextvars(job_id=job_id, run_id=run_id, tenant_id=tenant_id):
        yield
