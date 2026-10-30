"""Observability of the line (design §8 e1, I18, I34): standard fields, cost per F-item, outcome metrics.

Standard fields (OBS_FIELDS) on every event and every model call:
    run, unit, f_item, role, agent_version, prompt_version, model, cost
  * events: ``event_obs(ev, ctx)`` derives them from the envelope, the unit row and the body; a slice
    that wants them stored on the event adds ``annotate(body, ...)`` (body["obs"] = {...}).
  * model calls: ``ObservedLlm`` wraps an LlmPort, measures latency and hands one row per call
    (fields + latency_ms, ok, op, key, ts_ms) to a sink (a list or a callable, e.g.
    AgentDirectory.record_call). The cost ledger stays the llm_call records of the caps wrapper;
    ObservedLlm never writes llm_call rows (that would double the spend).

Roll-ups, all computed from the Store (events + records), never from model text:
  cost_per_f_item(store, run)    llm_call usd attributed by key: "<unit>.<n>" / "<unit>#<n>" -> the
                                 unit's F-items (split evenly); an F-item id key (test author) ->
                                 that F-item; anything else (readers, planner, judge ...) is shared
                                 and spread over the F-items by size weight (S1 M2 L4).
  outcome_metrics(store, run)    lead time per F-item (spec.frozen -> the QAS green that stayed),
                                 first-pass yield, escalation rate, rework count, QAS flaky rate,
                                 QAS first-time green, cost.
  metrics_payload(store, ...)    the GET /api/metrics document (METRICS_SPEC).
  push_metrics(rag, payload)     RagPort.metric(name, value, dims) per number; absent / down -> 0 sent.

Hooks for the integrator:
  on_run_end(ctx, run) -> payload      pipeline.drive, in the finally block after _finish():
                                       computes the run's metrics and pushes them when the
                                       ``obs_enabled`` flag is on; returns {} when off.
  handle_metrics(store, query) -> (200, payload)   server.py: GET /api/metrics[?run=&limit=]
  wrap_llm(llm, cfg, sink, **fields)   the pipeline's LlmPort, observed (returns llm unchanged when off).
"""

from __future__ import annotations

import hashlib
import os
import re
import time
from typing import Any, Callable, Dict, List, Mapping, Optional, Sequence, Tuple

from . import codes
from .contracts import (E_FITEM, E_LLM_CALL, E_QAS, E_RUN, E_UNIT, SIZE_WEIGHTS, TERMINAL_RUN_STATES, Event,
                        now_ms)

OBS_FIELDS: Tuple[str, ...] = ("run", "unit", "f_item", "role", "agent_version", "prompt_version", "model", "cost")

#: proposed config key: obs_enabled (bool, default False); read like learn settings
OBS_SETTINGS = {"obs_enabled": False}

SPEC_VERSION = "line.metrics/1"

#: GET /api/metrics  ->  200 application/json
METRICS_SPEC: Dict[str, Any] = {
    "path": "/api/metrics",
    "query": {"run": "optional run id: only that run", "limit": "optional, newest N runs (default 20)"},
    "response": {
        "spec": SPEC_VERSION,
        "generated_ms": "int",
        "runs": [{
            "run": "str", "state": "str", "final": "bool",
            "lead_time_ms": "int|null  admitted -> green/escalated",
            "f_items": {"<F-item id>": {"lead_time_ms": "int|null  spec.frozen -> QAS green that stayed",
                                        "usd": "float  direct + shared", "usd_direct": "float",
                                        "usd_shared": "float", "rework": "int", "qas_first_green": "bool|null"}},
            "units": "int", "first_pass_yield": "float|null", "escalation_rate": "float|null",
            "rework_count": "int", "qas_flaky_rate": "float|null", "qas_first_green_rate": "float|null",
            "usd": "float", "usd_by_role": {"<role>": "float"}, "calls_by_role": {"<role>": "int"},
            "escalated": "bool",
        }],
        "totals": {"runs": "int", "green": "int", "escalated": "int", "usd": "float",
                   "first_pass_yield": "float|null", "escalation_rate": "float|null",
                   "qas_flaky_rate": "float|null", "rework_count": "int",
                   "usd_per_f_item": "float|null", "lead_time_ms_p50": "int|null"},
    },
    "metric_names": ["line.first_pass_yield", "line.escalation_rate", "line.rework_count", "line.qas_flaky_rate",
                     "line.usd", "line.lead_time_ms", "line.f_item.usd", "line.f_item.lead_time_ms"],
}

# ------------------------------------------------------------------ fields

#: event kind -> role that acts in it (control-plane events: "line")
KIND_ROLE: Dict[str, str] = {
    codes.SPEC_FROZEN: "ingest", codes.DIGEST_DONE: "reader", codes.RECONCILE_DIVERGED: "reader",
    codes.TESTS_APPROVED: "test_author", codes.GRAPH_VALID: "planner", codes.UNIT_DISPATCHED: "builder",
    codes.UNIT_SUBMITTED: "builder", codes.UNIT_BLOCKED: "builder", codes.VERIFY_FAILED: "verifier",
    codes.UNIT_MERGED: "merge_queue", codes.DEPLOY_DONE: "deployer", codes.QAS_RESULT: "qas_runner",
}

_KEY_RX = re.compile(r"^(.+?)(?:#(\d+)|/attempt(\d+)|\.(\d+))?$")


def prompt_version(role: str) -> str:
    """sha256[:12] of llm/prompts/<role>.md, "" when the role has no prompt file."""
    from .llm.port import PROMPTS_DIR
    path = os.path.join(PROMPTS_DIR, role + ".md")
    try:
        with open(path, "rb") as fh:
            return hashlib.sha256(fh.read()).hexdigest()[:12]
    except OSError:
        return ""


def obs_fields(run: str, unit: str = "", f_item: str = "", role: str = "", agent_version: str = "",
               prompt_version: str = "", model: str = "", cost: float = 0.0) -> Dict[str, Any]:
    return {"run": run, "unit": unit, "f_item": f_item, "role": role, "agent_version": agent_version,
            "prompt_version": prompt_version, "model": model, "cost": round(float(cost or 0.0), 6)}


def annotate(body: Optional[Mapping[str, Any]], **fields: Any) -> Dict[str, Any]:
    """body + {"obs": standard fields} (missing fields as "" / 0.0)."""
    out = dict(body or {})
    obs = obs_fields(**{k: fields.get(k, "" if k != "cost" else 0.0) for k in OBS_FIELDS})
    out["obs"] = obs
    return out


def missing_fields(obs: Mapping[str, Any]) -> List[str]:
    return [k for k in OBS_FIELDS if k not in obs]


def event_obs(ev: Event, units: Optional[Mapping[str, Mapping[str, Any]]] = None) -> Dict[str, Any]:
    """Standard fields for a stored event: body["obs"] when the slice annotated it, else derived."""
    if isinstance(ev.body.get("obs"), Mapping):
        return obs_fields(**{k: ev.body["obs"].get(k, "" if k != "cost" else 0.0) for k in OBS_FIELDS})
    u = (units or {}).get(ev.env.unit) or {}
    f_items = list(u.get("f_items") or [])
    f_item = str(ev.body.get("f_item") or (f_items[0] if len(f_items) == 1 else ",".join(f_items)))
    role = str(ev.body.get("role") or KIND_ROLE.get(ev.kind, "line"))
    if role == "builder" and int(u.get("fixer_gen", 0) or 0) > 0:
        role = "fixer"
    cost = ev.body.get("usd", 0.0)
    try:
        cost = float(cost or 0.0)
    except (TypeError, ValueError):
        cost = 0.0
    return obs_fields(ev.env.run, ev.env.unit, f_item, role, ev.env.agent_version,
                      prompt_version(role) if role in ("reader_a", "reader_b", "test_author", "planner", "builder",
                                                       "distiller", "eval_judge") else "",
                      ev.env.model, cost)


def _setting(cfg: Any, name: str, default: Any) -> Any:
    from .learn import setting
    return setting(cfg, name, default)


# ------------------------------------------------------------------ observed LLM


class ObservedLlm:
    """LlmPort wrapper: one observation row per call to ``sink`` (list.append or callable).
    Errors are re-raised after their row is written (ok False, code)."""

    def __init__(self, llm: Any, sink: Any = None, *, run: str = "", unit: str = "", f_item: str = "",
                 agent_version: str = "", prompt_versions: Optional[Mapping[str, str]] = None,
                 clock: Callable[[], float] = time.monotonic):
        self.llm = llm
        self.sink = sink if sink is not None else []
        self.fields = {"run": run, "unit": unit, "f_item": f_item, "agent_version": agent_version}
        self.prompt_versions = dict(prompt_versions or {})
        self.clock = clock

    def bind(self, **fields: Any) -> "ObservedLlm":
        o = ObservedLlm(self.llm, self.sink, prompt_versions=self.prompt_versions, clock=self.clock,
                        **dict(self.fields, **{k: v for k, v in fields.items() if k in self.fields}))
        return o

    def __getattr__(self, name: str) -> Any:
        return getattr(self.llm, name)

    def _unit_from_key(self, key: str) -> str:
        m = _KEY_RX.match(key or "")
        return m.group(1) if m and (m.group(2) or m.group(3) or m.group(4)) else ""

    def _observe(self, op: str, role: str, key: str, run: str, model: Optional[str], fn: Callable[[], Any]) -> Any:
        t0 = self.clock()
        ok, code, res = True, "", None
        try:
            res = fn()
            return res
        except Exception as e:   # noqa: BLE001 - recorded, then re-raised
            ok, code = False, str(getattr(e, "code", type(e).__name__))
            raise
        finally:
            pv = self.prompt_versions.get(role)
            if pv is None:
                pv = self.prompt_versions[role] = prompt_version(role)
            row = obs_fields(run or self.fields["run"], self.fields["unit"] or self._unit_from_key(key),
                             self.fields["f_item"], role, self.fields["agent_version"], pv,
                             (getattr(res, "model", "") or model or ""), getattr(res, "usd", 0.0) if res else 0.0)
            row.update(op=op, key=key, ok=ok, code=code, latency_ms=int((self.clock() - t0) * 1000), ts_ms=now_ms())
            try:
                if callable(self.sink):
                    self.sink(row)
                else:
                    self.sink.append(row)
            except Exception:   # noqa: BLE001 - observing never breaks a call
                pass

    def complete(self, role: str, prompt: str, schema: Optional[Mapping[str, Any]] = None, *, key: str = "",
                 model: Optional[str] = None, run: str = "") -> Any:
        return self._observe("complete", role, key, run, model,
                             lambda: self.llm.complete(role, prompt, schema, key=key, model=model, run=run))

    def agentic(self, role: str, workdir: str, prompt: str, max_turns: int, usd_cap: float, *, key: str = "",
                model: Optional[str] = None, run: str = "") -> Any:
        return self._observe("agentic", role, key, run, model,
                             lambda: self.llm.agentic(role, workdir, prompt, max_turns, usd_cap, key=key,
                                                      model=model, run=run))


def wrap_llm(llm: Any, cfg: Any = None, sink: Any = None, **fields: Any) -> Any:
    """ObservedLlm around llm when obs_enabled, else llm itself."""
    if not _setting(cfg, "obs_enabled", False):
        return llm
    return ObservedLlm(llm, sink, agent_version=str(getattr(cfg, "agent_version", "") or ""), **fields)


# ------------------------------------------------------------------ cost per F-item


def _f_items(store: Any, run: str, units: Sequence[Mapping[str, Any]]) -> Dict[str, str]:
    """F-item id -> size (records, else the units' F-items with size M)."""
    out = {str(f.get("id")): str(f.get("size") or "M") for f in store.query(E_FITEM, run=run) if f.get("id")}
    for u in units:
        for f in u.get("f_items") or []:
            out.setdefault(str(f), "M")
    return out


def cost_per_f_item(store: Any, run: str) -> Dict[str, Any]:
    """{"f_items": {F: {"usd_direct","usd_shared","usd","by_role"}}, "shared": usd, "unattributed": usd,
    "usd": total, "by_role": {role: usd}, "calls_by_role": {role: n}}"""
    units = store.query(E_UNIT, run=run)
    by_id = {str(u.get("id")): u for u in units}
    fsize = _f_items(store, run, units)
    res: Dict[str, Any] = {"f_items": {f: {"usd_direct": 0.0, "usd_shared": 0.0, "usd": 0.0, "by_role": {}}
                                       for f in fsize},
                           "shared": 0.0, "unattributed": 0.0, "usd": 0.0, "by_role": {}, "calls_by_role": {}}
    shared_rows: List[Tuple[str, float]] = []

    def add(f: str, role: str, usd: float, kind: str) -> None:
        d = res["f_items"][f]
        d["usd_" + kind] += usd
        d["by_role"][role] = d["by_role"].get(role, 0.0) + usd

    for row in store.query(E_LLM_CALL, run=run):
        usd = float(row.get("usd") or 0.0)
        role = str(row.get("role") or "")
        key = str(row.get("key") or "")
        res["usd"] += usd
        res["by_role"][role] = res["by_role"].get(role, 0.0) + usd
        res["calls_by_role"][role] = res["calls_by_role"].get(role, 0) + 1
        if key in fsize:
            add(key, role, usd, "direct")
            continue
        m = _KEY_RX.match(key)
        base = m.group(1) if m else ""
        fs = [f for f in (by_id.get(base, {}).get("f_items") or []) if f in fsize] if base in by_id else []
        if fs:
            for f in fs:
                add(f, role, usd / len(fs), "direct")
        else:
            shared_rows.append((role, usd))
    weights = {f: SIZE_WEIGHTS.get(s, 2) for f, s in fsize.items()}
    total_w = float(sum(weights.values()))
    for role, usd in shared_rows:
        if total_w <= 0:
            res["unattributed"] += usd
            continue
        res["shared"] += usd
        for f, w in weights.items():
            add(f, role, usd * w / total_w, "shared")
    for d in res["f_items"].values():
        d["usd"] = d["usd_direct"] + d["usd_shared"]
        for k in ("usd_direct", "usd_shared", "usd"):
            d[k] = round(d[k], 6)
        d["by_role"] = {k: round(v, 6) for k, v in d["by_role"].items()}
    for k in ("shared", "unattributed", "usd"):
        res[k] = round(res[k], 6)
    res["by_role"] = {k: round(v, 6) for k, v in res["by_role"].items()}
    return res


# ------------------------------------------------------------------ outcome metrics


def _rate(num: int, den: int) -> Optional[float]:
    return round(num / den, 4) if den else None


def outcome_metrics(store: Any, run: str) -> Dict[str, Any]:
    """The run's outcome metrics (see METRICS_SPEC "runs" item)."""
    row = store.get(E_RUN, run) or {}
    events = store.events_after(0, run=run, limit=100000)
    units = store.query(E_UNIT, run=run)
    cost = cost_per_f_item(store, run)
    t_admit = next((e.ts_ms for e in events if e.kind == codes.RUN_ADMITTED), row.get("created_ms") or None)
    t_frozen = next((e.ts_ms for e in events if e.kind == codes.SPEC_FROZEN), t_admit)
    t_end = next((e.ts_ms for e in reversed(events) if e.kind in (codes.RUN_GREEN, codes.ESCALATED)
                  and not e.env.unit), None)
    # QAS: per F-item the verdict sequence; lead time ends at the green that was not followed by red
    seq: Dict[str, List[Tuple[str, int]]] = {}
    for e in events:
        if e.kind == codes.QAS_RESULT and e.body.get("f_item"):
            seq.setdefault(str(e.body["f_item"]), []).append((str(e.body.get("verdict", "")), e.ts_ms))
    if not seq:
        for q in store.query(E_QAS, run=run):
            seq.setdefault(str(q.get("f_item")), []).append((str(q.get("verdict", "")), int(q.get("ts_ms") or 0)))
    lead: Dict[str, Optional[int]] = {}
    first_green: Dict[str, Optional[bool]] = {}
    flaky = total_q = 0
    for f, vs in seq.items():
        total_q += len(vs)
        flaky += sum(1 for v, _ in vs if v == "flaky")
        first_green[f] = vs[0][0] == "green" if vs else None
        green_at = None
        for v, ts in vs:
            if v == "green" and green_at is None:
                green_at = ts
            elif v == "red":
                green_at = None
        lead[f] = (green_at - t_frozen) if green_at is not None and t_frozen is not None else None
    normal = [u for u in units if not int(u.get("fixer_gen", 0) or 0)]
    final = [u for u in normal if u.get("state") in ("merged", "failed")]
    first_pass = [u for u in final if u.get("state") == "merged" and int(u.get("attempt", 1) or 1) <= 1]
    failed = [u for u in units if u.get("state") == "failed"]
    fixers = [u for u in units if int(u.get("fixer_gen", 0) or 0) > 0]
    rework_by_f: Dict[str, int] = {}
    for u in units:
        r = max(int(u.get("attempt", 0) or 0) - 1, 0) + (1 if int(u.get("fixer_gen", 0) or 0) > 0 else 0)
        for f in u.get("f_items") or []:
            rework_by_f[f] = rework_by_f.get(f, 0) + r
    rework = sum(max(int(u.get("attempt", 0) or 0) - 1, 0) for u in units) + len(fixers)
    f_ids = sorted(set(cost["f_items"]) | set(seq))
    f_out = {}
    for f in f_ids:
        c = cost["f_items"].get(f, {"usd": 0.0, "usd_direct": 0.0, "usd_shared": 0.0})
        f_out[f] = {"lead_time_ms": lead.get(f), "usd": c["usd"], "usd_direct": c["usd_direct"],
                    "usd_shared": c["usd_shared"], "rework": rework_by_f.get(f, 0),
                    "qas_first_green": first_green.get(f)}
    fg = [v for v in first_green.values() if v is not None]
    return {
        "run": run, "state": row.get("state", ""), "final": row.get("state") in TERMINAL_RUN_STATES,
        "lead_time_ms": (t_end - t_admit) if t_end is not None and t_admit is not None else None,
        "f_items": f_out, "units": len(units),
        "first_pass_yield": _rate(len(first_pass), len(final)),
        "escalation_rate": _rate(len(failed), len(units)),
        "rework_count": rework, "qas_flaky_rate": _rate(flaky, total_q),
        "qas_first_green_rate": _rate(sum(1 for v in fg if v), len(fg)),
        "usd": cost["usd"], "usd_by_role": cost["by_role"], "calls_by_role": cost["calls_by_role"],
        "escalated": row.get("state") == "escalated",
        "_counts": {"final": len(final), "first_pass": len(first_pass), "failed": len(failed), "flaky": flaky,
                    "qas": total_q},
    }


def _p50(xs: List[int]) -> Optional[int]:
    xs = sorted(x for x in xs if x is not None)
    return xs[len(xs) // 2] if xs else None


def metrics_payload(store: Any, run: str = "", limit: int = 20, now: Optional[int] = None) -> Dict[str, Any]:
    """The GET /api/metrics document (METRICS_SPEC)."""
    if run:
        ids = [run] if store.get(E_RUN, run) is not None else []
    else:
        rows = sorted(store.query(E_RUN), key=lambda r: int(r.get("created_ms") or 0), reverse=True)
        ids = [r["id"] for r in rows[:max(int(limit), 1)]]
    runs = [outcome_metrics(store, r) for r in ids]
    c = {"final": 0, "first_pass": 0, "failed": 0, "flaky": 0, "qas": 0}
    units = 0
    f_usd: List[float] = []
    leads: List[int] = []
    for m in runs:
        for k in c:
            c[k] += m["_counts"][k]
        units += m["units"]
        f_usd += [f["usd"] for f in m["f_items"].values()]
        leads += [f["lead_time_ms"] for f in m["f_items"].values() if f["lead_time_ms"] is not None]
    totals = {"runs": len(runs), "green": sum(1 for m in runs if m["state"] == "green"),
              "escalated": sum(1 for m in runs if m["escalated"]),
              "usd": round(sum(m["usd"] for m in runs), 6),
              "first_pass_yield": _rate(c["first_pass"], c["final"]), "escalation_rate": _rate(c["failed"], units),
              "qas_flaky_rate": _rate(c["flaky"], c["qas"]), "rework_count": sum(m["rework_count"] for m in runs),
              "usd_per_f_item": round(sum(f_usd) / len(f_usd), 6) if f_usd else None,
              "lead_time_ms_p50": _p50(leads)}
    for m in runs:
        m.pop("_counts", None)
    return {"spec": SPEC_VERSION, "generated_ms": int(now if now is not None else now_ms()), "runs": runs,
            "totals": totals}


def push_metrics(rag: Any, payload: Mapping[str, Any]) -> int:
    """RagPort.metric for every number of every run in payload. Returns how many were sent."""
    if rag is None:
        return 0
    sent = 0

    def put(name: str, value: Any, dims: Mapping[str, Any]) -> bool:
        nonlocal sent
        if value is None:
            return True
        try:
            rag.metric(name, float(value), dict(dims))
            sent += 1
            return True
        except Exception:   # noqa: BLE001 - metrics are best effort; the resilient port queues them
            return False

    for m in payload.get("runs") or []:
        dims = {"run": m["run"], "state": m["state"]}
        for name, k in (("line.first_pass_yield", "first_pass_yield"), ("line.escalation_rate", "escalation_rate"),
                        ("line.rework_count", "rework_count"), ("line.qas_flaky_rate", "qas_flaky_rate"),
                        ("line.usd", "usd"), ("line.lead_time_ms", "lead_time_ms")):
            if not put(name, m.get(k), dims):
                return sent
        for f, d in (m.get("f_items") or {}).items():
            fd = dict(dims, f_item=f)
            if not put("line.f_item.usd", d.get("usd"), fd) or not put("line.f_item.lead_time_ms",
                                                                       d.get("lead_time_ms"), fd):
                return sent
    return sent


# ------------------------------------------------------------------ hooks


def on_run_end(ctx: Any, run: str) -> Dict[str, Any]:
    """pipeline.drive, finally block after _finish(): metrics of the finished run, pushed to the
    RAG System (RagPort.metric) when obs_enabled. Returns the payload, {} when disabled. Never raises."""
    cfg = getattr(ctx, "cfg", None)
    if not _setting(cfg, "obs_enabled", False):
        return {}
    try:
        payload = metrics_payload(ctx.store, run=run)
        rag = None
        try:
            rag = getattr(ctx, "rag", None)
        except Exception:   # noqa: BLE001 - lazy RAG construction may fail
            rag = None
        payload["pushed"] = push_metrics(rag, payload)
        return payload
    except Exception as e:   # noqa: BLE001 - observability never breaks a run
        return {"error": "%s: %s" % (type(e).__name__, e)}


def handle_metrics(store: Any, query: Optional[Mapping[str, Any]] = None) -> Tuple[int, Dict[str, Any]]:
    """server.py GET /api/metrics: (200, payload). query values may be lists (parse_qs)."""
    q = dict(query or {})

    def one(k: str, d: str = "") -> str:
        v = q.get(k, d)
        return str(v[0] if isinstance(v, (list, tuple)) and v else v)

    try:
        limit = int(one("limit", "20") or 20)
    except ValueError:
        limit = 20
    return 200, metrics_payload(store, run=one("run"), limit=limit)


__all__ = ["OBS_FIELDS", "METRICS_SPEC", "SPEC_VERSION", "obs_fields", "annotate", "missing_fields", "event_obs",
           "prompt_version", "ObservedLlm", "wrap_llm", "cost_per_f_item", "outcome_metrics", "metrics_payload",
           "push_metrics", "on_run_end", "handle_metrics"]
