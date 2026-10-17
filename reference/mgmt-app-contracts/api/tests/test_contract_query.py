import json
import types

import pytest
from fastapi.testclient import TestClient

from app.contracts import query as cq
from app.main import app
from tests.test_contract_tools import corpus  # noqa: F401 - module fixture, seeds the contract corpus


def _sse(c, body):
    with c.stream("POST", "/query", json=body) as r:
        events = [json.loads(line[6:]) for line in r.iter_lines() if line.startswith("data: ")]
    return "".join(e.get("token", "") for e in events), events[-1]


def test_fallback_is_clause_search(corpus):
    items = cq.gather("phạt chậm giao hàng", None)
    assert items and all(i["kind"] == "clause" for i in items)


def test_general_query_excludes_contracts(corpus):
    with TestClient(app) as c:
        _, done = _sse(c, {"question": "phạt chậm giao hàng 0,5% Phương Nam"})
    assert not {x["doc_id"] for x in done["citations"]} & set(corpus.values())


def test_contract_scope_cites_contracts(corpus):
    with TestClient(app) as c:
        text, done = _sse(c, {"question": "phạt chậm giao hàng", "scope": "contracts",
                              "contract_ids": [corpus["c1.md"]]})
    assert done["citations"] and {x["doc_id"] for x in done["citations"]} == {corpus["c1.md"]}


def test_a2ui_streams_a_surface_and_replays_it(corpus):
    body = {"question": "phạt chậm giao hàng", "scope": "contracts", "contract_ids": [corpus["c1.md"]], "ui": "a2ui"}
    with TestClient(app) as c:
        with c.stream("POST", "/query", json=body) as r:
            events = [json.loads(line[6:]) for line in r.iter_lines() if line.startswith("data: ")]
        done = events[-1]
        assert "createSurface" in events[0] and all(e.get("version") == "v0.9" for e in events[:-1])
        model = {}
        for e in events[:-1]:
            if "updateDataModel" in e:
                u = e["updateDataModel"]
                model = u["value"] if u["path"] == "/" else {**model, u["path"][1:]: u["value"]}
        assert model["done"] and model["steps"] and model["answer"]
        assert [x["id"] for x in model["contracts"]] == [corpus["c1.md"]]
        assert model["sources"] == done["citations"]
        saved = c.get(f"/chats/{done['chat_id']}").json()["messages"][1]["a2ui"]
    assert saved[0] == events[0] and saved[-1]["updateDataModel"]["value"]["contracts"] == model["contracts"]


class _Call:
    def __init__(self, name, args):
        self.id = f"call_{name}"
        self.type = "function"
        self.function = types.SimpleNamespace(name=name, arguments=json.dumps(args, ensure_ascii=False))


def _reply(calls):
    msg = types.SimpleNamespace(content=None, tool_calls=calls,
                                model_dump=lambda **k: {"role": "assistant", "content": None,
                                                        "tool_calls": [{"id": c.id, "type": "function",
                                                                        "function": {"name": c.function.name,
                                                                                     "arguments": c.function.arguments}}
                                                                       for c in calls or []]})
    return types.SimpleNamespace(choices=[types.SimpleNamespace(message=msg)])


def _offline(monkeypatch):
    """fake_llm is switched off to reach the planner; keep embeddings and rerank local."""
    from app.contracts import tools
    from app.ingest.embed import _fake_embed
    monkeypatch.setattr(tools, "embed_texts", lambda ts: [_fake_embed(t) for t in ts])
    monkeypatch.setattr(cq, "rerank", lambda q, c: c)


def test_planner_runs_tools_until_done(corpus, monkeypatch):
    _offline(monkeypatch)
    script = [_reply([_Call("find_contracts", {"product": "thùng carton"})]),
              _reply([_Call("contract_facts", {"contract_id": corpus["c1.md"]})]),
              _reply(None)]
    seen = []

    def create(**kw):
        seen.append(kw)
        return script[len(seen) - 1]

    fake = types.SimpleNamespace(chat=types.SimpleNamespace(completions=types.SimpleNamespace(create=create)))
    monkeypatch.setattr(cq, "openai_client", lambda: fake)
    monkeypatch.setattr(cq.settings, "fake_llm", False)
    monkeypatch.setattr(cq.settings, "llm_provider", "openai")
    items = cq.gather("NCC nào cung cấp thùng carton, hết hạn khi nào?", None, today="2026-10-07")
    assert len(seen) == 3
    assert corpus["c1.md"] in {i["doc_id"] for i in items} and corpus["c5.md"] in {i["doc_id"] for i in items}
    assert any("Giá hiệu lực" in i["text"] for i in items)
    assert seen[1]["messages"][-1]["role"] == "tool"
    assert corpus["c1.md"] in seen[1]["messages"][-1]["content"]
    assert cq._step("find_contracts", '{"product": "thùng carton", "limit": 5}') == "Tìm hợp đồng: thùng carton"
    assert cq._step("find_contracts", '{"due_within_days": 60}') == "Tìm hợp đồng: hạn chót trong 60 ngày"


def test_planner_without_tool_calls_falls_back(corpus, monkeypatch):
    _offline(monkeypatch)
    fake = types.SimpleNamespace(chat=types.SimpleNamespace(completions=types.SimpleNamespace(
        create=lambda **kw: _reply(None))))
    monkeypatch.setattr(cq, "openai_client", lambda: fake)
    monkeypatch.setattr(cq.settings, "fake_llm", False)
    monkeypatch.setattr(cq.settings, "llm_provider", "openai")
    items = cq.gather("phạt chậm giao hàng", None)
    assert items and all(i["kind"] == "clause" for i in items)


def test_planner_error_falls_back(corpus, monkeypatch):
    _offline(monkeypatch)

    def boom(**kw):
        raise RuntimeError("down")
    fake = types.SimpleNamespace(chat=types.SimpleNamespace(completions=types.SimpleNamespace(create=boom)))
    monkeypatch.setattr(cq, "openai_client", lambda: fake)
    monkeypatch.setattr(cq.settings, "fake_llm", False)
    monkeypatch.setattr(cq.settings, "llm_provider", "openai")
    assert cq.gather("phạt chậm giao hàng", None)


def test_planner_error_after_partial_keeps_items(corpus, monkeypatch):
    _offline(monkeypatch)
    n = []

    def create(**kw):
        n.append(1)
        if len(n) == 1:
            return _reply([_Call("find_contracts", {"product": "thùng carton"})])
        raise RuntimeError("down")
    fake = types.SimpleNamespace(chat=types.SimpleNamespace(completions=types.SimpleNamespace(create=create)))
    monkeypatch.setattr(cq, "openai_client", lambda: fake)
    monkeypatch.setattr(cq.settings, "fake_llm", False)
    monkeypatch.setattr(cq.settings, "llm_provider", "openai")
    items = cq.gather("NCC nào cung cấp thùng carton?", None, today="2026-10-07")
    facts = [i for i in items if i["kind"] == "fact"]
    assert facts and items[: len(facts)] == facts   # gathered facts kept and lead; clause hits only back them up


def test_contract_system_prompt_knows_today():
    assert "2026-10-07" in cq.contract_system("2026-10-07")
