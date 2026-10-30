"""Feature migration over multi-repository ESTATES: detection, the per-repository scan (cache, resume, a failed
repository isolated), the cross-repository merge and the confirmation pass over the union of the other estate."""

from __future__ import annotations

import json
import os
import shutil
import tempfile
import unittest

from line import codes
from line.codes import LineError
from line.e2e.migrate_estate import REPOS, make_estate
from line.migrate import Migrator
from line.migrate import estate, scan
from line.migrate.match import confirm_one
from line.migrate.tree import Tree
from line.ship._util import git
from line.store import SqliteStore
from line.tests.test_migrate import StubLlm, _cfg


def _repo(path, files, tag=""):
    os.makedirs(path, exist_ok=True)
    git(path, "init", "-q")
    git(path, "symbolic-ref", "HEAD", "refs/heads/main")
    for rel, text in files.items():
        full = os.path.join(path, rel)
        os.makedirs(os.path.dirname(full), exist_ok=True)
        with open(full, "w", encoding="utf-8") as fh:
            fh.write(text)
    git(path, "add", "-A")
    git(path, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "-m", "init")
    if tag:
        git(path, "tag", tag)
    return path


def _feat(fid, repo, name, entities=(), identifiers=(), kind="other"):
    return {"id": fid, "side": "v1", "repo": repo, "repos": [repo], "name": name, "kind": kind, "behaviour": name,
            "evidence": [{"path": repo + "/x.py", "quote": "x", "verified": True}], "identifiers": list(identifiers),
            "entities": list(entities), "interfaces": [], "tests": [], "examples": [], "area": "A"}


class Base(unittest.TestCase):
    def setUp(self):
        self.work = tempfile.mkdtemp(prefix="mig-est-")

    def tearDown(self):
        shutil.rmtree(self.work, ignore_errors=True)


class DetectTests(Base):
    def test_single_repo_keeps_old_behaviour(self):
        r = _repo(os.path.join(self.work, "one"), {"a.py": "x = 1\n"})
        repos = estate.detect(r, default_ref="main")
        self.assertEqual(len(repos), 1)
        self.assertFalse(estate.is_estate(repos))
        self.assertIsInstance(estate.open_side(r, repos), Tree)

    def test_nested_estate_skips_dependency_dirs_and_inner_repos(self):
        root = os.path.join(self.work, "estate")
        _repo(os.path.join(root, "acme_db_bp"), {"db.cds": "entity BusinessPartner {}\n"}, tag="vanilla")
        _repo(os.path.join(root, "group", "acme_srv_bp"), {"srv.cds": "service BpService {}\n"})
        _repo(os.path.join(root, "group", "acme_srv_bp", "sub", "inner"), {"i.py": "y = 2\n"})
        _repo(os.path.join(root, "node_modules", "dep"), {"d.js": "z\n"})
        _repo(os.path.join(root, "a", "b", "c", "too_deep"), {"t.py": "t\n"})
        repos = estate.detect(root, default_ref="vanilla")
        self.assertEqual([r["name"] for r in repos], ["acme_db_bp", "group/acme_srv_bp"])
        self.assertTrue(estate.is_estate(repos))
        self.assertEqual([r["ref"] for r in repos], ["vanilla", "HEAD"])    # shared ref only where it exists
        self.assertTrue(all(len(r["sha"]) == 40 for r in repos))

    def test_manifest_overrides_detection(self):
        root = os.path.join(self.work, "estate")
        a = _repo(os.path.join(root, "a"), {"a.py": "x\n"}, tag="r1")
        _repo(os.path.join(root, "b"), {"b.py": "y\n"})
        man = os.path.join(self.work, "repos.json")
        with open(man, "w") as fh:
            json.dump({"repos": [{"path": a, "ref": "r1", "name": "alpha"}]}, fh)
        repos = estate.detect(root, manifest=man)
        self.assertEqual([(r["name"], r["ref"]) for r in repos], [("alpha", "r1")])
        md = os.path.join(root, "repos.md")
        with open(md, "w") as fh:
            fh.write("# repos\n- a r1\n- b   # the service\n")
        self.assertEqual([(r["name"], r["ref"]) for r in estate.detect(root, manifest=md)],
                         [("a", "r1"), ("b", "HEAD")])
        with open(man, "w") as fh:
            json.dump([{"path": a, "ref": "nope"}], fh)
        with self.assertRaises(LineError):
            estate.detect(root, manifest=man)

    def test_not_a_repo_and_no_repos(self):
        empty = os.path.join(self.work, "empty")
        os.makedirs(os.path.join(empty, "x"))
        with self.assertRaises(LineError) as cm:
            estate.detect(empty)
        self.assertEqual(cm.exception.code, codes.NOT_FOUND)

    def test_object_key(self):
        self.assertEqual(estate.object_key("simplemdg_db_bp"), "bp")
        self.assertEqual(estate.object_key("simplemdg_srv_bp"), "bp")
        self.assertEqual(estate.object_key("srv-config-admin"), "config")
        self.assertEqual(estate.object_key("group/inventory"), "inventory")


class EstateReadTests(Base):
    def test_estate_reads_like_one_tree_with_repo_prefixes(self):
        root = os.path.join(self.work, "e")
        _repo(os.path.join(root, "r1"), {"a.py": "def add_item():\n    pass\n"})
        _repo(os.path.join(root, "r2"), {"pkg/b.py": "def total():\n    return add_item()\n", "c.json": '{"x": "Y"}'})
        e = estate.open_side(root, estate.detect(root))
        self.assertIn("r2/pkg/b.py", e.files())
        self.assertTrue(e.contains("r1/a.py", "def add_item():"))
        self.assertFalse(e.contains("r2/a.py", "def add_item():"))
        self.assertEqual(sorted(e.find(["add_item"])["add_item"]), ["r1/a.py", "r2/pkg/b.py"])
        self.assertTrue(all(name.startswith(("r1.", "r2.")) for name, _ in e.chunks(10)))   # never one estate chunk
        self.assertIn("=== r1/a.py", e.render(["r1/a.py"]))

    def test_base_override_leaves_out_repos_without_the_ref(self):
        root = os.path.join(self.work, "e")
        _repo(os.path.join(root, "vanilla_one"), {"a.py": "x\n"}, tag="vanilla")
        _repo(os.path.join(root, "custom_one"), {"b.py": "y\n"})
        base = estate.open_side(root, estate.detect(root), ref_override="vanilla")
        self.assertEqual(sorted(base.trees), ["vanilla_one"])


class ScanTests(Base):
    def _repos(self, n=3):
        return [{"name": "r%d" % i, "path": os.path.join(self.work, "r%d" % i), "ref": "", "sha": "s%d" % i}
                for i in range(n)]

    def _scan(self, calls, fail=()):
        def fake(r, side, llm, **kw):
            calls.append(r["name"])
            if r["name"] in fail:
                raise RuntimeError("boom in %s" % r["name"])
            f = scan.prefix_feature({"id": "v1.f", "name": "F " + r["name"], "evidence": [], "identifiers": [],
                                     "entities": [], "tests": []}, side, r["name"])
            return {"repo": r["name"], "path": r["path"], "ref": "", "sha": r["sha"], "status": "ok",
                    "stacks": ["generic"], "facts": {"stacks": ["generic"], "identifiers": [r["name"] + "_id"],
                                                     "strings": [], "modules": {}, "services": {}, "entities": {},
                                                     "screens": {}, "handlers": {}, "catalogue": {}, "fixtures": []},
                    "inventory": {"features": [f], "unproven": [], "chunks": 1}}
        return fake

    def test_cache_and_resume(self):
        d = os.path.join(self.work, "mig")
        calls = []
        res = scan.scan_side(d, "v1", self._repos(), self.work, None, scan=self._scan(calls), parallel=2)
        self.assertEqual(sorted(calls), ["r0", "r1", "r2"])
        self.assertEqual(len(res["inventory"]["features"]), 3)
        self.assertEqual(res["facts"]["identifiers"], {"r0_id", "r1_id", "r2_id"})     # the UNION
        calls.clear()
        repos = self._repos()
        repos[1]["sha"] = "changed"
        res = scan.scan_side(d, "v1", repos, self.work, None, scan=self._scan(calls))
        self.assertEqual(calls, ["r1"])                                       # only the changed repository
        self.assertEqual([r["cached"] for r in res["repos"]], [True, False, True])

    def test_failed_repo_is_isolated_and_retried(self):
        d = os.path.join(self.work, "mig")
        calls = []
        seen = []
        res = scan.scan_side(d, "v1", self._repos(), self.work, None, scan=self._scan(calls, fail=("r1",)),
                             on_repo=seen.append)
        self.assertEqual(calls.count("r1"), 2)                                # one retry
        self.assertEqual([r["status"] for r in res["repos"]], ["ok", "failed", "ok"])
        self.assertIn("boom in r1", res["repos"][1]["error"])
        self.assertEqual(len(res["inventory"]["features"]), 2)
        self.assertEqual([r["repo"] for r in seen], ["r0", "r1", "r2"])
        with self.assertRaises(LineError) as cm:
            scan.scan_side(os.path.join(self.work, "mig2"), "v1", self._repos(), self.work, None,
                           scan=self._scan([], fail=("r0", "r1", "r2")))
        self.assertEqual(cm.exception.code, codes.REPO_SCAN_FAILED)

    def test_scan_repo_keys_and_prefixes(self):
        r = _repo(os.path.join(self.work, "acme_srv_bp"), {"bp.py": "def maintain_bp():\n    pass\n"})
        llm = StubLlm({("migrate_inventory", "v1.acme_srv_bp"): {"features": [{
            "id": "maintain", "name": "Maintain BP", "behaviour": "b",
            "evidence": [{"path": "bp.py", "quote": "def maintain_bp():"}], "identifiers": ["maintain_bp"]}]}})
        out = scan.scan_repo({"name": "acme_srv_bp", "path": r, "ref": "HEAD", "sha": "x"}, "v1", llm)
        f = out["inventory"]["features"][0]
        self.assertEqual(f["id"], "v1.acme_srv_bp.maintain")
        self.assertEqual(f["evidence"][0]["path"], "acme_srv_bp/bp.py")
        self.assertTrue(f["evidence"][0]["verified"])
        self.assertEqual(llm.calls, [("migrate_inventory", "v1.acme_srv_bp")])


class MergeTests(unittest.TestCase):
    def test_layer_repos_of_one_object_merge(self):
        fs = [_feat("v1.acme_db_bp.data", "acme_db_bp", "Business partner", ["BusinessPartner"], ["BusinessPartner"], "data"),
              _feat("v1.acme_srv_bp.svc", "acme_srv_bp", "Business Partner Service", ["BusinessPartner"],
                    ["BusinessPartner", "BpService"]),
              _feat("v1.acme_ui_bp.ui", "acme_ui_bp", "Business partner", ["BusinessPartner"]),
              _feat("v1.acme_srv_pir.pir", "acme_srv_pir", "Business partner", ["BusinessPartner"])]
        out, log = scan.merge_features(fs, "v1")
        names = sorted((f["id"], tuple(f.get("repos") or [])) for f in out)
        self.assertEqual(names, [("v1.acme_db_bp.data", ("acme_db_bp", "acme_srv_bp", "acme_ui_bp")),
                                 ("v1.acme_srv_pir.pir", ("acme_srv_pir",))])      # another object stays apart
        merged = [f for f in out if f["id"] == "v1.acme_db_bp.data"][0]
        self.assertEqual(merged["kind"], "data")
        self.assertEqual(len(merged["evidence"]), 3)
        self.assertEqual([x["by"] for x in log], ["rule"])

    def test_ambiguous_group_goes_to_the_model_once(self):
        fs = [_feat("v1.acme_db_bp.model", "acme_db_bp", "BP data model", ["BusinessPartner"]),
              _feat("v1.acme_srv_bp.maint", "acme_srv_bp", "Maintain partners", ["BusinessPartner"]),
              _feat("v1.acme_srv_bp.search", "acme_srv_bp", "Search partners", ["BusinessPartner"])]
        out, log = scan.merge_features(fs, "v1")                    # no model: kept apart, logged
        self.assertEqual(len(out), 3)
        self.assertEqual(log[0]["by"], "skipped")
        llm = StubLlm({("migrate_merge", "v1.merge.1"): {"groups": [
            {"ids": ["v1.acme_db_bp.model", "v1.acme_srv_bp.maint"], "reason": "data model and its maintenance"},
            {"ids": ["v1.nope"]}]}})
        out, log = scan.merge_features(fs, "v1", llm)
        self.assertEqual(len(llm.calls), 1)
        self.assertEqual(sorted(f["id"] for f in out), ["v1.acme_db_bp.model", "v1.acme_srv_bp.search"])
        self.assertEqual(log[-1]["by"], "model")


class UnionConfirmTests(Base):
    def test_confirmation_searches_every_repo_of_the_other_estate(self):
        root = os.path.join(self.work, "v2e")
        _repo(os.path.join(root, "app_ui"), {"view.py": "def show():\n    pass\n"})
        _repo(os.path.join(root, "app_srv"), {"svc.py": "def export_csv(book):\n    return ''\n"})
        other = estate.open_side(root, estate.detect(root))
        f = _feat("v1.x.export", "x", "Export", identifiers=["export_csv"])
        llm = StubLlm({("migrate_confirm", "v1.x.export"): {"verdict": "present", "partner": "", "reason": "r"}})
        row = confirm_one(f, other, [], llm)
        self.assertEqual(row["hits"], {"export_csv": ["app_srv/svc.py"]})
        self.assertEqual(row["verdict"], "present")


class RunnerEstateTests(Base):
    def test_v2_estate_is_analysed_with_target_estate(self):
        root = os.path.join(self.work, "v2e")
        _repo(os.path.join(root, "a"), {"a.py": "x = 1\n"})
        _repo(os.path.join(root, "b"), {"b.py": "y = 2\n"})
        e = make_estate(os.path.join(self.work, "est"))
        cfg = _cfg(self.work)
        store = SqliteStore(cfg.db)
        self.addCleanup(store.close)
        llm = StubLlm({"migrate_inventory": {"features": []}, "migrate_match": {"pairs": []}})
        m = Migrator(store, cfg, llm=llm)
        mid = m.admit({"v1": e["v1"], "v2": root, "mode": "decide"})
        row = m.drive(mid)
        self.assertEqual((row["state"], row["code"]), ("analysed", codes.TARGET_ESTATE))
        self.assertEqual((row["v1_kind"], row["v2_kind"]), ("estate", "estate"))
        keys = sorted(k for _, k in llm.calls if k.startswith(("v1.", "v2.")))
        self.assertEqual(keys, sorted(["v1." + n for n in REPOS] + ["v2.a", "v2.b"]))   # one call per repository
        with open(os.path.join(cfg.workroot, "migrations", mid, "report.md"), encoding="utf-8") as fh:
            rep = fh.read()
        self.assertIn("## Repositories scanned", rep)


if __name__ == "__main__":
    unittest.main()
