"""Acceptance tests run where they will run, before they are locked.

The test author writes its tests blind (one answer, no tools), and check_tests only runs them on an EMPTY tree
(a green test there checks nothing). A test that breaks on the machine itself was found only after the build, at
QAS or by a blocked builder: it ran `git` in the QAS copy (no .git there), needed a JSX converter nobody had
installed, or read a tool's output in a format this Node version does not print. Now, before the lock:

    staged = stage(repo, tests)            # a copy like the QAS one: `git archive HEAD`, the new test files,
                                           # the packages of package.json installed; nothing else
    outcomes = run_all(staged, tests)      # each test alone: pass | fail | error | timeout, with the output tail
    broken = suspects(staged, tests, outcomes)
        error / timeout whose output does NOT point at a file or name of the repo that is missing (that is the
        change still to build) -> broken for the machine; an F-item whose tests all pass on today's code ->
        its tests do not check the change
    settle(...)                            # broken ones: ONE agent round in that copy (role test_author, tools
                                           # on): fix the tests until they run here and fail only on an
                                           # assertion; the files go back to the repo, trace checked again

Still broken after the round -> TEST_BROKEN_HERE (before any build is paid). All green after it: kept, with a
note on the run board. LINE_TESTS_HERE: auto (on with a real model) | 1 | 0.
"""

from __future__ import annotations

import os
import re
import shutil
import subprocess
import tarfile
import tempfile
from typing import Any, Callable, Dict, List, Optional, Sequence

from .. import codes, stacks
from ..contracts import AccTest, Digest, Gate
from ..runtime import python_exe as _python_exe
from .test_check import run_one, trace_problems

ROLE = "test_author"
MAX_TURNS = 40

#: an error that names something of the repo that does not exist yet: the change the build adds, not the machine
_MISSING = (
    re.compile(r"No module named '([\w.]+)'"),
    re.compile(r"Cannot find (?:module|package) '([^']+)'"),
    re.compile(r"No such file or directory: '([^']+)'"),
    re.compile(r"ENOENT[^\n']*'([^']+)'"),
    re.compile(r"cannot import name '\w+' from '([\w.]+)'"),
    re.compile(r"does not provide an export named '\w+'[^\n]*?'([^']+)'"),
    re.compile(r"module '([\w.]+)' has no attribute"),
)


def enabled(cfg: Any) -> bool:
    mode = str(getattr(cfg, "tests_here", "auto") or "auto").strip().lower()
    if mode in ("0", "off", "false", "no"):
        return False
    if mode in ("1", "on", "true", "yes"):
        return True
    return str(getattr(cfg, "llm", "fake")) != "fake"


def _git(repo: str, *args: str) -> subprocess.CompletedProcess:
    return subprocess.run(["git", *args], cwd=repo, capture_output=True, text=True, encoding="utf-8",
                          errors="replace", creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))


def _export(repo: str, dest: str) -> None:
    """main's tracked files, as the QAS copy has them (git archive: no .git, nothing ignored)."""
    fd, tar = tempfile.mkstemp(prefix="line-here-", suffix=".tar")
    os.close(fd)
    try:
        cp = _git(repo, "archive", "--format=tar", "-o", tar, "HEAD")
        if cp.returncode != 0:
            raise RuntimeError("git archive: %s" % cp.stderr.strip()[-300:])
        with tarfile.open(tar) as tf:
            safe = [m for m in tf.getmembers()
                    if not m.name.startswith(("/", "\\")) and ".." not in m.name.replace("\\", "/").split("/")]
            if hasattr(tarfile, "data_filter"):
                tf.extractall(dest, members=safe, filter="data")
            else:
                tf.extractall(dest, members=safe)
    finally:
        try:
            os.remove(tar)
        except OSError:
            pass


def _test_dirs(tests: Sequence[AccTest]) -> List[str]:
    return sorted({t.path.replace("\\", "/").rsplit("/", 1)[0] for t in tests if "/" in t.path})


def _copy_tree(src: str, dst: str) -> None:
    if os.path.isdir(src):
        shutil.copytree(src, dst, dirs_exist_ok=True, ignore=shutil.ignore_patterns("__pycache__", "*.pyc"))


def stage(repo: str, tests: Sequence[AccTest], dest: Optional[str] = None) -> str:
    """A QAS-like copy of the repo with this run's test files; the Node packages installed as QAS does."""
    dest = dest or tempfile.mkdtemp(prefix="line-here-")
    _export(repo, dest)
    for d in _test_dirs(tests):                    # the new (uncommitted) test files and their helpers
        _copy_tree(os.path.join(repo, *d.split("/")), os.path.join(dest, *d.split("/")))
        parts = d.split("/")
        for i in range(1, len(parts)):             # their package __init__.py files (written with the tests)
            init = os.path.join(repo, *parts[:i], "__init__.py")
            if os.path.isfile(init):
                shutil.copyfile(init, os.path.join(dest, *parts[:i], "__init__.py"))
    st = stacks.for_repo(dest)
    if not st.is_python:
        st.prepare(dest)
    else:
        stacks.prepare_nested(dest)
    return dest


def run_all(staged: str, tests: Sequence[AccTest], python: str = "", timeout_s: float = 120.0) -> Dict[str, Dict[str, Any]]:
    st = stacks.for_repo(staged)
    out: Dict[str, Dict[str, Any]] = {}
    for t in tests:
        if st.is_python:
            out[t.id] = run_one(staged, t.name, python or _python_exe(), timeout_s)
        else:
            out[t.id] = run_one(staged, t.name, timeout_s=max(timeout_s, float(st.test_timeout_s)), _stack=st)
    return out


def _names_missing_repo_thing(staged: str, tail: str) -> bool:
    """The output points at a file / module of the repo that is not there yet (the change still to build)."""
    root = os.path.realpath(staged)
    for rx in _MISSING:
        for hit in rx.findall(tail or ""):
            ref = str(hit).strip()
            cands = []
            if re.fullmatch(r"[\w.]+", ref) and "." in ref and not ref.endswith((".js", ".jsx", ".ts", ".tsx", ".py",
                                                                                  ".mjs", ".cjs", ".json")):
                cands.append(os.path.join(root, *ref.split(".")))            # a dotted Python module
            if os.path.isabs(ref):
                cands.append(ref)
            elif "/" in ref or "\\" in ref or "." in ref:
                cands.append(os.path.join(root, ref.lstrip("./\\")))
            for c in cands:
                c = os.path.realpath(c)
                if not (c == root or c.startswith(root + os.sep)):
                    continue                                                # outside the repo: the machine's
                if rx.pattern.startswith(("cannot import", "does not", "module '")):
                    return True                                             # the module is there, the name not yet
                if not any(os.path.exists(c + ext) for ext in ("", ".py", ".js", ".jsx", ".ts", ".tsx", ".mjs")):
                    return True
    return False


def suspects(staged: str, tests: Sequence[AccTest], outcomes: Dict[str, Dict[str, Any]]) -> Dict[str, Any]:
    """{"broken": [{test, name, outcome, tail}], "all_green": [F-item]} for the agent round and the gate."""
    broken = []
    for t in tests:
        o = outcomes.get(t.id) or {}
        if o.get("outcome") in ("error", "timeout") and not _names_missing_repo_thing(staged, str(o.get("tail") or "")):
            broken.append({"test": t.id, "name": t.name, "outcome": o.get("outcome"),
                           "tail": str(o.get("tail") or "")[-1200:]})
    by_f: Dict[str, List[str]] = {}
    for t in tests:
        by_f.setdefault(t.f_item, []).append((outcomes.get(t.id) or {}).get("outcome") or "")
    green = [f for f, outs in by_f.items() if outs and all(o == "pass" for o in outs)]
    return {"broken": broken, "all_green": sorted(green)}


def _prompt(tests: Sequence[AccTest], outcomes: Dict[str, Dict[str, Any]], found: Dict[str, Any], st: Any) -> str:
    paths = sorted({t.path.replace("\\", "/") for t in tests})
    cmd = ("python -m unittest <dotted test name>" if st.is_python else
           "the repo's test runner on the file (%s)" % st.test_cmd([t.name for t in tests]))
    lines = [
        "You wrote acceptance tests for a change that is NOT built yet. They now sit in this folder: a copy of the",
        "repository exactly as the test machine (QAS) gets it: no .git folder, the packages of package.json",
        "installed, nothing else installed (no global tools beyond python and node).",
        "Some tests break for the MACHINE, not for the missing change. Fix them so that every test RUNS here and",
        "fails only on an assertion about the requested behaviour (or errors only because a file, module or",
        "function the change must add is not there yet).",
        "",
        "Rules:",
        "- Edit only these test files (helper files next to them are allowed): %s" % ", ".join(paths),
        "- Never edit the application code, never install packages, never call git, never use the network.",
        "- Keep every test name and every 'trace: ...' tag; do not add or drop tests.",
        "- Prefer plain checks the app's own files and packages allow (read the source, call its functions)",
        "  over harnesses that need tools this machine does not have.",
        "- Run each test you changed (%s) and look at the result before you finish." % cmd,
        "- Finish with SUBMIT when they run here; BLOCKED: <reason> if a test cannot run here at all.",
        "",
        "## Tests that break for the machine",
    ]
    for b in found["broken"]:
        lines += ["- %s (%s):" % (b["name"], b["outcome"]), "```", b["tail"][-900:], "```"]
    if found["all_green"]:
        lines += ["", "## F-items whose tests all PASS on today's code (they do not check the change; make at least",
                  "one fail on today's code, per the spec): %s" % ", ".join(found["all_green"])]
    lines += ["", "## Every test now"] + ["- %s: %s" % (t.name, (outcomes.get(t.id) or {}).get("outcome"))
                                         for t in tests]
    return "\n".join(lines)


def _copy_back(staged: str, repo: str, tests: Sequence[AccTest]) -> List[str]:
    """The test dirs of the copy back into the repo (the files the agent fixed, helpers it added)."""
    changed = []
    for d in _test_dirs(tests):
        src = os.path.join(staged, *d.split("/"))
        for base, dirs, files in os.walk(src):
            dirs[:] = [x for x in dirs if x not in ("__pycache__", "node_modules")]
            for fn in files:
                if fn.endswith(".pyc"):
                    continue
                s = os.path.join(base, fn)
                rel = os.path.relpath(s, staged)
                t = os.path.join(repo, rel)
                with open(s, "rb") as fh:
                    data = fh.read()
                old = None
                if os.path.isfile(t):
                    with open(t, "rb") as fh:
                        old = fh.read()
                if old != data:
                    os.makedirs(os.path.dirname(t), exist_ok=True)
                    with open(t, "wb") as fh:
                        fh.write(data)
                    changed.append(rel.replace("\\", "/"))
    return changed


def settle(repo: str, tests: Sequence[AccTest], llm: Any, *, run: str = "", digest: Optional[Digest] = None,
           cfg: Any = None, log: Optional[Callable[[str], None]] = None, python: str = "") -> Gate:
    """Run the tests where they will run; one agent round fixes the ones broken for the machine. Gate ok or
    TEST_BROKEN_HERE. Never runs the agent when nothing is broken."""
    say = log or (lambda m: None)
    st = stacks.for_repo(repo)
    staged = tempfile.mkdtemp(prefix="line-here-")
    try:
        stage(repo, tests, staged)
        outcomes = run_all(staged, tests, python)
        found = suspects(staged, tests, outcomes)
        if not found["broken"] and not found["all_green"]:
            say("%s: acceptance tests run on a QAS-like copy: %s" % (run, _summary(outcomes)))
            return Gate.passed(outcomes={k: v["outcome"] for k, v in outcomes.items()})
        say("%s: acceptance tests on a QAS-like copy: %d broken for the machine%s; the test author fixes them there"
            % (run, len(found["broken"]), (", all green: " + ",".join(found["all_green"])) if found["all_green"] else ""))
        usd = float(getattr(cfg, "tests_here_max_usd", 1.5) or 1.5)
        res = llm.agentic(ROLE, staged, _prompt(tests, outcomes, found, st), MAX_TURNS, usd, key="tests-here", run=run)
        changed = _copy_back(staged, repo, tests)
        outcome = str(getattr(res, "outcome", "") or "")
    finally:
        shutil.rmtree(staged, ignore_errors=True)
    probs = trace_problems(repo, tests, digest, st=None if st.is_python else st)
    if probs:
        return Gate.fail(codes.TEST_BROKEN_HERE, reason="the fixed tests lost their trace", untraced=probs[:10],
                         changed=changed)
    staged = tempfile.mkdtemp(prefix="line-here-")
    try:
        stage(repo, tests, staged)
        outcomes = run_all(staged, tests, python)
        again = suspects(staged, tests, outcomes)
    finally:
        shutil.rmtree(staged, ignore_errors=True)
    summary = {k: v["outcome"] for k, v in outcomes.items()}
    if again["broken"]:
        return Gate.fail(codes.TEST_BROKEN_HERE, broken=again["broken"][:6], outcomes=summary, changed=changed,
                         agent=outcome[:300])
    say("%s: acceptance tests fixed on the QAS-like copy (%s)%s" % (
        run, ", ".join(changed) or "no file changed",
        ("; still all green: " + ",".join(again["all_green"])) if again["all_green"] else ""))
    return Gate.passed(outcomes=summary, changed=changed, all_green=again["all_green"])


def _summary(outcomes: Dict[str, Dict[str, Any]]) -> str:
    n: Dict[str, int] = {}
    for o in outcomes.values():
        n[o["outcome"]] = n.get(o["outcome"], 0) + 1
    return ", ".join("%d %s" % (v, k) for k, v in sorted(n.items()))


__all__ = ["enabled", "stage", "run_all", "suspects", "settle", "ROLE"]
