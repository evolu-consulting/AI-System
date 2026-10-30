"""Agent directory (design §9 k1-k9): which agent version does a role's work, how a new version is
proven (shadow -> canary -> active) and when it is rolled back (SLO).

An agent version = role + version id + model + prompt version + tools + status:
    shadow   runs beside the active version on the same input; its output is compared, never used
    canary   gets a share of the units (agents_canary_ratio, design: 5%) of its role only
    active   the incumbent; runs are PINNED to the active version they started with (k9)
    retired  no new work; runs pinned to it keep it until they end (drain)

    d = AgentDirectory(LearnStore.for_config(cfg), cfg, store)
    d.ensure_defaults()                         # one active version per role from the config
    v = d.route("builder", run, unit)           # -> version row (model, prompt_version, tools, status)
    d.run_shadow("planner", llm, prompt, schema, primary_result, key="plan", run=run)
    d.record("builder", v["version"], success=True, usd=0.3, latency_ms=50_000, run=run, unit="U3")
    d.check_slo("builder", run=run)             # alerts as events; canary breach -> auto rollback
    d.auto_step("builder", run=run)             # shadow -> canary -> active when the evidence is there

Promotion gates (code, no human):
    shadow -> canary   >= agents_shadow_min comparisons and agreement >= agents_shadow_agree
    canary -> active   >= slo_min_sample samples, its SLO holds, and its success rate is not below the
                       active version's by more than agents_margin (non-inferior); the old active is
                       retired (pinned runs keep it)
    retire             refused when it would leave the role without an active version (N+1 rule)
SLO per (role, version) over the last slo_window samples: success rate >= slo_min_success,
escalation rate <= slo_max_escalation, usd per sample <= slo_max_usd_per_unit (0 = off),
latency p95 <= slo_max_latency_p95_s (0 = off). Checked only with >= slo_min_sample samples.

Hooks for the integrator:
    route(role, run, unit) -> version        before an LLM call: pass model=v["model"]; the prompt
                                             version is v["prompt_version"]
    on_run_end(ctx, run) -> summary          pipeline.drive finally block: samples of the run's
                                             attempts and model calls, SLO check, auto_step;
                                             {} unless agents_enabled
Event kinds AGENT_KINDS are registered in codes.W4_KINDS.
"""

from __future__ import annotations

import hashlib
import json
from dataclasses import asdict, dataclass, field
from typing import Any, Callable, Dict, List, Mapping, Optional, Sequence

from . import codes
from .codes import LineError
from .contracts import E_ATTEMPT, E_LLM_CALL, E_RUN, E_UNIT, Envelope, now_ms
from .learn import emit, setting
from .learn.lstore import LearnStore

STATUSES = ("active", "shadow", "canary", "retired")

AGENT_REGISTERED = "agent.registered"   # body: {"role", "version", "model", "prompt_version", "status"}
AGENT_PROMOTED = "agent.promoted"       # body: {"role", "version", "from", "to", "evidence"}
AGENT_SLO_BREACH = "agent.slo_breach"   # body: {"role", "version", "status", "breaches": [..], "slo": {..}}
AGENT_ROLLBACK = "agent.rollback"       # body: {"role", "version", "reason"}
AGENT_RETIRED = "agent.retired"         # body: {"role", "version"}
AGENT_KINDS = (AGENT_REGISTERED, AGENT_PROMOTED, AGENT_SLO_BREACH, AGENT_ROLLBACK, AGENT_RETIRED)

#: proposed config keys -> default
AGENT_SETTINGS: Dict[str, Any] = {
    "agents_enabled": False,
    "agents_canary_ratio": 0.05,
    "agents_shadow_min": 5,
    "agents_shadow_agree": 0.8,
    "agents_margin": 0.05,
    "slo_min_sample": 10,
    "slo_window": 50,
    "slo_min_success": 0.7,
    "slo_max_escalation": 0.2,
    "slo_max_usd_per_unit": 0.0,
    "slo_max_latency_p95_s": 0.0,
}

DEFAULT_ROLES = ("reader_a", "reader_b", "reader_reread", "test_author", "planner", "builder", "fixer",
                 "distiller", "eval_judge")
_ALT_ROLES = ("reader_b",)            # roles that run on the alternate model by default


@dataclass
class AgentVersion:
    role: str
    version: str
    model: str = ""
    prompt_version: str = ""
    tools: List[str] = field(default_factory=list)
    status: str = "shadow"
    created_ms: int = 0
    previous: str = ""                  # active version this one replaced (rollback target)
    detail: Dict[str, Any] = field(default_factory=dict)


def _s(cfg: Any, name: str) -> Any:
    return setting(cfg, name, AGENT_SETTINGS[name])


def _bucket(*parts: str) -> float:
    h = hashlib.sha256("|".join(parts).encode("utf-8")).hexdigest()
    return int(h[:8], 16) / float(0xFFFFFFFF)


def _p95(xs: Sequence[float]) -> float:
    xs = sorted(xs)
    if not xs:
        return 0.0
    return float(xs[min(int(round(0.95 * (len(xs) - 1))), len(xs) - 1)])


def default_compare(a: Any, b: Any) -> bool:
    """Shadow comparison: same parsed data (JSON, key order ignored), else same stripped text."""
    da, db = getattr(a, "data", None), getattr(b, "data", None)
    if da is not None or db is not None:
        return json.dumps(da, sort_keys=True) == json.dumps(db, sort_keys=True)
    return str(getattr(a, "text", a)).strip() == str(getattr(b, "text", b)).strip()


class AgentDirectory:
    def __init__(self, lstore: Optional[LearnStore] = None, cfg: Any = None, store: Any = None,
                 clock: Optional[Callable[[], int]] = None):
        self.ls = lstore if lstore is not None else LearnStore("")
        self.cfg = cfg
        self.store = store
        self.clock = clock or now_ms

    # ------------------------------------------------------------------ registry

    @staticmethod
    def _id(role: str, version: str) -> str:
        return "%s@%s" % (role, version)

    def _emit(self, kind: str, run: str, body: Mapping[str, Any], model: str = "") -> None:
        if not run or self.store is None:
            return
        row = self.store.get(E_RUN, run) or {}
        env = Envelope(run=run, agent_version=str(getattr(self.cfg, "agent_version", "") or ""), model=model,
                       spec_hash=str(row.get("spec_hash", "") or ""))
        emit(self.store, kind, env, body)

    def register(self, role: str, version: str, model: str, prompt_version: str = "",
                 tools: Sequence[str] = (), status: str = "shadow", run: str = "",
                 detail: Optional[Mapping[str, Any]] = None) -> Dict[str, Any]:
        """Add a version (default status shadow). Registering a second active demotes nothing: use
        promote(). A first version of a role may be registered active."""
        if status not in STATUSES:
            raise LineError(codes.CONFIG_INVALID, "agent status %r" % status, {"status": status})
        if self.get(role, version) is not None:
            raise LineError(codes.STATE_CONFLICT, "agent %s already registered" % self._id(role, version),
                            {"role": role, "version": version})
        if status == "active" and self.active(role) is not None:
            raise LineError(codes.STATE_CONFLICT, "role %s already has an active version; promote instead" % role,
                            {"role": role})
        if not prompt_version:
            from .observe import prompt_version as pv
            prompt_version = pv(role)
        av = AgentVersion(role, version, model, prompt_version, list(tools), status, self.clock(),
                          detail=dict(detail or {}))
        row = self.ls.put("agent", self._id(role, version), asdict(av))
        self._emit(AGENT_REGISTERED, run, {"role": role, "version": version, "model": model,
                                           "prompt_version": prompt_version, "status": status}, model)
        return row

    def get(self, role: str, version: str) -> Optional[Dict[str, Any]]:
        return self.ls.get("agent", self._id(role, version))

    def versions(self, role: str, status: Optional[str] = None) -> List[Dict[str, Any]]:
        rows = self.ls.query("agent", role=role)
        return [r for r in rows if status is None or r.get("status") == status]

    def active(self, role: str) -> Optional[Dict[str, Any]]:
        rows = self.versions(role, "active")
        return rows[-1] if rows else None

    def ensure_defaults(self, roles: Sequence[str] = DEFAULT_ROLES, tools: Optional[Mapping[str, Sequence[str]]] = None
                        ) -> List[Dict[str, Any]]:
        """One active version per role from the config (model / model_alt, current prompt file)."""
        out = []
        av = str(getattr(self.cfg, "agent_version", "") or "line")
        for role in roles:
            if self.active(role) is not None:
                continue
            model = str((getattr(self.cfg, "role_models", None) or {}).get(role)
                        or getattr(self.cfg, "model_alt" if role in _ALT_ROLES else "model", "") or "")
            ver = av if self.get(role, av) is None else "%s-%d" % (av, self.clock())
            out.append(self.register(role, ver, model, tools=(tools or {}).get(role, ()), status="active"))
        return out

    # ------------------------------------------------------------------ routing

    def route(self, role: str, run: str, unit: str = "") -> Optional[Dict[str, Any]]:
        """The version that does (run, unit)'s work for role: a canary for its share of units, else the
        version the run is pinned to (pinned on first use to the then active version). None when the
        role has no version at all."""
        for c in self.versions(role, "canary"):
            if _bucket(role, c["version"], run, unit) < float(_s(self.cfg, "agents_canary_ratio")):
                return c
        pid = "%s|%s" % (run, role)
        pin = self.ls.get("agent_pin", pid)
        if pin is not None:
            v = self.get(role, pin["version"])
            if v is not None:
                return v
        a = self.active(role)
        if a is not None and run:
            self.ls.put("agent_pin", pid, {"run": run, "role": role, "version": a["version"]})
        return a

    def pinned(self, run: str, role: str) -> str:
        pin = self.ls.get("agent_pin", "%s|%s" % (run, role))
        return str(pin["version"]) if pin else ""

    # ------------------------------------------------------------------ shadow

    def run_shadow(self, role: str, llm: Any, prompt: Any, schema: Optional[Mapping[str, Any]], primary: Any, *,
                   key: str = "", run: str = "", compare: Callable[[Any, Any], bool] = default_compare
                   ) -> List[Dict[str, Any]]:
        """Run every shadow version of role on the same input (complete() roles only); the result is
        compared with ``primary`` and recorded, never returned to the caller. prompt may be a callable
        (version row -> prompt text) when the shadow has its own prompt version. Never raises."""
        out = []
        for v in self.versions(role, "shadow"):
            t0 = self.clock()
            row: Dict[str, Any] = {"role": role, "version": v["version"], "run": run, "key": key, "ts_ms": t0}
            try:
                text = prompt(v) if callable(prompt) else prompt
                res = llm.complete(role, text, schema, key=key, model=v.get("model") or None, run=run)
                row.update(ok=True, agree=bool(compare(primary, res)), usd=float(getattr(res, "usd", 0.0) or 0.0))
            except Exception as e:   # noqa: BLE001 - a shadow never affects the run
                row.update(ok=False, agree=False, usd=0.0, code=str(getattr(e, "code", type(e).__name__)))
            row["latency_ms"] = max(self.clock() - t0, 0)
            n = len(self.ls.query("shadow", role=role, version=v["version"]))
            out.append(self.ls.put("shadow", "%s#%d" % (self._id(role, v["version"]), n + 1), row))
        return out

    def shadow_stats(self, role: str, version: str) -> Dict[str, Any]:
        rows = self.ls.query("shadow", role=role, version=version)
        n = len(rows)
        agree = sum(1 for r in rows if r.get("agree"))
        return {"n": n, "agree": agree, "agree_rate": round(agree / n, 4) if n else 0.0,
                "errors": sum(1 for r in rows if not r.get("ok"))}

    # ------------------------------------------------------------------ SLO

    def record(self, role: str, version: str, success: bool, usd: float = 0.0, latency_ms: int = 0,
               escalated: bool = False, run: str = "", unit: str = "", sample_id: str = "") -> Dict[str, Any]:
        """One SLO sample (an attempt, a call). sample_id makes it idempotent (re-recording a run)."""
        sid = sample_id or "%s#%d" % (self._id(role, version),
                                      len(self.ls.query("agent_sample", role=role, version=version)) + 1)
        return self.ls.put("agent_sample", sid, {
            "role": role, "version": version, "success": bool(success), "usd": float(usd or 0.0),
            "latency_ms": int(latency_ms or 0), "escalated": bool(escalated), "run": run, "unit": unit,
            "ts_ms": self.clock()})

    def record_call(self, obs_row: Mapping[str, Any]) -> None:
        """Sink for observe.ObservedLlm: one sample per model call, attributed to the version the run
        is pinned to (or obs_row["agent_version"] when it names a registered version)."""
        role = str(obs_row.get("role", ""))
        run = str(obs_row.get("run", ""))
        ver = str(obs_row.get("agent_version", ""))
        if not role or self.get(role, ver) is None:
            v = self.route(role, run, str(obs_row.get("unit", ""))) if role else None
            if v is None:
                return
            ver = v["version"]
        self.record(role, ver, bool(obs_row.get("ok", True)), float(obs_row.get("cost", 0.0) or 0.0),
                    int(obs_row.get("latency_ms", 0) or 0), False, run, str(obs_row.get("unit", "")))

    def slo(self, role: str, version: str) -> Dict[str, Any]:
        rows = self.ls.query("agent_sample", role=role, version=version)[-max(int(_s(self.cfg, "slo_window")), 1):]
        n = len(rows)
        return {"n": n,
                "success_rate": round(sum(1 for r in rows if r["success"]) / n, 4) if n else 0.0,
                "escalation_rate": round(sum(1 for r in rows if r["escalated"]) / n, 4) if n else 0.0,
                "usd_per_unit": round(sum(r["usd"] for r in rows) / n, 6) if n else 0.0,
                "latency_p95_ms": _p95([r["latency_ms"] for r in rows])}

    def breaches(self, s: Mapping[str, Any]) -> List[str]:
        cfg = self.cfg
        if s["n"] < int(_s(cfg, "slo_min_sample")):
            return []
        out = []
        if s["success_rate"] < float(_s(cfg, "slo_min_success")):
            out.append("success_rate %.3f < %.3f" % (s["success_rate"], float(_s(cfg, "slo_min_success"))))
        if s["escalation_rate"] > float(_s(cfg, "slo_max_escalation")):
            out.append("escalation_rate %.3f > %.3f" % (s["escalation_rate"], float(_s(cfg, "slo_max_escalation"))))
        cap = float(_s(cfg, "slo_max_usd_per_unit"))
        if cap > 0 and s["usd_per_unit"] > cap:
            out.append("usd_per_unit %.4f > %.4f" % (s["usd_per_unit"], cap))
        lat = float(_s(cfg, "slo_max_latency_p95_s"))
        if lat > 0 and s["latency_p95_ms"] > lat * 1000:
            out.append("latency_p95 %.1fs > %.1fs" % (s["latency_p95_ms"] / 1000.0, lat))
        return out

    def check_slo(self, role: str, run: str = "") -> List[Dict[str, Any]]:
        """SLO of the role's active and canary versions. Each breach -> agent.slo_breach (alert);
        a canary in breach is rolled back (retired). Returns the alerts."""
        alerts = []
        for v in self.versions(role, "active") + self.versions(role, "canary"):
            s = self.slo(role, v["version"])
            b = self.breaches(s)
            if not b:
                continue
            alert = {"role": role, "version": v["version"], "status": v["status"], "breaches": b, "slo": s}
            alerts.append(alert)
            self._emit(AGENT_SLO_BREACH, run, alert, v.get("model", ""))
            if v["status"] == "canary":
                self._set(role, v["version"], "retired", rolled_back={"ts_ms": self.clock(), "breaches": b})
                self._emit(AGENT_ROLLBACK, run, {"role": role, "version": v["version"], "reason": "; ".join(b)},
                           v.get("model", ""))
        return alerts

    # ------------------------------------------------------------------ lifecycle

    def _set(self, role: str, version: str, status: str, **extra: Any) -> Dict[str, Any]:
        row = self.ls.update("agent", self._id(role, version), status=status, status_ms=self.clock(), **extra)
        if row is None:
            raise LineError(codes.NOT_FOUND, "agent %s" % self._id(role, version), {"role": role, "version": version})
        return row

    def promote(self, role: str, version: str, run: str = "") -> Dict[str, Any]:
        """shadow -> canary or canary -> active when the gate holds; LineError(STATE_CONFLICT) with the
        reason otherwise."""
        v = self.get(role, version)
        if v is None:
            raise LineError(codes.NOT_FOUND, "agent %s" % self._id(role, version), {"role": role, "version": version})
        cfg = self.cfg
        if v["status"] == "shadow":
            st = self.shadow_stats(role, version)
            if st["n"] < int(_s(cfg, "agents_shadow_min")) or st["agree_rate"] < float(_s(cfg, "agents_shadow_agree")):
                raise LineError(codes.STATE_CONFLICT, "shadow evidence not enough: %s" % st, dict(st, role=role))
            row = self._set(role, version, "canary", shadow=st)
            self._emit(AGENT_PROMOTED, run, {"role": role, "version": version, "from": "shadow", "to": "canary",
                                             "evidence": st}, v.get("model", ""))
            return row
        if v["status"] == "canary":
            s = self.slo(role, version)
            if s["n"] < int(_s(cfg, "slo_min_sample")):
                raise LineError(codes.STATE_CONFLICT, "canary sample %d < %d" % (s["n"], int(_s(cfg, "slo_min_sample"))),
                                {"role": role, "slo": s})
            b = self.breaches(s)
            if b:
                raise LineError(codes.STATE_CONFLICT, "canary breaches SLO: %s" % b, {"role": role, "slo": s})
            cur = self.active(role)
            base = self.slo(role, cur["version"]) if cur else None
            if base and base["n"] and s["success_rate"] < base["success_rate"] - float(_s(cfg, "agents_margin")):
                raise LineError(codes.STATE_CONFLICT, "canary inferior to active: %.3f < %.3f"
                                % (s["success_rate"], base["success_rate"]), {"role": role, "slo": s, "active": base})
            if cur is not None:
                self._set(role, cur["version"], "retired", retired_by=version)
                self._emit(AGENT_RETIRED, run, {"role": role, "version": cur["version"]}, cur.get("model", ""))
            row = self._set(role, version, "active", previous=cur["version"] if cur else "", canary=s)
            self._emit(AGENT_PROMOTED, run, {"role": role, "version": version, "from": "canary", "to": "active",
                                             "evidence": {"canary": s, "active": base}}, v.get("model", ""))
            return row
        raise LineError(codes.ILLEGAL_TRANSITION, "cannot promote a %s version" % v["status"],
                        {"role": role, "version": version, "status": v["status"]})

    def retire(self, role: str, version: str, run: str = "") -> Dict[str, Any]:
        v = self.get(role, version)
        if v is None:
            raise LineError(codes.NOT_FOUND, "agent %s" % self._id(role, version), {"role": role, "version": version})
        if v["status"] == "active" and len(self.versions(role, "active")) <= 1:
            raise LineError(codes.STATE_CONFLICT, "role %s would have no active version" % role, {"role": role})
        row = self._set(role, version, "retired")
        self._emit(AGENT_RETIRED, run, {"role": role, "version": version}, v.get("model", ""))
        return row

    def rollback(self, role: str, run: str = "", reason: str = "") -> Optional[Dict[str, Any]]:
        """Active version back to the one it replaced (previous), e.g. after an SLO breach of a fresh
        active. None when there is nothing to roll back to."""
        cur = self.active(role)
        if cur is None or not cur.get("previous") or self.get(role, cur["previous"]) is None:
            return None
        self._set(role, cur["previous"], "active")
        self._set(role, cur["version"], "retired", rolled_back={"ts_ms": self.clock(), "reason": reason})
        self._emit(AGENT_ROLLBACK, run, {"role": role, "version": cur["version"], "reason": reason or "rollback"},
                   cur.get("model", ""))
        return self.active(role)

    def auto_step(self, role: str, run: str = "") -> List[Dict[str, Any]]:
        """check_slo, then try to promote every shadow and canary version. Returns the actions taken."""
        actions: List[Dict[str, Any]] = [{"action": "slo_breach", **a} for a in self.check_slo(role, run)]
        for v in self.versions(role, "shadow") + self.versions(role, "canary"):
            frm = v["status"]
            try:
                row = self.promote(role, v["version"], run)
                actions.append({"action": "promote", "role": role, "version": v["version"], "from": frm,
                                "to": row["status"]})
            except LineError:
                pass
        return actions

    # ------------------------------------------------------------------ run samples

    def record_run(self, store: Any, run: str) -> int:
        """SLO samples of a finished run: one per builder / fixer attempt (success = verified, usd,
        latency, escalated = the unit failed on that attempt) and one per other model call
        (success = ok). Idempotent per run. Returns the number of samples."""
        units = {u["id"]: u for u in store.query(E_UNIT, run=run)}
        n = 0
        for a in store.query(E_ATTEMPT, run=run):
            u = units.get(a.get("unit"), {})
            role = "fixer" if int(u.get("fixer_gen", 0) or 0) > 0 else "builder"
            v = self.route(role, run, str(a.get("unit", "")))
            if v is None or not a.get("outcome"):
                continue
            last = int(a.get("n", 0)) == int(u.get("attempt", 0) or 0)
            lat = max(int(a.get("ended_ms") or 0) - int(a.get("started_ms") or 0), 0)
            self.record(role, v["version"], a.get("outcome") == "verified", float(a.get("usd") or 0.0), lat,
                        last and u.get("state") == "failed", run, str(a.get("unit", "")),
                        sample_id="%s|%s|%s#%s" % (role, run, a.get("unit"), a.get("n")))
            n += 1
        for i, c in enumerate(store.query(E_LLM_CALL, run=run)):
            role = str(c.get("role", ""))
            if role in ("builder", "fixer") or not role:
                continue
            v = self.route(role, run)
            if v is None:
                continue
            self.record(role, v["version"], bool(c.get("ok", True)), float(c.get("usd") or 0.0), 0, False, run,
                        sample_id="%s|%s|call%d" % (role, run, i))
            n += 1
        return n


def on_run_end(ctx: Any, run: str, directory: Optional[AgentDirectory] = None) -> Dict[str, Any]:
    """pipeline.drive finally block (after _finish): record the run's SLO samples, check SLOs (alerts as
    events, canary rollback) and auto-promote. {} unless agents_enabled. Never raises."""
    cfg = getattr(ctx, "cfg", None)
    if not _s(cfg, "agents_enabled"):
        return {}
    try:
        d = directory or AgentDirectory(LearnStore.for_config(cfg), cfg, ctx.store)
        d.ensure_defaults()
        samples = d.record_run(ctx.store, run)
        actions = []
        for role in sorted({r["role"] for r in d.ls.query("agent")}):
            actions += d.auto_step(role, run)
        return {"samples": samples, "actions": actions}
    except Exception as e:   # noqa: BLE001 - the directory never breaks a run
        return {"error": "%s: %s" % (type(e).__name__, e)}


__all__ = ["AgentDirectory", "AgentVersion", "AGENT_KINDS", "AGENT_SETTINGS", "STATUSES", "DEFAULT_ROLES",
           "default_compare", "on_run_end"]
