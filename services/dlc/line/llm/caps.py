"""Cost caps, ledger and answer validation around an LLM backend.

CappedLlm implements contracts.LlmPort on top of a backend (fake / cli / api):

  before a call   estimate USD from the prompt size and pricing.json; raise
                  LineError(BUDGET_EXCEEDED) when the estimate exceeds
                  LINE_MAX_USD_CALL, the caller's usd_cap (agentic) or what is
                  left of LINE_MAX_USD_RUN for that run. The backend is not called.
  after a call    the real USD (backend's own figure, else priced from usage) goes
                  on the ledger: an in-memory list and, with a store, one
                  "llm_call" record per call {"role","model","usd","usage","key",...}.
                  Run spend = sum of the run's llm_call records (survives restarts).
  complete+schema the answer is parsed (code fences tolerated) and checked against a
                  JSON-Schema subset (type/required/properties/items/enum); on failure
                  ONE repair call is made, then LineError(SCHEMA_INVALID).

Backend interface (duck-typed):
  name: str;  overhead_tokens: int  (input tokens the backend adds, for the estimate)
  raw_complete(role, prompt, model, key, repair=False) -> LlmResult (text, usage, usd)
  raw_agentic(role, workdir, prompt, model, max_turns, usd_cap, key) -> LlmResult (+outcome)
A backend that fails after spending money raises LineError with detail["usd"] (and
"usage"); the wrapper records that spend before re-raising.
"""

from __future__ import annotations

import copy
import hashlib
import json
import math
import os
import re
import threading
import uuid
from typing import Any, Callable, Dict, List, Mapping, Optional, Tuple

from .. import codes
from ..codes import LineError
from ..contracts import E_LLM_CACHE, E_LLM_CALL, LlmResult, now_ms

#: Roles whose answer depends on the prompt alone (they read the frozen spec): the same prompt is answered from
#: the store, not paid again (a retried or resumed run of the same pack). Roles that write tests or code never are:
#: a wrong answer there must be asked again, not replayed.
CACHE_ROLES = frozenset({"reader_a", "reader_b", "reader_reread", "fgraph"})

#: Output tokens assumed for one complete() answer / one agentic turn (also the API max_tokens).
COMPLETE_MAX_TOKENS = 8192
#: Characters per token used for the input estimate (conservative: real text is ~3.5-4).
CHARS_PER_TOKEN = 3.0

#: Used when pricing.json lacks the default model (USD per million tokens).
DEFAULT_PRICES: Dict[str, Dict[str, float]] = {
    "claude-opus-5-5": {"input": 4.0, "output": 20.0, "cacheWrite5m": 5.0, "cacheWrite1h": 8.0, "cacheRead": 0.4},
}

USAGE_KEYS = ("input", "output", "cacheWrite", "cacheRead")


# ================================================================== pricing


#: roles whose one call is a whole request (line.solo): LINE_MAX_USD_CALL does not apply, their usd_cap does
WHOLE_REQUEST_ROLES = frozenset({"solo", "solo_lead"})

class Pricing:
    """USD per million tokens, read from pricing.json (same format and lookup as SDLC llm.py:
    aliases, then the longest model key the id starts with). Unknown models are priced at the
    most expensive known row, so an unpriced model can never slip under a cap."""

    def __init__(self, path: Optional[str] = None, data: Optional[Mapping[str, Any]] = None):
        if data is None:
            data = {}
            if path and os.path.isfile(path):
                try:
                    with open(path, encoding="utf-8") as fh:
                        data = json.load(fh)
                except (OSError, ValueError):
                    data = {}
        self.models: Dict[str, Dict[str, float]] = {str(k).lower(): dict(v) for k, v in
                                                    dict(data.get("models") or {}).items()}
        self.aliases: Dict[str, str] = {str(k).lower(): str(v).lower() for k, v in
                                        dict(data.get("aliases") or {}).items()}
        for k, v in DEFAULT_PRICES.items():
            self.models.setdefault(k, dict(v))

    def row(self, model: str) -> Dict[str, float]:
        mid = str(model or "").lower()
        mid = self.aliases.get(mid, mid)
        best = None
        for key in self.models:
            if mid.startswith(key) and (best is None or len(key) > len(best)):
                best = key
        if best:
            return self.models[best]
        return max(self.models.values(), key=lambda r: (float(r.get("output", 0)), float(r.get("input", 0))))

    def usd(self, model: str, usage: Mapping[str, Any]) -> float:
        p = self.row(model)
        return (int(usage.get("input") or 0) * float(p.get("input", 0))
                + int(usage.get("output") or 0) * float(p.get("output", 0))
                + int(usage.get("cacheWrite") or 0) * float(p.get("cacheWrite5m", p.get("input", 0)))
                + int(usage.get("cacheRead") or 0) * float(p.get("cacheRead", 0))) / 1e6

    def estimate(self, model: str, prompt: str, overhead_tokens: int = 0,
                 out_tokens: int = COMPLETE_MAX_TOKENS) -> float:
        tin = int(math.ceil(len(prompt or "") / CHARS_PER_TOKEN)) + int(overhead_tokens or 0)
        return self.usd(model, {"input": tin, "output": out_tokens})


# ================================================================== schema-lite

_TYPES: Dict[str, Callable[[Any], bool]] = {
    "object": lambda v: isinstance(v, dict),
    "array": lambda v: isinstance(v, list),
    "string": lambda v: isinstance(v, str),
    "integer": lambda v: isinstance(v, int) and not isinstance(v, bool),
    "number": lambda v: isinstance(v, (int, float)) and not isinstance(v, bool),
    "boolean": lambda v: isinstance(v, bool),
    "null": lambda v: v is None,
}


def validate(data: Any, schema: Optional[Mapping[str, Any]], path: str = "$") -> List[str]:
    """Errors of ``data`` against a JSON-Schema subset (type, required, properties, items, enum).
    [] means valid. Unknown keywords are ignored."""
    if not schema:
        return []
    errs: List[str] = []
    t = schema.get("type")
    if t is not None:
        names = [t] if isinstance(t, str) else list(t)
        if not any(_TYPES.get(n, lambda v: True)(data) for n in names):
            return ["%s: expected %s, got %s" % (path, "|".join(names), type(data).__name__)]
    if "enum" in schema and data not in list(schema["enum"]):
        errs.append("%s: %r not in enum %r" % (path, data, list(schema["enum"])))
    if isinstance(data, dict):
        for k in schema.get("required") or []:
            if k not in data:
                errs.append("%s: missing required %r" % (path, k))
        for k, sub in (schema.get("properties") or {}).items():
            if k in data:
                errs.extend(validate(data[k], sub, "%s.%s" % (path, k)))
    if isinstance(data, list) and isinstance(schema.get("items"), Mapping):
        for i, v in enumerate(data):
            errs.extend(validate(v, schema["items"], "%s[%d]" % (path, i)))
    return errs


_FENCE = re.compile(r"```(?:json|JSON)?\s*\n(.*?)\n?```", re.S)


def parse_json(text: str) -> Tuple[Any, str]:
    """(value, "") or (None, error). Accepts bare JSON, a ```json fenced block, or the first
    {...}/[...] span in surrounding prose."""
    s = (text or "").strip()
    if not s:
        return None, "empty answer"
    candidates = [s]
    candidates += [m.group(1).strip() for m in _FENCE.finditer(s)]
    for open_c, close_c in (("{", "}"), ("[", "]")):
        i, j = s.find(open_c), s.rfind(close_c)
        if 0 <= i < j:
            candidates.append(s[i:j + 1])
    err = ""
    for c in candidates:
        try:
            return json.loads(c), ""
        except ValueError as e:
            err = err or str(e)
    return None, "not JSON: " + err


def check_answer(text: str, schema: Mapping[str, Any]) -> Tuple[Any, List[str]]:
    data, err = parse_json(text)
    if err:
        return None, [err]
    return data, validate(data, schema)


def schema_instruction(schema: Mapping[str, Any]) -> str:
    return ("\n\nAnswer with ONLY one JSON value (no prose, no code fence) that matches this JSON schema:\n"
            + json.dumps(schema, indent=1, sort_keys=True))


def repair_prompt(prompt: str, schema: Mapping[str, Any], answer: str, errors: List[str]) -> str:
    return (prompt + "\n\n---\nYour previous answer was rejected:\n- " + "\n- ".join(errors[:20])
            + "\n\nPrevious answer:\n" + (answer or "")[:6000]
            + "\n\nReply again with ONLY the corrected JSON value matching this schema:\n"
            + json.dumps(schema, indent=1, sort_keys=True))


# ================================================================== wrapper


def _usage(u: Optional[Mapping[str, Any]]) -> Dict[str, int]:
    u = u or {}
    return {k: int(u.get(k) or 0) for k in USAGE_KEYS}


def _add_usage(a: Mapping[str, Any], b: Mapping[str, Any]) -> Dict[str, int]:
    return {k: int(a.get(k) or 0) + int(b.get(k) or 0) for k in USAGE_KEYS}


def _board(run: str, role: str) -> str:
    if not run:
        return ""
    try:
        from ..runboard import section
        return section(run, role)
    except Exception:   # noqa: BLE001 - the board helps; it never fails a call
        return ""


def _persona(config: Any, role: str) -> str:
    """How this role works (line.personas): every role's persona rules and open findings, in front of every call,
    so a new agent learns by the same mechanism as the others with no code of its own."""
    try:
        from ..personas import block
        return block(config, role)
    except Exception:   # noqa: BLE001 - the persona helps; it never fails a call
        return ""


class CappedLlm:
    """LlmPort: caps + ledger + schema validation around one backend."""

    def __init__(self, backend: Any, config: Any, store: Any = None, pricing: Optional[Pricing] = None):
        self.backend = backend
        self.config = config
        self.store = store
        self.pricing = pricing or Pricing(getattr(config, "pricing", None))
        self.max_usd_call = float(getattr(config, "max_usd_call", 0) or 0)
        self.max_usd_run = float(getattr(config, "max_usd_run", 0) or 0)
        self.ledger: List[Dict[str, Any]] = []
        self._reserved: Dict[str, float] = {}
        self._lock = threading.RLock()

    # ---------------------------------------------------------- ledger

    def cancel(self) -> None:
        """Kill the backend's calls in flight and refuse new ones (backend.cancel(), when it has one)."""
        fn = getattr(self.backend, "cancel", None)
        if callable(fn):
            fn()

    def spent(self, run: str = "") -> float:
        """USD already spent by ``run`` (store records when a store is given, else in-memory)."""
        with self._lock:
            if self.store is not None:
                rows = self.store.query(E_LLM_CALL, run=run)
            else:
                rows = [r for r in self.ledger if r.get("run", "") == run]
            return float(sum(float(r.get("usd") or 0.0) for r in rows))

    def remaining(self, run: str = "") -> float:
        with self._lock:
            return self.max_usd_run - self.spent(run) - self._reserved.get(run, 0.0)

    def _record(self, op: str, role: str, key: str, model: str, run: str, usd: float,
                usage: Mapping[str, Any], estimate: float, ok: bool, extra: Optional[Mapping[str, Any]] = None) -> None:
        row = {"run": run, "op": op, "role": role, "key": key, "model": model, "usd": round(float(usd), 6),
               "usage": _usage(usage), "estimate": round(float(estimate), 6), "ok": bool(ok),
               "backend": getattr(self.backend, "name", ""), "ts_ms": now_ms()}
        row.update(dict(extra or {}))
        with self._lock:
            self.ledger.append(row)
            if self.store is not None:
                self.store.put(E_LLM_CALL, "%s:%s" % (run or "-", uuid.uuid4().hex[:16]), row, run=run)

    # ---------------------------------------------------------- caps

    def _admit(self, op: str, role: str, key: str, model: str, run: str, estimate: float,
               usd_cap: Optional[float] = None) -> float:
        """Check caps and reserve ``estimate``; returns the hard ceiling for this call."""
        detail = {"op": op, "role": role, "key": key, "model": model, "run": run, "estimate": round(estimate, 6)}
        if usd_cap is not None and usd_cap > 0 and estimate > usd_cap:
            raise LineError(codes.BUDGET_EXCEEDED, "call estimate $%.4f over usd_cap $%.4f" % (estimate, usd_cap),
                            dict(detail, cap=usd_cap, limit="usd_cap"))
        # the solo agent does a whole request in one call: its own cap (Config.solo_max_usd) replaces the per-call cap
        call_cap = 0.0 if role in WHOLE_REQUEST_ROLES else self.max_usd_call
        if call_cap > 0 and estimate > call_cap:
            raise LineError(codes.BUDGET_EXCEEDED,
                            "call estimate $%.4f over LINE_MAX_USD_CALL $%.4f" % (estimate, self.max_usd_call),
                            dict(detail, cap=self.max_usd_call, limit="max_usd_call"))
        with self._lock:
            spent = self.spent(run)
            reserved = self._reserved.get(run, 0.0)
            if self.max_usd_run > 0 and spent + reserved + estimate > self.max_usd_run + 1e-9:
                raise LineError(codes.BUDGET_EXCEEDED,
                                "run %r would exceed LINE_MAX_USD_RUN $%.4f (spent $%.4f, in flight $%.4f, estimate $%.4f)"
                                % (run, self.max_usd_run, spent, reserved, estimate),
                                dict(detail, cap=self.max_usd_run, spent=round(spent, 6), reserved=round(reserved, 6),
                                     limit="max_usd_run"))
            self._reserved[run] = reserved + estimate
            ceilings = [c for c in (usd_cap, call_cap) if c is not None and c > 0]
            if self.max_usd_run > 0:
                ceilings.append(self.max_usd_run - spent - reserved)
            return min(ceilings) if ceilings else 0.0

    def _release(self, run: str, estimate: float) -> None:
        with self._lock:
            left = self._reserved.get(run, 0.0) - estimate
            if left <= 1e-12:
                self._reserved.pop(run, None)
            else:
                self._reserved[run] = left

    def _price(self, res: LlmResult, model: str) -> LlmResult:
        res.usage = _usage(res.usage)
        res.model = res.model or model
        if not res.usd and any(res.usage.values()):
            res.usd = self.pricing.usd(res.model, res.usage)
        res.usd = float(res.usd or 0.0)
        return res

    def _call(self, op: str, role: str, key: str, model: str, run: str, estimate: float,
              fn: Callable[[float], LlmResult], usd_cap: Optional[float] = None,
              extra: Optional[Mapping[str, Any]] = None) -> LlmResult:
        ceiling = self._admit(op, role, key, model, run, estimate, usd_cap)
        try:
            try:
                from ..agentcap import agent_slot
                with agent_slot(self.config):           # LINE_MAX_ACTIVE_AGENTS across every run
                    res = fn(ceiling)
            except LineError as e:
                usd = float(e.detail.get("usd") or 0.0)
                usage = e.detail.get("usage") or {}
                if usd or any(_usage(usage).values()):
                    usd = usd or self.pricing.usd(model, _usage(usage))
                    self._record(op, role, key, model, run, usd, usage, estimate, False,
                                 dict(extra or {}, error=e.code))
                raise
            except Exception as e:  # noqa: BLE001 - a backend bug crosses the boundary typed
                raise LineError(codes.LLM_ERROR, "%s backend failed: %s" % (getattr(self.backend, "name", "?"), e),
                                {"role": role, "key": key}) from e
            res = self._price(res, model)
            if op == "agentic" and (res.text or "").strip():      # what the agent says it did (node page summary)
                extra = dict(extra or {}, summary=(res.text or "").strip()[-1500:])
            self._record(op, role, key, res.model, run, res.usd, res.usage, estimate, True,
                         dict(extra or {}, outcome=res.outcome) if res.outcome else extra)
            return res
        finally:
            self._release(run, estimate)

    # ---------------------------------------------------------- LlmPort

    def _model(self, model: Optional[str], role: str = "") -> str:
        """The caller's model (retry ladder, agent directory) wins; then the role's model (Config.role_models);
        then the line's model."""
        if model:
            return model
        roles = getattr(self.config, "role_models", None) or {}
        return roles.get(role) or getattr(self.config, "model", "") or "claude-opus-5-5"

    def estimate(self, model: str, prompt: str) -> float:
        return self.pricing.estimate(model, prompt, getattr(self.backend, "overhead_tokens", 0))

    # ---------------------------------------------------------- answer cache (reading roles)

    def _cache_on(self, role: str) -> bool:
        if role not in CACHE_ROLES or self.store is None:
            return False
        mode = str(getattr(self.config, "llm_cache", "auto") or "auto").strip().lower()
        if mode in ("0", "off", "false", "no"):
            return False
        return mode in ("1", "on", "true", "yes") or str(getattr(self.config, "llm", "fake")) != "fake"

    @staticmethod
    def _cache_id(role: str, model: str, prompt: str) -> str:
        return hashlib.sha256(("%s\n%s\n%s" % (role, model, prompt)).encode("utf-8")).hexdigest()

    def _cached(self, role: str, key: str, model: str, run: str, prompt: str) -> Optional[LlmResult]:
        try:
            row = self.store.get(E_LLM_CACHE, self._cache_id(role, model, prompt))
        except Exception:   # noqa: BLE001 - the cache never fails a call
            return None
        days = float(getattr(self.config, "llm_cache_days", 30) or 30)
        if not row or row.get("void") or now_ms() - int(row.get("ts_ms") or 0) > days * 86_400_000:
            return None
        try:                        # the run that uses an answer last owns it: forget_cache(run) can void it
            self.store.put(E_LLM_CACHE, self._cache_id(role, model, prompt), row, run=run)
        except Exception:   # noqa: BLE001
            pass
        self._record("complete", role, key, model, run, 0.0, {}, 0.0, True,
                     {"cached": True, "saved_usd": round(float(row.get("usd") or 0.0), 6)})
        return LlmResult(row.get("data"), str(row.get("text") or ""), {}, 0.0, model, "")

    def _remember(self, role: str, model: str, prompt: str, res: LlmResult, run: str) -> None:
        cid = self._cache_id(role, model, prompt)
        try:
            self.store.put(E_LLM_CACHE, cid, {"id": cid, "role": role, "model": model, "data": res.data,
                                              "text": res.text, "usd": res.usd, "ts_ms": now_ms()}, run=run)
        except Exception:   # noqa: BLE001
            pass

    def forget_cache(self, run: str) -> int:
        """Void the cached answers `run` used last (it failed while reading: a retry must ask again, not replay
        the same misreading). Returns how many."""
        if self.store is None or not run:
            return 0
        n = 0
        try:
            for row in self.store.query(E_LLM_CACHE, run=run):
                if row.get("id") and not row.get("void"):
                    self.store.put(E_LLM_CACHE, row["id"], dict(row, void=True), run=run)
                    n += 1
        except Exception:   # noqa: BLE001
            return n
        return n

    def complete(self, role: str, prompt: str, schema: Optional[Mapping[str, Any]] = None, *,
                 key: str = "", model: Optional[str] = None, run: str = "") -> LlmResult:
        m = self._model(model, role)
        prompt = _persona(self.config, role) + prompt
        if role not in CACHE_ROLES:             # the readers read the spec alone (and stay cacheable)
            prompt = prompt + _board(run, role)
        full = prompt + schema_instruction(schema) if schema else prompt
        cache = self._cache_on(role)
        if cache:
            hit = self._cached(role, key, m, run, full)
            if hit is not None:
                return hit
        res = self._complete(role, full, schema, key, m, run)
        if cache:
            self._remember(role, m, full, res, run)
        return res

    def _complete(self, role: str, full: str, schema: Optional[Mapping[str, Any]], key: str, m: str,
                  run: str) -> LlmResult:
        res = self._call("complete", role, key, m, run, self.estimate(m, full),
                         lambda _c: self.backend.raw_complete(role, full, m, key, repair=False))
        if schema is None:
            res.data = None
            return res
        data, errs = check_answer(res.text, schema)
        if not errs:
            res.data = data
            return res
        fix = repair_prompt(full, schema, res.text, errs)
        res2 = self._call("complete", role, key, m, run, self.estimate(m, fix),
                          lambda _c: self.backend.raw_complete(role, fix, m, key, repair=True),
                          extra={"repair": True})
        total_usd = res.usd + res2.usd
        total_usage = _add_usage(res.usage, res2.usage)
        data2, errs2 = check_answer(res2.text, schema)
        if errs2:
            raise LineError(codes.SCHEMA_INVALID, "answer of %s/%s fails its schema after one repair" % (role, key),
                            {"role": role, "key": key, "errors": errs2[:20], "first_errors": errs[:20],
                             "text": (res2.text or "")[:2000], "usd": round(total_usd, 6), "usage": total_usage,
                             "recorded": True})
        out = copy.copy(res2)
        out.data, out.usd, out.usage = data2, total_usd, total_usage
        return out

    def agentic(self, role: str, workdir: str, prompt: str, max_turns: int, usd_cap: float, *,
                key: str = "", model: Optional[str] = None, run: str = "") -> LlmResult:
        from ..agent_tools import CURRENT
        m = self._model(model, role)
        prompt = _persona(self.config, role) + prompt + _board(run, role)   # + the run board (line.runboard)
        est = self.estimate(m, prompt)
        mark = CURRENT.set({"run": run, "role": role})     # the CLI backend gives this call its agent tools
        try:
            return self._call("agentic", role, key, m, run, est,
                              lambda ceiling: self.backend.raw_agentic(role, workdir, prompt, m, int(max_turns),
                                                                       ceiling, key),
                              usd_cap=float(usd_cap) if usd_cap else None)
        finally:
            CURRENT.reset(mark)
