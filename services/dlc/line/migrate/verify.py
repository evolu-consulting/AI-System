"""Steps 7 + 9: run the whole v2 test suite (baseline before, verify after) and compare.

suite(repo) -> {"supported", "tests": {name: "ok"|"fail"|"error"|"skip"}, "passed", "failed", "code", "output"}
regressions(before, after, superseded=()) -> [test names that passed before and do not pass now]

Stack per repository (line/stacks): Python unittest as before; Node stacks (CAP, UI5 TS, React) through their own
runner with per-test results.
"""

from __future__ import annotations

import os
import re
import subprocess
import sys
from typing import Any, Dict, Iterable, List, Mapping

from ..ship._util import child_env

#: "test_x (pkg.mod.Class) ... ok" (3.10) and "test_x (pkg.mod.Class.test_x) ... ok" (3.11+)
_LINE = re.compile(r"^(test\w*) \(([\w.]+)\)(?: \.\.\.|\n.*?\.\.\.) ?(ok|FAIL|ERROR|skipped.*|expected failure|unexpected success)",
                   re.M)
_STATUS = {"ok": "ok", "FAIL": "fail", "ERROR": "error", "expected failure": "ok", "unexpected success": "fail"}


def is_python(repo: str) -> bool:
    for root, dirs, files in os.walk(repo):
        dirs[:] = [d for d in dirs if d not in (".git", "node_modules", "__pycache__")]
        if any(f.endswith(".py") for f in files):
            return True
    return False


def parse(output: str) -> Dict[str, str]:
    out: Dict[str, str] = {}
    for name, where, status in _LINE.findall(output or ""):
        cls = where[:-(len(name) + 1)] if where.endswith("." + name) else where
        out["%s.%s" % (cls, name)] = "skip" if status.startswith("skipped") else _STATUS.get(status, "error")
    return out


def suite(repo: str, timeout: float = 1800) -> Dict[str, Any]:
    from .. import stacks
    st = stacks.for_repo(repo)
    if not st.is_python:
        r = st.run(repo, [], max(timeout, st.suite_timeout_s))
        tests = {k: ("ok" if v else "fail") for k, v in (r.get("results") or {}).items()}
        return {"supported": bool(tests), "tests": tests,
                "passed": sum(1 for v in tests.values() if v == "ok"),
                "failed": sum(1 for v in tests.values() if v != "ok"),
                "code": r.get("rc"), "output": (r.get("output") or "")[-4000:]}
    if not is_python(repo):
        return {"supported": False, "tests": {}, "passed": 0, "failed": 0, "code": -1, "output": "no Python files"}
    try:
        cp = subprocess.run([__import__('line.runtime', fromlist=['python_exe']).python_exe(), "-m", "unittest", "discover", "-v"], cwd=repo, capture_output=True,
                            text=True, encoding="utf-8", errors="replace", env=child_env(), timeout=timeout)
        output, code = (cp.stdout or "") + (cp.stderr or ""), cp.returncode
    except (OSError, subprocess.TimeoutExpired) as e:
        output, code = "suite did not finish: %s" % e, -1
    tests = parse(output)
    return {"supported": bool(tests), "tests": tests, "passed": sum(1 for v in tests.values() if v == "ok"),
            "failed": sum(1 for v in tests.values() if v in ("fail", "error")), "code": code, "output": output[-4000:]}


def regressions(before: Mapping[str, str], after: Mapping[str, str], superseded: Iterable[str] = ()) -> List[str]:
    sup = [s for s in superseded if s]
    out = []
    for name, st in sorted(before.items()):
        if st != "ok" or after.get(name) == "ok":
            continue
        if any(s in name for s in sup):
            continue
        out.append(name)
    return out


__all__ = ["suite", "parse", "regressions", "is_python"]
