"""Resume after a process restart: drive() picks a run up from its persisted state and finishes it
without redoing finished work (frozen pack, digest, locked tests, graph, merged units are reused;
units left mid-flight are recovered). A crash is simulated by a BaseException that escapes drive()."""

from __future__ import annotations

import io
import os
import shutil
import tempfile
import unittest
from collections import Counter
from contextlib import redirect_stdout
from unittest import mock

from line import codes
from line.codes import LineError
from line.config import load_config
from line.contracts import E_LLM_CALL, E_RUN, E_UNIT
from line.events import check_gapless
from line.pipeline import Pipeline, make_driver
from line.store import SqliteStore

LINE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PACK = os.path.join(LINE_DIR, "samples", "todo-pack")


class Crash(BaseException):
    """Stands for the process dying: not an Exception, so drive() does not escalate on it."""


class ResumeCase(unittest.TestCase):
    def setUp(self) -> None:
        self.work = tempfile.mkdtemp(prefix="line-resume-")

    def tearDown(self) -> None:
        for st in getattr(self, "_stores", []):
            st.close()
        shutil.rmtree(self.work, ignore_errors=True)

    def env(self, name: str, **kw):
        base = dict(workroot=os.path.join(self.work, name, "w"), db=os.path.join(self.work, name, "line.db"),
                    llm="fake", rag="off", dry_pack=PACK, deploy_windows=[])
        base.update(kw)
        os.makedirs(os.path.join(self.work, name), exist_ok=True)
        cfg = load_config(env={}, line_json=None, rag_local_json=None, **base)
        store = SqliteStore(cfg.db)
        self._stores = getattr(self, "_stores", []) + [store]
        return cfg, store

    def crash_then_resume(self, cfg, store, pack=PACK, **crash_kw):
        p1 = Pipeline(store, cfg, **crash_kw)
        run = p1.admit(pack)
        with self.assertRaises(Crash):
            p1.drive(run)
        left = store.get(E_RUN, run)["state"]
        self.assertNotIn(left, ("green", "escalated"))
        row = Pipeline(store, cfg).drive(run)                    # a new process: fresh pipeline, fresh model
        return run, left, row

    def kinds(self, store, run):
        return Counter(e.kind for e in store.events_after(0, run=run))

    def assert_done_once(self, store, run, row, rework=()):
        self.assertEqual(row["state"], "green", row.get("detail", {}).get("escalation"))
        k = self.kinds(store, run)
        for kind in (codes.SPEC_FROZEN, codes.DIGEST_DONE, codes.GRAPH_VALID, codes.RUN_GREEN):
            self.assertEqual(k[kind], 1, kind)
        self.assertEqual(k[codes.UNIT_MERGED], 4)
        if codes.TESTS_APPROVED not in rework:
            self.assertEqual(k[codes.TESTS_APPROVED], 1)
        merged = Counter(e.env.unit for e in store.events_after(0, run=run, kinds=[codes.UNIT_MERGED]))
        self.assertEqual(set(merged.values()), {1})
        calls = Counter((c["role"], c["key"]) for c in store.query(E_LLM_CALL, run=run))
        dup = {k: n for k, n in calls.items() if n > 1 and k[0] not in rework}
        self.assertEqual(dup, {}, "model calls redone after resume")
        check_gapless(store.events_after(0))
        units = store.query(E_UNIT, run=run)
        self.assertTrue(units and all(u["state"] == "merged" for u in units))


class StageResumeTests(ResumeCase):
    def test_resume_after_a_stop_at_each_stage_boundary(self) -> None:
        for stage, left in (("planning", "understanding"), ("building", "planning"),
                            ("integrating", "building"), ("qas", "integrating")):
            with self.subTest(stage=stage):
                cfg, store = self.env("b-" + stage)
                fired = []

                def hook(run, name, stage=stage, fired=fired):
                    if name == stage and not fired:
                        fired.append(name)
                        raise Crash(name)

                run, was, row = self.crash_then_resume(cfg, store, on_stage=hook)
                self.assertEqual(was, left)
                self.assert_done_once(store, run, row)
                self.assertEqual(store.get(E_UNIT, "%s:U3" % run)["attempt"], 2)    # fixture: U3 fails once

    def test_resume_inside_understanding_drops_half_written_tests(self) -> None:
        cfg, store = self.env("u")
        import line.pipeline as P
        real = P.check_tests
        seen = []

        def check_then_crash(*a, **kw):
            if not seen:
                seen.append(1)
                raise Crash("after test author, before the gate")
            return real(*a, **kw)

        with mock.patch.object(P, "check_tests", side_effect=check_then_crash):
            run, was, row = self.crash_then_resume(cfg, store)
        self.assertEqual(was, "understanding")
        # the digest is reused (no reader call twice); the unapproved tests are authored again
        self.assert_done_once(store, run, row, rework=("test_author",))


class BuildResumeTests(ResumeCase):
    def test_submitted_unit_is_verified_again_after_resume(self) -> None:
        cfg, store = self.env("s")
        import line.pipeline as P
        real = P.verify
        seen = []

        def verify_or_crash(uid, *a, **kw):
            if uid == "U3" and not seen:
                seen.append(uid)
                raise Crash("verifier of U3")
            return real(uid, *a, **kw)

        with mock.patch.object(P, "verify", side_effect=verify_or_crash):
            run, was, row = self.crash_then_resume(cfg, store)
        self.assertEqual(was, "building")
        self.assert_done_once(store, run, row)
        u3 = store.get(E_UNIT, "%s:U3" % run)
        self.assertEqual(u3["attempt"], 2)                        # attempt 1 re-verified (fails), attempt 2 passes
        vf = [e for e in store.events_after(0, run=run, kinds=[codes.VERIFY_FAILED]) if e.env.unit == "U3"]
        self.assertEqual([e.env.attempt for e in vf], [1])

    def test_leased_unit_with_a_live_lease_is_requeued_when_it_expires(self) -> None:
        # the lost attempt 1 of U1 counts as an attempt: the rebuild is attempt 2, so this test's pack
        # copy has a U1/attempt2 fixture (same tree as attempt1)
        pack = os.path.join(self.work, "pack")
        shutil.copytree(PACK, pack)
        b = os.path.join(pack, "dry", "builder", "U1")
        shutil.copytree(os.path.join(b, "attempt1"), os.path.join(b, "attempt2"))
        cfg, store = self.env("l", lease_ttl_s=2, heartbeat_s=1, watchdog_s=1, dry_pack=pack)
        import line.pipeline as P
        real = P.run_builder
        seen = []

        def build_or_crash(unit, lease, *a, **kw):
            if unit.id == "U1" and not seen:
                seen.append(unit.id)
                raise Crash("builder of U1")          # dies holding the unit lease (not released)
            return real(unit, lease, *a, **kw)

        with mock.patch.object(P, "run_builder", side_effect=build_or_crash):
            run, was, row = self.crash_then_resume(cfg, store, pack=pack)
        self.assertEqual(was, "building")
        self.assert_done_once(store, run, row)
        u1 = [e for e in store.events_after(0, run=run) if e.env.unit == "U1"]
        rq = [e for e in u1 if e.kind == codes.UNIT_REQUEUED and e.body.get("code") == codes.LEASE_LOST]
        self.assertEqual(len(rq), 1)
        self.assertEqual(store.get(E_UNIT, "%s:U1" % run)["detail"].get("failures", []), [])   # not a ladder failure


class EntryPointTests(ResumeCase):
    def _stopped_run(self, name: str):
        cfg, store = self.env(name)
        fired = []

        def hook(run, stage):
            if stage == "integrating" and not fired:
                fired.append(stage)
                raise Crash(stage)

        p = Pipeline(store, cfg, on_stage=hook)
        run = p.admit(PACK)
        with self.assertRaises(Crash):
            p.drive(run)
        return cfg, store, run

    def test_cli_resume(self) -> None:
        from line import cli
        cfg, store, run = self._stopped_run("cli")
        env = {"LINE_DB": cfg.db, "LINE_WORKROOT": cfg.workroot, "LINE_LLM": "fake", "LINE_RAG": "off",
               "LINE_DRY_PACK": PACK, "LINE_DEPLOY_WINDOWS": "[]"}
        with mock.patch.dict(os.environ, env):
            buf = io.StringIO()
            with redirect_stdout(buf):
                self.assertEqual(cli.main(["resume", run]), 0)
                self.assertEqual(cli.main(["resume", run]), 2)            # final now
                self.assertEqual(cli.main(["resume", "nope"]), 2)
        self.assertIn("resuming run %s from building" % run, buf.getvalue())
        self.assertEqual(store.get(E_RUN, run)["state"], "green")

    def test_server_auto_resume_is_opt_in(self) -> None:
        from line.server import auto_resume
        cfg, store, run = self._stopped_run("srv")
        driver = make_driver(store, cfg)
        self.assertEqual(auto_resume(driver, cfg, []), [])                 # default: off
        self.assertNotIn(run, driver.threads)
        res = auto_resume(driver, cfg, ["--resume"])
        self.assertEqual([r["run"] for r in res], [run])
        driver.threads[run].join(300)
        self.assertEqual(store.get(E_RUN, run)["state"], "green")
        cfg2 = load_config(env={"LINE_AUTO_RESUME": "1"}, line_json=None, rag_local_json=None)
        self.assertTrue(cfg2.auto_resume)

    def test_second_driver_is_refused_while_the_run_lease_is_live(self) -> None:
        cfg, store, run = self._stopped_run("lease")
        p = Pipeline(store, cfg)
        p._setup(store.get(E_RUN, run))
        p.run = run
        p._hold_run_lease()                                                # a live driver elsewhere
        try:
            with self.assertRaises(LineError) as cm:
                Pipeline(store, cfg).drive(run)
            self.assertEqual(cm.exception.code, codes.STATE_CONFLICT)
        finally:
            p._drop_run_lease()
        self.assertEqual(Pipeline(store, cfg).drive(run)["state"], "green")


if __name__ == "__main__":
    unittest.main()
