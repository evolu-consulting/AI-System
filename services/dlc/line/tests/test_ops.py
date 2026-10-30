"""Operations for a frontend: sign-in (OIDC bearer tokens), operator pause / resume, run nodes + worklog +
reports, starting the deployed app, the global agent cap and the 'agents' deployment profile."""

from __future__ import annotations

import base64
import hashlib
import json
import os
import random
import shutil
import socket
import sys
import tempfile
import threading
import time
import unittest
import urllib.error
import urllib.request
from unittest import mock

from line import agentcap, appctl, codes, runview
from line.auth import AuthError, Verifier, actor, b64url_encode, rsa_verify_sha256
from line.codes import LineError
from line.config import load_config
from line.contracts import E_RUN
from line.events import check_gapless
from line.pipeline import make_driver
from line.server import LineServer
from line.store import SqliteStore

LINE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PACK = os.path.join(LINE_DIR, "samples", "todo-pack")
ISS = "http://kc.test/realms/dlc"


# ------------------------------------------------------------------ RSA test key (pure python)


def _probable_prime(bits: int, rng: random.Random) -> int:
    small = [3, 5, 7, 11, 13, 17, 19, 23, 29, 31, 37, 41, 43, 47]
    while True:
        n = rng.getrandbits(bits) | (1 << (bits - 1)) | 1
        if any(n % p == 0 for p in small):
            continue
        d, r = n - 1, 0
        while d % 2 == 0:
            d //= 2
            r += 1
        for _ in range(16):
            a = rng.randrange(2, n - 2)
            x = pow(a, d, n)
            if x in (1, n - 1):
                continue
            for _ in range(r - 1):
                x = pow(x, 2, n)
                if x == n - 1:
                    break
            else:
                break
        else:
            return n


def _keypair(seed: int = 7):
    rng = random.Random(seed)
    e = 65537
    while True:
        p, q = _probable_prime(512, rng), _probable_prime(512, rng)
        phi = (p - 1) * (q - 1)
        if p != q and phi % e:
            break
    n = p * q
    d = pow(e, -1, phi)
    return n, e, d


N, E, D = _keypair()
N2, E2, D2 = _keypair(11)


def _sign(msg: bytes, n: int = N, d: int = D) -> bytes:
    k = (n.bit_length() + 7) // 8
    t = bytes.fromhex("3031300d060960864801650304020105000420") + hashlib.sha256(msg).digest()
    em = b"\x00\x01" + b"\xff" * (k - len(t) - 3) + b"\x00" + t
    return pow(int.from_bytes(em, "big"), d, n).to_bytes(k, "big")


def token(claims=None, kid="k1", n=N, d=D, **over) -> str:
    now = int(time.time())
    c = {"iss": ISS, "aud": "dlc-api", "azp": "dlc-fe", "exp": now + 300, "iat": now, "sub": "u1",
         "preferred_username": "alice", "realm_access": {"roles": ["dlc-user"]}}
    c.update(claims or {})
    c.update(over)
    h = b64url_encode(json.dumps({"alg": "RS256", "kid": kid, "typ": "JWT"}).encode())
    p = b64url_encode(json.dumps(c).encode())
    return h + "." + p + "." + b64url_encode(_sign((h + "." + p).encode(), n, d))


def jwks(*keys):
    out = []
    for kid, n, e in keys:
        out.append({"kty": "RSA", "use": "sig", "alg": "RS256", "kid": kid,
                    "n": b64url_encode(n.to_bytes((n.bit_length() + 7) // 8, "big")),
                    "e": b64url_encode(e.to_bytes(3, "big"))})
    return {"keys": out}


class FakeRealm:
    def __init__(self, *keys):
        self.doc = jwks(*keys)
        self.calls = 0

    def __call__(self, url):
        assert url == ISS + "/protocol/openid-connect/certs", url
        self.calls += 1
        return self.doc


class AuthCase(unittest.TestCase):
    def v(self, realm=None, **kw):
        return Verifier(ISS, fetch=realm or FakeRealm(("k1", N, E)), **kw)

    def test_rsa_verify(self):
        sig = _sign(b"hello")
        self.assertTrue(rsa_verify_sha256(N, E, b"hello", sig))
        self.assertFalse(rsa_verify_sha256(N, E, b"hellp", sig))
        self.assertFalse(rsa_verify_sha256(N2, E2, b"hello", sig))

    def test_valid_token_and_actor(self):
        v = self.v()
        c = v.verify(token())
        v.require(c)
        self.assertEqual(actor(c), "alice")

    def test_rejections(self):
        v = self.v()
        bad = [token(exp=int(time.time()) - 3600), token(iss="http://other/realms/x"), token(aud="other", azp="x"),
               token(n=N2, d=D2), "abc.def", token(kid="nope")]
        for t in bad:
            with self.assertRaises(AuthError) as cm:
                v.verify(t)
            self.assertEqual(cm.exception.status, 401, t[:30])
        # leeway: expired 30 s ago is still fine with the default 60 s
        v.verify(token(exp=int(time.time()) - 30))

    def test_audience_via_azp_and_list(self):
        v = self.v()
        v.verify(token(aud=["account", "dlc-api"]))
        v.verify(token(aud="account", azp="dlc-api"))

    def test_roles(self):
        v = self.v()
        c = v.verify(token(realm_access={"roles": []}))
        with self.assertRaises(AuthError) as cm:
            v.require(c)
        self.assertEqual(cm.exception.status, 403)
        c = v.verify(token(realm_access={"roles": []}, resource_access={"dlc-api": {"roles": ["dlc-user"]}}))
        v.require(c)
        with self.assertRaises(AuthError):
            v.require(c, admin=True)
        c = v.verify(token(realm_access={"roles": ["dlc-admin"]}))
        v.require(c)
        v.require(c, admin=True)

    def test_key_rotation_refetch(self):
        realm = FakeRealm(("k1", N, E))
        clock = [1000.0]
        v = Verifier(ISS, fetch=realm, clock=lambda: clock[0])
        now = int(clock[0])
        v.verify(token(iat=now, exp=now + 300))
        realm.doc = jwks(("k1", N, E), ("k2", N2, E2))
        clock[0] += 10
        v.verify(token(kid="k2", n=N2, d=D2, iat=now, exp=now + 300))
        self.assertEqual(realm.calls, 2)


class _Http:
    def call(self, method, path, body=None, tok=None, origin=None):
        data = None if body is None else json.dumps(body).encode()
        req = urllib.request.Request(self.srv.url + path, data=data, method=method)
        if data is not None:
            req.add_header("Content-Type", "application/json")
        if tok:
            req.add_header("Authorization", "Bearer " + tok)
        if origin:
            req.add_header("Origin", origin)
        try:
            with urllib.request.urlopen(req, timeout=20) as r:
                return r.status, dict(r.headers), json.loads(r.read() or b"null")
        except urllib.error.HTTPError as e:
            return e.code, dict(e.headers), json.loads(e.read() or b"null")


class ServerAuthCase(_Http, unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp(prefix="line-auth-")
        cfg = load_config(env={}, line_json=None, rag_local_json=None, db=os.path.join(self.tmp, "l.db"),
                          workroot=os.path.join(self.tmp, "w"), auth_issuer=ISS)
        self.store = SqliteStore(cfg.db)
        self.srv = LineServer(self.store, cfg, driver=lambda a, p: {"action": a, **p}, port=0)
        self.srv.verifier = Verifier(ISS, fetch=FakeRealm(("k1", N, E)))
        self.srv.start()

    def tearDown(self):
        self.srv.stop()
        self.store.close()
        shutil.rmtree(self.tmp, ignore_errors=True)

    def test_open_routes(self):
        for path in ("/api/health", "/api/openapi.json", "/api/auth/config"):
            st, _h, _b = self.call("GET", path)
            self.assertEqual(st, 200, path)
        st, _h, b = self.call("GET", "/api/auth/config")
        self.assertEqual(b, {"enabled": True, "issuer": ISS, "client_id": "dlc-fe", "audience": "dlc-api",
                             "role_user": "dlc-user", "role_admin": "dlc-admin"})

    def test_protected(self):
        st, h, b = self.call("GET", "/api/runs")
        self.assertEqual(st, 401)
        self.assertEqual(b["code"], "UNAUTHENTICATED")
        self.assertIn("Bearer", h.get("WWW-Authenticate", ""))
        st, _h, b = self.call("GET", "/api/runs", tok=token())
        self.assertEqual((st, b), (200, {"runs": []}))
        st, _h, b = self.call("GET", "/api/me", tok=token())
        self.assertEqual((b["actor"], b["admin"]), ("alice", False))
        st, _h, b = self.call("GET", "/api/runs", tok=token(realm_access={"roles": ["other"]}))
        self.assertEqual((st, b["code"]), (403, "FORBIDDEN"))

    def test_admin_routes_and_actor(self):
        st, _h, b = self.call("POST", "/api/runs/R1:cancel", {}, tok=token())
        self.assertEqual(st, 403)
        st, _h, b = self.call("POST", "/api/runs/R1:cancel", {}, tok=token(realm_access={"roles": ["dlc-admin"]}))
        self.assertEqual(st, 200)
        self.assertIn("by alice", b["reason"])
        st, _h, b = self.call("POST", "/api/runs", {"pack": "x"}, tok=token())
        self.assertEqual((st, b["actor"]), (202, "alice"))
        st, _h, b = self.call("POST", "/api/runs/R1:pause", {}, tok=token())
        self.assertEqual((b["action"], b["actor"]), ("pause", "alice"))

    def test_openapi_security(self):
        _s, _h, doc = self.call("GET", "/api/openapi.json")
        self.assertIn("bearer", doc["components"]["securitySchemes"])
        self.assertIn("security", doc["paths"]["/api/runs"]["get"])
        self.assertNotIn("security", doc["paths"]["/api/health"]["get"])
        for t in ("/api/runs/{run}:pause", "/api/runs/{run}:resume", "/api/runs/{run}/nodes",
                  "/api/runs/{run}/nodes/{node}/worklog", "/api/runs/{run}/reports", "/api/runs/{run}/reports/{report}",
                  "/api/runs/{run}/app", "/api/runs/{run}/app:start", "/api/runs/{run}/app:stop", "/api/me"):
            self.assertIn(t, doc["paths"])

    def test_auth_off(self):
        self.srv.verifier = None
        st, _h, b = self.call("GET", "/api/runs")
        self.assertEqual(st, 200)
        _s, _h, b = self.call("GET", "/api/auth/config")
        self.assertEqual(b, {"enabled": False})


# ------------------------------------------------------------------ pause / resume + projections


class PauseCase(_Http, unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp(prefix="line-pause-")
        self.cfg = load_config(env={}, line_json=None, rag_local_json=None, workroot=os.path.join(self.tmp, "w"),
                               db=os.path.join(self.tmp, "line.db"), llm="fake", rag="off", dry_pack=PACK,
                               deploy_windows=[], cancel_join_s=10)
        self.store = SqliteStore(self.cfg.db)

    def tearDown(self):
        self.store.close()
        shutil.rmtree(self.tmp, ignore_errors=True)

    def wait(self, driver, run, timeout=120):
        t = driver.threads.get(run)
        if t is not None:
            t.join(timeout)
            self.assertFalse(t.is_alive(), "run thread did not stop")

    def test_pause_resume_live_run(self):
        box = {}

        def on_stage(run, name):
            if name.startswith("build") and not box.get("paused"):
                box["paused"] = box["driver"]("pause", {"run": run, "actor": "bob"})

        driver = make_driver(self.store, self.cfg, on_stage=on_stage)
        box["driver"] = driver
        run = driver("start", {"pack": PACK, "actor": "alice"})["run"]
        self.wait(driver, run)
        row = self.store.get(E_RUN, run)
        self.assertTrue(box.get("paused", {}).get("stopping"), box)
        self.assertNotIn(row["state"], ("green", "escalated"))
        self.assertEqual(row["detail"]["paused"]["by"], "bob")
        self.assertEqual(row["detail"]["actor"], "alice")
        kinds = [e.kind for e in self.store.events_after(0, run=run)]
        self.assertIn(codes.RUN_PAUSED, kinds)
        # nodes show the pause; auto resume skips a paused run; internal resume does too
        ns = {n["id"]: n["state"] for n in runview.nodes(self.store, run)}
        self.assertIn("paused", ns.values())
        self.assertEqual(driver("resume_all", {})["resumed"], [])
        self.assertTrue(driver("resume", {"run": run})["paused"])
        # explicit resume: on to green
        res = driver("resume", {"run": run, "explicit": True, "actor": "bob"})
        self.assertTrue(res["resuming"])
        self.wait(driver, run)
        row = self.store.get(E_RUN, run)
        self.assertEqual(row["state"], "green", row["detail"].get("escalation"))
        self.assertNotIn("paused", row["detail"])
        kinds = [e.kind for e in self.store.events_after(0, run=run)]
        self.assertIn(codes.RUN_RESUMED, kinds)
        check_gapless(self.store.events_after(0))
        self.check_projections(run)

    def check_projections(self, run):
        ns = runview.nodes(self.store, run)
        self.assertEqual([n["id"] for n in ns], list(runview.NODE_IDS))
        st = {n["id"]: n["state"] for n in ns}
        for nid in ("understand", "tests", "plan", "build", "merge", "qas", "result"):
            self.assertEqual(st[nid], "done", (nid, st))
        self.assertIn(st["review"], ("skipped", "done"))
        b = next(n for n in ns if n["id"] == "build")
        self.assertEqual(b["counts"]["merged"], 4)
        self.assertGreater(b["counts"]["llm_calls"], 0)
        wl = runview.worklog(self.store, run, "build")
        self.assertTrue(any(e["kind"] == "llm_call" and e["role"] == "builder" for e in wl))
        self.assertTrue(any(e["kind"] == "output" for e in wl))
        self.assertTrue(all(wl[i]["ts"] <= wl[i + 1]["ts"] for i in range(len(wl) - 1)))
        self.assertTrue(any(e["role"].startswith("reader") for e in runview.worklog(self.store, run, "understand")))
        with self.assertRaises(LineError):
            runview.worklog(self.store, run, "nope")
        reps = {r["id"]: r for r in runview.reports(self.store, run)}
        for rid in ("file-spec.md", "gen-implement", "gen-tests", "gen-qas"):
            self.assertIn(rid, reps)
        self.assertIn("## U1", runview.report(self.store, run, "gen-implement")["content"])
        self.assertIn("Acceptance tests", runview.report(self.store, run, "gen-tests")["content"])
        self.assertTrue(runview.report(self.store, run, "file-spec.md")["content"].strip())
        for bad in ("file-..", "file-../line.db", "gen-nope", "../x"):
            with self.assertRaises(LineError):
                runview.report(self.store, run, bad)

    def test_pause_not_driven_and_terminal(self):
        driver = make_driver(self.store, self.cfg)
        from line.pipeline import Pipeline
        p = Pipeline(self.store, self.cfg)
        run = p.admit(PACK)
        res = driver("pause", {"run": run, "actor": "x"})
        self.assertEqual((res["paused"], res["stopping"]), (True, False))
        self.assertEqual(driver("pause", {"run": run})["stopping"], False)
        self.assertEqual(driver("resume_all", {})["resumed"], [])
        res = driver("resume", {"run": run, "explicit": True})
        self.wait(driver, run)
        self.assertEqual(self.store.get(E_RUN, run)["state"], "green")
        with self.assertRaises(LineError) as cm:
            driver("pause", {"run": run})
        self.assertEqual(cm.exception.code, codes.STATE_CONFLICT)
        with self.assertRaises(LineError):
            driver("pause", {"run": "nope"})

    def test_http_routes(self):
        driver = make_driver(self.store, self.cfg)
        self.srv = LineServer(self.store, self.cfg, driver=driver, port=0).start()
        try:
            st, _h, b = self.call("POST", "/api/runs", {"pack": PACK, "human_mode": "maybe"})
            self.assertEqual(st, 400)
            st, _h, b = self.call("POST", "/api/runs", {"pack": PACK, "name": "Todo demo", "flow": "new",
                                                         "human_mode": "decide"})
            run = b["run"]
            self.wait(driver, run)
            st, _h, b = self.call("GET", "/api/runs")
            summ = next(r for r in b["runs"] if r["id"] == run)
            self.assertEqual((summ["name"], summ["flow"], summ["human_mode"], summ["paused"]),
                             ("Todo demo", "new", "decide", False))
            st, _h, b = self.call("GET", "/api/runs/%s/nodes" % run)
            self.assertEqual((st, len(b["nodes"]), b["paused"]), (200, 9, False))   # 9 with Deliver
            st, _h, b = self.call("GET", "/api/runs/%s/nodes/plan/worklog" % run)
            self.assertTrue(b["entries"])
            st, _h, b = self.call("GET", "/api/runs/%s/nodes/zzz/worklog" % run)
            self.assertEqual(st, 404)
            st, _h, b = self.call("GET", "/api/runs/%s/reports" % run)
            self.assertTrue(b["reports"])
            st, _h, b = self.call("GET", b["reports"][0]["url"])
            self.assertEqual(st, 200)
            self.assertTrue(b["content"])
            st, _h, b = self.call("GET", "/api/runs/%s/app" % run)
            self.assertEqual((st, b["state"]), (200, "stopped"))
            st, _h, b = self.call("POST", "/api/runs/%s:pause" % run, {})
            self.assertEqual(st, 409)
            st, _h, b = self.call("GET", "/api/runs/nope/nodes")
            self.assertEqual(st, 404)
        finally:
            self.srv.stop()


# ------------------------------------------------------------------ app start


def _busy_port():
    s = socket.socket()
    s.bind(("127.0.0.1", 0))
    s.listen(1)
    return s, s.getsockname()[1]


class AppCase(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp(prefix="line-app-")
        base = 20000 + random.randrange(0, 20000)
        self.cfg = load_config(env={}, line_json=None, rag_local_json=None, workroot=os.path.join(self.tmp, "w"),
                               db=os.path.join(self.tmp, "l.db"), public_host="demo.example",
                               app_ports="%d-%d" % (base, base + 20), app_start_timeout_s=20)
        self.store = SqliteStore(self.cfg.db)
        self.target = os.path.join(self.tmp, "target")
        os.makedirs(self.target)
        self.store.put(E_RUN, "R1", {"id": "R1", "state": "green", "pack_path": "", "detail": {"target": self.target}},
                       run="R1")

    def tearDown(self):
        try:
            appctl.stop(self.store, self.cfg, "R1")
        except LineError:
            pass
        self.store.close()
        shutil.rmtree(self.tmp, ignore_errors=True)

    def test_plan_detection(self):
        d = self.target
        with self.assertRaises(LineError):
            appctl.plan(d)
        open(os.path.join(d, "index.html"), "w").write("<h1>hi</h1>")
        self.assertEqual(appctl.plan(d)["how"], "static index.html")
        open(os.path.join(d, "app.py"), "w").write("print(1)")
        self.assertEqual(appctl.plan(d)["how"], "app.py")
        open(os.path.join(d, "package.json"), "w").write(json.dumps({"scripts": {"start": "node s.js"}}))
        self.assertEqual(appctl.plan(d)["how"], "package.json start")
        open(os.path.join(d, "dlc.app.json"), "w").write(json.dumps({"start": ["python", "app.py"],
                                                                     "health_path": "/ok"}))
        pl = appctl.plan(d)
        self.assertEqual((pl["how"], pl["health_path"]), ("dlc.app.json", "/ok"))
        open(os.path.join(d, "dlc.app.json"), "w").write(json.dumps({"start": ["x"], "cwd": "../.."}))
        with self.assertRaises(LineError):
            appctl.plan(d)

    def test_a_python_server_package_with_a_web_frontend_is_built_then_run_as_a_module(self):
        d = self.target                    # the shape of 'The Memories' (run R20261025-124714-1c99)
        os.makedirs(os.path.join(d, "server"))
        open(os.path.join(d, "server", "__main__.py"), "w").write("print(1)")
        os.makedirs(os.path.join(d, "web"))
        open(os.path.join(d, "web", "index.html"), "w").write('<script type="module" src="/src/main.jsx"></script>')
        open(os.path.join(d, "web", "package.json"), "w").write(json.dumps({"scripts": {"build": "vite build"}}))
        pl = appctl.plan(d)
        self.assertEqual((pl["how"], pl["argv"][1:], pl["cwd"]), ("python -m server", ["-m", "server"], d))
        self.assertEqual([s["argv"][1:2] for s in pl["prebuild"]], [["install"], ["run"]])   # no node_modules yet
        os.makedirs(os.path.join(d, "web", "node_modules"))
        open(os.path.join(d, "web", "package-lock.json"), "w").write("{}")
        self.assertEqual([s["argv"][1:] for s in appctl.plan(d)["prebuild"]], [["run", "build"]])

    def test_a_failing_frontend_build_stops_the_start(self):
        log = os.path.join(self.tmp, "app.log")
        with self.assertRaises(LineError) as cm:
            appctl._prebuild([{"argv": [sys.executable, "-c", "import sys; print('boom'); sys.exit(3)"], "cwd": self.tmp}],
                             log)
        self.assertIn("exited 3", cm.exception.message)
        self.assertIn("boom", open(log, encoding="utf-8").read())

    def test_ports(self):
        self.assertEqual(appctl.parse_ports("5-7, 9"), [5, 6, 7, 9])
        with self.assertRaises(LineError):
            appctl.parse_ports("")
        s, port = _busy_port()
        try:
            cfg = load_config(env={}, line_json=None, rag_local_json=None, workroot=self.cfg.workroot,
                              app_ports="%d,%d" % (port, port + 1))
            got = appctl.free_port(cfg)
            self.assertNotEqual(got, port)
        finally:
            s.close()

    def test_start_open_stop(self):
        app = ("import http.server, os\n"
               "class H(http.server.BaseHTTPRequestHandler):\n"
               "    def do_GET(self):\n"
               "        b = b'hello demo'\n"
               "        self.send_response(200); self.send_header('Content-Length', str(len(b))); self.end_headers()\n"
               "        self.wfile.write(b)\n"
               "    def log_message(self, *a): pass\n"
               "http.server.HTTPServer(('0.0.0.0', int(os.environ['PORT'])), H).serve_forever()\n")
        open(os.path.join(self.target, "app.py"), "w").write(app)
        open(os.path.join(self.target, "dlc.app.json"), "w").write(json.dumps({"start": ["python", "app.py"]}))
        self.assertEqual(appctl.status(self.store, self.cfg, "R1")["state"], "stopped")
        st = appctl.start(self.store, self.cfg, "R1", by="alice")
        self.assertEqual(st["state"], "running", st)
        self.assertTrue(st["url"].startswith("http://demo.example:%d" % st["port"]), st["url"])
        with urllib.request.urlopen("http://127.0.0.1:%d/" % st["port"], timeout=5) as r:
            self.assertEqual(r.read(), b"hello demo")
        again = appctl.start(self.store, self.cfg, "R1")
        self.assertEqual((again["state"], again["port"]), ("running", st["port"]))
        out = appctl.stop(self.store, self.cfg, "R1", by="alice")
        self.assertEqual(out["state"], "stopped")
        time.sleep(0.5)
        self.assertFalse(appctl.port_open(st["port"]))
        kinds = [e.kind for e in self.store.events_after(0, run="_line")]
        self.assertIn(codes.APP_STARTED, kinds)
        self.assertIn(codes.APP_STOPPED, kinds)

    def test_project_settings_reach_the_app(self):
        """DLC_HOME/secrets/apps/<project>.env goes into the app's environment; PORT stays the engine's; the log
        names the keys, never the values."""
        self.store.put(E_RUN, "R1", {"id": "R1", "state": "green", "pack_path": "",
                                     "detail": {"target": self.target, "project": "memo"}}, run="R1")
        app = ("import http.server, os\n"
               "class H(http.server.BaseHTTPRequestHandler):\n"
               "    def do_GET(self):\n"
               "        b = ('%s|%s|%s' % (os.environ.get('BLOG_ADMIN_USER'), os.environ.get('BLOG_ADMIN_PASSWORD'),\n"
               "                           os.environ.get('Q'))).encode()\n"
               "        self.send_response(200); self.send_header('Content-Length', str(len(b))); self.end_headers()\n"
               "        self.wfile.write(b)\n"
               "    def log_message(self, *a): pass\n"
               "http.server.HTTPServer(('0.0.0.0', int(os.environ['PORT'])), H).serve_forever()\n")
        open(os.path.join(self.target, "app.py"), "w").write(app)
        open(os.path.join(self.target, "dlc.app.json"), "w").write(json.dumps({"start": ["python", "app.py"]}))
        with mock.patch.dict(os.environ, {}, clear=False):
            os.environ.pop("DLC_HOME", None)
            path = appctl.env_path(self.cfg, "memo")
            self.assertEqual(path, os.path.join(self.tmp, "secrets", "apps", "memo.env"))
            os.makedirs(os.path.dirname(path))
            with open(path, "w", encoding="utf-8") as fh:
                fh.write("# admin of the blog\n\nBLOG_ADMIN_USER=the_memories\nexport BLOG_ADMIN_PASSWORD=\"Al@5=x#1\"\n"
                         "Q='a b'\nPORT=1\n")
            st = appctl.start(self.store, self.cfg, "R1")
            self.assertEqual(st["state"], "running", st)
            with urllib.request.urlopen("http://127.0.0.1:%d/" % st["port"], timeout=5) as r:
                self.assertEqual(r.read(), b"the_memories|Al@5=x#1|a b")
            log = open(os.path.join(self.cfg.workroot, "R1", "_app", "app.log"), encoding="utf-8").read()
            self.assertIn("project settings: BLOG_ADMIN_PASSWORD, BLOG_ADMIN_USER, PORT, Q", log)
            self.assertNotIn("Al@5", log)
            appctl.stop(self.store, self.cfg, "R1")
            self.assertEqual(appctl.app_env(self.cfg, "other"), {})
            with open(path, "w", encoding="utf-8") as fh:
                fh.write("not a setting\n")
            with self.assertRaises(LineError):
                appctl.app_env(self.cfg, "memo")

    def test_kind_desktop_or_web(self):
        d = self.target
        main = os.path.join(d, "main.py")
        open(main, "w").write("import flet as ft\nft.app(target=lambda p: None)\n")
        self.assertEqual(appctl.app_kind(d), "desktop")
        open(main, "w").write("import flet as ft\nft.app(target=lambda p: None, view=ft.AppView.WEB_BROWSER)\n")
        self.assertEqual(appctl.app_kind(d), "web")
        open(main, "w").write("from flask import Flask\nimport tkinter\n")
        self.assertEqual(appctl.app_kind(d), "web")                      # a web server wins
        open(main, "w").write("print('hi')\n")
        self.assertEqual(appctl.app_kind(d), "web")
        open(os.path.join(d, "dlc.app.json"), "w").write(json.dumps({"kind": "desktop", "start": ["python", "main.py"]}))
        self.assertEqual(appctl.app_kind(d), "desktop")                  # stated wins
        self.assertEqual(appctl.venv_python(self.cfg, d, os.path.join(self.tmp, "x.log")), appctl._python())  # no reqs

    def test_desktop_app_builds_into_a_zip_instead_of_starting(self):
        import zipfile
        open(os.path.join(self.target, "main.py"), "w").write("import tkinter\n")
        build = ["python", "-c", "import os; os.makedirs('dist/Demo', exist_ok=True); "
                                 "open('dist/Demo/Demo.exe', 'w').write('exe')"]
        open(os.path.join(self.target, "dlc.app.json"), "w").write(json.dumps(
            {"kind": "desktop", "start": ["python", "main.py"], "build": build, "artifact": "dist"}))
        with self.assertRaises(LineError) as cm:
            appctl.start(self.store, self.cfg, "R1")
        self.assertIn("Build & download", cm.exception.message)
        st = appctl.build(self.store, self.cfg, "R1", by="alice")
        self.assertEqual((st["kind"], st["build"]["state"]), ("desktop", "building"))
        for _ in range(100):
            st = appctl.status_full(self.store, self.cfg, "R1")
            if st["build"]["state"] != "building":
                break
            time.sleep(0.1)
        self.assertEqual(st["build"]["state"], "built", st)
        z = appctl.download_path(self.store, self.cfg, "R1")
        self.assertTrue(z.endswith("-R1.zip"))
        with zipfile.ZipFile(z) as zf:
            self.assertIn("Demo/Demo.exe", zf.namelist())
        open(os.path.join(self.target, "dlc.app.json"), "w").write(json.dumps({"kind": "web",
                                                                                "start": ["python", "main.py"]}))
        with self.assertRaises(LineError):
            appctl.build(self.store, self.cfg, "R1")                     # a web app is started, not built

    def test_start_failure_reports_log(self):
        open(os.path.join(self.target, "app.py"), "w").write("raise SystemExit('boom: no app here')\n")
        st = appctl.start(self.store, self.cfg, "R1")
        self.assertEqual(st["state"], "failed")
        self.assertIn("boom", st["log_tail"])


# ------------------------------------------------------------------ agent cap + profile


class CapCase(unittest.TestCase):
    def test_global_cap(self):
        cfg = type("C", (), {"max_active_agents": 2})()
        peak, cur, lock = [0], [0], threading.Lock()

        def work():
            with agentcap.agent_slot(cfg):
                with lock:
                    cur[0] += 1
                    peak[0] = max(peak[0], cur[0])
                time.sleep(0.05)
                with lock:
                    cur[0] -= 1

        ts = [threading.Thread(target=work) for _ in range(8)]
        for t in ts:
            t.start()
        for t in ts:
            t.join()
        self.assertEqual(peak[0], 2)

    def test_no_cap(self):
        with agentcap.agent_slot(type("C", (), {"max_active_agents": 0})()):
            self.assertGreaterEqual(agentcap.active(), 1)

    def test_agents_profile(self):
        c = load_config(env={"LINE_PROFILE": "agents"}, line_json=None, rag_local_json=None)
        self.assertEqual((c.human_mode, c.max_active_agents, c.auto_resume), ("decide", 10, True))
        c = load_config(env={"LINE_PROFILE": "agents", "LINE_MAX_ACTIVE_AGENTS": "4"}, line_json=None,
                        rag_local_json=None)
        self.assertEqual(c.max_active_agents, 4)
        with self.assertRaises(LineError):
            load_config(env={"LINE_PROFILE": "nope"}, line_json=None, rag_local_json=None)
        c = load_config(env={}, line_json=None, rag_local_json=None)
        self.assertEqual((c.human_mode, c.max_active_agents), ("ask", 0))


if __name__ == "__main__":
    unittest.main()
