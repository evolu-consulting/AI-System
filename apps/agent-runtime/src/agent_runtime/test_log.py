"""WRK-NFR-04 · log JSON + redaction (plan-runtime §9)."""

import io
import json
import logging

import pytest

from agent_runtime.log import (
    HTTP_LOGGERS,
    REDACTED,
    bind_job,
    configure_logging,
    get_logger,
    redact,
    redact_text,
    redact_url,
)

JWT = "eyJhbGciOiJFZERTQSJ9.eyJzdWIiOiJ1MSIsInRpZCI6InQxIn0.c2lnbmF0dXJlLXZhbHVl"


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        ("postgres://u:p%40ss@h:5432/db", "postgres://u:***@h:5432/db"),
        ("redis://:pw@localhost:6379", "redis://:***@localhost:6379"),
        ("postgres://u@h/db", "postgres://u@h/db"),
        ("http://example.com/a:b@c", "http://example.com/a:b@c"),
    ],
)
def test_wrk_nfr_04_redact_url(raw: str, expected: str) -> None:
    assert redact_url(raw) == expected


def test_wrk_nfr_04_redact_text_jwt_bearer_keys() -> None:
    text = (
        f"token={JWT} hdr=Authorization: Bearer abc.def-123 key sk-ant-api03-AAAAAAAAAAAAAAAAAAAA"
    )
    out = redact_text(text)
    assert JWT not in out
    assert "abc.def-123" not in out
    assert "sk-ant-api03" not in out
    assert "[REDACTED_JWT]" in out and "Bearer [REDACTED]" in out


def test_wrk_nfr_04_redact_pem_block() -> None:
    pem = "-----BEGIN PRIVATE KEY-----\nMIIabc\n-----END PRIVATE KEY-----"
    assert redact_text(f"k={pem}") == "k=[REDACTED_PEM]"


def test_wrk_nfr_04_redact_nested_and_secret_keys() -> None:
    data = {
        "password": "x",
        "JWT_PRIVATE_KEY": "y",
        "access_token": "z",
        "input_tokens": 12,
        "nested": {"url": "postgres://a:b@h/d", "items": [JWT, ("Bearer q",)]},
    }
    out = redact(data)
    assert out == {
        "password": REDACTED,
        "JWT_PRIVATE_KEY": REDACTED,
        "access_token": REDACTED,
        "input_tokens": 12,
        "nested": {
            "url": "postgres://a:***@h/d",
            "items": ["[REDACTED_JWT]", ["Bearer [REDACTED]"]],
        },
    }


def _lines(buf: io.StringIO) -> list[dict[str, object]]:
    return [json.loads(line) for line in buf.getvalue().splitlines()]


def test_wrk_nfr_04_json_line_has_job_context() -> None:
    buf = io.StringIO()
    configure_logging("info", worker_id="w1", stream=buf)
    log = get_logger()
    with bind_job("j1", "r1", "t1"):
        log.info("job.claimed", db="postgres://agent_runtime:secret_pw@h/db")
    log.info("idle")
    log.debug("hidden")
    first, second = _lines(buf)
    assert first["event"] == "job.claimed" and first["level"] == "info"
    assert (first["job_id"], first["run_id"], first["tenant_id"]) == ("j1", "r1", "t1")
    assert first["worker_id"] == "w1" and "ts" in first
    assert "secret_pw" not in buf.getvalue()
    assert "job_id" not in second


def test_wrk_nfr_04_exception_text_redacted() -> None:
    buf = io.StringIO()
    configure_logging("info", worker_id="w1", stream=buf)
    try:
        raise RuntimeError("connect postgres://u:leaked_pw@h/db failed")
    except RuntimeError:
        get_logger().exception("db.error")
    assert "leaked_pw" not in buf.getvalue()
    assert "u:***@h" in buf.getvalue()


def test_h2a_r17_http_loggers_warning() -> None:
    """ADR-0010: httpx2/httpcore2 không log URL/header ở DEBUG/INFO."""
    for name in HTTP_LOGGERS:
        logging.getLogger(name).setLevel(logging.DEBUG)
    configure_logging("debug", "w1", io.StringIO())
    assert set(HTTP_LOGGERS) == {"httpx2", "httpcore2"}
    for name in HTTP_LOGGERS:
        assert logging.getLogger(name).getEffectiveLevel() == logging.WARNING
