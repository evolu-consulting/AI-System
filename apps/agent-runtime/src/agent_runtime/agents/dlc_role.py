"""WRK-FR-25 · DLC-R13 · Loại agent `dlc-role`: một vai trò AI của dây chuyền AI SDLC (reader,
test_author, planner, builder, reviewer…). Agent loại này do engine DLC chạy bên trong run, không
nhận job từ Hub: nó có mặt ở Studio/Admin để xem và cấu hình đội agent của DLC; người dùng chat
với supervisor (agent `dlc`, provider `dlc`).
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from agent_runtime.agents.base import AgentType


class DlcRoleConfig(BaseModel):
    model_config = ConfigDict(extra="forbid")

    role: str = Field(pattern=r"^[a-z][a-z0-9_]{1,47}$", description="Vai trò trong engine DLC")
    step: str = Field(max_length=40, description="Bước (node) của run mà vai trò làm việc")
    kind: Literal["complete", "agentic"] = Field(
        description="complete: một câu trả lời JSON; agentic: phiên có tool"
    )
    model: str = Field(default="", max_length=100, description="Model engine đang dùng cho vai trò")
    supervisor: str = Field(default="dlc", description="Agent supervisor của đội (key agent Hub)")


class DlcRole(AgentType):
    key = "dlc-role"
    runtime = "python"
    description_vi = (
        "Vai trò AI trong dây chuyền AI SDLC (engine DLC chạy trong run; supervisor là agent dlc)."
    )
    description_en = (
        "An AI role of the AI SDLC line (run by the DLC engine in a run; supervisor: agent dlc)."
    )
    version = 1
    Config = DlcRoleConfig
