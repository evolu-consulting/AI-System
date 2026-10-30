"""Contract test: app/caps/vault.py (stage F11, sealed vault).

  1. Declaration from the manifest; discovery; 404 vault_not_declared.
  2. Access: agent, judge, distiller, orchestrator, confirmer get 403 on EVERY vault route (even an undeclared
     vault); grader and namespace admin pass.
  3. Items: create (If-None-Match: *) with a KH canary khc-<16 hex> and custom strings, duplicate 409, input
     checks, canary_conflict 409, If-Match 409 write_conflict + kh.write_conflict, version vs rev, reads write
     kh.vault_read (ids only), Idempotency-Key replay, secret masking of vault bodies.
  4. Canary leak detection on every other write path (records, events, rules): stored masked, kh.canary_hit
     with vault/item and never the canary; custom strings; retired strings still detected; a canary minted on
     "another instance" (straight into SQL behind a warm cache) is still detected; unknown khc- is not.
  5. Isolation: holdout bodies and canaries never appear through events, records, rules, redaction:scan,
     manifest; export gives nothing without admin + include_vault.
  6. Rotation: :refresh (If-Match, idempotency), retired canaries still detected; refresh_due cron (one winner,
     vault.refresh_due event, refresh_due flag), expiry of retired canaries.
  7. Fencing: a fenced vault needs X-KH-Lease / X-KH-Epoch (428), stale epoch 409.
  8. RACES: concurrent create, concurrent last-writer-wins PUT (no lost revision), concurrent :refresh with
     If-Match, concurrent cron runs.
  9. Purge drops every vault row.

    .venv\\Scripts\\python tests\\caps\\test_vault.py
"""
from harness import H

import json
import re

from app import sqldb
from app.caps import core, vault
from app.caps.core import Caller

c = H.client()
OWNER = H.person("olga@x.io", owner=["alpha"])
CREATE = {"If-None-Match": "*"}


def as_(principal, role="agent"):
    return {**OWNER, "X-Test-Principal": principal, "X-Test-Role": role}


def _test_resolver(request, ns_row):
    p = request.headers.get("x-test-principal")
    if not p:
        return None
    return Caller(principal=p, role=request.headers.get("x-test-role", "agent"), kind="service")


core.CALLER_RESOLVERS.append(_test_resolver)

MANIFEST = {
    "types": [{"type": "note", "kind_of": "record", "index_fields": {"topic": "s"}},
              {"type": "tick", "kind_of": "event"}],
    "vaults": [{"vault_id": "holdout", "refresh_days": 30, "retire_days": 180},
               {"vault_id": "fenced_v", "fenced": True}]}
r = c.put("/v1/admin/ns/acme", json={"projects": ["alpha"]}, headers=OWNER)
H.check("namespace attached", r.status_code in (200, 201), r.text)
r = c.put("/v1/acme/manifest", headers=OWNER, json=MANIFEST)
H.check("manifest with vaults applied", r.status_code == 200, r.text)
r = c.get("/v1/capabilities", headers=OWNER)
H.check("vault is listed in discovery", any(x["name"] == "vault" for x in r.json()["capabilities"]), r.text)

GRADER = as_("g1", "grader")
AGENT = as_("a1", "agent")
V = "/v1/acme/vault/holdout"
HOLDOUT_TEXT = "HOLDOUT-QUESTION zeta-9271: which invoice ships first?"


def kh_events(kind, ns="acme"):
    with sqldb.connect() as conn:
        return [json.loads(r["body_json"]) for r in conn.execute(
            "SELECT body_json FROM kh_event WHERE ns=? AND kind=? ORDER BY seq", [ns, kind]).fetchall()]


# ── 1/2. declaration and access ──────────────────────────────────────────────
r = c.get("/v1/acme/vault", headers=GRADER)
H.check("grader lists declared vaults", r.status_code == 200 and {v["vault"] for v in r.json()["vaults"]}
        == {"holdout", "fenced_v"}, r.text)
r = c.get("/v1/acme/vault/nope/items", headers=GRADER)
H.check("undeclared vault: 404 vault_not_declared", r.status_code == 404 and r.json()["error"] == "vault_not_declared",
        r.text)

ROUTES = [("get", "/v1/acme/vault", None), ("get", V, None), ("get", V + "/items", None),
          ("get", V + "/items/x1", None), ("put", V + "/items/x1", {"body": {"q": 1}}),
          ("delete", V + "/items/x1", None), ("post", V + ":refresh", {}),
          ("get", "/v1/acme/vault/nope/items", None), ("put", "/v1/acme/vault/nope/items/x", {"body": 1})]
for role in ("agent", "judge", "distiller", "orchestrator", "confirmer"):
    codes = []
    for method, path, body in ROUTES:
        kw = {"headers": as_("p-" + role, role)}
        if body is not None:
            kw["json"] = body
        resp = getattr(c, method)(path, **kw)
        codes.append((path, resp.status_code, resp.json().get("error")))
    H.check(f"{role}: 403 forbidden on every vault route", all(s == 403 and e == "forbidden" for _, s, e in codes),
            codes)
r = c.get(V, headers=OWNER)
H.check("namespace admin reads the vault state", r.status_code == 200 and r.json()["refresh_due"] is False, r.text)

# ── 3. items ─────────────────────────────────────────────────────────────────
CUSTOM = ["custom-canary-alpha-001", "custom-canary-alpha-002"]
r = c.put(V + "/items/q1", json={"body": {"question": HOLDOUT_TEXT, "answer": "B"}, "canaries": CUSTOM},
          headers={**GRADER, **CREATE})
H.check("grader creates an item: 201 + ETag", r.status_code == 201 and r.headers.get("etag") == '"1"', r.text)
q1 = r.json()
kh1 = [x["canary"] for x in q1["canaries"] if x["kind"] == "kh"]
H.check("item has one KH canary khc-<16 hex>", len(kh1) == 1 and re.fullmatch(r"khc-[0-9a-f]{16}", kh1[0]), q1)
H.check("custom canaries kept", sorted(x["canary"] for x in q1["canaries"] if x["kind"] == "custom") == CUSTOM, q1)
H.check("PUT answer does not echo the body", "body" not in q1 and q1["version"] == 1, q1)
r = c.put(V + "/items/q1", json={"body": {"x": 1}}, headers={**GRADER, **CREATE})
H.check("create again: 409 duplicate", r.status_code == 409 and r.json()["error"] == "duplicate", r.text)
r = c.put(V + "/items/q2", json={"body": "two", "kh_canaries": 3}, headers={**OWNER, **CREATE})
H.check("admin creates with kh_canaries=3", r.status_code == 201 and
        sum(1 for x in r.json()["canaries"] if x["kind"] == "kh") == 3, r.text)
kh2 = [x["canary"] for x in r.json()["canaries"]]
bad = [({"body": 1, "canaries": ["short"]}, "short custom"),
       ({"body": 1, "canaries": ["x" * 257]}, "long custom"),
       ({"body": 1, "canaries": ["prefix khc-0123456789abcdef"]}, "KH format custom"),
       ({"body": 1, "canaries": [f"custom-many-{i:04d}" for i in range(21)]}, "21 custom"),
       ({"body": 1, "kh_canaries": 0}, "kh_canaries 0"), ({"nobody": 1}, "no body")]
for doc, what in bad:
    r = c.put(V + "/items/bad", json=doc, headers=GRADER)
    H.check(f"422 invalid: {what}", r.status_code == 422 and r.json()["error"] == "invalid", r.text)
r = c.put(V + "/items/bad%20id", json={"body": 1}, headers=GRADER)
H.check("bad item id: 422", r.status_code == 422, r.text)
r = c.put(V + "/items/q3", json={"body": 1, "canaries": [CUSTOM[0]]}, headers={**GRADER, **CREATE})
H.check("custom canary of another item: 409 canary_conflict",
        r.status_code == 409 and r.json()["error"] == "canary_conflict", r.text)
H.check("conflict rolled back (no q3)", c.get(V + "/items/q3", headers=GRADER).status_code == 404)

before = len(kh_events("kh.write_conflict"))
r = c.put(V + "/items/q1", json={"body": {"question": HOLDOUT_TEXT, "answer": "C"}, "canaries": CUSTOM},
          headers={**GRADER, "If-Match": '"9"'})
H.check("stale If-Match: 409 write_conflict", r.status_code == 409 and r.json()["error"] == "write_conflict", r.text)
H.check("kh.write_conflict written", len(kh_events("kh.write_conflict")) == before + 1)
r = c.put(V + "/items/q1", json={"body": {"question": HOLDOUT_TEXT, "answer": "C"}, "canaries": CUSTOM},
          headers={**GRADER, "If-Match": '"1"'})
H.check("If-Match update: version 2, rev 2", r.status_code == 200 and r.json()["version"] == 2
        and r.json()["rev"] == 2, r.text)
r = c.put(V + "/items/q1", json={"body": {"question": HOLDOUT_TEXT, "answer": "C"}}, headers=GRADER)
H.check("same body (no If-Match): rev 3, version stays 2, canaries kept",
        r.json()["rev"] == 3 and r.json()["version"] == 2 and len(r.json()["canaries"]) == 3, r.text)
r = c.put(V + "/items/q1", json={"body": {"question": HOLDOUT_TEXT, "answer": "C"}, "canaries": [CUSTOM[0]]},
          headers=GRADER)
H.check("custom list replaced: one custom left",
        [x["canary"] for x in r.json()["canaries"] if x["kind"] == "custom"] == [CUSTOM[0]], r.text)

reads_before = len(kh_events("kh.vault_read"))
r = c.get(V + "/items", headers=GRADER)
items = {i["item_id"]: i for i in r.json()["items"]}
H.check("grader reads items with bodies", r.status_code == 200 and items["q1"]["body"]["answer"] == "C"
        and set(items) == {"q1", "q2"}, r.text)
r = c.get(V + "/items?ids=q2", headers=GRADER)
H.check("?ids= filter", [i["item_id"] for i in r.json()["items"]] == ["q2"], r.text)
r = c.get(V + "/items/q1", headers=GRADER)
H.check("one item with ETag", r.status_code == 200 and r.headers.get("etag") == f'"{r.json()["rev"]}"', r.text)
vr = kh_events("kh.vault_read")
H.check("every read writes kh.vault_read", len(vr) == reads_before + 3, vr[-3:])
H.check("kh.vault_read has ids only (no body, no canary)",
        vr[-3]["item_ids"] == ["q1", "q2"] and HOLDOUT_TEXT not in json.dumps(vr) and kh1[0] not in json.dumps(vr), vr)

IK = {"Idempotency-Key": "vk-1"}
r1 = c.put(V + "/items/q4", json={"body": "four"}, headers={**GRADER, **IK, **CREATE})
r2 = c.put(V + "/items/q4", json={"body": "four"}, headers={**GRADER, **IK, **CREATE})
H.check("Idempotency-Key replay of a PUT", r1.status_code == r2.status_code == 201 and r1.json() == r2.json()
        and r2.headers.get("idempotent-replay") == "true", (r1.text, r2.text, dict(r2.headers)))
r = c.put(V + "/items/q4", json={"body": "five"}, headers={**GRADER, **IK})
H.check("same key, other body: 422 idempotency_mismatch", r.status_code == 422, r.text)

SECRET = "AKIA" + "ABCDEFGHIJKLMNOP"
r = c.put(V + "/items/q5", json={"body": {"note": f"key {SECRET}", "c": "custom-canary-q5-0001"},
                                 "canaries": ["custom-canary-q5-0001"]}, headers=GRADER)
got = c.get(V + "/items/q5", headers=GRADER).json()
H.check("vault body: secrets masked, its own canary text left alone",
        SECRET not in json.dumps(got) and "custom-canary-q5-0001" in got["body"]["c"], got)

# ── 4. canary leak detection elsewhere ───────────────────────────────────────
hits0 = len(kh_events("kh.canary_hit"))
r = c.put("/v1/acme/records/note/leak1?project=alpha", json={"topic": "t", "text": f"answer {kh1[0]} copied"},
          headers={**AGENT, **CREATE})
H.check("record with a KH canary is stored (flagged, not refused)", r.status_code == 201, r.text)
rec = c.get("/v1/acme/records/note/leak1", headers=AGENT).json()
H.check("record stored with the canary masked", kh1[0] not in json.dumps(rec) and "[REDACTED:canary]" in json.dumps(rec),
        rec)
hits = kh_events("kh.canary_hit")
H.check("kh.canary_hit names vault, item, principal", len(hits) == hits0 + 1 and hits[-1]["vault"] == "holdout"
        and hits[-1]["item"] == "q1" and hits[-1]["principal"] == "a1" and hits[-1]["canary_kind"] == "kh", hits[-1:])
H.check("kh.canary_hit never carries the canary", kh1[0] not in json.dumps(hits), hits[-1])
r = c.post("/v1/acme/events", json={"kind": "tick", "body": {"msg": f"x {CUSTOM[0]} y"}},
           headers={**AGENT, "X-KH-Run": "run-7"})
H.check("event with a custom canary accepted", r.status_code == 200 and r.json()["accepted"], r.text)
with sqldb.connect() as conn:
    ev = conn.execute("SELECT body_json FROM kh_event WHERE ns='acme' AND kind='tick' ORDER BY seq DESC").fetchone()
H.check("event stored masked", CUSTOM[0] not in ev["body_json"] and "[REDACTED:canary]" in ev["body_json"], ev[0])
hits = kh_events("kh.canary_hit")
H.check("custom hit: kind custom, run_id stamped", hits[-1]["canary_kind"] == "custom" and hits[-1]["run_id"] == "run-7"
        and hits[-1]["retired"] is False, hits[-1])
r = c.put("/v1/acme/rules/r1", json={"project": "alpha", "entity": "Order", "attribute": "s", "condition": "",
                                     "effect": "e", "source_text": f"leaked {kh2[1]}"}, headers={**AGENT, **CREATE})
H.check("rule with a canary stored", r.status_code in (200, 201), r.text)
H.check("rule source_text masked + hit on q2", kh2[1] not in c.get("/v1/acme/rules/r1", headers=AGENT).text
        and kh_events("kh.canary_hit")[-1]["item"] == "q2", kh_events("kh.canary_hit")[-1])
n = len(kh_events("kh.canary_hit"))
c.post("/v1/acme/events", json={"kind": "tick", "body": {"msg": f"x {CUSTOM[1]} y"}}, headers=AGENT)
H.check("retired custom string still detected (retired=true)", len(kh_events("kh.canary_hit")) == n + 1
        and kh_events("kh.canary_hit")[-1]["retired"] is True, kh_events("kh.canary_hit")[-1:])
vault.scan("acme", "warm the cache")
OTHER = "khc-00112233aabbccdd"
with sqldb.connect() as conn:
    conn.execute("INSERT INTO kh_vault_canary (ns, canary, vault_id, item_id, kind, state, created_ms) VALUES "
                 "('acme', ?, 'holdout', 'q2', 'kh', 'active', 0)", [OTHER])
H.check("KH canary minted on another instance: found behind a warm cache",
        [h["item"] for h in vault.scan("acme", f"a {OTHER} b")] == ["q2"])
H.check("unknown khc- string is not a hit", vault.scan("acme", "khc-ffffffffffffffff") == [])
H.check("other namespace: no hit", vault.scan("other", f"{kh1[0]}") == [])

# ── 5. isolation ─────────────────────────────────────────────────────────────
secrets_all = [HOLDOUT_TEXT, "zeta-9271", kh1[0], CUSTOM[0], CUSTOM[1], kh2[0]]
c.put("/v1/acme/records/note/clean?project=alpha", json={"topic": "zeta", "text": "plain"}, headers=AGENT)
probes = {
    "events read": c.get("/v1/acme/events?after_seq=0&limit=1000", headers=OWNER),
    "events stats": c.get("/v1/acme/events:stats?group_by=kind", headers=OWNER),
    "records query": c.post("/v1/acme/records/note:query", json={}, headers=OWNER),
    "records query (zeta)": c.post("/v1/acme/records/note:query", json={"where": {"topic": "zeta"}}, headers=OWNER),
    "rules list": c.get("/v1/acme/rules?project=alpha", headers=OWNER),
    "rules query": c.post("/v1/acme/rules:query", json={"project": "alpha", "entities": ["Order"]}, headers=OWNER),
    "manifest": c.get("/v1/acme/manifest", headers=OWNER),
}
for name, resp in probes.items():
    H.check(f"isolation: {name} answers without vault content",
            resp.status_code < 500 and not any(s in resp.text for s in secrets_all), (resp.status_code, resp.text[:300]))
H.check("isolation: the probes really returned data", probes["records query"].status_code == 200
        and "leak1" in probes["records query"].text and probes["events read"].status_code == 200, probes["records query"].text)
r = c.post("/v1/acme/redaction:scan", json={"text": f"{kh1[0]} and {CUSTOM[0]}"}, headers=OWNER)
H.check("redaction:scan is not a canary oracle (no vault/item, no canary finding)",
        r.status_code == 200 and "holdout" not in r.text and "canary" not in json.dumps(r.json()["findings"]), r.text)
with sqldb.connect() as conn:
    leaked = [t for t in ("kh_event", "kh_record") if any(
        any(s in (row[0] or "") for s in secrets_all)
        for row in conn.execute(f"SELECT body_json FROM {t} WHERE ns='acme'").fetchall())]
H.check("isolation: no vault text or canary in kh_event / kh_record rows", leaked == [], leaked)
H.check("export leaves the vault out", vault.export_rows("acme") == {}
        and vault.export_rows("acme", include_vault=True) == {} and vault.export_rows("acme", True, is_admin=False) == {})
H.check("export with admin + include_vault=true has it", len(vault.export_rows("acme", True, True)["kh_vault_item"]) >= 4)

# ── 6. rotation ──────────────────────────────────────────────────────────────
st = c.get(V, headers=GRADER)
rev = st.json()["rev"]
r = c.post(V + ":refresh", json={}, headers={**GRADER, "If-Match": f'"{rev + 5}"'})
H.check(":refresh with stale If-Match: 409 write_conflict", r.status_code == 409 and r.json()["error"] == "write_conflict",
        r.text)
r = c.post(V + ":refresh", json={}, headers={**GRADER, "If-Match": f'"{rev}"', "Idempotency-Key": "rf-1"})
H.check(":refresh rotates every item's KH canaries", r.status_code == 200 and r.json()["items"] == 4
        and r.json()["canaries_minted"] == r.json()["canaries_retired"] == 7, r.text)
out = r.json()
r2 = c.post(V + ":refresh", json={}, headers={**GRADER, "If-Match": f'"{rev}"', "Idempotency-Key": "rf-1"})
H.check(":refresh replay: same answer, no second rotation", r2.json() == out
        and c.get(V, headers=GRADER).json()["refresh_count"] == 1, r2.text)
new1 = [x["canary"] for x in c.get(V + "/items/q1", headers=GRADER).json()["canaries"] if x["kind"] == "kh"]
H.check("q1 has a new KH canary", len(new1) == 1 and new1[0] != kh1[0], new1)
H.check("old KH canary still detected as retired", [(h["item"], h["retired"]) for h in vault.scan("acme", kh1[0])]
        == [("q1", True)])
H.check("new KH canary detected as active", [(h["item"], h["retired"]) for h in vault.scan("acme", new1[0])]
        == [("q1", False)])

H.check("cron: nothing due yet", vault.refresh_due()["refreshed"] == [])
with sqldb.connect() as conn:
    conn.execute("UPDATE kh_vault SET next_due_ms=1 WHERE ns='acme' AND vault_id='holdout'")
H.check("vault reports refresh_due", c.get(V, headers=GRADER).json()["refresh_due"] is True)
due_before = len(kh_events("vault.refresh_due"))
res = H.race(4, lambda i: vault.refresh_due()["refreshed"])
H.check("RACE cron: one instance rotates the due vault", sorted(sum(res, [])) == ["acme/holdout"], res)
ev = kh_events("vault.refresh_due")
H.check("vault.refresh_due event written once", len(ev) == due_before + 1 and ev[-1]["vault"] == "holdout"
        and ev[-1]["items"] == 4 and ev[-1]["reason"] == "schedule", ev[-1:])
H.check("refresh_due cleared, next due in 30 days", c.get(V, headers=GRADER).json()["refresh_due"] is False)
FAR = sqldb.now_ms(sqldb.connect()) + 400 * vault.DAY_MS
res = vault.refresh_due(now_override=FAR)
H.check("retired canaries forgotten after retire_days", res["expired_canaries"] > 0 and vault.scan("acme", kh1[0]) == [],
        res)

# ── 7. fencing ───────────────────────────────────────────────────────────────
F = "/v1/acme/vault/fenced_v/items/f1"
r = c.put(F, json={"body": 1}, headers=GRADER)
H.check("fenced vault without lease headers: 428", r.status_code == 428, r.text)
lease = c.post("/v1/acme/leases/vault-writer:acquire", json={"ttl_s": 30}, headers=GRADER).json()
epoch = lease.get("epoch")
r = c.put(F, json={"body": 1}, headers={**GRADER, "X-KH-Lease": "vault-writer", "X-KH-Epoch": str(epoch)})
H.check("fenced vault with the current epoch: 201", r.status_code == 201, (lease, r.text))
r = c.put(F, json={"body": 2}, headers={**GRADER, "X-KH-Lease": "vault-writer", "X-KH-Epoch": str(epoch + 1)})
H.check("stale epoch: 409 stale_epoch, write rolled back", r.status_code == 409 and r.json()["error"] == "stale_epoch"
        and c.get(F, headers=GRADER).json()["body"] == 1, r.text)

# ── 8. races ─────────────────────────────────────────────────────────────────
res = H.race(6, lambda i: c.put(V + "/items/race1", json={"body": i}, headers={**GRADER, **CREATE}).status_code)
H.check("RACE create: one 201, five 409", sorted(res) == [201] + [409] * 5, res)
res = H.race(6, lambda i: c.put(V + "/items/race1", json={"body": f"v{i}"}, headers=GRADER).json().get("rev"))
H.check("RACE last-writer-wins PUT: no lost revision", sorted(res) == [2, 3, 4, 5, 6, 7], res)
H.check("RACE: final rev 7, version 7", c.get(V + "/items/race1", headers=GRADER).json()["rev"] == 7)
rev = c.get(V, headers=GRADER).json()["rev"]
res = H.race(4, lambda i: c.post(V + ":refresh", json={}, headers={**GRADER, "If-Match": f'"{rev}"'}).status_code)
H.check("RACE :refresh with If-Match: one 200, three 409", sorted(res) == [200, 409, 409, 409], res)
with sqldb.connect() as conn:
    multi = conn.execute("SELECT item_id, COUNT(*) FROM kh_vault_canary WHERE ns='acme' AND vault_id='holdout' AND "
                         "kind='kh' AND state='active' GROUP BY item_id").fetchall()
H.check("RACE: each item keeps its KH canary count (q2 has 3 + the injected one rotated)",
        {r[0]: r[1] for r in multi}.get("q1") == 1 and {r[0]: r[1] for r in multi}.get("race1") == 1,
        [tuple(r) for r in multi])

# ── delete ───────────────────────────────────────────────────────────────────
can = [x["canary"] for x in c.get(V + "/items/q4", headers=GRADER).json()["canaries"]][0]
r = c.delete(V + "/items/q4", headers={**GRADER, "If-Match": '"999"'})
H.check("delete with stale If-Match: 409", r.status_code == 409, r.text)
r = c.delete(V + "/items/q4", headers=GRADER)
H.check("delete: canaries retired", r.status_code == 200 and r.json()["canaries_retired"] == 1, r.text)
H.check("deleted item: 404, its canary still detected", c.get(V + "/items/q4", headers=GRADER).status_code == 404
        and vault.scan("acme", can)[0]["retired"] is True)

# ── 9. purge ─────────────────────────────────────────────────────────────────
with sqldb.connect() as conn:
    vault._on_state(conn, "acme", "detached", "purged")
with sqldb.connect() as conn:
    left = sum(conn.execute(f"SELECT COUNT(*) FROM {t} WHERE ns='acme'").fetchone()[0]
               for t in ("kh_vault", "kh_vault_item", "kh_vault_canary"))
H.check("purge drops every vault row", left == 0, left)
H.check("purged canaries are no longer detected", vault.scan("acme", new1[0]) == [])

H.done()
