"""Pipeline wiring: server driver (start / cancel), two runs in one store (run-scoped unit ids),
scoped store / leases, store fencing on scoped lease names, CLI, escalation paths, config path of
the local RAG wire config."""

from __future__ import annotations

import io
import json
import os
import shutil
import tempfile
import threading
import unittest
import urllib.request
from contextlib import redirect_stdout

from line import codes
from line.codes import LineError
from line.config import RAG_LOCAL_ENV, default_rag_local_json, load_config
from line.contracts import E_ACC_TEST, E_ATTEMPT, E_ESCALATION, E_RUN, E_UNIT, Envelope, unit_lease_name
from line.lease import SqliteLeases
from line.llm.fake import parse_agentic_key
from line.pipeline import Pipeline, init_target, make_driver
from line.scope import ScopedLeases, ScopedStore, unit_key
from line.server import LineServer
from line.store import SqliteStore

LINE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PACK = os.path.join(LINE_DIR, "samples", "todo-pack")


def cfg_for(work: str, **kw):
    base = dict(workroot=os.path.join(work, "work"), db=os.path.join(work, "line.db"), llm="fake", rag="off",
                dry_pack=PACK, deploy_windows=[])
    base.update(kw)
    return load_config(env={}, line_json=None, rag_local_json=None, **base)


class ScopeTests(unittest.TestCase):
    def setUp(self) -> None:
        self.store = SqliteStore(":memory:")

    def test_unit_rows_and_leases_are_per_run(self) -> None:
        a, b = ScopedStore(self.store, "RA"), ScopedStore(self.store, "RB")
        a.put(E_UNIT, "U1", {"id": "U1", "run": "RA", "state": "pending"})
        b.put(E_UNIT, "U1", {"id": "U1", "run": "RB", "state": "pending"})
        self.assertEqual(a.get(E_UNIT, "U1")["run"], "RA")
        self.assertEqual(b.get(E_UNIT, "U1")["run"], "RB")
        self.assertEqual(self.store.get(E_UNIT, "RA:U1")["id"], "U1")      # display id kept in the row
        self.assertEqual(unit_key("RA", "RA:T1"), "RA:T1")                 # already scoped: unchanged
        a.put(E_ACC_TEST, "RA:T_F1_C1", {"id": "T_F1_C1", "run": "RA"})
        self.assertIsNotNone(a.get(E_ACC_TEST, "T_F1_C1"))
        a.put(E_ATTEMPT, "U1#1", {"unit": "U1", "n": 1, "run": "RA"})
        self.assertIsNotNone(self.store.get(E_ATTEMPT, "RA:U1#1"))
        a.transition(E_UNIT, "U1", "ready", "pending")
        self.assertEqual(b.get(E_UNIT, "U1")["state"], "pending")

        la, lb = ScopedLeases(SqliteLeases(self.store), "RA"), ScopedLeases(SqliteLeases(self.store), "RB")
        x = la.acquire(unit_lease_name("U1"), "a")
        y = lb.acquire(unit_lease_name("U1"), "b")
        self.assertIsNotNone(x)
        self.assertIsNotNone(y)                                            # no collision across runs
        self.assertEqual(x.name, "unit:RA:U1")
        # a fenced unit event with the scoped epoch passes; a stale one is refused
        env = Envelope("RA", "U1", 1, x.epoch, "t", "m", "")
        self.assertGreater(self.store.emit(codes.UNIT_SUBMITTED, env, {}), 0)
        la.release(x)
        with self.assertRaises(LineError) as cm:
            self.store.emit(codes.UNIT_SUBMITTED, env, {})
        self.assertEqual(cm.exception.code, codes.LEASE_LOST)

    def test_expired_lists_only_own_run_under_display_names(self) -> None:
        clock = type("C", (), {"t": 1000, "now_ms": lambda self: self.t})()
        store = SqliteStore(":memory:", clock=clock)
        la = ScopedLeases(SqliteLeases(store, ttl_s=1, clock=clock), "RA")
        lb = ScopedLeases(SqliteLeases(store, ttl_s=1, clock=clock), "RB")
        la.acquire("unit:U1", "a")
        lb.acquire("unit:U2", "b")
        clock.t += 5000
        self.assertEqual([l.name for l in la.expired()], ["unit:U1"])
        la.reap(la.expired()[0])
        self.assertEqual(la.expired(), [])
        self.assertEqual([l.name for l in lb.expired()], ["unit:U2"])

    def test_unscoped_watchdog_requeues_a_scoped_unit(self) -> None:
        from line.watchdog import Watchdog
        clock = type("C", (), {"t": 1000, "now_ms": lambda self: self.t})()
        store = SqliteStore(":memory:", clock=clock)
        raw = SqliteLeases(store, ttl_s=1, clock=clock)
        sa = ScopedStore(store, "RA")
        sa.put(E_UNIT, "U1", {"id": "U1", "run": "RA", "state": "ready", "attempt": 0})
        lease = ScopedLeases(raw, "RA").acquire("unit:U1", "b")
        sa.transition(E_UNIT, "U1", "leased", "ready")
        sa.put(E_UNIT, "U1", dict(sa.get(E_UNIT, "U1"), epoch=lease.epoch, attempt=1))
        clock.t += 5000
        rep = Watchdog(store, raw, retry_n=3, model="m").tick()
        self.assertEqual(rep[0]["action"], "requeued")
        self.assertEqual(store.get(E_UNIT, "RA:U1")["state"], "ready")

    def test_fake_accepts_builder_key_form(self) -> None:
        self.assertEqual(parse_agentic_key("U3.2"), ("U3", 2))
        self.assertEqual(parse_agentic_key("FX-F3-g1.1"), ("FX-F3-g1", 1))
        self.assertEqual(parse_agentic_key("U3#2"), ("U3", 2))
        self.assertEqual(parse_agentic_key("U3/attempt2"), ("U3", 2))
        self.assertEqual(parse_agentic_key("U3"), ("U3", None))


class ConfigPathTests(unittest.TestCase):
    def test_rag_local_lives_outside_line(self) -> None:
        self.assertEqual(default_rag_local_json({RAG_LOCAL_ENV: "X:/a.json"}), "X:/a.json")
        p = default_rag_local_json({})
        self.assertTrue(p.endswith(os.path.join(".line", "rag.local.json")))
        self.assertFalse(os.path.abspath(p).startswith(LINE_DIR))
        d = tempfile.mkdtemp()
        try:
            f = os.path.join(d, "w.json")
            with open(f, "w", encoding="utf-8") as fh:
                json.dump({"rag_ns": "ns-x", "pack_id": "p", "rag_client_secret": "nope"}, fh)
            c = load_config(env={RAG_LOCAL_ENV: f}, line_json=None)
            self.assertEqual(c.rag_ns, "ns-x")
            self.assertEqual(c.rag_extra.get("pack_id"), "p")
            self.assertEqual(c.rag_client_secret, "")                     # secrets never from a file
        finally:
            shutil.rmtree(d, ignore_errors=True)


class DriverTests(unittest.TestCase):
    def setUp(self) -> None:
        self.work = tempfile.mkdtemp(prefix="line-driver-")
        self.cfg = cfg_for(self.work)
        self.store = SqliteStore(self.cfg.db)

    def tearDown(self) -> None:
        self.store.close()
        shutil.rmtree(self.work, ignore_errors=True)

    def _wait(self, driver, run: str) -> dict:
        t = driver.threads[run]
        t.join(timeout=300)
        self.assertFalse(t.is_alive())
        return self.store.get(E_RUN, run)

    def test_two_runs_in_one_store_via_server_and_driver(self) -> None:
        driver = make_driver(self.store, self.cfg)
        srv = LineServer(self.store, self.cfg, driver=driver, port=0).start()
        try:
            req = urllib.request.Request(srv.url + "/api/runs", data=json.dumps({"pack": PACK}).encode(),
                                         method="POST", headers={"Content-Type": "application/json"})
            with urllib.request.urlopen(req, timeout=30) as r:
                self.assertEqual(r.status, 202)
                ra = json.loads(r.read())["run"]
            rb = driver("start", {"pack": PACK})["run"]
            self.assertEqual(self._wait(driver, ra)["state"], "green")
            self.assertEqual(self._wait(driver, rb)["state"], "green")
            for run in (ra, rb):
                units = self.store.query(E_UNIT, run=run)
                self.assertEqual(sorted(u["id"] for u in units), ["U1", "U2", "U3", "U4"])
                self.assertTrue(all(u["state"] == "merged" for u in units))
                self.assertEqual(self.store.get(E_UNIT, "%s:U3" % run)["attempt"], 2)
            with urllib.request.urlopen(srv.url + "/api/board?run=" + rb, timeout=30) as r:
                b = json.loads(r.read())
            self.assertEqual(b["run"]["state"], "green")
            self.assertEqual({row["state"] for row in b["lanes"]["rows"]}, {"green"})
            with self.assertRaises(LineError) as cm:
                driver("cancel", {"run": ra})
            self.assertEqual(cm.exception.code, codes.STATE_CONFLICT)
            with self.assertRaises(LineError) as cm:
                driver("cancel", {"run": "nope"})
            self.assertEqual(cm.exception.code, codes.NOT_FOUND)
        finally:
            srv.stop()

    def test_cancel_escalates_the_run(self) -> None:
        gate, entered = threading.Event(), threading.Event()

        def hold(run: str, stage: str) -> None:
            if stage == "understanding":
                entered.set()
                gate.wait(30)

        driver = make_driver(self.store, self.cfg, on_stage=hold)
        run = driver("start", {"pack": PACK})["run"]
        self.assertTrue(entered.wait(30))
        res = driver("cancel", {"run": run, "reason": "test"})
        self.assertTrue(res["cancelling"])
        gate.set()
        row = self._wait(driver, run)
        self.assertEqual(row["state"], "escalated")
        esc = self.store.get(E_ESCALATION, "%s:run" % run)
        self.assertEqual(esc["code"], codes.CANCELLED)

    def test_cancel_of_a_run_nobody_drives(self) -> None:
        p = Pipeline(self.store, self.cfg)
        run = p.admit(PACK)
        res = make_driver(self.store, self.cfg)("cancel", {"run": run})
        self.assertEqual(res["state"], "escalated")

    def test_urgent_stop_pauses_every_unfinished_run(self) -> None:
        p = Pipeline(self.store, self.cfg)
        a, b, c = p.admit(PACK), p.admit(PACK), p.admit(PACK)
        drive = make_driver(self.store, self.cfg)
        drive("cancel", {"run": c})                                     # finished: left alone
        out = drive("pause_all", {"actor": "demo"})
        self.assertEqual(sorted(out["paused"]), sorted([a, b]))
        for r in (a, b):
            self.assertEqual(self.store.get(E_RUN, r)["detail"]["paused"]["reason"], "urgent stop")
        self.assertEqual(drive("pause_all", {})["paused"], [])          # already paused: nothing more
        self.assertTrue(drive("resume", {"run": a, "explicit": True}))  # each one resumes on its own

    def test_missing_pack_escalates_spec_missing_file(self) -> None:
        empty = os.path.join(self.work, "nopack")
        os.makedirs(empty)
        p = Pipeline(self.store, self.cfg)
        row = p.drive(p.admit(empty))
        self.assertEqual(row["state"], "escalated")
        self.assertEqual(row["detail"]["escalation"]["code"], codes.SPEC_MISSING_FILE)
        kinds = [e.kind for e in self.store.events_after(0, run=row["id"])]
        self.assertEqual(kinds[-1], codes.ESCALATED)

    def test_budget_cap_escalates_cleanly(self) -> None:
        # the multi-agent line: every call is held to LINE_MAX_USD_CALL (the solo lane has its own cap, test_solo)
        cfg = cfg_for(self.work, llm="cli", max_usd_call=0.0001, solo="0", workroot=os.path.join(self.work, "w2"))
        p = Pipeline(self.store, cfg)
        target = init_target(os.path.join(self.work, "t2"))
        row = p.drive(p.admit(PACK, target))
        self.assertEqual(row["state"], "escalated")
        self.assertEqual(row["detail"]["escalation"]["code"], codes.BUDGET_EXCEEDED)   # refused before any call

    def test_cli_status_and_board(self) -> None:
        from line import cli
        p = Pipeline(self.store, self.cfg)
        run = p.admit(PACK)
        os.environ["LINE_DB"] = self.cfg.db
        try:
            buf = io.StringIO()
            with redirect_stdout(buf):
                self.assertEqual(cli.main(["status"]), 0)
                self.assertEqual(cli.main(["status", run]), 0)
                self.assertEqual(cli.main(["board", run]), 0)
            out = buf.getvalue()
            self.assertIn(run, out)
            self.assertIn('"state": "admitted"', out)
        finally:
            os.environ.pop("LINE_DB", None)


if __name__ == "__main__":
    unittest.main()
