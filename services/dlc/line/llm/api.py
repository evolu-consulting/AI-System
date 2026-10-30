"""Backend over the Messages API (urllib, stdlib only). complete() only.

The key comes from the ANTHROPIC_API_KEY environment variable at call time, never
from a file or config, and is never logged. Agentic roles need a tool-running
session in a worktree; this backend refuses them (use LINE_LLM=cli).
"""

from __future__ import annotations

import json
import os
import urllib.error
import urllib.request
from typing import Any, Callable, Optional

from .. import codes
from ..codes import LineError
from ..contracts import LlmResult
from .caps import COMPLETE_MAX_TOKENS

API_URL = "https://api.anthropic.com/v1/messages"
API_VERSION = "2023-06-01"
KEY_ENV = "ANTHROPIC_API_KEY"
TIMEOUT_S = 600


class ApiBackend:
    name = "api"
    overhead_tokens = 0

    def __init__(self, config: Any = None, opener: Optional[Callable[..., Any]] = None, url: str = API_URL):
        self.config = config
        self.opener = opener or urllib.request.urlopen
        self.url = url

    def raw_complete(self, role: str, prompt: str, model: str, key: str, repair: bool = False) -> LlmResult:
        api_key = os.environ.get(KEY_ENV, "")
        if not api_key:
            raise LineError(codes.LLM_ERROR, "LINE_LLM=api needs %s in the environment" % KEY_ENV, {"role": role})
        body = json.dumps({"model": model, "max_tokens": COMPLETE_MAX_TOKENS,
                           "messages": [{"role": "user", "content": prompt}]}).encode("utf-8")
        req = urllib.request.Request(self.url, data=body, method="POST", headers={
            "x-api-key": api_key, "anthropic-version": API_VERSION, "content-type": "application/json"})
        try:
            with self.opener(req, timeout=TIMEOUT_S) as resp:
                raw = resp.read()
        except urllib.error.HTTPError as e:
            try:
                msg = e.read().decode("utf-8", "replace")[:600]
            except Exception:  # noqa: BLE001
                msg = ""
            raise LineError(codes.LLM_ERROR, "Messages API HTTP %s: %s" % (e.code, msg),
                            {"status": e.code, "role": role, "key": key}) from e
        except (urllib.error.URLError, OSError, ValueError) as e:
            raise LineError(codes.LLM_ERROR, "Messages API unreachable: %s" % e, {"role": role, "key": key}) from e
        try:
            data = json.loads(raw.decode("utf-8"))
        except ValueError as e:
            raise LineError(codes.LLM_ERROR, "Messages API answered non-JSON", {"role": role, "key": key}) from e
        u = data.get("usage") or {}
        usage = {"input": int(u.get("input_tokens") or 0), "output": int(u.get("output_tokens") or 0),
                 "cacheWrite": int(u.get("cache_creation_input_tokens") or 0),
                 "cacheRead": int(u.get("cache_read_input_tokens") or 0)}
        text = "".join(b.get("text", "") for b in data.get("content") or [] if b.get("type") == "text")
        # usd 0 here: the cost wrapper prices usage from pricing.json
        return LlmResult(None, text.strip(), usage, 0.0, str(data.get("model") or model), "")

    def raw_agentic(self, role: str, workdir: str, prompt: str, model: str, max_turns: int,
                    usd_cap: float, key: str) -> LlmResult:
        raise LineError(codes.LLM_ERROR, "LINE_LLM=api serves non-agentic roles only; %r needs LINE_LLM=cli" % role,
                        {"role": role, "key": key, "backend": "api"})
