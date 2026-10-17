"""An upload finds out by itself whether it is an addendum, which contract it amends, and who should own it."""
import pytest

from app.contracts import link
from app.store import graph, opensearch
from tests.conftest import _ensure_test_org
from tests.test_contract_routes import client, upload, wait  # noqa: F401 - pytest fixture

ADMIN = "admin@test.local"


@pytest.fixture(autouse=True)
def empty_org():
    """Each case starts with no contracts: what is already there decides what a new upload is."""
    opensearch.wipe()
    graph.reset()
    _ensure_test_org()


def test_an_addendum_finds_its_contract_by_number_and_its_owner(client):  # noqa: F811
    parent = wait(client, upload(client, "c2.md", owner_email=ADMIN)["id"])
    add = wait(client, upload(client, "a2.md")["id"])
    assert add["kind"] == "addendum" and add["parent_id"] == parent["id"]
    assert "02/2026/HĐMB-DA" in add["auto"]["parent_reason"]
    assert add["owner_email"] == ADMIN and add["auto"]["owner_reason"] == "người phụ trách hợp đồng gốc"
    assert add["fields"]["end_date"]["value"] == "2027-07-31"      # read with the addendum prompt


def test_a_new_contract_stays_a_contract_and_goes_to_whoever_uploaded_it(client):  # noqa: F811
    rec = wait(client, upload(client, "c1.md")["id"])
    assert rec["kind"] == "contract" and rec["parent_id"] is None
    assert rec["owner_email"] == ADMIN and rec["auto"]["owner_reason"] == "người tải lên"


def test_an_addendum_whose_contract_is_missing_says_so(client):  # noqa: F811
    rec = wait(client, upload(client, "a2.md")["id"])
    assert rec["kind"] == "contract" and rec["parent_id"] is None
    assert "02/2026/HĐMB-DA" in rec["auto"]["note"]


def test_a_parent_and_owner_given_at_upload_are_kept(client):  # noqa: F811
    c1 = wait(client, upload(client, "c1.md")["id"])
    wait(client, upload(client, "c2.md")["id"])
    add = wait(client, upload(client, "a2.md", parent_id=c1["id"])["id"])
    assert add["parent_id"] == c1["id"]
    assert add["auto"]["parent_reason"] is None


def test_moving_an_addendum_to_another_contract_reads_it_again(client):  # noqa: F811
    c1 = wait(client, upload(client, "c1.md")["id"])
    rec = wait(client, upload(client, "a2.md")["id"])
    r = client.put(f"/contracts/{rec['id']}", json={"parent_id": c1["id"]})
    assert r.status_code == 200 and r.json()["status"] == "extracting"
    moved = wait(client, rec["id"])
    assert moved["kind"] == "addendum" and moved["parent_id"] == c1["id"]
    back = wait(client, client.put(f"/contracts/{rec['id']}", json={"parent_id": ""}).json()["id"])
    assert back["kind"] == "contract" and back["parent_id"] is None
    assert client.put(f"/contracts/{rec['id']}", json={"parent_id": rec["id"]}).status_code == 422


def test_a_confirmed_contract_keeps_its_parent(client):  # noqa: F811
    c1 = wait(client, upload(client, "c1.md")["id"])
    c2 = wait(client, upload(client, "c2.md")["id"])
    assert client.post(f"/contracts/{c2['id']}/confirm").status_code == 200
    assert client.put(f"/contracts/{c2['id']}", json={"parent_id": c1["id"]}).status_code == 409


# ---- the matching rules on their own ----

def _c(id_, number=None, supplier=None, tax=None, owner=None, created="2026-01-01"):
    f = {"number": number, "supplier_name": supplier, "supplier_tax_id": tax}
    return {"id": id_, "kind": "contract", "owner_email": owner, "created_at": created,
            "fields": {k: {"value": v} for k, v in f.items()}}


def test_heuristic_reads_an_addendum_heading_and_the_contract_it_points_to():
    md = "# PHỤ LỤC HỢP ĐỒNG SỐ 01\nKèm theo Hợp đồng mua bán số 118/2026/HĐMB-MP\n\nĐiều 1."
    c = link.heuristic(md)
    assert c.kind == "addendum" and c.parent_number == "118/2026/HĐMB-MP"
    assert link.heuristic("# HỢP ĐỒNG MUA BÁN\nSố: 9/2026\nCăn cứ hợp đồng nguyên tắc số 1/2025\n").kind == "contract"


def test_parent_by_number_ignores_spacing_and_marks():
    cands = [_c("a", "118/2026/HĐMB-MP"), _c("b", "119/2026/HĐMB-MP")]
    got, why = link.find_parent(link.Classified(kind="addendum", parent_number="118 / 2026 / HDMB-MP"), cands, rank=None)
    assert got["id"] == "a" and "118" in why


def test_parent_by_supplier_then_by_closest_text():
    cands = [_c("a", supplier="Công ty TNHH Giấy An Bình", tax="3701234567"),
             _c("b", supplier="CÔNG TY TNHH GIẤY AN BÌNH", tax="3701234567"), _c("c", supplier="Nhựa Đông Á")]
    one = link.Classified(kind="addendum", supplier_name="Nhựa Đông Á")
    assert link.find_parent(one, cands, rank=None)[0]["id"] == "c"
    two = link.Classified(kind="addendum", supplier_tax_id="3701 234 567")
    got, why = link.find_parent(two, cands, rank=lambda ids: {"a": 0.71, "b": 0.83})
    assert got["id"] == "b" and "gần nhất" in why
    assert link.find_parent(link.Classified(kind="contract", supplier_tax_id="3701234567"), cands, rank=None) == (None, None)


def test_a_new_contract_goes_to_the_owner_of_the_same_suppliers_latest_contract():
    cands = [_c("a", tax="0312456789", owner="old@x", created="2025-01-01"),
             _c("b", tax="0312456789", owner="new@x", created="2026-03-01"), _c("c", tax="999", owner="z@x")]
    owner, why = link.pick_owner(link.Classified(kind="contract", supplier_tax_id="0312456789"), None, cands,
                                 uploader="me@x", allowed=lambda e: e != "z@x")
    assert owner == "new@x" and "cùng nhà cung cấp" in why
    owner, why = link.pick_owner(link.Classified(kind="contract"), None, cands, uploader="me@x", allowed=lambda e: True)
    assert (owner, why) == ("me@x", "người tải lên")
