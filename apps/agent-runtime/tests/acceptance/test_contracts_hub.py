"""HUB-H1-AC-06 · HUB-FR-89 · P44: pydantic sinh (C2) cùng kết luận với zod trên mẫu hai chiều.

Mẫu: `packages/contracts/fixtures/hub/{valid,invalid}/<Key>[._-]*.json` (quy ước QW-R,
spec-decisions);
`Key` = khoá `HUB_JSON_SCHEMAS` = tên model Python (`packages/contracts/src/hub/export.ts`).
Chiều `model_dump_json()` → zod parse chạy phía TS (R14 / `contracts:check`), không chạy được
trong pytest.
"""

from __future__ import annotations

import importlib
import json
import re
from pathlib import Path

import pytest
from pydantic import ValidationError

FIXTURES = Path(__file__).resolve().parents[4] / "packages" / "contracts" / "fixtures" / "hub"
KEYS = [
    "JobPayload",
    "RunEvent",
    "AgentResult",
    "OrchestratorDecision",
    "AgentTypeManifest",
    "JobEnqueuedPayload",
    "JobCancelPayload",
    "HubConfigChangedPayload",
]


def samples(kind: str, key: str) -> list[Path]:
    pat = re.compile(rf"^{key}([._-].*)?\.json$")
    folder = FIXTURES / kind
    return sorted(p for p in folder.glob("*.json") if pat.match(p.name)) if folder.is_dir() else []


@pytest.mark.parametrize("key", KEYS)
def test_hub_h1_ac_06_pydantic_matches_zod(key: str) -> None:
    """AC-06 · mẫu `valid` (zod nhận) → pydantic nhận; mẫu `invalid` (zod từ chối) →
    `ValidationError`;
    `model_dump_json()` của mẫu hợp lệ parse lại được và giữ nguyên giá trị."""
    valid, invalid = samples("valid", key), samples("invalid", key)
    assert len(valid) >= 2 and len(invalid) >= 2, f"thiếu mẫu C2 cho {key}"
    hub = importlib.import_module("agent_runtime.contracts.hub")
    model = getattr(hub, key)
    for p in valid:
        data = json.loads(p.read_text(encoding="utf-8"))
        obj = model.model_validate(data)
        again = model.model_validate_json(obj.model_dump_json())
        assert again == obj, p.name
    for p in invalid:
        data = json.loads(p.read_text(encoding="utf-8"))
        with pytest.raises(ValidationError):
            model.model_validate(data)
