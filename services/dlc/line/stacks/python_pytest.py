"""python-pytest: a Python repository whose tests run under pytest (conftest.py, pytest.ini, [tool.pytest]).

The suite is the repository's own test command when it names one (LINE_TEST_CMD, e.g. "python scripts/run_tests.py"
for a repo that keeps a quarantine list or sets its own environment), else `python -m pytest -q`. Results are read
from pytest's summary line ("2579 passed, 3 failed, 511 skipped"). Used by the solo lane's gate and QAS smoke; the
team lane's acceptance-test machinery stays on python-unittest.
"""

from __future__ import annotations

import os
import re
import shlex
from typing import Any, Dict, List, Optional, Sequence, Set

from .base import Stack, run, tail, test_env

_SUMMARY = re.compile(r"(\d+) (passed|failed|errors?|skipped|xfailed|xpassed)")
_FAILED = re.compile(r"^(?:FAILED|ERROR) (\S+)", re.M)


def _python() -> str:
    from ..runtime import python_exe
    return python_exe()


class PythonPytest(Stack):
    name = "python-pytest"
    display = "Python + pytest"
    is_python = False                   # its own runner (verifier.run_tests calls run())

    @property
    def nests(self) -> bool:
        """Nested Node apps (a web/ folder) join the suite, unless the repository's own command is the suite."""
        return not os.environ.get("LINE_TEST_CMD", "").strip()

    allowed_tools = "Read Edit Write Bash(python -m pytest*)"
    acceptance_dir = "tests"
    test_timeout_s = 900
    suite_timeout_s = 1800

    def detect(self, repo: str) -> int:
        marks = [os.path.join(repo, p) for p in ("conftest.py", os.path.join("tests", "conftest.py"), "pytest.ini")]
        if any(os.path.isfile(p) for p in marks):
            return 60
        for cfg, key in (("pyproject.toml", "[tool.pytest"), ("setup.cfg", "[tool:pytest")):
            try:
                with open(os.path.join(repo, cfg), encoding="utf-8", errors="replace") as fh:
                    if key in fh.read():
                        return 60
            except OSError:
                continue
        return 0

    def target_file(self, f_item: str) -> str:
        return "tests/test_%s.py" % re.sub(r"\W+", "_", f_item.lower()).strip("_")

    def path_ok(self, path: str) -> bool:
        return path.replace("\\", "/").startswith("tests/") and path.endswith(".py")

    def defined_tests(self, path: str, content: str) -> Optional[Set[str]]:
        try:
            compile(content, path, "exec", dont_inherit=True)
        except SyntaxError:
            return None
        return set(re.findall(r"^\s*def (test_\w+)", content, re.M))

    def name_ok(self, name: str) -> bool:
        return bool(re.match(r"^[\w/.\-]+\.py(::\w+)*$", name))

    def name_example(self) -> str:
        return "tests/test_feature.py::test_case"

    def compile_error(self, path: str, content: bytes) -> Optional[str]:
        if not path.endswith(".py"):
            return None
        try:
            compile(content, path, "exec", dont_inherit=True)
        except SyntaxError as e:
            return "%s: %s (line %s)" % (type(e).__name__, e.msg, e.lineno)
        return None

    def argv(self, names: Sequence[str]) -> List[str]:
        own = os.environ.get("LINE_TEST_CMD", "").strip()
        if own and not names:
            parts = shlex.split(own, posix=os.name != "nt")
            return [_python() if parts[0] in ("python", "python3", "py") else parts[0]] + parts[1:]
        return [_python(), "-m", "pytest", "-q", "-p", "no:cacheprovider"] + list(names)

    def test_cmd(self, names: Sequence[str]) -> str:
        own = os.environ.get("LINE_TEST_CMD", "").strip()
        return own if own and not names else "python -m pytest -q " + " ".join(names)

    def run(self, workdir: str, names: Sequence[str], timeout_s: Optional[float] = None) -> Dict[str, Any]:
        r = run(self.argv(names), workdir, float(timeout_s or self.test_timeout_s), test_env())
        out = r.get("output") or ""
        counts: Dict[str, int] = {}
        for line in out.splitlines()[::-1]:
            found = _SUMMARY.findall(line)
            if found and ("passed" in line or "failed" in line or "error" in line):
                for n, kind in found:
                    counts[kind.rstrip("s") if kind.startswith("error") else kind] = int(n)
                break
        failed = _FAILED.findall(out)
        ran = counts.get("passed", 0) + counts.get("failed", 0) + counts.get("error", 0)
        results = {n: (r.get("rc") == 0 and not r.get("timeout")) for n in names}
        return {"rc": r.get("rc"), "ran": ran, "failures": [{"test": f, "kind": "FAIL"} for f in failed],
                "output": tail(out, 20000), "timeout": r.get("timeout"), "results": results}

    def smoke_argv(self, workdir: str) -> List[str]:
        return self.argv([])


__all__ = ["PythonPytest"]
