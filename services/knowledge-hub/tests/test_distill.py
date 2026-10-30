"""Tests for distilling worklogs (app/distill.py, roadmap item D), 2026-10-09.

WHAT IS UNDER TEST
  1. CONSENT AND ACCESS. Only projects in KH_DISTILL_PROJECTS are served; every route is maintainer-only.
  2. SIGNAL. /distill/next serves logs with a signal word, a new topic or a 'follows' link to a signal
     log, oldest first, and passes over the rest; the cursor moves only on submit.
  3. DYNAMIC WORDS. A word the distiller submits joins the list and flags the next log that holds it;
     words too short are refused; hits are counted.
  4. SUBMIT GATE. Kind, action, context and sources are checked; the leak gate refuses e-mails and the
     names of person cards; contexts can be added in the same call.
  5. DUPLICATES. Same key and same meaning merges (evidence grows); same key, other meaning makes both
     contested.
  6. REVIEW. Approve makes an item active and supersedes its contested sibling; a policy proposal
     becomes a policy rule of the project; share copies a general item to the shared project and
     refuses one naming a project; reject withdraws.
  7. VISIBILITY. /vector/query never returns proposed, superseded or withdrawn items.
  13. THE WORKER (roadmap E, slice S5). A dry-run submit returns the verdicts and writes nothing (no item,
     context or word, cursor still, batch released); the kh_people worker token is refused while
     KH_DISTILL_WORKER=off, forced to a dry run under dry, needs distilled_by worker:<model>, stores for real
     under on; cost_usd lands on the batch row; /distill/next answers 429 budget at the month cap.

Run from the repo root with the project venv:
    .venv\\Scripts\\python tests\\test_distill.py

Throwaway chroma dir + hooks.db, a locally generated RSA key and a word-hash embedder.
"""
import hashlib
import os
import re
import sys
import tempfile
import time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

TMP = tempfile.mkdtemp(prefix="kh_distill_")
os.environ["KH_HOOKS_DB"] = os.path.join(TMP, "hooks.db")
os.environ["CHROMA_PATH"] = os.path.join(TMP, "chroma")
os.environ["KH_PROJECTS_PATH"] = os.path.join(TMP, "projects")
os.environ["KH_KUZU_PROJECTS_PATH"] = os.path.join(TMP, "kuzu")
os.environ["KH_DISTILL_PROJECTS"] = "alpha,beta"
os.environ["KH_DISTILL_OWN_PROJECTS"] = "alpha"     # beta stands for someone else's project
os.environ["KH_DISTILL_SAMPLE_PCT"] = "0"          # no random sample: the test is deterministic
os.environ["KH_TURN_DISTILLED_K"] = "3"           # the turn context's near block is off by default
os.environ["KH_TURN_DISTILLED_FLOOR"] = "0.68"
ISSUER = "https://keycloak.test/realms/knowledge-hub"
os.environ["KH_AUTH_ISSUER"] = ISSUER
os.environ["KH_AUTH_AUDIENCE"] = "kh-api"
os.environ["KH_CAP_PEOPLE"] = "on"                # the worker principal (slice S5); default off in prod
os.environ.pop("KH_DISTILL_WORKER", None)

import jwt  # noqa: E402
import numpy  # noqa: E402
from cryptography.hazmat.primitives.asymmetric import rsa  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from app import auth, config, projects  # noqa: E402
from app.policy_actions import store as policy_store  # noqa: E402

assert TMP in config.CHROMA_PATH, "test must run against a throwaway chroma dir"

import main  # noqa: E402

FAILURES = []


def check(name, condition, detail=None):
    print(("ok   " if condition else "FAIL ") + name + ("" if condition or detail is None else f"  -> {detail}"))
    if not condition:
        FAILURES.append(name)


class _Model:
    """Bag of words hashed into 384 dims: equal texts score 1.0, unrelated ones score low."""
    @staticmethod
    def encode(text, normalize_embeddings=True):
        v = numpy.zeros(384, dtype="float32")
        for w in re.findall(r"\w+", (text or "").lower()):
            v[int(hashlib.md5(w.encode()).hexdigest(), 16) % 384] += 1.0
        n = numpy.linalg.norm(v)
        return v / n if n else v


KEY = rsa.generate_private_key(public_exponent=65537, key_size=2048)
auth._keys.get = lambda kid: KEY.public_key() if kid == "k1" else None
FULL = ["project.read", "project.write", "project.log"]


def token(email, grants, role="member", every=()):
    now = int(time.time())
    kh = {"role": role, "permissions": [], "all_projects": list(every), "projects": grants}
    claims = {"iss": ISSUER, "aud": "kh-api", "iat": now, "exp": now + 600, "email": email, "kh": kh}
    return {"Authorization": "Bearer " + jwt.encode(claims, KEY, algorithm="RS256", headers={"kid": "k1"})}


for pid in ("alpha", "beta", "gamma", "lesson-learned"):
    projects.get_or_create_project(pid)
policy_store.set_action("git operation", "Any git operation: pull, commit, push.", project=None)
ADMIN = token("admin@example.invalid", {}, role="maintainer", every=FULL)
ANA = token("ana@example.invalid", {"alpha": FULL})
main.app.state.model = _Model()
client = TestClient(main.app)

LOG_TS = [0]


def log(text, topic, project="alpha"):
    """One worklog row with a strictly increasing ts, as the Stop hook writes them."""
    LOG_TS[0] += 1
    ts = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(1_760_000_000 + LOG_TS[0] * 60))
    r = client.post("/vector/add", headers=ADMIN, json={"text": text, "scope": "log", "metadata": {
        "scope": "log", "project": project, "topic": topic, "subject": topic, "ts": ts}})
    assert r.status_code == 200, r.text
    return r.json()["vector_id"]


# A person card: its name must never pass the leak gate.
client.post("/entities", headers=ADMIN, json={"project": "alpha", "name": "Elio", "type": "person", "role": "developer"})

# ── 1. consent and access ───────────────────────────────────────────────────
r = client.get("/distill/next", params={"project": "gamma"}, headers=ADMIN)
check("a project without consent is refused", r.status_code == 403, r.status_code)
r = client.get("/distill/next", params={"project": "alpha"}, headers=ANA)
check("a member cannot take a batch", r.status_code == 403, r.status_code)
r = client.get("/distill/signals", headers=ADMIN).json()
check("the seed list is loaded", r["count"] >= 30 and any(w["word"] == "root cause" for w in r["words"]), r["count"])

# ── 2. signal ───────────────────────────────────────────────────────────────
L1 = log("2026-10-01 fen decided to push through the company GitLab only.", "git-flow")
L2 = log("2026-10-01 ran the unit suite again, nothing to report.", "git-flow")
L3 = log(f"2026-10-01 follows {L1}. Pushed the branch; reviewer will look tomorrow-ish.", "git-flow")
L4 = log("2026-10-02 the vpn tunnel dropped during the push.", "git-flow")
L5 = log("2026-10-02 opened the ticket board for the week.", "board")
batch = client.get("/distill/next", params={"project": "alpha"}, headers=ADMIN).json()
got = [x["id"] for x in batch["logs"]]
why = {x["id"]: x["why"] for x in batch["logs"]}
check("signal logs come oldest first", got == [L1, L3, L5], got)
check("a seed word fires", "word:decided" in why.get(L1, []), why.get(L1))
check("a new topic fires", "new-topic" in why.get(L5, []), why.get(L5))
check("a log following a signal log fires", "follows-signal" in why.get(L3, []), why.get(L3))
check("rows without signal are passed over", batch["passed_without_signal"] == 2, batch["passed_without_signal"])
check("the batch brings the catalog", "git operation" in batch["catalog"]["actions"]
      and "lesson" in batch["catalog"]["kinds"], batch["catalog"])
check("the batch brings the people", [p["name"] for p in batch["people"]] == ["Elio"], batch["people"])
again = client.get("/distill/next", params={"project": "alpha"}, headers=ADMIN).json()
check("the cursor does not move before submit", [x["id"] for x in again["logs"]] == got)

# ── 3 and 4. submit gate, contexts, dynamic words ───────────────────────────
GOOD = {"kind": "lesson", "action": "git operation", "context": "company-gitlab",
        "title": "Company GitLab from outside needs the VPN",
        "text": "Pushing to the company GitLab from outside the office needs the VPN up first; GitHub does not.",
        "sources": [L1]}
items = [
    GOOD,
    {**GOOD, "title": "Mail Dev", "text": "Ask dev at someone@example.com before pushing."},
    {**GOOD, "title": "Elio pushes", "text": "Elio pushes on Fridays; the PO reviews."},
    {**GOOD, "context": "nowhere", "title": "x", "text": "y"},
    {**GOOD, "sources": ["vec_nope000000"], "title": "Wrong source", "text": "Something unrelated about boards."},
    {"kind": "policy_proposal", "action": "git operation", "context": "-", "title": "Check VPN before push",
     "text": "Before pushing to the company GitLab from outside, confirm the VPN is connected.",
     "sources": [L3], "target_action": "git operation", "target_sub_action": "vpn first"},
    {"kind": "spaceship", "title": "t", "text": "t", "sources": [L1]},
]
r = client.post("/distill/submit", headers=ADMIN, json={
    "project": "alpha", "batch_id": batch["batch_id"], "items": items, "distilled_by": "claude-test",
    "contexts": [{"tag": "company-gitlab", "description": "the company GitLab, reached through the VPN"}],
    "signal_words": [{"word": "vpn", "kind": "failure", "reason": "tunnel drops break pushes"}, "ab"]})
res = r.json()
check("submit answers", r.status_code == 200, r.text[:300])
out = [x["result"] for x in res["results"]]
check("a good item is accepted", out[0] == "accepted", res["results"][0])
check("an e-mail is stopped by the leak gate", out[1] == "rejected" and "leak" in res["results"][1]["reason"],
      res["results"][1])
check("a person card's name is stopped by the leak gate", out[2] == "rejected" and "elio" in res["results"][2]["reason"],
      res["results"][2])
check("an unknown context is refused", out[3] == "rejected" and "context" in res["results"][3]["reason"],
      res["results"][3])
check("a source that is not a log of the project is refused", out[4] == "rejected" and "sources" in res["results"][4]["reason"],
      res["results"][4])
check("a policy proposal is accepted", out[5] == "accepted", res["results"][5])
check("an unknown kind is refused", out[6] == "rejected", res["results"][6])
check("the context was added in the same call", [c["result"] for c in res["contexts"]] == ["added"], res["contexts"])
words = {w["word"]: w["result"] for w in res["signal_words"]}
check("the distiller adds a word; a short one is refused", words == {"vpn": "added", "ab": "refused"}, words)
done = client.get("/distill/next", params={"project": "alpha"}, headers=ADMIN).json()
check("after submit the project is done", done["done"] and done["logs"] == [], done)
sig = {w["word"]: w for w in client.get("/distill/signals", headers=ADMIN).json()["words"]}
check("hits are counted for the words that fired", sig["decided"]["hits"] == 1, sig["decided"])
check("a batch with refused items stays open", res.get("batch_open") is True, res.get("batch_open"))
cur_before = client.get("/distill/cursor", params={"project": "alpha"}, headers=ADMIN).json()["last_ts"]
fixed = {**GOOD, "title": "Dev mail goes through the ticket", "text": "Ask Dev through the ticket before pushing.",
         "sources": [L1]}
r = client.post("/distill/submit", headers=ADMIN, json={"project": "alpha", "batch_id": batch["batch_id"],
                                                       "items": [fixed]}).json()
check("a refused item can be resent with the same batch", r["results"][0]["result"] == "accepted"
      and r["batch_open"] is False, r)
fixed_id = r["results"][0]["id"]
check("a resend does not move the cursor", r["cursor"] == cur_before, (r["cursor"], cur_before))
r = client.post("/distill/submit", headers=ADMIN, json={"project": "alpha", "batch_id": batch["batch_id"], "items": []})
check("a closed batch cannot be submitted again", r.status_code == 409, r.status_code)
client.post("/distill/reject", headers=ADMIN, json={"project": "alpha", "ids": [fixed_id], "reason": "test only"})

L6 = log("2026-10-03 the vpn tunnel again cut a push half way.", "git-flow")
b2 = client.get("/distill/next", params={"project": "alpha"}, headers=ADMIN).json()
check("a word added by the distiller flags the next log", [x["id"] for x in b2["logs"]] == [L6]
      and "word:vpn" in b2["logs"][0]["why"], b2["logs"])
check("live items come back as neighbours", any("Company GitLab" in n for n in b2["neighbours"]), b2["neighbours"])

# ── 5. duplicates and contradictions ────────────────────────────────────────
gid0 = res["results"][0]["id"]
other = {**GOOD, "title": "Company GitLab push uses SSH over 443",
         "text": "From outside, push to the company GitLab over ssh port 443 with the key named; no VPN.",
         "sources": [L6], "contradicts": gid0}
sibling = {**GOOD, "title": "Company GitLab mirrors are read-only",
           "text": "The company GitLab mirror of a repo is read-only; push to the primary remote.", "sources": [L6]}
fuller = {**GOOD, "text": GOOD["text"] + " Start the VPN before git fetch too.", "sources": [L1, L6], "updates": gid0}
r = client.post("/distill/submit", headers=ADMIN, json={
    "project": "alpha", "batch_id": b2["batch_id"],
    "items": [{**GOOD, "sources": [L6]}, other, sibling, {**GOOD, "updates": "dk_nope"}, fuller]}).json()
first, second, third, fourth, fifth = r["results"]
check("updates merges into the named item and may cite earlier logs", fifth["result"] == "updated" and fifth["id"] == gid0, fifth)
check("same key, same meaning merges", first["result"] == "merged" and first["id"] == gid0, first)
check("an item that says it contradicts one is contested with it", second["result"] == "contested"
      and second["with"] == [gid0], second)
check("an unrelated item under the same key stays apart, not contested", third["result"] == "accepted", third)
check("updates must name a live item", fourth["result"] == "rejected", fourth)
pend = client.get("/distill/pending", params={"project": "alpha"}, headers=ADMIN).json()
check("pending lists proposed and contested items", pend["count"] == 4, pend["lines"])
check("pending marks contested rows", sum("[contested]" in x for x in pend["lines"]) == 2, pend["lines"])
check("pending shows sources to the maintainer", any(L6 in x for x in pend["lines"]), pend["lines"])
r = client.post("/vector/scroll", headers=ADMIN, json={"scope": "knowledge", "project": "alpha",
                                                     "ids": [first["id"]], "limit": 5}).json()
check("merging grows the evidence", r["hits"][0]["metadata"]["evidence_count"] == 2, r["hits"][0]["metadata"])

# ── 6. review ───────────────────────────────────────────────────────────────
r = client.get("/distill/pending", params={"project": "alpha"}, headers=ANA)
check("a member cannot review", r.status_code == 403, r.status_code)
r = client.post("/distill/approve", headers=ADMIN, json={"project": "alpha", "ids": [second["id"]]}).json()
check("approve makes an item active", r["results"][0]["result"] == "active", r)
meta = client.post("/vector/scroll", headers=ADMIN, json={"scope": "knowledge", "project": "alpha",
                                                         "ids": [first["id"]], "limit": 5}).json()["hits"][0]["metadata"]
check("its contested sibling is superseded and hidden", meta["status"] == "superseded"
      and meta["superseded_by"] == second["id"] and meta["knowledge_type"] == "superseded", meta)
prop = res["results"][5]["id"]
r = client.post("/distill/approve", headers=ADMIN, json={"project": "alpha", "ids": [prop]}).json()
check("a policy proposal is applied", r["results"][0]["result"] == "applied as policy rule", r)
rule = policy_store.get_rule("git operation", "vpn first", project="alpha")
check("the rule lives in the project's policy", rule is not None and "VPN" in rule["content"], rule)

L7 = log("2026-10-04 decided: tag releases with the date.", "release")
b3 = client.get("/distill/next", params={"project": "alpha"}, headers=ADMIN).json()
gen = {"kind": "fact", "action": "-", "context": "-", "title": "Release tags carry the date",
       "text": "Release tags are named with the release date so they sort in order.", "sources": [L7]}
named = {**gen, "action": "git operation", "title": "Alpha release tags", "text": "In alpha, release tags carry the date."}
r = client.post("/distill/submit", headers=ADMIN, json={
    "project": "alpha", "batch_id": b3["batch_id"], "items": [gen, named]}).json()
gid, nid = r["results"][0]["id"], r["results"][1]["id"]
r = client.post("/distill/approve", headers=ADMIN, json={"project": "alpha", "ids": [gid], "share": [gid]}).json()
shared = r["results"][0].get("shared", "")
check("a general item is shared", shared.startswith("dk_"), r)
s = client.post("/vector/scroll", headers=ADMIN, json={"scope": "knowledge", "project": "lesson-learned",
                                                      "ids": [shared], "limit": 5}).json()["hits"]
check("the shared copy keeps its origin and has no entities", s and s[0]["metadata"]["origin_project"] == "alpha"
      and s[0]["metadata"]["status"] == "active", s[0]["metadata"] if s else s)
r = client.post("/distill/approve", headers=ADMIN, json={"project": "alpha", "ids": [nid], "share": [nid]}).json()
check("an item naming a project is not shared", r["results"][0]["shared"].startswith("refused"), r)
# Two unrelated general items under one key (same kind, action, context) each get their own shared row
# (2026-10-24: every share under one key used to overwrite the last).
L7b = log("2026-10-04 found: pnpm installs break when node_modules is copied; and tags need annotated form.", "tools", project="beta")
b3b = client.get("/distill/next", params={"project": "beta"}, headers=ADMIN).json()
g1 = {"kind": "lesson", "action": "-", "context": "-", "title": "Copied pnpm node_modules break",
      "text": "pnpm links do not survive a plain copy of node_modules; delete it and run pnpm install.", "sources": [L7b]}
g2 = {**g1, "title": "Annotated tags for releases",
      "text": "Lightweight git tags carry no author or date; create release tags with git tag -a."}
r = client.post("/distill/submit", headers=ADMIN, json={"project": "beta", "batch_id": b3b["batch_id"],
                                                       "items": [g1, g2]}).json()
i1, i2 = r["results"][0]["id"], r["results"][1]["id"]
r = client.post("/distill/approve", headers=ADMIN, json={"project": "beta", "ids": [i1, i2], "share": [i1, i2]}).json()
s1, s2 = r["results"][0].get("shared", ""), r["results"][1].get("shared", "")
check("two lessons under one key are shared as two rows", s1.startswith("dk_") and s2.startswith("dk_") and s1 != s2, r)
rows = client.post("/vector/scroll", headers=ADMIN, json={"scope": "knowledge", "project": "lesson-learned",
                                                         "ids": [s1, s2], "limit": 5}).json()["hits"]
check("both shared texts are kept", sorted(h["metadata"]["title"] for h in rows)
      == sorted([g1["title"], g2["title"]]), [h["metadata"].get("title") for h in rows])
client.post("/distill/reopen", headers=ADMIN, json={"project": "beta", "ids": [i1]})
r = client.post("/distill/approve", headers=ADMIN, json={"project": "beta", "ids": [i1], "share": [i1]}).json()
check("sharing the same item again updates its row, no duplicate", r["results"][0].get("shared") == s1, r)
r = client.post("/distill/reject", headers=ADMIN, json={"project": "alpha", "ids": [nid], "reason": "too local"}).json()
check("reject answers withdrawn", r["results"][0]["result"] == "withdrawn", r)
r = client.post("/distill/reopen", headers=ADMIN, json={"project": "alpha", "ids": [nid]}).json()
m = client.post("/vector/scroll", headers=ADMIN, json={"scope": "knowledge", "project": "alpha",
                                                      "ids": [nid], "limit": 5}).json()["hits"][0]["metadata"]
check("reopen puts an item back to proposed", r["results"][0]["result"] == "proposed" and m["status"] == "proposed"
      and m["knowledge_type"] == "proposed", m.get("status"))
client.post("/distill/reject", headers=ADMIN, json={"project": "alpha", "ids": [nid], "reason": "too local"})

# ── 8. the gate by scope (fen 2026-10-09, the Pacific/Gina case) ──────────────
PLAY = {"kind": "procedure", "action": "-", "context": "-", "title": "QC root cause requests",
        "text": "When QC asks for a root cause: the task is on board PAR at dev.azure.com/pacific, "
                "replies go to the Pacific QC channel, fixes ship through the QAS pipeline.",
        "entities": ["ent__alpha__elio"]}
L8 = log("2026-10-05 QC asked for a root cause on PAR-528; fixed and shipped to QAS.", "qc-requests")
b4 = client.get("/distill/next", params={"project": "alpha"}, headers=ADMIN).json()
r = client.post("/distill/submit", headers=ADMIN, json={"project": "alpha", "batch_id": b4["batch_id"],
                                                       "items": [{**PLAY, "sources": [L8]}]}).json()
play_id = r["results"][0].get("id")
check("an own project's private item keeps its board host", r["results"][0]["result"] == "accepted", r["results"])
meta = client.post("/vector/scroll", headers=ADMIN, json={"scope": "knowledge", "project": "alpha",
                                                         "ids": [play_id], "limit": 5}).json()["hits"][0]["metadata"]
check("the person goes in the entities key", meta["entity_key"] == "ent__alpha__elio", meta.get("entity_key"))
LB = log("2026-10-05 decided the deploy goes through the shared runner.", "deploy", project="beta")
b5 = client.get("/distill/next", params={"project": "beta"}, headers=ADMIN).json()
r = client.post("/distill/submit", headers=ADMIN, json={"project": "beta", "batch_id": b5["batch_id"], "items": [
    {"kind": "fact", "title": "Runner host", "text": "Deploys run on runner.example.com.", "sources": [LB]}]}).json()
check("someone else's project gets the strict gate", r["results"][0]["result"] == "rejected"
      and "example.com" in r["results"][0]["reason"], r["results"])
r = client.post("/distill/approve", headers=ADMIN, json={"project": "alpha", "ids": [play_id], "share": [play_id]}).json()
check("a host never reaches the shared project", r["results"][0]["result"] == "active"
      and r["results"][0]["shared"].startswith("refused"), r)

# ── 9. repeats are counted in code, not read by the model ─────────────────────
repeat = f"{PLAY['title']}. {PLAY['text']}"
L9 = log(repeat + " root cause", "qc-requests")
L10 = log("2026-10-06 QC asked for a root cause; this time the fix needed a rollback.", "qc-requests")
b6 = client.get("/distill/next", params={"project": "alpha"}, headers=ADMIN).json()
check("a repeat of a live item is held back from the model", [x["id"] for x in b6["logs"]] == [L10]
      and b6["confirmed_in_code"] == {play_id: 1}, (b6["logs"], b6["confirmed_in_code"]))
unrelated = {**PLAY, "title": "Rollbacks need the release owner",
             "text": "A rollback on QAS waits for the release owner to confirm the window first.", "sources": [L10]}
r = client.post("/distill/submit", headers=ADMIN, json={"project": "alpha", "batch_id": b6["batch_id"],
                                                       "items": [unrelated]}).json()
check("an unrelated item under the same key stays a separate item", r["results"][0]["result"] == "accepted"
      and r["results"][0]["id"] == play_id + "_2", r["results"])
meta = client.post("/vector/scroll", headers=ADMIN, json={"scope": "knowledge", "project": "alpha",
                                                         "ids": [play_id], "limit": 5}).json()["hits"][0]["metadata"]
check("submit adds the repeat as evidence", r["confirmed_in_code"] == 1 and meta["evidence_count"] == 2
      and L9 in meta["sources_json"], (r.get("confirmed_in_code"), meta["evidence_count"]))

# ── 7. visibility ───────────────────────────────────────────────────────────
q = client.post("/vector/query", headers=ANA, json={"text": "company GitLab push VPN SSH release tags",
                                                   "scope": "knowledge", "project": "alpha", "k": 20}).json()
ids = {h["vector_id"] for h in q["hits"]}
check("active items are served", second["id"] in ids and gid in ids, ids)
check("superseded, applied and withdrawn items are not", not ({first["id"], prop, nid} & ids), ids)

# ── 10. the secret pattern refuses values, not the word ─────────────────────
from app import distill  # noqa: E402
check("a real-looking secret is refused", distill._leak("set token: ab12cd34ef in the env", set(), False) is not None)
check("'Token: no-check' and 'password: never' are not secrets",
      distill._leak("header X-Atlassian-Token: no-check; a password: never typed", set(), False) is None)

# ── 11. served by key (slice 2): /context/step and /turn/context ────────────
def step(headers, **body):
    r = client.post("/context/step", headers=headers, json={"text": "push the branch to the remote",
                                                           "project": "alpha", **body})
    assert r.status_code == 200, r.text
    return r.json()


def distilled(pack):
    return [i for i in pack["items"] if i["tier"] == "distilled"]


p = step(ANA, action="git operation", context="company-gitlab")
d = distilled(p)
check("a step with action + context packs the live item by key", [i["id"] for i in d] == [second["id"]]
      and d[0]["key"] == distill.SOFT_KEY and d[0]["score"] is None, d)
check("key items come before knowledge by meaning", p["items"][0]["tier"] == "distilled", p["tiers"])
check("a proposed item under the key is not served", third["id"] not in {i["id"] for i in p["items"]})
check("a member sees no sources", "sources:" not in d[0]["text"] and L6 not in d[0]["text"], d[0]["text"])
check("the pack echoes the keys and which lane answered", p["keys"]["answered_by"] == {"alpha": distill.SOFT_KEY},
      p.get("keys"))
check("the pack lists the context catalog", "company-gitlab" in p.get("contexts", []), p.get("contexts"))
pa = step(ADMIN, action="git operation", context="company-gitlab")
check("a maintainer sees the sources", L6 in distilled(pa)[0]["text"], distilled(pa))
p = step(ANA, action="git operation", context="Nowhere Tag")
check("an empty action + context falls back to the action alone",
      [i["id"] for i in distilled(p)] == [second["id"]] and p["keys"]["answered_by"] == {"alpha": "action"}, p.get("keys"))
p = step(ANA)
check("a step without keys packs nothing by key", not distilled(p) and "keys" not in p, p["tiers"])
p = step(ANA, context="Company GitLab")
check("a context alone reads by context, folded like submit stores it",
      [i["id"] for i in distilled(p)] == [second["id"]] and p["keys"]["answered_by"] == {"alpha": "context"},
      [i["id"] for i in distilled(p)])
p = step(ANA, action="-", entities=["ent__alpha__elio"])
check("items naming the step's entities come first", [i["id"] for i in distilled(p)][:1] == [play_id]
      and gid in {i["id"] for i in distilled(p)}, [i["id"] for i in distilled(p)])
p = step(ANA, action="nothing here")
check("an action with no items packs nothing by key", not distilled(p) and p["keys"]["answered_by"] == {}, p.get("keys"))
t = client.get("/turn/context", headers=ANA, params={"text": "alpha push", "action": "git operation",
                                                     "context": "company-gitlab"}).json()
check("turn context adds the items for a given action", any(second["id"] in x for x in t["distilled"])
      and "DISTILLED ITEMS" in t["text"], t.get("distilled"))
t = client.get("/turn/context", headers=ANA, params={"text": "alpha: push to the company GitLab over ssh port 443"}).json()
check("turn context packs the project's distilled items near the prompt, no action needed",
      any(x.startswith(second["id"] + " ") for x in t["near"]) and "PROJECT KNOWLEDGE near this message" in t["text"]
      and not any(x.startswith(third["id"] + " ") for x in t["near"]), t.get("near"))
t = client.get("/turn/context", headers=ANA, params={"text": "alpha push"}).json()
check("turn context without an action is unchanged", t["distilled"] == [] and "DISTILLED" not in t["text"],
      t.get("distilled"))

# ── 12. rekey of older knowledge, and patterns (slice 3) ────────────────────
def lesson(text):
    r = client.post("/vector/add", headers=ADMIN, json={"text": text, "scope": "knowledge", "metadata": {
        "scope": "knowledge", "project": "lesson-learned", "kind": "lesson", "topic": "lessons-learned"}})
    assert r.status_code == 200, r.text
    return r.json()["vector_id"]


LONG = ("LESSON LEARNED: Pushing over a dropped tunnel. Symptom: the push stops half way. " +
        "Cause: the tunnel times out while the pack uploads; reconnect and retry the push. " * 8)
K1 = lesson(LONG)
K2 = lesson("LESSON LEARNED: Fonts in exported reports. Symptom: boxes instead of letters.")
K3 = lesson("LESSON LEARNED: Keys need a known action.")
r = client.get("/distill/rekey", params={"project": "lesson-learned"}, headers=ANA)
check("a member cannot rekey", r.status_code == 403, r.status_code)
rk = client.get("/distill/rekey", params={"project": "lesson-learned", "limit": 50}, headers=ADMIN).json()
ids = [x["id"] for x in rk["rows"]]
check("rekey offers rows without keys and leaves distilled items out",
      {K1, K2, K3} <= set(ids) and shared not in ids, ids)
check("rekey brings the catalog", "git operation" in rk["catalog"]["actions"], rk["catalog"])
r = client.post("/distill/rekey", headers=ADMIN, json={
    "project": "lesson-learned", "contexts": [{"tag": "vpn", "description": "a VPN or tunnel"}],
    "keys": [{"id": K1, "action": "git operation", "context": "VPN"}, {"id": K2, "skip": True},
             {"id": K3, "action": "no such action"}, {"id": shared, "action": "git operation"},
             {"id": "vec_nope00000000"}]}).json()
res = [x["result"] for x in r["results"]]
check("rekey keys, skips and refuses", res == ["keyed", "skipped", "rejected", "rejected", "rejected"], r["results"])
check("a distilled item is not rekeyed", "submit" in r["results"][3]["reason"], r["results"][3])
m = client.post("/vector/scroll", headers=ADMIN, json={"scope": "knowledge", "project": "lesson-learned",
                                                      "ids": [K1], "limit": 5}).json()["hits"][0]
check("rekey keeps text, kind and topic", m["source_text"] == LONG and m["metadata"]["kind"] == "lesson"
      and m["metadata"]["topic"] == "lessons-learned" and m["metadata"]["status"] == "active"
      and m["metadata"]["context"] == "vpn", m["metadata"])
ids = [x["id"] for x in client.get("/distill/rekey", params={"project": "lesson-learned", "limit": 50},
                                   headers=ADMIN).json()["rows"]]
check("keyed and skipped rows are not offered again", K1 not in ids and K2 not in ids and K3 in ids, ids)
p = step(ADMIN, action="git operation", context="vpn")
d = {i["id"]: i for i in distilled(p)}
check("a rekeyed lesson is served by key from the shared project", K1 in d and K2 not in d
      and p["keys"]["answered_by"].get("lesson-learned") == distill.SOFT_KEY, (list(d), p["keys"]))
client.post("/distill/rekey", headers=ADMIN, json={"project": "lesson-learned",
                                                    "keys": [{"id": K3, "action": "git operation", "context": "vpn"}]})
p = step(ADMIN, action="git operation", context="vpn")
p2 = client.post("/context/step", headers=ADMIN, json={"text": "keys need a known action", "project": "alpha",
                                                       "action": "git operation", "context": "vpn"}).json()
order = lambda pk: [i["id"] for i in distilled(pk) if i["id"] in (K1, K3)]  # noqa: E731
check("inside one key the row closest to the step comes first", order(p)[:1] == [K1] and order(p2)[:1] == [K3],
      (order(p), order(p2)))
# Soft context (2026-10-24): a context only lifts its items, so a lane's action items are kept (a guessed context
# is often wrong); with KH_STEP_CONTEXT_BONUS=off the exact key and exact_first behave as before.
check("a soft context keeps the other lane's action items", p["keys"]["answered_by"]
      == {"alpha": "action", "lesson-learned": distill.SOFT_KEY} and second["id"] in {i["id"] for i in distilled(p)},
      p["keys"])
_bonus, config.STEP_CONTEXT_BONUS = config.STEP_CONTEXT_BONUS, None
po = step(ADMIN, action="git operation", context="vpn")
check("context bonus off: an exact key in one lane drops the action-only fallback of another",
      po["keys"]["answered_by"] == {"lesson-learned": "action+context"}
      and second["id"] not in {i["id"] for i in distilled(po)}, po["keys"])
config.STEP_CONTEXT_BONUS = _bonus
check("the catalog lists the shared project's context tags too", "vpn" in p.get("contexts", []), p.get("contexts"))
d = {i["id"]: i for i in distilled(p)}
check("a long rekeyed row is cut in the pack", K1 in d and d[K1]["text"].endswith("(cut; read the row by id)")
      and len(d[K1]["text"]) < len(LONG), d.get(K1, {}).get("text", "")[-60:])

r = client.get("/distill/patterns", params={"project": "alpha", "days": 730}, headers=ANA)
check("a member cannot read patterns", r.status_code == 403, r.status_code)
r = client.get("/distill/patterns", params={"project": "gamma", "days": 730}, headers=ADMIN)
check("patterns need consent", r.status_code == 403, r.status_code)
pt = client.get("/distill/patterns", params={"project": "alpha", "days": 730}, headers=ADMIN).json()["projects"][0]
check("patterns count the project's logs and failure words in code",
      pt["logs"] == 10 and pt["with_failure"] >= 3
      and pt["top_failing_topics"][0]["topic"] == "qc-requests", pt)

# ── 13. the distil worker (roadmap E, slice S5) ─────────────────────────────
from app import distill  # noqa: E402
from app.caps import people, principals  # noqa: E402


def pending(project):
    return client.get("/distill/pending", params={"project": project}, headers=ADMIN).json()["count"]


def batch_row(batch_id):
    from app import sqldb
    with sqldb.connect() as c:
        r = c.execute("SELECT claimed, closed, cost_usd FROM distill_batch WHERE batch_id=?", [batch_id]).fetchone()
    return None if r is None else {"claimed": r["claimed"], "closed": r["closed"], "cost_usd": r["cost_usd"]}


W1 = log("2026-10-07 decided the worker drafts release notes from merged pull requests.", "release-notes", "beta")
ITEM = {"kind": "habit", "context": "release", "title": "Release notes from merged PRs",
        "text": "Release notes are drafted from the merged pull requests of the sprint.", "sources": [W1]}
before = (pending("beta"), distill.cursor("beta")["last_ts"], {w["word"] for w in distill.signal_words()})
b = client.get("/distill/next", params={"project": "beta"}, headers=ADMIN).json()
check("S5 setup: the new log is served", [x["id"] for x in b["logs"]] == [W1], b)
r = client.post("/distill/submit", headers=ADMIN, json={
    "project": "beta", "batch_id": b["batch_id"], "dry_run": True, "items": [ITEM, {**ITEM, "kind": "nope"}],
    "contexts": [{"tag": "release", "description": "shipping a version"}],
    "signal_words": [{"word": "release notes", "kind": "decision"}]}).json()
check("DRY: verdicts come back (accepted, rejected)", r.get("dry_run") is True
      and [x["result"] for x in r["results"]] == ["accepted", "rejected"], r)
check("DRY: nothing is written (no item, context or word; cursor still)",
      (pending("beta"), distill.cursor("beta")["last_ts"], {w["word"] for w in distill.signal_words()}) == before
      and "release" not in {c["tag"] for c in distill.contexts("beta")}, r)
check("DRY: the batch is released", batch_row(b["batch_id"]) is None and r["batch_open"] is False, r)
again = client.get("/distill/next", params={"project": "beta"}, headers=ADMIN).json()
check("DRY: the next batch serves the same logs", [x["id"] for x in again["logs"]] == [W1], again)
r = client.post("/distill/submit", headers=ADMIN, json={"project": "beta", "batch_id": again["batch_id"],
                                                       "items": [], "cost_usd": -1})
check("cost_usd must be a non-negative number", r.status_code == 400, r.status_code)

WT = {"Authorization": "Bearer " + principals.issue(people.NS, "worker", "distiller", people.owner_email())["access_token"]}
check("WORKER off (default): /distill/next refused",
      client.get("/distill/next", params={"project": "beta"}, headers=WT).status_code == 403)
os.environ["KH_DISTILL_WORKER"] = "dry"
r = client.get("/distill/next", params={"project": "beta"}, headers=WT)
check("WORKER dry: /distill/next passes", r.status_code == 200 and [x["id"] for x in r.json()["logs"]] == [W1],
      r.text[:300])
wb = r.json()["batch_id"]
r = client.post("/distill/submit", headers=WT, json={"project": "beta", "batch_id": wb, "items": [ITEM]})
check("WORKER: distilled_by worker:<model> is required", r.status_code == 400, r.status_code)
r = client.post("/distill/submit", headers=WT, json={
    "project": "beta", "batch_id": wb, "items": [ITEM], "contexts": [{"tag": "release"}],
    "distilled_by": "worker:claude-opus-5-5", "cost_usd": 0.15, "dry_run": False}).json()
check("WORKER dry: a submit is forced to a dry run", r.get("dry_run") is True and r.get("forced_dry")
      and r["results"][0]["result"] == "accepted" and pending("beta") == before[0]
      and distill.cursor("beta")["last_ts"] == before[1], r)
check("WORKER dry: the cost stays on the released (closed) batch row",
      batch_row(wb) == {"claimed": 0, "closed": 1, "cost_usd": 0.15} and r["cost_usd"] == 0.15, batch_row(wb))
check("WORKER: /distill/approve stays maintainer-only",
      client.post("/distill/approve", headers=WT, json={"project": "beta", "ids": []}).status_code == 403)

os.environ["KH_DISTILL_WORKER"] = "on"
wb = client.get("/distill/next", params={"project": "beta"}, headers=WT).json()["batch_id"]
r = client.post("/distill/submit", headers=WT, json={
    "project": "beta", "batch_id": wb, "items": [ITEM], "contexts": [{"tag": "release"}],
    "distilled_by": "worker:claude-opus-5-5", "cost_usd": 0.2}).json()
check("WORKER on: the submit stores the item as proposed", r.get("dry_run") is False and "forced_dry" not in r
      and r["results"][0]["result"] == "accepted" and pending("beta") == before[0] + 1, r)
meta = client.post("/vector/scroll", headers=ADMIN, json={"scope": "knowledge", "project": "beta",
                                                         "ids": [r["results"][0]["id"]], "limit": 5}).json()["hits"]
check("WORKER on: distilled_by is the worker's model", meta and meta[0]["metadata"]["distilled_by"]
      == "worker:claude-opus-5-5", meta)
check("WORKER on: the cursor moved and the batch keeps its cost",
      distill.cursor("beta")["last_ts"] > before[1] and batch_row(wb) == {"claimed": 1, "closed": 1, "cost_usd": 0.2},
      batch_row(wb))

spent0 = distill.month_spend_usd()
people.record_metrics([{"series": "worker.cost_usd", "value": 100.0, "unit_id": "run-bf",
                        "dims": {"job": "distil", "kind": "backfill", "model": "claude-opus-5-5"}}])
check("BUDGET: a backfill's cost (dims.kind backfill, its own cap) is kept out of the month spend (design E4)",
      distill.month_spend_usd() == spent0 and distill.budget_refusal() is None, (spent0, distill.month_spend_usd()))
people.record_metrics([{"series": "worker.cost_usd", "value": 59.9, "unit_id": "run-s5",
                        "dims": {"job": "distil", "model": "claude-opus-5-5"}}])
check("BUDGET: under the cap the worker still gets work", distill.budget_refusal() is None
      and client.get("/distill/next", params={"project": "beta"}, headers=WT).status_code == 200)
people.record_metrics([{"series": "worker.cost_usd", "value": 0.2, "unit_id": "run-s5b",
                        "dims": {"job": "distil", "model": "claude-opus-5-5"}}])
r = client.get("/distill/next", params={"project": "beta"}, headers=WT)
check("BUDGET: at the month cap /distill/next answers 429 budget", r.status_code == 429
      and r.json()["detail"]["error"] == "budget" and r.json()["detail"]["cap_usd"] == 60.0, r.text)
check("BUDGET: maintainers are not capped",
      client.get("/distill/next", params={"project": "beta"}, headers=ADMIN).status_code == 200)
config.WORKER_CAP_MONTH_USD = 1000.0
check("BUDGET: a higher cap lets the worker through again",
      client.get("/distill/next", params={"project": "beta"}, headers=WT).status_code == 200)
os.environ.pop("KH_DISTILL_WORKER", None)
check("WORKER off again: refused at once",
      client.get("/distill/next", params={"project": "beta"}, headers=WT).status_code == 403)
people._unwrap_decide()

print(f"\n{'ALL PASS' if not FAILURES else 'FAILED'}  ({len(FAILURES)} failed)")
