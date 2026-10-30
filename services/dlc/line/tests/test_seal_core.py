"""line.seal: score, ledger (gates frozen, builder != scorer, ratchet, hash chain), resources (claims with
fencing, MVCC reads, speculation depth, taint cascade), scheduler (critical path, backpressure, governor)."""

from __future__ import annotations

import os
import tempfile
import unittest

from line.seal import DepthExceeded, GateFrozen, LedgerError, ResourceTable, Score, SealLedger, StaleClaim, judge
from line.seal.ledger import gates_sha
from line.seal.scheduler import Backpressure, ScoreQueue, SpeculationGovernor, start_mode, waiting_on
from line.seal.score import level_for

EV = [{"cmd": "python -m unittest", "exit_code": 0, "output": "Ran 3 tests\nOK"}]


def good(**kw):
    d = dict(purpose=95, evidence=98, love=97, docked=["-3: no load test"], evidence_items=EV)
    d.update(kw)
    return Score(**d)


class ScoreTests(unittest.TestCase):
    def test_multiplied_not_averaged(self) -> None:
        self.assertEqual(good().total, 90.31)                   # 95 x 98 x 97 / 10000
        v = judge(good(love=0), "forge", "assay")
        self.assertFalse(v.sealed)
        self.assertEqual(v.total, 0.0)                          # an average would have said ~64

    def test_threshold_docked_evidence_and_scorer(self) -> None:
        self.assertTrue(judge(good(), "forge", "assay").sealed)
        self.assertFalse(judge(good(purpose=90), "forge", "assay").sealed)          # 85.5 < 90
        self.assertIn("docked section missing", judge(good(docked=None), "forge", "assay").reasons)
        self.assertTrue(judge(good(docked=[]), "forge", "assay").sealed)              # present, nothing docked
        self.assertFalse(judge(good(evidence_items=[{"note": "looks fine"}]), "forge", "assay").sealed)
        self.assertFalse(judge(good(), "forge", "forge").sealed)

    def test_levels(self) -> None:
        self.assertEqual(level_for(), "L0")
        self.assertEqual(level_for(shared_writers=1), "L1")
        self.assertEqual(level_for(touches_trunk=True), "L2")
        self.assertEqual(level_for(unknown_impact=True), "L2")                       # unknown is never 'none'
        self.assertTrue(judge(good(), "forge", "assay", "L2").needs_signoff)


class LedgerTests(unittest.TestCase):
    def gated(self, L: SealLedger, s: str = "B1#0") -> str:
        sha = L.freeze_gates(s, [{"test": "t1"}], approver="judge", builder="forge")
        L.build_started(s)
        L.submit(s, sha, EV)
        return sha

    def test_gates_frozen_and_not_by_builder(self) -> None:
        L = SealLedger()
        with self.assertRaises(LedgerError):
            L.freeze_gates("B1#0", [{"t": 1}], approver="forge", builder="forge")
        L.freeze_gates("B1#0", [{"t": 1}], approver="judge", builder="forge")
        L.freeze_gates("B1#0", [{"t": 2}], approver="judge", builder="forge")         # before the build: allowed
        L.build_started("B1#0")
        with self.assertRaises(GateFrozen):
            L.freeze_gates("B1#0", [{"t": 3}], approver="judge", builder="forge")
        with self.assertRaises(GateFrozen):
            L.submit("B1#0", gates_sha([{"t": 1}]))                                    # gates changed underneath

    def test_ratchet_and_correction(self) -> None:
        L = SealLedger()
        self.gated(L)
        self.assertTrue(L.score("B1#0", good(), scorer="assay").sealed)
        with self.assertRaises(LedgerError):
            L.score("B1#0", good(evidence=0), scorer="assay")                          # never revised
        L.correct("B1#0", "wrong mapping found later", "B1#1")
        self.assertEqual(L.state("B1#0"), "sealed")                                    # still there
        self.assertTrue(L.verify())

    def test_l2_signoff_and_void(self) -> None:
        L = SealLedger()
        self.gated(L)
        L.score("B1#0", good(), scorer="assay", level="L2")
        self.assertEqual(L.state("B1#0"), "awaiting_signoff")
        with self.assertRaises(LedgerError):
            L.sign("B1#0", by="assay")
        L.sign("B1#0", by="rowan")
        self.assertEqual(L.state("B1#0"), "sealed")
        self.gated(L, "B2#0")
        L.void("B2#0", "tainted by B9")
        self.assertEqual(L.state("B2#0"), "void")
        self.assertTrue(L.verify())

    def test_hash_chain_detects_tampering_and_persists(self) -> None:
        d = tempfile.mkdtemp()
        p = os.path.join(d, "ledger.jsonl")
        L = SealLedger(p)
        self.gated(L)
        L.score("B1#0", good(), scorer="assay")
        again = SealLedger(p)
        self.assertEqual(again.state("B1#0"), "sealed")
        self.assertTrue(again.verify())
        again._entries[2]["body"]["evidence"] = []                                     # tamper
        self.assertFalse(again.verify())


class ResourceTests(unittest.TestCase):
    def test_one_writer_and_fencing(self) -> None:
        T = ResourceTable()
        c1 = T.claim("a", "B1", now=0, ttl=10)
        self.assertIsNone(T.claim("a", "B2", now=1))
        c2 = T.claim("a", "B2", now=11)                         # expired -> taken over, new epoch
        self.assertGreater(c2.epoch, c1.epoch)
        with self.assertRaises(StaleClaim):
            T.begin_write(c1, "B1", now=12)
        T.begin_write(c2, "B2", now=12)

    def test_reads_default_to_sealed_and_speculation_is_recorded(self) -> None:
        T = ResourceTable()
        T.begin_write(T.claim("a", "B1", 0), "B1", 0)
        T.finish_build("B1")
        self.assertEqual(T.read("a", "B2"), "base")             # default: last sealed
        self.assertEqual(T.deps.get("B2"), None)
        vid = T.read("a", "B3", "speculative")
        self.assertTrue(vid.startswith("B1@"))
        self.assertEqual(T.deps["B3"], {"B1"})
        T.freeze_contract("a", "c1")
        self.assertEqual(T.read("a", "B4", "contract"), "contract:c1")
        self.assertNotIn("B4", T.deps)                          # contract: no dependency

    def test_seal_waits_for_producers(self) -> None:
        T = ResourceTable()
        T.begin_write(T.claim("a", "B1", 0), "B1", 0)
        T.finish_build("B1")
        T.read("a", "B2", "speculative")
        T.begin_write(T.claim("b", "B2", 0), "B2", 0)
        T.finish_build("B2")
        self.assertFalse(T.can_finalize("B2"))
        with self.assertRaises(ValueError):
            T.seal("B2")
        T.seal("B1")
        T.seal("B2")
        self.assertEqual(T.violations(), [])

    def test_taint_cascade_and_depth_limit(self) -> None:
        T = ResourceTable(depth_limit=2)
        for prod, res, reader in (("B1", "a", "B2"), ("B2", "b", "B3")):
            T.begin_write(T.claim(res, prod, 0), prod, 0)
            T.finish_build(prod)
            T.read(res, reader, "speculative")
        T.begin_write(T.claim("c", "B3", 0), "B3", 0)
        T.finish_build("B3")
        with self.assertRaises(DepthExceeded):                  # B4 on B3 would be depth 3
            T.read("c", "B4", "speculative")
        self.assertEqual(sorted(T.fail("B1")), ["B2", "B3"])
        self.assertEqual(T.batch_state["B3"], "tainted")
        self.assertEqual(T.read("a", "B9"), "base")             # failed versions are never served

    def test_baseline_mode_blocks_on_pending(self) -> None:
        T = ResourceTable(speculation=False)
        T.begin_write(T.claim("a", "B1", 0), "B1", 0)
        T.finish_build("B1")
        self.assertIsNone(T.claim("a", "B2", 1))
        with self.assertRaises(DepthExceeded):
            T.read("a", "B2", "speculative")


class SchedulerTests(unittest.TestCase):
    def test_critical_path_first_and_l1_deferred_under_load(self) -> None:
        q = ScoreQueue(Backpressure(soft=2))
        q.push("lonely_l1", "L1", 0, now=0)
        q.push("x", "L0", 0, now=1)
        q.push("y", "L0", 0, now=2)
        q.push("hub", "L1", 3, now=3)                           # three batches wait on it
        self.assertEqual(q.pop(), "hub")
        self.assertEqual(q.pop(), "x")

    def test_waiting_on_is_transitive(self) -> None:
        self.assertEqual(waiting_on({"B2": {"B1"}, "B3": {"B2"}, "B4": set()}, "B1"), 2)

    def test_start_mode(self) -> None:
        self.assertEqual(start_mode(["a"], ["b"], {}, set()), "clean")
        self.assertEqual(start_mode(["a"], ["b"], {"a": 0}, set()), "speculative")
        self.assertEqual(start_mode(["a"], ["b"], {"a": 0}, set(), contract_reads=["a"]), "clean")
        self.assertEqual(start_mode(["a"], ["b"], {"a": 2}, set()), "wait")
        self.assertEqual(start_mode(["a"], ["b"], {}, {"b"}), "wait")
        self.assertEqual(start_mode(["a"], ["b"], {"a": 0}, set(), allow_speculation=False), "wait")

    def test_governor(self) -> None:
        g = SpeculationGovernor(window=10, max_fail=0.2, min_samples=5)
        for ok in (True, True, False, False):
            g.record(ok)
        self.assertTrue(g.allow())                              # too few samples
        g.record(False)
        self.assertFalse(g.allow())
        for _ in range(10):
            g.record(True)
        self.assertTrue(g.allow())


if __name__ == "__main__":
    unittest.main()
