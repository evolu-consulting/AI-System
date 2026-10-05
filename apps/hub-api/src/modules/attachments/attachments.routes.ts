// HUB-FR-44 · H2c-R01 · `POST /attachments` (thân thô + `X-Filename`, plan §2.4). JWT ở gốc (`PROTECTED_PREFIXES`, 401
// trước 404). Route mỏng: đọc header → service.
import { FILENAME_HEADER } from "@ai/contracts/chat";
import { Hono } from "hono";
import type { AuthVars } from "../../lib/auth.middleware";
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

  return r;
}
