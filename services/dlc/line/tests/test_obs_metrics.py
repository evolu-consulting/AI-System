"""Observability: standard fields, cost per F-item, outcome metrics, GET /api/metrics payload (block 20)."""

from __future__ import annotations

import types
import unittest

from line import codes
from line.codes import LineError
from line.contracts import E_FITEM, E_LLM_CALL, E_RUN, E_UNIT, Envelope, FItem, Run, Unit
from line.observe import (METRICS_SPEC, OBS_FIELDS, SPEC_VERSION, ObservedLlm, annotate, cost_per_f_item,
                          event_obs, handle_metrics, metrics_payload, missing_fields, on_run_end, outcome_metrics,
                          push_metrics, wrap_llm)
from line.tests.fakes import FakeLlm, make_fakes


def env(run, unit="", attempt=0):
    return Envelope(run=run, unit=unit, attempt=attempt, agent_version="line-t", model="m-main")


def build_run(f, run="R1"):
    st, clk = f.store, f.clock
    st.put(E_RUN, run, Run(run, "p", state="green", created_ms=clk.now_ms()), run=run)
    for fid, size in (("F1", "S"), ("F2", "M"), ("F3", "L")):
        st.put(E_FITEM, "%s:%s" % (run, fid), FItem(fid, fid, size=size), run=run)
    st.put(E_UNIT, "%s:U1" % run, Unit("U1", run, state="merged", attempt=1, f_items=["F1"]), run=run)
    st.put(E_UNIT, "%s:U2" % run, Unit("U2", run, state="merged", attempt=3, f_items=["F2", "F3"]), run=run)
    st.put(E_UNIT, "%s:U3" % run, Unit("U3", run, state="failed", attempt=2, f_items=["F3"]), run=run)
    st.put(E_UNIT, "%s:FX" % run, Unit("FX", run, state="merged", attempt=1, f_items=["F3"], fixer_gen=1), run=run)
    for i, (role, key, usd) in enumerate([("builder", "U1.1", 1.0), ("builder", "U2.2", 2.0), ("test_author", "F2", 0.5),
                                          ("planner", "plan", 0.7), ("reader_a", "A", 0.0)]):
        st.put(E_LLM_CALL, "%s:c%d" % (run, i), {"run": run, "role": role, "key": key, "usd": usd, "ok": True}, run=run)
    st.emit(codes.RUN_ADMITTED, env(run))
    clk.advance(10)
    st.emit(codes.SPEC_FROZEN, env(run))
    clk.advance(100)
    st.emit(codes.QAS_RESULT, env(run), {"f_item": "F1", "verdict": "green"})
    st.emit(codes.QAS_RESULT, env(run), {"f_item": "F2", "verdict": "flaky"})
    st.emit(codes.QAS_RESULT, env(run), {"f_item": "F3", "verdict": "red"})
    clk.advance(50)
    st.emit(codes.QAS_RESULT, env(run), {"f_item": "F1", "verdict": "green"})
    st.emit(codes.QAS_RESULT, env(run), {"f_item": "F2", "verdict": "green"})
    st.emit(codes.QAS_RESULT, env(run), {"f_item": "F3", "verdict": "green"})
    clk.advance(5)
    st.emit(codes.RUN_GREEN, env(run), {"usd": 4.2})


class CostTests(unittest.TestCase):
    def test_cost_attribution(self):
        f = make_fakes()
        build_run(f)
        c = cost_per_f_item(f.store, "R1")
        fi = c["f_items"]
        self.assertAlmostEqual(c["usd"], 4.2)
        self.assertAlmostEqual(fi["F1"]["usd_direct"], 1.0)
        self.assertAlmostEqual(fi["F2"]["usd_direct"], 1.0 + 0.5)        # half of U2 + test author
        self.assertAlmostEqual(fi["F3"]["usd_direct"], 1.0)
        self.assertAlmostEqual(c["shared"], 0.7)                         # planner + reader
        self.assertAlmostEqual(fi["F1"]["usd_shared"], 0.1)              # weights S1 M2 L4
        self.assertAlmostEqual(fi["F3"]["usd_shared"], 0.4)
        self.assertAlmostEqual(sum(v["usd"] for v in fi.values()), 4.2)
        self.assertEqual(c["calls_by_role"]["builder"], 2)
        self.assertAlmostEqual(fi["F2"]["by_role"]["test_author"], 0.5)

    def test_no_f_items_means_unattributed(self):
        f = make_fakes()
        f.store.put(E_LLM_CALL, "x", {"run": "R9", "role": "planner", "key": "plan", "usd": 0.3}, run="R9")
        c = cost_per_f_item(f.store, "R9")
        self.assertAlmostEqual(c["unattributed"], 0.3)


class OutcomeTests(unittest.TestCase):
    def test_outcome_metrics(self):
        f = make_fakes()
        build_run(f)
        m = outcome_metrics(f.store, "R1")
        self.assertEqual(m["lead_time_ms"], 165_000)
        self.assertEqual(m["f_items"]["F1"]["lead_time_ms"], 100_000)     # first green, never red after
        self.assertEqual(m["f_items"]["F3"]["lead_time_ms"], 150_000)     # green after the red
        self.assertEqual(m["f_items"]["F2"]["lead_time_ms"], 150_000)
        self.assertEqual(m["first_pass_yield"], round(1 / 3, 4))          # U1 of U1, U2, U3 (fixer excluded)
        self.assertEqual(m["escalation_rate"], 0.25)
        self.assertEqual(m["rework_count"], 2 + 1 + 1)                    # U2 +2, U3 +1, one fixer unit
        self.assertEqual(m["qas_flaky_rate"], round(1 / 6, 4))
        self.assertEqual(m["qas_first_green_rate"], round(1 / 3, 4))
        self.assertEqual(m["f_items"]["F3"]["rework"], 2 + 1 + 1)
        self.assertTrue(m["final"])

    def test_payload_handle_and_push(self):
        f = make_fakes()
        build_run(f, "R1")
        f.clock.advance(1)
        build_run(f, "R2")
        p = metrics_payload(f.store, now=5)
        self.assertEqual(p["spec"], SPEC_VERSION)
        self.assertEqual([r["run"] for r in p["runs"]], ["R2", "R1"])
        self.assertEqual(p["totals"]["runs"], 2)
        self.assertEqual(p["totals"]["green"], 2)
        self.assertAlmostEqual(p["totals"]["usd"], 8.4)
        self.assertEqual(p["totals"]["first_pass_yield"], round(2 / 6, 4))
        self.assertNotIn("_counts", p["runs"][0])
        for k in METRICS_SPEC["response"]["runs"][0]:
            self.assertIn(k, p["runs"][0])
        for k in METRICS_SPEC["response"]["totals"]:
            self.assertIn(k, p["totals"])
        code, one = handle_metrics(f.store, {"run": ["R1"]})
        self.assertEqual((code, [r["run"] for r in one["runs"]]), (200, ["R1"]))
        self.assertEqual(handle_metrics(f.store, {"limit": "1"})[1]["totals"]["runs"], 1)
        self.assertEqual(handle_metrics(f.store, {"run": "nope"})[1]["runs"], [])
        sent = push_metrics(f.rag, one)
        self.assertEqual(sent, len(f.rag.metrics))
        names = {n for n, _, _ in f.rag.metrics}
        self.assertTrue({"line.first_pass_yield", "line.f_item.usd", "line.f_item.lead_time_ms"} <= names)
        self.assertTrue(all(d["run"] == "R1" for _, _, d in f.rag.metrics))
        f.rag.down = True
        self.assertEqual(push_metrics(f.rag, one), 0)
        self.assertEqual(push_metrics(None, one), 0)

    def test_on_run_end_flag(self):
        f = make_fakes()
        build_run(f)
        ctx = types.SimpleNamespace(store=f.store, rag=f.rag, cfg=types.SimpleNamespace(obs_enabled=False))
        self.assertEqual(on_run_end(ctx, "R1"), {})
        ctx.cfg.obs_enabled = True
        out = on_run_end(ctx, "R1")
        self.assertEqual(out["runs"][0]["run"], "R1")
        self.assertGreater(out["pushed"], 0)


class FieldTests(unittest.TestCase):
    def test_annotate_and_event_obs(self):
        body = annotate({"code": "X"}, run="R1", unit="U1", role="builder", model="m", cost=0.25)
        self.assertEqual(missing_fields(body["obs"]), [])
        self.assertEqual(set(body["obs"]), set(OBS_FIELDS))
        f = make_fakes()
        build_run(f)
        units = {u["id"]: u for u in f.store.query(E_UNIT, run="R1")}
        seq = f.store.emit(codes.UNIT_DISPATCHED, env("R1", "U1", 1), {"usd": 0.1})
        ev = f.store.events_after(seq - 1, run="R1")[0]
        o = event_obs(ev, units)
        self.assertEqual((o["run"], o["unit"], o["f_item"], o["role"], o["model"], o["agent_version"], o["cost"]),
                         ("R1", "U1", "F1", "builder", "m-main", "line-t", 0.1))
        self.assertTrue(o["prompt_version"])
        fx = f.store.emit(codes.UNIT_DISPATCHED, env("R1", "FX", 1), annotate({}, run="R1", role="custom"))
        self.assertEqual(event_obs(f.store.events_after(fx - 1, run="R1")[0], units)["role"], "custom")

    def test_observed_llm(self):
        rows = []
        llm = FakeLlm({"planner": [{"units": []}], "builder": ["SUBMIT"]}, usd_per_call=0.2)
        clock = iter([0.0, 1.5, 2.0, 2.25, 3.0, 3.0])
        o = ObservedLlm(llm, rows, run="R1", agent_version="line-t", clock=lambda: next(clock))
        o.complete("planner", "p", key="plan")
        o.bind(f_item="F2").agentic("builder", "", "p", 5, 1.0, key="U3.2")
        with self.assertRaises(LineError):
            o.complete("reader_a", "p", key="A")
        self.assertEqual([r["role"] for r in rows], ["planner", "builder", "reader_a"])
        self.assertEqual(rows[0]["latency_ms"], 1500)
        self.assertEqual(rows[0]["cost"], 0.2)
        self.assertEqual((rows[1]["unit"], rows[1]["f_item"]), ("U3", "F2"))
        self.assertEqual((rows[2]["ok"], rows[2]["code"]), (False, codes.LLM_ERROR))
        self.assertTrue(rows[0]["prompt_version"])
        for r in rows:
            self.assertEqual(missing_fields(r), [])
        self.assertIs(wrap_llm(llm, types.SimpleNamespace(obs_enabled=False)), llm)
        self.assertIsInstance(wrap_llm(llm, types.SimpleNamespace(obs_enabled=True, agent_version="v")), ObservedLlm)


if __name__ == "__main__":
    unittest.main()
