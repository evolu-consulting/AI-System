"""Tests for entity cards (app/entities.py), 2026-09-30.

WHAT IS UNDER TEST
  1. ONE CARD PER ENTITY. Learning the same entity twice updates its card: aliases, relations and
     source log ids merge, role/purpose are replaced, the id stays the same.
  2. MATCH. /entities/match finds cards named in a prompt by folded whole-word match (accents and
     case ignored, an alias counts), returns one line each, bounded by limit, and only from projects
     the caller may read.
  3. GRAPH. /entities/{project}/{name}?depth=N walks the relations.
  4. ACCESS. Writing a card needs project.write; a reader cannot plant one.

Run from the repo root with the project venv:
    .venv\\Scripts\\python tests\\test_entities.py

Throwaway chroma dir + hooks.db, a locally generated RSA key and a stubbed embedder.
"""
import os
import sys
import tempfile
import time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

TMP = tempfile.mkdtemp(prefix="kh_entities_")
os.environ["KH_HOOKS_DB"] = os.path.join(TMP, "hooks.db")
os.environ["CHROMA_PATH"] = os.path.join(TMP, "chroma")
os.environ["KH_PROJECTS_PATH"] = os.path.join(TMP, "projects")
os.environ["KH_KUZU_PROJECTS_PATH"] = os.path.join(TMP, "kuzu")
ISSUER = "https://keycloak.test/realms/knowledge-hub"
os.environ["KH_AUTH_ISSUER"] = ISSUER
os.environ["KH_AUTH_AUDIENCE"] = "kh-api"

import jwt  # noqa: E402
import numpy  # noqa: E402
from cryptography.hazmat.primitives.asymmetric import rsa  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from app import auth, config, projects  # noqa: E402

assert TMP in config.CHROMA_PATH, "test must run against a throwaway chroma dir"

import main  # noqa: E402

FAILURES = []


def check(name, condition, detail=None):
    print(("ok   " if condition else "FAIL ") + name + ("" if condition or detail is None else f"  -> {detail}"))
    if not condition:
        FAILURES.append(name)


class _Model:
    @staticmethod
    def encode(text, normalize_embeddings=True):
        v = numpy.zeros(384, dtype="float32")
        v[0] = 1.0
        return v


KEY = rsa.generate_private_key(public_exponent=65537, key_size=2048)
auth._keys.get = lambda kid: KEY.public_key() if kid == "k1" else None
FULL = ["project.read", "project.write", "project.log"]


def token(email, grants):
    now = int(time.time())
    kh = {"role": "member", "permissions": [], "all_projects": [], "projects": grants}
    claims = {"iss": ISSUER, "aud": "kh-api", "iat": now, "exp": now + 300, "email": email, "kh": kh}
    return {"Authorization": "Bearer " + jwt.encode(claims, KEY, algorithm="RS256", headers={"kid": "k1"})}


for pid in ("alpha", "gamma"):
    projects.get_or_create_project(pid)
ANA = token("ana@example.invalid", {"alpha": FULL, "gamma": FULL})
BEN = token("ben@example.invalid", {"alpha": ["project.read"]})
main.app.state.model = _Model()
client = TestClient(main.app)


def put(body, who=ANA):
    return client.post("/entities", json=body, headers=who)


# ── 1. one card per entity ─────────────────────────────────────────────────
r = put({"project": "alpha", "name": "Elio", "type": "person", "role": "developer on the NodeJS work",
         "relations": [{"rel": "develops", "target": "NodeJS service"}], "source_log_ids": ["vec_a"]})
check("a card is created", r.status_code == 200 and not r.json()["updated"], r.text[:200])
first_id = r.json()["id"]
r = put({"project": "alpha", "name": "elio", "type": "person", "aliases": ["Élio N."],
         "relations": [{"rel": "develops", "target": "NodeJS service"}, {"rel": "waits_for", "target": "Floyd"}],
         "source_log_ids": ["vec_b"]})
card = r.json()
check("the same entity updates its card (same id)", card["updated"] and card["id"] == first_id, card.get("id"))
check("relations merge without duplicates", len(card["relations"]) == 2, card["relations"])
check("source log ids accumulate", card["source_log_ids"] == ["vec_a", "vec_b"], card["source_log_ids"])
check("role is kept when not given again", card["role"] == "developer on the NodeJS work", card["role"])
put({"project": "alpha", "name": "Floyd", "type": "person", "role": "reviewer",
     "relations": [{"rel": "reviews", "target": "NodeJS service"}]})
put({"project": "alpha", "name": "NodeJS service", "type": "system", "purpose": "order API"})
put({"project": "gamma", "name": "Elio", "type": "person", "role": "gamma-side contact"})
r = client.post("/vector/scroll", json={"scope": "entity", "project": "alpha", "limit": 50}, headers=ANA).json()
check("three cards in alpha, not four", r["matched"] == 3, r["matched"])

# ── 2. match ────────────────────────────────────────────────────────────────
r = client.get("/entities/match", params={"text": "Hỏi ELIO xem phần B xong chưa", "project": "alpha"}, headers=ANA).json()
check("folded whole-word match finds Elio", r["count"] == 1 and r["cards"][0]["name"] == "Elio", r)
check("one line per card", r["lines"] and r["lines"][0].startswith("Elio (person, alpha)"), r["lines"])
r = client.get("/entities/match", params={"text": "ping élio n. and floyd"}, headers=ANA).json()
check("aliases count, across the caller's projects", {c["name"] for c in r["cards"]} == {"Elio", "Floyd"}
      and {c["project"] for c in r["cards"]} == {"alpha", "gamma"}, [(c["name"], c["project"]) for c in r["cards"]])
r = client.get("/entities/match", params={"text": "elio", "limit": 1}, headers=ANA).json()
check("limit bounds the answer", r["count"] == 1, r["count"])
r = client.get("/entities/match", params={"text": "floydish elionaire"}, headers=ANA).json()
check("no partial-word matches", r["count"] == 0, r["lines"])
r = client.get("/entities/match", params={"text": "elio"}, headers=BEN).json()
check("a caller sees only projects they may read", {c["project"] for c in r["cards"]} == {"alpha"},
      [c["project"] for c in r["cards"]])
r = client.get("/entities/match", params={"text": "elio", "project": "gamma"}, headers=BEN)
check("naming a project the caller cannot read is refused", r.status_code == 403, r.status_code)

# ── 3. graph ────────────────────────────────────────────────────────────────
r = client.get("/entities/alpha/Elio", params={"depth": 1}, headers=BEN).json()
check("depth 1 reaches what Elio's relations name", {c["name"] for c in r["linked"]} == {"NodeJS service", "Floyd"},
      [c["name"] for c in r.get("linked", [])])
r = client.get("/entities/alpha/Floyd", params={"depth": 0}, headers=BEN).json()
check("depth 0 is the card alone", r["linked"] == [] and r["entity"]["role"] == "reviewer")
r = client.get("/entities/alpha/nobody", headers=BEN)
check("an unknown entity is 404", r.status_code == 404, r.status_code)

# ── 4. access ───────────────────────────────────────────────────────────────
r = put({"project": "alpha", "name": "Mallory", "type": "person"}, who=BEN)
check("a reader cannot write a card", r.status_code == 403, r.status_code)
r = put({"project": "alpha", "name": "X", "type": "spaceship"})
check("an unknown type is refused", r.status_code == 400, r.status_code)
r = put({"project": "alpha", "name": "X", "relations": [{"rel": "uses"}]})
check("a relation without a target is refused", r.status_code == 400, r.status_code)

print(f"\n{'ALL PASS' if not FAILURES else 'FAILED'}  ({len(FAILURES)} failed)")
sys.exit(1 if FAILURES else 0)
