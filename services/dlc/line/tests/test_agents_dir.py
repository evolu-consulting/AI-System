"""Agent directory: versions, routing with run pins, shadow, canary, SLO alerts and rollback (block 19)."""

from __future__ import annotations

import types
import unittest
from unittest import mock

from line import codes
from line.agents_dir import (AGENT_KINDS, AGENT_PROMOTED, AGENT_ROLLBACK, AGENT_SLO_BREACH, AgentDirectory,
                             on_run_end)
from line.codes import LineError
from line.contracts import E_ATTEMPT, E_LLM_CALL, E_RUN, E_UNIT, Attempt, Run, Unit, to_dict
from line.learn.lstore import LearnStore
from line.tests.fakes import FakeLlm, make_fakes


def cfg(**kw):
    base = dict(model="m-main", model_alt="m-alt", agent_version="line-t", workroot="", agents_enabled=True,
                agents_canary_ratio=0.05, agents_shadow_min=3, agents_shadow_agree=0.8, agents_margin=0.05,
                slo_min_sample=5, slo_window=50, slo_min_success=0.7, slo_max_escalation=0.2,
                slo_max_usd_per_unit=0.0, slo_max_latency_p95_s=0.0)
    base.update(kw)
    return types.SimpleNamespace(**base)


class DirectoryTests(unittest.TestCase):
    def setUp(self):
        self.f = make_fakes()
        self.f.store.put(E_RUN, "R1", Run("R1", "p", state="building"), run="R1")
        self.t = [1000]
        self.d = AgentDirectory(LearnStore(""), cfg(), self.f.store, clock=lambda: self.t[0])
        self.kinds = mock.patch.object(codes, "EVENT_KINDS", codes.EVENT_KINDS | set(AGENT_KINDS))
        self.kinds.start()
        self.addCleanup(self.kinds.stop)

    def test_defaults_one_active_per_role(self):
        rows = self.d.ensure_defaults(("planner", "reader_b", "builder"))
        self.assertEqual([(r["role"], r["model"], r["status"]) for r in rows],
                         [("planner", "m-main", "active"), ("reader_b", "m-alt", "active"),
                          ("builder", "m-main", "active")])
        self.assertTrue(rows[0]["prompt_version"])
        self.assertEqual(self.d.ensure_defaults(("planner",)), [])
        with self.assertRaises(LineError):
            self.d.register("planner", "v2", "m", status="active")
        with self.assertRaises(LineError):
            self.d.register("planner", "line-t", "m")

    def test_route_pins_the_run_and_canary_takes_a_share_of_units(self):
        self.d.register("builder", "v1", "m1", status="active")
        self.assertEqual(self.d.route("builder", "R1", "U1")["version"], "v1")
        self.d.register("builder", "v2", "m2", status="canary")
        self.d.ls.update("agent", "builder@v1", status="retired")
        self.d.register("builder", "v3", "m3", status="active")
        got = [self.d.route("builder", "R1", "U%d" % i)["version"] for i in range(1000)]
        self.assertTrue(20 < got.count("v2") < 90, got.count("v2"))
        self.assertEqual(set(got) - {"v2"}, {"v1"})                       # R1 stays on its pinned version
        r2 = {self.d.route("builder", "R2", "U%d" % i)["version"] for i in range(50)}
        self.assertIn("v3", r2)                                           # a new run pins the new active
        self.assertNotIn("v1", r2)
        self.assertEqual(self.d.pinned("R2", "builder"), "v3")

    def test_shadow_compares_without_effect_then_promotes_to_canary(self):
        self.d.register("planner", "v1", "m1", status="active")
        self.d.register("planner", "v2", "m2")
        primary = types.SimpleNamespace(data={"units": [1]}, text="")
        llm = FakeLlm({"planner": [{"units": [1]}, {"units": [1]}, {"units": [2]}, {"units": [1]}]})
        with self.assertRaises(LineError):
            self.d.promote("planner", "v2", run="R1")
        rows = []
        for _ in range(4):
            rows += self.d.run_shadow("planner", llm, lambda v: "prompt for " + v["version"], None, primary,
                                      key="plan", run="R1")
        self.assertEqual([r["agree"] for r in rows], [True, True, False, True])
        self.assertEqual(llm.calls[0]["model"], "m2")
        self.assertEqual(llm.calls[0]["prompt"], "prompt for v2")
        self.assertEqual(self.d.shadow_stats("planner", "v2")["agree_rate"], 0.75)
        with self.assertRaises(LineError):                 # 0.75 < 0.8
            self.d.promote("planner", "v2", run="R1")
        rows += self.d.run_shadow("planner", llm, "p", None, primary, key="plan", run="R1")
        self.assertEqual(self.d.promote("planner", "v2", run="R1")["status"], "canary")
        ev = self.f.store.events_after(0, run="R1", kinds=[AGENT_PROMOTED])
        self.assertEqual((ev[0].body["from"], ev[0].body["to"]), ("shadow", "canary"))
        # a failing shadow never raises
        self.d.register("planner", "v9", "m9")
        out = self.d.run_shadow("planner", FakeLlm({}), "p", None, primary, key="plan", run="R1")
        self.assertEqual((out[0]["ok"], out[0]["code"]), (False, codes.LLM_ERROR))

    def test_canary_to_active_retires_old_and_keeps_pins(self):
        self.d.register("builder", "v1", "m1", status="active")
        self.d.route("builder", "R1")
        self.d.register("builder", "v2", "m2", status="canary")
        for i in range(5):
            self.d.record("builder", "v1", i < 4, run="R0")
        for i in range(4):
            self.d.record("builder", "v2", True, run="R0")
        with self.assertRaises(LineError):                 # 4 < slo_min_sample
            self.d.promote("builder", "v2")
        self.d.record("builder", "v2", True, run="R0")
        row = self.d.promote("builder", "v2", run="R1")
        self.assertEqual((row["status"], row["previous"]), ("active", "v1"))
        self.assertEqual(self.d.get("builder", "v1")["status"], "retired")
        self.assertEqual(self.d.route("builder", "R1")["version"], "v1")   # pinned run keeps its version
        self.assertEqual(self.d.route("builder", "R5")["version"], "v2")
        self.assertEqual(self.d.rollback("builder", run="R1", reason="test")["version"], "v1")
        self.assertEqual(self.d.get("builder", "v2")["status"], "retired")

    def test_inferior_canary_is_not_promoted(self):
        self.d.register("builder", "v1", "m1", status="active")
        self.d.register("builder", "v2", "m2", status="canary")
        for i in range(10):
            self.d.record("builder", "v1", True)
            self.d.record("builder", "v2", i < 8)
        with self.assertRaises(LineError) as cm:
            self.d.promote("builder", "v2")
        self.assertIn("inferior", str(cm.exception))

    def test_slo_breach_alerts_and_rolls_back_a_canary(self):
        self.d.register("builder", "v1", "m1", status="active")
        self.d.register("builder", "v2", "m2", status="canary")
        for i in range(6):
            self.d.record("builder", "v1", True, usd=0.5, latency_ms=1000)
            self.d.record("builder", "v2", i < 2, escalated=i == 5, latency_ms=9000)
        alerts = self.d.check_slo("builder", run="R1")
        self.assertEqual([a["version"] for a in alerts], ["v2"])
        self.assertTrue(any("success_rate" in b for b in alerts[0]["breaches"]))
        self.assertEqual(self.d.get("builder", "v2")["status"], "retired")
        kinds = [e.kind for e in self.f.store.events_after(0, run="R1")]
        self.assertEqual(kinds, [AGENT_SLO_BREACH, AGENT_ROLLBACK])
        # cost and latency limits
        d2 = AgentDirectory(LearnStore(""), cfg(slo_max_usd_per_unit=0.4, slo_max_latency_p95_s=0.5))
        d2.register("builder", "v1", "m1", status="active")
        for _ in range(6):
            d2.record("builder", "v1", True, usd=0.5, latency_ms=1000)
        b = d2.check_slo("builder")[0]["breaches"]
        self.assertEqual(len(b), 2)
        self.assertEqual(d2.get("builder", "v1")["status"], "active")       # active: alert only

    def test_retire_keeps_one_active(self):
        self.d.register("planner", "v1", "m1", status="active")
        with self.assertRaises(LineError):
            self.d.retire("planner", "v1")
        self.d.register("planner", "v2", "m2")
        self.assertEqual(self.d.retire("planner", "v2")["status"], "retired")

    def test_record_call_sink_and_record_run(self):
        st = self.f.store
        self.d.ensure_defaults(("builder", "planner"))
        st.put(E_UNIT, "R1:U1", Unit("U1", "R1", state="failed", attempt=2), run="R1")
        for n, outcome in ((1, "failed"), (2, "failed")):
            a = to_dict(Attempt("U1", n, outcome=outcome, usd=0.3, started_ms=0, ended_ms=2000))
            a["run"] = "R1"
            st.put(E_ATTEMPT, "R1:U1#%d" % n, a, run="R1")
        st.put(E_LLM_CALL, "R1:c1", {"run": "R1", "role": "planner", "key": "plan", "usd": 0.1, "ok": True}, run="R1")
        st.put(E_LLM_CALL, "R1:c2", {"run": "R1", "role": "builder", "key": "U1.1", "usd": 0.3, "ok": True}, run="R1")
        self.assertEqual(self.d.record_run(st, "R1"), 3)
        self.assertEqual(self.d.record_run(st, "R1"), 3)                     # idempotent
        s = self.d.slo("builder", "line-t")
        self.assertEqual((s["n"], s["success_rate"], s["escalation_rate"]), (2, 0.0, 0.5))
        self.assertEqual(self.d.slo("planner", "line-t")["n"], 1)
        self.d.record_call({"role": "planner", "run": "R1", "agent_version": "line-t", "ok": False, "cost": 0.2,
                            "latency_ms": 10})
        self.d.record_call({"role": "nobody", "run": "R1"})
        self.assertEqual(self.d.slo("planner", "line-t")["n"], 2)

    def test_on_run_end(self):
        ctx = types.SimpleNamespace(store=self.f.store, cfg=cfg(agents_enabled=False))
        self.assertEqual(on_run_end(ctx, "R1"), {})
        ctx.cfg = cfg()
        out = on_run_end(ctx, "R1", directory=self.d)
        self.assertNotIn("error", out)
        self.assertEqual(out["samples"], 0)
        self.assertIsNotNone(self.d.active("builder"))


if __name__ == "__main__":
    unittest.main()
