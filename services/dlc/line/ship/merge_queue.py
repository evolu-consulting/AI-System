"""Merge queue (plan block 15).

Verified units wait in a FIFO ordered by wave. One at a time, in a dedicated
integration worktree (``<workroot>/merge/<run>``):

  1. check out the unit's head detached and rebase it onto main
  2. run the acceptance tests of every merged unit of the run plus the unit's own
     (the regression net; tests of units not merged yet are expected red and skipped)
  3. fast-forward main to the rebased head (CAS on the old main sha)
  4. unit verified -> merged, emit unit.merged

A rebase conflict (MERGE_CONFLICT) or a red test after a clean rebase (MERGE_TESTS_RED) first goes to
the merger agent when one is wired (``mq.resolver``, line.ship.merger): it resolves in the integration
worktree and the queue checks and tests again. When it cannot, the unit goes verified -> ready
(unit.requeued) back to its builder and the queue moves on; when it says the unit cannot be integrated
as specified, MERGE_BLOCKED (the pipeline escalates to a person).

The unit's head is found in this order: branch given to enqueue(), unit.detail
"branch", unit.detail "head" (a sha), HEAD of unit.worktree, ``line/<run>/<unit>``.

    mq = MergeQueue(store, repo="<target repo path>", cfg=cfg)
    mq.enqueue("R1", "U1")
    outcomes = mq.drain("R1")
"""

from __future__ import annotations

import os
import threading
from dataclasses import dataclass, field
from typing import Any, Callable, Dict, List, Optional, Sequence, Tuple

from .. import codes, stacks
from ..codes import LineError
from ..config import Config, load_config
from ..contracts import (
    E_ACC_TEST, E_MERGE, E_UNIT, Gate, UnitState, to_dict,
)
from ._util import SystemClock, git, git_out, put_gate, python_argv, run_cmd, run_env, tail

#: test runner hook: (workdir, dotted test names) -> {"ok": bool, "output": str}
TestRunner = Callable[[str, Sequence[str]], Dict[str, Any]]

Q_QUEUED = "queued"
Q_MERGED = "merged"
Q_CONFLICT = "conflict"


def default_test_runner(workdir: str, names: Sequence[str]) -> Dict[str, Any]:
    """python -m unittest <names> in workdir (no names: discovery from workdir).
    A non-Python target stack runs its own runner (line.stacks); same {"ok", "code", "output"} answer."""
    st = stacks.for_repo(workdir)
    if not st.is_python:
        r = st.run(workdir, list(names))
        ok = r.get("rc") == 0 and not r.get("failures") and not r.get("timeout") and (r.get("ran") or not names)
        return {"ok": bool(ok), "code": r.get("rc"), "output": tail(r.get("output", "") or "")}
    stacks.prepare_nested(workdir)            # a Node app in a sub-folder needs its node_modules to start
    return run_cmd(python_argv("-m", "unittest", *names), cwd=workdir)


def test_name(row: Dict[str, Any]) -> str:
    """Dotted unittest id of an AccTest row (name, else module path derived from path)."""
    if row.get("name"):
        return str(row["name"])
    path = str(row.get("path", "")).replace("\\", "/")
    if path.endswith(".py"):
        path = path[:-3]
    return path.strip("/").replace("/", ".")


@dataclass
class MergeOutcome:
    run: str
    unit: str
    merged: bool
    gate: Gate
    sha: str = ""                 # main after the merge (merged) / main at the attempt (conflict)
    detail: Dict[str, Any] = field(default_factory=dict)


class MergeQueue:
    #: LINE_SEAL=1: (run, unit, attempt) -> True when that attempt's seal is final; None = no seal check
    seal_ok: Optional[Callable[[str, str, int], bool]] = None
    #: line.ship.merger.Merger (or anything with may_try(unit_row) and resolve(...)); None = no merger agent
    resolver: Any = None

    def __init__(self, store: Any, repo: str, cfg: Optional[Config] = None, main: str = "main",
                 test_runner: Optional[TestRunner] = None, clock: Any = None, workdir: Optional[str] = None):
        self.store = store
        self.repo = os.path.abspath(repo)
        self.cfg = cfg or load_config()
        self.main = main
        self.test_runner = test_runner or default_test_runner
        self.clock = clock or getattr(store, "clock", None) or SystemClock()
        self.workdir = workdir          # integration worktree root; default <workroot>/merge
        self._lock = threading.Lock()

    # ------------------------------------------------------------------ queue

    def _item_id(self, run: str, unit: str) -> str:
        return "%s:%s" % (run, unit)

    def enqueue(self, run: str, unit: str, branch: str = "") -> Dict[str, Any]:
        """Queue a verified unit. Re-enqueueing a unit puts it at the back of its wave."""
        urow = self.store.get(E_UNIT, unit)
        if urow is None:
            raise LineError(codes.NOT_FOUND, "unit %s" % unit, {"unit": unit})
        n = len(self.store.query(E_MERGE, run=run)) + 1
        row = {"id": self._item_id(run, unit), "run": run, "unit": unit, "wave": int(urow.get("wave", 0) or 0),
               "state": Q_QUEUED, "enqueued_ms": self.clock.now_ms(), "n": n, "branch": branch,
               "tries": int((self.store.get(E_MERGE, self._item_id(run, unit)) or {}).get("tries", 0))}
        self.store.put(E_MERGE, row["id"], row, run=run)
        return row

    def pending(self, run: str) -> List[Dict[str, Any]]:
        """Queued items, FIFO by wave (then enqueue order)."""
        rows = self.store.query(E_MERGE, run=run, state=Q_QUEUED)
        return sorted(rows, key=lambda r: (int(r.get("wave", 0)), int(r.get("n", 0))))

    def drained(self, run: str) -> bool:
        return not self.pending(run)

    def drain(self, run: str, stop: Optional[Callable[[], bool]] = None) -> List[MergeOutcome]:
        """Merge queued items one by one until the queue is empty or stop() says so (checked
        before each item: a cancelled run starts no new merge)."""
        out = []
        while True:
            if stop is not None and stop():
                return out
            o = self.process_next(run)
            if o is None:
                return out
            out.append(o)

    # ------------------------------------------------------------------ git plumbing

    def _integration_dir(self, run: str) -> str:
        root = self.workdir or os.path.join(self.cfg.workroot, "merge")
        return os.path.join(root, "".join(c if c.isalnum() or c in "-_." else "_" for c in run))

    def _ensure_worktree(self, run: str) -> str:
        path = self._integration_dir(run)
        if os.path.isdir(os.path.join(path, ".git")) or os.path.isfile(os.path.join(path, ".git")):
            git(path, "rebase", "--abort", check=False)
            git(path, "reset", "--hard", "-q", check=False)
            git(path, "clean", "-fdq", check=False)
            return path
        os.makedirs(os.path.dirname(path), exist_ok=True)
        git(self.repo, "worktree", "prune", check=False)
        git(self.repo, "worktree", "add", "--detach", "-f", path, self.main)
        return path

    def _unit_head(self, item: Dict[str, Any], urow: Dict[str, Any]) -> str:
        detail = urow.get("detail") or {}
        for ref in (item.get("branch"), detail.get("branch"), detail.get("head")):
            if ref:
                return str(ref)
        wt = urow.get("worktree") or ""
        if wt and os.path.isdir(wt):
            cp = git(wt, "rev-parse", "HEAD", check=False)
            if cp.returncode == 0 and cp.stdout.strip():
                return cp.stdout.strip()
        return "line/%s/%s" % (item["run"], item["unit"])

    def _acceptance_names(self, run: str, unit_row: Dict[str, Any]) -> List[str]:
        merged = self.store.query(E_UNIT, run=run, state=UnitState.MERGED.value)
        test_ids: List[str] = []
        for u in merged + [unit_row]:
            for t in u.get("tests") or []:
                if t not in test_ids:
                    test_ids.append(t)
        names: List[str] = []
        for tid in test_ids:
            row = self.store.get(E_ACC_TEST, tid)
            name = test_name(row) if row else ""
            if name and name not in names:
                names.append(name)
        return names

    def _main_is_checked_out(self) -> bool:
        cp = git(self.repo, "symbolic-ref", "-q", "HEAD", check=False)
        return cp.returncode == 0 and cp.stdout.strip() == "refs/heads/" + self.main

    def _fast_forward(self, old: str, new: str) -> None:
        if self._main_is_checked_out():
            git(self.repo, "merge", "--ff-only", "-q", new)
        else:
            git(self.repo, "update-ref", "refs/heads/" + self.main, new, old)

    # ------------------------------------------------------------------ one merge

    def process_next(self, run: str) -> Optional[MergeOutcome]:
        with self._lock:
            items = self.pending(run)
            if not items:
                return None
            return self._merge(items[0])

    def _merge(self, item: Dict[str, Any]) -> MergeOutcome:
        run, unit = item["run"], item["unit"]
        urow = self.store.get(E_UNIT, unit) or {}
        attempt = int(urow.get("attempt", 0) or 0)
        item = dict(item, tries=int(item.get("tries", 0)) + 1)
        if urow.get("state") != UnitState.VERIFIED.value:
            # not mergeable any more (cancelled, failed, already merged): drop from the queue
            item.update(state=Q_CONFLICT, reason="unit is %s" % urow.get("state"))
            self.store.put(E_MERGE, item["id"], item, run=run)
            return MergeOutcome(run, unit, False, Gate.fail(codes.MERGE_CONFLICT, reason=item["reason"]))
        if self.seal_ok is not None and not self.seal_ok(run, unit, attempt):
            # LINE_SEAL=1: only a finalised seal merges; the seal tick enqueues it again once it is
            item.update(state=Q_CONFLICT, reason="seal of %s#%d is not final" % (unit, attempt))
            self.store.put(E_MERGE, item["id"], item, run=run)
            return MergeOutcome(run, unit, False, Gate.fail(codes.MERGE_CONFLICT, reason=item["reason"]),
                                detail={"stage": "seal"})

        head = self._unit_head(item, urow)
        old_main = git_out(self.repo, "rev-parse", self.main)
        wt = self._ensure_worktree(run)
        detail: Dict[str, Any] = {"head": head, "main": old_main}

        cp = git(wt, "checkout", "-q", "--detach", head, check=False)
        if cp.returncode != 0:
            return self._conflict(item, urow, attempt, "checkout", dict(detail, stderr=tail(cp.stderr, 2000)))
        cp = git(wt, "rebase", old_main, check=False)
        if cp.returncode != 0:
            files = git(wt, "diff", "--name-only", "--diff-filter=U", check=False).stdout.split()
            info = dict(detail, files=files, stderr=tail(cp.stdout + cp.stderr, 2000))
            r = self._resolve(run, unit, wt, "rebase", info)
            if r is None or not r["resolved"]:
                git(wt, "rebase", "--abort", check=False)
                code = codes.MERGE_BLOCKED if r and r["blocked"] else codes.MERGE_CONFLICT
                return self._conflict(item, urow, attempt, "rebase", dict(info, merger=r) if r else info, code)
            detail["merger"] = r
        new = git_out(wt, "rev-parse", "HEAD")
        names = self._acceptance_names(run, urow)
        # no acceptance test owned yet (a contract unit merged first): nothing to run. Discovery
        # would run the tests of units not merged yet, which are expected red.
        run_tests = (lambda: self.test_runner(wt, names)) if names else \
            (lambda: {"ok": True, "output": "no acceptance tests owned yet"})
        res = run_tests()
        if not res.get("ok"):
            info = dict(detail, rebased=new, tests=names, output=tail(str(res.get("output", ""))))
            r = self._resolve(run, unit, wt, "tests", info)
            if r is not None and r["resolved"]:
                new = git_out(wt, "rev-parse", "HEAD")
                res = run_tests()
                detail["merger"] = r
            if not res.get("ok"):
                code = codes.MERGE_BLOCKED if r and r["blocked"] else codes.MERGE_TESTS_RED
                info = dict(info, rebased=new, output=tail(str(res.get("output", ""))))
                return self._conflict(item, urow, attempt, "tests", dict(info, merger=r) if r else info, code)

        try:
            self._fast_forward(old_main, new)
        except LineError as e:   # main moved under us (CAS miss) or dirty checkout: retry later
            return self._conflict(item, urow, attempt, "fast-forward", dict(detail, rebased=new, error=e.to_dict()))

        # main did not move: the unit's work was already there (verify passed it with already_satisfied, an
        # empty diff). The unit is done like a merged one, but says so instead of claiming a merge.
        nothing = new == old_main
        self.store.transition(E_UNIT, unit, UnitState.MERGED, UnitState.VERIFIED)
        u2 = self.store.get(E_UNIT, unit) or {}
        u2.setdefault("detail", {})
        u2["detail"] = dict(u2["detail"] or {}, merged_sha=new)
        if nothing:
            u2["detail"]["nothing_to_merge"] = True
        self.store.put(E_UNIT, unit, u2, run=run)
        item.update(state=Q_MERGED, sha=new, tests=names, merged_ms=self.clock.now_ms(), merger=detail.get("merger"))
        if nothing:
            item["nothing_to_merge"] = True
        self.store.put(E_MERGE, item["id"], item, run=run)
        gate = Gate.passed(sha=new, tests=len(names))
        put_gate(self.store, run, unit, attempt, "merge", gate)
        env = run_env(self.store, self.cfg, run, unit, attempt, str(urow.get("model", "")))
        self.store.emit(codes.UNIT_STATE, env, {"from": UnitState.VERIFIED.value, "to": UnitState.MERGED.value})
        body = {"unit": unit, "sha": new, "previous": old_main, "wave": int(item.get("wave", 0)), "tests": len(names)}
        if nothing:
            body["nothing_to_merge"] = True
        self.store.emit(codes.UNIT_MERGED, env, body)
        return MergeOutcome(run, unit, True, gate, new, {"tests": names, "previous": old_main,
                                                         "merger": detail.get("merger")})

    def _resolve(self, run: str, unit: str, wt: str, stage: str, info: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        """The merger's attempt, or None when no merger is wired or it has had its calls for this unit."""
        urow = self.store.get(E_UNIT, unit) or {}
        if self.resolver is None or not self.resolver.may_try(urow):
            return None
        return self.resolver.resolve(run, urow, wt, stage, info)

    def _conflict(self, item: Dict[str, Any], urow: Dict[str, Any], attempt: int, stage: str,
                  detail: Dict[str, Any], code: str = codes.MERGE_CONFLICT) -> MergeOutcome:
        run, unit = item["run"], item["unit"]
        gate = Gate.fail(code, stage=stage, **detail)
        item.update(state=Q_CONFLICT, stage=stage, detail=detail)
        self.store.put(E_MERGE, item["id"], item, run=run)
        put_gate(self.store, run, unit, attempt, "merge", gate)
        self.store.transition(E_UNIT, unit, UnitState.READY, UnitState.VERIFIED)
        u2 = self.store.get(E_UNIT, unit) or {}
        u2["detail"] = dict(u2.get("detail") or {}, merge_conflict=dict(detail, stage=stage))
        self.store.put(E_UNIT, unit, u2, run=run)
        env = run_env(self.store, self.cfg, run, unit, attempt, str(urow.get("model", "")))
        self.store.emit(codes.UNIT_STATE, env, {"from": UnitState.VERIFIED.value, "to": UnitState.READY.value,
                                               "code": code})
        self.store.emit(codes.UNIT_REQUEUED, env, {"code": code, "from": UnitState.VERIFIED.value,
                                                  "stage": stage, "files": detail.get("files", [])})
        return MergeOutcome(run, unit, False, gate, detail.get("main", ""), detail)


__all__ = ["MergeQueue", "MergeOutcome", "default_test_runner", "test_name"]
