"""Target stacks: how the line tests, smoke-checks and lets a builder run tests in ONE target repo.

The engine used to assume Python + unittest everywhere (test author, test check, verifier, merge queue,
QAS runner, smoke, builder tool allowlist). A Stack holds every one of those choices for one kind of
target, so the pipeline asks the stack instead:

    st = for_repo(workdir)          # explicit name > configure() > env LINE_STACK > auto-detect
    st.run(workdir, names)          # -> {"rc", "ran", "failures", "output", "timeout", "results"}
    st.run_cases(workdir, names)    # -> {test id: passed}            (QAS repeats, baseline/regression diff)
    st.run_one(workdir, name)       # -> {"outcome": pass|fail|error|timeout, "rc", "tail"}  (red on empty)
    st.smoke_argv(workdir)          # QAS smoke command
    st.allowed_tools                # builder --allowedTools
    st.prepare(workdir)             # make the tree runnable (node_modules); None = ok, else error text

Stacks:
    python-unittest   the original behaviour, byte for byte (the default when nothing else is detected)
    node-cap          SAP CAP (package.json with @sap/cds): jest | mocha | vitest | npm test
    node-ui5-ts       UI5 TypeScript (ui5.yaml or @ui5/* / @openui5 / @sapui5 types)
    react             React (react in dependencies)

Adding a stack = one class with detect() and the members above, registered in STACKS. See
docs/dlc/stacks.md.

Every call site keeps its original Python code path when the stack is python-unittest
(``st.is_python``); only other stacks take the new path, so Python targets behave exactly as before.
"""

from __future__ import annotations

import os
import threading
from typing import Dict, List, Optional

from .base import AUTO, PYTHON, Stack, StackError
from .node import NodeCap, NodeGeneric, NodeReact, NodeUi5Ts
from .python_pytest import PythonPytest
from .python_unittest import PythonUnittest

#: registry, most specific first (detect() ties go to the earlier entry)
STACKS: Dict[str, Stack] = {s.name: s for s in (NodeCap(), NodeUi5Ts(), NodeReact(), NodeGeneric(), PythonPytest(),
                                                PythonUnittest())}

_configured = threading.local()
_global: Dict[str, str] = {"name": ""}


def names() -> List[str]:
    return [AUTO] + list(STACKS)


def configure(name: str) -> None:
    """Process default (from Config.stack / LINE_STACK). '' or 'auto' = detect per repo."""
    name = (name or "").strip()
    if name and name != AUTO and name not in STACKS:
        raise StackError("unknown stack %r (one of %s)" % (name, ", ".join(names())))
    _global["name"] = "" if name == AUTO else name


def get(name: str) -> Stack:
    if name not in STACKS:
        raise StackError("unknown stack %r (one of %s)" % (name, ", ".join(names())))
    return STACKS[name]


def detect(repo: str) -> Stack:
    """Best-scoring stack for repo; python-unittest when nothing scores (empty or Python repo)."""
    best: Optional[Stack] = None
    best_score = 0
    if repo and os.path.isdir(repo):
        for st in STACKS.values():
            score = st.detect(repo)
            if score > best_score:
                best, best_score = st, score
    return best or STACKS[PYTHON]


def chosen_name(explicit: str = "") -> str:
    """The stack name in force without looking at a repo ('' = auto)."""
    for n in (explicit, _global["name"], os.environ.get("LINE_STACK", "")):
        n = (n or "").strip()
        if n and n != AUTO:
            return n
    return ""


def for_repo(repo: str, name: str = "") -> Stack:
    """The stack for one target tree: explicit name > configure() > env LINE_STACK > detect(repo)."""
    n = chosen_name(name)
    return get(n) if n else detect(repo)


#: folders never searched for a nested app
_SKIP_NESTED = {"node_modules", ".git", "dist", "build", "__pycache__", ".venv", "venv"}


def nested_apps(tree: str, depth: int = 3) -> List[str]:
    """Folders below ``tree`` (not ``tree`` itself) holding a package.json: a Node app living in a sub-folder of
    a repo the line tests as Python (e.g. NotesApp/ in a Python repo). Its node_modules is never in git, so a
    fresh export (QAS color, merge checkout) cannot start it until prepare_nested() installs it."""
    out: List[str] = []
    if not tree or not os.path.isdir(tree):
        return out
    base = os.path.normpath(tree).count(os.sep)
    for root, dirs, files in os.walk(tree):
        dirs[:] = sorted(d for d in dirs if d not in _SKIP_NESTED and not d.startswith("."))
        if os.path.normpath(root).count(os.sep) - base >= depth:
            dirs[:] = []
        if root != tree and "package.json" in files:
            out.append(root)
            dirs[:] = []                         # an app's own sub-folders are its business
    return out


def prepare_nested(tree: str) -> List[str]:
    """Install node_modules of every nested Node app of ``tree`` (see nested_apps); returns the errors."""
    node = STACKS["react"]
    errors = []
    for d in nested_apps(tree):
        why = node.prepare(d)
        if why:
            errors.append("%s: %s" % (os.path.relpath(d, tree), why))
    return errors


__all__ = ["AUTO", "PYTHON", "STACKS", "Stack", "StackError", "configure", "detect", "for_repo", "get", "names",
           "chosen_name", "nested_apps", "prepare_nested"]
