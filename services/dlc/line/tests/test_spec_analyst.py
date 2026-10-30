"""The spec analyst runs once before the freeze and adds its analysis to spec.md (line.understand.analyst)."""

from __future__ import annotations

import os
import re
import shutil
import tempfile
import types
import unittest

from line.config import load_config
from line.contracts import E_RUN, Run
from line.tests.fakes import make_fakes
from line.understand import analyst


class FakeLlm:
    def __init__(self, write=True, fail=False):
        self.calls, self.write, self.fail = [], write, fail

    def agentic(self, role, workdir, prompt, max_turns, usd_cap, *, key="", model=None, run=""):
        self.calls.append((role, workdir, key, run))
        if self.fail:
            raise RuntimeError("model down")
        out = re.search(r"Then write the file (\S+) ", prompt).group(1)
        if self.write:
            with open(out, "w", encoding="utf-8") as fh:
                fh.write("### Source ticket and links\nCS-1: list crashes on empty filter\n")
        return types.SimpleNamespace(outcome="SUBMIT", usd=0.02)


class AnalystTest(unittest.TestCase):
    def setUp(self):
        self.d = tempfile.mkdtemp(prefix="dlc-analyst-")
        self.pack = os.path.join(self.d, "pack")
        os.makedirs(self.pack)
        with open(os.path.join(self.pack, "spec.md"), "w", encoding="utf-8") as fh:
            fh.write("# Bug fix: list crashes\n\nhttps://jira.example.com/browse/CS-1\n")
        self.f = make_fakes()
        self.f.store.put(E_RUN, "R1", Run("R1", self.pack, state="admitted"), run="R1")

    def tearDown(self):
        shutil.rmtree(self.d, ignore_errors=True)

    def pipe(self, llm, mode="1"):
        cfg = load_config(env={"LINE_SPEC_ANALYST": mode, "LINE_WORKROOT": os.path.join(self.d, "work")},
                          line_json=None, rag_local_json=None)
        return types.SimpleNamespace(store=self.f.store, run="R1", cfg=cfg, pack=self.pack, repo=self.d, llm=llm,
                                     log=lambda m: None)

    def spec(self):
        return open(os.path.join(self.pack, "spec.md"), encoding="utf-8").read()

    def test_appends_once_before_the_freeze(self):
        llm = FakeLlm()
        out = analyst.run(self.pipe(llm))
        self.assertEqual(out["outcome"], "SUBMIT")
        self.assertIn(analyst.HEADING, self.spec())
        self.assertIn("CS-1: list crashes on empty filter", self.spec())
        self.assertEqual(llm.calls[0][0], "spec_analyst")
        self.assertEqual(llm.calls[0][3], "R1")
        analyst.run(self.pipe(llm))                       # a resumed run does not analyse twice
        self.assertEqual(len(llm.calls), 1)
        self.assertEqual(self.spec().count(analyst.HEADING), 1)
        self.assertIn("spec_analysis", self.f.store.get(E_RUN, "R1")["detail"])

    def test_failure_or_nothing_written_leaves_the_spec_alone(self):
        before = self.spec()
        out = analyst.run(self.pipe(FakeLlm(fail=True)))
        self.assertIn("model down", out["error"])
        self.assertEqual(self.spec(), before)

    def test_off_with_the_fake_model_unless_asked(self):
        cfg = load_config(env={}, line_json=None, rag_local_json=None)
        self.assertFalse(analyst.enabled(cfg))            # llm fake + auto
        self.assertTrue(analyst.enabled(types.SimpleNamespace(spec_analyst="auto", llm="cli")))
        self.assertFalse(analyst.enabled(types.SimpleNamespace(spec_analyst="0", llm="cli")))
        llm = FakeLlm()
        self.assertEqual(analyst.run(self.pipe(llm, mode="0")), {"skipped": "off"})
        self.assertEqual(llm.calls, [])


if __name__ == "__main__":
    unittest.main()
