// HUB-FR-44 · HUB-FR-75 · H2c-R01, R13 · `POST /attachments` (thân thô + `X-Filename`), `GET /attachments/:id`,
// `GET /attachments/:id/content` (plan §2.4). JWT ở gốc (`PROTECTED_PREFIXES`, 401 trước 404). Route mỏng: đọc header/
// tham số → service. `:id` không phải uuid ⇒ 404 giống hệt id không có.
import { UuidSchema } from "@ai/contracts";
import { FILENAME_HEADER } from "@ai/contracts/chat";
import { type Context, Hono } from "hono";
import type { AuthVars } from "../../lib/auth.middleware";
import { blobResponse } from "../../lib/blob-body";
import { parseIdParam } from "../../lib/http";
import type { AttachmentService } from "./attachments.service";

/** `Content-Length` hợp lệ (số nguyên ≥ 0) → số; vắng/sai → null (đếm ở `stage` là chốt — PL3). */
export function contentLengthOf(raw: string | undefined): number | null {
  if (raw === undefined || !/^\d{1,16}$/.test(raw.trim())) return null;
  return Number(raw.trim());
}

/** PC-R14 (B5b) · `?tenant_id` (uuid) — chỉ platform_admin được tôn trọng (`autofixReadTenant`); sai ⇒ bỏ qua. Gương
 * `tenantIdQuery` của `/process-runs` (không import route module khác). */
export const tenantIdQ = (c: Context<AuthVars>): string | undefined => {
  const t = c.req.query("tenant_id");
  return t && UuidSchema.safeParse(t).success ? t.toLowerCase() : undefined;
};

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

  // uuid chữ hoa ≡ chữ thường (RV-7) — id chuẩn hoá trước khi tới service.
  r.get("/:id", async (c) =>
    c.json(await svc.get(c.var.user, parseIdParam(c).toLowerCase(), tenantIdQ(c))),
  );

  r.get("/:id/content", async (c) => {
    const id = parseIdParam(c).toLowerCase();
    const out = await svc.content(c.var.user, id, c.var.log, {
      tenantIdQ: tenantIdQ(c),
      navigate: isNavigate(c),
    });
    // FB1 (HUB-FR-139): kho FileBox + điều hướng ⇒ 302 tới link FileBox (không log URL).
    if (out.kind === "redirect") return c.redirect(out.url, 302);
    const { body, headers } = out;
    // Thân `Bun.file` ⇒ Bun tự trả 206 theo `Range` ⇒ có `Range`: thân stream, 200 toàn bộ (R13 "Range bỏ qua"; mất
    // `Content-Length` — Bun gửi chunked). Không `Range`: `blobResponse` giữ `Content-Length` (spec-decisions B3-1).
    if (c.req.header("range") === undefined) return blobResponse(c, body, 200, headers);
    const { "Content-Length": _len, ...rest } = headers;
    // Bun 1.4: `Bun.file(…).stream()` vẫn nhận ra thân là file ⇒ vẫn 206; `pipeThrough` đổi thành stream thường (GX #200).
    return new Response(body.stream().pipeThrough(new TransformStream()), {
      status: 200,
      headers: rest,
    });
  });

  return r;
}

/** FB1 §3.4: trình duyệt điều hướng tài liệu (mở tab/`<iframe>`/`<a>`) ⇒ nhánh 302; `fetch` của FE (cors) ⇒ inline. */
export function isNavigate(c: Context<AuthVars>): boolean {
  const mode = c.req.header("sec-fetch-mode");
  const dest = c.req.header("sec-fetch-dest");
  return mode === "navigate" || dest === "document" || dest === "iframe";
}
