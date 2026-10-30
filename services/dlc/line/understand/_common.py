"""Shared helpers of the understand stage (blocks 5, 6, 9)."""

from __future__ import annotations

import hashlib
import os
import re
from typing import Any, Dict, Mapping, Optional

from ..config import LINE_DIR, Config, load_config
from ..contracts import Envelope, Store

PROMPT_DIR = os.path.join(LINE_DIR, "llm", "prompts")


def cfg_or_default(cfg: Optional[Config]) -> Config:
    return cfg if cfg is not None else load_config()


def load_prompt(name: str) -> str:
    """Text of line/llm/prompts/<name>.md."""
    with open(os.path.join(PROMPT_DIR, name + ".md"), encoding="utf-8") as fh:
        return fh.read().strip()


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def sha256_text(text: str) -> str:
    return sha256_bytes(text.encode("utf-8"))


def envelope(run: str, spec_hash: str = "", model: str = "", cfg: Optional[Config] = None) -> Envelope:
    """Run-level envelope (unit="", attempt=0, epoch=0)."""
    c = cfg_or_default(cfg)
    return Envelope(run=run, unit="", attempt=0, epoch=0, agent_version=c.agent_version,
                    model=model or "", spec_hash=spec_hash or "")


def emit(store: Optional[Store], kind: str, env: Envelope, body: Mapping[str, Any]) -> int:
    if store is None:
        return 0
    return store.emit(kind, env, dict(body))


# ------------------------------------------------------------------ JSON schema of a digest answer

_FACT = {
    "type": "object",
    "required": ["text", "span_id", "quote"],
    "properties": {"text": {"type": "string"}, "span_id": {"type": "string"},
                   "quote": {"type": "string"}, "value": {"type": "string"}},
}
_CRITERION = {
    "type": "object",
    "required": ["id", "text", "span_id", "quote", "given", "when", "then"],
    "properties": {k: {"type": "string"} for k in ("id", "text", "span_id", "quote", "given", "when", "then")},
}
DIGEST_SCHEMA: Dict[str, Any] = {
    "type": "object",
    "required": ["f_items", "rules", "numbers"],
    "properties": {
        "f_items": {"type": "array", "items": {
            "type": "object",
            "required": ["id", "title", "span_ids", "quote", "criteria"],
            "properties": {
                "id": {"type": "string"}, "title": {"type": "string"},
                "span_ids": {"type": "array", "items": {"type": "string"}},
                "quote": {"type": "string"}, "size": {"type": "string", "enum": ["S", "M", "L"]},
                "criteria": {"type": "array", "items": _CRITERION},
            }}},
        "rules": {"type": "array", "items": _FACT},
        "numbers": {"type": "array", "items": _FACT},
    },
}

# ------------------------------------------------------------------ number / exit-code signatures

_WORDS = {"zero": "0", "one": "1", "two": "2", "three": "3", "four": "4", "five": "5", "six": "6",
          "seven": "7", "eight": "8", "nine": "9", "ten": "10"}
_WORD_RE = re.compile(r"\b(" + "|".join(_WORDS) + r")\b", re.I)
_EXIT_RE = re.compile(r"\bexit(?:s|ed|ing)?(?:\s+(?:with|code|status|value|is|of|equals?|returns?))*\s*[:=]?\s*(-?\d+)\b", re.I)
_NUM_RE = re.compile(r"(?<![\w.])-?\d+(?:\.\d+)?\b")


def norm_words(text: str) -> str:
    return _WORD_RE.sub(lambda m: _WORDS[m.group(1).lower()], text or "")


def exit_codes(text: str) -> list:
    return sorted({m.group(1) for m in _EXIT_RE.finditer(norm_words(text))})


def numbers(text: str) -> list:
    return sorted(set(_NUM_RE.findall(norm_words(text))))


def norm_value(value: Optional[str]) -> str:
    return " ".join(norm_words(value or "").lower().split())
