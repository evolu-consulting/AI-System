"""QAS runner (plan block 17): acceptance + regression, ``cfg.qas_repeats`` (3) times on the live color.

Per test over N runs: N/N pass -> green; 0/N -> red; anything else -> flaky.
Per F-item: any red test -> red (QAS_RED); else any flaky test -> flaky (FLAKY,
those tests are quarantined and reported); else green. ``runs`` of an F-item is
[all its tests passed in repeat i]. Regression = every other unittest found in
the QAS tree (``python -m unittest`` discovery), reported as the pseudo F-item
"REGRESSION" (off with include_regression=False).

Each F-item verdict is stored (E_QAS, id "<run>:<f_item>") and emitted as qas.result.
The runner holds the QAS lock while it tests, so no deploy switches colors under it.

Test runner hook: (workdir, names) -> {test id: bool}. names == [] means
"discover everything". The default runs a small in-process collector in a
child python so each test's outcome is read exactly (no output parsing).
"""

from __future__ import annotations

import json
import os
import sys
from dataclasses import dataclass, field
from typing import Any, Callable, Dict, List, Optional, Sequence

from .. import codes, stacks
from ..codes import LineError
from ..config import Config, load_config
from ..contracts import E_ACC_TEST, E_QAS, Gate
from ..runtime import python_exe as _py
from ._util import SystemClock, child_env, put_gate, run_env
from .deploy import current_dir, qas_lock
from .merge_queue import test_name

#: (workdir, dotted test names or [] for discovery) -> {test id: passed}
CaseRunner = Callable[[str, Sequence[str]], Dict[str, bool]]

REGRESSION = "REGRESSION"
GREEN, RED, FLAKY = "green", "red", "flaky"

_COLLECTOR = r"""
import json, sys, unittest
names = sys.argv[1:]
loader = unittest.TestLoader()
out = {}
def flat(s):
    for t in s:
        if isinstance(t, unittest.TestSuite):
            yield from flat(t)
        else:
            yield t
suites = []
if names:
    for n in names:
        try:
            suites.append((n, loader.loadTestsFromName(n)))
        except Exception as e:
            out[n] = False
else:
    suites.append(("", loader.discover(".", top_level_dir=".")))
class R(unittest.TestResult):
    def addFailure(self, t, e): super().addFailure(t, e); out[t.id()] = False
    def addError(self, t, e):
        super().addError(t, e)
        out[getattr(t, "id", lambda: str(t))()] = False
    def addSuccess(self, t): super().addSuccess(t); out.setdefault(t.id(), True)
    def addSkip(self, t, r): super().addSkip(t, r)
    def addUnexpectedSuccess(self, t): super().addUnexpectedSuccess(t); out[t.id()] = False
for n, s in suites:
    tests = list(flat(s))
    runnable = []
    for t in tests:
        tid = t.id()
        if tid.startswith("unittest.loader._FailedTest"):
            out[n or tid] = False
            continue
        runnable.append(t)
    # run through a TestSuite, not t.run() one by one: only a suite runs setUpClass / setUpModule (a web-app
    # test that starts its server in setUpClass otherwise fails every time on QAS)
    unittest.TestSuite(runnable).run(R())
    for t in runnable:
        out.setdefault(t.id(), False)      # a test whose class or module fixture failed never ran: red
    if n and not tests:
        out[n] = False
sys.stdout.write("\n@@LINE_QAS@@" + json.dumps(out) + "\n")
"""


def default_case_runner(workdir: str, names: Sequence[str], _stack: Any = None) -> Dict[str, bool]:
    import subprocess
    st = _stack or stacks.for_repo(workdir)
    if not st.is_python:                      # non-Python target stack: its own runner, same answer shape
        return st.run_cases(workdir, names)
    try:
        cp = subprocess.run([_py(), "-c", _COLLECTOR] + list(names), cwd=workdir, capture_output=True,
                            text=True, encoding="utf-8", errors="replace", env=child_env(), timeout=900)
        marker = cp.stdout.rfind("@@LINE_QAS@@")
        if marker < 0:
            return {n: False for n in names} or {"<discovery>": False}
        return {str(k): bool(v) for k, v in json.loads(cp.stdout[marker + len("@@LINE_QAS@@"):].strip()).items()}
    except (OSError, ValueError, subprocess.TimeoutExpired):
        return {n: False for n in names} or {"<discovery>": False}


def _belongs(test_id: str, name: str) -> bool:
    """A collected test id belongs to an acceptance test name (module, class or method)."""
    return test_id == name or test_id.startswith(name + ".")


def verdict(runs: Sequence[bool]) -> str:
    if runs and all(runs):
        return GREEN
    if not any(runs):
        return RED
    return FLAKY


@dataclass
class FItemResult:
    f_item: str
    verdict: str
    runs: List[bool]
    code: str = ""
    tests: Dict[str, List[bool]] = field(default_factory=dict)
    quarantined: List[str] = field(default_factory=list)
    failing: List[str] = field(default_factory=list)


@dataclass
class QasReport:
    run: str
    repeats: int
    items: List[FItemResult] = field(default_factory=list)
    qas_dir: str = ""

    def by_verdict(self, v: str) -> List[FItemResult]:
        return [i for i in self.items if i.verdict == v]

    @property
    def green(self) -> List[FItemResult]:
        return self.by_verdict(GREEN)

    @property
    def red(self) -> List[FItemResult]:
        return self.by_verdict(RED)

    @property
    def flaky(self) -> List[FItemResult]:
        return self.by_verdict(FLAKY)

    @property
    def all_green(self) -> bool:
        """No red F-item (flaky ones are quarantined and reported, not blocking)."""
        return not self.red


class QasRunner:
    def __init__(self, store: Any, cfg: Optional[Config] = None, qas_root: Optional[str] = None,
                 case_runner: Optional[CaseRunner] = None, clock: Any = None, include_regression: bool = True):
        self.store = store
        self.cfg = cfg or load_config()
        self.qas_root = os.path.abspath(qas_root or os.path.join(self.cfg.workroot, "qas"))
        self.case_runner = case_runner or default_case_runner
        self.clock = clock or getattr(store, "clock", None) or SystemClock()
        self.include_regression = include_regression

    def _acceptance(self, run: str) -> Dict[str, List[str]]:
        """f_item -> dotted names of its acceptance tests."""
        out: Dict[str, List[str]] = {}
        for row in self.store.query(E_ACC_TEST, run=run):
            name = test_name(row)
            if name:
                out.setdefault(str(row.get("f_item") or "?"), []).append(name)
        return out

    def run(self, run: str, qas_dir: Optional[str] = None, repeats: Optional[int] = None) -> QasReport:
        repeats = int(repeats or self.cfg.qas_repeats or 3)
        workdir = qas_dir or current_dir(self.qas_root)
        if not workdir or not os.path.isdir(workdir):
            raise LineError(codes.NOT_FOUND, "no live QAS color under %s" % self.qas_root, {"qas_root": self.qas_root})
        groups = self._acceptance(run)
        names = [n for ns in groups.values() for n in ns]

        acc_runs: List[Dict[str, bool]] = []
        reg_runs: List[Dict[str, bool]] = []
        with qas_lock(self.qas_root, "qas:%s" % run):
            for _ in range(repeats):
                acc_runs.append(self.case_runner(workdir, names) if names else {})
                if self.include_regression:
                    reg_runs.append(self.case_runner(workdir, []))

        report = QasReport(run, repeats, qas_dir=workdir)
        for f_item in sorted(groups):
            per_test: Dict[str, List[bool]] = {}
            for name in groups[f_item]:
                per_test[name] = [self._passed(r, name) for r in acc_runs]
            report.items.append(self._judge(f_item, per_test, repeats))
        if self.include_regression:
            acc_ids = set()
            for r in reg_runs + acc_runs:
                for tid in r:
                    if any(_belongs(tid, n) for n in names):
                        acc_ids.add(tid)
            ids = sorted({tid for r in reg_runs for tid in r} - acc_ids)
            if ids:
                per_test = {tid: [bool(r.get(tid, False)) for r in reg_runs] for tid in ids}
                report.items.append(self._judge(REGRESSION, per_test, repeats))

        env = run_env(self.store, self.cfg, run)
        for item in report.items:
            row = {"id": "%s:%s" % (run, item.f_item), "run": run, "f_item": item.f_item, "runs": item.runs,
                   "verdict": item.verdict, "code": item.code, "tests": item.tests,
                   "quarantined": item.quarantined, "failing": item.failing, "ts_ms": self.clock.now_ms()}
            self.store.put(E_QAS, row["id"], row, run=run)
            gate = Gate.passed(f_item=item.f_item) if item.verdict == GREEN else \
                Gate.fail(item.code, f_item=item.f_item, runs=item.runs, tests=item.failing or item.quarantined)
            put_gate(self.store, run, "", 0, "qas:%s" % item.f_item, gate)
            self.store.emit(codes.QAS_RESULT, env, {k: row[k] for k in
                                                   ("f_item", "runs", "verdict", "code", "quarantined", "failing")})
        return report

    @staticmethod
    def _passed(result: Dict[str, bool], name: str) -> bool:
        hits = [v for tid, v in result.items() if _belongs(tid, name)]
        return bool(hits) and all(hits)

    @staticmethod
    def _judge(f_item: str, per_test: Dict[str, List[bool]], repeats: int) -> FItemResult:
        verdicts = {t: verdict(r) for t, r in per_test.items()}
        runs = [all(per_test[t][i] for t in per_test) if per_test else False for i in range(repeats)]
        red = sorted(t for t, v in verdicts.items() if v == RED)
        flaky = sorted(t for t, v in verdicts.items() if v == FLAKY)
        if not per_test:
            return FItemResult(f_item, RED, runs, codes.QAS_RED, {}, [], [])
        if red:
            return FItemResult(f_item, RED, runs, codes.QAS_RED, per_test, flaky, red)
        if flaky:
            return FItemResult(f_item, FLAKY, runs, codes.FLAKY, per_test, flaky, [])
        return FItemResult(f_item, GREEN, runs, "", per_test, [], [])


__all__ = ["QasRunner", "QasReport", "FItemResult", "default_case_runner", "verdict", "REGRESSION",
           "GREEN", "RED", "FLAKY"]
