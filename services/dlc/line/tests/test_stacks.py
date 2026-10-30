"""line.stacks: detection, names, command building, result parsing, Python default unchanged.

Offline: no node / npm needed. The live node-cap run against line/samples/cap-mini is opt-in
(LINE_NODE_LIVE=1, node + npm on PATH; the first run installs the sample's dependencies).
"""

from __future__ import annotations

import json
import os
import shutil
import sys
import tempfile
import unittest
from unittest import mock

from line import stacks
from line.config import load_config
from line.stacks import node as N
from line.stacks.base import fingerprint, first_frame, split_name

HERE = os.path.dirname(os.path.abspath(__file__))
CAP_MINI = os.path.join(os.path.dirname(HERE), "samples", "cap-mini")


def _tree(files):
    d = tempfile.mkdtemp(prefix="line-stack-")
    for rel, content in files.items():
        p = os.path.join(d, *rel.split("/"))
        os.makedirs(os.path.dirname(p), exist_ok=True)
        with open(p, "w", encoding="utf-8") as fh:
            fh.write(content if isinstance(content, str) else json.dumps(content))
    return d


JEST_DOC = {
    "numTotalTests": 3,
    "testResults": [
        {"name": "{WD}/tests/acceptance/f1.test.js", "status": "failed", "message": "", "assertionResults": [
            {"ancestorTitles": ["F1 books"], "title": "F1.C1 creates a book", "status": "passed",
             "fullName": "F1 books F1.C1 creates a book", "failureMessages": []},
            {"ancestorTitles": ["F1 books"], "title": "F1.C2 rejects an empty title", "status": "failed",
             "fullName": "F1 books F1.C2 rejects an empty title",
             "failureMessages": ["AssertionError: expected promise to be rejected\n    at Object.<anonymous> "
                                 "({WD}/tests/acceptance/f1.test.js:16:5)\n    at node_modules/jest/x.js:1:1"]},
            {"ancestorTitles": ["F1 books"], "title": "F1.C3 later", "status": "pending", "failureMessages": []},
        ]},
        {"name": "{WD}/tests/acceptance/f2.test.js", "status": "failed",
         "message": "Test suite failed to run\n\nCannot find module '../../srv/lib' from 'tests/acceptance/f2.test.js'",
         "assertionResults": []},
    ],
}

MOCHA_DOC = {
    "stats": {"tests": 2, "passes": 1, "failures": 1},
    "tests": [
        {"title": "C1 ok", "fullTitle": "F1 C1 ok", "file": "{WD}/tests/acceptance/f1.test.js", "err": {}},
        {"title": "C2 bad", "fullTitle": "F1 C2 bad", "file": "{WD}/tests/acceptance/f1.test.js",
         "err": {"name": "AssertionError", "message": "expected 1 to equal 2",
                 "stack": "AssertionError: expected 1 to equal 2\n    at Context.<anonymous> "
                          "({WD}/tests/acceptance/f1.test.js:9:12)"}},
    ],
    "failures": [{"title": "C2 bad", "fullTitle": "F1 C2 bad", "file": "{WD}/tests/acceptance/f1.test.js"}],
}


def _with_wd(doc, wd):
    return json.loads(json.dumps(doc).replace("{WD}", wd.replace("\\", "/")))


class DetectTests(unittest.TestCase):
    def tearDown(self):
        stacks.configure("auto")

    def test_cap_ui5_react_python(self):
        cases = [
            ({"package.json": {"dependencies": {"@sap/cds": "^9"}, "devDependencies": {"jest": "^30"}}}, "node-cap"),
            ({"package.json": {"devDependencies": {"@ui5/cli": "^4", "vitest": "^2"}}}, "node-ui5-ts"),
            ({"package.json": {"dependencies": {"react": "^19"}}, "src/App.tsx": "x"}, "react"),
            ({"package.json": {"dependencies": {"react": "^19", "@sap/cds": "^9"}}}, "node-cap"),
            ({"app.py": "print(1)"}, "python-unittest"),
            ({}, "python-unittest"),
            # a plain Node app (Express + node:test): not CAP / UI5 / React, still a Node project
            ({"package.json": {"dependencies": {"express": "^4"}, "scripts": {"test": "node --test"}}}, "node"),
            ({"package.json": {"scripts": {"test": "node --test"}}, "tools/x.py": "print(1)"}, "node"),
            ({"package.json": {"scripts": {"test": "echo \"Error: no test specified\" && exit 1"}}}, "python-unittest"),
        ]
        for files, want in cases:
            d = _tree(files)
            try:
                self.assertEqual(stacks.detect(d).name, want, files)
            finally:
                shutil.rmtree(d)

    def test_explicit_beats_detection(self):
        d = _tree({"app.py": "x"})
        try:
            self.assertEqual(stacks.for_repo(d, "node-cap").name, "node-cap")
            stacks.configure("react")
            self.assertEqual(stacks.for_repo(d).name, "react")
            stacks.configure("auto")
            with mock.patch.dict(os.environ, {"LINE_STACK": "node-ui5-ts"}):
                self.assertEqual(stacks.for_repo(d).name, "node-ui5-ts")
            with mock.patch.dict(os.environ, {"LINE_STACK": "auto"}):
                self.assertEqual(stacks.for_repo(d).name, "python-unittest")
        finally:
            shutil.rmtree(d)

    def test_unknown_stack_fails_fast(self):
        with self.assertRaises(stacks.StackError):
            stacks.configure("cobol")
        from line.codes import LineError
        with self.assertRaises(LineError):
            load_config(env={"LINE_STACK": "cobol"}, line_json=None, rag_local_json=None)
        self.assertEqual(load_config(env={}, line_json=None, rag_local_json=None).stack, "auto")

    def test_runner_choice(self):
        self.assertEqual(N.runner_of({"devDependencies": {"jest": "1"}}), "jest")
        self.assertEqual(N.runner_of({"devDependencies": {"vitest": "1"}}), "vitest")
        self.assertEqual(N.runner_of({"devDependencies": {"mocha": "1"}}), "mocha")
        self.assertEqual(N.runner_of({"scripts": {"test": "cds test"}}), "jest")
        self.assertEqual(N.runner_of({"scripts": {"test": "node test.js"}}), "npm")


class NestedAppTests(unittest.TestCase):
    """A Node app in a sub-folder of a Python repo (NotesApp/ in TestArea) gets its node_modules on a fresh export."""

    def setUp(self):
        self.d = tempfile.mkdtemp(prefix="line-nested-")
        self.addCleanup(shutil.rmtree, self.d, True)
        for rel in ("NotesApp", "NotesApp/client", "tools/web", "NotesApp/node_modules/x", "a/b/c/deep"):
            os.makedirs(os.path.join(self.d, rel))
        for rel in ("package.json", "NotesApp/package.json", "NotesApp/client/package.json", "tools/web/package.json",
                    "NotesApp/node_modules/x/package.json", "a/b/c/deep/package.json"):
            with open(os.path.join(self.d, rel), "w") as fh:
                fh.write("{}")

    def test_finds_sub_folder_apps_only(self):
        found = sorted(os.path.relpath(p, self.d).replace("\\", "/") for p in stacks.nested_apps(self.d))
        self.assertEqual(found, ["NotesApp", "tools/web"])     # not the root, not node_modules, not too deep

    def test_prepare_installs_each_and_reports_errors(self):
        calls = []
        with mock.patch.object(stacks.STACKS["react"], "prepare",
                               side_effect=lambda d: calls.append(os.path.basename(d)) or ("boom" if d.endswith("web") else None)):
            errors = stacks.prepare_nested(self.d)
        self.assertEqual(sorted(calls), ["NotesApp", "web"])
        self.assertEqual(len(errors), 1)
        self.assertIn("boom", errors[0])


class PythonDefaultTests(unittest.TestCase):
    """The Python stack must keep the engine's original choices byte for byte."""

    def test_python_choices(self):
        st = stacks.get("python-unittest")
        from line.llm.cli import ALLOWED_TOOLS
        self.assertTrue(st.is_python)
        self.assertEqual(st.allowed_tools, ALLOWED_TOOLS)
        self.assertEqual(st.target_file("F2"), "tests/acceptance/test_f2.py")
        self.assertEqual(st.test_cmd(["a.b"]), "python -m unittest a.b")
        self.assertEqual(st.test_cmd([]), "python -m unittest")
        self.assertEqual(st.smoke_argv("."), [sys.executable, "-m", "unittest"])
        self.assertEqual(st.test_author_hint, "")

    def test_builder_command_and_cli_tools_unchanged_for_python(self):
        from line.build.builder import _test_command
        from line.llm.cli import ALLOWED_TOOLS, CliBackend
        d = _tree({"app.py": "x"})
        try:
            self.assertEqual(_test_command(d, ["tests.acceptance.test_f1"]), "python -m unittest tests.acceptance.test_f1")
            argv = CliBackend.__new__(CliBackend)
            argv.command = sys.executable
            a = argv.agentic_argv("m", 3, 0.0)
            self.assertEqual(a[a.index("--allowedTools") + 1], ALLOWED_TOOLS)
            a = argv.agentic_argv("m", 3, 0.0, stacks.get("node-cap").allowed_tools)
            self.assertIn("Bash(npm test*)", a[a.index("--allowedTools") + 1])
        finally:
            shutil.rmtree(d)

    def test_python_prompt_unchanged(self):
        from line.contracts import Criterion, FItem
        from line.understand import test_author as ta
        f = FItem(id="F1", title="t", quote="q", span_ids=["s1"],
                  criteria=[Criterion(id="F1.C1", f_item="F1", text="x", span_id="s1", quote="q", given="g", when="w", then="t")])
        self.assertEqual(ta._prompt(f, None, []), ta._prompt(f, None, [], (), None))
        self.assertIn("tests/acceptance/test_f1.py", ta._prompt(f, None, []))
        p = ta._prompt(f, None, [], (), stacks.get("node-cap"))
        self.assertIn("tests/acceptance/f1.test.js", p)
        self.assertIn("SAP CAP", p)


class NodeNamesTests(unittest.TestCase):
    def test_defined_tests_nested_describes(self):
        st = stacks.get("node-cap")
        src = ("describe('F1 books', () => {\n"
               "  test('F1.C1 creates', async () => { if (x) { y() } })\n"
               "  describe(\"inner\", () => { it(`F1.C2 deep`, () => {}) })\n"
               "})\n"
               "test('top level', () => {})\n")
        got = st.defined_tests("tests/acceptance/f1.test.js", src)
        self.assertEqual(got, {"tests/acceptance/f1.test.js::F1 books F1.C1 creates",
                               "tests/acceptance/f1.test.js::F1 books inner F1.C2 deep",
                               "tests/acceptance/f1.test.js::top level"})
        self.assertIsNone(st.defined_tests("x.test.js", "  "))

    def test_paths_and_names(self):
        st = stacks.get("node-cap")
        self.assertEqual(st.target_file("F2"), "tests/acceptance/f2.test.js")
        self.assertEqual(stacks.get("node-ui5-ts").target_file("F2"), "tests/acceptance/f2.test.ts")
        self.assertEqual(stacks.get("react").target_file("F2"), "tests/acceptance/f2.test.tsx")
        self.assertTrue(st.path_ok("tests/acceptance/f2.test.js"))
        self.assertFalse(st.path_ok("tests/acceptance/f2.js"))
        self.assertFalse(st.path_ok("tests/../f2.test.js"))
        self.assertTrue(st.name_ok("tests/acceptance/f2.test.js::F2 C1 x"))
        self.assertFalse(st.name_ok("tests/acceptance/f2.test.js::"))
        self.assertEqual(split_name("a.test.js::t u"), ("a.test.js", "t u"))

    def test_validate_answer_for_node(self):
        from line.contracts import Criterion, FItem
        from line.understand.test_author import validate_answer
        st = stacks.get("node-cap")
        f = FItem(id="F1", title="t", quote="q", span_ids=["s1"],
                  criteria=[Criterion(id="F1.C1", f_item="F1", text="x", span_id="s1", quote="q", given="g", when="w", then="t")])
        good = {"path": "tests/acceptance/f1.test.js",
                "content": "describe('F1 x', () => {\n  // trace: F1.C1 s1\n  test('F1.C1 a', () => {})\n})\n",
                "tests": [{"criterion": "F1.C1", "span_id": "s1", "name": "tests/acceptance/f1.test.js::F1 x F1.C1 a"}]}
        self.assertEqual(validate_answer(f, good, "tests/acceptance", st), [])
        bad = dict(good, tests=[{"criterion": "F1.C1", "span_id": "s1", "name": "tests/acceptance/f1.test.js::nope"}])
        self.assertTrue(validate_answer(f, bad, "tests/acceptance", st))
        self.assertTrue(validate_answer(f, dict(good, path="tests/acceptance/test_f1.py"), "tests/acceptance", st))


class ParseTests(unittest.TestCase):
    def test_jest_json(self):
        wd = os.path.abspath("/repo")
        ran, fails, res = N.parse_jest_json(_with_wd(JEST_DOC, wd), wd)
        self.assertEqual(ran, 2)
        self.assertTrue(res["tests/acceptance/f1.test.js::F1 books F1.C1 creates a book"])
        self.assertFalse(res["tests/acceptance/f1.test.js::F1 books F1.C2 rejects an empty title"])
        self.assertFalse(res["tests/acceptance/f2.test.js::<suite>"])
        by = {f["test"]: f for f in fails}
        a = by["tests/acceptance/f1.test.js::F1 books F1.C2 rejects an empty title"]
        self.assertEqual((a["kind"], a["error_type"]), ("FAIL", "AssertionError"))
        self.assertIn("tests/acceptance/f1.test.js:16:5", a["first_line"])
        self.assertNotIn(wd.replace("\\", "/"), a["first_line"])
        self.assertEqual(a["fingerprint"], fingerprint(a["test"], a["error_type"], a["first_line"]))
        s = by["tests/acceptance/f2.test.js::<suite>"]
        self.assertEqual((s["kind"], s["error_type"]), ("ERROR", "ModuleNotFoundError"))

    def test_mocha_json(self):
        wd = os.path.abspath("/repo")
        ran, fails, res = N.parse_mocha_json(_with_wd(MOCHA_DOC, wd), wd)
        self.assertEqual(ran, 2)
        self.assertEqual(res, {"tests/acceptance/f1.test.js::F1 C1 ok": True,
                               "tests/acceptance/f1.test.js::F1 C2 bad": False})
        self.assertEqual(fails[0]["error_type"], "AssertionError")
        self.assertEqual(fails[0]["kind"], "FAIL")

    def test_json_from_mixed_output(self):
        self.assertEqual(N._json_from('log {"a": 1} more\n{"b": {"c": 2}}\n'), {"b": {"c": 2}})
        self.assertIsNone(N._json_from("no json"))

    def test_first_frame_skips_node_modules(self):
        wd = os.path.abspath("/r")
        text = "Error\n    at x (node_modules/a.js:1:1)\n    at y (%s:2:3)" % os.path.join(wd, "src", "b.js")
        self.assertEqual(first_frame(text, wd), "at y (src/b.js:2:3)")


class CommandTests(unittest.TestCase):
    def test_jest_argv_selection(self):
        d = _tree({"package.json": {"devDependencies": {"jest": "1"}},
                   "node_modules/jest/package.json": {"bin": "./bin/jest.js"},
                   "node_modules/jest/bin/jest.js": "// jest"})
        try:
            st = stacks.get("node-cap")
            argv = st._argv(d, "jest", ["tests/acceptance/f1.test.js"], ["F1 C1 a(b)"], "out.json")
            self.assertTrue(argv[1].endswith(os.path.join("jest", "bin", "jest.js")))
            self.assertIn("--json", argv)
            self.assertIn("--outputFile=out.json", argv)
            self.assertEqual(argv[argv.index("-t") + 1], r"^(F1\ C1\ a\(b\))$")
            self.assertEqual(argv[-1], r"tests/acceptance/f1\.test\.js")
            self.assertIsNone(st._argv(d, "mocha", [], [], "o.json"))     # mocha not installed in d
        finally:
            shutil.rmtree(d)

    def test_npm_on_windows_is_npm_cmd_not_the_shell_script(self):
        found = {"npm": os.path.join("C:", "nodejs", "npm"), "npm.cmd": os.path.join("C:", "nodejs", "npm.cmd")}
        with mock.patch.object(N.os, "name", "nt"), mock.patch.object(N.shutil, "which", found.get), \
                mock.patch.object(N.os.path, "isfile", return_value=False):
            self.assertEqual(N.npm_argv("start"), ["cmd", "/c", found["npm.cmd"], "start"])

    def test_run_maps_json_report(self):
        d = _tree({"package.json": {"devDependencies": {"jest": "1"}},
                   "node_modules/jest/package.json": {"bin": "./bin/jest.js"},
                   "node_modules/jest/bin/jest.js": "// jest"})
        st = stacks.get("node-cap")

        def fake_run(argv, cwd, timeout_s, env=None):
            out = [a for a in argv if a.startswith("--outputFile=")][0].split("=", 1)[1]
            with open(out, "w", encoding="utf-8") as fh:
                json.dump(_with_wd(JEST_DOC, d), fh)
            return {"rc": 1, "output": "jest output", "timeout": False}
        try:
            with mock.patch.object(N, "run", fake_run):
                r = st.run(d, [])
                self.assertEqual(r["ran"], 2)
                self.assertEqual(len(r["failures"]), 2)
                one = st.run(d, ["tests/acceptance/f1.test.js::F1 books F1.C1 creates a book"])
                self.assertEqual(one["results"], {"tests/acceptance/f1.test.js::F1 books F1.C1 creates a book": True,
                                                  "tests/acceptance/f2.test.js::<suite>": False})
                self.assertEqual(st.run_one(d, "tests/acceptance/f1.test.js::F1 books F1.C1 creates a book")["outcome"],
                                 "pass")
                self.assertEqual(st.run_one(d, "tests/acceptance/f1.test.js::F1 books F1.C2 rejects an empty title")
                                 ["outcome"], "fail")
                cases = st.run_cases(d, ["tests/acceptance/f9.test.js::missing"])
                self.assertFalse(cases["tests/acceptance/f9.test.js::missing"])
        finally:
            shutil.rmtree(d)

    def test_prepare_without_package_json(self):
        d = _tree({"a.js": "x"})
        try:
            self.assertIn("no package.json", stacks.get("node-cap").prepare(d))
            r = stacks.get("node-cap").run(d, ["x.test.js::t"])
            self.assertEqual(r["failures"][0]["error_type"], "InstallError")
            self.assertFalse(r["results"]["x.test.js::t"])
        finally:
            shutil.rmtree(d)

    def test_call_sites_dispatch_to_node_stack(self):
        """verifier.run_tests, merge queue and QAS default runners go through the stack for a node repo."""
        from line.build import verifier
        from line.ship import merge_queue, qas_runner
        d = _tree({"package.json": {"dependencies": {"@sap/cds": "9"}}})
        canned = {"rc": 0, "ran": 1, "failures": [], "output": "ok", "timeout": False, "results": {"f::t": True}}
        try:
            with mock.patch.object(N.NodeCap, "run", return_value=canned) as m:
                self.assertEqual(verifier.run_tests(d, ["f::t"])["ran"], 1)
                self.assertTrue(merge_queue.default_test_runner(d, ["f::t"])["ok"])
                self.assertEqual(qas_runner.default_case_runner(d, ["f::t"]), {"f::t": True})
                self.assertEqual(m.call_count, 3)
        finally:
            shutil.rmtree(d)


@unittest.skipUnless(os.environ.get("LINE_NODE_LIVE") == "1" and shutil.which("node") and shutil.which("npm"),
                     "live node-cap test: set LINE_NODE_LIVE=1 (node + npm on PATH, network for the first install)")
class LiveCapMiniTests(unittest.TestCase):
    def test_cap_mini_green_red_and_empty(self):
        st = stacks.detect(CAP_MINI)
        self.assertEqual(st.name, "node-cap")
        d = tempfile.mkdtemp(prefix="line-capmini-")
        try:
            w = os.path.join(d, "w")
            shutil.copytree(CAP_MINI, w, ignore=shutil.ignore_patterns("node_modules"))
            r = st.run(w, [])
            self.assertEqual((r["rc"], r["ran"], r["failures"]), (0, 2, []), r["output"][-800:])
            names = sorted(r["results"])
            with open(os.path.join(w, "srv", "cat-service.js"), "w") as fh:
                fh.write("const cds=require('@sap/cds');module.exports=class extends cds.ApplicationService{}\n")
            self.assertEqual(st.run_one(w, names[1])["outcome"], "fail")
            self.assertEqual(st.run_one(w, names[0])["outcome"], "pass")
            e = os.path.join(d, "empty", "tests", "acceptance")
            os.makedirs(e)
            shutil.copyfile(os.path.join(CAP_MINI, "tests", "acceptance", "f1.test.js"), os.path.join(e, "f1.test.js"))
            st.stage_empty_extra(CAP_MINI, os.path.join(d, "empty"))
            self.assertNotIn("pass", [st.run_one(os.path.join(d, "empty"), n)["outcome"] for n in names])
        finally:
            shutil.rmtree(d, ignore_errors=True)

    def test_engine_gates_on_cap_mini(self):
        """The real engine gates on a CAP repo: test check (trace + red on an empty implementation) and
        the verifier's test run."""
        from line.build import verifier
        from line.contracts import AccTest
        from line.understand.test_check import check_tests
        d = tempfile.mkdtemp(prefix="line-capmini-")
        try:
            w = os.path.join(d, "w")
            shutil.copytree(CAP_MINI, w, ignore=shutil.ignore_patterns("node_modules"))
            path = "tests/acceptance/f1.test.js"
            tests = [AccTest(id="T_F1_C1", f_item="F1", criterion="F1.C1", span_id="spec.md#L3-5", path=path,
                             name=path + "::F1 books F1.C1 creates a book"),
                     AccTest(id="T_F1_C2", f_item="F1", criterion="F1.C2", span_id="spec.md#L6-7", path=path,
                             name=path + "::F1 books F1.C2 rejects an empty title")]
            g = check_tests(w, tests)
            self.assertTrue(g.ok, g.detail)
            self.assertEqual(set(g.detail["outcomes"].values()) - {"fail", "error"}, set())
            r = verifier.run_tests(w, [t.name for t in tests])
            self.assertEqual((r["rc"], r["ran"], r["failures"]), (0, 2, []), r["output"][-600:])
        finally:
            shutil.rmtree(d, ignore_errors=True)


if __name__ == "__main__":
    unittest.main()
