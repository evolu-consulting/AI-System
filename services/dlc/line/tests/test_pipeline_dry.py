"""Fast dry e2e of the pipeline on samples/todo-pack (fake model): base run and the variants.

Same checks as line/e2e/run_line_e2e.py (gapless events, zero spend, traced tests, board green,
QAS dir green on its own, plan milestones; flaky quarantine; fixer loop; RAG outage + outbox drain).
"""

from __future__ import annotations

import shutil
import tempfile
import unittest

from line.e2e.run_line_e2e import run_variant


class PipelineDryE2E(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.root = tempfile.mkdtemp(prefix="line-pipe-test-")

    @classmethod
    def tearDownClass(cls) -> None:
        shutil.rmtree(cls.root, ignore_errors=True)

    def _run(self, variant: str) -> None:
        r = run_variant(variant, workroot=self.root)
        self.assertTrue(r.ok, r.line())

    def test_base_green_with_plan_milestones(self) -> None:
        self._run("base")

    def test_flaky_test_is_quarantined_and_run_green(self) -> None:
        self._run("flaky")

    def test_red_on_qas_spawns_fixer_then_green(self) -> None:
        self._run("qas_red")

    def test_rag_outage_degrades_then_outbox_drains(self) -> None:
        self._run("rag_outage")

    def test_all_on_every_wave4_feature(self) -> None:
        self._run("all_on")

    def test_conflict_parks_then_answers_resume_to_green(self) -> None:
        self._run("conflict_park")


if __name__ == "__main__":
    unittest.main()
