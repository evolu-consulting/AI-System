"""Fault injection for dry runs (LINE_LLM=fake only): makes the e2e variants reproducible.

  LINE_DRY_FLAKY=1        one acceptance test fails on the 2nd of the QAS repeats -> flaky,
                          quarantined and reported; the run still goes green.
  LINE_DRY_QAS_RED=F3     every acceptance test of F3 reads red on QAS until a fixer unit for
                          F3 is merged -> the fixer loop runs once, then QAS is green.
                          (comma-separated F-item ids)

Only the QAS case runner is wrapped; merge-queue and verifier runs are real. With a real model
(LINE_LLM=cli|api) these variables are ignored.
"""

from __future__ import annotations

import os
import threading
from typing import Any, Callable, Dict, Mapping, Optional, Sequence

from .contracts import E_ACC_TEST, E_UNIT, UnitState
from .ship.merge_queue import test_name

CaseRunner = Callable[[str, Sequence[str]], Dict[str, bool]]


def settings(env: Optional[Mapping[str, str]] = None) -> Dict[str, Any]:
    env = os.environ if env is None else env
    red = [x.strip() for x in str(env.get("LINE_DRY_QAS_RED", "") or "").split(",") if x.strip()]
    return {"flaky": str(env.get("LINE_DRY_FLAKY", "") or "") == "1", "red": red}


def wrap_case_runner(cfg: Any, store: Any, run: str, base: CaseRunner,
                     env: Optional[Mapping[str, str]] = None) -> Optional[CaseRunner]:
    """A case runner with the configured faults, or None when nothing is injected."""
    s = settings(env)
    if getattr(cfg, "llm", "") != "fake" or not (s["flaky"] or s["red"]):
        return None
    lock = threading.Lock()
    calls = {"n": 0}

    def names_of(f_item: str) -> list:
        return sorted(test_name(r) for r in store.query(E_ACC_TEST, run=run) if r.get("f_item") == f_item)

    def fixed(f_item: str) -> bool:
        return any(int(u.get("fixer_gen", 0) or 0) > 0 and f_item in (u.get("f_items") or [])
                   and u.get("state") == UnitState.MERGED.value for u in store.query(E_UNIT, run=run))

    def runner(workdir: str, names: Sequence[str]) -> Dict[str, bool]:
        res = dict(base(workdir, names))
        if not names:                       # regression discovery: untouched
            return res
        with lock:
            calls["n"] += 1
            n = calls["n"]
        for f in s["red"]:
            if not fixed(f):
                for name in names_of(f):
                    for tid in list(res) or [name]:
                        if tid == name or tid.startswith(name + "."):
                            res[tid] = False
                    res.setdefault(name, False)
        if s["flaky"] and n % 3 == 2:
            all_names = sorted(test_name(r) for r in store.query(E_ACC_TEST, run=run))
            if all_names:
                victim = all_names[0]
                for tid in list(res):
                    if tid == victim or tid.startswith(victim + "."):
                        res[tid] = False
        return res

    return runner


__all__ = ["settings", "wrap_case_runner"]
