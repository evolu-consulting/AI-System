"""The bench hooks of the learning loop (S11, ``learn.BENCH[0]``) and of phase 5 (S14, ``improve.BENCH[0]``).

Not a capability (it is not in ``app.caps.MODULES``): ``learn.attach`` and ``improve.attach`` call ``register(app)``,
which does nothing unless ``KH_BENCH_HOOK=1`` (default off, so tests and prod are unchanged: the learn gate's bench
step stays ``skipped`` and a param proposal stays ``hold``).

WHAT IT RUNS. The phase 1 question set (tools/kh_bench/tasks_p1.json through tools/kh_bench/scripts/p1bench.py:
its ``ask`` / ``grade`` / ``coverage``, one POST /context/step per question with only_tiers [entity, distilled])
and the tier-1 retrieval tasks (tools/kh_bench/tasks.json without the permission probes, one full POST /context/step
each, coverage of the task's must-points in the pack text). Each suite runs twice: the BASELINE with
``overrides: {}`` and the CANDIDATE with the change under test:

  learn    ``with_items: [{id, text}]`` - the candidate lesson injected into the distilled tier (design 5.3 step 4)
  improve  ``overrides: {param: value}`` - the clamped value, per request (improve.request_overrides)

Every call carries ``overrides`` (at least ``{}``), so it is a maintainer bench call: no serve id, no kh.served.

GUARD. ``ok`` when no metric of the candidate is more than ``GUARD_REL`` (2%) worse than the baseline (relative;
an absolute 2 points when the baseline is 0) and the candidate has no more failed calls. A baseline with failed calls
(the bench cannot measure: no maintainer token, server down) is never ``ok``: a candidate is not passed unmeasured.
The tools directory missing is ``ok: false`` too.

TRANSPORT. ``KH_BENCH_HOOK_URL`` set: HTTP to that KH (p1bench's client) with the bearer token
``KH_BENCH_HOOK_TOKEN`` (a maintainer's; read per run, never logged). Unset: in-process through Starlette's
TestClient on the app that registered the hook, with the same token when one is set (a KH without sign-in needs
none). ``KH_BENCH_DIR`` points at a kh_bench folder elsewhere (default <app root>/tools/kh_bench); tools/ is only
imported when a hook runs, never at import time.
"""
from __future__ import annotations

import importlib.util
import json
import logging
import os
import statistics
import threading
import time
from pathlib import Path
from typing import Any, Callable

logger = logging.getLogger(__name__)

ENV = "KH_BENCH_HOOK"
GUARD_REL = 0.02
METRICS = ("p1_answered", "p1_coverage", "tier1_coverage")
ROOT = Path(__file__).resolve().parents[2]

#: Tests: a scorer ``fn(extra: dict) -> {metric: float, "errors": int}`` used instead of the real bench.
SCORER: list[Callable[[dict], dict] | None] = [None]
#: Tests: at most this many questions / tasks per suite (None = all).
LIMIT: list[int | None] = [None]

_state: dict[str, Any] = {"app": None, "client": None}
_lock = threading.Lock()
_p1 = []


def enabled() -> bool:
    return (os.getenv(ENV) or "").strip().lower() in ("1", "on", "true", "yes")


def register(app=None) -> bool:
    """Set ``learn.BENCH[0]`` and ``improve.BENCH[0]`` when ``KH_BENCH_HOOK=1``. Returns whether it did."""
    if not enabled():
        return False
    from app.caps import improve, learn
    if app is not None:
        _state["app"], _state["client"] = app, None
    learn.BENCH[0] = learn_hook
    improve.BENCH[0] = improve_hook
    logger.info("bench hook registered (learn gate + improve params), transport %s",
                "http" if os.getenv("KH_BENCH_HOOK_URL") else "in-process")
    return True


def unregister() -> None:
    """Tests: clear both hooks if they are ours."""
    from app.caps import improve, learn
    if learn.BENCH[0] is learn_hook:
        learn.BENCH[0] = None
    if improve.BENCH[0] is improve_hook:
        improve.BENCH[0] = None


# ── tools/kh_bench (optional, loaded on first use) ───────────────────────────

def bench_dir() -> Path:
    return Path(os.getenv("KH_BENCH_DIR") or ROOT / "tools" / "kh_bench")


def p1bench():
    """tools/kh_bench/scripts/p1bench.py as a module (FileNotFoundError when the tools are not shipped)."""
    if _p1:
        return _p1[0]
    path = bench_dir() / "scripts" / "p1bench.py"
    if not path.is_file():
        raise FileNotFoundError(f"bench tools not found ({path})")
    spec = importlib.util.spec_from_file_location("kh_bench_p1bench", path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)                     # type: ignore[union-attr]
    _p1.append(mod)
    return mod


class _InProcess:
    """p1bench's ``KH.call`` shape over a TestClient on the running app."""

    def __init__(self, app):
        from fastapi.testclient import TestClient
        self.client = TestClient(app, raise_server_exceptions=False)
        self.label = "in-process"

    def call(self, method: str, path: str, body=None, params: dict | None = None, timeout: float = 120):
        tok = os.getenv("KH_BENCH_HOOK_TOKEN")
        headers = {"Authorization": "Bearer " + tok} if tok else {}
        t = time.perf_counter()
        r = self.client.request(method, path, json=body, params=params, headers=headers)
        try:
            out = r.json()
        except ValueError:
            out = r.text[:400]
        return r.status_code, out, time.perf_counter() - t


class _With:
    """Adds ``extra`` fields to every POST /context/step body."""

    def __init__(self, inner, extra: dict):
        self.inner, self.extra = inner, extra

    def call(self, method, path, body=None, params=None, timeout=120):
        if method == "POST" and path == "/context/step" and isinstance(body, dict):
            body = {**body, **self.extra}
        return self.inner.call(method, path, body, params, timeout)


def client():
    url = os.getenv("KH_BENCH_HOOK_URL")
    if url:
        return p1bench().KH(url, lambda: os.getenv("KH_BENCH_HOOK_TOKEN") or "", "hook")
    with _lock:
        if _state["client"] is None:
            if _state["app"] is None:
                raise RuntimeError("no app registered for the in-process bench (set KH_BENCH_HOOK_URL)")
            _state["client"] = _InProcess(_state["app"])
        return _state["client"]


# ── scoring ──────────────────────────────────────────────────────────────────

def _mean(xs: list[float]) -> float:
    return round(statistics.fmean(xs), 4) if xs else 0.0


def scores(kh, extra: dict, limit: int | None = None) -> dict:
    """One run of both suites with ``extra`` merged into every /context/step body."""
    p1 = p1bench()
    kh = _With(kh, extra)
    tasks = p1.load_tasks(bench_dir() / "tasks_p1.json")
    if limit:
        tasks["questions"] = tasks["questions"][:limit]
    budget = tasks.get("grading", {}).get("budget_chars", 4000)
    answers = {q["id"]: p1.ask(kh, q, budget) for q in tasks["questions"]}
    rep = p1.grade(tasks, answers)
    rows = rep["rows"]
    errors = len(rep["errors"])
    t1 = [t for t in p1.load_tasks(bench_dir() / "tasks.json")["tasks"] if t.get("category") != "permission"]
    if limit:
        t1 = t1[:limit]
    covs = []
    for t in t1:
        body = {"text": t["prompt"], **({"project": t["project"]} if t.get("project") else {})}
        st, out, _ = kh.call("POST", "/context/step", body)
        if st != 200 or not isinstance(out, dict):
            errors += 1
            covs.append(0.0)
            continue
        text = "\n".join(i.get("text") or "" for i in out.get("items") or [])
        cov, _missing = p1.coverage(t.get("must") or {}, text)
        covs.append(cov or 0.0)
    return {"p1_answered": _mean([1.0 if r["answered"] else 0.0 for r in rows]),
            "p1_coverage": _mean([r["coverage"] or 0.0 for r in rows]), "tier1_coverage": _mean(covs),
            "errors": errors, "questions": len(rows), "tasks": len(t1)}


def compare(base: dict, cand: dict, guard: float = GUARD_REL) -> dict:
    """The guard: no metric more than ``guard`` worse than the baseline, no new failed calls."""
    worse = []
    for m in METRICS:
        b, c = float(base.get(m) or 0.0), float(cand.get(m) or 0.0)
        floor = b * (1 - guard) if b > 0 else b - guard
        if c < floor - 1e-9:
            worse.append(m)
    out: dict[str, Any] = {"guard_rel": guard, "worse": worse}
    for m in METRICS:
        out[f"baseline_{m}"], out[f"candidate_{m}"] = base.get(m), cand.get(m)
    out["baseline_errors"], out["candidate_errors"] = int(base.get("errors") or 0), int(cand.get("errors") or 0)
    if out["baseline_errors"]:
        out.update(ok=False, reason="baseline_unmeasured")
    elif out["candidate_errors"] > out["baseline_errors"]:
        out.update(ok=False, reason="candidate_errors")
    elif worse:
        out.update(ok=False, reason="regression")
    else:
        out.update(ok=True, reason="within_guard")
    return out


def run(extra: dict) -> dict:
    """Baseline (``overrides: {}``) against the candidate (``extra``); never raises."""
    try:
        scorer = SCORER[0]
        if scorer is None:
            kh = client()

            def scorer(x):
                return scores(kh, x, LIMIT[0])
        base = scorer({"overrides": {}})
        cand = scorer({"overrides": {}, **extra})
        return compare(base, cand)
    except Exception as exc:  # noqa: BLE001 - an unmeasured candidate never passes
        logger.warning("bench hook failed: %s", exc)
        return {"ok": False, "reason": "bench_error", "error": str(exc)[:300]}


# ── the hooks ────────────────────────────────────────────────────────────────

def learn_hook(item: dict) -> dict:
    """learn.BENCH[0]: ``item`` is the lesson_trial row (with ``dk``); the candidate is injected by with_items."""
    text = (item.get("text") or (item.get("dk") or {}).get("text") or "").strip()
    iid = str(item.get("item_id") or item.get("id") or "candidate")[:64]
    if not text:
        return {"ok": False, "reason": "no_text"}
    return run({"with_items": [{"id": iid, "text": text[:2000]}]})


def improve_hook(proposal: dict) -> dict:
    """improve.BENCH[0]: a param proposal with its clamped ``value``; the candidate is a per-request override."""
    name, value = proposal.get("target"), proposal.get("value")
    if not isinstance(name, str) or value is None:
        return {"ok": False, "reason": "no_value"}
    out = run({"overrides": {name: value}})
    if isinstance(value, dict):
        out["value"] = json.dumps(value, sort_keys=True)[:300]
    return out
