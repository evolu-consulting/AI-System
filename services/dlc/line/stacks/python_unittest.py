"""python-unittest: the engine's original target stack. Every call site keeps its own Python code path for
this stack (st.is_python), so these members exist for callers that work through the Stack interface
(the migration baseline / verify step, docs, tests) and delegate to the original functions."""

from __future__ import annotations

import ast
import os
import re
import sys
from typing import Any, Dict, List, Optional, Sequence, Set

from ..runtime import python_exe
from .base import PYTHON, Stack

_PATH_RE = re.compile(r"^[A-Za-z0-9_/]+/test_\w+\.py$")
_NAME_RE = re.compile(r"^[A-Za-z_]\w*\.test\w*$")
_SKIP = {".git", "node_modules", "__pycache__", ".venv", "venv", "dist", "build"}


class PythonUnittest(Stack):
    name = PYTHON
    display = "Python + unittest"
    is_python = True
    allowed_tools = "Read Edit Write Bash(python -m unittest*)"
    test_timeout_s = 300

    def detect(self, repo: str) -> int:
        # the fallback: a repo with any .py file scores 1, everything else 0 (registry falls back to us anyway)
        for root, dirs, files in os.walk(repo):
            dirs[:] = [d for d in dirs if d not in _SKIP]
            if any(f.endswith(".py") for f in files):
                return 1
            if root.count(os.sep) - repo.count(os.sep) >= 3:
                dirs[:] = []
        return 0

    def target_file(self, f_item: str) -> str:
        return "%s/test_%s.py" % (self.acceptance_dir, re.sub(r"\W", "_", f_item.lower()))

    def path_ok(self, path: str) -> bool:
        return bool(_PATH_RE.match(path))

    def defined_tests(self, path: str, content: str) -> Optional[Set[str]]:
        try:
            tree = ast.parse(content)
        except SyntaxError:
            return None
        mod = path.replace("\\", "/")[:-3].replace("/", ".")
        return {"%s.%s.%s" % (mod, n.name, m.name) for n in ast.walk(tree) if isinstance(n, ast.ClassDef)
                for m in n.body if isinstance(m, (ast.FunctionDef, ast.AsyncFunctionDef))}

    def name_ok(self, name: str) -> bool:
        return bool(_NAME_RE.match(name))

    def name_example(self) -> str:
        return "TestF2.test_c1"

    def compile_error(self, path: str, content: bytes) -> Optional[str]:
        if not path.endswith(".py"):
            return None
        try:
            compile(content, path, "exec", dont_inherit=True)
        except SyntaxError as e:
            return "%s: %s (line %s)" % (type(e).__name__, e.msg, e.lineno)
        return None

    def test_cmd(self, names: Sequence[str]) -> str:
        return "python -m unittest " + " ".join(names) if names else "python -m unittest"

    def run(self, workdir: str, names: Sequence[str], timeout_s: Optional[float] = None) -> Dict[str, Any]:
        from ..build import verifier
        r = verifier.run_tests(workdir, list(names), int(timeout_s or self.test_timeout_s), _stack=self)
        failed = {f["test"] for f in r.get("failures") or []}
        r.setdefault("results", {})
        if names:
            for n in names:
                r["results"][n] = not any(t == n or t.startswith(n + ".") for t in failed) and not r.get("timeout") \
                    and r.get("rc") == 0
        return r

    def run_cases(self, workdir: str, names: Sequence[str]) -> Dict[str, bool]:
        from ..ship.qas_runner import default_case_runner
        return default_case_runner(workdir, names, _stack=self)

    def run_one(self, workdir: str, name: str, timeout_s: float = 60.0) -> Dict[str, Any]:
        from ..understand.test_check import run_one
        return run_one(workdir, name, python_exe(), timeout_s, _stack=self)

    def smoke_argv(self, workdir: str) -> List[str]:
        return [python_exe(), "-m", "unittest"]
