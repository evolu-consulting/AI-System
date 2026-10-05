// HUB-FR-75 · H2c-R13, R17 · trả nội dung file (`Blob` đọc lười từ đĩa) **giữ `Content-Length`**. Hono bọc lại `Response`
// khi middleware gọi `c.header` sau handler (CORS `Vary`) ⇒ thân thành `ReadableStream` ⇒ Bun gửi chunked, mất độ dài.
// Handler gọi `blobResponse`; `keepBlobBody()` (gắn **trước** CORS, sau cùng khi trả về) dựng lại `Response(blob)` với
// status/header cuối cùng. Không đọc file vào RAM.
import type { Context, MiddlewareHandler } from "hono";

const pending = new WeakMap<Request, Blob>();

/** `Response(blob)` + ghi nhớ blob theo request để `keepBlobBody` dựng lại sau middleware. */
export function blobResponse(
  c: Context,
  blob: Blob,
  status: 200,
  headers: Record<string, string>,
): Response {
  pending.set(c.req.raw, blob);
  return new Response(blob, { status, headers });
}

/** Sau `next()`: response của `blobResponse` ⇒ thay thân stream bằng chính blob (giữ status + header đã gắn). */
export function keepBlobBody(): MiddlewareHandler {
  return async (c, next) => {
    await next();
    const blob = pending.get(c.req.raw);
    if (!blob) return;
    pending.delete(c.req.raw);
    const r = c.res;
    if (r.status !== 200) return;
    // Bỏ `Response` cũ trước (setter của Hono không bọc lại khi chưa có `res`).
    c.res = undefined;
    c.res = new Response(blob, { status: r.status, headers: r.headers });
  };
}
