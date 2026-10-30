"""The solo lane (line.solo): the gate, the reviewer of level 2, the per-call cap, the run end to end, the retry one
level up."""

from __future__ import annotations

import json
import os
import shutil
import tempfile
import unittest

from line import solo
from line.config import load_config
from line.contracts import E_LLM_CALL, E_RUN, LlmResult
from line.llm import make_llm
from line.pipeline import Pipeline, init_target
from line.statemachine import update_row
from line.store import SqliteStore

GOOD = "import unittest\n\n\nclass T(unittest.TestCase):\n    def test_ok(self):\n        self.assertEqual(1, 1)\n"
BAD = GOOD.replace("assertEqual(1, 1)", "assertEqual(1, 2)")
PASS = '{"verdict": "pass", "missing": []}\nSUBMIT'
MISS = '{"verdict": "fix", "missing": [{"point": "add(a, b)", "evidence": "calc.py:2 subtracts"}]}\nSUBMIT'


def cfg(**kw):
    return load_config(env={}, line_json=None, rag_local_json=None, **kw)


def write(root, rel, text):
    path = os.path.join(root, *rel.split("/"))
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as fh:
        fh.write(text)


class Writer:
    """Backend whose solo agent writes one dict of files per call; the reviewer answers from `reviews` (else pass)."""
    name = "writer"
    overhead_tokens = 0

    def __init__(self, *rounds, reviews=()):
        self.rounds, self.reviews, self.calls = list(rounds), list(reviews), []

    def raw_complete(self, role, prompt, model, key, repair=False):
        return LlmResult(None, "{}", {"input": 1, "output": 1}, 0.01, model, "")

    def raw_agentic(self, role, workdir, prompt, model, max_turns, usd_cap, key):
        self.calls.append((role, key, prompt, max_turns, usd_cap))
        if role == solo.REVIEW_ROLE:
            return LlmResult(None, self.reviews.pop(0) if self.reviews else PASS, {"input": 1, "output": 1}, 0.05,
                             model, "SUBMIT")
        for rel, text in (self.rounds.pop(0) if self.rounds else {}).items():
            write(workdir, rel, text)
        return LlmResult(None, "done\nSUBMIT", {"input": 1, "output": 1}, 0.2, model, "SUBMIT")


class ReviewOnTest(unittest.TestCase):
    def test_level_2_is_reviewed_and_level_1_is_not(self):
        self.assertFalse(solo.review_on(cfg(), 1))
        self.assertTrue(solo.review_on(cfg(), 2))
        self.assertTrue(solo.review_on(cfg(solo_review="1"), 1))
        self.assertFalse(solo.review_on(cfg(solo_review="0"), 2))

    def test_levels_3_and_4_go_to_the_lead_unless_it_is_off(self):
        from line.understand import sizer
        self.assertEqual([sizer.lane_for(lv, cfg(llm="cli", solo_lead="0")) for lv in (1, 2, 3, 4)],
                         ["solo", "solo", "small", "full"])
        self.assertEqual([sizer.lane_for(lv, cfg(llm="cli")) for lv in (1, 2, 3, 4)], ["solo"] * 4)   # auto

    def test_misses_are_read_from_the_reviewers_answer(self):
        self.assertEqual(solo.misses(PASS), [])
        self.assertEqual(solo.misses("no json"), [])
        self.assertEqual(solo.misses(MISS), [{"point": "add(a, b)", "evidence": "calc.py:2 subtracts"}])


class SuiteTest(unittest.TestCase):
    def setUp(self):
        self.root = tempfile.mkdtemp(prefix="solo-suite-")

    def tearDown(self):
        shutil.rmtree(self.root, ignore_errors=True)

    def test_green_red_and_empty(self):
        self.assertFalse(solo.suite(self.root)["ok"])               # no test at all is not a pass
        write(self.root, "tests/test_a.py", GOOD)
        write(self.root, "tests/__init__.py", "")
        res = solo.suite(self.root)
        self.assertTrue(res["ok"], res["output"])
        self.assertGreater(res["ran"], 0)
        write(self.root, "tests/test_a.py", BAD)
        self.assertFalse(solo.suite(self.root)["ok"])


class CapTest(unittest.TestCase):
    def test_the_solo_call_is_not_held_to_the_per_call_cap(self):
        llm = make_llm(cfg(max_usd_call=0.05, max_usd_run=10), backend=Writer())
        res = llm.agentic("solo", tempfile.gettempdir(), "go", 5, 4.0, run="r")
        self.assertEqual(res.outcome, "SUBMIT")


CODE = {"calc.py": "def add(a, b):\n    return a - b\n",
        "tests/__init__.py": "",
        "tests/test_calc.py": "import unittest\nfrom calc import add\n\n\nclass T(unittest.TestCase):\n"
                              "    def test_add(self):\n        self.assertEqual(add(2, 3), 5)\n"}
FIXED = {"calc.py": "def add(a, b):\n    return a + b\n"}
UNTESTED = {"calc.py": "def add(a, b):\n    return a - b\n", "tests/__init__.py": "", "tests/test_x.py": GOOD}


class SoloRunTest(unittest.TestCase):
    def setUp(self):
        self.work = tempfile.mkdtemp(prefix="solo-run-")
        self.pack = os.path.join(self.work, "pack")
        write(self.pack, "spec.md", "# Add\n\nA function add(a, b) in calc.py returning a + b, with tests.\n")
        write(self.pack, "pack.json", '{"id": "calc", "title": "Calc", "kind": "new", "files": ["spec.md"]}')

    def tearDown(self):
        shutil.rmtree(self.work, ignore_errors=True)

    def _drive(self, backend, level="2"):
        c = cfg(workroot=os.path.join(self.work, "w"), db=os.path.join(self.work, "line.db"), llm="fake",
                solo="1", max_usd_run=10, deploy_windows=[])
        store = SqliteStore(c.db)
        target = init_target(os.path.join(self.work, "target"))
        p = Pipeline(store, c, llm=make_llm(c, store, backend=backend))
        run = p.admit(self.pack, target)
        update_row(store, E_RUN, run, {"detail": dict(store.get(E_RUN, run)["detail"], level=level)})
        return store, run, target, p.drive(run)

    @staticmethod
    def keys(backend, role=solo.ROLE):
        return [k for r, k, *_ in backend.calls if r == role]

    def test_red_gate_goes_back_to_the_agent_then_review_then_green_on_main_and_qas(self):
        backend = Writer(CODE, FIXED)
        store, run, target, row = self._drive(backend)
        self.assertEqual(row["state"], "green", row.get("detail"))
        self.assertEqual(self.keys(backend), ["solo#0", "solo#1"])
        self.assertIn("THE GATE FAILED", backend.calls[1][2])
        self.assertEqual(self.keys(backend, solo.REVIEW_ROLE), ["review#1"])    # reviewed once the gate is green
        with open(os.path.join(target, "calc.py"), encoding="utf-8") as fh:
            self.assertIn("a + b", fh.read())
        detail = row["detail"]
        self.assertEqual((detail["sizing"]["level"], detail["sizing"]["lane"]), (2, "solo"))
        self.assertEqual([a["gate"] for a in detail["solo"]["attempts"]], [False, True])
        roles = {c.get("role") for c in store.query(E_LLM_CALL, run=run)}
        self.assertEqual(roles, {"solo", "solo_reviewer"})    # no reader, test author or planner was paid

    def test_a_point_the_review_finds_goes_back_to_the_agent(self):
        backend = Writer(UNTESTED, FIXED, reviews=[MISS, PASS])
        _store, _run, target, row = self._drive(backend)
        self.assertEqual(row["state"], "green", row.get("detail"))
        self.assertIn("AN INDEPENDENT REVIEW", backend.calls[2][2])
        self.assertIn("calc.py:2 subtracts", backend.calls[2][2])
        with open(os.path.join(target, "calc.py"), encoding="utf-8") as fh:
            self.assertIn("a + b", fh.read())

    def test_a_point_still_missing_after_the_last_round_ends_the_run(self):
        backend = Writer(UNTESTED, {}, {}, reviews=[MISS, MISS, MISS])
        _store, _run, _target, row = self._drive(backend)
        self.assertEqual(row["state"], "escalated")
        self.assertIn("review still finds 1 point", row["detail"]["escalation"]["message"])

    def test_level_1_is_one_quick_agent_without_review(self):
        backend = Writer(CODE, FIXED)
        _store, _run, _target, row = self._drive(backend, level="1")
        self.assertEqual(row["state"], "green", row.get("detail"))
        self.assertEqual(self.keys(backend, solo.REVIEW_ROLE), [])
        self.assertEqual((backend.calls[0][3], backend.calls[0][4]), (solo.LEVEL1_MAX_TURNS, solo.LEVEL1_MAX_USD))

    def test_a_question_with_green_work_goes_on_and_is_kept_for_a_person(self):
        class Asker(Writer):
            def raw_agentic(self, role, workdir, prompt, model, max_turns, usd_cap, key):
                res = super().raw_agentic(role, workdir, prompt, model, max_turns, usd_cap, key)
                if role == solo.REVIEW_ROLE:
                    return res
                return LlmResult(None, "done\nDECISIONS:\n- filter any vs all: any\nBLOCKED: any or all?",
                                 {"input": 1, "output": 1}, 0.2, model, "BLOCKED: any or all?")
        _store, _run, _target, row = self._drive(Asker({"tests/__init__.py": "", "tests/test_x.py": GOOD}))
        self.assertEqual(row["state"], "green", row.get("detail"))
        self.assertEqual(row["detail"]["solo"]["questions"], ["any or all?"])
        self.assertEqual(row["detail"]["solo"]["decisions"], ["filter any vs all: any"])

    def test_a_block_with_nothing_done_ends_the_run_with_its_kind_for_the_supervisor_and_retros(self):
        class Stuck(Writer):
            def raw_agentic(self, role, workdir, prompt, model, max_turns, usd_cap, key):
                self.calls.append((role, key, prompt, max_turns, usd_cap))
                return LlmResult(None, "looked\nBLOCKED: access: no read access to the tickets database",
                                 {"input": 1, "output": 1}, 0.2, model, "BLOCKED: access: no rea")
        store, run, _target, row = self._drive(Stuck())
        self.assertEqual(row["state"], "escalated")
        from line.contracts import E_ESCALATION
        esc = store.query(E_ESCALATION, run=run)[-1]
        self.assertEqual(esc["detail"]["blocked_kind"], "access")
        self.assertEqual(esc["detail"]["blocked_reason"], "no read access to the tickets database")
        self.assertIn("stopped (access)", esc["message"])
        facts = row["detail"]["outcomes"][solo.ROLE]
        self.assertTrue(facts["judged_by_retry"])                 # the retry's result judges the block
        self.assertEqual(facts["rounds"][0]["blocked"]["kind"], "access")
        from line.agent_memory import retro_evidence
        ev = retro_evidence(store, run)
        self.assertIn("BLOCKED (access), the agent's reason: no read access", ev)
        self.assertIn("The agent's last words", ev)

    def test_the_kind_of_a_block_is_read_from_its_words(self):
        self.assertEqual(solo.blocked("BLOCKED: spec: two opposite rules"), ("spec", "two opposite rules"))
        self.assertEqual(solo.blocked("BLOCKED: x", "done\nBLOCKED:Unsafe - drops every table"),
                         ("unsafe", "drops every table"))
        self.assertEqual(solo.blocked("BLOCKED: npm: command not found")[0], "host")
        self.assertEqual(solo.blocked("BLOCKED: any or all?"), ("other", "any or all?"))

    def test_decisions_are_read_from_the_final_message(self):
        self.assertEqual(solo.decisions("x\nDECISIONS: none\nSUBMIT"), [])
        self.assertEqual(solo.decisions("DECISIONS:\n- a: b\n* c: d\nSUBMIT"), ["a: b", "c: d"])

    def test_a_red_qas_leaves_main_as_it_was(self):
        c = cfg(workroot=os.path.join(self.work, "w"), db=os.path.join(self.work, "line.db"), llm="fake",
                solo="1", max_usd_run=10, deploy_windows=[])
        store = SqliteStore(c.db)
        target = init_target(os.path.join(self.work, "target"))
        from line.ship._util import git_out
        before = git_out(target, "rev-parse", "main")
        import sys
        p = Pipeline(store, c, llm=make_llm(c, store, backend=Writer(CODE, FIXED)),
                     smoke_cmd=[sys.executable, "-c", "import sys; sys.exit(1)"])
        run = p.admit(self.pack, target)
        update_row(store, E_RUN, run, {"detail": dict(store.get(E_RUN, run)["detail"], level="1")})
        row = p.drive(run)
        self.assertEqual(row["state"], "escalated")
        self.assertIn("main is unchanged", row["detail"]["escalation"]["message"])
        self.assertEqual(git_out(target, "rev-parse", "main"), before)

    def test_a_retry_runs_the_same_run_again_and_it_goes_green(self):
        from line.reopen import reopen
        bad = {"tests/__init__.py": "", "tests/test_x.py": BAD}
        store, run, target, row = self._drive(Writer(bad, {}, {}))
        self.assertEqual(row["state"], "escalated")
        c = cfg(workroot=os.path.join(self.work, "w"), db=os.path.join(self.work, "line.db"), llm="fake",
                solo="1", max_usd_run=10, deploy_windows=[])
        out = reopen(store, c, run, "tests/test_x.py must assert 1 == 1.", "rowan")
        self.assertEqual((out["run"], out["attempt"]), (run, 2))
        self.assertNotIn("level", out)                              # a person's retry keeps the level
        self.assertEqual(store.get(E_RUN, run)["budget_usd"], 20)  # the attempt has its own budget
        again = Writer({"tests/__init__.py": "", "tests/test_x.py": GOOD})
        row = Pipeline(store, c, llm=make_llm(c, store, backend=again)).drive(run)
        self.assertEqual(row["state"], "green", row["detail"].get("escalation"))
        self.assertEqual(row["id"], run)                            # no new run
        self.assertIn("tests/test_x.py must assert 1 == 1.", [p for r, _k, p, *_ in again.calls if r == solo.ROLE][0])
        self.assertEqual([a["n"] for a in row["detail"]["attempts"]], [1])
        self.assertEqual(len(store.query(E_RUN)), 1)

    def test_a_major_failure_goes_one_level_up_in_the_same_run(self):
        from line.reopen import reopen
        bad = {"tests/__init__.py": "", "tests/test_x.py": BAD}
        store, run, _target, row = self._drive(Writer(bad, {}, {}))
        c = cfg(workroot=os.path.join(self.work, "w"), db=os.path.join(self.work, "line.db"), llm="fake",
                solo="1", max_usd_run=10, deploy_windows=[])
        out = reopen(store, c, run, "Read the whole module first.", "the supervisor", by="supervisor", level_up=True)
        d = store.get(E_RUN, run)["detail"]
        self.assertEqual((out["level"], d["level"], d["level_by"]), (3, "3", "retry"))
        self.assertNotIn("sizing", d)                               # sized again at level 3
        self.assertEqual(d["sizing_earlier"][0]["level"], 2)
        self.assertEqual(d["attempts"][0]["level_up"], 3)
        self.assertEqual(out["to"], "building")                     # level 3 is still the solo lane (its lead)

    def test_a_level_up_that_leaves_the_solo_lane_reads_the_request_again(self):
        from line.reopen import reopen
        bad = {"tests/__init__.py": "", "tests/test_x.py": BAD}
        store, run, _target, row = self._drive(Writer(bad, {}, {}))
        c = cfg(workroot=os.path.join(self.work, "w"), db=os.path.join(self.work, "line.db"), llm="fake",
                solo="1", solo_lead="0", max_usd_run=10, deploy_windows=[])
        out = reopen(store, c, run, "Read the whole module first.", "the supervisor", by="supervisor", level_up=True)
        row = store.get(E_RUN, run)
        self.assertEqual((out["to"], row["state"], row["spec_hash"]), ("understanding", "understanding", ""))
        self.assertNotIn("solo", row["detail"])
        self.assertEqual(len(row["detail"]["solo_earlier"]), 1)


if __name__ == "__main__":
    unittest.main()
