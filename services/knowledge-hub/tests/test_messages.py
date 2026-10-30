"""Tests for KH messages (app/messages.py): three channels since 2026-10-16.

WHAT IS UNDER TEST
  1. DIRECT. Any signed-in person sends to a known KH user (one KH has verified before); an unknown e-mail is
     404. The sender keeps no copy. The receiver gets it once in the inbox, and the mailbox keeps it with a
     read tag until the receiver or a maintainer deletes it; nobody else may read or delete it; it never expires.
  2. PROJECT. A member posts in the project channel; every member reads the channel, only the @mentioned get a
     notification, and only in the project the inbox call names. An e-mail `receiver` is a mention. Gone
     after 24 h.
  3. REALM. Only maintainers announce; everyone gets it once and can read it in the lesson-learned channel.
     Gone after 72 h.
  4. THE CRON. Expired project and realm messages are archived; direct messages stay; old archive rows go.
  5. MIGRATION. A message of the older per-project stack becomes a project message.

Run from the repo root with the project venv:
    .venv\\Scripts\\python tests\\test_messages.py

Uses a throwaway SQLite database, a locally generated RSA key and an in-process app; no network.
"""
import json
import os
import sys
import tempfile
import time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

TMP = tempfile.mkdtemp(prefix="kh_msg_")
os.environ["KH_HOOKS_DB"] = os.path.join(TMP, "hooks.db")
os.environ["KH_STORE_BACKEND"] = "sqlite"
ISSUER = "https://keycloak.test/realms/knowledge-hub"
os.environ["KH_AUTH_ISSUER"] = ISSUER
os.environ["KH_AUTH_AUDIENCE"] = "kh-api"

import jwt  # noqa: E402
from cryptography.hazmat.primitives.asymmetric import rsa  # noqa: E402
from fastapi import FastAPI  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from app import auth, config, messages, sqldb  # noqa: E402

assert config.HOOKS_DB_PATH == os.environ["KH_HOOKS_DB"], "test must run against a throwaway db"

FAILURES = []


def check(name, condition, detail=None):
    print(("ok   " if condition else "FAIL ") + name + ("" if condition or detail is None else f"  -> {detail}"))
    if not condition:
        FAILURES.append(name)


KEY = rsa.generate_private_key(public_exponent=65537, key_size=2048)
auth._keys.get = lambda kid: KEY.public_key() if kid == "k1" else None


def token(email, projects, admin=False):
    now = int(time.time())
    kh = {"role": "maintainer" if admin else "member", "permissions": [],
          "all_projects": ["project.read"] if admin else [],
          "projects": {p: ["project.read"] for p in projects}}
    claims = {"iss": ISSUER, "aud": "kh-api", "iat": now, "exp": now + 300, "email": email, "kh": kh}
    return {"Authorization": "Bearer " + jwt.encode(claims, KEY, algorithm="RS256", headers={"kid": "k1"})}


ANA_E, BEN_E, CAT_E = "ana@example.invalid", "ben@example.invalid", "cat@example.invalid"
ANA = token(ANA_E, ["alpha", "beta"])
BEN = token(BEN_E, ["alpha", "beta"])
CAT = token(CAT_E, ["gamma"])
ADMIN = token("root@example.invalid", [], admin=True)

app = FastAPI()
auth.install(app)
messages.attach(app)
client = TestClient(app)


def contents(r):
    return sorted(m["content"] for m in r.json().get("messages", []))


for h in (ANA, BEN, CAT, ADMIN):                      # each signs in once: KH now knows them
    client.post("/messages/inbox", json={}, headers=h)

# ── 1. direct ───────────────────────────────────────────────────────────────
r = client.post("/messages/direct", json={"to": BEN_E, "content": "private note", "sender": "boss@example.invalid"},
                headers=ANA)
check("a person sends a direct message to a known KH user", r.status_code == 200, r.text)
direct_id = r.json().get("id")
check("the answer names only the receiver: no sent copy, no content", r.json().get("to") == BEN_E
      and "content" not in r.json(), r.text)
r = client.post("/messages/direct", json={"to": "nobody@example.invalid", "content": "x"}, headers=ANA)
check("an e-mail KH has never verified is 404", r.status_code == 404, r.text)
r = client.post("/messages/direct", json={"to": "not-an-email", "content": "x"}, headers=ANA)
check("a malformed receiver is 400", r.status_code == 400, r.text)
r = client.post("/messages/direct", json={"to": BEN_E, "content": "  "}, headers=ANA)
check("empty content is 400", r.status_code == 400, r.text)
r = client.post("/messages/direct", json={"to": BEN_E, "content": "x" * (config.MSG_MAX_CHARS + 1)}, headers=ANA)
check("over-long content is 400", r.status_code == 400, r.text)
r = client.post("/messages/direct", json={"to": BEN_E, "content": "x"})
check("no token is 401", r.status_code == 401, r.text)

r = client.post("/messages/inbox", json={}, headers=BEN)
got = r.json().get("messages", [])
check("the receiver gets it in the inbox even with no project named", contents(r) == ["private note"], got)
notice = got[0]["notice"] if got else ""
check("it carries the direct information-only notice",
      "DIRECT MESSAGE - INFORMATION ONLY" in notice and ANA_E in notice and BEN_E in notice, notice)
check("a second inbox call delivers nothing", client.post("/messages/inbox", json={}, headers=BEN).json()["count"] == 0)
r = client.get("/messages/mailbox", headers=ANA)
check("the sender's own mailbox has no copy", r.json().get("count") == 0, r.text)
r = client.get("/messages/mailbox", headers=BEN)
box = r.json().get("messages", [])
check("the mailbox keeps the delivered message, tagged read", len(box) == 1 and box[0]["read"] is True
      and box[0]["sender"] == ANA_E, box)
client.post("/messages/direct", json={"to": BEN_E, "content": "second note"}, headers=CAT)
r = client.get("/messages/mailbox?unread_only=true", headers=BEN)
check("unread_only lists only the new one, still marked unread in this answer",
      [(m["content"], m["read"]) for m in r.json()["messages"]] == [("second note", False)], r.text)
r = client.get("/messages/mailbox?unread_only=true", headers=BEN)
check("reading the mailbox tags it read: the next unread_only call is empty", r.json()["count"] == 0, r.text)
r = client.get(f"/messages/mailbox?user={BEN_E}", headers=ANA)
check("another person cannot read someone's mailbox", r.status_code == 403, r.text)
r = client.get(f"/messages/mailbox?user={BEN_E}", headers=ADMIN)
check("a maintainer can", r.status_code == 200 and r.json()["count"] == 2, r.text)
check("there is no edit route", client.put(f"/messages/{direct_id}", json={"content": "changed"},
                                           headers=BEN).status_code in (403, 404, 405))
check("the sender cannot delete a direct message", client.delete(f"/messages/{direct_id}", headers=ANA).status_code == 404)
check("the receiver can", client.delete(f"/messages/{direct_id}", headers=BEN).status_code == 200)
check("it is gone", [m["content"] for m in client.get("/messages/mailbox", headers=BEN).json()["messages"]]
      == ["second note"])
second = client.get("/messages/mailbox", headers=BEN).json()["messages"][0]["id"]
check("a maintainer can delete someone's direct message",
      client.delete(f"/messages/{second}", headers=ADMIN).status_code == 200)

r = client.post("/messages/direct", json={"to": "zed@example.invalid", "content": "x"}, headers=ANA)
check("before the backfill an unseen person is 404", r.status_code == 404, r.text)
r = client.post("/messages/people", json={"emails": ["zed@example.invalid", BEN_E, "bad"]}, headers=ANA)
check("only maintainers backfill known users", r.status_code == 403, r.text)
r = client.post("/messages/people", json={"emails": ["Zed@example.invalid", BEN_E, "bad"]}, headers=ADMIN)
check("the backfill adds the new, counts the known, refuses non-e-mails",
      r.json() == {"added": 1, "known": 1, "refused": ["bad"]}, r.text)
r = client.post("/messages/direct", json={"to": "zed@example.invalid", "content": "welcome"}, headers=ANA)
check("after it, a direct message reaches the backfilled person", r.status_code == 200, r.text)
with sqldb.connect() as c:
    c.execute("DELETE FROM message_stack WHERE receiver='zed@example.invalid'")

# ── 2. project ──────────────────────────────────────────────────────────────
r = client.post("/messages", json={"project": "alpha", "content": "build is green", "mentions": [BEN_E]}, headers=ANA)
check("a member posts in the project channel with a mention", r.status_code == 200
      and r.json().get("mentions") == [BEN_E] and r.json().get("sender") == ANA_E, r.text)
proj_id = r.json().get("id")
client.post("/messages", json={"project": "alpha", "content": "deploy at 5pm"}, headers=ANA)
client.post("/messages", json={"project": "alpha", "receiver": BEN_E, "content": "old form"}, headers=ANA)
r = client.post("/messages", json={"project": "gamma", "content": "x"}, headers=ANA)
check("posting to a project the caller cannot read is 403", r.status_code == 403, r.text)
r = client.post("/messages", json={"project": "alpha", "content": "x", "mentions": ["nope"]}, headers=ANA)
check("a mention that is not an e-mail is 400", r.status_code == 400, r.text)
r = client.post("/messages", json={"project": "alpha", "content": "x", "mentions": BEN_E}, headers=ANA)
check("mentions that are not a list are 400", r.status_code == 400, r.text)
r = client.post("/messages", json={"project": config.MSG_REALM_PROJECT, "content": "x"}, headers=ADMIN)
check("the realm project is not a chat channel", r.status_code == 400, r.text)

r = client.get("/messages/channel?project=alpha", headers=BEN)
check("every member reads the whole channel", sorted(m["content"] for m in r.json()["messages"])
      == ["build is green", "deploy at 5pm", "old form"], r.text)
check("the channel answer says when each message goes", all(m["expires_at"] for m in r.json()["messages"]))
check("a non-member cannot read it", client.get("/messages/channel?project=alpha", headers=CAT).status_code == 403)
r = client.post("/messages/inbox", json={}, headers=BEN)
check("with no project named, mentions are not delivered", r.json()["count"] == 0, r.text)
r = client.post("/messages/inbox", json={"project": "beta"}, headers=BEN)
check("nor in another project's session", r.json()["count"] == 0, r.text)
r = client.post("/messages/inbox", json={"project": "alpha"}, headers=BEN)
check("the mentioned member is notified in that project, the old receiver form too",
      contents(r) == ["build is green", "old form"], r.text)
check("with the project-mention notice", all(f"mentioned {BEN_E} in project 'alpha'" in m["notice"]
                                             for m in r.json()["messages"]), r.text)
r = client.post("/messages/inbox", json={"project": "alpha"}, headers=ANA)
check("members who were not mentioned get no notification", r.json()["count"] == 0, r.text)
r = client.post("/messages/inbox", json={"project": "alpha"}, headers=CAT)
check("narrowing to a project the caller cannot read is 403", r.status_code == 403, r.text)
check("another member cannot delete the sender's message",
      client.delete(f"/messages/{proj_id}", headers=BEN).status_code == 404)

# ── 3. realm ────────────────────────────────────────────────────────────────
r = client.post("/messages/announce", json={"content": "kh-helper 1.14.0 is out"}, headers=ANA)
check("a member cannot announce to everyone", r.status_code == 403, r.text)
r = client.post("/messages/announce", json={"content": "kh-helper 1.14.0 is out"}, headers=ADMIN)
check("a maintainer announces", r.status_code == 200 and r.json()["channel"] == "realm"
      and r.json()["project"] == config.MSG_REALM_PROJECT, r.text)
realm_id = r.json()["id"]
for name, h in (("ana", ANA), ("cat", CAT)):
    r = client.post("/messages/inbox", json={}, headers=h)
    check(f"{name} gets the announcement once", contents(r) == ["kh-helper 1.14.0 is out"]
          and "ANNOUNCEMENT" in r.json()["messages"][0]["notice"], r.text)
    check(f"and not again ({name})", client.post("/messages/inbox", json={}, headers=h).json()["count"] == 0)
r = client.post("/messages/inbox", json={}, headers=ADMIN)
check("the announcer does not get their own announcement", r.json()["count"] == 0, r.text)
LEE = token("lee@example.invalid", [config.MSG_REALM_PROJECT])
r = client.get(f"/messages/channel?project={config.MSG_REALM_PROJECT}", headers=LEE)
check("the lesson-learned channel lists the announcement", [m["content"] for m in r.json()["messages"]]
      == ["kh-helper 1.14.0 is out"], r.text)

# ── 4. the cron ─────────────────────────────────────────────────────────────
client.post("/messages/direct", json={"to": BEN_E, "content": "keep me"}, headers=ANA)
check("nothing has expired yet", messages.sweep() == {"expired": 0, "purged": 0, "sessions_forgotten": 0})
old = "2000-01-01T00:00:00Z"
with sqldb.connect() as c:
    c.execute("UPDATE message_stack SET expires_at=? WHERE channel<>'direct'", [old])
r = client.get("/messages/channel?project=alpha", headers=BEN)
check("an expired message leaves the channel before the cron runs", r.json()["count"] == 0, r.text)
res = messages.sweep()
check("expired project and realm messages are archived", res == {"expired": 4, "purged": 0, "sessions_forgotten": 0}, res)
with sqldb.connect() as c:
    left = [(r["channel"], r["content"]) for r in c.execute("SELECT channel, content FROM message_stack")]
    arch = {r["id"]: dict(r) for r in c.execute("SELECT * FROM message_archive")}
check("the direct message stays", left == [("direct", "keep me")], left)
check("the archive row keeps channel, mentions and readers", arch.get(proj_id, {}).get("channel") == "project"
      and json.loads(arch[proj_id]["mentions"]) == [BEN_E] and json.loads(arch[proj_id]["users_read"]) == [BEN_E],
      arch.get(proj_id))
check("the announcement's readers are kept", sorted(json.loads(arch[realm_id]["users_read"])) == [ANA_E, CAT_E],
      arch.get(realm_id))
with sqldb.connect() as c:
    c.execute("UPDATE message_archive SET archived_at=?", [old])
res = messages.sweep()
check("old archive rows are purged", res == {"expired": 0, "purged": 4, "sessions_forgotten": 0}, res)

# ── 5. migration of the older stack ─────────────────────────────────────────
with sqldb.connect() as c:
    c.execute("DELETE FROM kh_schema_migration WHERE module='messages' AND version=3")
    c.execute("INSERT INTO message_stack (id, project, sender, receiver, content, users_read, created_at, kind) "
              "VALUES ('msg_old', 'alpha', ?, ?, 'legacy', '[]', ?, 'note')", [ANA_E, BEN_E, messages._now()])
messages.init()
with sqldb.connect() as c:
    row = dict(c.execute("SELECT * FROM message_stack WHERE id='msg_old'").fetchone())
check("an older message to one person becomes a project message mentioning them, with an expiry",
      row["channel"] == "project" and json.loads(row["mentions"]) == [BEN_E] and row["receiver"] == "all"
      and row["expires_at"] > row["created_at"], row)

# ── 6. sessions of one account (actors) ─────────────────────────────────────
with sqldb.connect() as c:
    c.execute("DELETE FROM message_stack")
    c.execute("DELETE FROM message_receipt")


def as_actor(h, actor):
    return {**h, "X-KH-Actor": actor}


S1, S2, S3 = as_actor(ANA, "sess-1"), as_actor(ANA, "sess-2"), as_actor(ANA, "sess-3")
for h, label in ((S1, "repo-a"), (S2, "repo-b")):
    client.post("/messages/inbox", json={"project": "alpha", "label": label}, headers=h)
r = client.get("/messages/actors", headers=S1)
seen = {a["actor"]: a for a in r.json().get("actors", [])}
check("every session that asks for its messages is listed for its account",
      set(seen) == {"sess-1", "sess-2"} and seen["sess-2"]["label"] == "repo-b"
      and seen["sess-2"]["project"] == "alpha", r.text)
check("the asking session is marked as me", r.json().get("me") == "sess-1" and seen["sess-1"]["me"]
      and not seen["sess-2"]["me"], r.text)
check("another account sees none of them", client.get("/messages/actors", headers=BEN).json()["count"] == 0)

r = client.post("/messages/direct", json={"to_actor": "sess-2", "content": "from one to two"}, headers=S1)
check("to_actor alone writes to another session of the own account", r.status_code == 200
      and r.json().get("to") == ANA_E and r.json().get("to_actor") == "sess-2", r.text)
check("a third session of the account does not get it",
      client.post("/messages/inbox", json={}, headers=S3).json()["count"] == 0)
check("nor does the sending session", client.post("/messages/inbox", json={}, headers=S1).json()["count"] == 0)
check("a call naming no session does not take it either",
      client.post("/messages/inbox", json={}, headers=ANA).json()["count"] == 0)
r = client.post("/messages/inbox", json={}, headers=S2)
got = r.json().get("messages", [])
check("the addressed session gets it", contents(r) == ["from one to two"], got)
check("its notice names the sending session", got and "session sess-1" in got[0]["notice"], got)

r = client.post("/messages/direct", json={"to_actor": "sess-1", "content": "x"}, headers=S1)
check("a session cannot address itself", r.status_code == 400, r.text)
r = client.post("/messages/direct", json={"to_actor": "bad actor!", "content": "x"}, headers=S1)
check("a malformed to_actor is 400", r.status_code == 400, r.text)

client.post("/messages/direct", json={"to": ANA_E, "content": "to my account"}, headers=S1)
check("a note to the own account never comes back to the sending session",
      client.post("/messages/inbox", json={}, headers=S1).json()["count"] == 0)
check("FAN-OUT: one session of the account gets it", contents(client.post("/messages/inbox", json={}, headers=S3))
      == ["to my account"])
check("FAN-OUT: and every other running session gets it too",
      contents(client.post("/messages/inbox", json={}, headers=S2)) == ["to my account"])
check("FAN-OUT: so does a caller naming no session", "to my account" in contents(
    client.post("/messages/inbox", json={}, headers=ANA)))
check("FAN-OUT: each session gets it once", client.post("/messages/inbox", json={}, headers=S2).json()["count"] == 0)
S4 = as_actor(ANA, "sess-4")
time.sleep(1.1)                                      # created_at has one-second steps
client.post("/messages/inbox", json={}, headers=S4)  # a session that starts after it was read
client.post("/messages/direct", json={"to": ANA_E, "content": "after sess-4 started"}, headers=S1)
check("FAN-OUT: a session that starts later is not handed what others already read, only what is new",
      contents(client.post("/messages/inbox", json={}, headers=S4)) == ["after sess-4 started"])
for h in (S2, S3, ANA):
    client.post("/messages/inbox", json={}, headers=h)

client.post("/messages", json={"project": "alpha", "content": "channel to me", "mentions": [ANA_E]}, headers=S1)
check("an own channel mention skips the sending session",
      client.post("/messages/inbox", json={"project": "alpha"}, headers=S1).json()["count"] == 0)
check("and reaches another session of the account",
      contents(client.post("/messages/inbox", json={"project": "alpha"}, headers=S2)) == ["channel to me"])
client.post("/messages", json={"project": "alpha", "content": "no session", "mentions": [ANA_E]}, headers=ANA)
check("with no session known an own channel post still never notifies its author",
      "no session" not in contents(client.post("/messages/inbox", json={"project": "alpha"}, headers=ANA)))

client.post("/messages/direct", json={"to_actor": "sess-2", "content": "mailbox test"}, headers=S1)
box = client.get("/messages/mailbox", headers=S3).json()["messages"]
mine = [m for m in box if m["content"] == "mailbox test"]
check("every session reads the whole mailbox, with the sessions on each message",
      mine and mine[0]["sender_actor"] == "sess-1" and mine[0]["to_actor"] == "sess-2", box)
check("reading it from another session does not swallow the message",
      contents(client.post("/messages/inbox", json={}, headers=S2)) == ["mailbox test"])
check("to_actor is a filter: no other session is notified", all(
    "mailbox test" not in contents(client.post("/messages/inbox", json={}, headers=h)) for h in (S3, S4, ANA)))
box = {m["content"]: m for m in client.get("/messages/mailbox", headers=S4).json()["messages"]}
check("FILTER, NOT OWNERSHIP: any session reads it in the mailbox, with who had it",
      "mailbox test" in box and box["mailbox test"]["read_by"] == ["sess-2"]
      and box["mailbox test"]["to_actor"] == "sess-2", box.get("mailbox test"))

with sqldb.connect() as c:
    c.execute("UPDATE message_actors SET last_seen=? WHERE actor='sess-3'", [old])
check("a session gone quiet is forgotten by the cron", messages.sweep()["sessions_forgotten"] == 1
      and {a["actor"] for a in client.get("/messages/actors", headers=S1).json()["actors"]} == {"sess-1", "sess-2", "sess-4"})

print()
print(f"{len(FAILURES)} failure(s)" if FAILURES else "all passed")
sys.exit(1 if FAILURES else 0)
