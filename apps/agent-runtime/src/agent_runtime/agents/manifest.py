"""WRK-FR-25 · HUB-FR-90 · Danh sách loại agent Runtime đăng ký vào `hub.agent_types`
(plan-runtime §8: H1 một mục `agentic-cli`).

PY-04: manifest tối thiểu (mốc "Runtime sẵn sàng" = có dòng `agent_types`). PY-12 thay bằng registry
sinh từ các class trong `agents/` (config_schema từ pydantic).
"""

from __future__ import annotations

from agent_runtime.contracts.hub import AgentTypeManifest, Description

AGENTIC_CLI = AgentTypeManifest(
    key="agentic-cli",
    runtime="agentic-cli",
    description=Description(
        vi="Agent chạy CLI subscription (Claude Agent SDK) trong thư mục làm việc riêng của job.",
        en="Agent running a subscription CLI (Claude Agent SDK) in a per-job work directory.",
    ),
    config_schema={},
    version=1,
)


def manifests() -> list[AgentTypeManifest]:
    return [AGENTIC_CLI]
