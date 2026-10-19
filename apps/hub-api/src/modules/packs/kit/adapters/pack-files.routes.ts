// PK-FR-06 · PK-AC07 · N1 plan §6: `GET /pack/<k>/files/:id/content` (mount dưới `/pack/<k>`, sau `requireAuth`). Quyền `read`
// (guard trước mọi truy cập file ⇒ 403 không gọi FileBox). `:id` = id HÀNG `<k>.files`; sai dạng / không thấy / tenant khác /
// đã xoá ⇒ 404 `NOT_FOUND` giống hệt nhau (không lộ tồn tại). Có ⇒ 302 tới link FileBox (không log URL, không phơi `file_id`).
import { Hono } from "hono";
import { appError } from "../../../../lib/errors";
import { parseIdParam } from "../../../../lib/http";
import type { PackFiles } from "../application/pack-files.ports";
import { type PackAccessView, type PackGuardVars, packGuard } from "./pack-guard.middleware";

export function packFilesRoutes(
  view: PackAccessView,
  packKey: string,
  files: PackFiles,
): Hono<PackGuardVars> {
  const r = new Hono<PackGuardVars>();
  r.get("/files/:id/content", packGuard(view, packKey, "read"), async (c) => {
    const id = parseIdParam(c);
    const u = c.get("user");
    const url = await files.link({ tenantId: u.tenantId, userId: u.userId }, id);
    if (!url) throw appError("NOT_FOUND");
    return c.redirect(url, 302);
  });
  return r;
}
