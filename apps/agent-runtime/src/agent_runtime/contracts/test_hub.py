"""HUB-H1-AC-06 · HUB-FR-89: hub.py (sinh) khớp hub.schema.json và mẫu hai chiều của C2."""

from __future__ import annotations

import json
from pathlib import Path

import pytest
from pydantic import ValidationError

from agent_runtime.contracts import hub

ROOT = Path(__file__).resolve().parents[5]
SCHEMA = ROOT / "apps" / "agent-runtime" / "contracts" / "hub.schema.json"
FIXTURES = ROOT / "packages" / "contracts" / "fixtures" / "hub"
KEYS = sorted(json.loads(SCHEMA.read_text(encoding="utf-8"))["$defs"])


def _load(kind: str, key: str) -> list[object]:
    files = sorted((FIXTURES / kind).glob(f"{key}[._-]*.json"))
    return [json.loads(p.read_text(encoding="utf-8")) for p in files]


def test_hub_h1_ac_06_every_schema_key_has_model() -> None:
    assert len(KEYS) >= 8
    for key in KEYS:
        assert hasattr(hub, key), key


@pytest.mark.parametrize("key", KEYS)
def test_hub_h1_ac_06_samples_both_ways(key: str) -> None:
    model = getattr(hub, key)
    valid, invalid = _load("valid", key), _load("invalid", key)
    assert len(valid) >= 2 and len(invalid) >= 2
    for data in valid:
        obj = model.model_validate(data)
        assert model.model_validate_json(obj.model_dump_json()) == obj
    for data in invalid:
        with pytest.raises(ValidationError):
            model.model_validate(data)
