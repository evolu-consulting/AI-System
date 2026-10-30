"""Learning loop: serving lessons by key, and the on_prompt / on_run_end hooks (block 18)."""

from __future__ import annotations

import types
import unittest

from line import codes
from line.contracts import E_RUN, E_UNIT, Envelope, Run, Unit
from line.learn.distiller import lesson_id
from line.learn.evalgate import arm
from line.learn.hooks import on_prompt, on_run_end
from line.learn.lstore import LearnStore
from line.learn.serve import serve_lessons
from line.tests.fakes import FakeLlm, make_fakes


def cfg(**kw):
    base = dict(model="m-main", model_alt="m-alt", agent_version="line-t", workroot="", learn_enabled=True,
                learn_canary_ratio=0.2, learn_holdback_ratio=0.1, learn_serve_max_chars=1500, learn_eval_path="")
    base.update(kw)
    return types.SimpleNamespace(**base)


def add(ls, lid, status, role="builder", step="build", text=None, seen=1):
    return ls.put("lesson", lid, {"key": {"role": role, "step": step, "stack": "python"}, "status": status,
                                  "text": text or "lesson %s text" % lid, "seen": seen, "created_ms": 1})


class ServeTests(unittest.TestCase):
    def setUp(self):
        self.ls = LearnStore("")

    def test_active_and_canary_by_arm(self):
        add(self.ls, "L-a", "active")
        can = add(self.ls, "L-c", "canary")
        add(self.ls, "L-x", "withdrawn")
        add(self.ls, "L-p", "active", role="planner", step="plan")
        treat = next(u for u in ("U%d" % i for i in range(200)) if arm(self.ls, can, "R1", u, cfg(), record=False) == "treat")
        control = next(u for u in ("U%d" % i for i in range(200)) if arm(self.ls, can, "R1", u, cfg(), record=False) == "control")
        a = self.ls.get("lesson", "L-a")
        if arm(self.ls, a, "R1", treat, cfg(), record=False) != "treat" or \
                arm(self.ls, a, "R1", control, cfg(), record=False) != "treat":
            self.skipTest("hash put a test unit in the active lesson's holdback")
        sv = serve_lessons(self.ls, "builder", "build", run="R1", unit=treat, cfg=cfg())
        self.assertEqual(sv.lesson_ids, ["L-a", "L-c"])
        self.assertIn("lesson L-c text", sv.text)
        sv2 = serve_lessons(self.ls, "builder", "build", run="R1", unit=control, cfg=cfg())
        self.assertEqual(sv2.lesson_ids, ["L-a"])
        self.assertEqual(sv2.arms["L-c"], "control")
        # both arms recorded, so the comparison sees the control unit too
        self.assertEqual({a["unit"] for a in self.ls.query("arm", lesson="L-c")}, {treat, control})

    def test_run_level_role_gets_active_only(self):
        add(self.ls, "L-p", "active", role="planner", step="plan")
        add(self.ls, "L-q", "canary", role="planner", step="plan")
        sv = serve_lessons(self.ls, "planner", "plan", run="R1", cfg=cfg())
        self.assertEqual(sv.lesson_ids, ["L-p"])
        self.assertEqual(self.ls.query("arm"), [])

    def test_char_budget(self):
        for i in range(10):
            add(self.ls, "L-%d" % i, "active", role="planner", step="plan", text="x" * 90)
        sv = serve_lessons(self.ls, "planner", "plan", run="R1", max_chars=300, cfg=cfg())
        self.assertLessEqual(len(sv.text), 300)
        self.assertEqual(len(sv.lesson_ids), 3)

    def test_rag_hits_fill_the_rest_and_never_leak_unserved_lessons(self):
        f = make_fakes()
        add(self.ls, "L-p", "active", role="planner", step="plan")
        add(self.ls, "L-q", "canary", role="planner", step="plan")
        f.rag.docs = [{"text": "remote tip", "source": "kb/tip1", "tags": ["planner"]},
                      {"text": "canary copy", "source": "lesson/L-q", "tags": ["planner"]},
                      {"text": "dup", "source": "lesson/L-p", "tags": ["planner"]}]
        sv = serve_lessons(self.ls, "planner", "plan", run="R1", rag=f.rag, cfg=cfg())
        self.assertEqual(sv.rag_hits, 1)
        self.assertIn("[kb/tip1] remote tip", sv.text)
        self.assertNotIn("canary copy", sv.text)
        self.assertNotIn("dup", sv.text)
        f.rag.down = True
        sv = serve_lessons(self.ls, "planner", "plan", run="R1", rag=f.rag, cfg=cfg())
        self.assertEqual((sv.lesson_ids, sv.rag_hits), (["L-p"], 0))
        self.assertEqual(serve_lessons(None, "planner", "plan", rag=None, cfg=cfg()).text, "")


def env(run, unit="", attempt=0):
    return Envelope(run=run, unit=unit, attempt=attempt, agent_version="line-t", model="m-main")


class HookTests(unittest.TestCase):
    def ctx(self, **kw):
        f = make_fakes()
        return types.SimpleNamespace(store=f.store, cfg=cfg(**kw), llm=None, rag=f.rag, learn_store=LearnStore(""))

    def test_disabled_hooks_do_nothing(self):
        c = self.ctx(learn_enabled=False)
        add(c.learn_store, "L-p", "active", role="planner", step="plan")
        self.assertEqual(on_prompt(c, "planner", "plan", "R1"), "")
        self.assertEqual(on_run_end(c, "R1"), {})

    def test_run_end_distils_judges_and_records_outcomes(self):
        c = self.ctx()
        st = c.store
        st.put(E_RUN, "R1", Run("R1", "p", state="green"), run="R1")
        st.put(E_UNIT, "R1:U1", Unit("U1", "R1", state="merged", attempt=2), run="R1")
        st.put(E_UNIT, "R1:U2", Unit("U2", "R1", state="merged", attempt=1), run="R1")
        seq = st.emit(codes.VERIFY_FAILED, env("R1", "U1", 1), {"code": codes.TEST_FAIL, "fingerprint": "fp-9",
                                                                "reason": "id lost on reload"})
        lid = lesson_id("builder", "build", "python", "fp-9")
        # a canary lesson from an older run, served to both units of R1
        old = add(c.learn_store, "L-old", "canary")
        sides = {u: arm(c.learn_store, old, "R1", u, c.cfg) for u in ("U1", "U2")}
        distilled = {"lessons": [{"fingerprint": "fp-9", "symptom": "Items lose their id after reload",
                                  "cause": "id not saved", "fix": "Save the id with each item.",
                                  "evidence": ["R1:%d" % seq]}]}
        c.llm = FakeLlm({("distiller", "builder.build"): [distilled],
                         ("eval_judge", lid): [{"verdict": "approve", "safety_ok": True, "cases": []}]})
        out = on_run_end(c, "R1")
        self.assertNotIn("error", out, out)
        self.assertEqual(out["outcomes"], 2)
        oc = {o["unit"]: (o["arm"], o["success"]) for o in c.learn_store.query("outcome", lesson="L-old")}
        self.assertEqual(oc, {"U1": (sides["U1"], False), "U2": (sides["U2"], True)})
        self.assertEqual(out["distilled"]["proposed"], [lid])
        self.assertEqual(out["judged"][0]["verdict"], "approve")
        self.assertEqual(c.learn_store.get("lesson", lid)["status"], "canary")
        self.assertEqual([x["role"] for x in c.llm.calls], ["distiller", "eval_judge"])
        # the new lesson is served to the next builder unit in the treat arm, never to the finished run
        new = c.learn_store.get("lesson", lid)
        treat = next(u for u in ("U%d" % i for i in range(200)) if arm(c.learn_store, new, "R2", u, c.cfg,
                                                                        record=False) == "treat")
        self.assertIn("Save the id with each item.", on_prompt(c, "builder", "build", "R2", unit=treat))
        self.assertEqual(c.learn_store.query("arm", lesson=lid, run="R1"), [])

    def test_run_end_never_raises(self):
        c = self.ctx()
        c.store = None
        out = on_run_end(c, "R1")
        self.assertIn("error", out)


if __name__ == "__main__":
    unittest.main()
