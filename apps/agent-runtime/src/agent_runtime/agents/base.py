"""WRK-FR-25 · HUB-FR-90 · Lớp gốc của loại agent nội bộ (plan-runtime §8, CONVENTIONS §9).

Mỗi loại agent = một class con của `AgentType` trong một module của `agents/`; registry
(`agents/manifest.py`) tự gom mọi class con thành manifest `hub.agent_types`. `config_schema` sinh
từ model pydantic `Config` của class (JSON Schema). Không import `db`/`events` (import-linter).
"""

from __future__ import annotations

from typing import Any, ClassVar, Literal

from pydantic import BaseModel, ConfigDict

from agent_runtime.contracts.hub import AgentTypeManifest, Description

Runtime = Literal["agentic-cli", "llm", "python"]


class NoConfig(BaseModel):
    """Loại agent không nhận cấu hình riêng."""

    model_config = ConfigDict(extra="forbid")


class AgentType:
    """Khai báo loại agent. Class con đặt `key`, `runtime`, `description_vi/en`, `version`,
    `Config`."""

    key: ClassVar[str]
    runtime: ClassVar[Runtime]
    description_vi: ClassVar[str]
    description_en: ClassVar[str]
    version: ClassVar[int] = 1
    Config: ClassVar[type[BaseModel]] = NoConfig

    @classmethod
    def config_schema(cls) -> dict[str, Any]:
        return cls.Config.model_json_schema()

    @classmethod
    def manifest(cls) -> AgentTypeManifest:
        return AgentTypeManifest(
            key=cls.key,
            runtime=cls.runtime,
            description=Description(vi=cls.description_vi, en=cls.description_en),
            config_schema=cls.config_schema(),
            version=cls.version,
        )
