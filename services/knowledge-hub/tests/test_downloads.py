"""Tests for download sources (app/downloads.py): /auth/download takes each module from a DB row (fen 2026-10-24).

WHAT IS UNDER TEST
  1. Only maintainers set a source; anyone downloads without sign-in.
  2. local: a file on the app's own host, by module or by file name; a path leaving the app folder, an absolute
     path or a missing file is refused when set, and a file gone later is a 503, never another file.
  3. https: the link (a Drive share link also in its direct form), version, sha256 and steps for an assistant;
     /auth/help step 1 then installs the wheel of that zip, /auth/config names the module route.
  4. No row: the older ways (artifact or bundled wheel) are unchanged.

Run from the repo root with the project venv:
    .venv\\Scripts\\python tests\\test_downloads.py
"""
import os
import sys
import tempfile
import time
from pathlib import Path

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

TMP = tempfile.mkdtemp(prefix="kh_dl_")
os.environ["KH_HOOKS_DB"] = os.path.join(TMP, "hooks.db")
os.environ["KH_STORE_BACKEND"] = "sqlite"
ISSUER = "https://keycloak.test/realms/knowledge-hub"
os.environ["KH_AUTH_ISSUER"] = ISSUER
os.environ["KH_AUTH_AUDIENCE"] = "kh-api"

import jwt  # noqa: E402
from cryptography.hazmat.primitives.asymmetric import rsa  # noqa: E402
from fastapi import FastAPI  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from app import artifacts, auth, config, downloads  # noqa: E402

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


ADMIN, MEMBER = token("root@example.invalid", admin=True), token("ana@example.invalid")
APP = Path(TMP) / "app-root"
(APP / "downloads").mkdir(parents=True)
WHEEL = APP / "downloads" / "kh_helper-9.9.9-py3-none-any.whl"
WHEEL.write_bytes(b"PK-wheel-bytes")
(Path(TMP) / "outside.txt").write_text("secret")
downloads.APP_ROOT = APP.resolve()
auth.DOWNLOADS_DIR = APP / "no-bundle"                # no bundled wheel: the fallback finds nothing
artifacts.latest = lambda module: None
artifacts.find = lambda name: None

app = FastAPI()
auth.install(app)
artifacts.init()
downloads.attach(app)
client = TestClient(app)
DRIVE = "https://drive.google.com/file/d/1qAtsZe5ii8jY2RQ_YQsSQspeQeCLnor0/view?usp=sharing"
SHA = "be59440e9552174c42db29b046952674dd5fb33f75ba4c7fd8e449b1903ccbcd"

# ── 4. no row: as before ────────────────────────────────────────────────────
check("no source and no wheel: 404", client.get("/auth/download/kh-helper").status_code == 404)
help_text = client.get("/auth/help").text
check("no source: /auth/help keeps its fallback line", "./tools/kh-helper" in help_text)

# ── 1. who may set ──────────────────────────────────────────────────────────
r = client.put("/downloads/kh-helper", json={"type": "local", "path": "downloads/" + WHEEL.name}, headers=MEMBER)
check("a member may not set a source", r.status_code == 403, r.text)
check("a member may not list them", client.get("/downloads", headers=MEMBER).status_code == 403)

# ── 2. local ────────────────────────────────────────────────────────────────
for name, body in (("a path leaving the app folder", {"type": "local", "path": "../outside.txt"}),
                   ("an absolute path", {"type": "local", "path": str(Path(TMP) / "outside.txt")}),
                   ("a drive path", {"type": "local", "path": "C:/Windows/win.ini"}),
                   ("a missing file", {"type": "local", "path": "downloads/nope.whl"}),
                   ("a URL as a local path", {"type": "local", "path": "https://x.test/a.whl"}),
                   ("an unknown type", {"type": "ftp", "path": "downloads/" + WHEEL.name})):
    r = client.put("/downloads/kh-helper", json=body, headers=ADMIN)
    check(f"local: {name} is refused", r.status_code == 400, (r.status_code, r.text))
r = client.put("/downloads/kh-helper", json={"type": "local", "path": "downloads/" + WHEEL.name, "version": "9.9.9"},
               headers=ADMIN)
check("a maintainer sets a local source", r.status_code == 200 and r.json()["file_name"] == WHEEL.name, r.text)
r = client.get("/auth/download/kh-helper")
check("anyone downloads it by module, no sign-in", r.status_code == 200 and r.content == b"PK-wheel-bytes",
      (r.status_code, r.content[:40]))
r = client.get("/auth/download/" + WHEEL.name)
check("and by its file name (what pip needs)", r.status_code == 200 and r.content == b"PK-wheel-bytes")
check("another name is still 404", client.get("/auth/download/outside.txt").status_code == 404)
help_text = client.get("/auth/help").text
check("/auth/help step 1 pip-installs the local file", f"/auth/download/{WHEEL.name}" in help_text)
cfg = client.get("/auth/config").json()
check("/auth/config names it", cfg["helper"].endswith("/auth/download/" + WHEEL.name) and cfg["helper_version"] == "9.9.9",
      cfg)
WHEEL.unlink()
r = client.get("/auth/download/kh-helper")
check("a local file gone later is a 503", r.status_code == 503, (r.status_code, r.text))

# ── 3. https ────────────────────────────────────────────────────────────────
r = client.put("/downloads/kh-helper", json={"type": "https", "path": "http://plain.test/x.zip"}, headers=ADMIN)
check("https: a plain http link is refused", r.status_code == 400, r.text)
r = client.put("/downloads/kh-helper", json={"type": "https", "path": DRIVE, "sha256": "abc"}, headers=ADMIN)
check("https: a bad sha256 is refused", r.status_code == 400, r.text)
r = client.put("/downloads/kh-helper", json={"type": "https", "path": DRIVE, "version": "1.18.0", "sha256": SHA.upper(),
                                            "file_name": "kh-helper-1.18.0.zip"}, headers=ADMIN)
check("a maintainer sets an https source", r.status_code == 200 and r.json()["sha256"] == SHA, r.text)
r = client.get("/auth/download/kh-helper")
body = r.json() if r.status_code == 200 else {}
check("anyone gets the link, its direct form, version and sha256",
      body.get("url") == DRIVE and body.get("version") == "1.18.0" and body.get("sha256") == SHA
      and body.get("direct_url") == "https://drive.usercontent.google.com/download?id=1qAtsZe5ii8jY2RQ_YQsSQspeQeCLnor0"
      "&export=download&confirm=t", body)
text = " ".join(body.get("steps", []))
check("the steps say download, check PK and sha256, unzip and install", "curl -L" in text and "PK" in text
      and SHA in text and "install.ps1" in text and "pip" in text, body.get("steps"))
help_text = client.get("/auth/help").text
check("/auth/help step 1 installs the wheel of the zip and points at the JSON",
      "kh_helper-1.18.0-py3-none-any.whl file" in help_text and "/auth/download/kh-helper answers JSON" in help_text
      and "{source}" not in help_text, help_text[help_text.find("1. Install"):][:500])
cfg = client.get("/auth/config").json()
check("/auth/config names the module route", cfg["helper"].endswith("/auth/download/kh-helper")
      and cfg["helper_version"] == "1.18.0", cfg)
r = client.get("/downloads", headers=ADMIN)
check("a maintainer lists the sources", r.status_code == 200 and r.json()["count"] == 1, r.text)

# ── back to no row ──────────────────────────────────────────────────────────
r = client.delete("/downloads/kh-helper", headers=ADMIN)
check("DELETE removes it", r.status_code == 200 and r.json()["deleted"] is True, r.text)
check("and the older way answers again", client.get("/auth/download/kh-helper").status_code == 404)

print()
print(f"{len(FAILURES)} failure(s)" if FAILURES else "all passed")
sys.exit(1 if FAILURES else 0)
