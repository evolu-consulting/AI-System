"""line.seal.scancache on a real git repo, the rescan queue, and the simulator's verdict."""

from __future__ import annotations

import os
import shutil
import subprocess
import tempfile
import unittest

from line.seal.gitbench import extract
from line.seal.scancache import BlobCache, RescanQueue, VersionedGraph
from line.seal.sim import Params, Sim


def _git(repo: str, *args: str) -> str:
    return subprocess.run(["git", "-C", repo, *args], capture_output=True, text=True, check=True).stdout.strip()


def _write(repo: str, rel: str, text: str) -> None:
    full = os.path.join(repo, rel)
    os.makedirs(os.path.dirname(full) or repo, exist_ok=True)
    with open(full, "w", encoding="utf-8") as fh:
        fh.write(text)


class ScanCacheTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.mkdtemp(prefix="sealscan-")
        self.repo = os.path.join(self.tmp, "r")
        subprocess.run(["git", "init", "-q", "-b", "main", self.repo], check=True)
        _git(self.repo, "config", "user.email", "t@example.com")
        _git(self.repo, "config", "user.name", "t")
        for i in range(20):
            _write(self.repo, "m/f%02d.py" % i, "def f%d(x):\n    return x\n" % i)
        _write(self.repo, "m/same_a.py", "def shared():\n    pass\n")
        _write(self.repo, "m/same_b.py", "def shared():\n    pass\n")       # same blob, other path
        _git(self.repo, "add", "-A")
        _git(self.repo, "commit", "-q", "-m", "base")
        self.base = _git(self.repo, "rev-parse", "HEAD")

    def tearDown(self) -> None:
        shutil.rmtree(self.tmp, ignore_errors=True)

    def commit(self, edits: dict, delete=()) -> str:
        for p, t in edits.items():
            _write(self.repo, p, t)
        for p in delete:
            _git(self.repo, "rm", "-q", p)
        _git(self.repo, "add", "-A")
        _git(self.repo, "commit", "-q", "-m", "c")
        return _git(self.repo, "rev-parse", "HEAD")

    def test_only_changed_blobs_are_extracted_and_as_of_is_exact(self) -> None:
        cache = BlobCache()
        g = VersionedGraph(self.repo, cache, extract)
        g.snapshot(self.base)
        self.assertEqual(g.files_extracted, 21)                 # 22 files, two share one blob (same ext)
        s1 = self.commit({"m/f01.py": "def g1(x):\n    return 1\n", "m/new.py": "class New:\n    pass\n"},
                         delete=["m/f02.py"])
        changed = g.advance(s1)
        self.assertEqual(changed, {"m/f01.py", "m/new.py", "m/f02.py"})
        self.assertEqual(g.files_extracted, 23)                 # two new blobs, the delete costs nothing
        s2 = self.commit({"m/f03.py": "def f1(x):\n    return x\n"})          # content already seen as f01
        g.advance(s2)
        self.assertEqual(g.files_extracted, 23)                 # cache hit by blob: nothing extracted
        self.assertEqual(g.as_of(self.base)["m/f01.py"], {"names": ["f1"]})
        self.assertEqual(g.as_of(s1)["m/f01.py"], {"names": ["g1"]})
        self.assertNotIn("m/f02.py", g.as_of(s1))
        self.assertIn("m/f02.py", g.as_of(self.base))
        fresh = VersionedGraph(self.repo, BlobCache(), extract)
        fresh.snapshot(s2)
        self.assertEqual(fresh.as_of(s2), g.as_of(s2))
        self.assertEqual(g.stale(s1, ["m/f03.py", "m/f05.py"]), {"m/f03.py"})
        self.assertEqual(g.stale(s2, ["m/f03.py"]), set())

    def test_cache_dir_is_shared_across_graphs(self) -> None:
        d = os.path.join(self.tmp, "cache")
        VersionedGraph(self.repo, BlobCache(d), extract).snapshot(self.base)
        g2 = VersionedGraph(self.repo, BlobCache(d), extract)
        g2.snapshot(self.base)
        self.assertEqual(g2.files_extracted, 0)


class RescanQueueTests(unittest.TestCase):
    def test_coalesced_single_flight_priority(self) -> None:
        q = RescanQueue()
        q.request("r1", "s1", 1)
        q.request("r1", "s2", 0)                                # coalesced: newest sha, highest priority
        q.request("r2", "t1", 5)
        self.assertEqual(q.next(), ("r2", "t1"))
        self.assertEqual(q.next(), ("r1", "s2"))
        q.request("r1", "s3", 0)                                # arrives while r1 runs
        self.assertIsNone(q.next())                             # single flight
        q.done("r1")
        self.assertEqual(q.next(), ("r1", "s3"))
        self.assertEqual((q.requests, q.runs, q.coalesced), (4, 3, 1))


class SimTests(unittest.TestCase):
    def test_invariants_hold_and_optimised_wins_under_load(self) -> None:
        for fr in (0.0, 0.3):
            p = Params(batches=30, interarrival=2.0, fail_rate=fr, seed=3)
            base, opt = Sim(p, False).run(), Sim(p, True).run()
            for r in (base, opt):
                self.assertEqual(r["unfinished"], 0)
                for k in r:
                    if k.startswith("ok_"):
                        self.assertTrue(r[k], (fr, r["mode"], k))
            self.assertLess(opt["wall"], base["wall"])
            self.assertLess(opt["files_scanned"], base["files_scanned"] / 10)
            self.assertEqual(base["redo_taint"], 0)             # baseline never speculates

    def test_deterministic(self) -> None:
        p = Params(batches=20, interarrival=3.0, fail_rate=0.2, seed=9)
        self.assertEqual(Sim(p, True).run(), Sim(p, True).run())


if __name__ == "__main__":
    unittest.main()
