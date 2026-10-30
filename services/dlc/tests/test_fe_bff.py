"""Default frontend server: Keycloak token checks, the /api/dlc proxy, /api/fe routes and the flow seed.

  python -m unittest discover -s tests

No network: a stub engine and a stub identity provider run in-process; the RSA key is generated here.
"""

import base64
import hashlib
import json
import os
import random
import sys
import tempfile
import threading
import time
import unittest
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
TMP = tempfile.mkdtemp()
os.environ["SDLC_DB"] = os.path.join(TMP, "fe.db")

import fe_auth  # noqa: E402
import fe_bff  # noqa: E402


# ------------------------------------------------------------------ tiny RSA + JWT (test only)

def _probable_prime(bits, rng):
    while True:
        n = rng.getrandbits(bits) | (1 << (bits - 1)) | 1
        if all(n % p for p in (3, 5, 7, 11, 13, 17, 19, 23, 29, 31, 37)) and _miller_rabin(n, rng):
            return n


def _miller_rabin(n, rng, k=16):
    d, r = n - 1, 0
    while d % 2 == 0:
        d //= 2
        r += 1
    for _ in range(k):
        a = rng.randrange(2, n - 2)
        x = pow(a, d, n)
        if x in (1, n - 1):
            continue
        for _ in range(r - 1):
            x = pow(x, 2, n)
            if x == n - 1:
                break
        else:
            return False
    return True


def rsa_key(bits=1024, seed=7):
    rng = random.Random(seed)
    e = 65537
    while True:
        p, q = _probable_prime(bits // 2, rng), _probable_prime(bits // 2, rng)
        phi = (p - 1) * (q - 1)
        if p != q and phi % e:
            return p * q, e, pow(e, -1, phi)


def b64u(b):
    return base64.urlsafe_b64encode(b).rstrip(b"=").decode()


def b64u_int(i):
    return b64u(i.to_bytes((i.bit_length() + 7) // 8, "big"))


def sign(claims, n, d, kid="k1", alg="RS256"):
    h = b64u(json.dumps({"alg": alg, "kid": kid, "typ": "JWT"}).encode())
    c = b64u(json.dumps(claims).encode())
    k = (n.bit_length() + 7) // 8
    t = fe_auth._SHA256_PREFIX + hashlib.sha256((h + "." + c).encode()).digest()
    em = b"\x00\x01" + b"\xff" * (k - len(t) - 3) + b"\x00" + t
    s = pow(int.from_bytes(em, "big"), d, n).to_bytes(k, "big")
    return h + "." + c + "." + b64u(s)


N, E, D = rsa_key()
ISS = "http://idp.test/realms/dlc"
JWKS = {"keys": [{"kty": "RSA", "kid": "k1", "alg": "RS256", "n": b64u_int(N), "e": b64u_int(E)}]}


def fake_fetch(url):
    if url.endswith("/.well-known/openid-configuration"):
        return {"jwks_uri": ISS + "/protocol/openid-connect/certs"}
    if url.endswith("/certs"):
        return JWKS
    raise AssertionError(url)


def token(**over):
    now = int(time.time())
    c = {"iss": ISS, "sub": "u1", "preferred_username": "ada", "exp": now + 300, "iat": now, "azp": "dlc-fe",
         "aud": ["dlc-api", "account"], "realm_access": {"roles": ["dlc-user"]}}
    c.update(over)
    return sign(c, N, D)


class AuthTests(unittest.TestCase):
    def cfg(self, audience=""):
        return fe_auth.AuthConfig(ISS, "dlc-fe", audience, fetch=fake_fetch)

    def test_valid_token(self):
        claims = fe_auth.verify(token(), self.cfg("dlc-api"))
        self.assertEqual(claims["preferred_username"], "ada")
        self.assertEqual(fe_auth.user_of(claims)["role"], "member")

    def test_roles(self):
        self.assertEqual(fe_auth.user_of({"realm_access": {"roles": ["dlc-admin"]}, "sub": "x"})["role"], "admin")
        self.assertEqual(fe_auth.user_of({"realm_access": {"roles": ["dlc-viewer"]}, "sub": "x"})["role"], "viewer")

    def test_rejections(self):
        cfg = self.cfg("dlc-api")
        bad = token()
        tampered = bad[:-6] + ("AAAAAA" if not bad.endswith("AAAAAA") else "BBBBBB")
        cases = {
            "signature": tampered,
            "issuer": token(iss="http://evil/realms/dlc"),
            "expired": token(exp=int(time.time()) - 3600),
            "audience": token(aud=["other"], azp="other"),
            "malformed": "abc",
            "empty": "",
        }
        for name, tok in cases.items():
            with self.subTest(name):
                with self.assertRaises(fe_auth.AuthError):
                    fe_auth.verify(tok, cfg)
        with self.assertRaises(fe_auth.AuthError):
            fe_auth.verify(sign({"iss": ISS}, N, D, alg="HS256"), cfg)
        with self.assertRaises(fe_auth.AuthError):
            fe_auth.verify(sign({"iss": ISS, "exp": time.time() + 60}, N, D, kid="nope"), cfg)

    def test_no_audience_configured_accepts_any(self):
        fe_auth.verify(token(aud=["account"], azp="dlc-fe"), self.cfg(""))


class SeedTests(unittest.TestCase):
    def test_idempotent_and_keeps_edits(self):
        path = os.path.join(tempfile.mkdtemp(), "flows.json")
        self.assertEqual(fe_bff.seed_flows(path), (4, 0))
        fe_bff.update_flow(path, "new-system", {"label": "Build a new app"})
        self.assertEqual(fe_bff.seed_flows(path), (0, 4))
        flows = fe_bff.load_flows(path)
        self.assertEqual([f["id"] for f in flows][:3], ["new-system", "enhancement", "bug-fix"])
        self.assertEqual(flows[0]["label"], "Build a new app")
        self.assertFalse([f for f in flows if f["id"] == "feature-migration"][0]["enabled"])
        self.assertTrue([f for f in fe_bff.load_flows(path, migration=True) if f["id"] == "feature-migration"][0]["enabled"])
        fe_bff.seed_flows(path, force=True)
        self.assertEqual(fe_bff.load_flows(path)[0]["label"], "New System")


# ------------------------------------------------------------------ stub engine

class Engine(BaseHTTPRequestHandler):
    seen = []

    def log_message(self, *a):
        pass

    def _reply(self):
        n = int(self.headers.get("Content-Length") or 0)
        body = self.rfile.read(n).decode() if n else ""
        Engine.seen.append((self.command, self.path, self.headers.get("Authorization"), body))
        if self.path.startswith("/api/missing"):
            data, code = b'{"error":"NOT_FOUND"}', 404
        else:
            data, code = json.dumps({"ok": True, "path": self.path, "method": self.command}).encode(), 200
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    do_GET = do_POST = do_PUT = _reply


def serve(handler):
    srv = ThreadingHTTPServer(("127.0.0.1", 0), handler)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv, "http://127.0.0.1:%d" % srv.server_address[1]


class ProxyTests(unittest.TestCase):
    def test_forward_and_errors(self):
        srv, url = serve(Engine)
        try:
            cfg = {"SDLC_ENGINE_URL": url}
            st, hd, body = fe_bff.proxy(cfg, "POST", "runs/R1:pause", "x=1", b'{"a":1}',
                                        {"Authorization": "Bearer t", "Content-Type": "application/json", "Cookie": "c"})
            self.assertEqual(st, 200)
            m, path, auth, b = Engine.seen[-1]
            self.assertEqual((m, path, auth, b), ("POST", "/api/runs/R1:pause?x=1", "Bearer t", '{"a":1}'))
            self.assertEqual(fe_bff.proxy(cfg, "GET", "missing", "", b"", {})[0], 404)
            self.assertEqual(fe_bff.proxy(cfg, "GET", "../etc", "", b"", {})[0], 400)
        finally:
            srv.shutdown()
        self.assertEqual(fe_bff.proxy({}, "GET", "runs", "", b"", {})[0], 503)
        self.assertEqual(fe_bff.proxy({"SDLC_ENGINE_URL": "http://127.0.0.1:1"}, "GET", "runs", "", b"", {})[0], 502)


class ServerTests(unittest.TestCase):
    """The real sdlc.py handler, in sign-in mode, in front of the stub engine."""

    @classmethod
    def setUpClass(cls):
        cls.eng, eng_url = serve(Engine)
        import db
        import sdlc
        db.init_db()
        sdlc.CFG = {"SDLC_ENGINE_URL": eng_url, "SDLC_DATA_DIR": TMP}
        sdlc.AUTH = fe_auth.AuthConfig(ISS, "dlc-fe", "dlc-api", fetch=fake_fetch)
        cls.srv, cls.url = serve(sdlc.Handler)

    @classmethod
    def tearDownClass(cls):
        cls.srv.shutdown()
        cls.eng.shutdown()

    def call(self, method, path, tok=None, body=None):
        h = {"Content-Type": "application/json"}
        if tok:
            h["Authorization"] = "Bearer " + tok
        data = json.dumps(body).encode() if body is not None else None
        req = urllib.request.Request(self.url + path, data=data, headers=h, method=method)
        try:
            with urllib.request.urlopen(req, timeout=10) as r:
                return r.status, json.loads(r.read() or b"null")
        except urllib.error.HTTPError as e:
            return e.code, json.loads(e.read() or b"null")

    def test_config_is_public(self):
        st, b = self.call("GET", "/api/fe/config")
        self.assertEqual(st, 200)
        self.assertTrue(b["auth"]["enabled"])
        self.assertEqual(b["auth"]["client_id"], "dlc-fe")

    def test_proxy_needs_a_valid_token(self):
        self.assertEqual(self.call("GET", "/api/dlc/runs")[0], 401)
        self.assertEqual(self.call("GET", "/api/dlc/runs", "bad.token.here")[0], 401)
        tok = token()
        st, b = self.call("POST", "/api/dlc/runs/R9:resume", tok, {"why": "x"})
        self.assertEqual(st, 200)
        self.assertEqual(b["path"], "/api/runs/R9:resume")
        self.assertEqual(Engine.seen[-1][2], "Bearer " + tok)

    def test_me_and_flows(self):
        tok = token(realm_access={"roles": ["dlc-admin"]})
        st, b = self.call("GET", "/api/fe/me", tok)
        self.assertEqual((st, b["user"]["name"], b["user"]["role"]), (200, "ada", "admin"))
        st, b = self.call("GET", "/api/fe/flows", tok)
        self.assertEqual([f["id"] for f in b["flows"] if f["enabled"]], ["new-system", "enhancement", "bug-fix"])
        st, b = self.call("PUT", "/api/fe/flows/bug-fix", token(), {"label": "x"})
        self.assertEqual(st, 403)
        st, b = self.call("PUT", "/api/fe/flows/bug-fix", tok, {"description": "Fix it"})
        self.assertEqual((st, b["flow"]["description"]), (200, "Fix it"))

    def test_old_routes_take_the_keycloak_user(self):
        st, b = self.call("GET", "/api/me", token())
        self.assertEqual(st, 200)
        self.assertEqual(b["user"]["name"], "ada")
        self.assertEqual(self.call("GET", "/api/me")[0], 401)


if __name__ == "__main__":
    unittest.main()
