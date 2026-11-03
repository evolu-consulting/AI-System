"""CR-114 hub-otel · OpenTelemetry tracing của Runtime. TẮT mặc định: env
`OTEL_EXPORTER_OTLP_ENDPOINT` (hoặc `…_TRACES_ENDPOINT`) vắng ⇒ `init` không dựng SDK, `span()` trả
một span no-op dùng chung (không cấp phát, không import SDK) ⇒ zero overhead.

Một trace cho mỗi run chat: Hub ghi `traceparent` của span `job.enqueue` vào `payload.traceparent`;
`JobRun.execute` nối span `job.run` làm con của nó, rồi `llm.call`; Hub `/mcp` nhận `traceparent`
qua header của file cấu hình MCP. Riêng tư: span chỉ có id, tên agent/tool, đếm token, tên lỗi —
KHÔNG có prompt/trả lời/nội dung/message lỗi.
"""

from __future__ import annotations

import os
from collections.abc import Generator, Mapping
from contextlib import contextmanager
from typing import TYPE_CHECKING, Protocol

from opentelemetry import trace
from opentelemetry.context import Context
from opentelemetry.trace import Status, StatusCode, Tracer
from opentelemetry.trace.propagation.tracecontext import TraceContextTextMapPropagator

if TYPE_CHECKING:
    from opentelemetry.sdk.trace import TracerProvider

AttrValue = str | int | float | bool


class SpanLike(Protocol):
    """Phần dùng chung của span thật và span no-op."""

    def set_attribute(self, key: str, value: AttrValue) -> None: ...


class _NoopSpan:
    def set_attribute(self, key: str, value: AttrValue) -> None:
        return None


_NOOP = _NoopSpan()
_PROP = TraceContextTextMapPropagator()
_state: dict[str, object] = {}  # "tracer": Tracer, "provider": TracerProvider


def enabled() -> bool:
    return "tracer" in _state


def traces_url(env: Mapping[str, str]) -> str | None:
    direct = env.get("OTEL_EXPORTER_OTLP_TRACES_ENDPOINT", "").strip()
    if direct:
        return direct
    base = env.get("OTEL_EXPORTER_OTLP_ENDPOINT", "").strip()
    return f"{base.rstrip('/')}/v1/traces" if base else None


def install(provider: TracerProvider) -> None:
    """Dùng `provider` làm nguồn span (`init` gọi; test truyền provider + exporter trong bộ nhớ)."""
    _state["provider"] = provider
    _state["tracer"] = provider.get_tracer("agent_runtime")


def init(service_name: str = "agent-runtime", env: Mapping[str, str] | None = None) -> bool:
    """Một lần khi khởi động. Vắng endpoint ⇒ False, không import SDK."""
    e = os.environ if env is None else env
    url = traces_url(e)
    if url is None or enabled():
        return False
    from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter
    from opentelemetry.sdk.resources import Resource
    from opentelemetry.sdk.trace import TracerProvider
    from opentelemetry.sdk.trace.export import BatchSpanProcessor

    name = e.get("OTEL_SERVICE_NAME", "").strip() or service_name
    provider = TracerProvider(resource=Resource.create({"service.name": name}))
    provider.add_span_processor(BatchSpanProcessor(OTLPSpanExporter(endpoint=url)))
    install(provider)
    return True


def shutdown() -> None:
    """Xả span chờ gửi (thoát tiến trình); no-op khi tắt."""
    provider = _state.get("provider")
    if provider is not None:
        flush = getattr(provider, "shutdown", None)
        if callable(flush):
            flush()


def reset() -> None:
    """Test: về trạng thái tắt."""
    _state.clear()


def _parent(traceparent: str | None) -> Context | None:
    if not traceparent:
        return None
    return _PROP.extract({"traceparent": traceparent.strip().lower()})


@contextmanager
def span(
    name: str,
    attrs: Mapping[str, AttrValue | None] | None = None,
    *,
    traceparent: str | None = None,
) -> Generator[SpanLike]:
    """Span con của span hiện tại (hoặc của `traceparent`); lỗi ném lại sau khi ghi tên lỗi."""
    tracer = _state.get("tracer")
    if not isinstance(tracer, Tracer):
        yield _NOOP
        return
    clean = {k: v for k, v in (attrs or {}).items() if v is not None}
    with tracer.start_as_current_span(
        name,
        context=_parent(traceparent),
        attributes=clean,
        record_exception=False,
        set_status_on_exception=False,
    ) as sp:
        try:
            yield sp
        except BaseException as err:
            sp.set_attribute("error", type(err).__name__)
            sp.set_status(Status(StatusCode.ERROR))
            raise


def annotate(attrs: Mapping[str, AttrValue | None]) -> None:
    """Gắn thuộc tính lên span hiện tại (no-op khi tắt)."""
    if not enabled():
        return
    sp = trace.get_current_span()
    for k, v in attrs.items():
        if v is not None:
            sp.set_attribute(k, v)


def current_traceparent() -> str | None:
    """W3C `traceparent` của span hiện tại (cho header gọi Hub); tắt/không có span ⇒ None."""
    if not enabled():
        return None
    carrier: dict[str, str] = {}
    _PROP.inject(carrier)
    return carrier.get("traceparent")


def current_trace_id() -> str | None:
    """8 ký tự đầu trace id (log `trace=`); tắt/không có span ⇒ None."""
    if not enabled():
        return None
    ctx = trace.get_current_span().get_span_context()
    return f"{ctx.trace_id:032x}"[:8] if ctx.is_valid else None
