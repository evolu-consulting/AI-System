"""Contract test: app/caps/lifecycle.py (stage F13) - detach, re-attach, export, import, purge, retention.

  1. Export: streamed zip with manifest.json (module versions, migrations), NDJSON per table filtered by ns
     (no ns column), the counters, _kh rollups, vectors as text + metadata (no embeddings), checksums.json;
     vault tables only with include_vault=true; non-owners 403; the generator yields many small chunks.
  2. Detach: every lease epoch+1 with holder NULL, principals suspended, pending outbox rows dead, every
     /v1/{ns} route 404 (also on a second instance's stale cache within KH_NS_CACHE_S).
  3. Re-attach within grace -> active, an old epoch is refused (stale_epoch); past grace -> 409.
  4. Purge: 428 without a token, 409 when not detached, 200 with the token of a completed export; every row,
     counter, vector collection and graph directory of the namespace is gone; kh.ns_state lands in _kh.
     RACE: two purges -> one 200, one 409.
  5. Import into the purged id and into a new id: row counts and sha256 per file equal, vectors re-embedded,
     the namespace arrives detached and serves after :reattach; a re-export is byte-identical per table;
     a dirty target 409, a tampered archive 422, a non-owner 403. RACE: two imports -> one 201.
  6. Retention: expired events -> kh_event_week and deleted, typed retention and null (keep) honoured,
     detached namespaces skipped; RACE: 4 concurrent sweeps count every event exactly once. Grace cron.

    .venv\\Scripts\\python tests\\caps\\test_lifecycle.py
"""
from harness import H

import io
import json
import os
import time
import zipfile

from app import config, sqldb
from app.caps import core, lifecycle, registry
from app.caps.core import Caller

c = H.client()
OWNER = H.person("olga@x.io", owner=["alpha"])
STRANGER = H.person("sam@x.io", member=["alpha"])
CREATE = {"If-None-Match": "*"}
DAY = 86400000


class FakeModel:
    """A deterministic 8-dim 'embedder' so the import can re-embed without the real model."""

    def encode(self, texts, normalize_embeddings=True, **kw):  # noqa: ARG002
        out = []
        for t in texts:
            v = [float((sum(map(ord, t)) * (i + 3)) % 97 + 1) for i in range(8)]
            n = sum(x * x for x in v) ** 0.5
            out.append([x / n for x in v])
        return out


c.app.state.model = FakeModel()


def _test_resolver(request, ns_row):
    p = request.headers.get("x-test-principal")
    return Caller(principal=p, role=request.headers.get("x-test-role", "agent"), kind="service") if p else None


core.CALLER_RESOLVERS.append(_test_resolver)


def as_(principal, role="agent", **extra):
    return {**OWNER, "X-Test-Principal": principal, "X-Test-Role": role, **extra}


def count(table, ns):
    with sqldb.connect() as conn:
        return int(conn.execute(f"SELECT COUNT(*) FROM {table} WHERE ns=?", [ns]).fetchone()[0])


def rows_of(ns):
    """{table: count} over every discovered table (except kh_ns) - what a purge must empty."""
    return {t["table"]: count(t["table"], ns) for t in lifecycle.discover() if t["table"] != "kh_ns"}


MANIFEST = {
    "types": [{"type": "note", "kind_of": "record", "index_fields": {"topic": "s"}},
              {"type": "tick", "kind_of": "event", "retention_days": 30},
              {"type": "keep", "kind_of": "event", "retention_days": None}],
    "vaults": [{"vault_id": "holdout", "refresh_days": 30}]}


def setup_ns(ns):
    r = c.put(f"/v1/admin/ns/{ns}", json={"projects": ["alpha"]}, headers=OWNER)
    assert r.status_code in (200, 201), r.text
    r = c.put(f"/v1/{ns}/manifest", json=MANIFEST, headers=OWNER)
    assert r.status_code == 200, r.text


def fill(ns, n_events=5):
    for i in range(3):
        r = c.put(f"/v1/{ns}/records/note/n{i}?project=alpha", json={"topic": f"t{i}", "text": f"note {i} ü"},
                  headers={**as_("a1"), **CREATE})
        assert r.status_code == 201, r.text
    r = c.post(f"/v1/{ns}/events", json={"events": [{"kind": "tick", "project": "alpha", "body": {"i": i}}
                                                    for i in range(n_events)]}, headers=as_("a1"))
    assert r.status_code == 200, r.text
    r = c.put(f"/v1/{ns}/vault/holdout/items/q1", json={"body": {"question": "sealed?", "answer": "yes"}},
              headers={**OWNER, **CREATE})
    assert r.status_code in (200, 201), r.text
    from app import vector_store as vs
    coll = vs.get_or_create(f"ns_{ns}_test")
    for i in range(3):
        vs.upsert_vt(f"v{i}", FakeModel().encode([f"text {i}"])[0], f"text {i}", {"ns": ns, "k": i}, coll)


def unzip(content):
    return zipfile.ZipFile(io.BytesIO(content))


setup_ns("acme")
fill("acme", n_events=5)
r = c.post("/v1/acme/leases/unit/1:acquire", json={"ttl_s": 60}, headers=as_("a1"))
H.check("lease acquired before detach", r.status_code == 200, r.text)
OLD_EPOCH = r.json()["epoch"]

# ── 1. export ────────────────────────────────────────────────────────────────
r = c.get("/v1/admin/ns/acme:export", headers=OWNER)
H.check("export is 200 application/zip with export id and token headers", r.status_code == 200
        and r.headers["content-type"] == "application/zip" and r.headers.get("x-kh-export-token")
        and r.headers.get("x-kh-export-id"), r.text[:300])
EXPORT1, TOKEN1 = r.content, r.headers["x-kh-export-token"]
z = unzip(EXPORT1)
names = set(z.namelist())
man = json.loads(z.read("manifest.json"))
sums = json.loads(z.read("checksums.json"))["files"]
H.check("manifest: format, ns, module versions with migrations, namespace row", man["format"] == lifecycle.FORMAT
        and man["ns"] == "acme" and man["modules"]["records"]["migrations"] == [1]
        and man["modules"]["registry"]["version"] and json.loads(man["namespace"]["manifest_json"])["types"], man.keys())
H.check("checksums.json covers every file and each sha256 is right",
        names - {"checksums.json"} == set(sums) and all(
            __import__("hashlib").sha256(z.read(n)).hexdigest() == sums[n]["sha256"] for n in sums), sorted(names))
H.check("one NDJSON per table: records, events, types, schemas-of-registry, leases, counters",
        {"tables/kh_record.ndjson", "tables/kh_event.ndjson", "tables/kh_type.ndjson", "tables/kh_lease.ndjson",
         "tables/kh_counter.ndjson", "tables/kh_record_rev.ndjson"} <= names, sorted(names))
H.check("weekly rollups travel under _kh/", "_kh/kh_event_week.ndjson" in names, sorted(names))
recs = [json.loads(x) for x in z.read("tables/kh_record.ndjson").splitlines()]
H.check("rows are filtered by ns, carry no ns column and are in key order",
        len(recs) == count("kh_record", "acme") == 3 and all("ns" not in x for x in recs)
        and [x["id"] for x in recs] == ["n0", "n1", "n2"] and "note 0 ü" in recs[0]["body_json"], recs[:1])
H.check("row counts in checksums.json equal the table", sums["tables/kh_event.ndjson"]["rows"] == count("kh_event", "acme"),
        sums["tables/kh_event.ndjson"])
ctr = [json.loads(x) for x in z.read("tables/kh_counter.ndjson").splitlines()]
H.check("counters are exported with the ns as {ns}", {"name": "ev:{ns}", "n": 5} in ctr, ctr)
vec = [json.loads(x) for x in z.read("vectors/test.ndjson").splitlines()]
H.check("vectors: id, text and metadata only (no embedding, no stamp)", len(vec) == 3 and vec[0] == {
    "id": "v0", "text": "text 0", "metadata": {"k": 0, "ns": "{ns}"}}, vec[:1])
H.check("vault tables are left out by default", not any("vault" in n for n in names), sorted(names))
r = c.get("/v1/admin/ns/acme:export?include_vault=true", headers=OWNER)
EXPORT_V = r.content
zv = unzip(EXPORT_V)
H.check("include_vault=true by the admin adds the vault tables", {"tables/kh_vault.ndjson", "tables/kh_vault_item.ndjson",
                                                                  "tables/kh_vault_canary.ndjson"} <= set(zv.namelist()))
H.check("... and records kh.vault_read", count("kh_event", "acme") > 0 and sqldb.connect().execute(
    "SELECT COUNT(*) FROM kh_event WHERE ns='acme' AND kind='kh.vault_read'").fetchone()[0] == 1)
r = c.get("/v1/admin/ns/acme:export", headers=STRANGER)
H.check("a non-owner cannot export (403)", r.status_code == 403, r.text)
r = c.get("/v1/admin/ns/acme", headers=OWNER)
H.check("GET /v1/admin/ns/{ns} still answers next to :export", r.status_code == 200 and r.json()["ns"] == "acme", r.text)
# streaming: a namespace with many rows comes out in many bounded chunks
setup_ns("bulk")
r = c.post("/v1/bulk/events", json={"events": [{"kind": "tick", "project": "alpha", "body": {"pad": os.urandom(400).hex(),
                                                                                           "i": i}}
                                               for i in range(500)]}, headers=as_("a1"))
plan = lifecycle.plan_export("bulk", False, None)
sizes = [len(b) for b in lifecycle.export_chunks(plan)]
H.check("export streams: many chunks, none much larger than the buffer", len(sizes) > 3
        and max(sizes) < lifecycle.CHUNK * 2, (len(sizes), max(sizes)))

# ── 2. detach ────────────────────────────────────────────────────────────────
with sqldb.connect() as conn:
    conn.execute("INSERT INTO kh_principal (ns, principal_id, role, on_behalf_of, projects_json, state, created_by, "
                 "created_ms, rev) VALUES ('acme','p-1','agent','olga@x.io','[]','active','olga@x.io',0,1)")
    ob_cols = lifecycle._columns(conn, "kh_outbox")[0]
    if ob_cols:
        info = conn.execute("PRAGMA table_info(kh_outbox)").fetchall() if not sqldb.is_hana() else [
            (0, r[0].lower(), r[1], r[2] == "FALSE", r[3]) for r in conn.execute(
                "SELECT COLUMN_NAME, DATA_TYPE_NAME, IS_NULLABLE, DEFAULT_VALUE FROM SYS.TABLE_COLUMNS "
                "WHERE SCHEMA_NAME=CURRENT_SCHEMA AND TABLE_NAME='KH_OUTBOX' ORDER BY POSITION").fetchall()]
        row = {r[1]: (0 if "INT" in (r[2] or "").upper() else "x") for r in info if r[3] and r[4] is None}
        row.update(ns="acme", delivery_id="d1", state="pending")
        conn.execute(f"INSERT INTO kh_outbox ({', '.join(row)}) VALUES ({', '.join('?' for _ in row)})", list(row.values()))
r = c.get("/v1/acme/records/note/n0", headers=as_("a1"))
H.check("before detach the namespace serves", r.status_code == 200, r.text)
stale = registry.ns_state("acme")                     # what a second instance has cached
r = c.post("/v1/admin/ns/acme:detach", headers=OWNER)
H.check("detach is 200, state detached, purge_after = now + grace", r.status_code == 200 and r.json()["state"] == "detached"
        and r.json()["purge_after_ms"] - r.json()["detached_ms"] == registry.GRACE_DAYS * DAY, r.text)
with sqldb.connect() as conn:
    lease = dict(conn.execute("SELECT holder, epoch FROM kh_lease WHERE ns='acme' AND name='unit/1'").fetchone())
    pstate = conn.execute("SELECT state FROM kh_principal WHERE ns='acme' AND principal_id='p-1'").fetchone()[0]
    ostate = conn.execute("SELECT state FROM kh_outbox WHERE ns='acme' AND delivery_id='d1'").fetchone()[0] \
        if ob_cols else "dead"
H.check("every lease: epoch+1 and holder NULL", lease == {"holder": None, "epoch": OLD_EPOCH + 1}, lease)
H.check("principals are suspended", pstate == "suspended", pstate)
H.check("pending outbox rows are dead", ostate == "dead", ostate)
H.check("every /v1/{ns} route answers 404 ns_not_active", all(
    x.status_code == 404 and x.json()["error"] == "ns_not_active" for x in (
        c.get("/v1/acme/records/note/n0", headers=as_("a1")), c.get("/v1/acme/manifest", headers=OWNER),
        c.post("/v1/acme/events", json={"kind": "tick", "body": {}}, headers=as_("a1")),
        c.get("/v1/acme/vault/holdout/items", headers=OWNER))))
registry._cache[(sqldb.location(), "acme")] = (time.monotonic() + registry.CACHE_S, stale)   # a stale instance
first = c.get("/v1/acme/records/note/n0", headers=as_("a1")).status_code
time.sleep(registry.CACHE_S + 0.2)
later = c.get("/v1/acme/records/note/n0", headers=as_("a1")).status_code
H.check(f"a second instance's cache answers 404 within KH_NS_CACHE_S ({registry.CACHE_S}s <= 5 s)",
        first == 200 and later == 404 and registry.CACHE_S <= 5, (first, later))
r = c.get("/v1/admin/ns/acme:export", headers=OWNER)
H.check("export is allowed while detached", r.status_code == 200 and "tables/kh_record.ndjson" in unzip(r.content).namelist())
TOKEN2 = r.headers["x-kh-export-token"]

# ── 3. re-attach ─────────────────────────────────────────────────────────────
r = c.post("/v1/admin/ns/acme:reattach", headers=OWNER)
H.check("re-attach within grace -> active", r.status_code == 200 and r.json()["state"] == "active", r.text)
r = c.post("/v1/acme/events", json={"kind": "tick", "project": "alpha", "body": {}},
           headers={**as_("a1"), "X-KH-Lease": "unit/1", "X-KH-Epoch": str(OLD_EPOCH)})
H.check("an old epoch is refused after re-attach (409 stale_epoch)", r.status_code == 409
        and r.json()["error"] == "stale_epoch", r.text)
r = c.post("/v1/acme/leases/unit/1:acquire", json={"ttl_s": 60}, headers=as_("a1"))
H.check("leases resume above the detach epoch (acquire again)", r.status_code == 200 and r.json()["epoch"] > OLD_EPOCH + 1,
        r.text)
with sqldb.connect() as conn:
    pstate = conn.execute("SELECT state FROM kh_principal WHERE ns='acme' AND principal_id='p-1'").fetchone()[0]
H.check("principals stay suspended after re-attach", pstate == "suspended", pstate)
c.post("/v1/admin/ns/acme:detach", headers=OWNER)
with sqldb.connect() as conn:
    conn.execute("UPDATE kh_ns SET purge_after_ms=1 WHERE ns='acme'")
r = c.post("/v1/admin/ns/acme:reattach", headers=OWNER)
H.check("re-attach past grace is 409 invalid_transition", r.status_code == 409 and r.json()["error"] == "invalid_transition",
        r.text)
with sqldb.connect() as conn:
    conn.execute(f"UPDATE kh_ns SET purge_after_ms={sqldb.now_ms(conn) + DAY} WHERE ns='acme'")

# ── 4. purge ─────────────────────────────────────────────────────────────────
GRAPH_DIR = os.path.join(config.KUZU_PROJECTS_PATH, "acme__alpha")
ON_HANA_GRAPH = config.GRAPH_BACKEND == "hana"


def hana_graph_tables() -> int:
    from app.graph_db.hana_adapter import project_prefix
    with sqldb.connect() as conn:
        return len(conn.execute("SELECT TABLE_NAME FROM SYS.TABLES WHERE SCHEMA_NAME=CURRENT_SCHEMA AND TABLE_NAME "
                                "LIKE ?", [project_prefix("acme__alpha") + "%"]).fetchall())


if ON_HANA_GRAPH:                                       # a real project graph: prefixed tables in the schema
    from app.graph_db.project_graph import get_project_graph
    get_project_graph("acme__alpha")
    assert hana_graph_tables() >= 2
else:
    os.makedirs(GRAPH_DIR, exist_ok=True)
r = c.post("/v1/admin/ns/acme:purge", headers=OWNER)
H.check("purge without a token is 428", r.status_code == 428 and r.json()["error"] == "precondition_required", r.text)
r = c.post("/v1/admin/ns/acme:purge", json={"confirm": "nope"}, headers=OWNER)
H.check("purge with an unknown token is 428", r.status_code == 428, r.text)
r = c.post("/v1/admin/ns/bulk:purge?force=true", headers=OWNER)
H.check("purge of an attached namespace is 409", r.status_code == 409 and r.json()["error"] == "invalid_transition", r.text)
r = c.post("/v1/admin/ns/acme:purge", json={"confirm": TOKEN2}, headers=STRANGER)
H.check("a non-owner cannot purge (403)", r.status_code == 403, r.text)
before = rows_of("acme")
r = c.post("/v1/admin/ns/acme:purge", json={"confirm": TOKEN2}, headers=OWNER)
H.check("purge with the token of a completed export is 200", r.status_code == 200 and r.json()["purged"] is True, r.text)
after = rows_of("acme")
H.check("every row of the namespace is gone (batched, every module's TABLES)",
        sum(before.values()) > 20 and not any(after.values()), {k: v for k, v in after.items() if v})
with sqldb.connect() as conn:
    H.check("its counters are gone", lifecycle._counter_names(conn, "acme") == [])
    st = dict(conn.execute("SELECT state, purge_after_ms, manifest_json FROM kh_ns WHERE ns='acme'").fetchone())
    audit = [json.loads(x[0]) for x in conn.execute(
        "SELECT body_json FROM kh_event WHERE ns='_kh' AND kind='kh.ns_state'").fetchall()]
H.check("kh_ns is a purged tombstone (no manifest, purge finished)", st == {"state": "purged", "purge_after_ms": None,
                                                                          "manifest_json": None}, st)
H.check("vector collections ns_acme_* and graph dbs acme__* are dropped", lifecycle._collections("acme") == []
        and (hana_graph_tables() == 0 and "acme__alpha" in r.json()["graphs"] if ON_HANA_GRAPH
             else not os.path.isdir(GRAPH_DIR)) and "ns_acme_test" in r.json()["collections"], r.json())
H.check("kh.ns_state 'purged' is written to the _kh audit namespace", any(
    a.get("ns") == "acme" and a.get("to") == "purged" and a.get("export_id") for a in audit), audit[-1:])
H.check("export of a purged namespace is 404", c.get("/v1/admin/ns/acme:export", headers=OWNER).status_code == 404)
H.check("re-attach of a purged namespace is refused", c.post("/v1/admin/ns/acme:reattach", headers=OWNER).status_code in (409, 422))
setup_ns("racy")
c.post("/v1/admin/ns/racy:detach", headers=OWNER)
res = H.race(2, lambda i: c.post("/v1/admin/ns/racy:purge?force=true", headers=OWNER).status_code)
H.check("RACE: two purges -> one 200, one 409", sorted(res) == [200, 409], res)
# a finished purge frees the id: attaching it again is a fresh attach (as :import already treats it)
r = c.put("/v1/admin/ns/racy", json={"projects": ["alpha"], "display": "second life"}, headers=STRANGER)
H.check("re-attach of a purged id still needs the project owner (403)", r.status_code == 403, r.text)
r = c.put("/v1/admin/ns/racy", json={"projects": ["alpha"], "display": "second life"}, headers=OWNER)
H.check("PUT on a finished purge tombstone is a fresh attach: 201 active, manifest empty, new client",
        r.status_code == 201 and r.json()["state"] == "active" and r.json()["manifest_rev"] == 0
        and r.json()["display"] == "second life" and (r.json().get("client") or {}).get("client_secret"), r.text)
r = c.put("/v1/racy/manifest", json=MANIFEST, headers=OWNER)
H.check("... and the namespace serves again (manifest rev 1)", r.status_code == 200 and r.json()["manifest_rev"] == 1,
        r.text)
r = c.put("/v1/admin/ns/racy", json={"projects": ["alpha"]}, headers=OWNER)
H.check("a second PUT is the usual update (200)", r.status_code == 200, r.text)
setup_ns("midpurge")
with sqldb.connect() as conn:
    conn.execute("UPDATE kh_ns SET state='purged', purge_after_ms=1 WHERE ns='midpurge'")   # purge still running
r = c.put("/v1/admin/ns/midpurge", json={"projects": ["alpha"]}, headers=OWNER)
H.check("PUT while a purge is still running is 409 invalid_transition", r.status_code == 409
        and r.json()["error"] == "invalid_transition", r.text)
with sqldb.connect() as conn:
    conn.execute("UPDATE kh_ns SET state='detached', purge_after_ms=? WHERE ns='midpurge'", [sqldb.now_ms(conn) + DAY])

# ── 5. import ────────────────────────────────────────────────────────────────
IMP = {**OWNER, "Content-Type": "application/zip"}
r = c.post("/v1/admin/ns:import?rebuild=sync", content=EXPORT1, headers=IMP)
H.check("import into the purged id (clean) is 201 and arrives detached", r.status_code == 201
        and r.json()["ns"] == "acme" and r.json()["state"] == "detached", r.text[:500])
rep = r.json()
H.check("acceptance: row counts and sha256 equal for every file", rep["match"] is True
        and rep["files"]["tables/kh_record.ndjson"] == {"rows": 3, "sha256": sums["tables/kh_record.ndjson"]["sha256"],
                                                       "match": True}, rep["files"])
H.check("vectors re-embedded from text + metadata (checksum equal)", rep["rebuild"]["vectors"]["vectors/test.ndjson"]
        == {"rows": 3, "reembedded": 3, "sha256": sums["vectors/test.ndjson"]["sha256"], "match": True}, rep["rebuild"])
H.check("the vault did not travel (not in that export)", count("kh_vault_item", "acme") == 0)
H.check("an imported namespace answers 404 until re-attached",
        c.get("/v1/acme/records/note/n0", headers=as_("a1")).status_code == 404)
c.post("/v1/admin/ns/acme:reattach", headers=OWNER)
r = c.get("/v1/acme/records/note/n0", headers=as_("a1"))
H.check("after :reattach the restored record serves with its revision", r.status_code == 200
        and r.headers.get("etag") == '"1"' and r.json()["body"]["text"] == "note 0 ü", r.text)
r = c.post("/v1/acme/events", json={"kind": "tick", "project": "alpha", "body": {}}, headers=as_("a1"))
H.check("the event seq continues after the restored counter (no gap, no reuse)", r.status_code == 200
        and r.json()["accepted"][0]["seq"] == count("kh_event", "acme") > 6, r.text)

r = c.post("/v1/admin/ns:import?ns=acme2&rebuild=sync", content=EXPORT1, headers=IMP)
H.check("import under a new namespace id: 201 and every checksum equal", r.status_code == 201 and r.json()["match"]
        and r.json()["source_ns"] == "acme", r.text[:500])
with sqldb.connect() as conn:
    H.check("counters and vector metadata are renamed to the new id",
            sqldb.counter_get(conn, "ev:acme2") == 5 and count("kh_record", "acme2") == 3)
from app import vector_store as vs  # noqa: E402
got = vs.get_ids_vt(["v1"], collection=vs.get_or_create("ns_acme2_test"))
H.check("... vector rows land in ns_acme2_test with ns=acme2", got and got[0]["metadata"]["ns"] == "acme2", got)
r = c.get("/v1/admin/ns/acme2:export", headers=OWNER)
z2 = unzip(r.content)
s2 = json.loads(z2.read("checksums.json"))["files"]
same = [p for p in sums if p != "manifest.json" and p in s2 and s2[p]["sha256"] == sums[p]["sha256"]]
H.check("a re-export of the new id is byte-identical per table and vector file",
        set(same) == set(sums) - {"manifest.json"}, sorted(set(sums) - set(same)))
r = c.post("/v1/admin/ns:import?ns=acme2", content=EXPORT1, headers=IMP)
H.check("import into a namespace that is not clean is 409", r.status_code == 409 and r.json()["error"] == "duplicate", r.text)
bad = io.BytesIO()
with zipfile.ZipFile(bad, "w") as zb:
    for n in z.namelist():
        data = z.read(n)
        zb.writestr(n, data.replace(b"note 1", b"note X") if n == "tables/kh_record.ndjson" else data)
r = c.post("/v1/admin/ns:import?ns=acme4", content=bad.getvalue(), headers=IMP)
H.check("a tampered archive is refused (422 checksum)", r.status_code == 422 and "checksum" in r.json()["detail"], r.text)
r = c.post("/v1/admin/ns:import?ns=acme4", content=b"not a zip", headers=IMP)
H.check("a body that is not a zip is 422", r.status_code == 422, r.text)
r = c.post("/v1/admin/ns:import?ns=acme4", content=EXPORT1, headers={**STRANGER, "Content-Type": "application/zip"})
H.check("a person who does not own the projects cannot import (403)", r.status_code == 403, r.text)
H.check("... and a refused import leaves nothing behind", count("kh_record", "acme4") == 0
        and registry.ns_state("acme4") is None)
res = H.race(2, lambda i: c.post("/v1/admin/ns:import?ns=acme3&rebuild=sync", content=EXPORT1, headers=IMP).status_code)
H.check("RACE: two imports into one id -> one 201, one 409", sorted(res) == [201, 409], res)
H.check("... and the winner's rows are complete", count("kh_record", "acme3") == 3 and count("kh_event", "acme3") == 5)
r = c.post("/v1/admin/ns:import?ns=acme5&rebuild=sync", content=EXPORT_V, headers=IMP)
H.check("an include_vault export restores the vault too", r.status_code == 201 and r.json()["match"]
        and count("kh_vault_item", "acme5") == 1, r.text[:300])

# ── 5b. derived, instance-local state does not travel: the rule projection ───
import tempfile  # noqa: E402

config.KUZU_PROJECTS_PATH = tempfile.mkdtemp(prefix="kh_life_kuzu_")      # this test's own graph directories
setup_ns("rulesrc")
r = c.put("/v1/rulesrc/rules/r1", json={"project": "alpha", "entity": "Order", "attribute": "status", "condition": "",
                                   "effect": "must be paid before shipping", "source_text": "spec 1.2"},
          headers={**as_("a1"), **CREATE})
rp = c.post("/v1/rulesrc/rules:reproject", json={"project": "alpha"}, headers=OWNER)
H.check("a namespace with a rule and a projection state row (after :reproject)", r.status_code == 201
        and rp.status_code == 200 and count("kh_rule_proj", "rulesrc") == 1, (r.text, rp.text))
r = c.get("/v1/admin/ns/rulesrc:export", headers=OWNER)
EXPORT_RP = r.content
srp = json.loads(unzip(EXPORT_RP).read("checksums.json"))["files"]
H.check("the rule graph projection state (kh_rule_proj, LOCAL_TABLES) is not exported; the rules are",
        "tables/kh_rule.ndjson" in srp and "tables/kh_rule_proj.ndjson" not in srp, sorted(srp))
r = c.post("/v1/admin/ns:import?ns=rulecopy&rebuild=sync", content=EXPORT_RP, headers=IMP)
H.check("import of a namespace with rules: every file matches and the projection is rebuilt", r.status_code == 201
        and r.json()["match"] and r.json()["rebuild"]["rules"][0].get("projection") == "ok", r.text[:400])
with sqldb.connect() as conn:
    st = conn.execute("SELECT state FROM kh_rule_proj WHERE ns='rulecopy' AND project='alpha'").fetchone()
H.check("... the copy has its own projection state, written by the rebuild", st is not None and st[0] == "ok", st)
s2 = json.loads(unzip(c.get("/v1/admin/ns/rulecopy:export", headers=OWNER).content).read("checksums.json"))["files"]
diff = sorted(p for p in srp if p != "manifest.json" and (p not in s2 or s2[p]["sha256"] != srp[p]["sha256"]))
H.check("G3: a re-export of the copy is identical per table (rows and sha256), rules included", not diff
        and set(s2) == set(srp), diff)
c.post("/v1/admin/ns/rulecopy:reattach", headers=OWNER)
r = c.post("/v1/rulecopy/rules:query", json={"project": "alpha", "start_entities": ["Order"], "hops": 1}, headers=as_("a1"))
H.check("the copy answers rule queries after re-attach", r.status_code == 200
        and [x["rule_id"] for x in r.json()["rules"]] == ["r1"], r.text[:300])

# ── 6. retention and grace cron ──────────────────────────────────────────────
setup_ns("ret")
setup_ns("gone")
for ns in ("ret", "gone"):
    old = 40 * DAY
    evs = ([{"kind": "tick", "project": "alpha", "body": {}, "ts_ms": int(time.time() * 1000) - old} for _ in range(4)]
           + [{"kind": "keep", "project": "alpha", "body": {}, "ts_ms": int(time.time() * 1000) - 400 * DAY}] * 2
           + [{"kind": "tick", "project": "alpha", "body": {}}] * 2)
    r = c.post(f"/v1/{ns}/events", json={"events": evs}, headers=as_("a1"))
    assert r.status_code == 200, r.text
with sqldb.connect() as conn:          # a kh.* event older than the 180-day default
    conn.execute("UPDATE kh_event SET ts_ms=? WHERE ns='ret' AND seq=(SELECT MAX(seq) FROM kh_event WHERE ns='ret')",
                 [int(time.time() * 1000) - 500 * DAY])
    conn.execute("UPDATE kh_event SET kind='kh.duplicate' WHERE ns='ret' AND seq=(SELECT MAX(seq) FROM kh_event "
                 "WHERE ns='ret')")
c.post("/v1/admin/ns/gone:detach", headers=OWNER)
out = lifecycle.retention_sweep()
with sqldb.connect() as conn:
    kinds = sorted(r[0] for r in conn.execute("SELECT kind FROM kh_event WHERE ns='ret'").fetchall())
    weeks = {(r["kind"], r["n"]) for r in conn.execute("SELECT kind, n FROM kh_event_week WHERE ns='ret'").fetchall()}
H.check("retention: expired ticks (30 d) and the old kh.* event (180 d default) are deleted, keep (null) stays",
        kinds == ["keep", "keep", "tick"], (kinds, out))
H.check("... and rolled up into kh_event_week(ns, project, kind, week)", weeks == {("tick", 4), ("kh.duplicate", 1)}
        or sum(n for k, n in weeks if k == "tick") == 4, weeks)
H.check("a detached namespace is skipped by the retention cron", sqldb.connect().execute(
    "SELECT COUNT(*) FROM kh_event WHERE ns='gone' AND kind IN ('tick', 'keep')").fetchone()[0] == 8)
H.check("rollups are exported under _kh/", '"kind":"tick"' in unzip(
    c.get("/v1/admin/ns/ret:export", headers=OWNER).content).read("_kh/kh_event_week.ndjson").decode())
with sqldb.connect() as conn:          # KH's own events namespace is in no kh_ns row and is swept all the same
    for i, age in enumerate((200, 1)):
        sqldb.insert_new(conn, "kh_event", {"ns": "kh", "seq": 900000 + i, "id": f"khop{i}", "project": "",
                                            "kind": "kh.api.call", "ts_ms": int(time.time() * 1000) - age * DAY,
                                            "received_ms": int(time.time() * 1000), "actor_json": "{}",
                                            "body_json": "{}"})
lifecycle.retention_sweep()
H.check("retention: KH's own operational events (namespace kh) past 180 d are deleted, recent ones stay",
        sorted(r[0] for r in sqldb.connect().execute("SELECT id FROM kh_event WHERE ns='kh'").fetchall()) == ["khop1"])
setup_ns("sweep")
c.post("/v1/sweep/events", json={"events": [{"kind": "tick", "project": "alpha", "body": {},
                                             "ts_ms": int(time.time() * 1000) - 60 * DAY - i * 3600000}
                                            for i in range(300)]}, headers=as_("a1"))
lifecycle.BATCH = 7
H.race(4, lambda i: lifecycle.retention_sweep())
lifecycle.retention_sweep()
lifecycle.BATCH = 5000
with sqldb.connect() as conn:
    total = conn.execute("SELECT SUM(n) FROM kh_event_week WHERE ns='sweep'").fetchone()[0]
H.check("RACE: 4 concurrent sweeps in small batches count every event exactly once", total == 300
        and count("kh_event", "sweep") == 0, total)
ran = sqldb.run_under_lease("cron.retention", 30, lambda: "x", holder="inst-a")
ran2 = sqldb.run_under_lease("cron.retention", 30, lambda: "x", holder="inst-b")
H.check("the crons run under a _kh lease (one instance at a time)", ran == (True, "x") and ran2 == (False, None)
        and {n for n, _, _ in lifecycle.CRONS} == {"cron.retention", "cron.ns_purge"})
with sqldb.connect() as conn:
    conn.execute("UPDATE kh_ns SET purge_after_ms=1 WHERE ns='gone'")
got = lifecycle.purge_due()
H.check("the grace cron purges a detached namespace past grace_days", "gone:" in got
        and registry.ns_state("gone")["state"] == "purged" and count("kh_event", "gone") == 0, got)
H.check("lifecycle is listed in discovery", any(x["name"] == "lifecycle" for x in
                                                c.get("/v1/capabilities", headers=OWNER).json()["capabilities"]))

H.done()
