"""Contract test: app/caps/packs.py (stage F10, design 4.7).

  1. Versions: vN.0 drafts, normalized parts, sha256 over parts sorted by path (order-independent), 422 / 403 / 404.
  2. Draft edit with If-Match (409 write_conflict + kh.write_conflict); freeze -> immutable (409 pack_immutable).
  3. Quotes: path#page#offset ids, cite by text or span, ~length on a taken id, chunk quotes from app/chunker.py.
  4. Re-anchoring: v2.0 over v1.0 shifts offsets, orphans removed text; the quote map is followed to the latest.
  5. Addenda vN.k overlay the frozen vN.(k-1); version_order for stale bases and out-of-order freezes.
  6. Assumption register: ASSUMED-n never reused, confirm policy, If-Match, content change reopens, superseded final.
  7. Duplicate questions: threshold tuned on a labelled set (precision >= 0.95), contrast guard, exact repeats,
     HTTP lookup / store / answer / reopen.
  8. Redaction on every write path, fencing (settings.packs.fenced), require_if_match, Idempotency-Key replay.
  9. RACES: version numbers, one freeze winner, assumption codes, identical questions, If-Match PATCH.
 10. Purge hook and discovery.

    .venv\\Scripts\\python tests\\caps\\test_packs.py
"""
import json
from urllib.parse import quote as urlquote

from harness import H

from app import sqldb
from app.caps import core, packs
from app.caps.core import Caller

c = H.client()
OWNER = H.person("olga@x.io", owner=["alpha", "beta"])


def as_(principal, role="agent", projects=None):
    h = {**OWNER, "X-Test-Principal": principal, "X-Test-Role": role}
    if projects is not None:
        h["X-Test-Projects"] = ",".join(projects)
    return h


def _test_resolver(request, ns_row):
    p = request.headers.get("x-test-principal")
    if not p:
        return None
    pr = request.headers.get("x-test-projects")
    return Caller(principal=p, role=request.headers.get("x-test-role", "agent"), kind="service",
                  projects=set(pr.split(",")) if pr is not None else None)


core.CALLER_RESOLVERS.append(_test_resolver)


def kh_events(ns, kind):
    with sqldb.connect() as conn:
        return [json.loads(r[0]) for r in conn.execute("SELECT body_json FROM kh_event WHERE ns=? AND kind=?",
                                                       [ns, kind]).fetchall()]


def attach_ns(ns, settings=None):
    r = c.put(f"/v1/admin/ns/{ns}", json={"projects": ["alpha", "beta"]}, headers=OWNER)
    assert r.status_code in (200, 201), r.text
    r = c.put(f"/v1/{ns}/manifest", json={"settings": {"packs": settings or {}}}, headers=OWNER)
    assert r.status_code == 200, r.text


attach_ns("acme")
attach_ns("cpol", {"confirm_policy": {"roles": ["judge"]}})
attach_ns("fence", {"fenced": True, "require_if_match": True})

ORCH = as_("o1", "orchestrator")
AGENT = as_("a1", "agent")
CONF = as_("c1", "confirmer")
P = "/v1/acme/packs"

INTRO = ("The service accepts orders from registered customers. Every order must be paid before it ships. "
         "A refund above the limit needs a second approval.")
LIMITS_TXT = ("Uploads are limited to 20 MB per file. Sessions expire after 30 minutes of inactivity. "
              "Audit logs are kept for one year.")
PARTS = [{"path": "spec/intro.md", "page": 1, "text": INTRO.replace(". ", ".\r\n", 1) + "   \r\n"},
         {"path": "spec/limits.md", "page": 2, "text": LIMITS_TXT}]


def local_sha(parts):
    return core.sha256_json([[p["path"], p.get("page", 1), packs.sha(packs.normalize(p["text"]))]
                             for p in sorted(parts, key=lambda p: (p["path"], p.get("page", 1)))])


def q(qid):
    return urlquote(qid, safe="/")


# ── 1. versions ──────────────────────────────────────────────────────────────
r = c.post(f"{P}/spec/versions", json={"project": "alpha", "title": "Service spec", "parts": PARTS}, headers=ORCH)
H.check("POST versions creates v1.0 as a draft (201, ETag 1)", r.status_code == 201 and r.json()["version"] == "v1.0"
        and r.json()["state"] == "draft" and r.headers.get("etag") == '"1"', r.text)
H.check("sha256 = sha over normalized parts sorted by path", r.json()["sha256"] == local_sha(PARTS), r.json())
r2 = c.post(f"{P}/spec-copy/versions", json={"project": "alpha", "parts": list(reversed(PARTS))}, headers=ORCH)
H.check("the hash does not depend on the upload order", r2.json()["sha256"] == r.json()["sha256"], r2.text)
g = c.get(f"{P}/spec?version=v1.0&text=true", headers=AGENT).json()
H.check("parts are normalized (LF, no trailing blanks)", g["parts"][0]["text"] == packs.normalize(PARTS[0]["text"])
        and "\r" not in g["parts"][0]["text"] and not g["parts"][0]["text"].endswith(" "), g["parts"][0])
r = c.post(f"{P}/bad/versions", json={"project": "alpha", "parts": [{"path": "a#b", "text": "x"}]}, headers=ORCH)
H.check("a path with '#' is 422 validation_failed", r.status_code == 422 and r.json()["error"] == "validation_failed",
        r.text)
r = c.post(f"{P}/bad/versions", json={"project": "alpha", "parts": [{"path": "a", "text": "x"}]}, headers=AGENT)
H.check("an agent (packs: read) cannot upload a version (403)", r.status_code == 403, r.text)
r = c.get(f"{P}/spec", headers=as_("a9", "agent", ["beta"]))
H.check("a pack outside the caller's project grant is 404", r.status_code == 404, r.text)
r = c.post(f"{P}/spec/versions", json={"project": "beta", "parts": PARTS}, headers=ORCH)
H.check("a pack cannot move to another project", r.status_code == 422, r.text)
H.check("kh.pack_version events are written", len(kh_events("acme", "kh.pack_version")) >= 2)

# ── 2. draft edit and freeze ─────────────────────────────────────────────────
r = c.patch(f"{P}/spec/versions/v1.0", json={"parts": [{"path": "spec/extra.md", "text": "Extra notes."}]},
            headers={**ORCH, "If-Match": '"7"'})
H.check("a stale If-Match on a draft edit is 409 write_conflict", r.status_code == 409
        and r.json()["error"] == "write_conflict" and r.headers.get("etag") == '"1"', r.text)
H.check("... and writes kh.write_conflict", any(e.get("table") == "kh_pack" for e in kh_events("acme", "kh.write_conflict")))
r = c.patch(f"{P}/spec/versions/v1.0", json={"remove": [{"path": "spec/nope.md"}]}, headers={**ORCH, "If-Match": '"1"'})
H.check("removing a part that does not exist is 422", r.status_code == 422, r.text)
r = c.patch(f"{P}/spec/versions/v1.0", json={"parts": [{"path": "spec/extra.md", "text": "Extra notes."}]},
            headers={**ORCH, "If-Match": '"1"'})
H.check("a draft edit with the right If-Match is 200 and changes the hash", r.status_code == 200
        and r.json()["rev"] == 2 and r.json()["parts_n"] == 3 and r.json()["sha256"] != local_sha(PARTS), r.text)
r = c.patch(f"{P}/spec/versions/v1.0", json={"remove": [{"path": "spec/extra.md"}]}, headers={**ORCH, "If-Match": '"2"'})
H.check("removing it again restores the original hash", r.status_code == 200 and r.json()["sha256"] == local_sha(PARTS),
        r.text)
SHA1 = r.json()["sha256"]
r = c.post(f"{P}/spec/versions/v1.0:freeze", headers={**ORCH, "If-Match": '"1"'})
H.check("a freeze with a stale If-Match is 409 write_conflict", r.status_code == 409
        and r.json()["error"] == "write_conflict", r.text)
r = c.post(f"{P}/spec/versions/v1.0:freeze", headers=ORCH)
F1 = r.json()
H.check("freeze is 200: frozen, chunk quotes, vectors indexed", r.status_code == 200 and F1["state"] == "frozen"
        and F1["quotes"] >= 2 and F1["index_state"] == "done" and F1["superseded"] is None, r.text)
r = c.patch(f"{P}/spec/versions/v1.0", json={"parts": [{"path": "x", "text": "y"}]}, headers=ORCH)
H.check("a frozen version is immutable (409 pack_immutable)", r.status_code == 409
        and r.json()["error"] == "pack_immutable", r.text)
r = c.post(f"{P}/spec/versions/v1.0:freeze", headers=ORCH)
H.check("freezing twice is 409 pack_immutable", r.status_code == 409 and r.json()["error"] == "pack_immutable", r.text)
H.check("kh.pack_frozen is written", any(e["version"] == "v1.0" and e["pack_id"] == "spec"
                                         for e in kh_events("acme", "kh.pack_frozen")))
chunks = c.get(f"{P}/spec/quotes?version=v1.0&origin=chunk", headers=AGENT).json()["quotes"]
H.check("chunk quotes cover every part and carry path#page#offset ids",
        {x["path"] for x in chunks} == {"spec/intro.md", "spec/limits.md"}
        and all(x["quote_id"] == f"{x['path']}#{x['page']}#{x['offset']}" for x in chunks), chunks[:2])
from app import vector_store as vs  # noqa: E402
hits = vs.get_vt({"pack_id": {"$eq": "spec"}}, collection=vs.get_or_create(packs.packs_collection("acme")))
H.check("chunk vectors carry ns, pack_id, version, quote_id", len(hits) == len(chunks)
        and all({"ns", "pack_id", "version", "quote_id"} <= set(h["metadata"]) for h in hits), len(hits))

# ── 3. quotes ────────────────────────────────────────────────────────────────
intro = packs.normalize(PARTS[0]["text"])
PAID = "Every order must be paid before it ships."
REFUND = "A refund above the limit needs a second approval."
r = c.post(f"{P}/spec/quotes", json={"path": "spec/intro.md", "text": PAID}, headers=ORCH)
QPAID = r.json()
H.check("cite by exact text: 201, id path#page#offset", r.status_code == 201
        and QPAID["quote_id"] == f"spec/intro.md#1#{intro.find(PAID)}" and QPAID["text"] == PAID
        and QPAID["version"] == "v1.0" and QPAID["origin"] == "cite", r.text)
r = c.post(f"{P}/spec/quotes", json={"path": "spec/intro.md", "text": PAID}, headers=ORCH)
H.check("citing the same span again is 200 with the same id", r.status_code == 200
        and r.json()["quote_id"] == QPAID["quote_id"], r.text)
r = c.post(f"{P}/spec/quotes", json={"path": "spec/intro.md", "offset": QPAID["offset"], "length": 10}, headers=ORCH)
H.check("another length at a taken offset gets id ...~length", r.status_code == 201
        and r.json()["quote_id"] == QPAID["quote_id"] + "~10", r.text)
r = c.post(f"{P}/spec/quotes", json={"path": "spec/intro.md", "text": REFUND}, headers=ORCH)
QREF = r.json()
r = c.post(f"{P}/spec/quotes", json={"path": "spec/intro.md", "offset": 0, "length": 5, "text": "Nope!"}, headers=ORCH)
H.check("a span whose text differs is 422", r.status_code == 422, r.text)
r = c.post(f"{P}/spec/quotes", json={"path": "spec/intro.md", "text": "not in the document"}, headers=ORCH)
H.check("text that does not appear is 404", r.status_code == 404, r.text)
r = c.get(f"/v1/acme/quotes/{q(QPAID['quote_id'])}?pack=spec", headers=AGENT)
H.check("GET /quotes/{id} on the latest version: status current", r.status_code == 200
        and r.json()["status"] == "current" and r.json()["latest"]["text"] == PAID, r.text)
r = c.get(f"/v1/acme/quotes/{q(QPAID['quote_id'])}", headers=AGENT)
H.check("GET /quotes/{id} without ?pack= finds the one pack that holds the id",
        r.status_code == 200 and r.json()["requested"]["pack_id"] == "spec", r.text)

# ── 4. re-anchoring: v2.0 over v1.0 ──────────────────────────────────────────
NEW_INTRO = "Scope: this section was added in version two. " + intro.replace(REFUND, "Refunds need one approval.")
r = c.post(f"{P}/spec/versions", json={"base": "v1.0", "parts": [{"path": "spec/intro.md", "text": NEW_INTRO}]},
           headers=ORCH)
H.check("a new major copies a frozen base and overlays parts", r.status_code == 201 and r.json()["version"] == "v2.0"
        and r.json()["base"] == "v1.0" and r.json()["parts_n"] == 2, r.text)
r = c.post(f"{P}/spec/versions/v2.0:freeze", headers=ORCH)
F2 = r.json()
H.check("freezing v2.0 supersedes v1.0, re-anchors and orphans quotes", r.status_code == 200
        and F2["superseded"] == "v1.0" and F2["reanchored"] >= 2 and F2["orphaned"] >= 1, r.text)
H.check("v1.0 is now superseded (and keeps its hash)", c.get(f"{P}/spec?version=v1.0", headers=AGENT).json()["state"]
        == "superseded" and c.get(f"{P}/spec?version=v1.0", headers=AGENT).json()["sha256"] == SHA1)
r = c.get(f"/v1/acme/quotes/{q(QPAID['quote_id'])}?pack=spec&version=v1.0", headers=AGENT).json()
NEW_OFF = packs.normalize(NEW_INTRO).find(PAID)
H.check("a quote re-anchors to the shifted offset in v2.0", r["status"] == "reanchored"
        and r["latest"]["version"] == "v2.0" and r["latest"]["offset"] == NEW_OFF and r["latest"]["text"] == PAID
        and r["latest"]["quote_id"] == f"spec/intro.md#1#{NEW_OFF}" and len(r["hops"]) == 1, r)
r = c.get(f"/v1/acme/quotes/{q(QREF['quote_id'])}?pack=spec&version=v1.0", headers=AGENT).json()
H.check("a quote whose text is gone is orphaned at v2.0", r["status"] == "orphaned" and r["orphaned_at"] == "v2.0"
        and r["latest"]["version"] == "v1.0", r)
lim = c.get(f"/v1/acme/quotes/{q('spec/limits.md#2#0')}?pack=spec&version=v1.0", headers=AGENT).json()
H.check("an unchanged part keeps its quote id across versions", lim["latest"]["quote_id"] == "spec/limits.md#2#0"
        and lim["latest"]["version"] == "v2.0", lim)

# ── 5. addenda and version order ─────────────────────────────────────────────
r = c.post(f"{P}/spec/versions/v2.0/addenda", json={"parts": [{"path": "spec/annex.md", "page": 1,
                                                                 "text": "Annex A lists the supported currencies."}]},
           headers=ORCH)
H.check("an addendum over v2.0 is v2.1 (draft, parts overlaid)", r.status_code == 201
        and r.json()["version"] == "v2.1" and r.json()["parts_n"] == 3 and r.json()["base"] == "v2.0", r.text)
r = c.post(f"{P}/spec/versions/v2.1:freeze", headers=ORCH)
H.check("freezing v2.1 supersedes v2.0", r.status_code == 200 and r.json()["superseded"] == "v2.0", r.text)
r = c.get(f"/v1/acme/quotes/{q(QPAID['quote_id'])}?pack=spec&version=v1.0", headers=AGENT).json()
H.check("the quote map is followed hop by hop: v1.0 -> v2.0 -> v2.1", r["latest"]["version"] == "v2.1"
        and len(r["hops"]) == 2 and r["status"] == "reanchored" and r["latest"]["text"] == PAID, r)
r = c.post(f"{P}/spec/versions/v1.0/addenda", json={"parts": [{"path": "x", "text": "y"}]}, headers=ORCH)
H.check("an addendum over a superseded version is 409 version_order", r.status_code == 409
        and r.json()["error"] == "version_order", r.text)
r = c.post(f"{P}/spec/versions/v2.1/addenda", json={"parts": [{"path": "spec/annex.md", "text": "A2"}],
                                                    "freeze": True}, headers=ORCH)
H.check("an addendum with freeze: true is created and frozen (v2.2)", r.status_code == 201
        and r.json()["version"] == "v2.2" and r.json()["state"] == "frozen", r.text)
c.post(f"{P}/order/versions", json={"project": "alpha", "parts": [{"path": "a", "text": "one"}]}, headers=ORCH)
c.post(f"{P}/order/versions", json={"project": "alpha", "parts": [{"path": "a", "text": "two"}]}, headers=ORCH)
c.post(f"{P}/order/versions/v2.0:freeze", headers=ORCH)
r = c.post(f"{P}/order/versions/v1.0:freeze", headers=ORCH)
H.check("freezing a draft older than the latest frozen version is 409 version_order", r.status_code == 409
        and r.json()["error"] == "version_order" and r.json()["latest"] == "v2.0", r.text)
H.check("... and leaves it a draft", c.get(f"{P}/order?version=v1.0", headers=AGENT).json()["state"] == "draft")
g = c.get(f"{P}/spec", headers=AGENT).json()
H.check("GET pack without version answers the latest frozen one", g["version"] == "v2.2"
        and g["latest_version"] == "v2.2", g.get("version"))
vers = c.get(f"{P}/spec/versions", headers=AGENT).json()["versions"]
H.check("versions list states", [(v["version"], v["state"]) for v in vers] == [
    ("v1.0", "superseded"), ("v2.0", "superseded"), ("v2.1", "superseded"), ("v2.2", "frozen")], vers)
g1 = c.get(f"{P}/spec?version=v1.0&text=true", headers=AGENT).json()
H.check("a frozen version's content still hashes to its sha256",
        local_sha([{"path": p["path"], "page": p["page"], "text": p["text"]} for p in g1["parts"]]) == g1["sha256"])

# ── 6. assumption register ───────────────────────────────────────────────────
A = f"{P}/spec/assumptions"
r = c.post(A, json={"text": "Customers are always registered before ordering."}, headers=ORCH)
H.check("an assumption gets ASSUMED-1, status open", r.status_code == 201 and r.json()["code"] == "ASSUMED-1"
        and r.json()["status"] == "open" and r.headers.get("etag") == '"1"', r.text)
r = c.post(A, json={"text": "Payment happens before shipping.", "quote_id": QPAID["quote_id"], "version": "v1.0"},
           headers=ORCH)
H.check("an assumption can cite a quote", r.status_code == 201 and r.json()["code"] == "ASSUMED-2"
        and r.json()["quote_id"] == QPAID["quote_id"] and r.json()["quote_version"] == "v1.0", r.text)
r = c.post(A, json={"text": "x", "quote_id": "spec/none#1#0"}, headers=ORCH)
H.check("an unknown quote id is 404", r.status_code == 404, r.text)
r = c.post(A, json={"text": "Agents may not add assumptions."}, headers=AGENT)
H.check("an agent cannot register an assumption (403)", r.status_code == 403, r.text)
r = c.patch(f"{A}/ASSUMED-1", json={"status": "confirmed"}, headers=ORCH)
H.check("an orchestrator cannot confirm (403: confirm policy)", r.status_code == 403, r.text)
r = c.patch(f"{A}/ASSUMED-1", json={"status": "confirmed"}, headers={**CONF, "If-Match": '"1"'})
H.check("a confirmer confirms with If-Match", r.status_code == 200 and r.json()["status"] == "confirmed"
        and r.json()["rev"] == 2, r.text)
r = c.patch(f"{A}/ASSUMED-1", json={"status": "refuted"}, headers={**CONF, "If-Match": '"1"'})
H.check("a stale If-Match is 409 write_conflict", r.status_code == 409 and r.json()["error"] == "write_conflict", r.text)
r = c.patch(f"{A}/ASSUMED-1", json={"text": "Customers are registered first."}, headers=CONF)
H.check("a confirmer cannot edit the text (packs: write)", r.status_code == 403, r.text)
r = c.patch(f"{A}/ASSUMED-1", json={"text": "Customers are registered first."}, headers=ORCH)
H.check("a text change drops the confirmation back to open", r.status_code == 200 and r.json()["status"] == "open",
        r.text)
r = c.patch(f"{A}/ASSUMED-1", json={"superseded_by": "ASSUMED-2"}, headers=ORCH)
H.check("superseded_by supersedes", r.status_code == 200 and r.json()["status"] == "superseded"
        and r.json()["superseded_by"] == "ASSUMED-2", r.text)
r = c.patch(f"{A}/ASSUMED-1", json={"status": "open"}, headers=ORCH)
H.check("a superseded assumption is final (409 assumption_final)", r.status_code == 409
        and r.json()["error"] == "assumption_final", r.text)
r = c.post(A, json={"text": "Third."}, headers=ORCH)
H.check("codes are never reused (ASSUMED-3)", r.json()["code"] == "ASSUMED-3", r.text)
r = c.get(f"{A}?status=superseded", headers=AGENT).json()["assumptions"]
H.check("the register filters by status", [a["code"] for a in r] == ["ASSUMED-1"], r)
ev = kh_events("acme", "kh.assumption")
H.check("kh.assumption events record status changes", any(e["code"] == "ASSUMED-1" and e["status"] == "superseded"
                                                          for e in ev) and len(ev) >= 5, ev)
c.post("/v1/cpol/packs/p/versions", json={"project": "alpha", "parts": [{"path": "a", "text": "b"}]}, headers=ORCH)
c.post("/v1/cpol/packs/p/assumptions", json={"text": "t"}, headers=ORCH)
r = c.patch("/v1/cpol/packs/p/assumptions/ASSUMED-1", json={"status": "confirmed"}, headers=CONF)
H.check("a manifest confirm_policy replaces the default (confirmer 403)", r.status_code == 403, r.text)
r = c.patch("/v1/cpol/packs/p/assumptions/ASSUMED-1", json={"status": "confirmed"}, headers=as_("j1", "judge"))
H.check("... and lets the listed role confirm", r.status_code == 200 and r.json()["status"] == "confirmed", r.text)

# ── 7. duplicate questions: threshold tuning on a labelled set ───────────────
LABELLED = [   # (is_duplicate, a, b) - generic product-documentation questions
    (1, "What is the maximum file size for uploads?", "What is the max size of an uploaded file?"),
    (1, "How long does a session stay valid before it expires?", "How long is a session valid before expiry?"),
    (1, "Which currencies does the invoice module support?", "What currencies are supported by the invoice module?"),
    (1, "Is two-factor authentication required for administrators?",
     "Do administrators have to use two-factor authentication?"),
    (1, "What happens when a payment fails twice?", "What happens if a payment fails two times?"),
    (1, "Can a user delete their own account?", "Is a user able to delete their own account?"),
    (1, "Who approves a refund above the limit?", "Who must approve refunds that exceed the limit?"),
    (1, "What is the retention period for audit logs?", "How long are audit logs retained?"),
    (1, "Does the export include archived orders?", "Are archived orders included in the export?"),
    (1, "What time zone are report dates shown in?", "In which time zone are dates in reports displayed?"),
    (1, "How many retries are allowed for a failed request?", "How many times can a failed request be retried?"),
    (1, "What is the minimum password length?", "How short can a password be at minimum?"),
    (1, "Can orders be cancelled after shipping?", "Is it possible to cancel an order once it has shipped?"),
    (1, "Where are uploaded images stored?", "In what location are uploaded images stored?"),
    (1, "What format do dates use in the API?", "Which date format does the API use?"),
    (1, "Does the search support wildcards?", "Are wildcards supported by the search?"),
    (0, "What is the timeout for login?", "What is the timeout for logout?"),
    (0, "What is the maximum file size for uploads?", "What is the maximum file size for downloads?"),
    (0, "Can a user delete their own account?", "Can an administrator delete another user's account?"),
    (0, "Which currencies does the invoice module support?", "Which languages does the invoice module support?"),
    (0, "Who approves a refund above the limit?", "Who approves a refund below the limit?"),
    (0, "What is the retention period for audit logs?", "What is the retention period for access logs?"),
    (0, "Does the export include archived orders?", "Does the export include cancelled orders?"),
    (0, "Is two-factor authentication required for administrators?",
     "Is two-factor authentication required for guests?"),
    (0, "What happens when a payment fails twice?", "What happens when a payment fails three times?"),
    (0, "What happens when a payment fails twice?", "What happens when a shipment is delayed?"),
    (0, "What time zone are report dates shown in?", "What currency are report totals shown in?"),
    (0, "How long does a session stay valid before it expires?", "How many sessions can a user have at once?"),
    (0, "What is the minimum password length?", "What is the maximum password length?"),
    (0, "Can orders be cancelled after shipping?", "Can orders be cancelled before shipping?"),
    (0, "Does the search support wildcards?", "Does the search not support wildcards?"),
    (0, "Is the import file encrypted?", "Is the export file encrypted?"),
    (0, "Are uploads limited to 20 MB?", "Are uploads limited to 50 MB?"),
    (0, "Does the API return dates in ascending order?", "Does the API return dates in descending order?"),
    (0, "Is the setting enabled by default?", "Is the setting disabled by default?"),
    (0, "Which fields are required in the order form?", "Which fields are optional in the order form?"),
    (0, "Where are uploaded images stored?", "Where are uploaded videos stored?"),
    (0, "How are refunds approved?", "How are invoices numbered?"),
]
MODEL = packs.encoder(None)
H.check("the embedder is available for the tuning set", MODEL is not None)
scored = []
for lab, a, b in LABELLED:
    va, vb = packs.embed(MODEL, [a, b])
    scored.append((lab, sum(x * y for x, y in zip(va, vb)), a, b))


def prf(th, guard=True):
    pred = [(lab, (packs.is_duplicate(s, a, b, th) if guard else s >= th)) for lab, s, a, b in scored]
    tp = sum(1 for lab, p in pred if p and lab)
    fp = sum(1 for lab, p in pred if p and not lab)
    fn = sum(1 for lab, p in pred if not p and lab)
    return (tp / (tp + fp) if tp + fp else 1.0), (tp / (tp + fn) if tp + fn else 0.0)


grid = [round(0.80 + i * 0.01, 2) for i in range(20)]
ok = [(th, *prf(th)) for th in grid if prf(th)[0] >= 0.95]
TUNED = min(ok, key=lambda x: (-x[2], x[0]))[0] if ok else None
prec, rec = prf(packs.DEFAULT_THRESHOLD)
print(f"     tuning: {len(LABELLED)} labelled pairs; default {packs.DEFAULT_THRESHOLD}: precision {prec:.3f} "
      f"recall {rec:.3f}; best-recall threshold with precision >= 0.95: {TUNED}; "
      f"cosine alone at {packs.DEFAULT_THRESHOLD}: precision {prf(packs.DEFAULT_THRESHOLD, False)[0]:.3f}")
H.check("TUNING: the default threshold reaches precision >= 0.95 on the labelled set", prec >= 0.95, (prec, rec))
H.check("TUNING: ... with recall >= 0.8", rec >= 0.8, (prec, rec))
H.check("TUNING: the default is within the precision-safe band found by the sweep",
        TUNED is not None and TUNED <= packs.DEFAULT_THRESHOLD, TUNED)
H.check("TUNING: cosine alone is NOT enough (the contrast guard earns its place)",
        prf(packs.DEFAULT_THRESHOLD, guard=False)[0] < 0.95, prf(packs.DEFAULT_THRESHOLD, False))
H.check("contrast: numbers, negation and opposite pairs; none for paraphrases",
        packs.contrast("fails twice", "fails three times") == "numbers"
        and packs.contrast("does it support x", "does it not support x") == "negation"
        and packs.contrast("log in", "log out", ) is not None
        and packs.contrast("What happens when a payment fails twice?", "What happens if a payment fails two times?")
        is None)

QL = f"{P}/spec/questions:lookup"
r = c.post(QL, json={"text": "What is the maximum file size for uploads?"}, headers=AGENT)
H.check("LOOKUP: a new question is stored (201, Q-1, open) by an agent", r.status_code == 201
        and r.json()["question_id"] == "Q-1" and r.json()["status"] == "open" and r.json()["semantic"], r.text)
r = c.post(QL, json={"text": "What is the max size of an uploaded file?"}, headers=AGENT)
H.check("LOOKUP: a paraphrase is a duplicate of Q-1 (200, score >= 0.92)", r.status_code == 200
        and r.json()["duplicate_of"] == "Q-1" and r.json()["match"] == "semantic" and r.json()["score"] >= 0.92, r.text)
r = c.post(QL, json={"text": "What is the maximum file size for downloads?"}, headers=AGENT)
H.check("LOOKUP: a contrast question is stored as new (Q-2), the near miss listed", r.status_code == 201
        and r.json()["question_id"] == "Q-2" and r.json()["candidates"][0]["question_id"] == "Q-1", r.text)
r = c.post(QL, json={"text": "  what is the MAXIMUM file size for uploads  "}, headers=AGENT)
H.check("LOOKUP: an exact repeat (case, spacing) is a duplicate with score 1.0", r.status_code == 200
        and r.json()["duplicate_of"] == "Q-1" and r.json()["match"] == "exact", r.text)
r = c.post(QL, json={"text": "How are invoices numbered?", "store": False}, headers=AGENT)
H.check("LOOKUP: store=false only looks", r.status_code == 200 and r.json()["duplicate_of"] is None
        and len(c.get(f"{P}/spec/questions", headers=AGENT).json()["questions"]) == 2, r.text)
r = c.post(QL, json={"text": "x", "threshold": 0.5}, headers=AGENT)
H.check("LOOKUP: a threshold outside 0.80-0.99 is 422", r.status_code == 422, r.text)
H.check("LOOKUP: duplicates write kh.question_duplicate", len(kh_events("acme", "kh.question_duplicate")) == 2)
H.check("LOOKUP: the duplicate count is kept", c.get(f"{P}/spec/questions/Q-1", headers=AGENT).json()["asked_n"] == 3)
r = c.patch(f"{P}/spec/questions/Q-1", json={"answer": "20 MB per file.", "quote_id": "spec/limits.md#2#0"},
            headers={**ORCH, "If-Match": '"1"'})
H.check("an answer moves the question to answered, with a quote", r.status_code == 200
        and r.json()["status"] == "answered" and r.json()["quote_version"] == "v2.2", r.text)
r = c.patch(f"{P}/spec/questions/Q-1", json={"status": "closed"}, headers={**ORCH, "If-Match": '"1"'})
H.check("a stale If-Match on a question is 409", r.status_code == 409 and r.json()["error"] == "write_conflict", r.text)
r = c.patch(f"{P}/spec/questions/Q-1", json={"status": "closed"}, headers=AGENT)
H.check("an agent cannot answer or close (403)", r.status_code == 403, r.text)
r = c.post(QL, json={"text": "What's the max size of an uploaded file?"}, headers=AGENT)
H.check("an answered question still matches and returns its answer", r.status_code == 200
        and r.json()["duplicate_of"] == "Q-1" and r.json()["answer"] == "20 MB per file.", r.text)
c.patch(f"{P}/spec/questions/Q-2", json={"status": "closed"}, headers=ORCH)
r = c.post(QL, json={"text": "What is the maximum file size for downloads?"}, headers=AGENT)
H.check("a closed question does not count as a duplicate; its exact repeat reopens it", r.status_code == 201
        and r.json()["question_id"] == "Q-2" and r.json()["status"] == "open", r.text)

# Chroma 1.x raises 'Error creating hnsw segment reader: Nothing found on disk' from query() while a collection's
# first write is in flight (the flaky failure of this file: a lookup that raced it lost its semantic match and
# stored a true duplicate as a new question). query_vt now waits for the write to settle.
from app import vector_store as vs  # noqa: E402

UNSETTLED = "Error executing plan: Internal error: Error creating hnsw segment reader: Nothing found on disk"


class _Unsettled:
    def __init__(self, real, fails, exc=None):
        self.real, self.fails, self.calls, self.exc = real, fails, 0, exc

    def query(self, **kw):
        self.calls += 1
        if self.calls <= self.fails:
            raise self.exc or RuntimeError(UNSETTLED)
        return self.real.query(**kw)

    def __getattr__(self, name):
        return getattr(self.real, name)


QNAME = packs.questions_collection("acme")
real_q = vs.get_or_create(QNAME)
vs._named_collections[QNAME] = flaky = _Unsettled(real_q, 2)
r = c.post(QL, json={"text": "What is the max size of an uploaded file?"}, headers=AGENT)
H.check("UNSETTLED: a lookup during a first write still finds the paraphrase by meaning (query retried)",
        r.status_code == 200 and r.json()["duplicate_of"] == "Q-1" and r.json()["match"] == "semantic"
        and flaky.calls == 3, (flaky.calls, r.text))
vs._named_collections[QNAME] = flaky = _Unsettled(real_q, 99)
r = c.post(QL, json={"text": "What is the max size of an uploaded file?", "store": False}, headers=AGENT)
H.check("UNSETTLED: a collection that never settles costs a bounded retry, then degrades (semantic false)",
        r.status_code == 200 and r.json()["semantic"] is False and flaky.calls == vs.QUERY_SETTLE_TRIES, (flaky.calls, r.text))
vs._named_collections[QNAME] = flaky = _Unsettled(real_q, 1, ValueError("bad where"))
r = c.post(QL, json={"text": "What is the max size of an uploaded file?", "store": False}, headers=AGENT)
H.check("UNSETTLED: any other Chroma error is not retried", flaky.calls == 1 and r.json()["semantic"] is False,
        (flaky.calls, r.text))
vs._named_collections[QNAME] = real_q

# ── 8. redaction, fencing, If-Match policy, idempotency ──────────────────────
r = c.post(f"{P}/sec/versions", json={"project": "alpha", "parts": [{"path": "a.md", "text": "Contact ana.b@x.io now."}]},
           headers=ORCH)
t = c.get(f"{P}/sec?version=v1.0&text=true", headers=AGENT).json()["parts"][0]["text"]
H.check("REDACT: pack parts are masked before hashing and storage", "ana.b@x.io" not in t and "[REDACTED:email]" in t, t)
r = c.post(f"{P}/sec/versions/v1.0:freeze", headers=ORCH)
r = c.post(f"{P}/sec/assumptions", json={"text": "Mail ana.b@x.io for access"}, headers=ORCH)
H.check("REDACT: assumption texts are masked", "ana.b@x.io" not in r.text and "[REDACTED:email]" in r.json()["text"])
r = c.post(f"{P}/sec/questions:lookup", json={"text": "Should we mail ana.b@x.io?"}, headers=AGENT)
H.check("REDACT: question texts are masked", r.status_code == 201 and "ana.b@x.io" not in r.text, r.text)
H.check("REDACT: kh.redacted names the pack write paths",
        {e["where"].split("/")[0] for e in kh_events("acme", "kh.redacted")} == {"packs"}
        and len(kh_events("acme", "kh.redacted")) >= 3)

FP = "/v1/fence/packs"
r = c.post(f"{FP}/f/versions", json={"project": "alpha", "parts": [{"path": "a", "text": "b"}]}, headers=ORCH)
H.check("FENCE: a fenced namespace refuses a pack write without lease headers (428)", r.status_code == 428, r.text)
ep = c.post("/v1/fence/leases/packs:acquire", json={"ttl_s": 30}, headers=ORCH).json()["epoch"]
LEASE = {**ORCH, "X-KH-Lease": "packs", "X-KH-Epoch": str(ep)}
r = c.post(f"{FP}/f/versions", json={"project": "alpha", "parts": [{"path": "a", "text": "b"}]}, headers=LEASE)
H.check("FENCE: the lease holder uploads", r.status_code == 201, r.text)
r = c.post(f"{FP}/f/versions/v1.0:freeze", headers=LEASE)
H.check("require_if_match: a freeze without If-Match is 428", r.status_code == 428, r.text)
with sqldb.connect() as conn:
    conn.execute("UPDATE kh_lease SET until_ms=0 WHERE ns='fence' AND name='packs'")
c.post("/v1/fence/leases/packs:acquire", json={"ttl_s": 30}, headers=as_("o2", "orchestrator"))
r = c.post(f"{FP}/f/versions/v1.0:freeze", headers={**LEASE, "If-Match": '"1"'})
H.check("FENCE: a stale epoch is 409 stale_epoch and the version stays a draft", r.status_code == 409
        and r.json()["error"] == "stale_epoch" and c.get(f"{FP}/f", headers=AGENT).json()["state"] == "draft", r.text)
H.check("FENCE: ... and writes kh.stale_epoch", len(kh_events("fence", "kh.stale_epoch")) == 1)

IK = {**ORCH, "Idempotency-Key": "pack-upload-1"}
body = {"project": "alpha", "parts": [{"path": "a", "text": "idempotent"}]}
r1 = c.post(f"{P}/idem/versions", json=body, headers=IK)
r2 = c.post(f"{P}/idem/versions", json=body, headers=IK)
H.check("IDEM: a repeated Idempotency-Key replays the same version", r1.status_code == r2.status_code == 201
        and r2.headers.get("idempotent-replay") == "true" and r1.json()["version"] == r2.json()["version"] == "v1.0"
        and len(c.get(f"{P}/idem/versions", headers=AGENT).json()["versions"]) == 1, (r1.text, r2.text))
r3 = c.post(f"{P}/idem/versions", json={**body, "title": "other"}, headers=IK)
H.check("IDEM: another body under the same key is 422 idempotency_mismatch", r3.status_code == 422
        and r3.json()["error"] == "idempotency_mismatch", r3.text)

# ── 9. races ─────────────────────────────────────────────────────────────────
res = H.race(6, lambda i: c.post(f"{P}/race/versions", json={"project": "alpha", "parts": [
    {"path": "a", "text": f"draft {i}"}]}, headers=ORCH).json().get("version"))
H.check("RACE: concurrent uploads get distinct gapless versions", sorted(res) == [f"v{i}.0" for i in range(1, 7)], res)
res = H.race(6, lambda i: c.post(f"{P}/race/versions/v6.0:freeze", headers=ORCH).status_code)
H.check("RACE: one freeze wins, the rest are 409", sorted(res) == [200] + [409] * 5, res)
res = H.race(6, lambda i: c.post(f"{P}/race/assumptions", json={"text": f"a{i}"}, headers=ORCH).json().get("code"))
H.check("RACE: concurrent assumptions get distinct codes ASSUMED-1..6",
        sorted(res, key=lambda x: int(x.split("-")[1])) == [f"ASSUMED-{i}" for i in range(1, 7)], res)
res = H.race(6, lambda i: c.patch(f"{P}/race/assumptions/ASSUMED-1", json={"text": f"edit {i}"},
                                  headers={**ORCH, "If-Match": '"1"'}).status_code)
H.check("RACE: If-Match PATCH has one winner", sorted(res) == [200] + [409] * 5, res)
res = H.race(6, lambda i: c.post(f"{P}/race/questions:lookup", json={"text": "Which regions are supported?"},
                                 headers=AGENT).status_code)
qs = c.get(f"{P}/race/questions", headers=AGENT).json()["questions"]
H.check("RACE: the same question asked 6 times at once is stored once", sorted(res) == [200] * 5 + [201]
        and len(qs) == 1 and qs[0]["asked_n"] == 6, (res, qs))

# ── 9b. retrieval tier: the namespace /context/step reads frozen pack quotes ────
from types import SimpleNamespace  # noqa: E402
from app.caps import retrieval  # noqa: E402

H.check("packs registers itself as the 'packs' retrieval tier", retrieval.PROVIDERS.get("packs") is packs.retrieval_provider)
hits = packs.retrieval_provider(SimpleNamespace(ns="acme"), {"query": LIMITS_TXT[:120], "project": "alpha", "limit": 3})
H.check("the packs tier returns quotes of the latest frozen version, closest first",
        bool(hits) and all("@" in h["id"] and "#" in h["id"] and h["text"] for h in hits)
        and hits == sorted(hits, key=lambda h: -h["score"]), hits[:2])
H.check("the packs tier is empty for another project", packs.retrieval_provider(
    SimpleNamespace(ns="acme"), {"query": LIMITS_TXT[:120], "project": "zeta", "limit": 3}) == [])

# ── 10. purge hook and discovery ─────────────────────────────────────────────
caps = c.get("/v1/capabilities", headers=OWNER).json()["capabilities"]
H.check("discovery lists packs with its limits", any(x["name"] == "packs" and x["limits"]["duplicate_threshold"] == 0.92
                                                     for x in caps), caps)
with sqldb.connect() as conn:
    packs._on_state(conn, "cpol", "detached", "purged")
with sqldb.connect() as conn:
    left = sum(conn.execute(f"SELECT COUNT(*) FROM {t} WHERE ns='cpol'").fetchone()[0] for t in packs.TABLES)
    other = conn.execute("SELECT COUNT(*) FROM kh_pack WHERE ns='acme'").fetchone()[0]
H.check("purge removes every pack row of that namespace only", left == 0 and other > 0, (left, other))

H.done()
