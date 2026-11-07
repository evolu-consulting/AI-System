// CR-114 hub-otel · span `http.request` cho mỗi request (cha = header `traceparent` đến, vd. Runtime gọi `/mcp`). Tắt OTel ⇒
// `fn` chạy thẳng, span NOOP. Không path tham số, không body, không header nhạy cảm — chỉ method, route mẫu, status, tenant.
import type { Context, Env } from "hono";
import { otelEnabled, startSpan, withRequestSpan } from "./otel";

export async function traceRequest<E extends Env>(
  c: Context<E>,
  fn: () => Promise<void>,
): Promise<void> {
  if (!otelEnabled()) return fn();
  const method = c.req.method;
  const span = startSpan("http.request", { "http.method": method }, c.req.header("traceparent"));
  return withRequestSpan(span, async () => {
    try {
      await fn();
    } finally {
      const tenant = (c.var as { user?: { tenantId?: string } }).user?.tenantId;
      span.updateName(`${method} ${c.req.routePath}`);
      span.setAttribute("http.status_code", c.res.status);
      if (tenant) span.setAttribute("tenant_id", tenant);
      if (c.res.status >= 500) span.setAttribute("error", `http_${c.res.status}`);
      span.end();
    }
  });
}

/** CR-124 · q5 · nhật ký request: giấu token của link công khai (`/partner-reply/<token>[/…]` ⇒ `/partner-reply/:token[/…]`) — token không bao giờ vào log. */
export function redactPath(path: string): string {
  return path.replace(/^(\/partner-reply)\/[^/]+/, "$1/:token");
}
