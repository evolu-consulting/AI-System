"""Line server routes: JSON shapes on an ephemeral port, driver hook, board page."""

from __future__ import annotations

import json
import unittest
import urllib.error
import urllib.request

from line import codes
from line.codes import LineError
from line.config import load_config
from line.contracts import (
    E_DEPLOY, E_FITEM, E_GATE, E_LLM_CALL, E_QAS, E_RUN, E_UNIT, Envelope, FItem, Gate, Run, Unit, to_dict,
)
from line.server import F_LANES, LineServer
from line.tests.fakes import make_fakes


def env(run="R1", unit=""):
    return Envelope(run=run, unit=unit, agent_version="t", spec_hash="h1")


def seed(f):
    s = f.store
    s.put(E_RUN, "R1", Run("R1", "packs/todo", state="qas", spec_hash="h1", budget_usd=5.0, created_ms=1), run="R1")
    s.put(E_RUN, "R2", Run("R2", "packs/other", state="building", created_ms=2), run="R2")
    s.put(E_FITEM, "F1", FItem("F1", "add and list"), run="R1")
    s.put(E_FITEM, "F2", FItem("F2", "done and remove"), run="R1")
    s.put(E_UNIT, "U1", Unit("U1", "R1", "storage", state="merged", wave=1, f_items=["F1"]), run="R1")
    s.put(E_UNIT, "U2", Unit("U2", "R1", "done", state="leased", wave=2, f_items=["F2"], attempt=1), run="R1")
    s.put(E_GATE, "R1:U1:verify:1", {"id": "R1:U1:verify:1", "run": "R1", "gate": to_dict(Gate.passed()),
                                     "unit": "U1", "attempt": 1, "name": "verify"}, run="R1")
    s.put(E_GATE, "R1:U2:verify:1", {"id": "R1:U2:verify:1", "run": "R1",
                                     "gate": to_dict(Gate.fail(codes.TEST_FAIL, "fp1")),
                                     "unit": "U2", "attempt": 1, "name": "verify"}, run="R1")
    s.put(E_LLM_CALL, "c1", {"run": "R1", "role": "builder", "usd": 0.25}, run="R1")
    s.put(E_QAS, "R1:F1", {"id": "R1:F1", "run": "R1", "f_item": "F1", "runs": [True] * 3, "verdict": "green"}, run="R1")
    s.put(E_DEPLOY, "R1:blue", {"id": "R1:blue", "run": "R1", "color": "blue", "sha": "abc", "state": "live",
                                "ts_ms": 5}, run="R1")
    s.emit(codes.RUN_ADMITTED, env(), {"pack": "packs/todo"})
    s.emit(codes.RUN_ADMITTED, env("R2"), {"pack": "packs/other"})
    s.emit(codes.UNIT_MERGED, env(unit="U1"), {"sha": "abc"})
    s.emit(codes.DEPLOY_DONE, env(), {"ok": True, "color": "blue"})


class ServerRoutesTest(unittest.TestCase):
    def setUp(self):
        self.f = make_fakes()
        seed(self.f)
        self.calls = []
        self.cfg = load_config(env={}, line_json=None, rag_local_json=None)
        self.srv = None

    def tearDown(self):
        if self.srv:
            self.srv.stop()

    def start(self, driver=None, budget=None):
        self.srv = LineServer(self.f.store, self.cfg, driver=driver, budget=budget, host="127.0.0.1", port=0).start()
        return self.srv

    def req(self, path, body=None):
        data = json.dumps(body).encode() if body is not None else None
        r = urllib.request.Request(self.srv.url + path, data=data, method="POST" if data is not None else "GET",
                                   headers={"Content-Type": "application/json"})
        try:
            with urllib.request.urlopen(r, timeout=5) as resp:
                raw = resp.read()
                ctype = resp.headers.get("Content-Type", "")
                return resp.status, (json.loads(raw) if "json" in ctype else raw.decode("utf-8"))
        except urllib.error.HTTPError as e:
            return e.code, json.loads(e.read())

    def test_health_and_runs(self):
        self.start()
        self.assertNotEqual(self.srv.port, 0)
        st, h = self.req("/api/health")
        self.assertEqual(st, 200)
        self.assertTrue(h["ok"])
        self.assertEqual(h["last_seq"], 4)
        self.assertFalse(h["driver"])
        st, r = self.req("/api/runs")
        self.assertEqual([x["id"] for x in r["runs"]], ["R2", "R1"])   # newest first
        r1 = r["runs"][1]
        self.assertEqual(r1["unit_states"], {"merged": 1, "leased": 1})
        for k in ("id", "state", "pack_path", "spec_hash", "created_ms", "units"):
            self.assertIn(k, r1)

    def test_urgent_stop_needs_the_typed_confirmation(self):
        calls = []
        self.start(driver=lambda action, payload: calls.append((action, payload)) or {"paused": ["R1"], "stopping": []})
        for wrong in ({}, {"confirm": "yes"}, {"confirm": "agree force"}, {"confirm": "Agree Force Stop"}):
            st, e = self.req("/api/runs:pause_all", wrong)
            self.assertEqual((st, e["code"]), (400, codes.SCHEMA_INVALID), wrong)
        self.assertEqual(calls, [])                                       # nothing was stopped
        st, out = self.req("/api/runs:pause_all", {"confirm": "  agree  force stop "})
        self.assertEqual((st, out["paused"]), (200, ["R1"]))
        self.assertEqual(calls[0][0], "pause_all")

    def test_retry_reopens_the_same_run_and_resumes_it(self):
        import os
        import tempfile
        pack = tempfile.mkdtemp(prefix="retry-pack-")
        with open(os.path.join(pack, "spec.md"), "w", encoding="utf-8") as fh:
            fh.write("# Bug\n")
        self.f.store.put(E_RUN, "R9", Run("R9", pack, state="escalated", budget_usd=6.0, detail={
            "escalation": {"code": codes.SMOKE_FAIL, "message": "smoke", "from": "qas"}}), run="R9")
        calls = []
        self.start(driver=lambda action, payload: calls.append((action, payload)) or {"run": payload["run"],
                                                                                       "state": "qas", "resuming": True})
        st, out = self.req("/api/runs/R9:retry", {"hint": "the engine was fixed"})
        self.assertEqual((st, out["run"], out["attempt"]), (202, "R9", 2))
        self.assertEqual([(a, p["run"]) for a, p in calls], [("resume", "R9")])     # the same run, no "start"
        row = self.f.store.get(E_RUN, "R9")
        self.assertEqual((row["state"], row["detail"]["attempts"][0]["hint"]), ("qas", "the engine was fixed"))
        st, e = self.req("/api/runs/R9:retry", {})
        self.assertEqual((st, e["code"]), (409, codes.STATE_CONFLICT))           # not failed any more

    def test_run_detail(self):
        self.start()
        st, d = self.req("/api/runs/R1")
        self.assertEqual(st, 200)
        self.assertEqual(set(d) >= {"run", "units", "gates", "budget"}, True)
        self.assertEqual([u["id"] for u in d["units"]], ["U1", "U2"])
        self.assertEqual({g["code"] for g in d["gates"]}, {"", codes.TEST_FAIL})
        self.assertEqual(d["budget"]["limit"], 5.0)
        self.assertAlmostEqual(d["budget"]["spent"], 0.25)
        st, e = self.req("/api/runs/NOPE")
        self.assertEqual((st, e["code"]), (404, codes.NOT_FOUND))

    def test_run_detail_uses_budget_tree(self):
        self.f.budget.open("R1", 4.0)
        self.f.budget.charge("R1", "R1", 1.0)
        self.start(budget=self.f.budget)
        _, d = self.req("/api/runs/R1")
        self.assertEqual((d["budget"]["limit"], d["budget"]["spent"], d["budget"]["source"]), (4.0, 1.0, "budget"))

    def test_events_after_seq(self):
        self.start()
        st, e = self.req("/api/runs/R1/events?after_seq=0")
        self.assertEqual(st, 200)
        self.assertEqual([x["seq"] for x in e["events"]], [1, 3, 4])
        ev = e["events"][1]
        self.assertEqual((ev["kind"], ev["env"]["unit"], ev["body"]["sha"]), (codes.UNIT_MERGED, "U1", "abc"))
        _, e = self.req("/api/runs/R1/events?after_seq=3")
        self.assertEqual([x["seq"] for x in e["events"]], [4])
        self.assertEqual(e["last_seq"], 4)

    def test_board(self):
        self.start()
        st, b = self.req("/api/board?run=R1")
        self.assertEqual(st, 200)
        for k in ("runs", "run", "lanes", "units", "gates", "events", "deploy", "qas", "budget"):
            self.assertIn(k, b)
        self.assertEqual(b["run"]["id"], "R1")
        self.assertEqual(b["lanes"]["columns"], F_LANES)
        lanes = {r["f_item"]: r for r in b["lanes"]["rows"]}
        self.assertEqual((lanes["F1"]["state"], lanes["F2"]["state"]), ("green", "building"))
        self.assertEqual(lanes["F1"]["title"], "add and list")
        self.assertEqual(lanes["F2"]["units"], [{"id": "U2", "state": "leased"}])
        self.assertEqual([e["seq"] for e in b["events"]], [1, 3, 4])
        _, b2 = self.req("/api/board")            # default: newest run
        self.assertEqual(b2["run"]["id"], "R2")

    def test_board_empty_store(self):
        self.f = make_fakes()
        self.start()
        st, b = self.req("/api/board")
        self.assertEqual(st, 200)
        self.assertIsNone(b["run"])
        self.assertEqual(b["runs"], [])

    def test_post_without_driver_is_501(self):
        self.start()
        st, e = self.req("/api/runs", {"pack": "packs/todo"})
        self.assertEqual(st, 501)
        st, e = self.req("/api/runs/R1:cancel", {})
        self.assertEqual(st, 501)

    def test_post_calls_driver(self):
        def driver(action, payload):
            self.calls.append((action, payload))
            if action == "cancel" and payload["run"] == "NOPE":
                raise LineError(codes.NOT_FOUND, "run NOPE")
            return {"run": "R9"} if action == "start" else {"cancelled": payload["run"]}

        self.start(driver)
        st, r = self.req("/api/runs", {"pack": "packs/todo"})
        self.assertEqual((st, r), (202, {"run": "R9"}))
        st, r = self.req("/api/runs/R1:cancel", {"reason": "test"})
        self.assertEqual((st, r), (200, {"cancelled": "R1"}))
        self.assertEqual(self.calls, [("start", {"pack": "packs/todo"}), ("cancel", {"run": "R1", "reason": "test"})])
        st, r = self.req("/api/runs/NOPE:cancel", {})
        self.assertEqual((st, r["code"]), (404, codes.NOT_FOUND))
        st, r = self.req("/api/runs", {})
        self.assertEqual(st, 400)

    def test_gate_decision_resumes_and_docs_convert(self):
        import base64
        from line.statemachine import update_row
        from line.tests.test_docread import make_docx, para
        update_row(self.f.store, E_RUN, "R2", {"detail": {"gate": {"name": "spec", "round": 1, "step": 5},
                                                         "gated": {"on": True, "spec": {"doc": "# Spec: x"}}}})
        self.start(driver=lambda action, payload: self.calls.append((action, payload)) or {"run": payload.get("run")})
        st, a = self.req("/api/runs/R2/attention")
        self.assertEqual((st, a["kind"], a["gate"]["docs"][0]["text"]), (200, "gate", "# Spec: x"))
        st, out = self.req("/api/runs/R2/gates/plan", {"decision": "approve"})
        self.assertEqual(st, 409)                                    # not the open gate
        st, out = self.req("/api/runs/R2/gates/spec", {"decision": "maybe"})
        self.assertEqual(st, 400)
        st, out = self.req("/api/runs/R2/gates/spec", {"decision": "approve", "who": "ann"})
        self.assertEqual((st, out["decision"]), (200, "approve"))
        self.assertEqual(self.calls[-1], ("resume", {"run": "R2"}))
        self.assertEqual(self.f.store.get(E_RUN, "R2")["detail"]["gated"]["pending"]["spec"]["by"], "ann")
        data = base64.b64encode(make_docx(para("Hợp đồng mua bán"))).decode()
        st, doc = self.req("/api/docs:convert", {"name": "hd.docx", "data": data})
        self.assertEqual((st, doc["kind"]), (200, "docx"))
        self.assertIn("Hợp đồng mua bán", doc["text"])
        st, bad = self.req("/api/docs:convert", {"name": "x.pdf", "data": base64.b64encode(b"nope").decode()})
        self.assertEqual(st, 400)

    def test_board_page_and_unknown_route(self):
        self.start()
        st, html = self.req("/")
        self.assertEqual(st, 200)
        self.assertIn("/api/board", html)
        st, e = self.req("/api/nothing")
        self.assertEqual(st, 404)


class NamingRuleTest(unittest.TestCase):
    """The line and the board name the external store 'RAG System' only."""

    def test_no_forbidden_names(self):
        import os
        import re
        here = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
        files = [os.path.join(here, "server.py"), os.path.join(here, "board.html")]
        ship = os.path.join(here, "ship")
        files += [os.path.join(ship, n) for n in os.listdir(ship) if n.endswith(".py")]
        pat = re.compile(r"\bKH\b|Knowledge\s*Hub|stage\s+F\b", re.I)
        for p in files:
            with open(p, encoding="utf-8") as fh:
                self.assertIsNone(pat.search(fh.read()), p)


if __name__ == "__main__":
    unittest.main()
