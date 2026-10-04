"""WRK-FR-25 · HUB-FR-90 · Registry loại agent: gom mọi class con của `AgentType` trong các module
của `agents/` → manifest `hub.agent_types` (plan-runtime §8; SQL `db/agent_types_sql.py`).

Thêm loại agent = thêm module có class con `AgentType`; gỡ module → lần khởi động sau loại đó
`available=false` (không xoá). Key trùng → lỗi khởi động (không ghi manifest mơ hồ).
"""

from __future__ import annotations

import importlib
import pkgutil

import agent_runtime.agents as pkg
from agent_runtime.agents.base import AgentType
from agent_runtime.contracts.hub import AgentTypeManifest

_SKIP = frozenset({"base", "manifest"})


def _load_modules() -> None:
    for info in pkgutil.iter_modules(pkg.__path__):
        if info.name in _SKIP or info.name.startswith("test_"):
            continue
        importlib.import_module(f"{pkg.__name__}.{info.name}")


def _concrete(cls: type[AgentType]) -> list[type[AgentType]]:
    found: list[type[AgentType]] = []
    for sub in cls.__subclasses__():
        if "key" in sub.__dict__:
            found.append(sub)
        found.extend(_concrete(sub))
    return found


def agent_types() -> list[type[AgentType]]:
    _load_modules()
    types = sorted(_concrete(AgentType), key=lambda c: c.key)
    keys = [t.key for t in types]
    if len(set(keys)) != len(keys):
        raise ValueError(f"agent type key trùng: {keys}")
    return types


def manifests() -> list[AgentTypeManifest]:
    return [t.manifest() for t in agent_types()]
