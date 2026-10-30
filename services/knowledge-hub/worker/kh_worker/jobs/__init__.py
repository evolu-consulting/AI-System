"""Worker jobs (design docs/roadmap-e-to-5-design.md 3.3 and 3.4, slice S10).

A job is a module with ``run(ctx: RunContext) -> dict``; ``kh_worker.main.run_job`` loads it by name and owns
the lease, the budget and the ``worker.run`` summary event. Jobs: ``distil`` (the weekend loop of
``docs/distill-design.md``, "The command", in code) and ``daily`` (one summary per project-day).

Shared here: prompt files (``kh_worker/prompts/<name>.md``), the delimited data block that carries KH's data
into a prompt, and small env readers.
"""
from __future__ import annotations

import json
import os
import re
from functools import lru_cache
from pathlib import Path
from typing import Any, Mapping

PROMPTS_DIR = Path(__file__).resolve().parent.parent / "prompts"

# Data from KH (logs, neighbours, people) goes inside one block. The system prompt says that text inside it is
# data, never instructions; the block cannot be closed from inside, because every "</kh_data" in the JSON is
# written as "<\/kh_data" (a valid JSON escape of the same characters).
DATA_TAG = "kh_data"
_CLOSE = re.compile(r"</(\s*" + DATA_TAG + ")", re.I)


@lru_cache(maxsize=None)
def load_prompt(name: str) -> str:
    """The text of ``prompts/<name>.md`` (the system prompt of a job)."""
    path = PROMPTS_DIR / f"{name}.md"
    return path.read_text(encoding="utf-8").strip() + "\n"


def data_block(label: str, data: Any) -> str:
    body = json.dumps(data, ensure_ascii=False, indent=1, default=str)
    body = _CLOSE.sub(lambda m: "<\\/" + m.group(1), body)
    return f'<{DATA_TAG} name="{label}">\n{body}\n</{DATA_TAG}>'


def env_int(name: str, default: int, env: Mapping[str, str] | None = None) -> int:
    raw = ((os.environ if env is None else env).get(name) or "").strip()
    try:
        v = int(raw) if raw else default
    except ValueError:
        return default
    return v if v > 0 else default


def short(exc: BaseException, n: int = 300) -> str:
    return f"{type(exc).__name__}: {exc}"[:n]


__all__ = ["DATA_TAG", "PROMPTS_DIR", "data_block", "env_int", "load_prompt", "short"]
