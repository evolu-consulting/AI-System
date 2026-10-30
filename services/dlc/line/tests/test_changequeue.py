"""The project's change queue (line.changequeue): first approved, first served (a run joins the queue when its
drafts are approved, not when it starts), the wait for an earlier run, a run in design being in nobody's way, the
queue fingerprint that makes waiting drafts be written again, the policy of the process, and run-again."""

from __future__ import annotations

import os
import shutil
import tempfile
import threading
import time
import types
import unittest

from line import changequeue as Q
from line import codes
from line.contracts import E_RUN, E_SLOT, Run
from line.pipeline import Escalate
from line.tests.fakes import make_fakes


class Pipe(types.SimpleNamespace):
    def __init__(self, store, run):
        super().__init__(store=store, run=run, cfg=types.SimpleNamespace(rag="off"), boards=[], logs=[],
                         cancelled=False)

    def _board(self, stage, status, text=""):
        self.boards.append((stage, status, text))

    def log(self, msg):
        self.logs.append(msg)

    def _check_cancel(self):
        if self.cancelled:
            raise Escalate(codes.CANCELLED, "cancelled")


class ChangeQueueTest(unittest.TestCase):
    def setUp(self):
        self.home = tempfile.mkdtemp(prefix="dlc-q-")
        self.old = os.environ.get("DLC_HOME")
        os.environ["DLC_HOME"] = self.home
        self.store = make_fakes().store
        self.n = 0

    def tearDown(self):
        if self.old is None:
            os.environ.pop("DLC_HOME", None)
        else:
            os.environ["DLC_HOME"] = self.old
        shutil.rmtree(self.home, ignore_errors=True)

    def run_of(self, flow="enhancement", project="shop", name="", state="understanding", spec="Add an export"):
        self.n += 1
        rid = "R%d" % self.n
        pack = os.path.join(self.home, "pack%d" % self.n)
        os.makedirs(pack)
        with open(os.path.join(pack, "spec.md"), "w", encoding="utf-8") as fh:
            fh.write("# %s\n\n%s\n" % (name or rid, spec))
        self.store.put(E_RUN, rid, Run(rid, pack, state=state, detail={"project": project, "flow": flow,
                                                                        "name": name or rid}), run=rid)
        return Pipe(self.store, rid)

    def set_state(self, run, state):
        row = self.store.get(E_RUN, run)
        row["state"] = state
        self.store.put(E_RUN, run, row, run=run)

    def test_reserve_fifo_and_only_queued_flows(self):
        a, b = self.run_of(name="export", spec="Move the export button out of Admin > Data"), self.run_of()
        sa, sb = Q.reserve(a), Q.reserve(b)
        self.assertEqual((sa["seq"], sb["seq"], sa["state"]), (1, 2, "reserved"))
        self.assertEqual(Q.reserve(a)["id"], sa["id"])                       # idempotent
        self.assertIn("Move the export button", sa["summary"])
        self.assertIsNone(Q.reserve(self.run_of(flow="new-system")))         # a New System owns the project alone
        self.assertIsNone(Q.reserve(self.run_of(project="")))                # a run on a bare target has no queue
        self.assertEqual([s["run"] for s in Q.slots(self.store, "shop")], [a.run, b.run])

    def test_text_shows_earlier_changes_with_their_artifacts(self):
        a, b = self.run_of(spec="Move the export button out of Admin > Data"), self.run_of(spec="Add CSV export")
        Q.reserve(a)
        Q.reserve(b)
        Q.push(a, "spec", {"spec": "### F1 Export button on the top bar", "plan": ""})
        self.assertEqual(Q.text(self.store, "shop", b.run), "")             # a is still in design: not in the queue
        Q.planned(a)                                                         # approved: a joins the queue
        t = Q.text(self.store, "shop", b.run)
        self.assertIn("1 earlier change", t)
        self.assertIn("Move the export button", t)
        self.assertIn("spec: ### F1 Export button on the top bar", t)
        self.assertEqual(Q.text(self.store, "shop", a.run), "")              # nothing is before the first slot
        whole = Q.text(self.store, "shop")                                   # the knowledge store copy
        self.assertIn("1 change(s) are waiting", whole)
        self.assertNotIn("this one", whole)

    def test_wait_turn_waits_for_the_earlier_run_then_goes(self):
        a, b = self.run_of(), self.run_of()
        Q.reserve(a)
        Q.reserve(b)
        self.assertEqual(Q.wait_turn(a, poll_s=0.01)["state"], "implementing")
        got = {}
        t = threading.Thread(target=lambda: got.update(Q.wait_turn(b, poll_s=0.01)))
        t.start()
        time.sleep(0.2)
        self.assertFalse(got)                                                # behind a
        self.assertEqual(Q.mine(self.store, b.run)["state"], "planned")
        self.assertTrue(any("behind 1" in x[2] for x in b.boards))
        self.set_state(a.run, "green")
        Q.release(self.store, a.run)
        t.join(5)
        self.assertEqual(got.get("state"), "implementing")
        self.assertEqual(Q.mine(self.store, a.run)["state"], "done")

    def test_slot_of_an_ended_run_leaves_the_queue(self):
        a, b = self.run_of(), self.run_of()
        Q.reserve(a)
        Q.reserve(b)
        Q.planned(a)
        self.set_state(a.run, "escalated")                                   # ended without release (a crash)
        self.assertEqual(Q.wait_turn(b, poll_s=0.01)["state"], "implementing")
        self.assertEqual(Q.mine(self.store, a.run)["state"], "dropped")

    def test_a_run_in_design_is_in_nobodys_way_and_joins_when_approved(self):
        a, b = self.run_of(), self.run_of()
        Q.reserve(a)                                                         # a started first, still at its spec gate
        Q.reserve(b)
        self.assertEqual(Q.wait_turn(b, poll_s=0.01)["state"], "implementing")   # b was approved first: no wait
        sa = Q.mine(self.store, a.run)
        self.assertEqual((sa["state"], sa.get("order")), ("reserved", None))   # untouched, never ignored
        Q.check_mine(a)                                                      # a goes on
        Q.planned(a)
        self.assertEqual((Q.mine(self.store, b.run)["order"], Q.mine(self.store, a.run)["order"]), (1, 2))
        self.assertEqual([s["run"] for s in Q.earlier(self.store, a.run)], [b.run])   # a builds on b
        self.assertEqual(Q.earlier(self.store, b.run), [])

    def test_an_ignored_slot_of_an_older_engine_still_stops_its_run(self):
        a = self.run_of()
        Q.reserve(a)
        row = Q.mine(self.store, a.run)
        row["state"] = "ignored"
        self.store.put(E_SLOT, row["id"], row, run=a.run)
        with self.assertRaises(Escalate) as cm:
            Q.check_mine(a)
        self.assertEqual(cm.exception.code, codes.QUEUE_SLOT_LOST)
        Q.push(a, "plan", {"plan": "late"})                                  # an ignored slot takes no more work
        self.assertNotIn("plan", Q.mine(self.store, a.run)["docs"])

    def test_first_approved_first_served(self):
        a, b, c = self.run_of(), self.run_of(), self.run_of()
        for x in (a, b, c):
            Q.reserve(x)
        Q.planned(c)                                                         # c approved first, then a
        Q.planned(a)
        self.assertEqual([s["run"] for s in Q.slots(self.store, "shop")], [c.run, a.run, b.run])
        self.assertEqual([s["run"] for s in Q.earlier(self.store, b.run)], [c.run, a.run])   # b still in design
        got = {}
        t = threading.Thread(target=lambda: got.update(Q.wait_turn(a, poll_s=0.01)))
        t.start()
        time.sleep(0.2)
        self.assertFalse(got)                                                # a waits for c, not for b
        self.assertEqual(self.store.get(E_RUN, a.run)["detail"]["queue_wait"]["head"]["run"], c.run)
        self.set_state(c.run, "green")
        Q.release(self.store, c.run)
        t.join(5)
        self.assertEqual(got.get("state"), "implementing")
        self.assertNotIn("queue_wait", self.store.get(E_RUN, a.run)["detail"])

    def test_the_fingerprint_moves_when_a_run_joins_or_leaves_unfinished_not_when_one_is_merged(self):
        a, b = self.run_of(), self.run_of()
        Q.reserve(a)
        Q.reserve(b)
        fp0 = Q.fingerprint(self.store, b.run)
        Q.push(a, "spec", {"spec": "x"})
        self.assertEqual(Q.fingerprint(self.store, b.run), fp0)             # a in design: nothing to build on
        Q.planned(a)
        fp1 = Q.fingerprint(self.store, b.run)
        self.assertNotEqual(fp1, fp0)                                        # a joined the queue
        self.assertEqual([s["run"] for s in Q.changed_since(self.store, b.run, fp0)], [a.run])
        self.assertIn("approved spec", Q.refresh_text(self.store, b.run, fp0))
        Q.wait_turn(a, poll_s=0.01)
        self.assertEqual(Q.fingerprint(self.store, b.run), fp1)             # its turn: no change of content
        Q.release(self.store, a.run, "done")
        self.assertEqual(Q.fingerprint(self.store, b.run), fp1)             # merged: b's drafts still hold
        c, d = self.run_of(), self.run_of()
        Q.reserve(c)
        Q.reserve(d)
        Q.push(c, "spec", {"spec": "y"})
        Q.planned(c)
        fp2 = Q.fingerprint(self.store, d.run)
        Q.release(self.store, c.run, "escalated")                            # left unfinished: take it back
        self.assertNotEqual(Q.fingerprint(self.store, d.run), fp2)
        self.assertIn("left the queue unfinished", Q.refresh_text(self.store, d.run, fp2))

    def test_joining_wakes_the_runs_waiting_at_a_draft_gate(self):
        woke = []
        old, Q.WAKER = Q.WAKER, woke.append
        try:
            a, b, c, d = self.run_of(), self.run_of(), self.run_of(), self.run_of()
            for x in (a, b, c, d):
                Q.reserve(x)
            for x, g in ((b, "spec"), (c, "plan"), (d, "needs")):
                row = self.store.get(E_RUN, x.run)
                row["detail"]["gate"] = {"name": g, "round": 1}
                self.store.put(E_RUN, x.run, row, run=x.run)
            row = self.store.get(E_RUN, c.run)
            row["detail"]["gated"] = {"pending": {"plan": {"decision": "approve"}}}   # c's person decided already
            self.store.put(E_RUN, c.run, row, run=c.run)
            Q.push(a, "spec", {"spec": "x"})
            self.assertEqual(woke, [])                                       # a in design: nobody to wake
            Q.planned(a)
            self.assertEqual(woke, [b.run])                                  # not c (decided), not d (needs gate)
        finally:
            Q.WAKER = old

    def test_policy_of_the_process(self):
        self.assertEqual(Q.check_policy(None), Q.DEFAULT_POLICY)
        self.assertEqual(Q.check_policy({"hold_until": "merged"})["hold_until"], "merged")
        for bad in ({"hold_until": "soon"}, {"enabled": "yes"}, {"serial_from": ""}, {"what": 1}, []):
            with self.assertRaises(ValueError):
                Q.check_policy(bad)
        steps = [{"id": "spec", "kind": "draft"}, {"id": "plan", "kind": "draft"}, {"id": "build", "kind": "build"},
                 {"id": "final", "kind": "review"}]
        self.assertEqual(Q.serial_step(steps, Q.DEFAULT_POLICY), 2)
        self.assertEqual(Q.serial_step(steps, dict(Q.DEFAULT_POLICY, serial_from="plan")), 1)
        self.assertEqual(Q.serial_step(steps, dict(Q.DEFAULT_POLICY, serial_from="review")), 3)
        self.assertEqual(Q.serial_step(steps, dict(Q.DEFAULT_POLICY, enabled=False)), 4)
        a = self.run_of()
        row = self.store.get(E_RUN, a.run)                                   # a process that does not queue
        row["detail"]["gated"] = {"process": {"def": {"queue": {"enabled": False}}}}
        self.store.put(E_RUN, a.run, row, run=a.run)
        self.assertIsNone(Q.reserve(a))
        b = self.run_of()
        row = self.store.get(E_RUN, b.run)
        row["detail"]["gated"] = {"process": {"def": {"queue": {"hold_until": "merged"}}}}
        self.store.put(E_RUN, b.run, row, run=b.run)
        Q.reserve(b)
        Q.wait_turn(b, poll_s=0.01)
        self.assertEqual(Q.merged(b)["end"], "merged")                       # let go once merged
        self.assertEqual(Q.wait_turn(b, poll_s=0.01)["state"], "done")       # already served: no second wait

    def test_planned_slot_is_waited_for_without_limit(self):
        Q.save_settings({"wait_minutes": 0}, "admin")
        a, b = self.run_of(), self.run_of()
        Q.reserve(a)
        Q.reserve(b)
        Q.planned(a)                                                         # a waits for its own turn / a person
        b.cancelled = False
        t = threading.Thread(target=lambda: self.assertRaises(Escalate, Q.wait_turn, b, 0.01))
        t.start()
        time.sleep(0.2)
        self.assertEqual(Q.mine(self.store, a.run)["state"], "planned")      # never ignored
        b.cancelled = True
        t.join(5)

    def test_requeue_joins_the_end_and_keeps_its_work(self):
        a, b = self.run_of(), self.run_of()
        Q.reserve(a)
        Q.push(a, "plan", {"plan": "# Implement plan"})
        Q.planned(a)
        Q.reserve(b)
        c = self.run_of()
        Q.reserve(c)
        Q.planned(c)                                                         # c joined after a
        new = Q.requeue(self.store, a.run)
        self.assertEqual((new["seq"], new["state"], new["docs"]["plan"], new["order"]),
                         (4, "planned", "# Implement plan", 3))
        self.assertEqual([s["run"] for s in Q.slots(self.store, "shop")], [c.run, a.run, b.run])   # a at the end
        self.assertEqual(len([r for r in self.store.query(E_SLOT, run=a.run)]), 2)

    def test_settings(self):
        self.assertEqual(Q.wait_minutes(), Q.DEFAULT_WAIT_MIN)
        self.assertEqual(Q.save_settings({"wait_minutes": "15"}, "admin"), {"wait_minutes": 15})
        with self.assertRaises(ValueError):
            Q.save_settings({"wait_minutes": -1})
        with self.assertRaises(ValueError):
            Q.save_settings({"wait_minutes": "soon"})
        v = Q.view(self.store, "shop")
        self.assertEqual((v["wait_minutes"], v["active"]), (15, []))


if __name__ == "__main__":
    unittest.main()
