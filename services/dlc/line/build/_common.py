"""Small helpers shared by the build modules (config, envelopes, prompts, unit rows)."""

from __future__ import annotations

import os
import string
from typing import Any, Dict, Mapping, Optional

from ..config import Config, load_config
from ..contracts import E_UNIT, Envelope, Unit, from_dict, now_ms, to_dict

PROMPTS_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "llm", "prompts")


def cfg_or_default(cfg: Optional[Config]) -> Config:
    return cfg if cfg is not None else load_config()


def env(run: str, cfg: Config, unit: str = "", attempt: int = 0, epoch: int = 0, model: str = "",
        spec_hash: str = "") -> Envelope:
    return Envelope(run=run, unit=unit, attempt=attempt, epoch=epoch, agent_version=cfg.agent_version,
                    model=model, spec_hash=spec_hash)


def clock_ms(store: Any) -> int:
    clk = getattr(store, "clock", None)
    return clk.now_ms() if clk is not None and hasattr(clk, "now_ms") else now_ms()


def load_unit(store: Any, unit: Any) -> Unit:
    uid = unit.id if isinstance(unit, Unit) else (unit["id"] if isinstance(unit, Mapping) else str(unit))
    row = store.get(E_UNIT, uid)
    if row is None:
        return unit if isinstance(unit, Unit) else from_dict(Unit, unit)
    return from_dict(Unit, row)


def save_unit(store: Any, unit: Unit, **fields: Any) -> Unit:
    """Re-read the unit, apply fields (state is never touched here) and write it back."""
    cur = load_unit(store, unit)
    for k, v in fields.items():
        setattr(cur, k, v)
    store.put(E_UNIT, cur.id, to_dict(cur), run=cur.run)
    return cur


class _Keep(dict):
    def __missing__(self, key: str) -> str:
        return "{" + key + "}"


def load_prompt(role: str, **vars: Any) -> str:
    """line.llm.load_prompt when the model slice provides it, else the same rules locally:
    line/llm/prompts/<role>.md, {name} placeholders via str.format_map, unknown ones kept."""
    try:
        from ..llm import load_prompt as shared  # type: ignore
    except (ImportError, AttributeError):
        shared = None
    if shared is not None:
        return shared(role, **vars)
    path = os.path.join(PROMPTS_DIR, role + ".md")
    with open(path, encoding="utf-8") as fh:
        text = fh.read()
    return string.Formatter().vformat(text, (), _Keep(vars))
