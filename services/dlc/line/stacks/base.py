"""The Stack interface and helpers shared by every stack."""

from __future__ import annotations

import hashlib
import os
import subprocess
from typing import Any, Dict, List, Mapping, Optional, Sequence, Set, Tuple

AUTO = "auto"
PYTHON = "python-unittest"

#: a failure row, same keys the verifier has always produced
#: {"test", "kind", "error_type", "first_line", "message", "fingerprint"}
Failure = Dict[str, str]


class StackError(ValueError):
    pass


def fingerprint(test_id: str, error_type: str, first_line: str) -> str:
    """Same formula as build.verifier.fingerprint (kept here so stacks do not import the verifier)."""
    return hashlib.sha1("\x1f".join((test_id, error_type, first_line.strip())).encode("utf-8", "replace")).hexdigest()


def tail(text: str, n: int = 4000) -> str:
    return text if len(text) <= n else text[-n:]


#: what a test run keeps of the engine's environment (the verifier, QAS-like runs and the stacks share it): the
#: machine's own folders a test may look in (a browser under ProgramFiles or LOCALAPPDATA), never credentials. A test
#: that found Edge in the builder's shell and not in the verifier's blocked a unit six times.
TEST_ENV_KEEP = ("PATH", "PATHEXT", "SYSTEMROOT", "SYSTEMDRIVE", "WINDIR", "COMSPEC", "TEMP", "TMP", "TMPDIR",
                 "HOME", "USERPROFILE", "APPDATA", "LOCALAPPDATA", "PROGRAMDATA", "ProgramFiles", "ProgramFiles(x86)",
                 "ProgramW6432", "CommonProgramFiles", "CommonProgramFiles(x86)", "CommonProgramW6432", "PUBLIC",
                 "LANG", "LC_ALL", "NUMBER_OF_PROCESSORS", "PROCESSOR_ARCHITECTURE", "npm_config_cache",
                 "NPM_CONFIG_CACHE")


def test_env(extra: Optional[Mapping[str, str]] = None) -> Dict[str, str]:
    """Scrubbed environment for target test runs: no LINE_*, no credentials, CI mode on."""
    out = {k: os.environ[k] for k in TEST_ENV_KEEP if k in os.environ}
    out.update({"CI": "1", "FORCE_COLOR": "0", "NO_COLOR": "1", "PYTHONIOENCODING": "utf-8"})
    if extra:
        out.update(extra)
    return out


def run(argv: Sequence[str], cwd: str, timeout_s: float, env: Optional[Mapping[str, str]] = None) -> Dict[str, Any]:
    """-> {"rc", "output", "timeout"}; never raises for a missing program (rc -1)."""
    try:
        p = subprocess.run(list(argv), cwd=cwd, env=dict(env or test_env()), stdout=subprocess.PIPE,
                           stderr=subprocess.STDOUT, timeout=timeout_s)
        return {"rc": p.returncode, "output": p.stdout.decode("utf-8", "replace"), "timeout": False}
    except subprocess.TimeoutExpired as e:
        out = e.output.decode("utf-8", "replace") if isinstance(e.output, bytes) else str(e.output or "")
        return {"rc": -1, "output": out, "timeout": True}
    except OSError as e:
        return {"rc": -1, "output": "cannot run %r: %s" % (list(argv), e), "timeout": False}


class Stack:
    """One kind of target. Subclasses override what differs; see python_unittest.py and node.py."""

    name = ""
    display = ""
    is_python = False
    #: builder `claude -p --allowedTools` value for this stack
    allowed_tools = ""
    #: where acceptance tests live (repo-relative)
    acceptance_dir = "tests/acceptance"
    #: timeouts (seconds): one test-selection run / a whole suite / install
    test_timeout_s = 300
    suite_timeout_s = 1800
    install_timeout_s = 1200
    #: extra instructions appended to the test-author prompt ("" = prompt unchanged)
    test_author_hint = ""

    # ---- detection
    def detect(self, repo: str) -> int:
        """0 = not this stack; higher = more specific."""
        return 0

    # ---- acceptance tests: files and names
    def target_file(self, f_item: str) -> str:
        raise NotImplementedError

    def path_ok(self, path: str) -> bool:
        raise NotImplementedError

    def defined_tests(self, path: str, content: str) -> Optional[Set[str]]:
        """Test names defined in a test file (None = the file does not parse)."""
        raise NotImplementedError

    def name_ok(self, name: str) -> bool:
        raise NotImplementedError

    def name_example(self) -> str:
        raise NotImplementedError

    def compile_error(self, path: str, content: bytes) -> Optional[str]:
        """Syntax check of a test or source file ('' / None = fine or not checkable)."""
        return None

    # ---- running
    def prepare(self, workdir: str, source: str = "") -> Optional[str]:
        """Make workdir runnable; source = a checkout to borrow dependencies from. None = ok, else error."""
        return None

    def test_cmd(self, names: Sequence[str]) -> str:
        """Human-readable command the builder may run itself (shown in its prompt)."""
        raise NotImplementedError

    def run(self, workdir: str, names: Sequence[str], timeout_s: Optional[float] = None) -> Dict[str, Any]:
        """Run the named tests ([] = whole suite). -> {"rc", "ran", "failures", "output", "timeout", "results"}."""
        raise NotImplementedError

    def run_cases(self, workdir: str, names: Sequence[str]) -> Dict[str, bool]:
        r = self.run(workdir, names, self.suite_timeout_s if not names else None)
        res = dict(r.get("results") or {})
        if not res:
            return {n: False for n in names} or {"<discovery>": False}
        for n in names:                     # a requested test that never reported is a failure
            if not any(k == n or k.startswith(n + ".") or k.startswith(n + "::") for k in res):
                res[n] = False
        return res

    def run_one(self, workdir: str, name: str, timeout_s: float = 60.0) -> Dict[str, Any]:
        r = self.run(workdir, [name], max(timeout_s, 1.0))
        if r.get("timeout"):
            return {"outcome": "timeout", "rc": None, "tail": tail(r.get("output", ""), 1500)}
        res = r.get("results") or {}
        mine = {k: v for k, v in res.items() if k == name}
        if mine and all(mine.values()):
            return {"outcome": "pass", "rc": r.get("rc", 0), "tail": tail(r.get("output", ""), 1500)}
        fails = [f for f in r.get("failures") or [] if f.get("test") == name]
        outcome = "fail" if fails and all(f.get("kind") == "FAIL" for f in fails) else "error"
        return {"outcome": outcome, "rc": r.get("rc"), "tail": tail(r.get("output", ""), 1500)}

    def smoke_argv(self, workdir: str) -> List[str]:
        raise NotImplementedError

    def stage_empty_extra(self, repo: str, dest: str) -> None:
        """Files besides the tests that an 'empty implementation' scratch dir needs to RUN tests at all
        (test runner config, node_modules link). Must not copy any implementation code."""
        return None

    def describe(self) -> Dict[str, Any]:
        return {"name": self.name, "display": self.display, "allowed_tools": self.allowed_tools,
                "acceptance_dir": self.acceptance_dir}


def first_frame(stack_text: str, workdir: str = "") -> str:
    """First 'at ... (file:line:col)' frame of a JS stack, made repo-relative."""
    wd = os.path.normcase(os.path.abspath(workdir)) if workdir else ""
    for line in (stack_text or "").splitlines():
        s = line.strip()
        if not s.startswith("at "):
            continue
        if "node_modules" in s or "node:internal" in s:
            continue
        if wd:
            low = os.path.normcase(s)
            i = low.find(wd)
            if i >= 0:
                s = s[:i] + s[i + len(wd):].lstrip("\\/")
        return s.replace("\\", "/")
    return ""


def split_name(name: str) -> Tuple[str, str]:
    """'tests/acceptance/f1.test.js::F1 c1' -> (file, title)."""
    if "::" in name:
        f, t = name.split("::", 1)
        return f, t
    return name, ""
