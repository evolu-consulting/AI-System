"""Reconciler: every drift check on a small hand-made run (no pipeline), its repair, the event it writes,
idempotence (a second pass is clean), dry run, the live-driver deferral and the frozen state."""

from __future__ import annotations

import json
import os
import shutil
import tempfile
import time
import unittest
from contextlib import ExitStack

from line import codes
from line.chaos import dedup_rag
from line.config import load_config
from line.contracts import E_RUN, E_UNIT, Run, RunState, Unit, UnitState, unit_lease_name
from line.lease import SqliteLeases
from line.pipeline import init_target
from line.rag.http_adapter import wire_event_id
from line.rag.resilient import ResilientRag
from line.reconciler import (
    RECONCILE_FROZEN, RECONCILE_REPAIRED, SYSTEM_RUN, Reconciler, is_frozen, on_before_drive, on_server_start,
    project_states,
)
from line.scope import ScopedLeases, ScopedStore
from line.ship._util import git, git_out
from line.statemachine import StateMachine, update_row
from line.store import SqliteStore

R = "R1"


class ReconCase(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.mkdtemp(prefix="line-recon-")
        self._x = ExitStack()
        self.cfg = load_config(env={}, line_json=None, rag_local_json=None, workroot=os.path.join(self.tmp, "w"),
                               db=os.path.join(self.tmp, "line.db"), watchdog_s=1)
        self.store = SqliteStore(self.cfg.db)
        self.repo = init_target(os.path.join(self.tmp, "target"))
        self.sm = StateMachine(self.store)
        self.sst = ScopedStore(self.store, R)
        self.usm = StateMachine(self.sst)
        self.leases = SqliteLeases(self.store)
        self.sleases = ScopedLeases(self.leases, R)

    def tearDown(self) -> None:
        self._x.close()
        self.store.close()
        shutil.rmtree(self.tmp, ignore_errors=True)

    # ------------------------------------------------------------ builders

    def admit(self, to: str = RunState.BUILDING.value) -> None:
        self.sm.admit_run(Run(id=R, pack_path="pack", detail={"target": self.repo}))
        for st in ("understanding", "planning", "building", "integrating", "qas"):
            if self.store.get(E_RUN, R)["state"] == to:
                break
            self.sm.advance_run(R, st)

    def unit(self, uid: str, state: str = UnitState.READY.value, **kw) -> None:
        self.usm.put_unit(Unit(id=uid, run=R, state=UnitState.PENDING.value, **kw))
        if state != UnitState.PENDING.value:
            self.usm.advance_unit(uid, UnitState.READY, UnitState.PENDING)
        if state == UnitState.LEASED.value:
            self.lease = self.usm.dispatch_unit(uid, self.sleases, owner="t")

    def rc(self, **kw) -> Reconciler:
        kw.setdefault("lease_grace_s", 0)
        return Reconciler(self.store, self.cfg, **kw)

    def drifts(self, rep, check):
        return [d for d in rep.drifts if d.check == check]

    def kinds(self, run=R):
        return [e.kind for e in self.store.events_after(0, run=run)]

    def assert_second_pass_clean(self, **kw) -> None:
        rep = self.rc(**kw).run_pass()
        self.assertTrue(rep.clean, rep.summary())


class ProjectionTests(ReconCase):
    def test_unit_store_ahead_of_events_gets_a_catch_up_event(self) -> None:
        self.admit()
        self.unit("U1")
        self.store.transition(E_UNIT, "R1:U1", UnitState.WAITING, UnitState.READY)   # no event: a crash
        rep = self.rc().run_pass()
        d = self.drifts(rep, "projection")
        self.assertEqual([(x.unit, x.status, x.action) for x in d], [("U1", "repaired", "catch_up_event")])
        self.assertEqual(project_states(self.store.events_after(0, run=R))["units"]["U1"], "waiting")
        self.assertIn(RECONCILE_REPAIRED, self.kinds())
        self.assert_second_pass_clean()

    def test_refused_submit_requeues_the_unit(self) -> None:
        self.admit()
        self.unit("U1", UnitState.LEASED.value)
        self.store.transition(E_UNIT, "R1:U1", UnitState.SUBMITTED, UnitState.LEASED)  # its event was refused
        rep = self.rc().run_pass()
        self.assertEqual([x.action for x in self.drifts(rep, "projection")], ["requeue"])
        self.assertEqual(self.store.get(E_UNIT, "R1:U1")["state"], "ready")
        rq = self.store.events_after(0, run=R, kinds=[codes.UNIT_REQUEUED])
        self.assertEqual(rq[-1].body["code"], codes.LEASE_LOST)
        self.assertTrue(rq[-1].body["reconciled"])
        self.assert_second_pass_clean()

    def test_live_driver_needs_two_sightings(self) -> None:
        self.admit()
        self.unit("U1")
        self.store.transition(E_UNIT, "R1:U1", UnitState.WAITING, UnitState.READY)
        self.leases.acquire("run:" + R, "driver", 60)                  # a driver is alive
        rc = self.rc()
        self.assertEqual([x.status for x in self.drifts(rc.run_pass(), "projection")], ["deferred"])
        self.assertEqual([x.status for x in self.drifts(rc.run_pass(), "projection")], ["repaired"])
        self.assertTrue(rc.run_pass().clean)

    def test_terminal_store_without_terminal_event(self) -> None:
        self.admit()
        self.store.transition(E_RUN, R, RunState.ESCALATED, RunState.BUILDING)        # crash before the event
        update_row(self.store, E_RUN, R, {"detail": {"target": self.repo,
                                                     "escalation": {"code": codes.NO_PROGRESS, "message": "x"}}})
        rep = self.rc().run_pass()
        self.assertEqual(self.drifts(rep, "projection")[0].status, "repaired")
        evs = self.store.events_after(0, run=R)
        self.assertEqual(evs[-1].kind, codes.ESCALATED)                  # the terminal event is last
        self.assertEqual(evs[-1].body["code"], codes.NO_PROGRESS)
        sysev = self.store.events_after(0, run=SYSTEM_RUN, kinds=[RECONCILE_REPAIRED])
        self.assertEqual(sysev[-1].body["run"], R)
        self.assert_second_pass_clean()

    def test_closed_run_is_never_written(self) -> None:
        self.admit()
        self.unit("U1")
        self.sm.escalate_run(R, codes.CANCELLED, "x")
        self.store.transition(E_UNIT, "R1:U1", UnitState.WAITING, UnitState.READY)
        n = self.store.last_seq()
        rep = self.rc().run_pass()
        self.assertEqual([x.status for x in self.drifts(rep, "projection")], ["noted"])
        self.assertEqual(self.store.last_seq(), n)
        self.assertTrue(rep.clean)


class LeaseTests(ReconCase):
    def test_leased_unit_with_released_lease_is_requeued(self) -> None:
        self.admit()
        self.unit("U1", UnitState.LEASED.value)
        self.sleases.release(self.lease)
        rep = self.rc().run_pass()
        d = self.drifts(rep, "stuck_lease")
        self.assertEqual([(x.unit, x.status) for x in d], [("U1", "repaired")])
        self.assertEqual(self.store.get(E_UNIT, "R1:U1")["state"], "ready")
        self.assert_second_pass_clean()

    def test_expired_lease_is_left_to_a_live_watchdog(self) -> None:
        self.admit()
        self.unit("U1", UnitState.LEASED.value)
        with self.store.tx() as c:
            c.execute("UPDATE lease SET expires_ms=1 WHERE name=?", ("unit:R1:U1",))
        self.leases.acquire("run:" + R, "driver", 60)
        self.assertEqual(self.drifts(self.rc().run_pass(), "stuck_lease"), [])
        self.leases.release(self.leases.current("run:" + R))         # driver gone: now it is ours
        rep = self.rc().run_pass()
        self.assertEqual([x.status for x in self.drifts(rep, "stuck_lease")], ["repaired"])
        self.assertEqual([l for l in self.leases.expired() if l.name.endswith(":U1")], [])

    def test_live_lease_of_terminal_run_is_released(self) -> None:
        self.admit()
        self.unit("U1", UnitState.LEASED.value)
        self.sm.escalate_run(R, codes.CANCELLED, "x")
        n = self.store.last_seq()
        rep = self.rc().run_pass()
        self.assertEqual([x.status for x in self.drifts(rep, "leaked_lease")], ["repaired"])
        self.assertIsNone(self.sleases.current(unit_lease_name("U1")))
        self.assertEqual(len(self.store.events_after(n, run=R)), 0)       # reported on the system run
        self.assertTrue(self.store.events_after(n, run=SYSTEM_RUN, kinds=[RECONCILE_REPAIRED]))
        self.assert_second_pass_clean()

    def test_dry_run_changes_nothing(self) -> None:
        self.admit()
        self.unit("U1", UnitState.LEASED.value)
        self.sleases.release(self.lease)
        n = self.store.last_seq()
        rep = self.rc(dry_run=True).run_pass()
        self.assertEqual([x.status for x in self.drifts(rep, "stuck_lease")], ["would_repair"])
        self.assertFalse(rep.clean)
        self.assertEqual(self.store.last_seq(), n)
        self.assertEqual(self.store.get(E_UNIT, "R1:U1")["state"], "leased")


class GitTests(ReconCase):
    def _worktree(self, uid: str) -> str:
        from line.build.sandbox import Sandbox
        return Sandbox(self.repo, self.cfg.workroot).create({"run": R, "id": uid})

    def test_orphan_worktree_branch_and_stale_registration(self) -> None:
        self.admit()
        self.unit("U1")
        wt1 = self._worktree("U1")
        update_row(self.store, E_UNIT, "R1:U1", {"state": "merged"})        # merged -> its worktree is an orphan
        self.store.emit(codes.UNIT_MERGED, {"run": R, "unit": "U1", "attempt": 0, "epoch": 0, "agent_version": "",
                                            "model": "", "spec_hash": ""}, {})
        wt9 = self._worktree("U9")                                           # a unit the store does not know
        git(self.repo, "branch", "line/R1/U8")                               # orphan branch
        self.unit("U2")
        wt2 = self._worktree("U2")
        shutil.rmtree(wt2)                                                   # registration left behind
        rep = self.rc().run_pass()
        got = sorted((d.check, d.unit, d.status) for d in rep.drifts)
        self.assertIn(("orphan_worktree", "U1", "repaired"), got)
        self.assertIn(("orphan_worktree", "U9", "repaired"), got)
        self.assertIn(("orphan_branch", "U8", "repaired"), got)
        self.assertIn(("stale_registration", "", "repaired"), got)
        self.assertFalse(os.path.exists(wt1) or os.path.exists(wt9))
        self.assertEqual(git_out(self.repo, "branch", "--list", "line/R1/U8"), "")
        self.assertNotIn("U2", git_out(self.repo, "worktree", "list"))
        self.assert_second_pass_clean()

    def test_lost_verified_work_goes_back_to_ready(self) -> None:
        self.admit()
        self.unit("U1", UnitState.LEASED.value)
        self.usm.advance_unit("U1", UnitState.SUBMITTED, epoch=self.lease.epoch)
        self.usm.advance_unit("U1", UnitState.VERIFIED)
        update_row(self.store, E_UNIT, "R1:U1", {"detail": {"head": "0" * 40}})
        rep = self.rc().run_pass()
        self.assertEqual([(d.check, d.status) for d in rep.drifts if d.unit == "U1"],
                         [("lost_work", "repaired")])
        self.assertEqual(self.store.get(E_UNIT, "R1:U1")["state"], "ready")
        self.assert_second_pass_clean()

    def _merged_unit(self, sha: str) -> None:
        self.unit("U1")
        update_row(self.store, E_UNIT, "R1:U1", {"state": "merged", "detail": {"merged_sha": sha}})
        self.store.emit(codes.UNIT_MERGED, {"run": R, "unit": "U1", "attempt": 0, "epoch": 0, "agent_version": "",
                                            "model": "", "spec_hash": ""}, {"sha": sha})

    def _commit(self, name: str) -> str:
        with open(os.path.join(self.repo, name), "w") as fh:
            fh.write(name)
        git(self.repo, "add", "-A")
        git(self.repo, "commit", "-q", "-m", name)
        return git_out(self.repo, "rev-parse", "HEAD")

    def test_main_reset_behind_a_merge_is_fast_forwarded(self) -> None:
        self.admit()
        base = git_out(self.repo, "rev-parse", "HEAD")
        sha = self._commit("a.txt")
        self._merged_unit(sha)
        git(self.repo, "reset", "-q", "--hard", base)
        rep = self.rc().run_pass()
        self.assertEqual([(d.status, d.action) for d in self.drifts(rep, "merged_off_main")],
                         [("repaired", "fast_forward_main")])
        self.assertEqual(git_out(self.repo, "rev-parse", "main"), sha)
        self.assert_second_pass_clean()

    def test_diverged_main_freezes_the_run(self) -> None:
        self.admit()
        base = git_out(self.repo, "rev-parse", "HEAD")
        sha = self._commit("a.txt")
        self._merged_unit(sha)
        git(self.repo, "reset", "-q", "--hard", base)
        self._commit("b.txt")                                       # main went elsewhere
        rep = self.rc().run_pass()
        self.assertEqual([d.status for d in self.drifts(rep, "merged_off_main")], ["frozen"])
        self.assertTrue(is_frozen(self.store, R))
        self.assertEqual(self.kinds().count(RECONCILE_FROZEN), 1)
        rep2 = self.rc().run_pass()                                 # stays frozen, said once
        self.assertEqual([d.status for d in self.drifts(rep2, "merged_off_main")], ["noted"])
        self.assertTrue(rep2.clean)
        self.assertEqual(self.kinds().count(RECONCILE_FROZEN), 1)


class QasTests(ReconCase):
    def _qas(self) -> str:
        root = os.path.join(self.cfg.workroot, R, "_qas")
        os.makedirs(root, exist_ok=True)
        return root

    def _pointer(self, root: str, color: str, sha: str) -> None:
        with open(os.path.join(root, "current"), "w") as fh:
            json.dump({"color": color, "sha": sha, "run": R, "ts_ms": 1}, fh)

    def test_missing_color_dir_is_exported_again(self) -> None:
        self.admit()
        root = self._qas()
        self._pointer(root, "blue", git_out(self.repo, "rev-parse", "main"))
        rep = self.rc().run_pass()
        self.assertEqual([(d.status, d.action) for d in self.drifts(rep, "qas_pointer")], [("repaired", "export_again")])
        self.assertTrue(os.path.isfile(os.path.join(root, "blue", "README.md")))
        self.assert_second_pass_clean()

    def test_unknown_sha_switches_to_the_populated_color(self) -> None:
        self.admit()
        root = self._qas()
        os.makedirs(os.path.join(root, "green"))
        with open(os.path.join(root, "green", "x.py"), "w") as fh:
            fh.write("")
        self._pointer(root, "blue", "f" * 40)
        rep = self.rc().run_pass()
        self.assertEqual([d.action for d in self.drifts(rep, "qas_pointer")], ["switch_pointer"])
        with open(os.path.join(root, "current")) as fh:
            self.assertEqual(json.load(fh)["color"], "green")
        self.assert_second_pass_clean()

    def test_nothing_to_restore_freezes(self) -> None:
        self.admit()
        root = self._qas()
        self._pointer(root, "blue", "f" * 40)
        rep = self.rc().run_pass()
        self.assertEqual([d.status for d in self.drifts(rep, "qas_pointer")], ["frozen"])
        self.assertTrue(is_frozen(self.store, R))


class BudgetTests(ReconCase):
    def test_reservations_never_charged_are_released(self) -> None:
        from line.budget import SqliteBudget
        self.admit()
        self.unit("U1")
        self.unit("U2")
        b = SqliteBudget(self.store)
        b.open(R, 5.0)
        b.split(R, R, {"U1": 1, "U2": 1})
        b.reserve(R, "U2", 0.5)                                     # U2 is still working: kept
        b.reserve(R, "U1", 0.5)
        update_row(self.store, E_UNIT, "R1:U1", {"state": "merged"})
        self.store.emit(codes.UNIT_MERGED, {"run": R, "unit": "U1", "attempt": 0, "epoch": 0, "agent_version": "",
                                            "model": "", "spec_hash": ""}, {})
        with self.store.tx() as c:
            c.execute("UPDATE budget_node SET reserved = reserved + 0.25 WHERE run=? AND node=?", (R, "U2"))
        rep = self.rc().run_pass()
        acts = sorted(d.action for d in self.drifts(rep, "budget_reserved"))
        self.assertEqual(acts, ["recompute_reserved", "release"])
        self.assertAlmostEqual(b.state(R, "U1").reserved, 0.0)
        self.assertAlmostEqual(b.state(R, "U2").reserved, 0.5)
        self.assertAlmostEqual(b.state(R, R).reserved, 0.5)
        self.assert_second_pass_clean()

    def test_terminal_run_releases_everything(self) -> None:
        from line.budget import SqliteBudget
        self.admit()
        b = SqliteBudget(self.store)
        b.open(R, 5.0)
        b.reserve(R, R, 1.0)
        self.sm.escalate_run(R, codes.CANCELLED, "x")
        self.rc().run_pass()
        self.assertAlmostEqual(b.state(R, R).reserved, 0.0)
        self.assert_second_pass_clean()


class EventSyncTests(ReconCase):
    def test_unsynced_events_and_outbox_drain_and_missing_remote_events_are_resent(self) -> None:
        remote = dedup_rag()
        rag = ResilientRag(remote, self.store, probe_interval_s=0)
        self.admit()
        remote.down = True
        rag.sync_events()                                           # queued in the outbox
        self.assertTrue(self.store.outbox_peek(1))
        remote.down = False
        rep = self.rc(rag=rag, unsynced_s=0).run_pass()
        self.assertEqual([d.status for d in self.drifts(rep, "events_unsynced")], ["repaired"])
        self.assertEqual(self.store.outbox_peek(1), [])
        self.assertEqual(self.store.unsynced(1), [])
        remote.events = remote.events[:2]                           # the remote lost events
        remote.ids = {wire_event_id(e) for e in remote.events}
        rep = self.rc(rag=rag, unsynced_s=0).run_pass()
        self.assertEqual([d.status for d in self.drifts(rep, "remote_events")], ["repaired"])
        self.assertEqual(len(remote.events), self.store.last_seq())
        self.assert_second_pass_clean(rag=rag, unsynced_s=0)

    def test_remote_still_down_is_deferred(self) -> None:
        remote = dedup_rag()
        rag = ResilientRag(remote, self.store, probe_interval_s=0)
        self.admit()
        remote.down = True
        rag.sync_events()
        rep = self.rc(rag=rag, unsynced_s=0).run_pass()
        self.assertEqual([d.status for d in self.drifts(rep, "events_unsynced")], ["deferred"])


class HookTests(ReconCase):
    def test_hooks_are_off_by_default(self) -> None:
        self.assertIsNone(on_server_start(self.store, self.cfg))
        self.assertIsNone(on_before_drive(self.store, self.cfg, R))

    def test_thread_runs_passes(self) -> None:
        self.admit()
        self.unit("U1", UnitState.LEASED.value)
        self.sleases.release(self.lease)
        rc = self.rc().start(interval_s=0.1)
        try:
            for _ in range(50):
                if self.store.get(E_UNIT, "R1:U1")["state"] == "ready":
                    break
                time.sleep(0.1)
        finally:
            rc.stop()
        self.assertEqual(self.store.get(E_UNIT, "R1:U1")["state"], "ready")

    def test_enabled_hook_runs_a_pass(self) -> None:
        self.admit()
        self.cfg.reconcile = True                                      # field proposed for config.py
        rep = on_before_drive(self.store, self.cfg, R)
        self.assertIsNotNone(rep)
        self.assertEqual(rep.runs, [R])


if __name__ == "__main__":
    unittest.main()
