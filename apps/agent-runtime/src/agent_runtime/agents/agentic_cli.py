"""WRK-FR-25 · WRK-FR-10 · Loại agent `agentic-cli` (H1: loại duy nhất, plan-runtime §8)."""

from __future__ import annotations

from agent_runtime.agents.base import AgentType


class AgenticCli(AgentType):
    key = "agentic-cli"
    runtime = "agentic-cli"
    description_vi = (
        "Agent chạy CLI subscription (Claude Agent SDK) trong thư mục làm việc riêng của job."
    )
    description_en = (
        "Agent running a subscription CLI (Claude Agent SDK) in a per-job work directory."
    )
    version = 1
