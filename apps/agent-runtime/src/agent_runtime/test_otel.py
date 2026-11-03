"""CR-114 hub-otel · tracing Runtime: tắt mặc định (no-op, không SDK); bật ⇒ span job nối vào trace
của Hub qua `traceparent`, mang tên agent/tenant/run/token, KHÔNG có nội dung."""

from collections.abc import Iterator

import pytest
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import SimpleSpanProcessor
from opentelemetry.sdk.trace.export.in_memory_span_exporter import InMemorySpanExporter

from agent_runtime import otel
from agent_runtime.providers.claude.mcp import server_config

TRACE = "0af7651916cd43dd8448eb211c80319c"
PARENT = f"00-{TRACE}-b7ad6b7169203331-01"


@pytest.fixture
def exporter() -> Iterator[InMemorySpanExporter]:
    exp = InMemorySpanExporter()
    provider = TracerProvider()
    provider.add_span_processor(SimpleSpanProcessor(exp))
    otel.install(provider)
    yield exp
    otel.reset()


def test_tat_mac_dinh_khong_dung_sdk() -> None:
    otel.reset()
    assert otel.init(env={}) is False
    assert not otel.enabled()
    with otel.span("job.run", {"agent": "x"}, traceparent=PARENT) as sp:
        sp.set_attribute("tokens.in", 1)
    assert otel.current_traceparent() is None
    assert otel.current_trace_id() is None
    otel.annotate({"a": 1})  # không ném
    otel.shutdown()


def test_traces_url_tu_env() -> None:
    assert otel.traces_url({}) is None
    assert otel.traces_url({"OTEL_EXPORTER_OTLP_ENDPOINT": "http://c:4318/"}) == (
        "http://c:4318/v1/traces"
    )
    assert otel.traces_url({"OTEL_EXPORTER_OTLP_TRACES_ENDPOINT": "http://c/t"}) == "http://c/t"


def test_span_job_la_con_cua_traceparent_hub(exporter: InMemorySpanExporter) -> None:
    with otel.span(
        "job.run", {"agent": "reviewer", "tenant_id": "t1", "skip": None}, traceparent=PARENT
    ):
        assert otel.current_trace_id() == TRACE[:8]
        with otel.span("llm.call") as llm:
            llm.set_attribute("tokens.in", 10)
            tp = otel.current_traceparent()
            assert tp is not None
            assert tp.startswith(f"00-{TRACE}-")
        otel.annotate({"tokens.out": 5, "error": None})
    spans = {s.name: s for s in exporter.get_finished_spans()}
    job, llm_span = spans["job.run"], spans["llm.call"]
    assert f"{job.context.trace_id:032x}" == TRACE  # type: ignore[union-attr]
    assert job.parent is not None
    assert f"{job.parent.span_id:016x}" == "b7ad6b7169203331"
    assert llm_span.parent is not None
    assert llm_span.parent.span_id == job.context.span_id  # type: ignore[union-attr]
    assert dict(job.attributes or {}) == {"agent": "reviewer", "tenant_id": "t1", "tokens.out": 5}
    assert dict(llm_span.attributes or {})["tokens.in"] == 10


def test_loi_ghi_ten_loi_khong_message(exporter: InMemorySpanExporter) -> None:
    with pytest.raises(ValueError), otel.span("job.run"):
        raise ValueError("secret prompt text")
    (s,) = exporter.get_finished_spans()
    assert dict(s.attributes or {})["error"] == "ValueError"
    assert "secret prompt text" not in repr(dict(s.attributes or {}))
    assert s.status.status_code.name == "ERROR"


def test_header_traceparent_vao_cau_hinh_mcp(exporter: InMemorySpanExporter) -> None:
    del exporter
    base = server_config("http://hub/mcp", "tok")
    headers = base["mcpServers"]["hub"]["headers"]  # type: ignore[index]
    assert "traceparent" not in headers
    with otel.span("llm.call"):
        tp = otel.current_traceparent()
    cfg = server_config("http://hub/mcp", "tok", tp)
    assert cfg["mcpServers"]["hub"]["headers"]["traceparent"] == tp  # type: ignore[index]
