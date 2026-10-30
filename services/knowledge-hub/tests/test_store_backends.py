"""Tests for the cloud storage backends (app/sqldb.py, app/vector_hana.py) and the API key gate.

Run from the repo root with the project venv:
    .venv\\Scripts\\python tests\\test_store_backends.py

OFFLINE PART (always runs): the Chroma ``where`` / ``where_document`` evaluator the HANA
adapter filters with, the HANA row shape, the SQLite path of sqldb.upsert, the VCAP_SERVICES
binding parser, and the API key middleware.

LIVE PART (runs only when KH_TEST_HANA=1 and HANA_HOST/HANA_USERNAME/HANA_PASSWORD/HANA_SCHEMA
are set): a round trip through the real HANA Cloud vector engine and the relational tables.
It writes only to a throwaway collection and a throwaway hook_type, and deletes both.
"""
import json
import os
import sys
import tempfile
import uuid

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

TMP = tempfile.mkdtemp(prefix="kh_backends_")
os.environ["KH_HOOKS_DB"] = os.path.join(TMP, "hooks.db")
os.environ["CHROMA_PATH"] = os.path.join(TMP, "chroma")
os.environ["KH_PROJECTS_PATH"] = os.path.join(TMP, "projects")
os.environ["KH_FEEDBACK_CRON"] = "false"

FAILED: list[str] = []
PASSED = 0


def check(name: str, cond: bool, detail: str = "") -> None:
    global PASSED
    if cond:
        PASSED += 1
        print(f"  ok   {name}")
    else:
        FAILED.append(name)
        print(f"  FAIL {name} {detail}")


# --------------------------------------------------------------------------- offline

def test_where_evaluator():
    from app.vector_hana import matches_where, matches_document
    m = {"scope": "log", "topic": "kh-deploy", "project": "knowledge-hub", "n": 5, "ok": True}
    check("where: bare equality", matches_where(m, {"topic": "kh-deploy"}))
    check("where: $eq", matches_where(m, {"topic": {"$eq": "kh-deploy"}}))
    check("where: $eq mismatch", not matches_where(m, {"topic": {"$eq": "other"}}))
    check("where: $ne", matches_where(m, {"scope": {"$ne": "knowledge"}}))
    check("where: $in", matches_where(m, {"scope": {"$in": ["log", "knowledge"]}}))
    check("where: $nin", matches_where(m, {"scope": {"$nin": ["knowledge"]}}))
    check("where: $gt/$lte", matches_where(m, {"n": {"$gt": 4, "$lte": 5}}))
    check("where: $and", matches_where(m, {"$and": [{"scope": "log"}, {"project": "knowledge-hub"}]}))
    check("where: $and one false", not matches_where(m, {"$and": [{"scope": "log"}, {"project": "x"}]}))
    check("where: $or", matches_where(m, {"$or": [{"scope": "x"}, {"topic": "kh-deploy"}]}))
    check("where: missing field never matches", not matches_where(m, {"absent": "v"}))
    check("where: missing field with $ne", not matches_where(m, {"absent": {"$ne": "v"}}))
    check("where: type clash is a non-match", not matches_where(m, {"topic": {"$gt": 3}}))
    check("where: none matches all", matches_where(m, None))
    check("doc: $contains", matches_document("alpha beta", {"$contains": "beta"}))
    check("doc: $contains is case-sensitive", not matches_document("alpha beta", {"$contains": "Beta"}))
    check("doc: $not_contains", matches_document("alpha", {"$not_contains": "beta"}))
    check("doc: $or", matches_document("alpha", {"$or": [{"$contains": "x"}, {"$contains": "alp"}]}))
    check("doc: none doc", not matches_document(None, {"$contains": "a"}))


def test_sql_filter():
    from app.vector_hana import sql_filter
    clause, params, exact = sql_filter({"$and": [{"knowledge_type": {"$eq": "quick"}}, {"scope": {"$eq": "log"}}]})
    check("sql: $and of $eq is exact", exact and params == ["quick", "log"] and clause.count("JSON_VALUE") == 2, clause)
    clause, params, exact = sql_filter({"project": {"$in": ["a", "b"]}, "topic": "t"})
    check("sql: $in and bare equality", exact and params == ["a", "b", "t"] and " IN (?,?)" in clause, clause)
    clause, params, exact = sql_filter({"topic": "t", "n": {"$gt": 3}})
    check("sql: a range stays in Python, the rest narrows", not exact and params == ["t"], (clause, exact))
    clause, params, exact = sql_filter({"$or": [{"a": "x"}, {"b": "y"}]})
    check("sql: $or is never pushed down", clause == "" and not exact, clause)
    clause, params, exact = sql_filter({"ok": True})
    check("sql: non-string values stay in Python", clause == "" and not exact, clause)
    clause, params, exact = sql_filter({"bad key'": "x"})
    check("sql: an unsafe key is never put in SQL", clause == "" and not exact, clause)
    check("sql: no filter is exact", sql_filter(None) == ("", [], True))


def test_row_shape():
    from app.sqldb import _Row
    r = _Row(["id", "content"], [7, "text"])
    check("row: by name", r["content"] == "text")
    check("row: by index", r[0] == 7 and r[1] == "text")
    check("row: dict() keeps names", dict(r) == {"id": 7, "content": "text"})


def test_sqlite_upsert():
    from app.hooks import store as hooks
    hooks.init()
    a = hooks.set_rule("UnitTest", "first", name="r1", position=2)
    b = hooks.set_rule("UnitTest", "second", name="r1", position=3)
    check("sqlite upsert: same id on update", a["id"] == b["id"])
    check("sqlite upsert: content replaced", b["content"] == "second" and b["position"] == 3)
    check("sqlite upsert: one row", len(hooks.list_rules("UnitTest")) == 1)


def test_binding_parser():
    from app import config
    vcap = {"hana": [{"name": "kh-hana", "label": "hana", "tags": ["hana"],
                      "credentials": {"host": "h.example", "port": "443", "user": "U1",
                                      "password": "p", "schema": "S1"}}]}
    old = os.environ.get("VCAP_SERVICES")
    os.environ["VCAP_SERVICES"] = json.dumps(vcap)
    try:
        creds = config._hana_binding()
        check("binding: reads credentials", creds.get("host") == "h.example" and creds.get("schema") == "S1")
        os.environ["VCAP_SERVICES"] = "not json"
        check("binding: bad json is empty", config._hana_binding() == {})
    finally:
        if old is None:
            os.environ.pop("VCAP_SERVICES", None)
        else:
            os.environ["VCAP_SERVICES"] = old


def test_api_key_gate():
    os.environ["KH_API_KEY"] = "unit-test-key"
    import importlib
    from app import config
    importlib.reload(config)
    import main
    importlib.reload(main)
    from fastapi.testclient import TestClient
    client = TestClient(main.app)           # no lifespan: no model load needed
    check("api key: /health stays open", client.get("/health").status_code != 401)
    check("api key: no key -> 401", client.get("/hooks/list").status_code == 401)
    check("api key: wrong key -> 401",
          client.get("/hooks/list", headers={"X-KH-Key": "nope"}).status_code == 401)
    check("api key: header key passes",
          client.get("/hooks/list", headers={"X-KH-Key": "unit-test-key"}).status_code != 401)
    check("api key: bearer passes",
          client.get("/hooks/list",
                     headers={"Authorization": "Bearer unit-test-key"}).status_code != 401)
    os.environ.pop("KH_API_KEY", None)
    importlib.reload(config)


def test_docstore_local():
    from app import docstore
    p = os.path.join(TMP, "projects", "demo", "counter.json")
    check("docstore local: missing -> default", docstore.read_json(p, {"x": 1}) == {"x": 1})
    docstore.write_json(p, {"request_total": 2})
    check("docstore local: real file written", os.path.isfile(p))
    check("docstore local: read back", docstore.read_json(p) == {"request_total": 2})
    check("docstore local: exists", docstore.exists(p))
    check("docstore local: delete_tree", docstore.delete_tree(os.path.dirname(p)) and not os.path.exists(p))


def test_project_prefix():
    from app.graph_db.hana_adapter import project_prefix
    a, b = project_prefix("simplemdg-2.0"), project_prefix("simplemdg_2_0")
    check("prefix: readable", a.startswith("KH_P_SIMPLEMDG_2_0_"), a)
    check("prefix: collision-proof", a != b, f"{a} {b}")
    check("prefix: stable", a == project_prefix("simplemdg-2.0"))


# --------------------------------------------------------------------------- live

def test_live_hana_graph_and_docs():
    from app import docstore
    docstore._READY = False
    key = os.path.join("projects", f"kh-test-{uuid.uuid4().hex[:6]}", "counter.json")
    docstore.write_json(key, {"request_total": 1, "issues": {"a": 1}})
    check("live docs: read back", docstore.read_json(key) == {"request_total": 1, "issues": {"a": 1}})
    docstore.write_json(key, {"request_total": 2})
    check("live docs: overwrite", docstore.read_json(key) == {"request_total": 2})
    check("live docs: delete_tree", docstore.delete_tree(os.path.dirname(key)) and not docstore.exists(key))

    from app.graph_db.hana_adapter import HanaAdapter, project_prefix
    g = HanaAdapter(project_prefix(f"kh-test-{uuid.uuid4().hex[:6]}"))
    g.bootstrap()
    try:
        g.upsert_nodes_bulk([
            {"core_id": "a", "type": "T", "label": "A", "source_text": "alpha " * 500,
             "attributes": {"k": 1}},
            {"core_id": "b", "type": "T", "label": "B"},
            {"core_id": "c", "type": "T", "label": "C"},
        ])
        g.upsert_edges_bulk([
            {"source_core_id": "a", "relation": "CALLS", "target_core_id": "b",
             "source_text": "a calls b", "confidence": 0.9},
            {"source_core_id": "b", "relation": "CALLS", "target_core_id": "c"},
            {"source_core_id": "a", "relation": "PART_OF", "target_core_id": "c"},
        ])
        nodes, edges = g.fetch_graph(["a"], frozenset(), 1)
        na = [n for n in nodes if n["core_id"] == "a"]
        check("live graph: node source_text is text, not a LOB handle",
              bool(na) and na[0]["source_text"].startswith("alpha") and na[0]["attributes"] == {"k": 1},
              str(na[:1])[:200])
        check("live graph: 1-hop edges", {(e["source_core_id"], e["target_core_id"]) for e in edges}
              >= {("a", "b"), ("a", "c")}, str(edges))
        nodes, edges = g.traverse_logic(["a"], max_hops=3)
        check("live graph: traverse follows CALLS 2 hops, skips PART_OF",
              {n["core_id"] for n in nodes} == {"a", "b", "c"}
              and all(e["relation"] == "CALLS" for e in edges), str(edges))
        ab = [e for e in edges if e["target_core_id"] == "b"]
        check("live graph: edge evidence kept", bool(ab) and ab[0]["source_text"] == "a calls b"
              and abs(ab[0]["confidence"] - 0.9) < 1e-9, str(ab))
        g.upsert_edges([{"source_core_id": "a", "relation": "CALLS", "target_core_id": "b",
                         "source_text": "refreshed", "confidence": 0.5}])
        _, edges = g.traverse_logic(["a"], max_hops=1)
        check("live graph: re-ingest refreshes evidence, no duplicate",
              [e["source_text"] for e in edges if e["target_core_id"] == "b"] == ["refreshed"], str(edges))
        _, edges = g.traverse_logic(["a"], max_hops=3, min_confidence=0.8)
        check("live graph: min_confidence filter", all(e["confidence"] >= 0.8 for e in edges), str(edges))
        d = g.delete_nodes(["c"])
        check("live graph: delete_nodes detaches edges", d["nodes_deleted"] == 1 and d["edges_deleted"] == 2, str(d))
    finally:
        check("live graph: drop", g.drop())


def test_live_hana():
    os.environ["KH_STORE_BACKEND"] = "hana"
    import importlib
    from app import config, sqldb
    importlib.reload(config)
    from app import vector_hana
    client = vector_hana.HanaVectorClient()
    name = f"kh_test_{uuid.uuid4().hex[:8]}"
    coll = client.get_or_create_collection(name, metadata={"hnsw:space": "cosine"})
    try:
        v1, v2, v3 = [1.0, 0.0, 0.0], [0.0, 1.0, 0.0], [0.7071, 0.7071, 0.0]
        coll.upsert(ids=["a", "b", "c"], embeddings=[v1, v2, v3],
                    metadatas=[{"topic": "t1", "n": 1}, {"topic": "t2", "n": 2},
                               {"topic": "t1", "n": 3}],
                    documents=["alpha doc", "beta doc", "gamma alpha"])
        check("live: count", coll.count() == 3)
        g = coll.get(where={"topic": "t1"})
        check("live: get where", sorted(g["ids"]) == ["a", "c"], str(g["ids"]))
        g = coll.get(limit=2, offset=1)
        check("live: get paging keeps insertion order", g["ids"] == ["b", "c"], str(g["ids"]))
        q = coll.query(query_embeddings=[v1], n_results=2,
                       include=["distances", "metadatas", "documents"])
        check("live: query nearest first", q["ids"][0][0] == "a", str(q["ids"]))
        check("live: distance is 1-cos", abs(q["distances"][0][0]) < 1e-5, str(q["distances"]))
        q = coll.query(query_embeddings=[v1], n_results=5, where={"topic": "t2"})
        check("live: query with where", q["ids"][0] == ["b"], str(q["ids"]))
        fv = coll.field_values("n", where={"topic": "t1"})
        check("live: field_values reads one field in SQL", fv == [("a", "1"), ("c", "3")], str(fv))
        fv = coll.field_values("n", where={"n": {"$gt": 1}})
        check("live: field_values falls back to Python for other filters",
              sorted(fv) == [("b", 2), ("c", 3)], str(fv))
        g = coll.get(where_document={"$contains": "alpha"})
        check("live: where_document", sorted(g["ids"]) == ["a", "c"], str(g["ids"]))
        coll.update(ids=["a"], metadatas=[{"topic": "t9"}])
        g = coll.get(ids=["a"], include=["metadatas", "documents", "embeddings"])
        check("live: update keeps doc + embedding",
              g["metadatas"][0] == {"topic": "t9"} and g["documents"][0] == "alpha doc"
              and abs(g["embeddings"][0][0] - 1.0) < 1e-5, str(g))
        coll.upsert(ids=["b"], embeddings=[v2], metadatas=[{"topic": "t2b"}], documents=["beta 2"])
        check("live: upsert replaces", coll.get(ids=["b"])["documents"] == ["beta 2"])
        coll.delete(ids=["a"])
        coll.delete(where={"topic": "t2b"})
        check("live: delete by id and where", coll.get()["ids"] == ["c"])
        check("live: list_collections sees it",
              name in [c.name for c in client.list_collections()])
    finally:
        client.delete_collection(name)
    check("live: delete_collection", name not in [c.name for c in client.list_collections()])

    from app.hooks import store as hooks
    hooks.init()
    ht = f"KhTest{uuid.uuid4().hex[:6]}"
    try:
        a = hooks.set_rule(ht, "first " * 3000, name="r1", position=1)
        b = hooks.set_rule(ht, "second", name="r1", position=2)
        check("live sql: upsert keeps id", a["id"] == b["id"])
        check("live sql: long text round trips", len(a["content"]) == len("first " * 3000))
        check("live sql: get_text", hooks.get_text(ht) == "second")
    finally:
        hooks.delete_rule(hook_type=ht, name="r1")
    check("live sql: deleted", hooks.list_rules(ht) == [])
    from app.policy_actions import store as pa
    pa.init()
    check("live sql: policy tables", isinstance(pa.stats()["rules"], int))
    from app import projects_store
    projects_store._READY = False    # the offline part already initialised it on SQLite
    check("live sql: projects table", isinstance(projects_store.count(), int))
    check("live sql: location", sqldb.location().startswith("hana:"))


if __name__ == "__main__":
    print("offline:")
    test_where_evaluator()
    test_sql_filter()
    test_row_shape()
    test_sqlite_upsert()
    test_binding_parser()
    test_api_key_gate()
    test_docstore_local()
    test_project_prefix()
    if os.getenv("KH_TEST_HANA") == "1":
        print("live HANA:")
        test_live_hana()
        test_live_hana_graph_and_docs()
    else:
        print("live HANA: skipped (set KH_TEST_HANA=1 with HANA_* credentials)")
    print(f"{PASSED} checks, {len(FAILED)} failed" + (f": {FAILED}" if FAILED else ""))
    sys.exit(1 if FAILED else 0)
