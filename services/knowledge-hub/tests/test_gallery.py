"""Tests for the design gallery (app/gallery.py), 2026-10-25.

WHAT IS UNDER TEST
  1. WRITE. A person with project.write on 'designer' adds and replaces a design with PUT; a reader of
     designer, no sign-in and bad input (number, kind, base64) are refused; DELETE is for maintainers.
     The files are stored as bytes (BLOB) and come back byte for byte, also when they are not UTF-8.
  2. PUBLIC READ. Without sign-in: the list (no base64 in it, open to any origin, sorted by number),
     the thumbnail as image/webp and the demo as sandboxed HTML, a variant by ?v=, 404 for unknown ones.

Run from the repo root with the project venv:
    .venv\\Scripts\\python tests\\test_gallery.py

Uses a throwaway SQLite database; no network.
"""
import base64
import os
import sys
import tempfile
import time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

TMP = tempfile.mkdtemp(prefix="kh_gal_")
os.environ["KH_HOOKS_DB"] = os.path.join(TMP, "hooks.db")
os.environ["KH_STORE_BACKEND"] = "sqlite"
ISSUER = "https://keycloak.test/realms/knowledge-hub"
os.environ["KH_AUTH_ISSUER"] = ISSUER
os.environ["KH_AUTH_AUDIENCE"] = "kh-api"

import jwt  # noqa: E402
from cryptography.hazmat.primitives.asymmetric import rsa  # noqa: E402
from fastapi import FastAPI  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from app import auth, config, gallery, sqldb  # noqa: E402

assert config.HOOKS_DB_PATH == os.environ["KH_HOOKS_DB"], "test must run against a throwaway db"

FAILURES = []


def check(name, condition, detail=None):
    print(("ok   " if condition else "FAIL ") + name + ("" if condition or detail is None else f"  -> {detail}"))
    if not condition:
        FAILURES.append(name)


KEY = rsa.generate_private_key(public_exponent=65537, key_size=2048)
auth._keys.get = lambda kid: KEY.public_key() if kid == "k1" else None


def token(email, admin=False, projects=None):
    now = int(time.time())
    kh = {"role": "maintainer" if admin else "member", "permissions": [], "all_projects": [],
          "projects": projects or {}}
    claims = {"iss": ISSUER, "aud": "kh-api", "iat": now, "exp": now + 300, "email": email, "kh": kh}
    return {"Authorization": "Bearer " + jwt.encode(claims, KEY, algorithm="RS256", headers={"kid": "k1"})}


ADMIN = token("root@example.invalid", admin=True)
WRITER = token("rowan@example.invalid", projects={"designer": ["project.read", "project.write"]})
READER = token("ana@example.invalid", projects={"designer": ["project.read"]})

with sqldb.connect() as c:   # the base64 first version must be dropped on startup
    c.execute("CREATE TABLE kh_design_gallery (design_no TEXT PRIMARY KEY)")

app = FastAPI()
auth.install(app)
gallery.attach(app)
client = TestClient(app)

with sqldb.connect() as c:
    names = {r[0] for r in c.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall()}
check("startup drops the base64 first version and creates the BLOB tables",
      "kh_design_gallery" not in names and {"kh_gallery_design", "kh_gallery_variant"} <= names, names)

b64 = lambda data: base64.b64encode(data).decode()
HTML = "<!doctype html><title>demo</title><p>Hi 🍃</p>".encode()
THUMB = b"RIFF\x00\x00\x00\x00WEBPVP8 \xff\xfe\x80 not utf-8"


def design(**over):
    body = {"name": "cozy blog post card", "kind": "style", "desc": "Blog cards with a modal.",
            "demo": "Pinewood Notes", "spec": "vec_a", "ref": "vec_b", "added": "2026-10-25",
            "demo_b64": b64(HTML), "thumb_b64": b64(THUMB)}
    body.update(over)
    return body


# ── 1. write ────────────────────────────────────────────────────────────────
r = client.put("/gallery/designs/44", json=design(), headers=WRITER)
check("a designer writer adds a design", r.status_code == 200 and r.json()["no"] == "44"
      and "demo_b64" not in r.json(), r.text)
check("a designer reader may not write", client.put("/gallery/designs/45", json=design(), headers=READER).status_code == 403)
check("no sign-in may not write", client.put("/gallery/designs/45", json=design()).status_code == 401)
check("a bad number is refused", client.put("/gallery/designs/4a", json=design(), headers=WRITER).status_code == 400)
check("a bad kind is refused", client.put("/gallery/designs/45", json=design(kind="page"), headers=WRITER).status_code == 400)
check("bad base64 is refused", client.put("/gallery/designs/45", json=design(demo_b64="%%%"), headers=WRITER).status_code == 400)
check("a missing thumbnail is refused", client.put("/gallery/designs/45", json=design(thumb_b64=""), headers=WRITER).status_code == 400)
r = client.put("/gallery/designs/07", json=design(name="clay pastel dashboard", tags=["Animation"], alias="X1",
               variants=[{"label": "Dark", "demo_b64": b64(b"<p>dark</p>")}]), headers=WRITER)
check("a design with tags, alias and a variant", r.status_code == 200 and r.json()["variants"][0]["label"] == "Dark", r.text)
r = client.put("/gallery/designs/44", json=design(desc="Replaced."), headers=WRITER)
check("PUT again replaces", r.status_code == 200 and r.json()["desc"] == "Replaced.", r.text)

# ── 2. public read ──────────────────────────────────────────────────────────
r = client.get("/gallery/designs")
body = r.json()
check("the list is public and open to any origin", r.status_code == 200
      and r.headers.get("access-control-allow-origin") == "*", r.status_code)
check("the list is sorted by number and has no payloads", [d["no"] for d in body["designs"]] == ["07", "44"]
      and "b64" not in r.text, body)
d44 = body["designs"][1]
check("list entries carry catalog fields and relative URLs", d44["name"] == "cozy blog post card"
      and d44["demo"] == "Pinewood Notes" and d44["thumb_url"].startswith("/gallery/designs/44/thumb"), d44)
r = client.get("/gallery/designs?thumbs=1")
check("?thumbs=1 inlines the thumbnails as data URIs", r.json()["designs"][1]["thumb_data"]
      == "data:image/webp;base64," + b64(THUMB), r.text[:200])
r = client.get(d44["thumb_url"])
check("the thumbnail is served as webp", r.status_code == 200 and r.content == THUMB
      and r.headers["content-type"] == "image/webp", r.headers.get("content-type"))
r = client.get(d44["demo_url"])
check("the demo is served as sandboxed html", r.status_code == 200 and r.content == HTML
      and r.headers["content-type"].startswith("text/html")
      and r.headers.get("content-security-policy", "").startswith("sandbox")
      and "allow-same-origin" not in r.headers.get("content-security-policy", ""), r.headers)
v = body["designs"][0]["variants"][0]["demo_url"]
check("a variant is served by ?v=", client.get(v).content == b"<p>dark</p>")
check("an unknown variant is 404", client.get("/gallery/designs/07/demo?v=9").status_code == 404)
check("an unknown design is 404", client.get("/gallery/designs/99/demo").status_code == 404)
check("a junk number is 404", client.get("/gallery/designs/abc/thumb").status_code == 404)
check("a path in the number is not served", client.get("/gallery/designs/..%2fx/thumb").status_code in (401, 404))

r = client.put("/gallery/designs/44", json=design(demo_b64=b64(b"<p>v2</p>")), headers=WRITER)
check("a write is visible at once, not after the cache expires", client.get("/gallery/designs/44/demo").content == b"<p>v2</p>")

# ── delete ──────────────────────────────────────────────────────────────────
check("a writer may not delete", client.delete("/gallery/designs/07", headers=WRITER).status_code == 403)
r = client.delete("/gallery/designs/07", headers=ADMIN)
check("a maintainer deletes", r.status_code == 200 and r.json()["deleted"] is True, r.text)
check("the list no longer has it", [d["no"] for d in client.get("/gallery/designs").json()["designs"]] == ["44"])

print()
print("FAILED: " + ", ".join(FAILURES) if FAILURES else "all gallery tests passed")
sys.exit(1 if FAILURES else 0)
