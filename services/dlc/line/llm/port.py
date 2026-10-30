"""Factory for the line's LlmPort, plus the prompt loader."""

from __future__ import annotations

import os
from typing import Any, Optional

from .. import codes
from ..codes import LineError
from .caps import CappedLlm, Pricing

PROMPTS_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "prompts")


def make_backend(config: Any) -> Any:
    mode = getattr(config, "llm", "fake")
    if mode == "fake":
        from .fake import FakeBackend
        return FakeBackend(config)
    if mode == "cli":
        from .cli import CliBackend
        return CliBackend(config)
    if mode == "api":
        from .api import ApiBackend
        return ApiBackend(config)
    raise LineError(codes.CONFIG_INVALID, "LINE_LLM must be fake, cli or api (got %r)" % (mode,), {"field": "llm"})


def make_llm(config: Any = None, store: Any = None, *, backend: Any = None,
             pricing: Optional[Pricing] = None) -> CappedLlm:
    """LlmPort for config.llm (fake | cli | api), wrapped in caps + ledger + schema checks.
    store (optional) receives one "llm_call" record per call and is the run-spend ledger."""
    if config is None:
        from ..config import load_config
        config = load_config()
    return CappedLlm(backend if backend is not None else make_backend(config), config, store, pricing)


class _Keep(dict):
    def __missing__(self, k: str) -> str:
        return "{" + k + "}"


def load_prompt(role: str, **vars: Any) -> str:
    """Text of prompts/<role>.md with {name} placeholders filled; LineError(NOT_FOUND) if absent."""
    path = os.path.join(PROMPTS_DIR, role + ".md")
    if not os.path.isfile(path):
        raise LineError(codes.NOT_FOUND, "no prompt for role %r (%s)" % (role, path), {"path": path})
    with open(path, encoding="utf-8") as fh:
        text = fh.read()
    return text.format_map(_Keep({k: str(v) for k, v in vars.items()})) if vars else text
