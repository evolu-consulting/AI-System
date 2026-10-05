// HUB-FR-44 · HUB-FR-75 · H2c-R01, R13 · `POST /attachments` (thân thô + `X-Filename`), `GET /attachments/:id`,
// `GET /attachments/:id/content` (plan §2.4). JWT ở gốc (`PROTECTED_PREFIXES`, 401 trước 404). Route mỏng: đọc header/
// tham số → service. `:id` không phải uuid ⇒ 404 giống hệt id không có.
import { FILENAME_HEADER } from "@ai/contracts/chat";
import { Hono } from "hono";
import type { AuthVars } from "../../lib/auth.middleware";
import { blobResponse } from "../../lib/blob-body";
import { parseIdParam } from "../../lib/http";
import type { AttachmentService } from "./attachments.service";

/** `Content-Length` hợp lệ (số nguyên ≥ 0) → số; vắng/sai → null (đếm ở `stage` là chốt — PL3). */
export function contentLengthOf(raw: string | undefined): number | null {
  if (raw === undefined || !/^\d{1,16}$/.test(raw.trim())) return null;
  return Number(raw.trim());
}

export function attachmentRoutes(svc: AttachmentService): Hono<AuthVars> {
  const r = new Hono<AuthVars>();

  r.post("/", async (c) => {
    const out = await svc.upload(
      c.var.user,
      {
        filenameRaw: c.req.header(FILENAME_HEADER),
        contentLength: contentLengthOf(c.req.header("content-length")),
        body: c.req.raw.body,
      },
      c.var.log,
    );
    return c.json(out, 201);
  });

  r.get("/:id", async (c) => c.json(await svc.get(c.var.user, parseIdParam(c))));

  r.get("/:id/content", async (c) => {
    const { body, headers } = await svc.content(c.var.user, parseIdParam(c), c.var.log);
    // Thân `Bun.file` ⇒ Bun tự trả 206 theo `Range` ⇒ có `Range`: thân stream, 200 toàn bộ (R13 "Range bỏ qua"; mất
    // `Content-Length` — Bun gửi chunked). Không `Range`: `blobResponse` giữ `Content-Length` (spec-decisions B3-1).
    if (c.req.header("range") === undefined) return blobResponse(c, body, 200, headers);
    const { "Content-Length": _len, ...rest } = headers;
    return new Response(body.stream(), { status: 200, headers: rest });
  });

  return r;
}
