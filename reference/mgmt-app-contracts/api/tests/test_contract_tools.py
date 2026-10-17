import json

import pytest
from fastapi.testclient import TestClient

from app import auth
from app.contracts.tools import openai_specs, run_tool
from app.main import app
from app.models import SimilarVerdict
from tests.contract_helpers import fake_model
from tests.test_contract_graph import ensure

TODAY = "2026-10-07"


@pytest.fixture(scope="module")
def corpus(fresh_stores):
    mp = pytest.MonkeyPatch()
    fake_model(mp)
    from app.query import similar
    mp.setattr(similar, "judge_similar", lambda a, b: SimilarVerdict(verdict="RELATED", reason="t"))
    if not auth.get_user("admin@test.local"):
        auth.create_user("admin@test.local", "Test Admin", "pw-123456", role="admin")
    ids = {}
    with TestClient(app) as c:
        for f in ("c1.md", "c4.md", "c5.md", "c7.md"):
            ids[f] = ensure(c, f)["id"]
        ids["a1.md"] = ensure(c, "a1.md", parent=ids["c1.md"])["id"]
        ids["c3.md"] = ensure(c, "c3.md", confirmed=False)["id"]       # left unconfirmed on purpose
    yield ids
    mp.undo()


def call(name, restrict=None, **args):
    return run_tool(name, json.dumps(args, ensure_ascii=False), restrict, today=TODAY)


def text(items):
    return "\n".join(i["text"] for i in items)


def test_find_by_product_spans_suppliers_and_ignores_unconfirmed(corpus):
    items = call("find_contracts", product="thùng carton")
    docs = {i["doc_id"] for i in items}
    assert {corpus["c1.md"], corpus["c5.md"]} <= docs
    assert call("find_contracts", supplier="Sao Việt") == []        # c3 is not confirmed
    assert "2026-12-31" in text(items) and "Phương Nam" in text(items)


def test_find_due_and_auto_renew(corpus):
    due = {i["doc_id"] for i in call("find_contracts", due_within_days=60)}
    assert corpus["c5.md"] in due and corpus["c1.md"] in due
    assert corpus["c7.md"] not in due
    renew = text(call("find_contracts", supplier="Lạc Hồng"))
    assert "tự động gia hạn: có" in renew and "báo trước: 60" in renew


def test_facts_show_effective_price_after_addendum(corpus):
    t = text(call("contract_facts", contract_id=corpus["c1.md"]))
    assert "CT5L-60" in t and "8.900" in t and "8.500" not in t.split("Giá hiệu lực")[1].split("Phụ lục")[0]
    assert "45 ngày" in t
    assert "PL01-01/2026/HĐMB-PN" in t


def test_amendments_and_price_history(corpus):
    t = text(call("amendments_of", contract_id=corpus["c1.md"]))
    assert "2026-07-01" in t and "8.900" in t
    h = text(call("price_history", product="CT5L-60"))
    assert "8.500" in h and "8.900" in h and "8.300" in h


def test_search_clauses_labels_unconfirmed_and_respects_restrict(corpus):
    items = call("search_clauses", query="phạt chậm giao hàng")
    assert items and all(i["kind"] == "clause" for i in items)
    assert any("0,5%" in i["text"] for i in items)
    only = call("search_clauses", restrict=[corpus["c4.md"]], query="phạt")
    assert {i["doc_id"] for i in only} == {corpus["c4.md"]}
    unconf = [i for i in call("search_clauses", query="vận chuyển nội thành trễ chuyến") if i["doc_id"] == corpus["c3.md"]]
    assert unconf and unconf[0]["unconfirmed"] is True


def test_restrict_is_forced_on_graph_tools(corpus):
    items = call("find_contracts", restrict=[corpus["c4.md"]], product="thùng carton")
    assert items == []
    assert call("contract_facts", restrict=[corpus["c4.md"]], contract_id=corpus["c1.md"]) == []


def test_bad_arguments_return_nothing(corpus):
    assert run_tool("find_contracts", "{not json", None) == []
    assert run_tool("nope", "{}", None) == []
    assert call("find_contracts", limit=500) == []


def test_specs_are_openai_tools():
    names = {s["function"]["name"] for s in openai_specs()}
    assert names == {"find_contracts", "contract_facts", "amendments_of", "price_history", "search_clauses", "margins"}


def test_due_bounds_and_unknown_auto_renew(corpus):
    assert call("find_contracts", due_within_days=10_000_000) == []
    assert call("find_contracts", due_within_days=-1) == []
    from app.contracts.tools import _summary_line
    from app.contracts.fields import CONFIRMED
    names = ("number", "supplier_name", "supplier_tax_id", "start_date", "end_date", "auto_renew", "notice_days", "total_value")
    vals = {"notice_days": 0}
    rec = {"status": "active", "fields": {n: {"value": vals.get(n), "quote": None} for n in names}}
    line = _summary_line(rec)
    assert "tự động gia hạn: ?" in line and "báo trước: 0 ngày" in line


def test_facts_and_amendments_resolve_contract_number(corpus):
    by_id = call("contract_facts", contract_id=corpus["c1.md"])
    by_num = call("contract_facts", contract_id="01/2026/HĐMB-PN")
    assert by_num and by_num[0]["doc_id"] == by_id[0]["doc_id"] and "8.900" in text(by_num)
    assert [i["doc_id"] for i in call("amendments_of", contract_id="01/2026/HĐMB-PN")] == [corpus["a1.md"]]
    assert call("amendments_of", [corpus["c4.md"]], contract_id="01/2026/HĐMB-PN") == []


def test_resolve_by_number_respects_restrict(corpus):
    from app.contracts import tools
    assert tools._resolve("01/2026/HĐMB-PN", None) == corpus["c1.md"]
    assert tools._resolve("01/2026/HĐMB-PN", []) == "01/2026/HĐMB-PN"
    assert call("contract_facts", [corpus["c4.md"]], contract_id="01/2026/HĐMB-PN") == []


def test_price_history_marks_effectiveness(corpus):
    lines = text(call("price_history", product="CT5L-60")).splitlines()
    assert any("8.500" in ln and "ĐÃ HẾT HIỆU LỰC" in ln for ln in lines)
    assert any("8.900" in ln and "ĐANG HIỆU LỰC" in ln for ln in lines)


def test_clause_topic_ranks_but_never_hides(corpus):
    items = call("search_clauses", query="phạt chậm giao hàng", topic="confidentiality")
    assert any("0,5%" in i["text"] for i in items)
