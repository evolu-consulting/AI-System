"""Wave-0 contract tests: closed lists, state tables, config defaults, fakes satisfy the ports."""

import os
import tempfile
import threading
import json
import unittest

from line import codes, config
from line.codes import LineError
from line.contracts import (
    ENTITIES, RUN_TRANSITIONS, SIZE_WEIGHTS, TERMINAL_RUN_STATES, TERMINAL_UNIT_STATES, UNIT_TRANSITIONS,
    AccTest, Budget, Clock, Criterion, Digest, Envelope, Fact, FItem, Gate, Graph, Lease, LeaseManager,
    LlmPort, LlmResult, RagCapabilities, RagPort, Run, RunState, Span, Store, Unit, UnitState,
    can_transition, from_dict, to_dict, unit_lease_name,
)
from line.tests.fakes import FakeLlm, make_fakes

PLAN_CODES = [
    "SPEC_MISSING_FILE", "QUOTE_UNMATCHED", "READ_DIVERGED", "TEST_GREEN_ON_EMPTY", "TEST_UNTRACED",
    "GRAPH_CYCLE", "UNIT_TOO_BIG", "CLAIM_VIOLATION", "TEST_TAMPER", "BUILD_FAIL", "TEST_FAIL",
    "NO_PROGRESS", "BUDGET_EXCEEDED", "LEASE_LOST", "MERGE_CONFLICT", "SMOKE_FAIL", "QAS_RED", "FLAKY",
    "SECRET_FOUND", "RAG_DEGRADED",
]
PLAN_KINDS = [
    "run.admitted", "spec.frozen", "digest.done", "reconcile.diverged", "tests.approved", "graph.valid",
    "unit.dispatched", "unit.submitted", "verify.failed", "unit.merged", "deploy.done", "qas.result",
    "run.green", "escalated",
]


def env(run="R1", unit="", epoch=0):
    return {"run": run, "unit": unit, "attempt": 0, "epoch": epoch, "agent_version": "t", "model": "m",
            "spec_hash": "h"}


class CodesTest(unittest.TestCase):
    def test_gate_codes_are_the_plan_list(self):
        self.assertEqual(list(codes.GATE_CODES), PLAN_CODES)

    def test_kinds_include_plan_list(self):
        self.assertEqual(list(codes.CORE_KINDS), PLAN_KINDS)
        self.assertTrue(set(PLAN_KINDS) <= codes.EVENT_KINDS)
        self.assertFalse(set(codes.CORE_KINDS) & set(codes.AUX_KINDS))

    def test_closed(self):
        self.assertFalse(set(codes.GATE_CODES) & set(codes.SYSTEM_CODES))
        with self.assertRaises(ValueError):
            LineError("NOT_A_CODE", "x")
        e = LineError(codes.TEST_FAIL, "boom", {"a": 1})
        self.assertEqual(e.to_dict(), {"code": "TEST_FAIL", "message": "boom", "detail": {"a": 1}})
        with self.assertRaises(ValueError):
            Gate.fail("NOPE")


class TransitionTableTest(unittest.TestCase):
    def test_tables_cover_all_states(self):
        self.assertEqual(set(RUN_TRANSITIONS), {s.value for s in RunState})
        self.assertEqual(set(UNIT_TRANSITIONS), {s.value for s in UnitState})
        for table in (RUN_TRANSITIONS, UNIT_TRANSITIONS):
            for frm, tos in table.items():
                self.assertTrue(tos <= set(table), frm)
                self.assertNotIn(frm, tos, "no self loops")

    def test_terminals(self):
        for s in TERMINAL_RUN_STATES:
            self.assertEqual(RUN_TRANSITIONS[s], frozenset())
        for s in TERMINAL_UNIT_STATES:
            self.assertEqual(UNIT_TRANSITIONS[s], frozenset())
        for s, tos in RUN_TRANSITIONS.items():
            if s not in TERMINAL_RUN_STATES:
                self.assertIn("escalated", tos)
        for s, tos in UNIT_TRANSITIONS.items():
            if s not in TERMINAL_UNIT_STATES:
                self.assertIn("failed", tos)

    def test_happy_paths_reachable(self):
        run = ["admitted", "understanding", "planning", "building", "integrating", "qas", "green"]
        unit = ["pending", "ready", "leased", "submitted", "verified", "merged"]
        for a, b in zip(run, run[1:]):
            self.assertTrue(can_transition("run", a, b), (a, b))
        for a, b in zip(unit, unit[1:]):
            self.assertTrue(can_transition("unit", a, b), (a, b))
        self.assertTrue(can_transition("unit", UnitState.LEASED, UnitState.READY))  # lease expiry
        self.assertFalse(can_transition("unit", "pending", "merged"))
        self.assertFalse(can_transition("run", "green", "building"))
        self.assertFalse(can_transition("nope", "a", "b"))

    def test_size_weights(self):
        self.assertEqual(SIZE_WEIGHTS, {"S": 1, "M": 2, "L": 4})


class DataclassTest(unittest.TestCase):
    def test_envelope_strict(self):
        Envelope.parse(env())
        bad = env()
        del bad["spec_hash"]
        with self.assertRaises(LineError) as cm:
            Envelope.parse(bad)
        self.assertEqual(cm.exception.code, codes.ENVELOPE_INVALID)
        with self.assertRaises(LineError):
            Envelope.parse(dict(env(), run=""))
        with self.assertRaises(LineError):
            Envelope.parse(dict(env(), epoch=-1))

    def test_roundtrip(self):
        fi = FItem("F2", "done/remove", ["spec.md#L3-9"], "q",
                   [Criterion("F2.C1", "F2", "unknown id exits 1", "spec.md#L3-9", "exit 1")], "S")
        d = Digest("pv1", "A", [fi], [Fact("r", "spec.md#L3-9", "q")], [Fact("n", "s#L1-1", "1", "1")])
        back = from_dict(Digest, to_dict(d))
        self.assertEqual(back, d)
        g = Graph("R1", [Unit("U1", "R1", claims=["a.py"], state=UnitState.READY.value)], [["U1"]], ["U1"])
        self.assertEqual(from_dict(Graph, json.loads(json.dumps(to_dict(g)))), g)
        self.assertEqual(to_dict(Gate.fail(codes.TEST_FAIL, "fp", test="t"))["code"], "TEST_FAIL")
        self.assertTrue(Gate.passed().ok)
        self.assertEqual(unit_lease_name("U1"), "unit:U1")


class ConfigTest(unittest.TestCase):
    def test_defaults(self):
        c = config.load_config(env={}, line_json=None, rag_local_json=None)
        self.assertEqual(c.port, 8796)
        self.assertEqual(c.llm, "fake")
        self.assertEqual(c.model, "claude-opus-5-5")
        self.assertEqual(c.rag, "off")
        self.assertEqual(c.deploy_windows, [])
        self.assertEqual((c.lease_ttl_s, c.heartbeat_s, c.retry_n, c.unit_max_files, c.reread_max,
                          c.fixer_generations), (300, 60, 3, 8, 2, 2))

    def test_tracked_file_loads(self):
        c = config.load_config(env={})
        self.assertEqual(c.port, 8796)

    def test_env_and_files(self):
        with tempfile.TemporaryDirectory() as d:
            lj, rj = os.path.join(d, "line.json"), os.path.join(d, "rag.local.json")
            with open(lj, "w") as f:
                json.dump({"port": 9000, "deploy_windows": ["01:00-02:00"], "rag_client_secret": "nope"}, f)
            with open(rj, "w") as f:
                json.dump({"rag_ns": "ns2", "client_header": "X-Client", "rag_client_id": "nope"}, f)
            c = config.load_config(env={"LINE_PORT": "9100", "LINE_MAX_USD_RUN": "2.5",
                                        "LINE_RAG_CLIENT_SECRET": "s3", "LINE_DEPLOY_WINDOWS": ""},
                                   line_json=lj, rag_local_json=rj)
        self.assertEqual(c.port, 9100)
        self.assertEqual(c.max_usd_run, 2.5)
        self.assertEqual(c.deploy_windows, ["01:00-02:00"])
        self.assertEqual(c.rag_ns, "ns2")
        self.assertEqual(c.rag_extra, {"client_header": "X-Client"})
        self.assertEqual(c.rag_client_id, "")
        self.assertEqual(c.rag_client_secret, "s3")
        self.assertEqual(c.public()["rag_client_secret"], "***")

    def test_invalid(self):
        for e in ({"LINE_LLM": "gpt"}, {"LINE_RAG": "x"}, {"LINE_PORT": "abc"}):
            with self.assertRaises(LineError) as cm:
                config.load_config(env=e, line_json=None, rag_local_json=None)
            self.assertEqual(cm.exception.code, codes.CONFIG_INVALID)

    def test_gitignore(self):
        with open(os.path.join(config.LINE_DIR, ".gitignore")) as f:
            lines = f.read().split()
        for item in ("config/rag.local.json", "line.db", "work/"):
            self.assertIn(item, lines)


class FakesSatisfyPortsTest(unittest.TestCase):
    def setUp(self):
        self.f = make_fakes()

    def test_protocols(self):
        f = self.f
        self.assertIsInstance(f.clock, Clock)
        self.assertIsInstance(f.store, Store)
        self.assertIsInstance(f.budget, Budget)
        self.assertIsInstance(f.leases, LeaseManager)
        self.assertIsInstance(f.rag, RagPort)
        self.assertIsInstance(f.llm, LlmPort)

    def test_store_events_and_fencing(self):
        s, f = self.f.store, self.f
        self.assertEqual(s.emit(codes.RUN_ADMITTED, env(), {"pack": "p"}), 1)
        with self.assertRaises(LineError) as cm:
            s.emit("bogus", env())
        self.assertEqual(cm.exception.code, codes.UNKNOWN_KIND)
        lease = f.leases.acquire(unit_lease_name("U1"), "b1")
        self.assertEqual(s.emit(codes.UNIT_SUBMITTED, env(unit="U1", epoch=lease.epoch)), 2)
        f.clock.advance(301)
        self.assertEqual(f.leases.expired()[0].epoch, 1)
        l2 = f.leases.acquire(unit_lease_name("U1"), "b2")
        self.assertEqual(l2.epoch, 2)
        with self.assertRaises(LineError) as cm:
            s.emit(codes.UNIT_SUBMITTED, env(unit="U1", epoch=1))
        self.assertEqual(cm.exception.code, codes.LEASE_LOST)
        self.assertEqual([e.seq for e in s.events_after(0)], [1, 2])
        self.assertEqual(len(s.unsynced()), 2)
        s.mark_synced([1])
        self.assertEqual([e.seq for e in s.unsynced()], [2])

    def test_store_transition_cas(self):
        s = self.f.store
        s.put("unit", "U1", Unit("U1", "R1"), run="R1")
        s.transition("unit", "U1", UnitState.READY, UnitState.PENDING)
        with self.assertRaises(LineError) as cm:
            s.transition("unit", "U1", "leased", "pending")
        self.assertEqual(cm.exception.code, codes.STATE_CONFLICT)
        with self.assertRaises(LineError) as cm:
            s.transition("unit", "U1", "merged", ["ready"])
        self.assertEqual(cm.exception.code, codes.ILLEGAL_TRANSITION)
        self.assertEqual(s.get("unit", "U1")["state"], "ready")
        self.assertEqual(s.query("unit", run="R1", state="ready")[0]["id"], "U1")
        with self.assertRaises(LineError):
            s.put("unit", "U1", {"id": "U1", "state": "x"}, if_version=1)
        self.assertEqual(set(ENTITIES) >= {"run", "unit"}, True)

    def test_lease_race_one_winner(self):
        wins = []
        barrier = threading.Barrier(6)

        def go(i):
            barrier.wait()
            if self.f.leases.acquire("unit:U9", "w%d" % i):
                wins.append(i)
        ts = [threading.Thread(target=go, args=(i,)) for i in range(6)]
        [t.start() for t in ts]
        [t.join() for t in ts]
        self.assertEqual(len(wins), 1)

    def test_budget(self):
        b = self.f.budget
        b.open("R1", 1.0)
        b.split("R1", "R1", {"F1": 1, "F2": 3})
        b.split("R1", "F1", {"U1": SIZE_WEIGHTS["S"]})
        r = b.reserve("R1", "U1", 0.2)
        st = b.charge("R1", "U1", 0.21, r)
        self.assertTrue(st.warn)
        with self.assertRaises(LineError) as cm:
            b.reserve("R1", "U1", 0.1)
        self.assertEqual(cm.exception.code, codes.BUDGET_EXCEEDED)
        self.assertAlmostEqual(b.remaining("R1"), 0.79)

    def test_outbox(self):
        s = self.f.store
        a = s.outbox_push("put_record", {"type": "t"}, "k1")
        s.outbox_push("metric", {"name": "n"}, "k2")
        self.assertEqual([i.idem_key for i in s.outbox_peek()], ["k1", "k2"])
        s.outbox_ack(a)
        self.assertEqual([i.idem_key for i in s.outbox_peek()], ["k2"])

    def test_rag_outage_and_records(self):
        r = self.f.rag
        self.assertTrue(r.capabilities().has("events"))
        res = r.append_events([{"kind": "run.admitted"}], "idem-1")
        self.assertEqual(r.append_events([{"kind": "run.admitted"}], "idem-1"), res)
        self.assertEqual(len(r.events_after(0)), 1)
        etag = r.put_record("unit", "U1", {"a": 1})
        with self.assertRaises(LineError) as cm:
            r.put_record("unit", "U1", {"a": 2})
        self.assertEqual(cm.exception.code, codes.PRECONDITION_REQUIRED)
        with self.assertRaises(LineError) as cm:
            r.put_record("unit", "U1", {"a": 2}, if_match="bad")
        self.assertEqual(cm.exception.code, codes.VERSION_CONFLICT)
        r.put_record("unit", "U1", {"a": 2}, if_match=etag)
        ver = r.freeze_pack({"spec.md": "# T\nline two\nexit 1 on unknown id\n"})
        sp = r.quote("spec.md", "exit 1 on unknown id", ver)
        self.assertIsInstance(sp, Span)
        self.assertEqual(sp.id, "spec.md#L3-3")
        self.assertIsNone(r.quote("spec.md", "invented"))
        r.down = True
        with self.assertRaises(LineError) as cm:
            r.retrieve("builder", "U1", [], 100)
        self.assertEqual(cm.exception.code, codes.RAG_DEGRADED)
        r.down = False
        r.missing.add("retrieve")
        self.assertFalse(r.capabilities().retrieve)
        with self.assertRaises(LineError):
            r.retrieve("builder", "U1", [], 100)
        self.assertIsInstance(r.capabilities(), RagCapabilities)

    def test_llm_scripted(self):
        llm = FakeLlm({("reader", "A"): [{"f_items": []}, {"f_items": [1]}], "builder": "BLOCKED:need api"},
                      usd_per_call=0.5, max_usd_run=1.2)
        r1 = llm.complete("reader", "p", {"required": ["f_items"]}, key="A", run="R1")
        self.assertIsInstance(r1, LlmResult)
        self.assertEqual(r1.data, {"f_items": []})
        self.assertEqual(llm.complete("reader", "p", key="A", run="R1").data, {"f_items": [1]})
        with self.assertRaises(LineError) as cm:
            llm.complete("reader", "p", key="A", run="R1")
        self.assertEqual(cm.exception.code, codes.BUDGET_EXCEEDED)
        with tempfile.TemporaryDirectory() as d:
            res = llm.agentic("builder", d, "go", 10, 1.0, run="R2")
            self.assertEqual(res.outcome, "BLOCKED:need api")
            llm.add("builder", {"outcome": "SUBMIT", "files": {"pkg/a.py": "x = 1\n"}}, key="U1")
            res = llm.agentic("builder", d, "go", 10, 1.0, key="U1", run="R3")
            self.assertEqual(res.outcome, "SUBMIT")
            self.assertTrue(os.path.isfile(os.path.join(d, "pkg", "a.py")))
        with self.assertRaises(LineError) as cm:
            llm.complete("reader", "p", {"required": ["x"]}, key="A", run="R9")
        self.assertEqual(cm.exception.code, codes.SCHEMA_INVALID)
        with self.assertRaises(LineError) as cm:
            llm.complete("nobody", "p")
        self.assertEqual(cm.exception.code, codes.LLM_ERROR)


class HardRuleTest(unittest.TestCase):
    """The line names the external retrieval service only as 'RAG System'."""

    def test_no_foreign_product_names(self):
        banned = [b"Knowledge" + b" Hub", b"stage" + b" F", b"Stage" + b" F"]
        short = b"K" + b"H"
        import re
        rx = re.compile(rb"(?<![A-Za-z0-9])" + short + rb"(?![A-Za-z0-9])")
        for root, dirs, files in os.walk(config.LINE_DIR):
            dirs[:] = [d for d in dirs if d not in ("__pycache__", "work")]
            for n in files:
                if not n.endswith((".py", ".md", ".json", ".html", ".sql", ".txt", ".gitignore")):
                    continue
                with open(os.path.join(root, n), "rb") as fh:
                    data = fh.read()
                for b in banned:
                    self.assertNotIn(b, data, os.path.join(root, n))
                self.assertIsNone(rx.search(data), os.path.join(root, n))


if __name__ == "__main__":
    unittest.main()
