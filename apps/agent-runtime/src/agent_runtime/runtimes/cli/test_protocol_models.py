"""CR-054 · `Models` (probe con → cha) là `ChildEvent` hợp lệ — thiếu ⇒ cha coi là dòng hỏng."""

from __future__ import annotations

from agent_runtime.providers.base import ModelInfo, Models
from agent_runtime.runtimes.cli.protocol import INVALID_EVENT, encode_event, parse_event


def test_cr054_models_child_event_roundtrip() -> None:
    ev = Models(
        models=(
            ModelInfo(value="haiku", display_name="Haiku", description="Nhanh"),
            ModelInfo(
                value="claude-sonnet-4-5", resolved_model="claude-sonnet-4-5", display_name="Sonnet"
            ),
        )
    )
    assert parse_event(encode_event(ev)) == ev
    assert (
        parse_event(b'{"type":"models","models":[{"value":"","display_name":"x"}]}\n')
        is INVALID_EVENT
    )
