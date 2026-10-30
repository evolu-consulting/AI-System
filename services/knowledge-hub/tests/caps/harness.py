"""Shared setup for the capability contract tests (tests/caps/test_*.py). Import it FIRST.

    from harness import H          # throwaway SQLite, locally generated RSA key, sign-in on
    client = H.client()            # in-process app: auth middleware + app.caps.attach_all
    H.person("ana@x.io", owner=["alpha"])   -> Authorization header of a Keycloak-style person token
    H.check(name, cond, detail)    / H.race(n, fn) / H.done()

Nothing here touches the network: the Keycloak JWKS lookup is replaced by the local key.
"""
import os
import sys
import tempfile
import threading
import time

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
sys.path.insert(0, ROOT)
sys.path.insert(0, os.path.join(ROOT, "tests"))

import hana_test_env  # noqa: E402  (opt-in HANA run: KH_TEST_HANA=1 + KH_STORE_BACKEND=hana)

TMP = tempfile.mkdtemp(prefix="kh_caps_")
os.environ["KH_HOOKS_DB"] = os.path.join(TMP, "hooks.db")
os.environ["KH_STORE_BACKEND"] = hana_test_env.store_backend()
if os.environ["KH_STORE_BACKEND"] == "hana":
    hana_test_env.wipe_schema()
os.environ["CHROMA_PATH"] = os.path.join(TMP, "chroma")
os.environ["KH_PROJECTS_PATH"] = os.path.join(TMP, "projects")
os.environ["KH_FEEDBACK_CRON"] = "false"
ISSUER = "https://keycloak.test/realms/knowledge-hub"
os.environ.setdefault("KH_AUTH_ISSUER", ISSUER)
os.environ["KH_AUTH_AUDIENCE"] = "kh-api"
os.environ.setdefault("KH_NS_CACHE_S", "1")

import jwt  # noqa: E402
from cryptography.hazmat.primitives.asymmetric import rsa  # noqa: E402

from app import auth, config  # noqa: E402

assert config.HOOKS_DB_PATH == os.environ["KH_HOOKS_DB"], "tests must run against a throwaway db"

KEY = rsa.generate_private_key(public_exponent=65537, key_size=2048)
auth._keys.get = lambda kid: KEY.public_key() if kid == "k1" else None


class _H:
    def __init__(self):
        self.failures = []
        self.checks = 0
        self._client = None

    def check(self, name, condition, detail=None):
        self.checks += 1
        print(("ok   " if condition else "FAIL ") + name + ("" if condition or detail is None else f"  -> {detail}"))
        if not condition:
            self.failures.append(name)

    def person(self, email, member=(), owner=(), maintainer=False, extra=None):
        now = int(time.time())
        projects = {p: ["project.read", "project.write"] for p in member}
        projects.update({p: ["project.read", "project.write", "project.members.manage"] for p in owner})
        kh = {"role": "maintainer" if maintainer else "member", "permissions": [],
              "all_projects": ["project.read"] if maintainer else [], "projects": projects}
        claims = {"iss": ISSUER, "aud": "kh-api", "iat": now, "exp": now + 300, "email": email, "kh": kh}
        claims.update(extra or {})
        return {"Authorization": "Bearer " + jwt.encode(claims, KEY, algorithm="RS256", headers={"kid": "k1"})}

    def app(self):
        from fastapi import FastAPI

        from app import caps
        app = FastAPI()
        auth.install(app)
        caps.attach_all(app)
        return app

    def client(self):
        from fastapi.testclient import TestClient
        if self._client is None:
            self._client = TestClient(self.app())
        return self._client

    def race(self, n, fn):
        barrier = threading.Barrier(n)
        out = [None] * n
        errors = []

        def run(i):
            try:
                barrier.wait()
                out[i] = fn(i)
            except Exception as exc:  # noqa: BLE001
                errors.append(repr(exc))
        threads = [threading.Thread(target=run, args=(i,)) for i in range(n)]
        for t in threads:
            t.start()
        for t in threads:
            t.join()
        if errors:
            raise RuntimeError(errors[0])
        return out

    def done(self):
        print()
        print(f"{self.checks} checks, {len(self.failures)} failure(s)" if self.failures
              else f"{self.checks} checks, all passed")
        sys.exit(1 if self.failures else 0)


H = _H()
