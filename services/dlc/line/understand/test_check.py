"""Block 9b: acceptance test check and lock.

check_tests(repo, tests) -> Gate
  1. trace: every AccTest names an F-item, criterion, span and existing file; the file
     carries the tag "trace: <criterion> <span_id>" and defines the test method; with a
     digest given, every criterion has a test.                         else TEST_UNTRACED
  2. the files compile.                                                 else SCHEMA_INVALID
  3. each test runs alone (`python -m unittest <name>`, subprocess) against an EMPTY
     implementation: a scratch dir holding only the test files. Any green test means the
     test checks nothing.                                              -> TEST_GREEN_ON_EMPTY
     Red outcomes are recorded as "fail" (assertion) or "error" (exception).
  4. pass: each test is locked (sha256 of its file), rows stored, tests.approved emitted.

locked_tampered(repo, tests) -> [AccTest]   tests whose file sha no longer matches the lock.
"""

from __future__ import annotations

import ast
import os
import re
import shutil
import subprocess
import sys
import tempfile
from typing import Any, Dict, List, Optional, Sequence

from .. import codes, stacks
from ..runtime import python_exe as _python_exe
from ..config import Config
from ..contracts import E_ACC_TEST, AccTest, Digest, Gate, Store, to_dict
from ._common import emit, envelope, sha256_bytes
from .test_author import trace_tag

_SUMMARY_RE = re.compile(r"FAILED \(([^)]*)\)")


def _read(repo: str, rel: str) -> Optional[bytes]:
    full = os.path.join(repo, *rel.replace("\\", "/").split("/"))
    if not os.path.isfile(full):
        return None
    with open(full, "rb") as fh:
        return fh.read()


def _methods(src: str) -> set:
    try:
        tree = ast.parse(src)
    except SyntaxError:
        return set()
    return {"%s.%s" % (n.name, m.name) for n in ast.walk(tree) if isinstance(n, ast.ClassDef)
            for m in n.body if isinstance(m, (ast.FunctionDef, ast.AsyncFunctionDef))}


def trace_problems(repo: str, tests: Sequence[AccTest], digest: Optional[Digest] = None,
                   st: Any = None) -> List[Dict[str, Any]]:
    probs: List[Dict[str, Any]] = []
    srcs: Dict[str, Optional[str]] = {}
    for t in tests:
        if not (t.f_item and t.criterion and t.span_id and t.path and t.name):
            probs.append({"test": t.id, "reason": "missing f_item/criterion/span_id/path/name"})
            continue
        if t.path not in srcs:
            raw = _read(repo, t.path)
            srcs[t.path] = raw.decode("utf-8", "replace") if raw is not None else None
        src = srcs[t.path]
        if src is None:
            probs.append({"test": t.id, "reason": "file missing", "path": t.path})
            continue
        if trace_tag(t.criterion, t.span_id) not in src:
            probs.append({"test": t.id, "reason": "trace tag missing", "tag": trace_tag(t.criterion, t.span_id)})
        if st is not None and not st.is_python:
            if t.name not in (st.defined_tests(t.path.replace("\\", "/"), src) or set()):
                probs.append({"test": t.id, "reason": "test not in file", "name": t.name})
            continue
        mod = t.path.replace("\\", "/")[:-3].replace("/", ".")
        if not t.name.startswith(mod + ".") or t.name[len(mod) + 1:] not in _methods(src):
            probs.append({"test": t.id, "reason": "test method not in file", "name": t.name})
    if digest is not None:
        crit = {c.id: (f, c) for f in digest.f_items for c in f.criteria}
        for t in tests:
            if t.criterion not in crit:
                probs.append({"test": t.id, "reason": "unknown criterion", "criterion": t.criterion})
            else:
                f, c = crit[t.criterion]
                if t.f_item != f.id or (t.span_id != c.span_id and t.span_id not in f.span_ids):
                    probs.append({"test": t.id, "reason": "f_item/span does not match criterion",
                                  "criterion": t.criterion})
        have = {t.criterion for t in tests}
        for cid in crit:
            if cid not in have:
                probs.append({"criterion": cid, "reason": "criterion has no test"})
    return probs


def _stage_empty(repo: str, tests: Sequence[AccTest], dest: str) -> None:
    """Copy only the test files (and their package __init__.py files) into dest."""
    for rel in sorted({t.path.replace("\\", "/") for t in tests}):
        parts = rel.split("/")
        for i in range(1, len(parts)):
            init = "/".join(parts[:i] + ["__init__.py"])
            src = _read(repo, init)
            out = os.path.join(dest, *init.split("/"))
            os.makedirs(os.path.dirname(out), exist_ok=True)
            if not os.path.exists(out):
                with open(out, "wb") as fh:
                    fh.write(src or b"")
        out = os.path.join(dest, *parts)
        with open(out, "wb") as fh:
            fh.write(_read(repo, rel) or b"")


def run_one(workdir: str, name: str, python: str = "", timeout_s: float = 60.0,
            _stack: Any = None) -> Dict[str, Any]:
    """Run one test by dotted name. outcome: pass | fail | error | timeout.
    A non-Python target stack runs the test with its own runner (line.stacks)."""
    if _stack is not None and not _stack.is_python:
        return _stack.run_one(workdir, name, timeout_s)
    python = python or _python_exe()
    env = {k: v for k, v in os.environ.items() if not k.startswith("LINE_") and k != "PYTHONPATH"}
    env.update(PYTHONDONTWRITEBYTECODE="1", PYTHONPATH=workdir, PYTHONIOENCODING="utf-8")
    try:
        p = subprocess.run([python, "-m", "unittest", name], cwd=workdir, env=env, capture_output=True,
                           text=True, encoding="utf-8", errors="replace", timeout=timeout_s)
    except subprocess.TimeoutExpired:
        return {"outcome": "timeout", "rc": None, "tail": ""}
    tail = (p.stderr or "")[-1500:]
    if p.returncode == 0:
        ran0 = re.search(r"Ran 0 tests", p.stderr or "")
        return {"outcome": "error" if ran0 else "pass", "rc": 0, "tail": tail}
    m = _SUMMARY_RE.search(p.stderr or "")
    outcome = "error"
    if m and "failures=" in m.group(1) and "errors=" not in m.group(1):
        outcome = "fail"
    return {"outcome": outcome, "rc": p.returncode, "tail": tail}


def check_tests(repo: str, tests: Sequence[AccTest], *, digest: Optional[Digest] = None, run: str = "",
                store: Optional[Store] = None, spec_hash: str = "", cfg: Optional[Config] = None,
                python: str = "", timeout_s: float = 60.0) -> Gate:
    python = python or _python_exe()
    if not tests:
        return Gate.fail(codes.TEST_UNTRACED, reason="no tests")
    st = stacks.for_repo(repo, str(getattr(cfg, "stack", "") or ""))
    probs = trace_problems(repo, tests, digest, st=None if st.is_python else st)
    if probs:
        return Gate.fail(codes.TEST_UNTRACED, untraced=probs)

    bad = []
    for rel in sorted({t.path for t in tests}):
        if not st.is_python:
            err = st.compile_error(rel, _read(repo, rel) or b"")
            if err:
                bad.append({"path": rel, "error": err})
            continue
        try:
            compile(_read(repo, rel) or b"", rel, "exec")
        except SyntaxError as e:
            bad.append({"path": rel, "error": str(e)})
    if bad:
        return Gate.fail(codes.SCHEMA_INVALID, syntax=bad)

    outcomes: Dict[str, Dict[str, Any]] = {}
    scratch = tempfile.mkdtemp(prefix="line-empty-")
    try:
        _stage_empty(repo, tests, scratch)
        if not st.is_python:
            st.stage_empty_extra(repo, scratch)
        for t in tests:
            if st.is_python:
                outcomes[t.id] = run_one(scratch, t.name, python, timeout_s)
            else:
                outcomes[t.id] = run_one(scratch, t.name, python, max(timeout_s, float(st.test_timeout_s)),
                                         _stack=st)
    finally:
        shutil.rmtree(scratch, ignore_errors=True)
    green = [t.id for t in tests if outcomes[t.id]["outcome"] == "pass"]
    summary = {tid: o["outcome"] for tid, o in outcomes.items()}
    if green:
        return Gate.fail(codes.TEST_GREEN_ON_EMPTY, green=green, outcomes=summary,
                         evidence={tid: outcomes[tid]["tail"][-400:] for tid in green})

    files: Dict[str, str] = {}
    for t in tests:
        if t.path not in files:
            files[t.path] = sha256_bytes(_read(repo, t.path) or b"")
        t.sha = files[t.path]
        t.locked = True
        if store is not None:
            store.put(E_ACC_TEST, "%s:%s" % (run, t.id) if run else t.id, dict(to_dict(t), run=run), run=run)
    if store is not None:
        env = envelope(run or "tests-" + (spec_hash[:12] or "local"), spec_hash=spec_hash, cfg=cfg)
        emit(store, codes.TESTS_APPROVED, env, {
            "tests": [t.id for t in tests], "files": files, "outcomes": summary,
            "trace": {t.id: {"f_item": t.f_item, "criterion": t.criterion, "span_id": t.span_id} for t in tests}})
    return Gate.passed(tests=[t.id for t in tests], files=files, outcomes=summary)


def locked_tampered(repo: str, tests: Sequence[AccTest]) -> List[AccTest]:
    out = []
    for t in tests:
        if t.locked and sha256_bytes(_read(repo, t.path) or b"") != t.sha:
            out.append(t)
    return out


__all__ = ["check_tests", "trace_problems", "run_one", "locked_tampered"]
