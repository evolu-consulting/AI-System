"""Learning loop: distiller (design block 18, §8 e1-e3)."""

from __future__ import annotations

import types
import unittest
from unittest import mock

from line import codes
from line.contracts import E_RUN, E_UNIT, Envelope, Run, Unit
from line.learn import LEARN_KINDS, LESSON_PROPOSED, setting
from line.learn.distiller import collect_signals, distil, group_signals, lesson_id, lint, scrub
from line.learn.lstore import LearnStore
from line.tests.fakes import FakeLlm, make_fakes


def cfg(**kw):
    base = dict(model="m-main", model_alt="m-alt", agent_version="line-t", workroot="", learn_enabled=True)
    base.update(kw)
    return types.SimpleNamespace(**base)


def env(run, unit="", attempt=0):
    return Envelope(run=run, unit=unit, attempt=attempt, agent_version="line-t", model="m-main")


def make_run(store, run, state="green", fp="fp-1"):
    store.put(E_RUN, run, Run(run, "pack", state=state, spec_hash="h"), run=run)
    store.put(E_UNIT, "%s:U1" % run, Unit("U1", run, state="merged", attempt=2, f_items=["F1"]), run=run)
    store.put(E_UNIT, "%s:U2" % run, Unit("U2", run, state="merged", attempt=1, f_items=["F2"]), run=run)
    store.put(E_UNIT, "%s:U3" % run, Unit("U3", run, state="merged", attempt=2, f_items=["F3"]), run=run)
    s1 = store.emit(codes.VERIFY_FAILED, env(run, "U1", 1), {"code": codes.TEST_FAIL, "fingerprint": fp,
                                                             "reason": "test_c2 failed", "evidence": "KeyError 'id'"})
    store.emit(codes.VERIFY_FAILED, env(run, "U3", 1), {"code": codes.TEST_TAMPER, "fingerprint": "fp-t",
                                                        "reason": "locked test changed"})
    store.emit(codes.VERIFY_FAILED, env(run, "U3", 2), {"code": codes.TEST_FAIL, "fingerprint": "fp-x",
                                                        "reason": "x"})
    store.emit(codes.ESCALATED, env(run), {"code": codes.BUDGET_EXCEEDED, "message": "over"})
    s2 = store.emit(codes.QAS_RESULT, env(run), {"f_item": "F2", "verdict": "flaky", "runs": [True, False, True],
                                                 "code": codes.FLAKY, "quarantined": ["t.test_x"], "failing": []})
    return s1, s2


def builder_lesson(run, seq, fp="fp-1", **kw):
    le = {"fingerprint": fp, "symptom": "A stored item has no id after reload",
          "cause": "ids were not written to the file", "fix": "Persist the id field with every item.",
          "evidence": ["%s:%d" % (run, seq)], "cause_inferred": False}
    le.update(kw)
    return {"lessons": [le]}


class SignalTests(unittest.TestCase):
    def test_signals_skip_cheat_units_and_infra_codes(self):
        f = make_fakes()
        s1, s2 = make_run(f.store, "R1")
        sig = collect_signals(f.store, "R1")
        ids = {s["id"]: s for s in sig}
        self.assertEqual(set(ids), {"R1:%d" % s1, "R1:%d" % s2})
        self.assertEqual((ids["R1:%d" % s1]["role"], ids["R1:%d" % s1]["step"]), ("builder", "build"))
        self.assertEqual((ids["R1:%d" % s2]["role"], ids["R1:%d" % s2]["step"]), ("test_author", "qas"))
        groups = group_signals(sig)
        self.assertEqual(len(groups), 2)
        self.assertEqual(groups[0]["fingerprint"], "fp-1")
        self.assertEqual(groups[0]["units"], ["U1"])

    def test_fixer_units_key_as_fixer(self):
        f = make_fakes()
        f.store.put(E_RUN, "R1", Run("R1", "p", state="green"), run="R1")
        f.store.put(E_UNIT, "R1:FX", Unit("FX", "R1", state="merged", fixer_gen=1), run="R1")
        f.store.emit(codes.VERIFY_FAILED, env("R1", "FX", 1), {"code": codes.TEST_FAIL, "reason": "boom"})
        sig = collect_signals(f.store, "R1")
        self.assertEqual(sig[0]["role"], "fixer")
        self.assertTrue(sig[0]["fingerprint"])        # hashed from code + reason

    def test_reviewer_block_is_a_signal(self):
        # regression: the reviewer emits review.done; the distiller only listened for kinds nobody emits, so a
        # reviewer block never became a lesson
        f = make_fakes()
        f.store.put(E_RUN, "R1", Run("R1", "p", state="green"), run="R1")
        f.store.put(E_UNIT, "R1:U2", Unit("U2", "R1", state="merged", attempt=2), run="R1")
        s = f.store.emit(codes.REVIEW_DONE, env("R1", "U2", 1), {"ok": False, "blocking": 1, "kept": 1,
                                                                 "fingerprint": "rv-1"})
        f.store.emit(codes.REVIEW_DONE, env("R1", "U2", 2), {"ok": True, "blocking": 0, "kept": 0})
        sig = collect_signals(f.store, "R1")
        self.assertEqual([(x["id"], x["code"], x["role"], x["step"], x["fingerprint"]) for x in sig],
                         [("R1:%d" % s, codes.REVIEW_BLOCK, "builder", "review", "rv-1")])

    def test_lint_and_scrub(self):
        self.assertTrue(lint("Avoid TEST_FAIL by keeping diffs small"))
        self.assertTrue(lint("make the verifier happy"))
        self.assertTrue(lint("Use unittest.skip on slow tests"))
        self.assertEqual(lint("Persist the id field with every item."), [])
        self.assertNotIn("hunter2", scrub("password=hunter2 rest"))
        self.assertIn("***", scrub("token " + "a" * 40))


class DistilTests(unittest.TestCase):
    def setUp(self):
        self.f = make_fakes()
        self.ls = LearnStore("")

    def test_proposes_candidate_with_evidence_and_provenance(self):
        s1, s2 = make_run(self.f.store, "R1")
        llm = FakeLlm({("distiller", "builder.build"): [builder_lesson("R1", s1)],
                       ("distiller", "test_author.qas"): [{"lessons": []}]})
        with mock.patch.object(codes, "EVENT_KINDS", codes.EVENT_KINDS | set(LEARN_KINDS)):
            res = distil(self.f.store, llm, self.ls, "R1", cfg())
        lid = lesson_id("builder", "build", "python", "fp-1")
        self.assertEqual(res["proposed"], [lid])
        le = self.ls.get("lesson", lid)
        self.assertEqual(le["status"], "candidate")
        self.assertEqual(le["evidence"], ["R1:%d" % s1])
        self.assertEqual(le["provenance"]["source_run"], "R1")
        self.assertTrue(le["provenance"]["fix_verified"])
        self.assertEqual(le["metric"], "first_pass_yield")
        # distiller runs on the alternate model, the judge will get the main one
        self.assertEqual([c["model"] for c in llm.calls], ["m-alt", "m-alt"])
        self.assertIn("R1:%d" % s1, llm.calls[0]["prompt"])
        evs = self.f.store.events_after(0, run="R1", kinds=[LESSON_PROPOSED])
        self.assertEqual(len(evs), 1)
        self.assertEqual(evs[0].body["lesson"], lid)
        self.assertTrue(any(d["why"] == "no lesson proposed" for d in res["dropped"]))

    def test_drops_bad_evidence_and_lint(self):
        s1, s2 = make_run(self.f.store, "R1")
        flaky_fp = collect_signals(self.f.store, "R1")[1]["fingerprint"]
        llm = FakeLlm({("distiller", "builder.build"): [builder_lesson("R1", s2)],        # id of another group
                       ("distiller", "test_author.qas"): [{"lessons": [{
                           "fingerprint": flaky_fp, "symptom": "flaky", "fix": "ask the verifier to rerun",
                           "evidence": ["R1:%d" % s2]}]}]})
        res = distil(self.f.store, llm, self.ls, "R1", cfg())
        self.assertEqual(res["proposed"], [])
        whys = sorted(d["why"] for d in res["dropped"])
        self.assertIn("evidence not in group", whys)
        self.assertIn("lint", whys)
        self.assertEqual(self.ls.query("lesson"), [])

    def test_dedupe_by_key_and_fingerprint_across_runs(self):
        s1, _ = make_run(self.f.store, "R1")
        llm = FakeLlm({("distiller", "builder.build"): [builder_lesson("R1", s1)],
                       ("distiller", "test_author.qas"): [{"lessons": []}]})
        distil(self.f.store, llm, self.ls, "R1", cfg())
        n_calls = len(llm.calls)
        t1, _ = make_run(self.f.store, "R2")
        res = distil(self.f.store, llm, self.ls, "R2", cfg())
        lid = lesson_id("builder", "build", "python", "fp-1")
        self.assertIn(lid, res["merged"])
        self.assertNotIn(lid, res["proposed"])
        # only the flaky group (no lesson yet) went to the model again; the builder group did not
        self.assertEqual([c["key"] for c in llm.calls[n_calls:]], ["test_author.qas"])
        le = self.ls.get("lesson", lid)
        self.assertEqual(le["seen"], 2)
        self.assertEqual(le["provenance"]["runs"], ["R1", "R2"])
        self.assertIn("R2:%d" % t1, le["evidence"])
        # the same run again adds nothing
        distil(self.f.store, llm, self.ls, "R2", cfg())
        self.assertEqual(self.ls.get("lesson", lid)["seen"], 2)

    def test_run_not_final_is_skipped(self):
        make_run(self.f.store, "R1", state="building")
        llm = FakeLlm({})
        res = distil(self.f.store, llm, self.ls, "R1", cfg())
        self.assertEqual(res.get("skipped"), "run not final")
        self.assertEqual(llm.calls, [])

    def test_model_error_drops_groups_without_raising(self):
        make_run(self.f.store, "R1")
        res = distil(self.f.store, FakeLlm({}), self.ls, "R1", cfg())
        self.assertEqual(res["proposed"], [])
        self.assertTrue(all(d["why"].startswith("llm:") for d in res["dropped"]))

    def test_settings_fall_back_to_env_then_default(self):
        self.assertEqual(setting(types.SimpleNamespace(), "learn_canary_ratio", env={}), 0.2)
        self.assertEqual(setting(types.SimpleNamespace(), "learn_canary_ratio",
                                 env={"LINE_LEARN_CANARY_RATIO": "0.5"}), 0.5)
        self.assertEqual(setting(types.SimpleNamespace(learn_canary_ratio=0.3), "learn_canary_ratio", env={}), 0.3)
        self.assertTrue(setting(types.SimpleNamespace(), "learn_enabled", env={"LINE_LEARN_ENABLED": "1"}))


class LearnStoreTests(unittest.TestCase):
    def test_file_roundtrip(self):
        import os
        import tempfile
        d = tempfile.mkdtemp()
        p = os.path.join(d, "sub", "learn.json")
        ls = LearnStore(p)
        ls.put("lesson", "a", {"status": "candidate"})
        ls.put("lesson", "b", {"status": "active"})
        ls.update("lesson", "a", status="active")
        ls2 = LearnStore(p)
        self.assertEqual([r["id"] for r in ls2.query("lesson", status="active")], ["a", "b"])
        ls2.put("lesson", "c", {})
        self.assertEqual([r["id"] for r in ls2.query("lesson")], ["a", "b", "c"])


if __name__ == "__main__":
    unittest.main()
