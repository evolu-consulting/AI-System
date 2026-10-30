"""Tests for technical users acting for a real person (app/auth.py TECHNICAL USERS), 2026-10-20.

WHAT IS UNDER TEST

  1. THE KEY. A technical user (KH permission kh.act_for_user) passes the real person's own access token
     in header X-KH-Acting-Token; KH verifies it and its worklog carries that person as
     metadata.acting_user. A forged or expired token is refused, anyone else's header is ignored, and a
     body value is never kept, so nobody can claim to be someone else.

  2. THE READS. A worklog carrying a real person is read back only by the technical user acting for
     the same person, by that person, or by a maintainer: /log/recent (project and own window),
     /vector/scroll, /vector/query and /context/step. A worklog without the key reads as before.

  2b. ANOTHER ISSUER. A person token of another sign-in service counts only when KH_ACTING_ISSUERS lists
     that issuer for this technical user, with its own audience and keys, and email_verified true.

  3. THE SHARED SUMMARIES. The daily listing, read by every member, leaves such worklogs out.

Run from the repo root with the project venv:
    .venv\\Scripts\\python tests\\test_acting_user.py

Uses a locally generated RSA key, throwaway stores and an in-process app; no network.
"""
import os
import sys
import tempfile
import time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

TMP = tempfile.mkdtemp(prefix="kh_acting_")
os.environ["KH_HOOKS_DB"] = os.path.join(TMP, "hooks.db")
os.environ["CHROMA_PATH"] = os.path.join(TMP, "chroma")
os.environ["KH_PROJECTS_PATH"] = os.path.join(TMP, "projects")
os.environ["KH_KUZU_PROJECTS_PATH"] = os.path.join(TMP, "kuzu")

ISSUER = "https://keycloak.test/realms/knowledge-hub"
os.environ["KH_AUTH_ISSUER"] = ISSUER
os.environ["KH_AUTH_AUDIENCE"] = "kh-api"
# An app's own realm (a chatbot's users), trusted for one technical user only.
FOREIGN = "https://keycloak.app.test/realms/ticketing"
os.environ["KH_ACTING_ISSUERS"] = ('[{"issuer": "%s/", "audience": "chatbot", '
                                   '"technical_users": ["Agent@kh-agent.invalid"]}, {"broken": 1}]' % FOREIGN)

import jwt  # noqa: E402
import numpy  # noqa: E402
from cryptography.hazmat.primitives.asymmetric import rsa  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from app import auth, config, projects  # noqa: E402

assert TMP in config.CHROMA_PATH, "test must run against a throwaway chroma dir"

import main  # noqa: E402
from app.caps import daily  # noqa: E402

FAILURES = []


def check(name, condition, detail=None):
    print(("ok   " if condition else "FAIL ") + name + ("" if condition or detail is None else f"  -> {detail}"))
    if not condition:
        FAILURES.append(name)


class _Model:
    """Stand-in embedder: every row gets the same vector, so a query returns every row it may see."""
    @staticmethod
    def encode(text, normalize_embeddings=True):
        if isinstance(text, list):
            return [_Model.encode(t) for t in text]
        v = numpy.zeros(384, dtype="float32")
        v[0] = 1.0
        return v


KEY = rsa.generate_private_key(public_exponent=65537, key_size=2048)
auth._keys.get = lambda kid: KEY.public_key() if kid == "k1" else None
auth.register_project = lambda pid, *rest: None          # no identity service here
auth.unregister_project = lambda pid: None

LOG = ["project.read", "project.write", "project.log"]


def raw_token(email, key=None, exp_in=300, kh=None, verified=None, iss=ISSUER, aud="kh-api"):
    now = int(time.time())
    claims = {"iss": iss, "aud": aud, "iat": now, "exp": now + exp_in, "email": email}
    if kh is not None:
        claims["kh"] = kh
    if verified is not None:
        claims["email_verified"] = verified
    return jwt.encode(claims, key or KEY, algorithm="RS256", headers={"kid": "k1"})


def token(email, projects_=None, admin=False, technical=False, acting=None):
    kh = {"role": "maintainer" if admin else "member",
          "permissions": ["project.create"] + ([auth.ACT_FOR_USER] if technical else []),
          "all_projects": LOG if admin else [],
          "projects": {p: list(v) for p, v in (projects_ or {}).items()}}
    headers = {"Authorization": "Bearer " + raw_token(email, kh=kh)}
    if acting:
        headers["X-KH-Acting-Token"] = acting
    return headers


TU_EMAIL = "agent@kh-agent.invalid"
RU1, RU2 = "ru.one@example.invalid", "ru.two@example.invalid"
TU = token(TU_EMAIL, {"alpha": LOG}, technical=True)
TU_RU1 = token(TU_EMAIL, {"alpha": LOG}, technical=True, acting=raw_token(RU1))
TU_RU2 = token(TU_EMAIL, {"alpha": LOG}, technical=True, acting="Bearer " + raw_token(RU2.upper()))
RU1_SELF = token(RU1, {"alpha": ["project.read"]})
MEMBER = token("member@example.invalid", {"alpha": LOG})
FAKE = token("member@example.invalid", {"alpha": LOG}, acting=raw_token(RU1))
ADMIN = token("root@example.invalid", admin=True)

main.app.state.model = _Model()
client = TestClient(main.app)
projects.ensure_orchestrator()
projects.get_or_create_project("alpha")


def log(text, headers, extra=None):
    meta = {"project": "alpha", "subject": "work", "topic": "work",
            "ts": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), **(extra or {})}
    return client.post("/vector/add", json={"text": text, "scope": "log", "metadata": meta}, headers=headers)


def texts(r):
    return sorted(h["source_text"] for h in r.json().get("hits", []))


# ── 1. the key ──────────────────────────────────────────────────────────────

for text, who in (("plain TU log", TU), ("ru1 log", TU_RU1), ("ru2 log", TU_RU2),
                  ("member log", MEMBER), ("fake header log", FAKE)):
    r = log(text, who)
    check(f"write '{text}'", r.status_code == 200, r.text)
r = log("forged body log", MEMBER, {"acting_user": RU2})
check("a body value is accepted as a write", r.status_code == 200, r.text)

r = client.post("/vector/scroll", json={"scope": "log", "project": "alpha", "limit": 100}, headers=ADMIN)
by_text = {h["source_text"]: h["metadata"] for h in r.json()["hits"]}
check("the maintainer reads all six", len(by_text) == 6, sorted(by_text))
check("a technical user's log for a person carries that person", by_text["ru1 log"].get("acting_user") == RU1,
      by_text["ru1 log"])
check("a 'Bearer' prefix is taken, the e-mail lower-cased", by_text["ru2 log"].get("acting_user") == RU2,
      by_text["ru2 log"])
check("a technical user without a header writes no key", not by_text["plain TU log"].get("acting_user"),
      by_text["plain TU log"])
check("a member's header is ignored", not by_text["fake header log"].get("acting_user"), by_text["fake header log"])
check("a body value is dropped", not by_text["forged body log"].get("acting_user"), by_text["forged body log"])
OTHER_KEY = rsa.generate_private_key(public_exponent=65537, key_size=2048)
for name, bad in (("a plain e-mail", RU1), ("a token signed by someone else", raw_token(RU1, key=OTHER_KEY)),
                  ("an expired token", raw_token(RU1, exp_in=-120)),
                  ("a token with an unverified e-mail", raw_token(RU1, verified=False))):
    r = client.post("/vector/scroll", json={"scope": "log", "project": "alpha"},
                    headers=token(TU_EMAIL, {"alpha": LOG}, technical=True, acting=bad))
    check(f"{name} as the acting token is refused", r.status_code == 401, (r.status_code, r.text[:200]))

# ── 2. the reads ────────────────────────────────────────────────────────────

UNKEYED = ["fake header log", "forged body log", "member log", "plain TU log"]
CASES = [("TU acting for RU1", TU_RU1, sorted(UNKEYED + ["ru1 log"])),
         ("TU acting for RU2", TU_RU2, sorted(UNKEYED + ["ru2 log"])),
         ("TU with no header", TU, UNKEYED),
         ("RU1 signed in as themselves", RU1_SELF, sorted(UNKEYED + ["ru1 log"])),
         ("another member", MEMBER, UNKEYED),
         ("a maintainer", ADMIN, sorted(UNKEYED + ["ru1 log", "ru2 log"]))]
for name, who, want in CASES:
    r = client.get("/log/recent", params={"project": "alpha", "limit": 50}, headers=who)
    check(f"/log/recent project: {name}", texts(r) == want and r.json()["matched"] == len(want), texts(r))
    r = client.get("/log/recent", params={"project": "alpha", "limit": 1}, headers=who)
    check(f"/log/recent limit 1 is a full page: {name}", r.json()["count"] == 1, r.json())
    r = client.post("/vector/scroll", json={"scope": "log", "project": "alpha", "limit": 100}, headers=who)
    check(f"/vector/scroll: {name}", texts(r) == want, texts(r))
    r = client.post("/vector/query", json={"text": "work", "scope": "log", "project": "alpha", "k": 20},
                    headers=who)
    got = sorted(h["source_text"] for h in r.json().get("hits", []))
    check(f"/vector/query: {name}", got == want, got)

r = client.get("/log/recent", params={"limit": 50}, headers=TU_RU1)
check("/log/recent own window: TU acting for RU1 sees its own unkeyed rows and RU1's",
      texts(r) == ["plain TU log", "ru1 log"], texts(r))
r = client.get("/log/recent", params={"limit": 50}, headers=TU_RU2)
check("/log/recent own window: TU acting for RU2", texts(r) == ["plain TU log", "ru2 log"], texts(r))

r = client.post("/context/step", json={"text": "work", "project": "alpha", "include_log": True}, headers=TU_RU2)
packed = " ".join(i.get("text", "") for i in r.json().get("items", []))
check("/context/step answers", r.status_code == 200, r.text[:300])
check("/context/step keeps another person's log out", "ru1 log" not in packed, packed[:400])

# ── 2b. another issuer ──────────────────────────────────────────────────────

FKEY = rsa.generate_private_key(public_exponent=65537, key_size=2048)
check("KH_ACTING_ISSUERS: a broken entry is left out, the good one kept", list(auth.acting_issuers()) == [FOREIGN],
      list(auth.acting_issuers()))
auth.acting_issuers()[FOREIGN].keys.get = lambda kid: FKEY.public_key() if kid == "k1" else None
RU3 = "ru.three@example.invalid"


def foreign(email=RU3, **kw):
    kw.setdefault("verified", True)
    return raw_token(email, key=kw.pop("key", FKEY), iss=kw.pop("iss", FOREIGN), aud=kw.pop("aud", "chatbot"), **kw)


r = log("ru3 log", token(TU_EMAIL, {"alpha": LOG}, technical=True, acting=foreign()))
check("a listed issuer's verified person token is taken", r.status_code == 200, r.text)
r = client.post("/vector/scroll", json={"scope": "log", "project": "alpha", "limit": 100}, headers=ADMIN)
row = {h["source_text"]: h["metadata"] for h in r.json()["hits"]}.get("ru3 log") or {}
check("the worklog carries the other issuer's person", row.get("acting_user") == RU3, row)
r = client.get("/log/recent", params={"project": "alpha", "limit": 50},
               headers=token(TU_EMAIL, {"alpha": LOG}, technical=True, acting=foreign()))
check("the TU acting for that person reads it back", "ru3 log" in texts(r), texts(r))
r = client.get("/log/recent", params={"project": "alpha", "limit": 50}, headers=TU_RU1)
check("acting for someone else does not", "ru3 log" not in texts(r), texts(r))
OTHER_TU = token("other.agent@kh-agent.invalid", {"alpha": LOG}, technical=True)
for name, headers in (
        ("a TU the issuer is not listed for", {**OTHER_TU, "X-KH-Acting-Token": foreign()}),
        ("another audience", token(TU_EMAIL, {"alpha": LOG}, technical=True, acting=foreign(aud="account"))),
        ("no email_verified", token(TU_EMAIL, {"alpha": LOG}, technical=True, acting=foreign(verified=None))),
        ("email_verified false", token(TU_EMAIL, {"alpha": LOG}, technical=True, acting=foreign(verified=False))),
        ("signed by another key", token(TU_EMAIL, {"alpha": LOG}, technical=True, acting=foreign(key=OTHER_KEY))),
        ("an issuer nobody listed", token(TU_EMAIL, {"alpha": LOG}, technical=True,
                                          acting=foreign(iss="https://evil.test/realms/x"))),
        ("expired", token(TU_EMAIL, {"alpha": LOG}, technical=True, acting=foreign(exp_in=-120)))):
    r = client.get("/log/recent", params={"project": "alpha"}, headers=headers)
    check(f"another issuer's token is refused: {name}", r.status_code == 401, (r.status_code, r.text[:200]))

# ── 3. the shared summaries ─────────────────────────────────────────────────

lanes = daily.log_lanes("alpha")
rows = daily._rows(lanes, daily._stamps(lanes, 0, int(time.time() * 1000) + 60_000))
listed = sorted(r["text"].split(" ", 0)[0] for r in rows)
check("the daily rows leave every keyed log out", listed == UNKEYED, listed)

# ── 4. sessions of one account (X-KH-Actor, app/auth.py ACTORS) ─────────────

for text, who in (("session one log", {**MEMBER, "X-KH-Actor": "sess-1"}),
                  ("session two log", {**MEMBER, "X-KH-Actor": "sess-2"}),
                  ("forged actor log", MEMBER),
                  ("bad actor log", {**MEMBER, "X-KH-Actor": "not ok!"}),
                  ("ru1 session log", {**TU_RU1, "X-KH-Actor": "sess-9"})):
    check(f"write '{text}'", log(text, who, {"actor": "from-body"} if text == "forged actor log" else None)
          .status_code == 200)
r = client.post("/vector/scroll", json={"scope": "log", "project": "alpha", "limit": 100}, headers=ADMIN)
by_text = {h["source_text"]: h["metadata"] for h in r.json()["hits"]}
check("each row carries the session that wrote it", by_text["session one log"].get("actor") == "sess-1"
      and by_text["session two log"].get("actor") == "sess-2", by_text.get("session one log"))
check("a body value is dropped", not by_text["forged actor log"].get("actor"), by_text["forged actor log"])
check("a malformed header is no actor", not by_text["bad actor log"].get("actor"), by_text["bad actor log"])
check("a session and a real person are kept side by side", by_text["ru1 session log"].get("actor") == "sess-9"
      and by_text["ru1 session log"].get("acting_user") == RU1, by_text["ru1 session log"])
r = client.get("/log/recent", params={"project": "alpha", "limit": 100}, headers={**MEMBER, "X-KH-Actor": "sess-1"})
check("a session reads every session's logs of its account", {"session one log", "session two log"} <= set(texts(r)),
      texts(r))

print()
print("FAILED: " + ", ".join(FAILURES) if FAILURES else "all passed")
sys.exit(1 if FAILURES else 0)
