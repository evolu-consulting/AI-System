"""WRK-NFR-04 · F4 · review 1 #6/#7 — log job: che trước rồi cắt; dòng JSONL an toàn (U+2028/U+2029,
surrogate lẻ); lỗi ghi log không làm `_apply` bỏ `_close` (unit)."""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from agent_runtime.providers.base import Final
from agent_runtime.runtimes.cli import job_run
from agent_runtime.runtimes.cli.joblog import append_is_error, log_line
from agent_runtime.runtimes.cli.test_delta_pump import _run  # pyright: ignore[reportPrivateUsage]


def test_wrk_nfr_04_is_error_redacts_before_cut(tmp_path: Path) -> None:
    """#6: khoá vắt qua mốc 300 ký tự vẫn bị che (cắt trước thì lộ `sk-AAAA…`)."""
    path = tmp_path / "j.events.jsonl"
    append_is_error(path, "refused", "x" * 289 + " sk-" + "A" * 30)
    body = json.loads(path.read_text(encoding="utf-8"))
    assert "sk-" not in body["text"] and "AAAA" not in body["text"]
    assert len(body["text"]) == 300 and body["text"].startswith("x" * 289 + " [REDACTED")


def test_wrk_nfr_04_log_line_separators_and_lone_surrogate() -> None:
    """#7: U+2028/U+2029 escape (một dòng vật lý); surrogate lẻ ⇒ `?`, không ném."""
    raw = log_line({"text": "a b c\ud800d"})
    assert raw.endswith(b"\n") and raw.count(b"\n") == 1
    assert " ".encode() not in raw and " ".encode() not in raw
    assert json.loads(raw)["text"] == "a b c?d"


async def test_wrk_nfr_04_log_error_does_not_skip_close(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """#7: ghi log `is_error` ném `UnicodeEncodeError` ⇒ `_apply` vẫn `_close`."""

    def boom(*_: object) -> None:
        raise UnicodeEncodeError("utf-8", "\ud800", 0, 1, "surrogates not allowed")

    monkeypatch.setattr(job_run, "append_is_error", boom)
    run, sink = _run(tmp_path, None)
    run.seen.final = Final(kind="text", is_error=True, text="\ud800")
    await run._apply("exited")  # pyright: ignore[reportPrivateUsage]
    assert sink.log == [("close", "UPSTREAM_ERROR")]
