"""The worker's only LLM door (design section 3.2, "LLM").

Contract: ``complete(system, user, schema, *, max_tokens) -> LLMResult`` where ``LLMResult.json`` is the parsed
object matching ``schema`` and ``LLMResult.usage`` the token usage. ``complete_many`` runs several prompts (the
``anthropic`` adapter sends them as one Message Batch at half price; the others run them in turn).

Adapters, picked by ``KH_WORKER_LLM``:

* ``anthropic`` (default on CF) - Messages API through the official SDK, key from env ``ANTHROPIC_API_KEY``.
  Adaptive thinking, ``effort`` (default medium), structured output via ``output_config.format``, and the
  server-side refusal fallback (``fallbacks: "default"``) on synchronous calls.
* ``claude_cli`` - ``claude -p --output-format json --json-schema ...`` as a subprocess, for a machine that
  has Claude Code signed in and no API key. Tools, user settings (hooks) and MCP are switched off.
* ``dry``         - canned output, no network and no cost. Output comes from ``KH_WORKER_DRY_FIXTURE`` (a JSON
  file), or a minimal instance built from the schema.

Model: ``KH_WORKER_MODEL`` (default ``claude-opus-5-5``; ``claude-sonnet-5`` is the cheaper candidate, adopted
only if G2 holds). Every call goes through ``Metered``, which reserves the pessimistic estimate in the budget
before sending and books the actual cost afterwards, so no adapter can bypass the caps.
"""
from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
import tempfile
import time
from dataclasses import dataclass, field
from typing import Any, Callable, Mapping, Protocol, Sequence

from .budget import (Budget, BudgetExceeded, cost_from_usage, estimate_usd, tokens_from_chars)

DEFAULT_MODEL = "claude-opus-5-5"
DEFAULT_EFFORT = "medium"
DEFAULT_MAX_TOKENS = 16000
ADAPTERS = ("anthropic", "claude_cli", "dry")
FALLBACK_BETA = "server-side-fallback-2026-07-01"
OAUTH_IDENTITY = "You are Claude Code, Anthropic's official CLI for Claude."


class LLMError(RuntimeError):
    """The call failed (transport, refusal, unparsable output). The batch is retried on a later run."""


class LLMRefusal(LLMError):
    pass


class LLMConfigError(LLMError):
    pass


@dataclass
class LLMRequest:
    system: str
    user: str
    schema: dict
    max_tokens: int = DEFAULT_MAX_TOKENS
    custom_id: str = ""


@dataclass
class LLMResult:
    json: Any
    usage: dict
    model: str
    cost_usd: float
    billed: bool
    adapter: str
    stop_reason: str = "end_turn"
    custom_id: str = ""
    raw_text: str = ""
    error: str = ""          # complete_many: a per-item failure leaves json None and sets error


class LLM(Protocol):
    name: str
    model: str
    billed: bool

    def count_tokens(self, system: str, user: str, schema: dict) -> int: ...
    def complete(self, system: str, user: str, schema: dict, *, max_tokens: int = DEFAULT_MAX_TOKENS) -> LLMResult: ...
    def complete_many(self, reqs: Sequence[LLMRequest]) -> list[LLMResult]: ...


# ---------------------------------------------------------------------------------------------- helpers
def _schema_overhead_tokens(schema: dict) -> int:
    return tokens_from_chars(json.dumps(schema, separators=(",", ":"))) + 50


_FENCE = re.compile(r"^\s*```(?:json)?\s*(.*?)\s*```\s*$", re.S)


def parse_json_text(text: str) -> Any:
    """Parse model text as JSON; tolerates a ```json fence or prose around one top-level object."""
    t = (text or "").strip()
    m = _FENCE.match(t)
    if m:
        t = m.group(1)
    try:
        return json.loads(t)
    except ValueError:
        start, end = t.find("{"), t.rfind("}")
        if 0 <= start < end:
            try:
                return json.loads(t[start:end + 1])
            except ValueError:
                pass
    raise LLMError("model output is not valid JSON")


def instance_from_schema(schema: Mapping[str, Any]) -> Any:
    """Smallest value that satisfies the usual JSON-schema keywords (dry adapter's default output)."""
    if not isinstance(schema, Mapping):
        return None
    if "const" in schema:
        return schema["const"]
    if schema.get("enum"):
        return schema["enum"][0]
    if "default" in schema:
        return schema["default"]
    for key in ("anyOf", "oneOf"):
        if schema.get(key):
            return instance_from_schema(schema[key][0])
    typ = schema.get("type")
    if isinstance(typ, list):
        typ = next((t for t in typ if t != "null"), typ[0] if typ else None)
    if typ == "object" or (typ is None and "properties" in schema):
        props = schema.get("properties") or {}
        return {k: instance_from_schema(props[k]) for k in (schema.get("required") or []) if k in props}
    if typ == "array":
        n = int(schema.get("minItems") or 0)
        return [instance_from_schema(schema.get("items") or {}) for _ in range(n)]
    if typ == "string":
        return "x" * int(schema.get("minLength") or 0)
    if typ in ("integer", "number"):
        return schema.get("minimum", 0)
    if typ == "boolean":
        return False
    return None


def _usage_dict(usage: Any) -> dict:
    if usage is None:
        return {}
    if isinstance(usage, Mapping):
        src = usage
    else:
        src = {k: getattr(usage, k, None) for k in
               ("input_tokens", "output_tokens", "cache_read_input_tokens", "cache_creation_input_tokens")}
    return {k: int(v) for k, v in src.items()
            if k in ("input_tokens", "output_tokens", "cache_read_input_tokens", "cache_creation_input_tokens")
            and isinstance(v, (int, float))}


# ---------------------------------------------------------------------------------------------- adapters
class DryLLM:
    """No network, no money. Usage is simulated from characters so the caps can be rehearsed; ``billed`` is
    False, so the spend counts toward the run cap but never reaches the month total or KH's metrics."""
    name = "dry"
    billed = False

    def __init__(self, model: str = DEFAULT_MODEL, *, fixture: Any = None,
                 responder: Callable[[str, str, dict], Any] | None = None, output_tokens: int = 200):
        self.model = model
        self.fixture = fixture
        self.responder = responder
        self.output_tokens = output_tokens
        self.calls: list[LLMRequest] = []

    @classmethod
    def from_env(cls, model: str) -> "DryLLM":
        path = os.environ.get("KH_WORKER_DRY_FIXTURE", "").strip()
        fixture = None
        if path:
            with open(path, encoding="utf-8") as fh:
                fixture = json.load(fh)
        return cls(model, fixture=fixture)

    def count_tokens(self, system: str, user: str, schema: dict) -> int:
        return tokens_from_chars(system, user) + _schema_overhead_tokens(schema)

    def _answer(self, system: str, user: str, schema: dict) -> Any:
        if self.responder is not None:
            return self.responder(system, user, schema)
        if self.fixture is not None:
            return json.loads(json.dumps(self.fixture))
        return instance_from_schema(schema)

    def complete(self, system: str, user: str, schema: dict, *, max_tokens: int = DEFAULT_MAX_TOKENS) -> LLMResult:
        self.calls.append(LLMRequest(system, user, schema, max_tokens))
        out = self._answer(system, user, schema)
        usage = {"input_tokens": self.count_tokens(system, user, schema),
                 "output_tokens": min(max_tokens, self.output_tokens)}
        return LLMResult(json=out, usage=usage, model=self.model, cost_usd=cost_from_usage(self.model, usage),
                         billed=False, adapter=self.name, raw_text=json.dumps(out))

    def complete_many(self, reqs: Sequence[LLMRequest]) -> list[LLMResult]:
        res = []
        for r in reqs:
            one = self.complete(r.system, r.user, r.schema, max_tokens=r.max_tokens)
            one.custom_id = r.custom_id
            res.append(one)
        return res


class AnthropicLLM:
    """Anthropic Messages API. The SDK is imported lazily so the dry and CLI adapters need no install."""
    name = "anthropic"
    billed = True

    def __init__(self, model: str = DEFAULT_MODEL, *, effort: str = DEFAULT_EFFORT, fallbacks: bool = True,
                 client: Any = None, batch_poll_s: float = 30.0, batch_timeout_s: float = 6 * 3600,
                 sleep: Callable[[float], None] = time.sleep):
        self.model = model
        self.effort = effort
        self.fallbacks = fallbacks
        self.batch_poll_s = batch_poll_s
        self.batch_timeout_s = batch_timeout_s
        self._sleep = sleep
        self.oauth = False
        if client is None:
            oauth = (os.environ.get("CLAUDE_CODE_OAUTH_TOKEN") or "").strip()
            if not os.environ.get("ANTHROPIC_API_KEY") and not oauth:
                raise LLMConfigError("KH_WORKER_LLM=anthropic needs ANTHROPIC_API_KEY or CLAUDE_CODE_OAUTH_TOKEN "
                                     "in the environment")
            try:
                import anthropic  # noqa: PLC0415
            except ImportError as exc:  # pragma: no cover - depends on the install
                raise LLMConfigError("the 'anthropic' package is not installed (pip install -r "
                                     "worker/requirements.txt)") from exc
            if os.environ.get("ANTHROPIC_API_KEY"):
                client = anthropic.Anthropic(max_retries=3)
            else:
                # A `claude setup-token` is OAuth: a Bearer token with the oauth beta, never an x-api-key
                # (KH lesson dk_ab8a377ff5dc). Lets a server without the Claude CLI (KH on CF) use it.
                client = anthropic.Anthropic(max_retries=3, api_key=None, auth_token=oauth,
                                             default_headers={"anthropic-beta": "oauth-2025-04-20"})
                self.oauth = True
        self.client = client

    def _params(self, system: str, user: str, schema: dict, max_tokens: int) -> dict:
        if self.oauth:
            # an OAuth token answers 429 'Error' unless the system prompt opens with Claude Code's identity
            system = [{"type": "text", "text": OAUTH_IDENTITY}, {"type": "text", "text": system}]
        return {
            "model": self.model,
            "max_tokens": max_tokens,
            "system": system,
            "messages": [{"role": "user", "content": user}],
            "thinking": {"type": "adaptive"},
            "output_config": {"effort": self.effort,
                              "format": {"type": "json_schema", "schema": schema}},
        }

    def count_tokens(self, system: str, user: str, schema: dict) -> int:
        try:
            r = self.client.messages.count_tokens(model=self.model, system=system,
                                                  messages=[{"role": "user", "content": user}])
            n = int(getattr(r, "input_tokens", 0) or 0)
        except Exception:  # noqa: BLE001 - counting must never be the reason a cap is skipped
            n = tokens_from_chars(system, user)
        # the structured-output grammar adds a system preamble that count_tokens does not see
        return n + _schema_overhead_tokens(schema)

    @staticmethod
    def _text(content: Any) -> str:
        return "".join(getattr(b, "text", "") or "" for b in (content or []) if getattr(b, "type", "") == "text")

    def _result(self, msg: Any, *, batch: bool, custom_id: str = "") -> LLMResult:
        usage = _usage_dict(getattr(msg, "usage", None))
        served = getattr(msg, "model", None) or self.model
        # price at the dearer of the asked and the served model (a fallback may have answered)
        cost = max(cost_from_usage(self.model, usage, batch=batch), cost_from_usage(served, usage, batch=batch))
        stop = getattr(msg, "stop_reason", "") or ""
        text = self._text(getattr(msg, "content", None))
        res = LLMResult(json=None, usage=usage, model=served, cost_usd=cost, billed=True, adapter=self.name,
                        stop_reason=stop, custom_id=custom_id, raw_text=text)
        if stop == "refusal":
            res.error = "refusal"
        elif stop == "max_tokens":
            res.error = "max_tokens"
        else:
            try:
                res.json = parse_json_text(text)
            except LLMError as exc:
                res.error = str(exc)
        return res

    def complete(self, system: str, user: str, schema: dict, *, max_tokens: int = DEFAULT_MAX_TOKENS) -> LLMResult:
        params = self._params(system, user, schema, max_tokens)
        if self.fallbacks:
            # ``fallbacks`` goes through extra_body so any SDK in the pinned range sends it unchanged
            msg = self.client.beta.messages.create(**params, betas=[FALLBACK_BETA],
                                                   extra_body={"fallbacks": "default"})
        else:
            msg = self.client.messages.create(**params)
        return self._result(msg, batch=False)

    def complete_many(self, reqs: Sequence[LLMRequest]) -> list[LLMResult]:
        """One Message Batch (50% price). Fallbacks are not accepted on the Batches API, so none are sent."""
        if not reqs:
            return []
        ids = [r.custom_id or f"r{i}" for i, r in enumerate(reqs)]
        batch = self.client.messages.batches.create(requests=[
            {"custom_id": cid, "params": self._params(r.system, r.user, r.schema, r.max_tokens)}
            for cid, r in zip(ids, reqs)])
        waited = 0.0
        while getattr(batch, "processing_status", "") != "ended":
            if waited >= self.batch_timeout_s:
                try:
                    self.client.messages.batches.cancel(batch.id)
                finally:
                    raise LLMError(f"batch {batch.id} did not end within {self.batch_timeout_s:.0f}s")
            self._sleep(self.batch_poll_s)
            waited += self.batch_poll_s
            batch = self.client.messages.batches.retrieve(batch.id)
        by_id: dict[str, LLMResult] = {}
        for item in self.client.messages.batches.results(batch.id):
            cid = item.custom_id
            rtype = getattr(item.result, "type", "")
            if rtype == "succeeded":
                by_id[cid] = self._result(item.result.message, batch=True, custom_id=cid)
            else:
                by_id[cid] = LLMResult(json=None, usage={}, model=self.model, cost_usd=0.0, billed=True,
                                       adapter=self.name, stop_reason=rtype, custom_id=cid, error=rtype)
        return [by_id.get(cid) or LLMResult(json=None, usage={}, model=self.model, cost_usd=0.0, billed=True,
                                            adapter=self.name, stop_reason="missing", custom_id=cid,
                                            error="missing") for cid in ids]


class ClaudeCliLLM:
    """``claude -p`` (Claude Code, headless) with JSON output, for a machine with Claude Code and no API key.

    The prompt goes on stdin and the system prompt through a temp file, so Windows' 32k command line is not
    the limit. It runs in an empty temp directory with only project settings loaded (there are none there), so
    the person's own hooks, CLAUDE.md and MCP servers stay out; tools are switched off. ``--max-budget-usd``
    is set to what the budget has left, as one more lock. Cost is the CLI's ``total_cost_usd`` (on a
    subscription it is notional, and it still counts toward the caps).
    """
    name = "claude_cli"
    billed = True

    def __init__(self, model: str = DEFAULT_MODEL, *, effort: str = DEFAULT_EFFORT, binary: str | None = None,
                 timeout_s: float = 900.0, runner: Callable[..., subprocess.CompletedProcess] | None = None):
        self.model = model
        self.effort = effort
        self.binary = binary or os.environ.get("KH_WORKER_CLAUDE_BIN") or "claude"
        self.timeout_s = timeout_s
        self._run = runner or subprocess.run
        self.budget_left_usd: float | None = None   # set by Metered before each call

    def count_tokens(self, system: str, user: str, schema: dict) -> int:
        return tokens_from_chars(system, user) + _schema_overhead_tokens(schema)

    def build_argv(self, system_file: str, schema: dict) -> list[str]:
        exe = shutil.which(self.binary) or self.binary
        argv = [exe, "-p", "--output-format", "json", "--model", self.model, "--effort", self.effort,
                "--json-schema", json.dumps(schema, separators=(",", ":")),
                "--system-prompt-file", system_file, "--tools", "", "--strict-mcp-config",
                "--setting-sources", "project", "--no-session-persistence"]
        if self.budget_left_usd is not None:
            argv += ["--max-budget-usd", f"{max(self.budget_left_usd, 0.01):.2f}"]
        return argv

    def complete(self, system: str, user: str, schema: dict, *, max_tokens: int = DEFAULT_MAX_TOKENS) -> LLMResult:
        with tempfile.TemporaryDirectory(prefix="kh-worker-cli-") as tmp:
            sys_file = os.path.join(tmp, "system.md")
            with open(sys_file, "w", encoding="utf-8") as fh:
                fh.write(system)
            argv = self.build_argv(sys_file, schema)
            try:
                proc = self._run(argv, input=user, capture_output=True, text=True, encoding="utf-8",
                                 timeout=self.timeout_s, cwd=tmp)
            except FileNotFoundError as exc:
                raise LLMConfigError(f"claude CLI not found ({self.binary}); set KH_WORKER_CLAUDE_BIN") from exc
            except subprocess.TimeoutExpired as exc:
                raise LLMError(f"claude CLI timed out after {self.timeout_s:.0f}s") from exc
        return self.parse_output(proc.stdout or "", proc.returncode, proc.stderr or "")

    def parse_output(self, stdout: str, returncode: int = 0, stderr: str = "") -> LLMResult:
        try:
            out = json.loads(stdout.strip().splitlines()[-1] if stdout.strip() else "")
        except (ValueError, IndexError) as exc:
            raise LLMError(f"claude CLI gave no JSON result (exit {returncode}): {stderr.strip()[:300]}") from exc
        usage = _usage_dict(out.get("usage"))
        cost = out.get("total_cost_usd")
        cost = float(cost) if isinstance(cost, (int, float)) else cost_from_usage(self.model, usage)
        res = LLMResult(json=None, usage=usage, model=self.model, cost_usd=cost, billed=True, adapter=self.name,
                        stop_reason=str(out.get("stop_reason") or out.get("subtype") or ""),
                        raw_text=str(out.get("result") or ""))
        if out.get("is_error") or returncode != 0:
            res.error = f"claude CLI error ({out.get('subtype', 'error')}): {res.raw_text[:300]}"
            return res
        if out.get("structured_output") is not None:
            res.json = out["structured_output"]
        else:
            try:
                res.json = parse_json_text(res.raw_text)
            except LLMError as exc:
                res.error = str(exc)
        return res

    def complete_many(self, reqs: Sequence[LLMRequest]) -> list[LLMResult]:
        res = []
        for r in reqs:
            one = self.complete(r.system, r.user, r.schema, max_tokens=r.max_tokens)
            one.custom_id = r.custom_id
            res.append(one)
        return res


# ---------------------------------------------------------------------------------------------- the guard
@dataclass
class Metered:
    """Wraps an adapter with the budget: estimate -> reserve (or refuse) -> call -> book actual cost.

    A failed call books whatever usage came back (a refusal or bad JSON is still paid for) and raises
    ``LLMError``. A transport error before any answer releases the hold.
    """
    llm: Any
    budget: Budget
    batch_discount: bool = True
    log: list = field(default_factory=list)

    @property
    def model(self) -> str:
        return self.llm.model

    def estimate(self, system: str, user: str, schema: dict, max_tokens: int, *, batch: bool = False) -> float:
        return estimate_usd(self.llm.model, self.llm.count_tokens(system, user, schema), max_tokens, batch=batch)

    def complete(self, system: str, user: str, schema: dict, *, max_tokens: int = DEFAULT_MAX_TOKENS) -> LLMResult:
        est = self.estimate(system, user, schema, max_tokens)
        hold = self.budget.reserve(est)            # raises BudgetExceeded before anything is sent
        if isinstance(self.llm, ClaudeCliLLM):
            self.llm.budget_left_usd = self.budget.remaining_usd() + est
        try:
            res = self.llm.complete(system, user, schema, max_tokens=max_tokens)
        except LLMError:
            hold.cancel()
            raise
        except Exception as exc:
            hold.cancel()
            raise LLMError(f"{self.llm.name}: {type(exc).__name__}: {exc}") from exc
        hold.book(res.cost_usd, model=res.model, billed=res.billed, usage=res.usage)
        self.log.append({"model": res.model, "usd": res.cost_usd, "estimate": est, "billed": res.billed})
        if res.error:
            raise (LLMRefusal if res.error == "refusal" else LLMError)(res.error)
        return res

    def complete_many(self, reqs: Sequence[LLMRequest]) -> list[LLMResult]:
        """All requests are estimated together and refused together: a batch is sent whole or not at all."""
        if not reqs:
            return []
        batch = self.batch_discount and isinstance(self.llm, AnthropicLLM)
        est = sum(self.estimate(r.system, r.user, r.schema, r.max_tokens, batch=batch) for r in reqs)
        hold = self.budget.reserve(est)
        try:
            results = self.llm.complete_many(reqs)
        except LLMError:
            hold.cancel()
            raise
        except Exception as exc:
            hold.cancel()
            raise LLMError(f"{self.llm.name}: {type(exc).__name__}: {exc}") from exc
        usage: dict = {}
        for r in results:
            for k, v in r.usage.items():
                usage[k] = usage.get(k, 0) + v
        billed = any(r.billed for r in results) if results else self.llm.billed
        hold.book(sum(r.cost_usd for r in results), model=self.llm.model, billed=billed, usage=usage)
        return results


def make_llm(adapter: str | None = None, model: str | None = None, *, effort: str | None = None) -> Any:
    """Build the adapter named by ``KH_WORKER_LLM`` (or ``adapter``)."""
    adapter = (adapter or os.environ.get("KH_WORKER_LLM") or "anthropic").strip().lower()
    model = (model or os.environ.get("KH_WORKER_MODEL") or DEFAULT_MODEL).strip()
    effort = (effort or os.environ.get("KH_WORKER_EFFORT") or DEFAULT_EFFORT).strip()
    if adapter == "dry":
        return DryLLM.from_env(model)
    if adapter == "anthropic":
        fb = os.environ.get("KH_WORKER_FALLBACKS", "default").strip().lower() not in ("off", "0", "false", "")
        return AnthropicLLM(model, effort=effort, fallbacks=fb)
    if adapter in ("claude_cli", "claude-cli", "cli"):
        return ClaudeCliLLM(model, effort=effort,
                            timeout_s=float(os.environ.get("KH_WORKER_CLI_TIMEOUT_S", "900")))
    raise LLMConfigError(f"unknown KH_WORKER_LLM '{adapter}' (choose one of {', '.join(ADAPTERS)})")


__all__ = ["AnthropicLLM", "OAUTH_IDENTITY", "ClaudeCliLLM", "DryLLM", "LLMError", "LLMRefusal", "LLMConfigError", "LLMRequest",
           "LLMResult", "Metered", "make_llm", "parse_json_text", "instance_from_schema", "BudgetExceeded",
           "DEFAULT_MODEL", "ADAPTERS"]
