"""Tests for KH artifacts (app/artifacts.py), 2026-10-19.

WHAT IS UNDER TEST
  1. UPLOAD AND DOWNLOAD. A maintainer uploads a kh-helper wheel; module and version come from its name.
     /auth/download serves it without sign-in, /auth/config and /auth/help point at the newest one, older
     versions stay downloadable, members may not upload, names with paths are refused.
  2. THE STORE IS A SETTING. PUT /artifacts/backend switches hana -> http (a VPS) -> s3 -> hana with no
     restart: the new store is probed, every artifact copied and checked, then the setting flips. A store
     that fails changes nothing. Secrets are masked on read and kept when sent back masked.
  3. SERVE. proxy streams the bytes through KH; redirect answers 302 to the store.
  4. FALLBACK. With nothing uploaded, the wheel a deploy bundled is served, and the newer of the two wins.

Run from the repo root with the project venv:
    .venv\\Scripts\\python tests\\test_artifacts.py

Uses a throwaway SQLite database, an in-memory 'VPS' and an in-memory 'S3'; no network.
"""
import base64
import os
import sys
import tempfile
import time
from pathlib import Path

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

TMP = tempfile.mkdtemp(prefix="kh_art_")
os.environ["KH_HOOKS_DB"] = os.path.join(TMP, "hooks.db")
os.environ["KH_STORE_BACKEND"] = "sqlite"
ISSUER = "https://keycloak.test/realms/knowledge-hub"
os.environ["KH_AUTH_ISSUER"] = ISSUER
os.environ["KH_AUTH_AUDIENCE"] = "kh-api"

import jwt  # noqa: E402
from cryptography.hazmat.primitives.asymmetric import rsa  # noqa: E402
from fastapi import FastAPI  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from app import artifacts, auth, config  # noqa: E402

assert config.HOOKS_DB_PATH == os.environ["KH_HOOKS_DB"], "test must run against a throwaway db"

FAILURES = []


def check(name, condition, detail=None):
    print(("ok   " if condition else "FAIL ") + name + ("" if condition or detail is None else f"  -> {detail}"))
    if not condition:
        FAILURES.append(name)


KEY = rsa.generate_private_key(public_exponent=65537, key_size=2048)
auth._keys.get = lambda kid: KEY.public_key() if kid == "k1" else None


def token(email, admin=False):
    now = int(time.time())
    kh = {"role": "maintainer" if admin else "member", "permissions": [], "all_projects": [], "projects": {}}
    claims = {"iss": ISSUER, "aud": "kh-api", "iat": now, "exp": now + 300, "email": email, "kh": kh}
    return {"Authorization": "Bearer " + jwt.encode(claims, KEY, algorithm="RS256", headers={"kid": "k1"})}


ADMIN = token("root@example.invalid", admin=True)
MEMBER = token("ana@example.invalid")

bundle = Path(TMP) / "downloads"
bundle.mkdir()
auth.DOWNLOADS_DIR = bundle

app = FastAPI()
auth.install(app)
artifacts.attach(app)
client = TestClient(app)
fwd = {"x-forwarded-proto": "https", "host": "kh.example.test"}


def wheel(version):
    return f"kh_helper-{version}-py3-none-any.whl"


def up(name, data, headers=ADMIN, **extra):
    return client.post("/artifacts", json={"name": name, "content_b64": base64.b64encode(data).decode(), **extra},
                       headers=headers)


# ── 4 first: nothing uploaded, the bundled wheel ─────────────────────────────
(bundle / wheel("1.14.0")).write_bytes(b"bundled-1.14.0")
r = client.get("/auth/download/" + wheel("1.14.0"))
check("with nothing uploaded the bundled wheel is served", r.status_code == 200 and r.content == b"bundled-1.14.0",
      r.status_code)
check("config names the bundled version", client.get("/auth/config").json().get("helper_version") == "1.14.0")

# ── 1. upload and download ──────────────────────────────────────────────────
r = up(wheel("1.15.0"), b"wheel-1.15.0")
check("a maintainer uploads a wheel", r.status_code == 200 and r.json()["module"] == "kh-helper"
      and r.json()["version"] == "1.15.0" and r.json()["mode"] == "hana", r.text)
check("a member may not upload", up(wheel("9.9.9"), b"x", headers=MEMBER).status_code == 403)
check("no sign-in may not upload", up(wheel("9.9.9"), b"x", headers={}).status_code == 401)
check("a name with a path is refused", up("../evil.whl", b"x").status_code == 400)
check("an empty file is refused", up(wheel("1.0.1"), b"").status_code == 400)
check("a non-wheel needs module and version", up("notes.txt", b"x").status_code == 400
      and up("notes.txt", b"x", module="docs", version="1").status_code == 200)
r = client.get("/auth/download/" + wheel("1.15.0"))
check("the uploaded wheel downloads without sign-in", r.status_code == 200 and r.content == b"wheel-1.15.0", r.status_code)
cfg = client.get("/auth/config", headers=fwd).json()
check("config points at the newest: the upload beats the older bundle",
      cfg["helper"] == "https://kh.example.test/auth/download/" + wheel("1.15.0") and cfg["helper_version"] == "1.15.0",
      cfg)
check("help carries the newest link", wheel("1.15.0") in client.get("/auth/help", headers=fwd).text)
up(wheel("1.15.10"), b"wheel-1.15.10")
check("versions compare as numbers (1.15.10 > 1.15.9 > 1.15.0)",
      client.get("/auth/config").json()["helper_version"] == "1.15.10")
check("an older version stays downloadable for a rollback",
      client.get("/auth/download/" + wheel("1.15.0")).content == b"wheel-1.15.0")
check("an unknown name is 404", client.get("/auth/download/" + wheel("0.0.1")).status_code == 404)
r = client.get("/artifacts", headers=ADMIN)
check("maintainers list the artifacts", r.status_code == 200 and r.json()["count"] == 3 and r.json()["store"] == "hana",
      r.text)
check("members may not list them", client.get("/artifacts", headers=MEMBER).status_code == 403)

# ── 2. switching the store ──────────────────────────────────────────────────
VPS = {}


class FakeResp:
    def __init__(self, status, content=b"", method="GET", url=""):
        self.status_code, self.content = status, content
        self.request, self.url = type("R", (), {"method": method})(), url


class FakeRequests:
    def __init__(self, down=False):
        self.down, self.seen_headers, self.gets = down, [], []

    def put(self, url, data, headers, timeout):
        self.seen_headers.append(headers)
        if self.down:
            return FakeResp(500, method="PUT", url=url)
        VPS[url] = data
        return FakeResp(201, method="PUT", url=url)

    def get(self, url, headers, timeout):
        self.gets.append(url)
        return FakeResp(200, VPS[url], url=url) if url in VPS else FakeResp(404, url=url)

    def delete(self, url, headers, timeout):
        VPS.pop(url, None)
        return FakeResp(204, method="DELETE", url=url)


fake_http = FakeRequests()
import requests  # the store imports it lazily, so patching its functions reaches the store  # noqa: E402

real = (requests.put, requests.get, requests.delete)
requests.put, requests.get, requests.delete = fake_http.put, fake_http.get, fake_http.delete
try:
    vps = {"mode": "http", "config": {"base_url": "https://vps.example.test/kh/",
                                      "headers": {"Authorization": "Bearer vps-secret"}}}
    r = client.put("/artifacts/backend", json=vps, headers=ADMIN)
    check("switch hana -> http (a VPS) copies every artifact", r.status_code == 200
          and sorted(r.json()["copied"]) == sorted([wheel("1.15.0"), wheel("1.15.10"), "notes.txt"]), r.text)
    check("every file is on the VPS and the probe is gone",
          set(VPS) == {f"https://vps.example.test/kh/{n}" for n in (wheel("1.15.0"), wheel("1.15.10"), "notes.txt")},
          sorted(VPS))
    check("the VPS got the configured header", fake_http.seen_headers[-1] == {"Authorization": "Bearer vps-secret"})
    r = client.get("/artifacts/backend", headers=ADMIN)
    check("reading the setting masks the secret header",
          r.json()["mode"] == "http" and r.json()["config"]["headers"] == {"Authorization": artifacts.MASK}, r.text)
    fake_http.gets.clear()
    check("downloads now come from the VPS (proxy)",
          client.get("/auth/download/" + wheel("1.15.10")).content == b"wheel-1.15.10"
          and fake_http.gets == [f"https://vps.example.test/kh/{wheel('1.15.10')}"], fake_http.gets)
    up(wheel("1.15.11"), b"wheel-1.15.11")
    check("a new upload goes straight to the VPS", VPS.get(f"https://vps.example.test/kh/{wheel('1.15.11')}")
          == b"wheel-1.15.11")

    redirect = {"mode": "http", "config": {**vps["config"], "headers": {"Authorization": artifacts.MASK},
                                           "serve": "redirect", "get_url": "https://files.example.test/kh"}}
    r = client.put("/artifacts/backend", json=redirect, headers=ADMIN)
    check("a masked secret sent back keeps the stored one", r.status_code == 200
          and artifacts.settings()["config"]["headers"]["Authorization"] == "Bearer vps-secret", r.text)
    r = client.get("/auth/download/" + wheel("1.15.11"), follow_redirects=False)
    check("serve redirect answers 302 to the public URL", r.status_code == 302
          and r.headers["location"] == "https://files.example.test/kh/" + wheel("1.15.11"), (r.status_code, r.headers))

    fake_http.down = True
    r = client.put("/artifacts/backend", json={"mode": "http", "config": {"base_url": "https://broken.example.test/"}},
                   headers=ADMIN)
    check("a store that fails the probe changes nothing", r.status_code == 502
          and artifacts.settings()["config"]["base_url"] == "https://vps.example.test/kh/", r.text)
    fake_http.down = False
    check("an unknown mode is 400", client.put("/artifacts/backend", json={"mode": "ftp", "config": {}},
                                               headers=ADMIN).status_code == 400)
    check("members may not switch", client.put("/artifacts/backend", json={"mode": "hana", "config": {}},
                                               headers=MEMBER).status_code == 403)

    # s3, with an in-memory client
    BUCKET = {}

    class FakeS3:
        def put_object(self, Bucket, Key, Body):
            BUCKET[(Bucket, Key)] = Body

        def get_object(self, Bucket, Key):
            if (Bucket, Key) not in BUCKET:
                raise KeyError("NoSuchKey")
            return {"Body": type("B", (), {"read": lambda self, d=BUCKET[(Bucket, Key)]: d})()}

        def delete_object(self, Bucket, Key):
            BUCKET.pop((Bucket, Key), None)

        def generate_presigned_url(self, op, Params, ExpiresIn):
            return f"https://s3.example.test/{Params['Bucket']}/{Params['Key']}?sig=1"

    real_s3 = artifacts.STORES["s3"]
    artifacts.STORES["s3"] = lambda cfg: real_s3(cfg, client=FakeS3())
    s3 = {"mode": "s3", "config": {"bucket": "kh", "prefix": "artifacts", "access_key_id": "AK",
                                   "secret_access_key": "SK", "serve": "redirect"}}
    r = client.put("/artifacts/backend", json=s3, headers=ADMIN)
    check("switch http -> s3 copies from the VPS into the bucket", r.status_code == 200
          and BUCKET.get(("kh", f"artifacts/{wheel('1.15.10')}")) == b"wheel-1.15.10", r.text)
    masked_cfg = client.get("/artifacts/backend", headers=ADMIN).json()["config"]
    check("s3 keys are masked on read", masked_cfg["access_key_id"] == artifacts.MASK
          and masked_cfg["secret_access_key"] == artifacts.MASK and masked_cfg["bucket"] == "kh", masked_cfg)
    r = client.get("/auth/download/" + wheel("1.15.11"), follow_redirects=False)
    check("s3 redirect is a presigned URL", r.status_code == 302 and "sig=1" in r.headers["location"], r.headers)

    r = client.put("/artifacts/backend", json={"mode": "hana", "config": {}}, headers=ADMIN)
    check("switch back to hana copies everything home", r.status_code == 200 and len(r.json()["copied"]) == 4, r.text)
    check("downloads come from hana again", client.get("/auth/download/" + wheel("1.15.11")).content == b"wheel-1.15.11")
finally:
    requests.put, requests.get, requests.delete = real

r = client.delete("/artifacts/" + "notes.txt", headers=ADMIN)
check("a maintainer deletes an artifact", r.status_code == 200 and r.json()["deleted"] is True
      and client.get("/auth/download/notes.txt").status_code == 404, r.text)

print()
print(f"{len(FAILURES)} failure(s)" if FAILURES else "all passed")
sys.exit(1 if FAILURES else 0)
