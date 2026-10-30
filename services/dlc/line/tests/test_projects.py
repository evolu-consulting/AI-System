"""Projects: the engine keeps one repository per project; runs started with {"project"} work on it."""

from __future__ import annotations

import base64
import json
import os
import re
import shutil
import subprocess
import tempfile
import unittest
import urllib.error
import urllib.request
from unittest import mock

from line.config import load_config
from line.contracts import E_RUN, Run
from line.server import LineServer
from line.tests.fakes import make_fakes


class ProjectsTest(unittest.TestCase):
    def setUp(self):
        self.home = tempfile.mkdtemp(prefix="dlc-home-")
        self.old = os.environ.get("DLC_HOME")
        os.environ["DLC_HOME"] = self.home
        self.f = make_fakes()
        self.calls = []

        def driver(action, payload):
            self.calls.append((action, dict(payload)))
            run = "R%d" % len(self.calls)
            d = {k: payload[k] for k in ("target", "project", "flow", "name") if payload.get(k)}
            self.f.store.put(E_RUN, run, Run(run, payload["pack"], state="admitted", created_ms=len(self.calls),
                                             detail=d), run=run)
            return {"run": run, "state": "admitted"}

        cfg = load_config(env={}, line_json=None, rag_local_json=None)
        self.srv = LineServer(self.f.store, cfg, driver=driver, host="127.0.0.1", port=0).start()

    def tearDown(self):
        self.srv.stop()
        if self.old is None:
            os.environ.pop("DLC_HOME", None)
        else:
            os.environ["DLC_HOME"] = self.old
        shutil.rmtree(self.home, ignore_errors=True)

    def req(self, path, body=None):
        data = json.dumps(body).encode() if body is not None else None
        r = urllib.request.Request(self.srv.url + path, data=data, method="POST" if data is not None else "GET",
                                   headers={"Content-Type": "application/json"})
        try:
            with urllib.request.urlopen(r, timeout=5) as resp:
                return resp.status, json.loads(resp.read())
        except urllib.error.HTTPError as e:
            return e.code, json.loads(e.read())

    def set_state(self, run, state):
        row = self.f.store.get(E_RUN, run)
        row["state"] = state
        self.f.store.put(E_RUN, run, row, run=run)

    def test_create_folder_chosen_by_engine(self):
        st, p = self.req("/api/projects", {"name": "Order Portal", "description": "orders"})
        self.assertEqual(st, 201)
        self.assertEqual(p["id"], "order-portal")
        self.assertNotIn("path", p)
        self.assertTrue(os.path.isdir(os.path.join(self.home, "targets", "order-portal")))
        st, p2 = self.req("/api/projects", {"name": "order portal"})
        self.assertEqual((st, p2["id"]), (201, "order-portal-2"))
        st, lst = self.req("/api/projects")
        self.assertTrue(all("path" not in x for x in lst["projects"]))
        self.assertEqual(st, 200)
        self.assertEqual({x["id"] for x in lst["projects"]}, {"order-portal", "order-portal-2"})
        self.assertFalse(lst["projects"][0]["has_code"])
        st, e = self.req("/api/projects", {"name": ""})
        self.assertEqual(st, 400)

    def test_close_hides_and_reopen_brings_back(self):
        self.req("/api/projects", {"name": "shop"})
        self.req("/api/projects", {"name": "blog"})
        st, r = self.req("/api/runs", {"pack": "/p/new", "project": "shop", "flow": "new-system"})
        st, e = self.req("/api/projects/shop:close", {})
        self.assertEqual(st, 409, e)                                     # a process still runs: stop it first
        self.assertIn("still running", e["message"])
        self.set_state(r["run"], "green")
        st, out = self.req("/api/projects/shop:close", {})
        self.assertEqual((st, out), (200, {"project": "shop", "closed": True}))
        _, lst = self.req("/api/projects")
        self.assertEqual([x["id"] for x in lst["projects"]], ["blog"])    # hidden from Home
        _, closed = self.req("/api/projects?closed=1")
        self.assertEqual([x["id"] for x in closed["projects"]], ["shop"])
        self.assertIn("ms", closed["projects"][0]["closed"])
        st, e = self.req("/api/runs", {"pack": "/p/enh", "project": "shop", "flow": "enhancement"})
        self.assertEqual(st, 409, e)                                     # no new run while closed
        self.assertIn("re-open", e["message"])
        st, out = self.req("/api/projects/shop:reopen", {})
        self.assertEqual(out["closed"], False)
        _, lst = self.req("/api/projects")
        self.assertEqual(sorted(x["id"] for x in lst["projects"]), ["blog", "shop"])
        self.assertNotIn("closed", next(x for x in lst["projects"] if x["id"] == "shop"))
        st, _ = self.req("/api/projects/nope:close", {})
        self.assertEqual(st, 404)

    def test_runs_use_project_repository(self):
        _, p = self.req("/api/projects", {"name": "shop"})
        st, r = self.req("/api/runs", {"pack": "/p/new", "project": "shop", "flow": "new-system", "name": "shop"})
        self.assertEqual(st, 202, r)
        self.assertEqual(self.calls[-1][1]["target"], os.path.join(self.home, "targets", "shop"))
        self.assertEqual(self.calls[-1][1]["project"], "shop")
        # one run at a time per project
        st, e = self.req("/api/runs", {"pack": "/p/new2", "project": "shop", "flow": "new-system"})
        self.assertEqual(st, 409, e)
        # enhancement before a completed build is refused
        self.set_state(r["run"], "escalated")
        st, e = self.req("/api/runs", {"pack": "/p/enh", "project": "shop", "flow": "enhancement"})
        self.assertEqual(st, 409, e)
        st, r2 = self.req("/api/runs", {"pack": "/p/new3", "project": "shop", "flow": "new-system"})
        self.assertEqual(st, 202)
        self.set_state(r2["run"], "green")
        st, r3 = self.req("/api/runs", {"pack": "/p/enh", "project": "shop", "flow": "enhancement"})
        self.assertEqual(st, 202, r3)
        st, d = self.req("/api/projects/shop")
        self.assertEqual(st, 200)
        self.assertEqual([x["id"] for x in d["runs"]], [r3["run"], r2["run"], r["run"]])
        self.assertTrue(d["project"]["has_code"])
        self.assertEqual(d["project"]["last_green_run"], r2["run"])
        self.assertEqual(d["project"]["active_run"]["id"], r3["run"])
        # Enhancement and Bug Fix share the project (its change queue orders their builds) ...
        st, r4 = self.req("/api/runs", {"pack": "/p/bug", "project": "shop", "flow": "bug-fix"})
        self.assertEqual(st, 202, r4)
        st, d = self.req("/api/projects/shop")
        self.assertEqual({x["id"]: x["flow"] for x in d["project"]["live_runs"]},
                         {r3["run"]: "enhancement", r4["run"]: "bug-fix"})
        # ... a New System never runs next to them
        st, e = self.req("/api/runs", {"pack": "/p/new4", "project": "shop", "flow": "new-system"})
        self.assertEqual(st, 409, e)
        self.assertIn("only Enhancement and Bug Fix", e["message"])
        st, q = self.req("/api/projects/shop/queue")
        self.assertEqual((st, q["project"], q["active"]), (200, "shop", []))   # slots are taken by the driver

    def test_errors(self):
        st, _ = self.req("/api/projects/nope")
        self.assertEqual(st, 404)
        st, _ = self.req("/api/runs", {"pack": "/p", "project": "nope"})
        self.assertEqual(st, 404)
        self.req("/api/projects", {"name": "x"})
        st, _ = self.req("/api/runs", {"pack": "/p", "project": "x", "target": "/elsewhere"})
        self.assertEqual(st, 400)


def _git(cwd, *args):
    subprocess.run(["git", "-c", "user.name=t", "-c", "user.email=t@t", "-C", cwd] + list(args), check=True,
                   capture_output=True)


def _repo(path, branch="main"):
    os.makedirs(path)
    _git(path, "init", "-q")
    _git(path, "symbolic-ref", "HEAD", "refs/heads/" + branch)
    with open(os.path.join(path, "app.py"), "w") as fh:
        fh.write("print(1)\n")
    _git(path, "add", "-A")
    _git(path, "commit", "-q", "-m", "init")


class WorkspaceTest(ProjectsTest):
    """Projects from existing code under the workspace root: a picked folder or a git clone."""

    def setUp(self):
        self.root = os.path.realpath(tempfile.mkdtemp(prefix="dlc-ws-"))
        self.env_old = {k: os.environ.get(k) for k in ("DLC_WORKSPACE_ROOT", "GIT_CONFIG_GLOBAL")}
        os.environ["DLC_WORKSPACE_ROOT"] = self.root
        os.environ["GIT_CONFIG_GLOBAL"] = os.path.join(self.root, ".gitconfig-test")   # safe.directory lands here
        super().setUp()

    def tearDown(self):
        super().tearDown()
        for k, v in self.env_old.items():
            if v is None:
                os.environ.pop(k, None)
            else:
                os.environ[k] = v
        shutil.rmtree(self.root, ignore_errors=True)

    def test_listing_says_what_the_engine_will_do(self):
        _repo(os.path.join(self.root, "good"))
        _repo(os.path.join(self.root, "dev-branch"), branch="dev")
        os.makedirs(os.path.join(self.root, "empty"))
        os.makedirs(os.path.join(self.root, "plain"))
        with open(os.path.join(self.root, "plain", "x.txt"), "w") as fh:
            fh.write("x")
        with open(os.path.join(self.root, "good", "dirty.txt"), "w") as fh:
            fh.write("x")
        os.makedirs(os.path.join(self.root, "nest", "inner"))
        _repo(os.path.join(self.root, "holder", "Github"))
        os.makedirs(os.path.join(self.root, "node_modules"))
        st, w = self.req("/api/workspace")
        self.assertEqual(st, 200, w)
        self.assertEqual((w["root"], w["current"]), (self.root, None))
        by = {f["name"]: f for f in w["folders"]}
        self.assertEqual(set(by), {"good", "dev-branch", "empty", "plain", "nest", "holder"})
        self.assertEqual((by["empty"]["kind"], by["empty"]["why"]), ("empty", ""))
        self.assertEqual((by["good"]["kind"], by["good"]["uncommitted"], by["good"]["why"]), ("git", 1, ""))
        self.assertEqual((by["dev-branch"]["branch"], by["dev-branch"]["why"]), ("dev", ""))
        self.assertEqual((by["plain"]["kind"], by["plain"]["has_code"], by["plain"]["why"]), ("files", False, ""))
        self.assertEqual(by["holder"]["nested"], ["Github"])
        self.assertIn("pick the one", by["holder"]["why"])
        st, w = self.req("/api/workspace?path=nest")
        self.assertEqual([f["path"] for f in w["folders"]], ["nest/inner"])
        self.assertEqual(w["current"]["path"], "nest")              # the opened folder can be picked too
        for bad in ("..", "../x", "nest/../..", "C:/Windows", "/etc"):
            st, e = self.req("/api/workspace?path=" + bad)
            self.assertEqual(st, 400, (bad, e))

    def test_pick_repository_on_any_branch_engine_works_on_its_clone(self):
        src = os.path.join(self.root, "team", "shop")
        _repo(src, branch="feature/x")
        with open(os.path.join(src, "wip.txt"), "w") as fh:
            fh.write("not committed")
        st, p = self.req("/api/projects", {"name": "Shop", "source": {"kind": "folder", "path": "team/shop"}})
        self.assertEqual(st, 201, p)
        self.assertEqual((p["source_kind"], p["source_branch"], p["uncommitted_left_out"], p["has_code"]),
                         ("git", "feature/x", 1, True))
        self.assertNotIn("path", p)
        self.assertNotIn("source_path", p)
        wc = os.path.join(self.home, "targets", "shop")
        self.assertTrue(os.path.isfile(os.path.join(wc, "app.py")))
        self.assertFalse(os.path.exists(os.path.join(wc, "wip.txt")))     # uncommitted work stays in the source
        # existing code: Enhancement starts at once, on the engine's clone (branch main)
        st, r = self.req("/api/runs", {"pack": "/p/enh", "project": "shop", "flow": "enhancement"})
        self.assertEqual(st, 202, r)
        self.assertEqual(os.path.normcase(self.calls[-1][1]["target"]), os.path.normcase(wc))
        self.set_state(r["run"], "green")
        # the engine's work goes back as branch dlc/shop; the source's own branch and files are untouched
        with open(os.path.join(wc, "feature.py"), "w") as fh:
            fh.write("x = 1\n")
        _git(wc, "add", "-A")
        _git(wc, "commit", "-q", "-m", "engine work")
        st, d = self.req("/api/projects/shop:deliver", {})
        self.assertEqual((st, d["branch"]), (200, "dlc/shop"), d)
        out = subprocess.run(["git", "-C", src, "branch", "--list", "dlc/shop"], capture_output=True, text=True)
        self.assertIn("dlc/shop", out.stdout)
        self.assertFalse(os.path.exists(os.path.join(src, "feature.py")))
        # new commits on the source branch reach the clone before the next run
        with open(os.path.join(src, "later.py"), "w") as fh:
            fh.write("y = 2\n")
        _git(src, "add", "later.py")
        _git(src, "commit", "-q", "-m", "later")
        st, r = self.req("/api/runs", {"pack": "/p/enh2", "project": "shop", "flow": "enhancement"})
        self.assertEqual(st, 202, r)
        self.assertTrue(os.path.isfile(os.path.join(wc, "later.py")))
        # a folder belongs to one project
        self.set_state(r["run"], "green")
        st, e = self.req("/api/projects", {"name": "Shop 2", "source": {"kind": "folder", "path": "team/shop"}})
        self.assertEqual(st, 409, e)

    def test_working_copy_clean_for_the_pipeline_when_global_autocrlf_is_on(self):
        # the engine runs as a person whose global git config says autocrlf=true; the pipeline's own git runs
        # with core.autocrlf=false and must not see the fresh clone (or copy) as changed
        with open(os.environ["GIT_CONFIG_GLOBAL"], "a") as fh:
            fh.write("[core]\n\tautocrlf = true\n")
        _repo(os.path.join(self.root, "lf"))
        os.makedirs(os.path.join(self.root, "crlf"))
        with open(os.path.join(self.root, "crlf", "main.py"), "wb") as fh:
            fh.write(b"print(1)\r\nprint(2)\r\n")
        for name in ("lf", "crlf"):
            st, p = self.req("/api/projects", {"name": name, "source": {"kind": "folder", "path": name}})
            self.assertEqual(st, 201, p)
            wc = os.path.join(self.home, "targets", name)
            out = subprocess.run(["git", "-c", "core.autocrlf=false", "-C", wc, "status", "--porcelain"],
                                 capture_output=True, text=True)
            self.assertEqual(out.stdout.strip(), "", name)
            out = subprocess.run(["git", "-C", wc, "status", "--porcelain"], capture_output=True, text=True)
            self.assertEqual(out.stdout.strip(), "", name)        # an agent's plain git agrees

    def test_deliver_is_a_step_of_the_run(self):
        # Pipeline._deliver: after the last check the run pushes its work as branch dlc/<project>, once
        import types
        from line.pipeline import Pipeline
        src = os.path.join(self.root, "svc")
        _repo(src)
        st, p = self.req("/api/projects", {"name": "Svc", "source": {"kind": "folder", "path": "svc"}})
        self.assertEqual((st, p["deliver"]), (201, "branch"), p)
        st, r = self.req("/api/runs", {"pack": "/p/enh", "project": "svc", "flow": "enhancement"})
        wc = os.path.join(self.home, "targets", "svc")
        with open(os.path.join(wc, "feature.py"), "w") as fh:
            fh.write("x = 1\n")
        _git(wc, "add", "-A")
        _git(wc, "commit", "-q", "-m", "engine work")
        seen = []
        em = types.SimpleNamespace(run_event=lambda run, kind, body: seen.append((kind, body)))
        pipe = types.SimpleNamespace(store=self.f.store, run=r["run"], sm=types.SimpleNamespace(em=em))
        Pipeline._deliver(pipe)
        self.assertEqual(seen[-1][0], "deliver.pushed", seen)
        out = subprocess.run(["git", "-C", src, "log", "--oneline", "dlc/svc"], capture_output=True, text=True)
        self.assertIn("engine work", out.stdout)
        Pipeline._deliver(pipe)                                       # once per run
        self.assertEqual(len(seen), 1)
        # a project without a source repository: the step is skipped, never an error
        st, p = self.req("/api/projects", {"name": "Fresh", "deliver": "off"})
        self.assertEqual(p["deliver"], "off")
        st, r = self.req("/api/runs", {"pack": "/p/new", "project": p["id"], "flow": "new-system"})
        pipe.run = r["run"]
        Pipeline._deliver(pipe)
        self.assertEqual(seen[-1][0], "deliver.skipped")

    def test_repository_owned_by_another_account(self):
        # the engine service (LocalSystem) does not own the folders it picks: git calls 'dubious ownership'
        _repo(os.path.join(self.root, "theirs"))
        with mock.patch.dict(os.environ, {"GIT_TEST_ASSUME_DIFFERENT_OWNER": "1"}):
            st, p = self.req("/api/projects", {"name": "Theirs", "source": {"kind": "folder", "path": "theirs"}})
            self.assertEqual((st, p.get("source_kind")), (201, "git"), p)
            st, r = self.req("/api/runs", {"pack": "/p/enh", "project": "theirs", "flow": "enhancement"})
            self.assertEqual(st, 202, r)                    # the run first fetches the source branch
            st, d = self.req("/api/projects/theirs:deliver", {})
            self.assertEqual(st, 200, d)

    def test_pick_folder_without_git_engine_copies_it(self):
        src = os.path.join(self.root, "legacy")
        os.makedirs(os.path.join(src, "node_modules", "big"))
        os.makedirs(os.path.join(src, "src"))
        for rel, text in (("src/main.py", "print(1)\n"), (".env", "SECRET=1\n"), ("node_modules/big/x.js", "x"),
                          ("run.log", "log")):
            with open(os.path.join(src, rel), "w") as fh:
                fh.write(text)
        st, p = self.req("/api/projects", {"name": "Legacy", "source": {"kind": "folder", "path": "legacy"}})
        self.assertEqual(st, 201, p)
        self.assertEqual((p["source_kind"], p["has_code"]), ("files", True))
        wc = os.path.join(self.home, "targets", "legacy")
        self.assertTrue(os.path.isfile(os.path.join(wc, "src", "main.py")))
        for left_out in (".env", "node_modules", "run.log"):
            self.assertFalse(os.path.exists(os.path.join(wc, left_out)), left_out)
        self.assertFalse(os.path.exists(os.path.join(src, ".git")))        # the source folder is not changed
        st, e = self.req("/api/projects/legacy:deliver", {})
        self.assertEqual(st, 409, e)
        # a folder that holds repositories is refused with the ones to pick instead
        _repo(os.path.join(self.root, "ws", "Github"))
        st, e = self.req("/api/projects", {"name": "Ws", "source": {"kind": "folder", "path": "ws"}})
        self.assertEqual(st, 400, e)
        self.assertIn("Github", e["message"])
        # an empty folder is built in place
        os.makedirs(os.path.join(self.root, "fresh"))
        st, p = self.req("/api/projects", {"name": "Fresh", "source": {"kind": "folder", "path": "fresh"}})
        self.assertEqual((st, p["has_code"], p["source_kind"]), (201, False, "empty"))
        st, e = self.req("/api/projects", {"name": "Out", "source": {"kind": "folder", "path": "../"}})
        self.assertEqual(st, 400, e)

    def test_git_hosts_and_clone(self):
        from line import projects
        self.assertEqual([projects.provider(u) for u in (
            "https://github.com/o/a.git", "https://gitlab.example.com/g/a.git", "git@bitbucket.org:w/a.git",
            "https://bitbucket.org/w/a.git", "https://git.corp.local/a.git")],
            ["github", "gitlab", "bitbucket", "bitbucket", "git"])
        hdr = projects._auth("https://gitlab.com/g/a.git", "tok")[1]
        self.assertIn(base64.b64encode(b"oauth2:tok").decode(), hdr)
        hdr = projects._auth("https://bitbucket.org/w/a.git", "pw", "me")[1]
        self.assertIn(base64.b64encode(b"me:pw").decode(), hdr)
        origin = tempfile.mkdtemp(prefix="dlc-origin-")
        try:
            _repo(os.path.join(origin, "api.git"), branch="master")
            url = "file:///" + os.path.join(origin, "api.git").replace("\\", "/").lstrip("/")
            st, e = self.req("/api/projects", {"name": "Api", "source": {"kind": "git", "url": url}})
            self.assertEqual(st, 400, e)                     # only https, ssh, user@host:path
            st, e = self.req("/api/projects", {"name": "Api", "source": {"kind": "git", "url": "git@h:x/api.git",
                                                                         "token": "t"}})
            self.assertEqual(st, 400, e)                     # a token goes with https only
            # a local origin stands in for the remote (no network in tests); any default branch works
            with mock.patch.object(projects, "_GIT_URL", re.compile(r"^file:///\S+$")):
                st, p = self.req("/api/projects", {"name": "Api", "source": {"kind": "git", "url": url}})
                self.assertEqual(st, 201, p)
                self.assertEqual((p["source"], p["workspace_path"], p["source_branch"], p["has_code"]),
                                 ("git", "api", "master", True))
                self.assertTrue(os.path.isfile(os.path.join(self.root, "api", "app.py")))
                self.assertTrue(os.path.isfile(os.path.join(self.home, "targets", "api", "app.py")))
                st, e = self.req("/api/projects", {"name": "Api", "source": {"kind": "git", "url": url}})
                self.assertEqual(st, 409, e)                 # folder api is taken
                st, e = self.req("/api/projects", {"name": "Nope", "source": {"kind": "git", "url": url,
                                                                              "branch": "missing", "folder": "nope"}})
                self.assertNotEqual(st, 201, e)
                self.assertFalse(os.path.exists(os.path.join(self.root, "nope")))
        finally:
            shutil.rmtree(origin, ignore_errors=True)

    def test_no_root_means_new_only(self):
        os.environ["DLC_WORKSPACE_ROOT"] = ""
        st, w = self.req("/api/workspace")
        self.assertEqual((st, w["root"], w["folders"]), (200, "", []))
        st, e = self.req("/api/projects", {"name": "X", "source": {"kind": "folder", "path": "a"}})
        self.assertEqual(st, 400, e)


if __name__ == "__main__":
    unittest.main()
