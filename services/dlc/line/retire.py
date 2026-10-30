"""Retire a locked acceptance test of an EARLIER run when a newer request changes the behaviour it locks in.

Each run locks its acceptance tests on main, and every later run's QAS regression runs them all. That is the
regression net, until a request changes on purpose what an earlier test asserts: a restyle that said "do not fix
the existing bug" locked a test asserting the bug, and the bug fix that came next could never pass QAS (run
R20261016-132739-0a07). Nobody may edit locked tests, so the supervisor retires the earlier test instead:

    failing = failing_tests(output)                       # ["tests.acceptance.test_58b0_f1.TestF1.test_c8", ...]
    owners  = owners(store, failing)                      # {test id: run that locked it}
    done    = retire(repo, test_id, reason, by_run)       # skip decorator + one commit on main, or raises

Only a test of a run other than the one that failed (never the current request's own tests), only Python
unittest tests for now; the commit says which test, why and by whom, so history keeps it and a person can
revert it.
"""

from __future__ import annotations

import ast
import os
import re
from typing import Any, Dict, List

from .contracts import E_ACC_TEST
from .ship._util import git, git_out

_UNITTEST = re.compile(r"^(?:FAIL|ERROR): (\w+) \(([\w.]+)\)", re.M)


def failing_tests(output: str) -> List[str]:
    """Dotted ids of the unittest tests an output reports as failed or errored (order kept, no repeats)."""
    out: List[str] = []
    for m in _UNITTEST.finditer(output or ""):
        tid = m.group(2) if m.group(2).endswith("." + m.group(1)) else m.group(2) + "." + m.group(1)
        if tid not in out:
            out.append(tid)
    return out


def _path_of(test_id: str) -> str:
    """tests.acceptance.test_58b0_f1.TestF1.test_c8 -> tests/acceptance/test_58b0_f1.py"""
    parts = test_id.split(".")
    return "/".join(parts[:-2]) + ".py" if len(parts) >= 3 else ""


def owners(store: Any, test_ids: List[str]) -> Dict[str, str]:
    """{test id: the run that locked its file}, for the tests the store knows."""
    by_path: Dict[str, str] = {}
    for r in store.query(E_ACC_TEST):
        if r.get("locked") and r.get("path"):
            by_path.setdefault(str(r["path"]).replace("\\", "/"), str(r.get("run") or ""))
    return {t: by_path[_path_of(t)] for t in test_ids if _path_of(t) in by_path}


def retire(repo: str, test_id: str, reason: str, by_run: str) -> Dict[str, Any]:
    """Skip one unittest test method with a reason, committed on main. Raises ValueError when it cannot."""
    rel = _path_of(test_id)
    full = os.path.join(repo, *rel.split("/"))
    if not rel or not os.path.isfile(full):
        raise ValueError("no test file for %s" % test_id)
    cls, meth = test_id.split(".")[-2:]
    with open(full, encoding="utf-8") as fh:
        src = fh.read()
    tree = ast.parse(src)
    node = next((m for c in ast.walk(tree) if isinstance(c, ast.ClassDef) and c.name == cls
                 for m in c.body if isinstance(m, (ast.FunctionDef, ast.AsyncFunctionDef)) and m.name == meth), None)
    if node is None:
        raise ValueError("%s is not defined in %s" % (test_id, rel))
    lines = src.splitlines(keepends=True)
    first = min([node.lineno] + [d.lineno for d in node.decorator_list]) - 1
    indent = re.match(r"\s*", lines[node.lineno - 1]).group(0)
    why = re.sub(r"[\"\\\n\r]+", " ", reason).strip()[:200] or "superseded by a later request"
    lines.insert(first, '%s@unittest.skip("retired by the line supervisor after run %s: %s")\n' % (indent, by_run, why))
    text = "".join(lines)
    if not re.search(r"^import unittest\b|^from unittest\b|^import .*\bunittest\b", text, re.M):
        text = "import unittest\n" + text
    if git(repo, "status", "--porcelain", check=False).stdout.strip():
        raise ValueError("the repository has uncommitted changes")
    with open(full, "w", encoding="utf-8", newline="") as fh:
        fh.write(text)
    git(repo, "add", "--", rel)
    git(repo, "-c", "gc.auto=0", "commit", "-q", "-m",
        "line supervisor: retire %s (after run %s: %s)" % (test_id, by_run, why))
    return {"test": test_id, "path": rel, "commit": git_out(repo, "rev-parse", "HEAD"), "reason": why}


__all__ = ["failing_tests", "owners", "retire"]
