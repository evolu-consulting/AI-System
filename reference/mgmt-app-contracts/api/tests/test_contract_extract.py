from app.contracts import extract as ex_mod
from app.contracts.extract import extract_contract, parent_summary
from app.models import ContractExtraction
from tests.contract_helpers import fake_model, md


def test_fake_llm_returns_empty_extraction():
    ex = extract_contract(md("c1.md"))
    assert ex == ContractExtraction.empty()


def test_model_result_is_used_and_prompt_carries_parent(monkeypatch):
    seen = {}

    def call(system, user):
        seen["system"], seen["user"] = system, user
        return ContractExtraction.empty()

    monkeypatch.setattr(ex_mod, "_call_model", call)
    monkeypatch.setattr(ex_mod.settings, "fake_llm", False)
    parent = {"fields": {"number": {"value": "01/2026/HĐMB-PN"}, "end_date": {"value": "2026-12-31"},
                         "payment_terms": {"value": "30 ngày"}},
              "items": [{"name": "Thùng carton 5 lớp", "code": "CT5L-60", "unit": "thùng", "unit_price": 8500}]}
    extract_contract(md("a1.md"), parent=parent)
    assert "01/2026/HĐMB-PN" in seen["user"] and "CT5L-60" in seen["user"]
    assert "addendum" in seen["system"].lower()


def test_model_failure_falls_back_to_empty(monkeypatch):
    monkeypatch.setattr(ex_mod, "_call_model", lambda s, u: None)
    monkeypatch.setattr(ex_mod.settings, "fake_llm", False)
    assert extract_contract(md("c1.md")) == ContractExtraction.empty()


def test_helper_routes_by_number(monkeypatch):
    fake_model(monkeypatch)
    assert ex_mod.extract_contract(md("c5.md")).number.value == "09/2026/HĐMB-PN2"
    assert ex_mod.extract_contract(md("a1.md")).effective_date.value.isoformat() == "2026-07-01"


def test_parent_summary_lists_confirmed_facts():
    s = parent_summary({"fields": {"number": {"value": "X"}, "end_date": {"value": "2026-12-31"}},
                        "items": [{"name": "A", "code": None, "unit": "cái", "unit_price": 10}]})
    assert "X" in s and "2026-12-31" in s and "A" in s
