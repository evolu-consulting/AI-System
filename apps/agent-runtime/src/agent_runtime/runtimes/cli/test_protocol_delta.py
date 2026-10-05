"""WRK-FR-03 · H2b PY-02 · `Delta` là `ChildEvent` hợp lệ (stdout con → cha); hình sai → lỗi."""

from __future__ import annotations

from agent_runtime.providers.base import Delta
from agent_runtime.runtimes.cli.protocol import INVALID_EVENT, encode_event, parse_event


def test_wrk_fr_03_delta_child_event_roundtrip() -> None:
    ev = Delta(kind="partial", text="á😀")
    assert parse_event(encode_event(ev)) == ev
    assert parse_event(b'{"type":"delta","kind":"answer","text":""}\n') is INVALID_EVENT
    assert parse_event(b'{"type":"delta","kind":"need_input","text":"x"}\n') is INVALID_EVENT
