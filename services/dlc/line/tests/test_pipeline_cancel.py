"""Cancel stops and joins the builder threads: no event of the run follows its terminal escalated
event, also when a builder thread outlives the bounded join; the CLI backend kills calls in flight."""

from __future__ import annotations

import os
import shutil
import sys
import tempfile
import threading
import time
import unittest

from line import codes
from line.cancel import CancelToken, GuardedStore
from line.codes import LineError
from line.config import load_config
from line.contracts import E_RUN, E_UNIT
from line.llm import make_llm
from line.llm.cli import CliBackend
from line.pipeline import Pipeline
from line.store import SqliteStore

LINE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PACK = os.path.join(LINE_DIR, "samples", "todo-pack")


class SlowBuilderLlm:
    """The fake model, but the builder call cancels the run and then holds: until the pipeline's
    cancel token is set (cooperative) or for hold_s regardless (a call that ignores cancel)."""

    def __init__(self, inner, hold_s: float, cooperative: bool):
        self.inner = inner
        self.hold_s = hold_s
        self.cooperative = cooperative
        self.pipeline = None
        self.entered = threading.Event()
        self.entered_at = 0.0
        self.finished = threading.Event()

    def complete(self, *a, **kw):
        return self.inner.complete(*a, **kw)

    def spent(self, run: str = "") -> float:
        return self.inner.spent(run)

    def agentic(self, role, workdir, prompt, max_turns, usd_cap, **kw):
        try:
            if not self.entered.is_set():
                self.entered_at = time.monotonic()
                self.entered.set()
                self.pipeline.cancel("test")
                if self.cooperative:
                    self.pipeline._cancel.wait(self.hold_s)
                else:
                    time.sleep(self.hold_s)
            return self.inner.agentic(role, workdir, prompt, max_turns, usd_cap, **kw)
        finally:
            self.finished.set()


class CancelJoinTests(unittest.TestCase):
    def setUp(self) -> None:
        self.work = tempfile.mkdtemp(prefix="line-cancel-")

    def tearDown(self) -> None:
        self.store.close()
        shutil.rmtree(self.work, ignore_errors=True)

    def _run(self, hold_s: float, cooperative: bool, join_s: float):
        cfg = load_config(env={}, line_json=None, rag_local_json=None, workroot=os.path.join(self.work, "w"),
                          db=os.path.join(self.work, "line.db"), llm="fake", rag="off", dry_pack=PACK,
                          deploy_windows=[], cancel_join_s=join_s)
        self.store = SqliteStore(cfg.db)
        llm = SlowBuilderLlm(make_llm(cfg, self.store), hold_s, cooperative)
        p = Pipeline(self.store, cfg, llm=llm)
        llm.pipeline = p
        run = p.admit(PACK)
        t0 = time.monotonic()
        row = p.drive(run)
        end = time.monotonic()
        self.after_cancel = end - llm.entered_at if llm.entered_at else end - t0   # from the cancel, not admit
        return p, llm, run, row, end - t0

    def _assert_terminal_last(self, run: str) -> None:
        evs = self.store.events_after(0, run=run)
        term = [i for i, e in enumerate(evs) if e.kind == codes.ESCALATED and not e.env.unit]
        self.assertEqual(len(term), 1)
        self.assertEqual(term[0], len(evs) - 1, "events after the terminal event: %s"
                         % [e.kind for e in evs[term[0] + 1:]])
        self.assertEqual(evs[-1].body["code"], codes.CANCELLED)

    def test_cooperative_builder_is_joined_before_the_terminal_event(self) -> None:
        p, llm, run, row, took = self._run(hold_s=30, cooperative=True, join_s=20)
        self.assertEqual(row["state"], "escalated")
        self.assertEqual(row["detail"]["escalation"]["code"], codes.CANCELLED)
        self.assertTrue(llm.finished.is_set())                         # joined, not abandoned
        self.assertTrue(all(f.done() for f in p._in_flight.values()))
        self.assertLess(took, 20)
        time.sleep(0.5)
        self._assert_terminal_last(run)
        u1 = self.store.get(E_UNIT, "%s:U1" % run)
        self.assertEqual(u1["state"], "leased")                        # the late SUBMIT was refused

    def test_builder_outliving_the_join_writes_nothing_after_terminal(self) -> None:
        p, llm, run, row, took = self._run(hold_s=3, cooperative=False, join_s=0.5)
        self.assertEqual(row["state"], "escalated")
        # the steps before the builder (reading, test checks) take seconds of their own on a slow machine; what
        # counts is the time from the cancel to the end of drive, which must stay under the builder's 3 s hold
        self.assertLess(self.after_cancel, 3, "drive must not wait for the stuck builder beyond cancel_join_s")
        self.assertFalse(llm.finished.is_set())
        self.assertTrue(llm.finished.wait(30))                          # the stuck call returns late ...
        time.sleep(1.0)                                                 # ... and its thread tries to write
        self._assert_terminal_last(run)
        self.assertEqual(self.store.get(E_UNIT, "%s:U1" % run)["state"], "leased")
        self.assertEqual(self.store.get(E_RUN, run)["state"], "escalated")


class GuardTests(unittest.TestCase):
    def test_guard_refuses_writes_after_cancel_and_close(self) -> None:
        store = SqliteStore(":memory:")
        tok = CancelToken()
        g = GuardedStore(store, tok)
        g.put(E_UNIT, "U1", {"id": "U1", "run": "R", "state": "ready"}, run="R")
        hits = []
        tok.on_cancel(lambda: hits.append(1))
        tok.cancel("x")
        tok.cancel("y")                                                 # once
        self.assertEqual((hits, tok.reason), ([1], "x"))
        with self.assertRaises(LineError) as cm:
            g.put(E_UNIT, "U1", {"id": "U1", "run": "R", "state": "leased"}, run="R")
        self.assertEqual(cm.exception.code, codes.CANCELLED)
        self.assertEqual(g.get(E_UNIT, "U1")["state"], "ready")         # reads pass through
        store.close()


@unittest.skipUnless(os.name == "nt", "the .cmd shim test is Windows only")
class CliCancelTests(unittest.TestCase):
    def test_cancel_kills_a_call_in_flight_with_its_children(self) -> None:
        tmp = tempfile.mkdtemp(prefix="line-cli-cancel-")
        try:
            shim = os.path.join(tmp, "slow.cmd")
            with open(shim, "w", encoding="ascii") as fh:
                fh.write('@"%s" -c "import time; time.sleep(60)"\r\n' % sys.executable)
            cfg = load_config(env={}, line_json=None, rag_local_json=None, llm="cli", workroot=tmp)
            be = CliBackend(cfg, command=shim)
            out = {}

            def call() -> None:
                try:
                    be.raw_complete("reader", "hi", "claude-opus-5-5", "k")
                except LineError as e:
                    out["code"] = e.code

            t = threading.Thread(target=call)
            t0 = time.monotonic()
            t.start()
            deadline = time.monotonic() + 20
            while not be._procs and time.monotonic() < deadline:
                time.sleep(0.05)
            time.sleep(0.5)
            be.cancel()
            t.join(30)
            self.assertFalse(t.is_alive())
            self.assertLess(time.monotonic() - t0, 30)
            self.assertEqual(out.get("code"), codes.CANCELLED)
            with self.assertRaises(LineError) as cm:                     # no new call after cancel
                be.raw_complete("reader", "hi", "claude-opus-5-5", "k")
            self.assertEqual(cm.exception.code, codes.CANCELLED)
        finally:
            shutil.rmtree(tmp, ignore_errors=True)


if __name__ == "__main__":
    unittest.main()
