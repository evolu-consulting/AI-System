"""line.seal wired into the engine (LINE_SEAL=1, LINE_SCAN_CACHE): config, ledger persistence, the dispatch
claim hook, verifier evidence, scoring (deterministic and fixture), taint + requeue, the merge-queue gate,
sign-off, and the migration scan cache (prompt-keyed model answers, as-of freshness)."""

from __future__ import annotations

import os
import shutil
import subprocess
import tempfile
import unittest
from typing import Any, Dict, List

from line import codes
from line.build import verifier
from line.build.sandbox import Diff
from line.config import load_config
from line.contracts import (E_ACC_TEST, E_GATE, E_SEAL, E_SEAL_ENTRY, E_UNIT, LlmResult, Unit, UnitState,
                            from_dict)
from line.lease import SqliteLeases
from line.migrate import scancache
from line.scope import ScopedLeases, ScopedStore
from line.seal import wire
from line.seal.ledger import SealLedger
from line.statemachine import StateMachine
from line.store import SqliteStore

RUN = "R1"
EV = {"cmd": "python -m unittest tests.t", "output": "Ran 2 tests\n\nOK", "exit_code": 0}


def cfg(**kw: Any) -> Any:
    base = dict(seal_enabled=True, llm="fake", dry_pack="")
    base.update(kw)
    return load_config(env={}, line_json=None, rag_local_json=None, **base)


class Stub:
    """The parts of a Pipeline that RunSeal uses."""

    def __init__(self, c: Any = None):
        self.cfg = c or cfg()
        self.run = RUN
        self.store = SqliteStore(":memory:")
        self.sstore = ScopedStore(self.store, RUN)
        self.leases = SqliteLeases(self.store, ttl_s=300)
        self.sleases = ScopedLeases(self.leases, RUN)
        self.sm = StateMachine(self.sstore, "t", "m")
        self.repo = tempfile.mkdtemp(prefix="seal-wire-")
        self.logs: List[str] = []
        self.ladder: List[tuple] = []
        self.enqueued: List[str] = []
        self.cleaned: List[str] = []
        me = self

        class MQ:
            def enqueue(self, run: str, uid: str) -> None:
                me.enqueued.append(uid)

        class SB:
            def cleanup(self, row: Any) -> None:
                me.cleaned.append(row["id"])

        self.mq, self.sandbox = MQ(), SB()

    def log(self, m: str) -> None:
        self.logs.append(m)

    def _ladder(self, uid: str, code: str, key: str) -> None:
        self.ladder.append((uid, code))

    def unit(self, uid: str, state: str = "pending", deps=(), claims=("a.py",), tests=(), attempt: int = 0) -> None:
        self.sstore.put(E_UNIT, uid, {"id": uid, "run": RUN, "state": state, "deps": list(deps), "claims": list(claims),
                                      "tests": list(tests), "attempt": attempt, "detail": {}})

    def verified(self, uid: str, n: int, tests: int = 2, passed: int = 2, ev: Dict[str, Any] = EV) -> None:
        row = self.sstore.get(E_UNIT, uid)
        row.update(state="verified", attempt=n)
        self.sstore.put(E_UNIT, uid, row)
        self.sstore.put(E_GATE, "%s#%d:verify" % (uid, n),
                        {"gate": {"ok": True, "code": "", "detail": {"tests": tests, "passed": passed}}, "unit": uid,
                         "attempt": n, "evidence_item": dict(ev) if ev else None})


def dispatch(seal: wire.RunSeal, st: Stub, uid: str) -> int:
    row = st.sstore.get(E_UNIT, uid)
    u = from_dict(Unit, row)
    n = int(row.get("attempt") or 0) + 1
    if not seal.claim(u, n):
        return 0
    row.update(state="leased", attempt=n)
    st.sstore.put(E_UNIT, uid, row)
    seal.started(from_dict(Unit, row), n, "")
    return n


class ConfigTests(unittest.TestCase):
    def test_off_by_default_and_env(self) -> None:
        c = load_config(env={}, line_json=None, rag_local_json=None)
        self.assertFalse(c.seal_enabled)
        self.assertEqual((c.seal_depth, c.seal_governor_fail, c.seal_l2_paths, c.scan_cache), (2, 0.2, [], ""))
        c = load_config(env={"LINE_SEAL": "1", "LINE_SEAL_DEPTH": "1", "LINE_SEAL_GOVERNOR_FAIL": "0.3",
                             "LINE_SEAL_L2_PATHS": "db/*,srv/*", "LINE_SCAN_CACHE": "1"}, line_json=None,
                        rag_local_json=None)
        self.assertEqual((c.seal_enabled, c.seal_depth, c.seal_governor_fail, c.seal_l2_paths, c.scan_cache),
                         (True, 1, 0.3, ["db/*", "srv/*"], "1"))
        self.assertFalse(wire.enabled(load_config(env={}, line_json=None, rag_local_json=None)))

    def test_codes_and_kinds(self) -> None:
        for k in codes.SEAL_KINDS:
            self.assertIn(k, codes.EVENT_KINDS)
        for c in (codes.SEAL_REJECTED, codes.SEAL_TAINTED_CODE, codes.SEAL_SIGNOFF):
            self.assertIn(c, codes.ALL_CODES)


class LedgerPersistenceTests(unittest.TestCase):
    def test_sink_and_replay_keep_the_chain(self) -> None:
        rows: List[Dict[str, Any]] = []
        L = SealLedger(sink=rows.append)
        L.freeze_gates("s", [{"test": "T1"}], approver="a", builder="b")
        L.build_started("s")
        L2 = SealLedger(entries=list(reversed(rows)))
        self.assertTrue(L2.verify())
        self.assertEqual(L2.state("s"), "building")
        self.assertEqual(L2.entries(), L.entries())


class HookTests(unittest.TestCase):
    def setUp(self) -> None:
        self.st = Stub()
        self.st.unit("U1", "ready", claims=("x.py",))
        self.st.unit("U2", "ready", claims=("x.py",))
        self.seal = wire.RunSeal(self.st)

    def tearDown(self) -> None:
        shutil.rmtree(self.st.repo, ignore_errors=True)

    def test_claim_is_fenced_per_file_across_subjects(self) -> None:
        self.assertEqual(dispatch(self.seal, self.st, "U1"), 1)
        self.assertEqual(dispatch(self.seal, self.st, "U2"), 0)            # x.py is held by U1#1
        self.assertEqual(self.seal.ledger.state("R1:U1#1"), "building")
        self.assertEqual(self.st.store.query(E_SEAL_ENTRY, run=RUN)[0]["kind"], "gates")

    def test_submit_score_seal_enqueue_then_merge_gate(self) -> None:
        n = dispatch(self.seal, self.st, "U1")
        self.st.verified("U1", n)
        self.assertTrue(self.seal.on_attempt("U1", {"outcome": "SUBMIT", "verified": True, "attempt": n}))
        self.assertEqual(self.st.enqueued, [])                             # not before the score
        self.assertFalse(self.seal.merge_ok(RUN, "U1", n))
        out = self.seal.tick()
        self.assertEqual(out["sealed"], ["R1:U1#1"])
        self.assertEqual(self.st.enqueued, ["U1"])
        self.assertTrue(self.seal.merge_ok(RUN, "U1", n))
        self.assertEqual(dispatch(self.seal, self.st, "U2"), 1)            # the file lease was released at submit
        row = self.st.store.get(E_SEAL, "R1:U1#1")
        self.assertEqual((row["ledger_state"], row["rt_state"], row["total"]), ("sealed", "sealed", 100.0))
        self.assertTrue(SealLedger(entries=self.st.store.query(E_SEAL_ENTRY, run=RUN)).verify())

    def test_failed_attempt_is_voided_and_frees_claims(self) -> None:
        n = dispatch(self.seal, self.st, "U1")
        self.assertFalse(self.seal.on_attempt("U1", {"outcome": "SUBMIT", "verified": False, "attempt": n,
                                                     "gate_code": "TEST_FAIL"}))
        self.assertEqual(self.seal.ledger.state("R1:U1#1"), "void")
        self.assertEqual(dispatch(self.seal, self.st, "U2"), 1)

    def test_no_evidence_is_rejected_and_laddered(self) -> None:
        n = dispatch(self.seal, self.st, "U1")
        self.st.verified("U1", n, ev={})
        self.seal.on_attempt("U1", {"outcome": "SUBMIT", "verified": True, "attempt": n})
        out = self.seal.tick()
        self.assertEqual(out["rejected"], ["R1:U1#1"])
        self.assertEqual(self.st.sstore.get(E_UNIT, "U1")["state"], "ready")
        self.assertEqual(self.st.ladder, [("U1", codes.SEAL_REJECTED)])
        self.assertEqual(self.st.enqueued, [])

    def test_resume_rebuilds_queue_and_state(self) -> None:
        n = dispatch(self.seal, self.st, "U1")
        self.st.verified("U1", n)
        self.seal.on_attempt("U1", {"outcome": "SUBMIT", "verified": True, "attempt": n})
        again = wire.RunSeal(self.st)                                      # a new driver of the same run
        self.assertEqual(again.ledger.state("R1:U1#1"), "pending")
        self.assertEqual(again.tick()["sealed"], ["R1:U1#1"])


class SpeculationTests(unittest.TestCase):
    def setUp(self) -> None:
        self.st = Stub()
        self.st.unit("P", "ready", claims=("p.py",))
        self.st.unit("D", "pending", deps=("P",), claims=("d.py",))
        self.seal = wire.RunSeal(self.st)

    def tearDown(self) -> None:
        shutil.rmtree(self.st.repo, ignore_errors=True)

    def _producer_pending(self, ev: Dict[str, Any] = EV) -> int:
        n = dispatch(self.seal, self.st, "P")
        self.st.verified("P", n, ev=ev)
        self.seal.on_attempt("P", {"outcome": "SUBMIT", "verified": True, "attempt": n})
        return n

    def test_dependent_starts_on_pending_and_merges_after_producer(self) -> None:
        self._producer_pending()
        self.assertEqual(self.seal.promote(), ["D"])
        self.assertEqual(self.st.sstore.get(E_UNIT, "D")["detail"]["spec_on"], ["P"])
        n = dispatch(self.seal, self.st, "D")
        self.assertEqual(self.seal.rt.deps["R1:D#1"], {"R1:P#1"})
        self.st.verified("D", n)
        self.seal.on_attempt("D", {"outcome": "SUBMIT", "verified": True, "attempt": n})
        self.seal.tick()
        self.assertEqual(self.st.enqueued, ["P"])                           # D waits for P to be MERGED
        row = self.st.sstore.get(E_UNIT, "P")
        row["state"] = "merged"
        self.st.sstore.put(E_UNIT, "P", row)
        self.seal.tick()
        self.assertEqual(self.st.enqueued, ["P", "D"])

    def test_failed_producer_taints_and_requeues(self) -> None:
        self._producer_pending(ev={})                                      # will be rejected: no evidence
        self.seal.promote()
        n = dispatch(self.seal, self.st, "D")
        self.st.verified("D", n)
        self.seal.on_attempt("D", {"outcome": "SUBMIT", "verified": True, "attempt": n})
        out = self.seal.tick()
        self.assertEqual(out["rejected"], ["R1:P#1"])
        self.assertEqual(out["tainted"], ["R1:D#1"])
        self.assertEqual(self.seal.ledger.state("R1:D#1"), "void")
        self.assertEqual(self.st.sstore.get(E_UNIT, "D")["state"], "ready")
        self.assertNotIn("spec_on", self.st.sstore.get(E_UNIT, "D")["detail"])
        self.assertIn("D", self.st.cleaned)
        self.assertEqual(self.st.enqueued, [])
        self.assertEqual(self.seal.rt.violations(), [])

    def test_taint_while_building_is_applied_when_the_builder_returns(self) -> None:
        self._producer_pending(ev={})
        self.seal.promote()
        n = dispatch(self.seal, self.st, "D")
        self.seal.tick()                                                    # P rejected while D builds
        self.st.verified("D", n)
        self.assertTrue(self.seal.on_attempt("D", {"outcome": "SUBMIT", "verified": True, "attempt": n}))
        self.assertEqual(self.seal.ledger.state("R1:D#1"), "void")
        self.assertEqual(self.st.sstore.get(E_UNIT, "D")["state"], "ready")

    def test_depth_zero_or_governor_means_no_speculation(self) -> None:
        st = Stub(cfg(seal_depth=0))
        st.unit("P", "ready", claims=("p.py",))
        st.unit("D", "pending", deps=("P",))
        seal = wire.RunSeal(st)
        n = dispatch(seal, st, "P")
        st.verified("P", n)
        seal.on_attempt("P", {"outcome": "SUBMIT", "verified": True, "attempt": n})
        self.assertEqual(seal.promote(), [])
        for _ in range(10):
            self.seal.gov.record(False)
        self.assertFalse(self.seal.speculation_allowed())
        shutil.rmtree(st.repo, ignore_errors=True)


class SignoffTests(unittest.TestCase):
    def test_l2_waits_for_signoff_ask_and_is_signed_in_decide(self) -> None:
        for mode, signed in (("ask", False), ("decide", True)):
            st = Stub(cfg(seal_l2_paths=["db/*"], human_mode=mode))
            st.unit("U", "ready", claims=("db/x.cds",))
            seal = wire.RunSeal(st)
            n = dispatch(seal, st, "U")
            st.verified("U", n)
            seal.on_attempt("U", {"outcome": "SUBMIT", "verified": True, "attempt": n})
            out = seal.tick()
            if signed:
                self.assertEqual(st.enqueued, ["U"])
                self.assertEqual(seal.ledger.projection("R1:U#1").get("signed_by"), wire.SIGN_DECIDE)
            else:
                self.assertEqual(out["signoff"], ["R1:U#1"])
                self.assertEqual(seal.waiting_signoff(), ["R1:U#1"])
                row = wire.sign_subject(st.store, RUN, "R1:U#1", "rowan")
                self.assertEqual(row["ledger_state"], "sealed")
                again = wire.RunSeal(st)
                again.tick()
                self.assertEqual(st.enqueued, ["U"])
            shutil.rmtree(st.repo, ignore_errors=True)


class RefuseAndBoardTests(unittest.TestCase):
    def test_refused_signoff_rebuilds_the_unit_and_board_shows_seals(self) -> None:
        from line.contracts import E_RUN
        from line.server import board
        st = Stub(cfg(seal_l2_paths=["db/*"], human_mode="ask"))
        st.store.put(E_RUN, RUN, {"id": RUN, "state": "building", "created_ms": 1, "detail": {}})
        st.unit("U", "ready", claims=("db/x.cds",))
        seal = wire.RunSeal(st)
        n = dispatch(seal, st, "U")
        st.verified("U", n)
        seal.on_attempt("U", {"outcome": "SUBMIT", "verified": True, "attempt": n})
        seal.tick()
        with self.assertRaises(Exception):
            wire.sign_subject(st.store, RUN, "R1:U#1", "")                  # who is required
        row = wire.sign_subject(st.store, RUN, "R1:U#1", "rowan", "refuse")
        self.assertEqual((row["ledger_state"], row["refused_by"]), ("void", "rowan"))
        out = wire.RunSeal(st).tick()
        self.assertEqual(out["rejected"], ["R1:U#1"])
        self.assertEqual(st.sstore.get(E_UNIT, "U")["state"], "ready")
        self.assertEqual(st.ladder, [("U", codes.SEAL_REJECTED)])
        b = board(st.store, RUN)
        self.assertEqual([r["id"] for r in b["seals"]], ["R1:U#1"])
        self.assertNotIn("seals", board(SqliteStore(":memory:"), RUN))      # no seal rows: key absent
        shutil.rmtree(st.repo, ignore_errors=True)


class FixtureTests(unittest.TestCase):
    def test_dry_scorer_fixture(self) -> None:
        pack = tempfile.mkdtemp(prefix="seal-pack-")
        os.makedirs(os.path.join(pack, "dry", "seal"))
        with open(os.path.join(pack, "dry", "seal", "U#1.json"), "w") as fh:
            fh.write('{"purpose": 40, "evidence": 100, "love": 100, "docked": ["-60 on purpose"]}')
        st = Stub(cfg(dry_pack=pack))
        st.unit("U", "ready")
        seal = wire.RunSeal(st)
        n = dispatch(seal, st, "U")
        st.verified("U", n)
        seal.on_attempt("U", {"outcome": "SUBMIT", "verified": True, "attempt": n})
        self.assertEqual(seal.tick()["rejected"], ["R1:U#1"])
        self.assertEqual(st.store.get(E_SEAL, "R1:U#1")["total"], 40.0)
        shutil.rmtree(pack, ignore_errors=True)
        shutil.rmtree(st.repo, ignore_errors=True)


class VerifierEvidenceTests(unittest.TestCase):
    def test_gate_fills_evidence_only_when_asked(self) -> None:
        u = Unit(id="U", run=RUN, claims=["a.py"])
        wd = tempfile.mkdtemp(prefix="seal-gate-")
        with open(os.path.join(wd, "a.py"), "w") as fh:
            fh.write("X = 1\n")
        d = Diff(base="b", files=[("A", "a.py")], patch="+X = 1\n")
        ev: Dict[str, Any] = {}
        self.assertTrue(verifier.gate(u, wd, d, ev=ev).ok)
        self.assertTrue(ev["cmd"].startswith("python -m py_compile") and ev["exit_code"] == 0)
        self.assertTrue(verifier.gate(u, wd, d).ok)                        # unchanged call: no evidence param
        shutil.rmtree(wd, ignore_errors=True)


class MergeQueueGateTests(unittest.TestCase):
    def test_unsealed_item_is_refused_and_unit_stays_verified(self) -> None:
        from line.ship.merge_queue import MergeQueue
        store = SqliteStore(":memory:")
        repo = tempfile.mkdtemp(prefix="seal-mq-")
        subprocess.run(["git", "init", "-q", "-b", "main", repo], check=True)
        store.put(E_UNIT, "U", {"id": "U", "run": RUN, "state": "verified", "attempt": 1, "wave": 0}, run=RUN)
        mq = MergeQueue(store, repo, cfg())
        mq.seal_ok = lambda run, uid, n: False
        mq.enqueue(RUN, "U")
        o = mq.process_next(RUN)
        self.assertFalse(o.merged)
        self.assertEqual(o.detail.get("stage"), "seal")
        self.assertEqual(store.get(E_UNIT, "U")["state"], "verified")
        shutil.rmtree(repo, ignore_errors=True)


class ScanCacheTests(unittest.TestCase):
    def test_cache_dir_values(self) -> None:
        d = tempfile.mkdtemp(prefix="seal-sc-")
        self.assertEqual(scancache.cache_dir(cfg(scan_cache=""), d), "")
        self.assertEqual(scancache.cache_dir(cfg(scan_cache="1"), d), os.path.join(d, "scancache"))
        shared = os.path.join(d, "shared")
        self.assertEqual(scancache.cache_dir(cfg(scan_cache=shared), d), shared)
        shutil.rmtree(d, ignore_errors=True)

    def test_same_prompt_is_answered_from_the_cache(self) -> None:
        class Inner:
            calls = 0

            def complete(self, role: str, prompt: str, schema: Any = None, **kw: Any) -> Any:
                Inner.calls += 1
                return LlmResult({"n": Inner.calls}, "t", {}, 0.5, "m", "")
        d = tempfile.mkdtemp(prefix="seal-llm-")
        a = scancache.CachedLlm(Inner(), d)
        r1 = a.complete("migrate_inventory", "chunk A", {"x": 1}, key="k1", run="M")
        r2 = scancache.CachedLlm(Inner(), d).complete("migrate_inventory", "chunk A", {"x": 1}, key="k2", run="M")
        r3 = a.complete("migrate_inventory", "chunk B", {"x": 1}, run="M")
        self.assertEqual((r1.data, r2.data, r2.usd, r3.data), ({"n": 1}, {"n": 1}, 0.0, {"n": 2}))
        self.assertEqual(Inner.calls, 2)
        shutil.rmtree(d, ignore_errors=True)

    def test_freshness_names_the_changed_paths(self) -> None:
        repo = tempfile.mkdtemp(prefix="seal-fresh-")
        g = lambda *a: subprocess.run(["git", "-C", repo, "-c", "user.name=t", "-c", "user.email=t@t", *a],  # noqa
                                      check=True, capture_output=True, text=True).stdout.strip()
        subprocess.run(["git", "init", "-q", "-b", "main", repo], check=True)
        for name in ("a.py", "b.py", "c.py"):
            with open(os.path.join(repo, name), "w") as fh:
                fh.write("def %s_fn():\n    return 1\n" % name[0])
        g("add", "-A")
        g("commit", "-q", "-m", "one")
        scanned = g("rev-parse", "HEAD")
        d = tempfile.mkdtemp(prefix="seal-fresh-c-")
        self.assertEqual(scancache.freshness(d, repo, scanned, ["a.py"])["changed"], [])
        with open(os.path.join(repo, "b.py"), "a") as fh:
            fh.write("X = 2\n")
        g("commit", "-q", "-am", "two")
        fr = scancache.freshness(d, repo, scanned, ["a.py", "b.py"])
        self.assertEqual((fr["changed"], fr["stale"]), (["b.py"], ["b.py"]))
        fr2 = scancache.freshness(d, repo, scanned, ["a.py"])
        self.assertEqual(fr2["stale"], [])
        self.assertEqual(fr2["extracted"], 0)                               # every blob came from the cache
        shutil.rmtree(repo, ignore_errors=True)
        shutil.rmtree(d, ignore_errors=True)


if __name__ == "__main__":
    unittest.main()
