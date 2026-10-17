import time

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.models import SimilarVerdict
from tests.contract_helpers import fake_model, md

pytestmark = pytest.mark.usefixtures("fresh_stores")


@pytest.fixture
def client(monkeypatch):
    fake_model(monkeypatch)                       # extraction answers from the key; everything else stays fake
    from app.query import similar
    monkeypatch.setattr(similar, "judge_similar", lambda a, b: SimilarVerdict(verdict="RELATED", reason="test"))
    with TestClient(app) as c:
        yield c


def upload(c, file: str, **form) -> dict:
    r = c.post("/contracts/upload", files={"file": (file, md(file).encode(), "text/markdown")}, data=form)
    assert r.status_code == 200, r.text
    return r.json()


def wait(c, cid: str, timeout: float = 60) -> dict:
    t0 = time.time()
    while time.time() - t0 < timeout:
        rec = c.get(f"/contracts/{cid}").json()
        if rec["status"] not in ("extracting",):
            return rec
        time.sleep(0.3)
    raise AssertionError("contract extraction timed out")


def test_upload_extracts_verifies_and_waits_for_review(client):
    rec = wait(client, upload(client, "c1.md")["id"])
    assert rec["status"] == "needs_review"
    assert rec["fields"]["number"]["value"] == "01/2026/HĐMB-PN"
    assert rec["fields"]["end_date"] == {"value": "2026-12-31", "quote": "đến hết 31/12/2026",
                                         "verified": True, "edited": False}
    assert len(rec["items"]) == 2 and all(i["verified"] for i in rec["items"])
    assert rec["warnings"] == []
    assert [c["number"] for c in rec["clauses"]][:3] == ["0", "1", "2"]
    assert all(c["chunk_id"].startswith(rec["id"] + ":") for c in rec["clauses"])
    assert "Điều 3. Thanh toán" in rec["source_md"]
    docs = client.get("/documents").json()
    assert rec["id"] not in {d["id"] for d in docs}          # contracts stay out of the general list


def test_addendum_links_to_parent_and_listing_filters(client):
    parent = wait(client, upload(client, "c2.md")["id"])
    add = wait(client, upload(client, "a2.md", parent_id=parent["id"])["id"])
    assert add["kind"] == "addendum" and add["parent_id"] == parent["id"]
    assert add["fields"]["end_date"]["value"] == "2027-07-31"
    listed = client.get("/contracts", params={"status": "needs_review"}).json()
    assert {parent["id"], add["id"]} <= {r["id"] for r in listed}
    assert "source_md" not in listed[0]
    found = client.get("/contracts", params={"q": "đông á"}).json()
    assert parent["id"] in {r["id"] for r in found}


def test_reextract_keeps_manual_edits(client):
    rec = wait(client, upload(client, "c3.md")["id"])
    r = client.put(f"/contracts/{rec['id']}", json={"fields": {"payment_terms": "Thanh toán ngay"}})
    assert r.status_code == 200
    again = client.post(f"/contracts/{rec['id']}/reextract").json()
    again = wait(client, again["id"])
    assert again["fields"]["payment_terms"]["value"] == "Thanh toán ngay"
    assert again["fields"]["payment_terms"]["edited"] is True
    assert again["fields"]["end_date"]["value"] == "2026-09-30"


def test_upload_rejects_unknown_parent(client):
    r = client.post("/contracts/upload", files={"file": ("a3.md", md("a3.md").encode(), "text/markdown")},
                    data={"parent_id": "nope"})
    assert r.status_code == 404


def test_same_name_different_bytes_is_a_new_contract(client):
    def up(f):
        r = client.post("/contracts/upload", files={"file": ("hop-dong.md", md(f).encode(), "text/markdown")})
        assert r.status_code == 200, r.text
        return r.json()["id"]
    a = wait(client, up("c6.md"))
    b = wait(client, up("c7.md"))
    assert a["id"] != b["id"]
    assert client.get(f"/contracts/{a['id']}").json()["fields"] == a["fields"]


def test_reupload_after_failed_extraction_reruns_it(client):
    from app.contracts import store
    rec = wait(client, upload(client, "c3.md")["id"])
    failed = store.get(rec["id"])
    failed.update(status="extract_failed", error="boom")
    store.save(failed)
    again = upload(client, "c3.md")
    assert again["id"] == rec["id"] and again["status"] in ("extracting", "needs_review")
    done = wait(client, rec["id"])
    assert done["status"] == "needs_review" and done["source_md"]


def test_put_rejects_bad_values_and_keeps_zero(client):
    rec = wait(client, upload(client, "c3.md")["id"])
    url = f"/contracts/{rec['id']}"
    for bad in ({"total_value": "1.234"}, {"end_date": "31/12/2026"}, {"auto_renew": "yes"}):
        assert client.put(url, json={"fields": bad}).status_code == 422
    r = client.put(url, json={"fields": {"vat_rate": 0}})
    assert r.status_code == 200
    assert client.get(url).json()["fields"]["vat_rate"]["value"] == 0
