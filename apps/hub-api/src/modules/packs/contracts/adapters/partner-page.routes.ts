// CR-151e: `GET /pack/contracts/partners/page?filter&sort&q&limit&offset` — danh sách Đối tác phân trang ở máy chủ. Quyền `read` (guard
// trước khi đọc); `limit` trần 200 (vượt ⇒ 400, không cắt im lặng); cùng phạm vi người dùng thấy như `GET /partners` (RLS M1).
import { PartyPageQuerySchema } from "@ai/contracts/pack-contracts";
import { Hono } from "hono";
import { parseQuery } from "../../../../lib/http";
import { type PackAccessView, type PackGuardVars, packGuard } from "../../kit/public";
import type { PartnerPageUsecase } from "../application/partner-page.usecase";

export function partnerPageRoutes(view: PackAccessView, uc: PartnerPageUsecase) {
  const r = new Hono<PackGuardVars>();
  r.get("/partners/page", packGuard(view, "contracts", "read"), async (c) => {
    const u = c.get("user");
    return c.json(
      await uc.page(
        { tenantId: u.tenantId, userId: u.userId },
        parseQuery(c, PartyPageQuerySchema),
      ),
    );
  });
  return r;
}
