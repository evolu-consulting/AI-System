// CR-114 hub-otel · OpenTelemetry tracing của hub-api. TẮT mặc định: env `OTEL_EXPORTER_OTLP_ENDPOINT` vắng ⇒ `initOtel`
// không dựng SDK, mọi hàm ở đây trả span no-op dùng chung (không cấp phát, không timer) ⇒ zero overhead.
// Một trace cho mỗi run chat: request E12 → `run` → `agent.step` → `job.enqueue` (traceparent vào `payload.traceparent`) →
// Runtime (Python) → `/mcp` (header traceparent). Context đi TƯỜNG MINH (span cha truyền tay / theo `run_id`), không dựa
// AsyncLocalStorage qua async generator (resume ở context của người gọi). ALS chỉ giữ span request cho `beginRun`.
// Riêng tư: span chỉ có id, tên agent/tool, đếm token, tên lỗi — KHÔNG có prompt/trả lời/nội dung/message lỗi.
import { AsyncLocalStorage } from "node:async_hooks";
import {
  type Attributes,
  type Context,
  ROOT_CONTEXT,
  type Span,
  SpanStatusCode,
  trace,
} from "@opentelemetry/api";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { BasicTracerProvider, BatchSpanProcessor } from "@opentelemetry/sdk-trace-base";

export type SpanAttrs = Record<string, string | number | boolean | undefined | null>;
export type TokenCounts = { input_tokens: number; output_tokens: number };

const ZERO = { traceId: "0".repeat(32), spanId: "0".repeat(16), traceFlags: 0 };
/** Span no-op dùng chung khi tắt. */
export const NOOP_SPAN: Span = trace.wrapSpanContext(ZERO);

const TRACEPARENT_RE = /^00-([0-9a-f]{32})-([0-9a-f]{16})-([0-9a-f]{2})$/;
/** Trần số run đang giữ span (run không bao giờ kết thúc, vd. sweeper đóng thay) — quá trần ⇒ đóng span cũ nhất. */
export const MAX_RUN_SPANS = 2000;

let provider: BasicTracerProvider | null = null;
const requestStore = new AsyncLocalStorage<Span>();
const runSpans = new Map<string, Span>();

/** Bật khi `OTEL_EXPORTER_OTLP_ENDPOINT` (hoặc `…_TRACES_ENDPOINT`) đặt và `initOtel` đã dựng SDK. */
export const otelEnabled = (): boolean => provider !== null;

function tracesUrl(env: Record<string, string | undefined>): string | null {
  const direct = env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT?.trim();
  if (direct) return direct;
  const base = env.OTEL_EXPORTER_OTLP_ENDPOINT?.trim();
  return base ? `${base.replace(/\/+$/, "")}/v1/traces` : null;
}

/** Gọi một lần ở `server.ts`. Vắng endpoint ⇒ không làm gì. Trả hàm tắt (flush) hoặc null. */
export function initOtel(
  env: Record<string, string | undefined>,
  service = "hub-api",
): (() => Promise<void>) | null {
  const url = tracesUrl(env);
  if (!url || provider) return null;
  const p = new BasicTracerProvider({
    resource: resourceFromAttributes({
      "service.name": env.OTEL_SERVICE_NAME?.trim() || service,
    }),
    spanProcessors: [new BatchSpanProcessor(new OTLPTraceExporter({ url }))],
  });
  trace.setGlobalTracerProvider(p);
  provider = p;
  return () => p.shutdown();
}

/** Test: xả span chờ gửi. */
export async function flushOtel(): Promise<void> {
  await provider?.forceFlush();
}

/** Test: gỡ SDK, về trạng thái tắt. */
export async function resetOtel(): Promise<void> {
  for (const s of runSpans.values()) s.end();
  runSpans.clear();
  const p = provider;
  provider = null;
  trace.disable();
  await p?.shutdown();
}

const hasCtx = (s: Span): boolean => s.spanContext().traceId !== ZERO.traceId;

/** `00-<trace>-<span>-<flags>` của span; tắt/no-op ⇒ undefined. */
export function traceparentOf(span: Span): string | undefined {
  if (!hasCtx(span)) return undefined;
  const c = span.spanContext();
  return `00-${c.traceId}-${c.spanId}-${c.traceFlags.toString(16).padStart(2, "0")}`;
}

/** 8 ký tự đầu trace id (log `trace=`); không có ⇒ undefined. */
export const shortTraceId = (span: Span | undefined): string | undefined =>
  span && hasCtx(span) ? span.spanContext().traceId.slice(0, 8) : undefined;

function parentCtx(parent: Span | string | undefined): Context {
  if (parent === undefined) {
    const cur = requestStore.getStore();
    return cur ? trace.setSpan(ROOT_CONTEXT, cur) : ROOT_CONTEXT;
  }
  if (typeof parent !== "string") return trace.setSpan(ROOT_CONTEXT, parent);
  const m = TRACEPARENT_RE.exec(parent.trim().toLowerCase());
  if (!m?.[1] || !m[2]) return ROOT_CONTEXT;
  const spanContext = {
    traceId: m[1],
    spanId: m[2],
    traceFlags: Number.parseInt(m[3] ?? "00", 16),
    isRemote: true,
  };
  return trace.setSpanContext(ROOT_CONTEXT, spanContext);
}

function attrsOf(a: SpanAttrs): Attributes {
  const out: Attributes = {};
  for (const [k, v] of Object.entries(a)) if (v !== undefined && v !== null) out[k] = v;
  return out;
}

/** Mở span; cha = span/traceparent truyền vào, vắng ⇒ span request hiện tại (ALS), vắng nữa ⇒ trace mới. Tắt ⇒ no-op. */
export function startSpan(name: string, attrs: SpanAttrs = {}, parent?: Span | string): Span {
  if (!provider) return NOOP_SPAN;
  return trace
    .getTracer("evolu-hub")
    .startSpan(name, { attributes: attrsOf(attrs) }, parentCtx(parent));
}

/** Gắn tên lỗi (không message) + trạng thái ERROR. */
export function spanError(span: Span, err: unknown): void {
  if (!hasCtx(span)) return;
  const name = err instanceof Error ? err.name : typeof err;
  span.setAttribute("error", name);
  span.setStatus({ code: SpanStatusCode.ERROR });
}

/** Đếm token của bước (Hub chỉ có in/out; cache token do Runtime ghi ở span `llm.call`). */
export function setTokens(span: Span, u: TokenCounts): void {
  if (!hasCtx(span)) return;
  span.setAttributes({ "tokens.in": u.input_tokens, "tokens.out": u.output_tokens });
}

/** Chạy `fn` trong span; lỗi ném lại sau khi ghi tên lỗi. Tắt ⇒ gọi thẳng `fn(NOOP_SPAN)`. */
export async function traced<T>(
  name: string,
  attrs: SpanAttrs,
  fn: (span: Span) => Promise<T>,
  parent?: Span | string,
): Promise<T> {
  if (!provider) return fn(NOOP_SPAN);
  const span = startSpan(name, attrs, parent);
  try {
    return await fn(span);
  } catch (err) {
    spanError(span, err);
    throw err;
  } finally {
    span.end();
  }
}

/** Chạy `fn` với `span` là span request hiện tại của luồng async (để `beginRun`/`startSpan` mặc định nhận làm cha). */
export function withRequestSpan<T>(span: Span, fn: () => T): T {
  return provider ? requestStore.run(span, fn) : fn();
}

export const currentRequestSpan = (): Span | undefined => requestStore.getStore();

/** Mở span `run` (gốc của run chat; con của request E12 nếu có) và nhớ theo `run_id`. */
export function beginRun(runId: string, attrs: SpanAttrs): Span {
  if (!provider) return NOOP_SPAN;
  const span = startSpan("run", { run_id: runId, ...attrs });
  runSpans.set(runId, span);
  if (runSpans.size > MAX_RUN_SPANS) {
    const [oldId, old] = runSpans.entries().next().value ?? [];
    if (oldId && old) {
      old.setAttribute("error", "evicted");
      old.end();
      runSpans.delete(oldId);
    }
  }
  return span;
}

export const runSpanOf = (runId: string): Span | undefined => runSpans.get(runId);

/** Kết thúc span `run` (idempotent). `error` = mã lỗi run (không message). */
export function endRun(
  runId: string,
  o: { status: string; error?: string; deltas?: number },
): void {
  const span = runSpans.get(runId);
  if (!span) return;
  runSpans.delete(runId);
  span.setAttribute("run.status", o.status);
  if (o.deltas !== undefined) span.setAttribute("sse.deltas", o.deltas);
  if (o.error) {
    span.setAttribute("error", o.error);
    span.setStatus({ code: SpanStatusCode.ERROR });
  }
  span.end();
}
