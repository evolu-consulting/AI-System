import pytest
from fastapi.testclient import TestClient

from app import auth
from app.contracts import project
from app.contracts.fields import CONFIRMED
from app.main import app
from app.models import SimilarVerdict
from app.store import graph
from tests.contract_helpers import fake_model
from tests.test_contract_routes import upload, wait

pytestmark = pytest.mark.usefixtures("fresh_stores")


@pytest.fixture
def client(monkeypatch):
    fake_model(monkeypatch)
    from app.query import similar
    monkeypatch.setattr(similar, "judge_similar", lambda a, b: SimilarVerdict(verdict="RELATED", reason="t"))
    if not auth.get_user("admin@test.local"):     # confirm needs the owner to exist in the users index
        auth.create_user("admin@test.local", "Test Admin", "pw-123456", role="admin")
    with TestClient(app) as c:
        yield c


def confirm(c, cid: str, owner: str = "admin@test.local") -> dict:
    c.put(f"/contracts/{cid}", json={"owner_email": owner})
    r = c.post(f"/contracts/{cid}/confirm")
    assert r.status_code == 200, r.text
    return r.json()


def ensure(c, file: str, parent: str | None = None, confirmed: bool = True) -> dict:
    """Upload (a re-upload of the same bytes returns the existing record), wait, optionally confirm."""
    rec = wait(c, upload(c, file, **({"parent_id": parent} if parent else {}))["id"])
    if confirmed and rec["status"] not in CONFIRMED:
        rec = confirm(c, rec["id"])
    return rec


def one(q: str, **p):
    rows = graph._run(q, **p)
    return rows[0] if rows else None


def test_keys_are_scoped_by_organisation():
    assert project.party_key("A", "0312345678", "o1") == "o1|tax:0312345678"
    assert project.party_key("A", "0312345678", "o1") != project.party_key("A", "0312345678", "o2")
    assert project.product_key("CT5L-60", "x", None, "o1") == "o1|code:ct5l-60"


def test_keys():
    assert project.party_key("Công ty A", "0312-345-678") == "tax:0312345678"
    assert project.party_key("CÔNG TY TNHH BAO BÌ", None) == "name:cong ty tnhh bao bi"
    assert project.product_key("CT5L-60", "x", None) == "code:ct5l-60"
    assert project.product_key(None, "Nắp chai", "phi 28") == "name:nap chai|phi 28"
    assert project.compute_deadline({"end_date": {"value": "2026-12-31"}, "notice_days": {"value": 30}}) == "2026-12-01"
    assert project.compute_deadline({"end_date": {"value": "2026-12-31"}, "notice_days": {"value": None}}) == "2026-12-31"


def test_confirm_requires_owner(client):
    rec = ensure(client, "c6.md", confirmed=False)
    client.put(f"/contracts/{rec['id']}", json={"owner_email": ""})     # uploads now arrive with an owner
    assert client.post(f"/contracts/{rec['id']}/confirm").status_code == 422
    assert one("MATCH (c:Contract {id:$id}) RETURN c", id=rec["id"]) is None


def test_confirm_projects_contract(client):
    rec = ensure(client, "c1.md")
    assert rec["action_deadline"] == "2026-12-01"
    assert rec["status"] in ("active", "expiring", "expired")
    r = one("""MATCH (c:Contract {id:$id})-[:SUPPLIER]->(s:Party), (c)-[:BUYER]->(b:Party)
               RETURN c.number AS n, c.end_date AS e, s.key AS s, b.key AS b""", id=rec["id"])
    o = rec["org_id"]
    assert (r["n"], r["e"], r["s"], r["b"]) == ("01/2026/HĐMB-PN", "2026-12-31", f"{o}|tax:0312345678", f"{o}|tax:0301234567")
    lines = graph._run("""MATCH (:Contract {id:$id})-[:HAS_LINE]->(l:PriceLine)-[:FOR]->(p:Product)
                          RETURN p.key AS k, l.unit_price AS price ORDER BY k""", id=rec["id"])
    assert [(x["k"], x["price"]) for x in lines] == [(f"{o}|code:ct5l-60", 8500), (f"{o}|code:mc-pe25", 320000)]
    clauses = graph._run("MATCH (:Contract {id:$id})-[:HAS_CLAUSE]->(ch:Chunk:Clause) RETURN ch.topic AS t", id=rec["id"])
    assert "payment" in {x["t"] for x in clauses}
    project.project_contract(rec["id"])     # idempotent
    assert len(graph._run("MATCH (:Contract {id:$id})-[:HAS_LINE]->(l) RETURN l", id=rec["id"])) == 2


def test_same_tax_id_is_one_party(client):
    c1, c5 = ensure(client, "c1.md"), ensure(client, "c5.md")
    r = one("""MATCH (a:Contract {id:$a})-[:SUPPLIER]->(p:Party)<-[:SUPPLIER]-(b:Contract {id:$b})
               RETURN p.match AS m""", a=c1["id"], b=c5["id"])
    assert r is not None and "phuong nam" in r["m"]


def test_no_tax_id_party_needs_merge(client):
    rec = ensure(client, "c6.md")
    r = one("MATCH (:Contract {id:$id})-[:SUPPLIER]->(p:Party) RETURN p.needs_merge AS m, p.key AS k", id=rec["id"])
    assert r["m"] is True and r["k"].startswith(f"{rec['org_id']}|name:")


def test_reproject_parent_keeps_addendum_links(client):
    parent = ensure(client, "c1.md")
    add = ensure(client, "a1.md", parent=parent["id"])
    q = """MATCH (a:Contract {id:$a})-[am:AMENDS]->(p:Contract {id:$p}),
                 (a)-[:HAS_LINE]->(new:PriceLine)-[s:SUPERSEDES]->(old:PriceLine)<-[:HAS_LINE]-(p)
           RETURN am.effective_date AS eff, new.unit_price AS np, old.unit_price AS op, old.valid_to AS ovt"""
    r = one(q, a=add["id"], p=parent["id"])
    assert (r["eff"], r["np"], r["op"], r["ovt"]) == ("2026-07-01", 8900, 8500, "2026-06-30")
    p = client.get(f"/contracts/{parent['id']}").json()
    assert p["fields"]["payment_terms"]["value"].startswith("Thời hạn thanh toán sửa thành 45 ngày")
    assert p["history"][-1]["by"] == f"addendum:{add['id']}"
    # editing a confirmed parent rebuilds it; the addendum's edges must come back
    client.put(f"/contracts/{parent['id']}", json={"fields": {"warranty": "Đổi mới trong 45 ngày"}})
    r = one(q, a=add["id"], p=parent["id"])
    assert r is not None and r["np"] == 8900


def test_addendum_extension_moves_parent_deadline(client):
    parent = ensure(client, "c2.md")
    ensure(client, "a2.md", parent=parent["id"])
    p = client.get(f"/contracts/{parent['id']}").json()
    assert p["fields"]["end_date"]["value"] == "2027-07-31"
    assert p["action_deadline"] == "2027-06-16"      # 2027-07-31 − 45 days


def test_addendum_of_unconfirmed_parent_is_still_projected(client):
    parent = ensure(client, "c4.md", confirmed=False)
    add = ensure(client, "a3.md", parent=parent["id"])
    assert one("MATCH (c:Contract {id:$id}) RETURN c", id=add["id"]) is not None
    assert one("MATCH (c:Contract {id:$id}) RETURN c", id=parent["id"]) is None


def test_addendum_line_without_spec_is_the_parent_product_of_that_name(client):
    """An addendum often names the product shortly ("phí bản quyền phần mềm quản lý kho", no "gói 50 người dùng"):
    it is still the parent's product, so its price supersedes the old one instead of becoming a second product."""
    from app.contracts import store
    parent = ensure(client, "c4.md")
    add = ensure(client, "a3.md", parent=parent["id"])
    rec = store.get(add["id"])
    rec["items"][0]["spec"] = None
    store.save(rec)
    project.project_contract(add["id"])
    r = one("""MATCH (:Contract {id:$a})-[:HAS_LINE]->(new:PriceLine)-[:SUPERSEDES]->(old:PriceLine)<-[:HAS_LINE]-(:Contract {id:$p})
               MATCH (new)-[:FOR]->(prod:Product)<-[:FOR]-(old)
               RETURN new.unit_price AS np, old.unit_price AS op, prod.key AS k""", a=add["id"], p=parent["id"])
    assert r is not None and (r["np"], r["op"]) == (16500000, 15000000) and r["k"].endswith("|goi 50 nguoi dung")
    n = one("MATCH (p:Product) WHERE p.key STARTS WITH $o AND p.match CONTAINS 'phan mem quan ly kho' RETURN count(p) AS n",
            o=parent["org_id"])
    assert n["n"] == 1


def test_handled_and_delete(client):
    rec = ensure(client, "c3.md")
    assert client.post(f"/contracts/{rec['id']}/handled", json={"outcome": "bogus"}).status_code == 422
    out = client.post(f"/contracts/{rec['id']}/handled", json={"outcome": "not_renewed"}).json()
    assert out["status"] == "terminated" and out["handled"]["outcome"] == "not_renewed"
    assert client.delete(f"/contracts/{rec['id']}").json() == {"ok": True}
    assert client.get(f"/contracts/{rec['id']}").status_code == 404
    assert one("MATCH (c:Contract {id:$id}) RETURN c", id=rec["id"]) is None


def test_reextract_refused_on_confirmed_record(client):
    rec = ensure(client, "c8.md")
    before = client.get(f"/contracts/{rec['id']}").json()
    r = client.post(f"/contracts/{rec['id']}/reextract")
    assert r.status_code == 409 and "đã xác nhận" in r.json()["detail"]
    assert client.get(f"/contracts/{rec['id']}").json() == before


def test_confirm_refuses_failed_extraction(client):
    from app.contracts import store
    rec = ensure(client, "c7.md", confirmed=False)
    client.put(f"/contracts/{rec['id']}", json={"owner_email": "admin@test.local"})
    failed = store.get(rec["id"])
    failed.update(status="extract_failed", error="boom")
    store.save(failed)
    assert client.post(f"/contracts/{rec['id']}/confirm").status_code == 409


def test_addendum_fields_count_as_edited_and_delete_cleans_up(client):
    from app.contracts import notify, remind
    from app.store import opensearch as os_store
    parent = ensure(client, "c2.md")
    add = ensure(client, "a2.md", parent=parent["id"])
    p = client.get(f"/contracts/{parent['id']}").json()
    assert p["fields"]["end_date"]["edited"] is True          # a later re-extraction cannot undo the addendum
    assert one("MATCH (:Contract {id:$a})-[:AMENDS]->(:Contract {id:$p}) RETURN 1 AS x",
               a=add["id"], p=parent["id"]) is not None
    notify.create("admin@test.local", add["id"], 7, "t", "b")
    os_store.set_state(f"remind:{add['id']}:2027-01-01:7", {"at": "x", "sent": True})
    os_store.set_state(f"remind:{parent['id']}:2027-01-01:7", {"at": "x", "sent": True})
    assert client.delete(f"/contracts/{add['id']}").json() == {"ok": True}
    assert one("MATCH (c:Contract {id:$p}) RETURN c", p=parent["id"]) is not None
    assert one("MATCH (:Contract)-[:AMENDS]->(:Contract {id:$p}) RETURN 1 AS x", p=parent["id"]) is None
    assert not [n for n in notify.list_for("admin@test.local") if n["contract_id"] == add["id"]]
    assert os_store.get_state(f"remind:{add['id']}:2027-01-01:7") is None
    assert os_store.get_state(f"remind:{parent['id']}:2027-01-01:7") is not None
    assert remind.state_key(p, 7, "a@test.local").startswith(f"remind:{parent['id']}:")
