"""WRK-FR-25 · registry `agents/` → manifest (đơn vị)."""

from __future__ import annotations

from agent_runtime.agents.agentic_cli import AgenticCli
from agent_runtime.agents.manifest import agent_types, manifests


def test_wrk_fr_25_registry_collects_agentic_cli() -> None:
    assert AgenticCli in agent_types()
    m = {x.key: x for x in manifests()}["agentic-cli"]
    assert (m.runtime, m.version) == ("agentic-cli", 1)
    assert m.description.vi and m.description.en


def test_wrk_fr_25_config_schema_from_pydantic() -> None:
    schema = AgenticCli.config_schema()
    assert schema["type"] == "object" and schema["additionalProperties"] is False
