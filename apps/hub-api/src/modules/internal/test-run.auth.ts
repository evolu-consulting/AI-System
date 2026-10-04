// HUB-FR-51 · H2a-R24 · plan §2.4 · token dịch vụ `HUB_INTERNAL_TOKEN` cho `POST /internal/test-run`: so
// `timingSafeEqual` trên sha256 (độ dài cố định — không lộ độ dài/tiền tố qua thời gian). Vắng token cấu hình → 503
// `UNAVAILABLE`; mọi sai (thiếu header, sai scheme, sai token, JWT) → cùng 401 `UNAUTHORIZED`. Không log header.
import { createHash, timingSafeEqual } from "node:crypto";
import type { MiddlewareHandler } from "hono";
import { toErrorBody } from "../../lib/errors";
import { internalError } from "./test-run.errors";

const BEARER_RE = /^Bearer[ \t]+(\S+)[ \t]*$/i;

const sha256 = (s: string): Buffer => createHash("sha256").update(s, "utf8").digest();

/** `authorization` có khớp `expected` không (so hằng thời gian trên băm). */
export function serviceTokenMatches(expected: string, authorization: string | undefined): boolean {
  const m = authorization === undefined ? null : BEARER_RE.exec(authorization);
  const got = m?.[1] ?? "";
  // Luôn băm + so (kể cả header thiếu) để thời gian không phụ thuộc nhánh.
  const ok = timingSafeEqual(sha256(expected), sha256(got));
  return ok && m !== null;
}

/** Middleware cho route nội bộ dùng token dịch vụ. `expected` vắng/rỗng → 503. */
export function requireServiceToken(expected: string | undefined): MiddlewareHandler {
  return async (c, next) => {
    if (!expected) {
      // Cấu hình thiếu, không phải lỗi lập trình: trả 503 trực tiếp (không qua `onError` → log "unhandled").
      const e = internalError("UNAVAILABLE");
      return c.json(toErrorBody(e.code, e.message), e.status);
    }
    if (!serviceTokenMatches(expected, c.req.header("authorization")))
      throw internalError("UNAUTHORIZED");
    await next();
  };
}
