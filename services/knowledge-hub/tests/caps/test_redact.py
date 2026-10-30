"""Contract test: app/caps/redact.py (stage F5, design 4.11).

  1. The shipped pack kh-default passes 100% of its conformance vectors, covers every default
     config.DISTILL_LEAK_PATTERNS match, and masked text scans clean; entropy and offsets.
  2. KH pack routes: list, id@ver, id (latest), 404, bad ref.
  3. Event write path (events.BODY_FILTERS): nested strings masked before validation and storage, index
     columns masked, kh.redacted written without the value; clean bodies untouched.
  4. Own packs: upload (201, replay 200), immutable (409 pack_immutable), own vectors must pass, every pattern
     needs a vector, kh- prefix reserved, backtracking guard, admin only.
  5. Selection: default -> manifest -> PUT /v1/{ns}/redaction (If-Match, unknown refs, admin only) -> DELETE.
  6. Mode refuse: 422 redaction_refused per event (?partial=true keeps the others), kh.redacted refused=true.
  7. :scan (masked + findings, no values, no canary oracle) and :verify.
  8. Canary hook point: a registered scanner's hit is masked, the write is stored, kh.canary_hit is written
     without the canary text.
  9. The generic hook redact.scrub for other modules' writes; switched off = no-op.
 10. The distil leak gate refuses on the same pack (and still on its own patterns).
 11. Purge removes the namespace's packs and selection.

    .venv\\Scripts\\python tests\\caps\\test_redact.py
"""
import json
import re

from harness import H

from app import config, sqldb
from app.caps import core, redact
from app.caps.core import CapError, Caller

c = H.client()
OWNER = H.person("olga@x.io", owner=["alpha"])


def _test_resolver(request, ns_row):
    p = request.headers.get("x-test-principal")
    return Caller(principal=p, role=request.headers.get("x-test-role", "agent"), kind="service") if p else None


core.CALLER_RESOLVERS.append(_test_resolver)


def as_(principal, role="agent", **extra):
    return {**OWNER, "X-Test-Principal": principal, "X-Test-Role": role, **extra}


def kh_events(ns, kind):
    with sqldb.connect() as conn:
        return [json.loads(r["body_json"]) for r in conn.execute(
            "SELECT body_json FROM kh_event WHERE ns=? AND kind=? ORDER BY seq", [ns, kind]).fetchall()]


def stored(ns, eid):
    with sqldb.connect() as conn:
        return conn.execute("SELECT * FROM kh_event WHERE ns=? AND id=?", [ns, eid]).fetchone()


# ── 1. the shipped pack ──────────────────────────────────────────────────────
packs = redact.shipped_packs()
default = [p for p in packs if p["pack_id"] == "kh-default"]
rep = redact.verify_vectors(default)[0]
H.check("kh-default@1 passes 100% of its conformance vectors", rep["passed"] == rep["vectors"] >= 20
        and not rep["failures"], rep)
names = {p["name"] for p in default[0]["patterns"]}
H.check("kh-default has email, secrets, phone, IBAN and high-entropy patterns",
        {"email", "assigned_secret", "key_token", "jwt", "phone", "iban", "high_entropy"} <= names, names)
he = next(p for p in default[0]["patterns"] if p["name"] == "high_entropy")
H.check("high-entropy: Shannon >= 4.0 over >= 24 characters", he["min_entropy"] == 4.0 and "{24,}" in he["regex"], he)
regexes = {p["regex"] for p in default[0]["patterns"]}
H.check("the config leak-gate secret patterns are in the pack verbatim",
        all(rx in regexes for rx in config.DISTILL_LEAK_PATTERNS[1:3]), config.DISTILL_LEAK_PATTERNS)
sc = redact.default_scanner()
leaks = []
for v in default[0]["vectors"]:
    masked, _ = sc.scan(v["text"])
    for rx in config.DISTILL_LEAK_PATTERNS:
        for m in re.finditer(rx, v["text"]):
            if m.group(0) in masked:
                leaks.append((rx, m.group(0)))
H.check("every config.DISTILL_LEAK_PATTERNS match in the vectors is masked by kh-default", not leaks, leaks)
H.check("entropy(): 0 for one symbol, 2 bits for four", redact.entropy("aaaa") == 0 and redact.entropy("abcd") == 2)
masked, found = sc.scan("x ana@x.io y")
H.check("findings carry name, kind, mode, pack and offsets, never the value",
        found == [{"name": "email", "kind": "pii", "mode": "mask", "pack": "kh-default@1", "start": 2, "end": 10}]
        and masked == "x [REDACTED:email] y", (masked, found))

# ── 2. KH pack routes ────────────────────────────────────────────────────────
r = c.get("/v1/redaction/packs", headers=OWNER)
H.check("GET /v1/redaction/packs lists kh-default@1", r.status_code == 200
        and any(p["ref"] == "kh-default@1" and p["owner"] == "kh" for p in r.json()["packs"]), r.text)
r = c.get("/v1/redaction/packs/kh-default@1", headers=OWNER)
H.check("GET one pack: patterns, vectors, sha256, spec", r.status_code == 200 and r.json()["vectors"]
        and r.json()["sha256"] == default[0]["sha256"] and "Shannon" in r.json()["spec"], r.text[:300])
r = c.get("/v1/redaction/packs/kh-default", headers=OWNER)
H.check("an id without @ver is the latest version", r.status_code == 200 and r.json()["version"] == 1, r.text[:200])
r = c.get("/v1/redaction/packs/kh-nope@3", headers=OWNER)
H.check("an unknown pack is 404", r.status_code == 404 and r.json()["error"] == "not_found", r.text)
r = c.get("/v1/redaction/packs/Bad Ref", headers=OWNER)
H.check("a malformed ref is 422", r.status_code == 422, r.text)
H.check("/v1/redaction/packs needs a sign-in", c.get("/v1/redaction/packs").status_code == 401)

# ── 3. the event write path ──────────────────────────────────────────────────
c.put("/v1/admin/ns/acme", json={"projects": ["alpha"]}, headers=OWNER)
r = c.put("/v1/acme/manifest", headers=OWNER, json={
    "schemas": [{"name": "note", "version": 1, "schema": {
        "type": "object", "properties": {"who": {"type": "string"}, "text": {"type": "string"}}}}],
    "types": [{"type": "note", "kind_of": "event", "schema": "note", "index_fields": {"who": "s"}}],
    "redaction": {"packs": ["acme.strict@1"]}})
assert r.status_code == 200, r.text
SECRET = "sk-ABCDEFGHIJKLMNOPqrst1234"
ev = {"id": "ev1", "kind": "note", "body": {"who": "ana@x.io", "text": f"key {SECRET}",
                                           "nested": [{"deep": "call +84 912 345 678"}, 7, None, True]}}
r = c.post("/v1/acme/events", json=ev, headers=as_("a1", **{"X-KH-Run": "R1"}))
H.check("an event with secrets is accepted", r.status_code == 200 and r.json()["accepted"][0]["id"] == "ev1", r.text)
row = stored("acme", "ev1")
body = json.loads(row["body_json"])
H.check("the stored body is masked before storage (nested strings too, other values kept)",
        body == {"who": "[REDACTED:email]", "text": "key [REDACTED:key_token]",
                 "nested": [{"deep": "call [REDACTED:phone]"}, 7, None, True]}, body)
H.check("the promoted index column holds the masked value", row["ix_s1"] == "[REDACTED:email]", row["ix_s1"])
red = kh_events("acme", "kh.redacted")
H.check("kh.redacted is written with names and pointers", len(red) == 1 and red[0]["where"] == "events"
        and sorted(f["pointer"] for f in red[0]["findings"]) == ["/nested/0/deep", "/text", "/who"], red)
H.check("kh.redacted never holds the value", SECRET not in json.dumps(red) and "ana@x.io" not in json.dumps(red))
r = c.post("/v1/acme/events", json={"id": "ev2", "kind": "note", "body": {"text": "all fine, port 5432"}},
           headers=as_("a1"))
H.check("a clean body is stored as is, no kh.redacted", r.status_code == 200
        and json.loads(stored("acme", "ev2")["body_json"]) == {"text": "all fine, port 5432"}
        and len(kh_events("acme", "kh.redacted")) == 1, r.text)

# ── 4. own packs ─────────────────────────────────────────────────────────────
r = c.get("/v1/acme/redaction", headers=as_("a1"))
H.check("a manifest pack that does not exist yet is reported missing; kh-default still applies",
        r.json()["source"] == "manifest" and r.json()["missing"] == ["acme.strict@1"]
        and [e["ref"] for e in r.json()["effective"]] == ["kh-default@1"], r.text)
STRICT = {"description": "acme: holdout ids are refused, ticket keys masked",
          "patterns": [{"name": "holdout_id", "kind": "secret", "mode": "refuse", "regex": r"\bHOLD-\d{4}\b"},
                       {"name": "ticket", "kind": "pii", "mode": "mask", "regex": r"\bTCK-\d{3,}\b"}],
          "vectors": [{"text": "see HOLD-1234", "findings": ["holdout_id"], "refused": True},
                      {"text": "fix TCK-981 now", "findings": ["ticket"], "masked": "fix [REDACTED:ticket] now"},
                      {"text": "HOLD-12 is fine", "findings": []}]}
r = c.put("/v1/acme/redaction/packs/acme.strict@1", json=STRICT, headers=as_("a1"))
H.check("a non-admin cannot upload a pack", r.status_code == 403, r.text)
r = c.put("/v1/acme/redaction/packs/acme.strict@1", json=STRICT, headers=OWNER)
H.check("the namespace admin uploads a pack: 201 with its conformance report", r.status_code == 201
        and r.json()["conformance"]["passed"] == 3, r.text)
r = c.put("/v1/acme/redaction/packs/acme.strict@1", json=STRICT, headers=OWNER)
H.check("the same pack again is 200, not created", r.status_code == 200 and r.json()["created"] is False, r.text)
changed = {**STRICT, "description": "x", "vectors": STRICT["vectors"] + [{"text": "TCK-1000", "findings": ["ticket"]}]}
r = c.put("/v1/acme/redaction/packs/acme.strict@1", json=changed, headers=OWNER)
H.check("a version is immutable: other content is 409 pack_immutable", r.status_code == 409
        and r.json()["error"] == "pack_immutable", r.text)
bad = {**STRICT, "vectors": [{"text": "see HOLD-1234", "findings": ["ticket", "holdout_id"], "refused": True},
                             {"text": "TCK-100", "findings": ["ticket"]}]}
r = c.put("/v1/acme/redaction/packs/acme.strict@2", json=bad, headers=OWNER)
H.check("a pack failing its own vectors is 422 with the conformance report", r.status_code == 422
        and r.json()["conformance"]["failures"], r.text)
r = c.put("/v1/acme/redaction/packs/acme.strict@2", json={**STRICT, "vectors": STRICT["vectors"][:1]}, headers=OWNER)
H.check("every pattern needs a vector that finds it", r.status_code == 422 and "ticket" in r.text, r.text)
r = c.put("/v1/acme/redaction/packs/kh-mine@1", json=STRICT, headers=OWNER)
H.check("the kh- prefix is reserved", r.status_code == 403, r.text)
evil = {"patterns": [{"name": "evil", "kind": "secret", "regex": r"(a+)+b"}],
        "vectors": [{"text": "aab", "findings": ["evil"]}]}
r = c.put("/v1/acme/redaction/packs/acme.evil@1", json=evil, headers=OWNER)
H.check("nested quantifiers are refused (backtracking guard)", r.status_code == 422 and "nested" in r.text, r.text)
r = c.put("/v1/acme/redaction/packs/acme.empty@1", json={"patterns": [{"name": "e", "kind": "pii", "regex": "x*"}],
                                                          "vectors": [{"text": "x", "findings": ["e"]}]}, headers=OWNER)
H.check("a regex that matches the empty string is refused", r.status_code == 422, r.text)
r = c.put("/v1/acme/redaction/packs/acme.strict", json=STRICT, headers=OWNER)
H.check("an upload must pin a version", r.status_code == 422, r.text)
r = c.get("/v1/acme/redaction/packs", headers=as_("a1"))
H.check("the namespace lists KH packs and its own", {p["ref"] for p in r.json()["packs"]} >= {"kh-default@1",
                                                                                         "acme.strict@1"}, r.text)
r = c.get("/v1/redaction/packs/acme.strict@1", headers=OWNER)
H.check("a namespace pack is not served on the KH-wide route", r.status_code == 404, r.text)

# ── 5. selection ─────────────────────────────────────────────────────────────
r = c.get("/v1/acme/redaction", headers=as_("a1"))
H.check("after the upload the manifest selection resolves: kh-default first, then the own pack",
        r.json()["source"] == "manifest" and not r.json()["missing"]
        and [e["ref"] for e in r.json()["effective"]] == ["kh-default@1", "acme.strict@1"], r.text)
r = c.put("/v1/acme/redaction", json={"packs": ["kh-default@1"]}, headers=as_("a1"))
H.check("a non-admin cannot select packs", r.status_code == 403, r.text)
r = c.put("/v1/acme/redaction", json={"packs": ["acme.nope@1"]}, headers=OWNER)
H.check("selecting an unknown pack is 422 with the missing refs", r.status_code == 422
        and r.json()["missing"] == ["acme.nope@1"], r.text)
r = c.put("/v1/acme/redaction", json={"packs": ["kh-default@1"]}, headers=OWNER)
H.check("PUT /v1/{ns}/redaction: 201 with ETag 1, source api", r.status_code == 201 and r.headers["ETag"] == '"1"'
        and r.json()["source"] == "api" and [e["ref"] for e in r.json()["effective"]] == ["kh-default@1"], r.text)
r = c.put("/v1/acme/redaction", json={"packs": ["acme.strict"]}, headers={**OWNER, "If-Match": '"7"'})
H.check("a stale If-Match is 409 write_conflict", r.status_code == 409 and r.json()["error"] == "write_conflict", r.text)
r = c.put("/v1/acme/redaction", json={"packs": ["acme.strict"]}, headers={**OWNER, "If-Match": '"1"'})
H.check("with the current If-Match: rev 2, kh-default added in front of an own-only selection",
        r.status_code == 200 and r.headers["ETag"] == '"2"'
        and [e["ref"] for e in r.json()["effective"]] == ["kh-default@1", "acme.strict@1"], r.text)
r = c.delete("/v1/acme/redaction", headers=OWNER)
H.check("DELETE goes back to the manifest selection", r.status_code == 200 and r.json()["source"] == "manifest", r.text)

# ── 6. mode refuse ───────────────────────────────────────────────────────────
r = c.post("/v1/acme/events", json={"id": "ev3", "kind": "note", "body": {"text": "answer is HOLD-4242"}},
           headers=as_("a1"))
H.check("a refuse pattern rejects the event: 422 with redaction_refused, no value in the answer",
        r.status_code == 422 and r.json()["rejected"][0]["errors"][0]["error"] == "redaction_refused"
        and "HOLD-4242" not in r.text and stored("acme", "ev3") is None, r.text)
r = c.post("/v1/acme/events?partial=true", headers=as_("a1"), json={"events": [
    {"id": "ev4", "kind": "note", "body": {"text": "HOLD-4242"}},
    {"id": "ev5", "kind": "note", "body": {"text": "TCK-981 done"}}]})
H.check("?partial=true keeps the other events, masked by the own pack too", r.status_code == 200
        and [a["id"] for a in r.json()["accepted"]] == ["ev5"]
        and json.loads(stored("acme", "ev5")["body_json"]) == {"text": "[REDACTED:ticket] done"}, r.text)
H.check("a refusal writes kh.redacted refused=true", any(e["refused"] for e in kh_events("acme", "kh.redacted")))

# ── 7. scan and verify ───────────────────────────────────────────────────────
r = c.post("/v1/acme/redaction:scan", json={"text": "mail ana@x.io, ticket TCK-123, HOLD-0001"}, headers=as_("a1"))
j = r.json()
H.check(":scan masks with the namespace packs and reports findings without values", r.status_code == 200
        and j["masked"] == "mail [REDACTED:email], ticket [REDACTED:ticket], [REDACTED:holdout_id]"
        and [f["name"] for f in j["findings"]] == ["email", "ticket", "holdout_id"] and j["refused"] is True
        and "ana@x.io" not in json.dumps(j["findings"]), r.text)
r = c.post("/v1/acme/redaction:scan", json={"nope": 1}, headers=as_("a1"))
H.check(":scan needs {text}", r.status_code == 422, r.text)
r = c.post("/v1/acme/redaction:verify", headers=as_("a1"))
H.check(":verify runs every selected pack's vectors: all passed", r.status_code == 200 and r.json()["all_passed"]
        and [p["ref"] for p in r.json()["packs"]] == ["kh-default@1", "acme.strict@1"], r.text)

# ── 8. canary hook point ─────────────────────────────────────────────────────
CANARY = "khc-0123456789abcdef"


def fake_vault(ns, text):
    if ns != "acme":
        return []
    return [{"start": m.start(), "end": m.end(), "vault": "holdout", "item": "q7", "canary": m.group(0)}
            for m in re.finditer(r"khc-[0-9a-f]{16}", text) if m.group(0) == CANARY]


redact.register_canary_scanner(fake_vault)
redact.register_canary_scanner(fake_vault)
H.check("registering a canary scanner twice keeps one", redact.CANARY_SCANNERS.count(fake_vault) == 1)
r = c.post("/v1/acme/events", json={"id": "ev6", "kind": "note", "body": {"text": f"copied {CANARY} here"}},
           headers=as_("a2", **{"X-KH-Run": "R9"}))
H.check("a canary hit is still stored (D10), masked", r.status_code == 200
        and json.loads(stored("acme", "ev6")["body_json"]) == {"text": "copied [REDACTED:canary] here"}, r.text)
hits = kh_events("acme", "kh.canary_hit")
H.check("kh.canary_hit {vault, item, principal, run_id} without the canary text", len(hits) == 1
        and hits[0]["vault"] == "holdout" and hits[0]["item"] == "q7" and hits[0]["principal"] == "a2"
        and hits[0]["run_id"] == "R9" and hits[0]["pointer"] == "/text" and CANARY not in json.dumps(hits), hits)
r = c.post("/v1/acme/redaction:scan", json={"text": f"is {CANARY} a canary?"}, headers=as_("a2"))
H.check(":scan never runs canary scanners (no canary oracle)", r.json()["masked"] == f"is {CANARY} a canary?"
        and len(kh_events("acme", "kh.canary_hit")) == 1, r.text)

# ── 9. the generic hook ──────────────────────────────────────────────────────


class _Req:
    headers = {}


ns_row = __import__("app.caps.registry", fromlist=["ns_state"]).ns_state("acme")
ctx = core.Ctx(ns="acme", ns_row=ns_row, caller=Caller("rec-writer", "agent", "service"), request=_Req(), run_id="R2")
out = redact.scrub(ctx, "records", {"source_text": "token=abc123def456 from bob@corp.io"})
H.check("scrub(ctx, where, body) masks a record body for any module", out == {
    "source_text": "[REDACTED:assigned_secret] from [REDACTED:email]"}, out)
H.check("... and writes kh.redacted with where=records", kh_events("acme", "kh.redacted")[-1]["where"] == "records")
try:
    redact.scrub(ctx, "rules", "HOLD-9999")
    H.check("scrub raises 422 redaction_refused on a refuse pattern", False)
except CapError as exc:
    H.check("scrub raises 422 redaction_refused on a refuse pattern", exc.status == 422
            and exc.code == "redaction_refused" and "HOLD-9999" not in json.dumps(exc.extra), exc.extra)
same = {"a": "plain"}
H.check("a clean body comes back as the same object", redact.scrub(ctx, "records", same) is same)
redact._active[0] = False
H.check("switched off, scrub is a no-op", redact.scrub(ctx, "records", "ana@x.io") == "ana@x.io")
redact._active[0] = True

# ── 10. the distil leak gate ─────────────────────────────────────────────────
from app import distill  # noqa: E402

H.check("the leak gate still refuses its own patterns", distill._leak("write to ana@x.io") == "ana@x.io")
H.check("the leak gate refuses on the shared pack too (phone, IBAN, key)",
        distill._leak("call +84 912 345 678") == "+84 912 345 678"
        and distill._leak("pay DE89 3704 0044 0532 0130 00") == "DE89 3704 0044 0532 0130 00"
        and distill._leak("aws AKIAIOSFODNN7EXAMPLE") == "AKIAIOSFODNN7EXAMPLE")
H.check("the leak gate lets a clean lesson through", distill._leak("Run the migration before the deploy, "
                                                                   "release 10.4.2, commit 9f86d0818", strict=False)
        is None)

# ── 11. purge ────────────────────────────────────────────────────────────────
c.put("/v1/acme/redaction", json={"packs": ["acme.strict@1"]}, headers=OWNER)
with sqldb.connect() as conn:
    redact._on_state(conn, "acme", "detached", "purged")
with sqldb.connect() as conn:
    left = conn.execute("SELECT COUNT(*) FROM kh_redact_pack WHERE ns='acme'").fetchone()[0] \
        + conn.execute("SELECT COUNT(*) FROM kh_redact_ns WHERE ns='acme'").fetchone()[0]
    kh_left = conn.execute("SELECT COUNT(*) FROM kh_redact_pack WHERE ns='_kh'").fetchone()[0]
H.check("purge removes the namespace's packs and selection, never KH packs", left == 0 and kh_left >= 1, (left, kh_left))
H.check("discovery lists redaction", any(x["name"] == "redaction" for x in c.get("/v1/capabilities",
                                                                                   headers=OWNER).json()["capabilities"]))
H.done()
