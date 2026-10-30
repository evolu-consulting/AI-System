"""Feature migration (flow 4): tree, inventory, confirmation pass, matrix, conflicts, blast radius, spec
generation, the v2 suite compare and the resumable runner. Dry: the fake model and samples/migrate-pair."""

from __future__ import annotations

import json
import os
import shutil
import tempfile
import unittest
from types import SimpleNamespace

from line import codes
from line.codes import LineError
from line.config import load_config
from line.contracts import E_MIG_CONFLICT, E_MIGRATION, ENTITIES
from line.e2e.migrate_pair import make_pair
from line.migrate import Migrator, view
from line.migrate import blast, conflicts, matrix, specgen, verify
from line.migrate.inventory import inventory, normalize
from line.migrate.match import match
from line.migrate.tree import Tree
from line.ship._util import git
from line.store import SqliteStore


class StubLlm:
    """complete(role, ..., key=K) -> answers[(role, K)] (or answers[role])."""

    def __init__(self, answers):
        self.answers, self.calls = answers, []

    def complete(self, role, prompt, schema=None, *, key="", model=None, run=""):
        self.calls.append((role, key))
        data = self.answers.get((role, key), self.answers.get(role))
        if data is None:
            raise LineError(codes.LLM_ERROR, "no stub answer for %s/%s" % (role, key))
        return SimpleNamespace(data=data)


def _text(path):
    with open(path, encoding="utf-8") as fh:
        return fh.read()


def _cfg(work, **kw):
    return load_config(env={}, line_json=None, rag_local_json=None, llm="fake", dry_pack="migrate-pair",
                       workroot=os.path.join(work, "work"), db=os.path.join(work, "line.db"), deploy_windows=[], **kw)


class Base(unittest.TestCase):
    def setUp(self):
        self.work = tempfile.mkdtemp(prefix="mig-test-")
        self.pair = make_pair(os.path.join(self.work, "pair"))

    def tearDown(self):
        shutil.rmtree(self.work, ignore_errors=True)


class TreeTests(Base):
    def test_ref_reading_and_find(self):
        base = Tree(self.pair["v1"], "vanilla")
        head = Tree(self.pair["v1"])
        self.assertNotIn("export_csv", base.read("shop.py"))
        self.assertIn("export_csv", head.read("shop.py"))
        self.assertTrue(head.contains("shop.py", 'lines   =   ["name,price"]'))   # whitespace-normalized
        self.assertEqual(head.chunks(10 ** 6)[0][0], "all")
        self.assertGreater(len(head.chunks(500)), 1)
        v2 = Tree(self.pair["v2"])
        self.assertEqual(v2.find(["export"]), {"export": ["store/cli.py"]})
        with self.assertRaises(LineError):
            Tree(self.pair["v1"], "no-such-ref")

    def test_config_files_are_not_proof(self):
        with open(os.path.join(self.pair["v2"], "features.json"), "w") as fh:
            json.dump({"planned": ["export_csv"]}, fh)
        self.assertEqual(Tree(self.pair["v2"]).find(["export_csv"]), {})
        self.assertEqual(Tree(self.pair["v2"]).find(["export_csv"], source_only=False), {"export_csv": ["features.json"]})


class InventoryAndMatchTests(Base):
    def test_quotes_are_checked(self):
        f = normalize({"id": "x y", "name": "X", "evidence": [{"path": "shop.py", "quote": "def add_item(book, name, price):"},
                                                            {"path": "shop.py", "quote": "not in the file"}]},
                      "v1", Tree(self.pair["v1"]))
        self.assertEqual(f["id"], "v1.x-y")
        self.assertEqual([e["verified"] for e in f["evidence"]], [True, False])

    def test_inventory_unproven_and_confirm_pass(self):
        cfg = _cfg(self.work)
        from line.llm import make_llm
        llm = make_llm(cfg)
        t1, t2 = Tree(self.pair["v1"]), Tree(self.pair["v2"])
        inv1, inv2 = inventory(t1, "v1", llm), inventory(t2, "v2", llm)
        self.assertEqual([f["id"] for f in inv1["unproven"]], ["v1.loyalty-points"])
        m = match(inv1, inv2, t1, t2, llm)
        self.assertEqual({(p["v1"], p["relation"]) for p in m["pairs"]},
                         {("v1.add-item", "same"), ("v1.order-discount", "conflict")})
        exp = [c for c in m["confirm"] if c["feature"] == "v1.export-csv"][0]
        self.assertEqual((exp["verdict"], list(exp["hits"])), ("absent", ["export"]))
        rows = matrix.rows(inv1, inv2, m, base=Tree(self.pair["v1"], "vanilla"))
        self.assertEqual(sorted((r["class"], r["custom"]) for r in rows),
                         [("both_conflict", False), ("both_same", False), ("v1_only", True), ("v2_only", False)])

    def test_confirm_present_pairs_a_renamed_feature(self):
        t1, t2 = Tree(self.pair["v1"]), Tree(self.pair["v2"])
        f1 = normalize({"id": "add", "name": "Add", "identifiers": ["create_item"],
                        "evidence": [{"path": "shop.py", "quote": "def add_item(book, name, price):"}]}, "v1", t1)
        f2 = normalize({"id": "create", "name": "Create", "identifiers": ["create_item"],
                        "evidence": [{"path": "store/items.py", "quote": "def create_item(book, name, price):"}]}, "v2", t2)
        llm = StubLlm({"migrate_match": {"pairs": []},
                       ("migrate_confirm", "v1.add"): {"verdict": "present", "partner": "v2.create", "relation": "same"},
                       ("migrate_confirm", "v2.create"): {"verdict": "absent"}})
        m = match({"features": [f1]}, {"features": [f2]}, t1, t2, llm)
        self.assertEqual([(p["v1"], p["v2"], p["confirmed"]) for p in m["pairs"]], [("v1.add", "v2.create", True)])
        rows = matrix.rows({"features": [f1]}, {"features": [f2]}, m)
        self.assertEqual([(r["class"], r["confidence"]) for r in rows], [("both_same", "medium")])

    def test_scope_filter(self):
        f = {"id": "v1.a", "name": "Export items", "behaviour": "", "evidence": [{"path": "billing/x.py"}]}
        self.assertTrue(matrix.in_scope(f, ["billing"]))
        self.assertTrue(matrix.in_scope(f, ["EXPORT"]))
        self.assertFalse(matrix.in_scope(f, ["payroll"]))


class PiecesTests(Base):
    def test_blast_import_graph(self):
        t2 = Tree(self.pair["v2"])
        g = blast.import_graph(t2)
        self.assertIn("store/items.py", g["store/cli.py"])
        self.assertIn("store/cli.py", blast.reverse_closure(g, {"store/items.py"}))

    def test_verify_parse_and_regressions(self):
        out = ("test_a (pkg.mod.T) ... ok\ntest_b (pkg.mod.T.test_b) ... FAIL\n"
               "test_c (pkg.mod.T)\nA docstring line ... ok\ntest_d (pkg.mod.T) ... skipped 'x'\n")
        self.assertEqual(verify.parse(out), {"pkg.mod.T.test_a": "ok", "pkg.mod.T.test_b": "fail",
                                             "pkg.mod.T.test_c": "ok", "pkg.mod.T.test_d": "skip"})
        before = {"tests.test_store.T.a": "ok", "tests.test_store.T.b": "ok", "tests.other.T.c": "fail"}
        after = {"tests.test_store.T.a": "fail", "tests.test_store.T.b": "ok"}
        self.assertEqual(verify.regressions(before, after), ["tests.test_store.T.a"])
        self.assertEqual(verify.regressions(before, after, ["tests.test_store"]), [])

    def test_specgen_order_and_adopt(self):
        by = {"v1.a": {"name": "A", "behaviour": "a does x.", "entities": ["order"], "examples": []},
              "v1.b": {"name": "B", "behaviour": "b does y.", "entities": ["item"],
                       "examples": [{"given": "g", "when": "w", "then": "t"}]},
              "v1.c": {"name": "C", "behaviour": "c reads items.", "entities": ["item"], "examples": []}}
        ch = [{"feature": "v1.a", "kind": "port"}, {"feature": "v1.b", "kind": "port"},
              {"feature": "v1.c", "kind": "adopt_v1"}]
        out = specgen.pack(os.path.join(self.work, "pk"), "T", ch, by, [{"v1": "v1.c", "v2_behaviour": "c reads less."}])
        self.assertEqual([i["feature"] for i in out["items"]], ["v1.b", "v1.c", "v1.a"])
        self.assertIn("## F2 Use the v1 behaviour for C", out["spec"])
        self.assertIn("- Given g, when w, then t.", out["spec"])
        self.assertTrue(os.path.isfile(os.path.join(self.work, "pk", "pack.json")))

    def test_question_and_backup(self):
        c = {"id": "C1", "row": "R2", "name": "Discount", "v1": "v1.d", "v2": "v2.d", "difference": "10 vs 5",
             "v1_behaviour": "10%", "v2_behaviour": "5%", "choice": "v2", "who": "pm"}
        q = conflicts.question(c)
        self.assertEqual([o["id"] for o in q["options"]], ["v2", "v1"])
        self.assertTrue(q["options"][0]["recommended"])
        path = conflicts.write_backup(os.path.join(self.work, "b"), c, {"behaviour": "10% off", "evidence": []})
        self.assertIn("10% off", _text(path))

    def test_codes_and_entities(self):
        for k in codes.MIG_KINDS:
            self.assertIn(k, codes.EVENT_KINDS)
        self.assertTrue(codes.is_code(codes.PARITY_REGRESSION) and codes.is_code(codes.STACK_UNSUPPORTED))
        self.assertTrue({E_MIGRATION, E_MIG_CONFLICT} <= ENTITIES)


class RunnerTests(Base):
    def _m(self, **kw):
        cfg = _cfg(self.work, **kw)
        self.store = SqliteStore(cfg.db)
        self.addCleanup(self.store.close)
        return Migrator(self.store, cfg), cfg

    def test_ask_parks_then_answer_continues(self):
        m, cfg = self._m()
        mid = m.admit(dict(self.pair, mode="ask", build=False))
        row = m.drive(mid)
        self.assertEqual(row["state"], "parked")
        v = view(self.store, mid)
        self.assertEqual([q["conflict"] for q in v["questions"]], ["C1"])
        with self.assertRaises(LineError):
            m.answer(mid, [{"conflict": "C1", "choice": "both"}])
        with self.assertRaises(LineError):
            m.answer(mid, [{"conflict": "C9", "choice": "v2"}])
        res = m.answer(mid, [{"conflict": "C1", "choice": "v1"}], who="pm")
        self.assertTrue(res["resume"])
        row = m.drive(mid)
        self.assertEqual((row["state"], row["code"]), ("analysed", ""))
        d = os.path.join(cfg.workroot, "migrations", mid)
        b = json.loads(_text(os.path.join(d, "blast.json")))
        self.assertEqual(sorted(c["kind"] for c in b["changes"]), ["adopt_v1", "port"])
        spec = _text(os.path.join(d, "pack", "spec.md"))
        self.assertIn("Use the v1 behaviour for Order total with discount", spec)
        self.assertFalse(os.path.isdir(os.path.join(d, "backup")))      # v1 chosen: nothing of v1 to keep aside
        log = [json.loads(l) for l in _text(os.path.join(d, "decisions.jsonl")).splitlines()]
        self.assertEqual([(x["conflict"], x["choice"], x["who"]) for x in log], [("C1", "v1", "pm")])

    def test_decide_mode_keeps_v2_with_backup(self):
        m, cfg = self._m()
        mid = m.admit(dict(self.pair, mode="decide", build=False))
        row = m.drive(mid)
        self.assertEqual(row["state"], "analysed")
        c = view(self.store, mid)["conflicts"][0]
        self.assertEqual((c["choice"], c["who"]), ("v2", "model (decide mode)"))
        self.assertTrue(os.path.isfile(c["backup"]))
        self.assertIn("10 percent", _text(c["backup"]))
        rep = _text(os.path.join(cfg.workroot, "migrations", mid, "report.md"))
        self.assertIn("v1 only (ported): 1, of which custom: 1", rep)

    def test_unsupported_stack_ends_analysed(self):
        js = os.path.join(self.work, "js")
        os.makedirs(js)
        git(js, "init", "-q")
        git(js, "symbolic-ref", "HEAD", "refs/heads/main")
        with open(os.path.join(js, "index.js"), "w") as fh:
            fh.write("function createItem(book, name, price) { return 1 }\n")
        git(js, "add", "-A")
        git(js, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "-m", "js")
        llm = StubLlm({"migrate_inventory": {"features": []}, "migrate_match": {"pairs": []}})
        cfg = _cfg(self.work)
        store = SqliteStore(cfg.db)
        self.addCleanup(store.close)
        m = Migrator(store, cfg, llm=llm)
        mid = m.admit({"v1": self.pair["v1"], "v2": js, "mode": "decide"})
        row = m.drive(mid)
        self.assertEqual((row["state"], row["code"]), ("analysed", codes.STACK_UNSUPPORTED))

    def test_admit_checks(self):
        m, _ = self._m()
        with self.assertRaises(LineError):
            m.admit({"v1": self.pair["v1"], "v2": self.pair["v2"], "mode": "auto"})
        with self.assertRaises(LineError):
            m.admit({"v1": self.pair["v1"], "v2": self.pair["v2"], "v2_ref": "vanilla"})
        with open(os.path.join(self.pair["v2"], "README.md"), "a") as fh:
            fh.write("x")
        git(self.pair["v2"], "checkout", "-q", "-b", "other")
        with self.assertRaises(LineError) as cm:
            m.admit({"v1": self.pair["v1"], "v2": self.pair["v2"]})
        self.assertEqual(cm.exception.code, codes.STATE_CONFLICT)


if __name__ == "__main__":
    unittest.main()
