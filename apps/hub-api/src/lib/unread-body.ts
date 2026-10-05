// HUB-FR-44 · H2c P4 · spec-decisions "BUILD — B1" B1-3 (QW-A1 lệch #2): lỗi trả **trước** khi đọc hết thân nhị phân
// (upload 413/415/409, 400 header, 401) ⇒ kèm `Connection: close`; thân `chunked` (không `Content-Length`) còn dư ⇒ đọc bỏ
// (≤ `MAX_REQUEST_BODY_BYTES`, ≤ `DRAIN_MS`) trước khi trả. Lý do (đo trên Bun 1.3.14): Bun.serve tự bỏ phần dư khi có
// `Content-Length` nhưng **không** đóng socket theo `Connection: close`; client `fetch` của Bun bỏ dở thân `chunked` rồi
// dùng lại kết nối ⇒ request kế bị đọc như chunk (400). Thân JSON không áp (route JSON đọc trọn thân, thân nhỏ).
import type { MiddlewareHandler } from "hono";

/** `Bun.serve({maxRequestBodySize})` (plan P4: 32 MiB, chặn ngoài; mặc định Bun 128 MiB). */
export const MAX_REQUEST_BODY_BYTES = 33_554_432;
/** Hạn đọc bỏ phần dư của thân `chunked`. */
export const DRAIN_MS = 10_000;

/** Request có thân (Content-Length > 0 hoặc Transfer-Encoding). */
export function hasRequestBody(req: Request): boolean {
  const len = req.headers.get("content-length");
  if (len !== null) return Number(len) > 0;
  return req.headers.has("transfer-encoding");
}

const isJson = (req: Request): boolean =>
  (req.headers.get("content-type") ?? "").toLowerCase().includes("application/json");

/** Thân cần xử lý khi lỗi: có thân, không phải JSON. */
export function needsClose(req: Request, status: number): boolean {
  return status >= 400 && hasRequestBody(req) && !isJson(req);
}

/**
 * Đọc bỏ phần còn lại của `body` (không giữ byte). Đang bị khoá (đang có reader) ⇒ false. Vượt `maxBytes` hoặc `ms` ⇒ huỷ
 * đọc, false. Hết thân ⇒ true.
 */
export async function drainBody(
  body: ReadableStream<Uint8Array> | null,
  o: { maxBytes: number; ms: number },
): Promise<boolean> {
  if (!body || body.locked) return false;
  const reader = body.getReader();
  const timer = setTimeout(() => void reader.cancel().catch(() => {}), o.ms);
  let n = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return true;
      n += value.length;
      if (n > o.maxBytes) {
        await reader.cancel().catch(() => {});
        return false;
      }
    }
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
    reader.releaseLock();
  }
}

/** Middleware toàn app (đặt sát `requestContext`): xem chú thích đầu file. */
export function closeUnreadBody(
  o = { maxBytes: MAX_REQUEST_BODY_BYTES, ms: DRAIN_MS },
): MiddlewareHandler {
  return async (c, next) => {
    await next();
    const req = c.req.raw;
    if (!needsClose(req, c.res.status)) return;
    if (!req.headers.has("content-length")) await drainBody(req.body, o);
    c.res.headers.set("Connection", "close");
  };
}
