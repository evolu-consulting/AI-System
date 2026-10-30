"""Node target stacks: SAP CAP, UI5 TypeScript, React.

Test runner per repo, from package.json: jest > vitest > mocha > `npm test` (exit code only).
Runners are started as `node <runner bin>` from the tree's node_modules (no npx, no shell), with a JSON
report written to a temp file and parsed into the engine's common result shape.

Test identity: "<repo-relative file>::<full title>" where full title = describe titles + test title joined
by one space, e.g. "tests/acceptance/f2.test.js::F2 C1 rejects an empty name".

node_modules: prepare() installs a REAL node_modules into a worktree / scratch dir / QAS color with
`npm ci --prefer-offline --no-audit --no-fund` (`npm install ...` without a lockfile),
served from the npm cache when the lockfile was installed before. It never links another checkout's
node_modules: the engine deletes trees with rmtree, and a directory junction there would delete the real
dependencies. Never publishes.
"""

from __future__ import annotations

import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
from typing import Any, Dict, List, Mapping, Optional, Sequence, Set, Tuple

from .base import Stack, fingerprint, first_frame, run, split_name, tail, test_env

TEST_EXT = (".test.js", ".test.ts", ".test.mjs", ".test.cjs", ".test.jsx", ".test.tsx",
            ".spec.js", ".spec.ts")
_PATH_RE = re.compile(r"^[A-Za-z0-9_./-]+\.(test|spec)\.(js|ts|mjs|cjs|jsx|tsx)$")
_TITLE_CALL = re.compile(r"""\b(?:describe|it|test)(?:\.(?:only|each\([^)]*\)))?\s*\(\s*(['"`])((?:\\.|(?!\1).)*)\1""")
RUNNERS = ("jest", "vitest", "mocha")
_CONFIG_FILES = ("package.json", "package-lock.json", "npm-shrinkwrap.json", "jest.config.js", "jest.config.ts",
                 "jest.config.cjs", "jest.config.mjs", "jest.config.json", "vitest.config.ts", "vitest.config.js",
                 "vitest.config.mjs", ".mocharc.js", ".mocharc.json", ".mocharc.yml", ".mocharc.yaml", ".mocharc.cjs",
                 "babel.config.js", "babel.config.cjs", ".babelrc", "tsconfig.json", ".cdsrc.json")


# ------------------------------------------------------------------ package.json helpers

def read_pkg(repo: str) -> Dict[str, Any]:
    p = os.path.join(repo, "package.json")
    if not os.path.isfile(p):
        return {}
    try:
        with open(p, encoding="utf-8") as fh:
            d = json.load(fh)
        return d if isinstance(d, dict) else {}
    except (OSError, ValueError):
        return {}


def all_deps(pkg: Mapping[str, Any]) -> Dict[str, str]:
    out: Dict[str, str] = {}
    for k in ("dependencies", "devDependencies", "peerDependencies", "optionalDependencies"):
        v = pkg.get(k)
        if isinstance(v, dict):
            out.update({str(a): str(b) for a, b in v.items()})
    return out


def runner_of(pkg: Mapping[str, Any]) -> str:
    deps = all_deps(pkg)
    script = str((pkg.get("scripts") or {}).get("test", "")) if isinstance(pkg.get("scripts"), dict) else ""
    for r in RUNNERS:
        if r in deps or re.search(r"\b%s\b" % r, script):
            return r
    if re.search(r"\bcds\b.*\btest\b|\bcds-test\b", script):
        return "jest"            # `cds test` runs jest (or mocha when configured; package.json decides above)
    return "npm"


def lock_hash(repo: str) -> str:
    for n in ("package-lock.json", "npm-shrinkwrap.json"):
        p = os.path.join(repo, n)
        if os.path.isfile(p):
            with open(p, "rb") as fh:
                return hashlib.sha256(fh.read().replace(b"\r\n", b"\n")).hexdigest()
    return ""


def main_checkout(workdir: str) -> str:
    """The main checkout a git worktree belongs to ('' when not a worktree / not git)."""
    try:
        p = subprocess.run(["git", "rev-parse", "--path-format=absolute", "--git-common-dir"], cwd=workdir,
                           capture_output=True, text=True, timeout=30)
    except (OSError, subprocess.TimeoutExpired):
        return ""
    if p.returncode != 0:
        return ""
    common = p.stdout.strip()
    root = os.path.dirname(os.path.abspath(common)) if common else ""
    if root and os.path.normcase(root) != os.path.normcase(os.path.abspath(workdir)):
        return root
    return ""


def runner_bin(workdir: str, runner: str) -> Optional[str]:
    """Absolute path of the runner's JS entry inside workdir/node_modules (no npx, no shell)."""
    pdir = os.path.join(os.path.abspath(workdir), "node_modules", runner)
    pkg = read_pkg(pdir)
    b = pkg.get("bin")
    rel = ""
    if isinstance(b, str):
        rel = b
    elif isinstance(b, dict):
        rel = str(b.get(runner) or (list(b.values())[0] if b else ""))
    if not rel:
        return None
    full = os.path.normpath(os.path.join(pdir, *rel.replace("\\", "/").split("/")))
    return full if os.path.isfile(full) else None


def node_exe() -> str:
    return shutil.which("node") or "node"


def npm_argv(*args: str) -> List[str]:
    """npm via node + npm-cli.js when found (no .cmd shims), else the npm on PATH. On Windows npm.cmd is looked
    up first: a bare which("npm") may find the extensionless shell script, which Windows cannot run."""
    npm = (shutil.which("npm.cmd") if os.name == "nt" else None) or shutil.which("npm")
    if npm:
        cli = os.path.join(os.path.dirname(os.path.realpath(npm)), "node_modules", "npm", "bin", "npm-cli.js")
        if os.path.isfile(cli):
            return [node_exe(), cli] + list(args)
        if os.name == "nt":
            return ["cmd", "/c", npm] + list(args)
        return [npm] + list(args)
    return ["npm"] + list(args)


# ------------------------------------------------------------------ result parsing

_ASSERT_HINTS = ("expect(", "assert", "Expected:", "Received:", "to equal", "to.equal", "toBe", "toEqual",
                 "to be ", "to.be.", "expected ")


def _err_type(message: str) -> str:
    """Error class of a JS failure message; assertion-shaped messages -> AssertionError (a red test, not a
    crash), 'Cannot find module' -> ModuleNotFoundError (a load error, like Python's)."""
    text = message or ""
    first = text.strip().splitlines()[0] if text.strip() else ""
    m = re.match(r"^([A-Za-z_][\w.]*(?:Error|Exception))\b", first)
    named = m.group(1).rsplit(".", 1)[-1] if m else ""
    if named and named != "Error":
        return named
    if "Cannot find module" in text:
        return "ModuleNotFoundError"
    if any(h in first for h in _ASSERT_HINTS) or any(h in text[:600] for h in ("Expected:", "AssertionError")):
        return "AssertionError"
    return "Error"


def _rel(path: str, workdir: str) -> str:
    """Repo-relative '/' path. Both sides go through realpath: a runner reports long Windows names
    (C:/Users/name/...) while a temp workdir may be an 8.3 short name (C:/Users/NAME~1/...)."""
    if not path:
        return ""
    p = os.path.abspath(path) if os.path.isabs(path) else os.path.join(workdir, path)
    try:
        r = os.path.relpath(os.path.realpath(p), os.path.realpath(workdir))
    except ValueError:
        r = path
    return r.replace("\\", "/")


def _strip_ansi(s: str) -> str:
    return re.sub(r"\x1b\[[0-9;]*m", "", s or "")


def parse_jest_json(doc: Mapping[str, Any], workdir: str = "") -> Tuple[int, List[Dict[str, str]], Dict[str, bool]]:
    """Jest (and vitest --reporter=json, same shape) -> (ran, failures, {id: passed})."""
    ran = 0
    fails: List[Dict[str, str]] = []
    results: Dict[str, bool] = {}
    for tr in doc.get("testResults") or []:
        f = _rel(str(tr.get("name") or tr.get("testFilePath") or ""), workdir)
        cases = tr.get("assertionResults") or tr.get("testResults") or []
        for a in cases:
            status = str(a.get("status", ""))
            if status in ("pending", "skipped", "todo", "disabled"):
                continue
            title = " ".join([str(x) for x in (a.get("ancestorTitles") or [])] + [str(a.get("title", ""))]).strip()
            tid = "%s::%s" % (f, title or str(a.get("fullName", "")))
            ok = status == "passed"
            ran += 1
            results[tid] = ok
            if not ok:
                msg = _strip_ansi("\n".join(str(m) for m in (a.get("failureMessages") or [])))
                et = _err_type(msg)
                if et == "Error" and any(isinstance(d, dict) and d.get("matcherResult")
                                         for d in (a.get("failureDetails") or [])):
                    et = "AssertionError"            # a jest matcher said no
                fl = first_frame(msg, workdir)
                fails.append({"test": tid, "kind": "FAIL" if et == "AssertionError" else "ERROR",
                              "error_type": et, "first_line": fl, "message": msg.strip().splitlines()[0][:300]
                              if msg.strip() else status, "fingerprint": fingerprint(tid, et, fl)})
        suite_msg = _strip_ansi(str(tr.get("message") or tr.get("failureMessage") or ""))
        if (str(tr.get("status")) == "failed" and not cases) or (suite_msg.strip() and not cases):
            tid = "%s::<suite>" % f
            et = _err_type(suite_msg)
            if et == "Error" and ("SyntaxError" in suite_msg or "Unexpected token" in suite_msg):
                et = "SyntaxError"
            fl = first_frame(suite_msg, workdir)
            results[tid] = False
            fails.append({"test": tid, "kind": "ERROR", "error_type": et, "first_line": fl,
                          "message": suite_msg.strip().splitlines()[0][:300] if suite_msg.strip() else "suite failed",
                          "fingerprint": fingerprint(tid, et, fl)})
    return ran, fails, results


def parse_mocha_json(doc: Mapping[str, Any], workdir: str = "") -> Tuple[int, List[Dict[str, str]], Dict[str, bool]]:
    """mocha --reporter json -> (ran, failures, {id: passed})."""
    fails: List[Dict[str, str]] = []
    results: Dict[str, bool] = {}
    failed_keys = set()
    for t in doc.get("failures") or []:
        failed_keys.add((str(t.get("file", "")), str(t.get("fullTitle", ""))))
    ran = 0
    for t in doc.get("tests") or []:
        if t.get("pending"):
            continue
        f = _rel(str(t.get("file", "")), workdir)
        title = str(t.get("fullTitle") or t.get("title") or "")
        tid = "%s::%s" % (f, title)
        err = t.get("err") or {}
        bad = bool(err) or (str(t.get("file", "")), title) in failed_keys
        ran += 1
        results[tid] = not bad
        if bad:
            msg = str(err.get("message", "")) if isinstance(err, dict) else str(err)
            et = str(err.get("name", "")) if isinstance(err, dict) and err.get("name") else _err_type(msg)
            if et in ("AssertionError", "AssertionError [ERR_ASSERTION]"):
                et = "AssertionError"
            fl = first_frame(str(err.get("stack", "")) if isinstance(err, dict) else "", workdir)
            fails.append({"test": tid, "kind": "FAIL" if et == "AssertionError" else "ERROR", "error_type": et,
                          "first_line": fl, "message": msg[:300], "fingerprint": fingerprint(tid, et, fl)})
    return ran, fails, results


def _json_from(text: str) -> Optional[Dict[str, Any]]:
    """The last top-level JSON object in mixed console output."""
    end = text.rfind("}")
    while end >= 0:
        start = text.find("{")
        while start >= 0 and start < end:
            try:
                d = json.loads(text[start:end + 1])
                if isinstance(d, dict):
                    return d
            except ValueError:
                pass
            start = text.find("{", start + 1)
        end = text.rfind("}", 0, end)
    return None


# ------------------------------------------------------------------ the stack

class NodeStack(Stack):
    """Common Node behaviour; subclasses only change detection, display and the test-author hint."""

    name = "node"
    display = "Node"
    allowed_tools = ("Read Edit Write Bash(npm test*) Bash(npm run test*) Bash(npx jest*) Bash(npx vitest*) "
                     "Bash(npx mocha*) Bash(npx cds*) Bash(node *)")
    test_timeout_s = 900
    suite_timeout_s = 3600
    ext = ".test.js"

    def detect(self, repo: str) -> int:
        return 0

    # ---- acceptance test files and names
    def target_file(self, f_item: str) -> str:
        return "%s/%s%s" % (self.acceptance_dir, re.sub(r"\W", "_", f_item.lower()), self._ext(None))

    def _ext(self, repo: Optional[str]) -> str:
        return self.ext

    def path_ok(self, path: str) -> bool:
        return bool(_PATH_RE.match(path)) and ".." not in path

    def defined_tests(self, path: str, content: str) -> Optional[Set[str]]:
        """Full titles 'describe ... test' found in the file (static: literal titles only)."""
        if not content.strip():
            return None
        out: Set[str] = set()
        stack: List[Tuple[int, str]] = []          # (brace depth at open, title)
        depth = 0
        i = 0
        calls = list(_TITLE_CALL.finditer(content))
        ci = 0
        n = len(content)
        while i < n:
            if ci < len(calls) and calls[ci].start() == i:
                m = calls[ci]
                kind = re.match(r"\w+", m.group(0)).group(0)
                title = m.group(2)
                if kind == "describe":
                    stack.append((depth, title))
                else:
                    out.add(" ".join([t for _, t in stack] + [title]))
                ci += 1
                i = m.end()
                continue
            ch = content[i]
            if ch == "{":
                depth += 1
            elif ch == "}":
                depth -= 1
                while stack and depth <= stack[-1][0]:
                    stack.pop()
            i += 1
        return {"%s::%s" % (path.replace("\\", "/"), t) for t in out}

    def name_ok(self, name: str) -> bool:
        f, t = split_name(name)
        return bool(t.strip()) and self.path_ok(f)

    def name_example(self) -> str:
        return "%s/f2%s::F2 C1 rejects an empty name" % (self.acceptance_dir, self.ext)

    def compile_error(self, path: str, content: bytes) -> Optional[str]:
        if not path.endswith((".js", ".mjs", ".cjs")):
            return None                              # TypeScript / JSX: the runner reports it
        with tempfile.TemporaryDirectory(prefix="line-jscheck-") as d:
            p = os.path.join(d, os.path.basename(path))
            with open(p, "wb") as fh:
                fh.write(content)
            r = run([node_exe(), "--check", p], d, 60)
        if r["rc"] == -1 and "cannot run" in r["output"]:
            return None                              # no node here: nothing to check with
        if r["rc"] != 0:
            lines = [l for l in r["output"].splitlines() if "SyntaxError" in l]
            return (lines[0].strip() if lines else "SyntaxError")[:300]
        return None

    # ---- making the tree runnable
    def prepare(self, workdir: str, source: str = "") -> Optional[str]:
        if not os.path.isfile(os.path.join(workdir, "package.json")):
            return "no package.json in %s" % workdir
        nm = os.path.join(workdir, "node_modules")
        if os.path.isdir(nm):
            return None
        has_lock = bool(lock_hash(workdir))
        # install scripts stay ON: native test deps (e.g. the SQLite driver CAP tests use) ship their binary
        # through them, and the line runs this repo's tests anyway; publishing is never done.
        argv = npm_argv("ci" if has_lock else "install", "--prefer-offline", "--no-audit", "--no-fund")
        r = run(argv, workdir, self.install_timeout_s, test_env())
        if r["rc"] != 0:
            return "npm %s failed: %s" % ("ci" if has_lock else "install", tail(r["output"], 800))
        return None

    def stage_empty_extra(self, repo: str, dest: str) -> None:
        """Runner config + package.json + lockfile: enough to RUN the tests (run() installs the deps),
        no implementation code."""
        for n in _CONFIG_FILES:
            p = os.path.join(repo, n)
            if os.path.isfile(p):
                shutil.copyfile(p, os.path.join(dest, n))

    # ---- running
    def runner(self, workdir: str) -> str:
        return runner_of(read_pkg(workdir))

    def test_cmd(self, names: Sequence[str]) -> str:
        files = sorted({split_name(n)[0] for n in names})
        return ("npx jest " + " ".join(files)) if files else "npm test"

    def _argv(self, workdir: str, runner: str, files: Sequence[str], titles: Sequence[str],
              out_file: str) -> Optional[List[str]]:
        b = runner_bin(workdir, runner) if runner != "npm" else None
        if runner == "jest" and b:
            argv = [node_exe(), b, "--ci", "--json", "--outputFile=" + out_file, "--colors=false"]
            if titles:
                argv += ["-t", "^(%s)$" % "|".join(re.escape(t) for t in titles)]
            return argv + ["--"] + [re.escape(f) for f in files] if files else argv
        if runner == "vitest" and b:
            argv = [node_exe(), b, "run", "--reporter=json", "--outputFile=" + out_file]
            if titles:
                argv += ["-t", "^(%s)$" % "|".join(re.escape(t) for t in titles)]
            return argv + list(files)
        if runner == "mocha" and b:
            argv = [node_exe(), b, "--reporter", "json", "--reporter-option", "output=" + out_file]
            if titles:
                argv += ["--grep", "^(%s)$" % "|".join(re.escape(t) for t in titles)]
            return argv + list(files)
        return None

    def run(self, workdir: str, names: Sequence[str], timeout_s: Optional[float] = None) -> Dict[str, Any]:
        workdir = os.path.realpath(os.path.abspath(workdir))
        timeout = float(timeout_s or (self.test_timeout_s if names else self.suite_timeout_s))
        problem = self.prepare(workdir)
        if problem:
            fl = ""
            et = "InstallError"
            tid = "<prepare>"
            return {"rc": -1, "ran": 0, "timeout": False, "output": problem, "results": {n: False for n in names},
                    "failures": [{"test": tid, "kind": "ERROR", "error_type": et, "first_line": fl,
                                  "message": problem[:300], "fingerprint": fingerprint(tid, et, fl)}]}
        runner = self.runner(workdir)
        files = sorted({split_name(n)[0] for n in names})
        titles = sorted({split_name(n)[1] for n in names if split_name(n)[1]})
        fd, out_file = tempfile.mkstemp(prefix="line-tests-", suffix=".json")
        os.close(fd)
        try:
            argv = self._argv(workdir, runner, files, titles, out_file)
            if argv is None:                       # npm test: exit code only
                r = run(npm_argv("test", "--silent"), workdir, timeout, test_env())
                key = names[0] if len(names) == 1 else "npm test"
                ok = r["rc"] == 0 and not r["timeout"]
                res = {n: ok for n in names} if names else {key: ok}
                fails = [] if ok else [{"test": key, "kind": "FAIL", "error_type": "TestFailure", "first_line": "",
                                        "message": "npm test exited %s" % r["rc"],
                                        "fingerprint": fingerprint(key, "TestFailure", "")}]
                return {"rc": r["rc"], "ran": len(res), "failures": fails, "output": r["output"],
                        "timeout": r["timeout"], "results": res, "runner": "npm"}
            r = run(argv, workdir, timeout, test_env())
            doc: Optional[Dict[str, Any]] = None
            try:
                with open(out_file, encoding="utf-8") as fh:
                    raw = fh.read()
                doc = json.loads(raw) if raw.strip() else None
            except (OSError, ValueError):
                doc = None
            if doc is None:
                doc = _json_from(r["output"])
        finally:
            try:
                os.remove(out_file)
            except OSError:
                pass
        if r["timeout"]:
            return {"rc": -1, "ran": 0, "failures": [], "output": r["output"], "timeout": True,
                    "results": {n: False for n in names}, "runner": runner}
        if doc is None:
            tid = "<runner>"
            et = "RunError"
            return {"rc": r["rc"] or 1, "ran": 0, "output": r["output"], "timeout": False, "runner": runner,
                    "results": {n: False for n in names},
                    "failures": [{"test": tid, "kind": "ERROR", "error_type": et, "first_line": "",
                                  "message": (tail(r["output"], 300).strip().splitlines() or ["no report"])[-1],
                                  "fingerprint": fingerprint(tid, et, "")}]}
        parse = parse_mocha_json if runner == "mocha" else parse_jest_json
        ran, fails, results = parse(doc, workdir)
        if names:                                   # keep only what was asked for (jest -t is a regex)
            want = set(names)
            results = {k: v for k, v in results.items() if k in want or k.endswith("::<suite>")}
            fails = [f for f in fails if f["test"] in want or f["test"].endswith("::<suite>")]
            ran = sum(1 for k in results if not k.endswith("::<suite>"))
        return {"rc": r["rc"], "ran": ran, "failures": fails, "output": r["output"], "timeout": False,
                "results": results, "runner": runner}

    def smoke_argv(self, workdir: str) -> List[str]:
        return npm_argv("test", "--silent")


class NodeCap(NodeStack):
    name = "node-cap"
    display = "SAP CAP (Node, @sap/cds)"
    test_author_hint = (
        "## Target stack: SAP CAP (Node.js, @sap/cds)\n"
        "Write a JavaScript test file for the repo's test runner (Jest unless package.json says mocha): "
        "`describe('<F-item id> ...', () => { test('<criterion id> ...', async () => { ... }) })`. "
        "Start the service with `const cds = require('@sap/cds'); const { GET, POST, expect } = cds.test(__dirname + '/../..');` "
        "(adjust the path to the project root) and call the OData/REST endpoints the spec names. "
        "Every test title starts with its criterion id. The \"name\" of each test in your answer is "
        "\"<path>::<describe title> <test title>\" exactly as written. Put the trace tag in a comment "
        "above each test: `// trace: <criterion> <span_id>`.")

    def detect(self, repo: str) -> int:
        pkg = read_pkg(repo)
        deps = all_deps(pkg)
        if "@sap/cds" in deps or "@cap-js/cds-test" in deps or isinstance(pkg.get("cds"), dict):
            return 90
        if os.path.isfile(os.path.join(repo, ".cdsrc.json")) and pkg:
            return 85
        return 0


class NodeUi5Ts(NodeStack):
    name = "node-ui5-ts"
    display = "UI5 TypeScript"
    ext = ".test.ts"
    test_author_hint = (
        "## Target stack: UI5 TypeScript\n"
        "Write a TypeScript unit test for the repo's runner (Jest/Vitest from package.json) that tests the "
        "controller/formatter/model logic the criterion names, without a browser. "
        "`describe('<F-item id> ...', () => { it('<criterion id> ...', () => { ... }) })`. "
        "The \"name\" of each test in your answer is \"<path>::<describe title> <test title>\". "
        "Put `// trace: <criterion> <span_id>` above each test.")

    def detect(self, repo: str) -> int:
        pkg = read_pkg(repo)
        deps = all_deps(pkg)
        ui5 = any(d.startswith(("@ui5/", "@openui5/", "@sapui5/")) or d in ("ui5-tooling-transpile",)
                  for d in deps)
        if ui5 or os.path.isfile(os.path.join(repo, "ui5.yaml")):
            return 80 if pkg else 0
        return 0


class NodeReact(NodeStack):
    name = "react"
    display = "React"
    ext = ".test.tsx"
    test_author_hint = (
        "## Target stack: React\n"
        "Write a test for the repo's runner (Jest/Vitest from package.json) with @testing-library/react when "
        "it is a dependency: render the component the criterion names and assert on visible behaviour. "
        "`describe('<F-item id> ...', () => { it('<criterion id> ...', () => { ... }) })`. "
        "The \"name\" of each test in your answer is \"<path>::<describe title> <test title>\". "
        "Put `// trace: <criterion> <span_id>` above each test.")

    def detect(self, repo: str) -> int:
        deps = all_deps(read_pkg(repo))
        if "react" in deps:
            return 70
        return 0

    def _ext(self, repo: Optional[str]) -> str:
        return self.ext


class NodeGeneric(NodeStack):
    """Any Node project whose package.json has a real "test" script (Express, node:test, plain libraries ...): the
    specialised stacks (CAP, UI5, React) score higher, so this only catches what none of them claims. Without it
    such a repo fell back to python-unittest, ran nothing and every gate round was red."""
    name = "node"
    display = "Node"
    test_author_hint = (
        "## Target stack: Node\n"
        "Write tests for the runner package.json's test script uses (node:test with node:assert when it runs "
        "`node --test`; Jest / Vitest / Mocha when it is a dependency): exercise the behaviour the criterion names "
        "through the app's public interface. Name each test after its criterion id. "
        "Put `// trace: <criterion> <span_id>` above each test.")

    def detect(self, repo: str) -> int:
        test = str(((read_pkg(repo) or {}).get("scripts") or {}).get("test") or "")
        if test and "no test specified" not in test:
            return 20
        return 0


__all__ = ["NodeStack", "NodeCap", "NodeUi5Ts", "NodeReact", "NodeGeneric", "parse_jest_json", "parse_mocha_json", "runner_of",
           "read_pkg", "lock_hash", "main_checkout"]
