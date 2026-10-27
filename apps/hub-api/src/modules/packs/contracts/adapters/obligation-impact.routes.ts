// MS-impact · CR-101b: `GET /pack/contracts/obligations/:id/impact?fault=&actual_on=` — xem trước tác động khi xác nhận mốc (CHỈ ĐỌC).
// Guard `read` TRƯỚC đọc tham số; `:id` sai dạng ⇒ 400; tham số lạ ⇒ 400 (strict); tenant khác / HĐ không thấy ⇒ 404; đợt đã xong ⇒
// 409 `OBLIGATION_DONE`.
import { LEDGER_ERRORS, ObligationImpactQuerySchema } from "@ai/contracts";
import { Hono } from "hono";
import { z } from "zod";
import { AppError, appError } from "../../../../lib/errors";
import { parseQuery, parseWith } from "../../../../lib/http";
import {
  type PackAccessView,
  type PackGuardVars,
  packGuard,
} from "../../kit/adapters/pack-guard.middleware";
import { ImpactFail, type ObligationImpact } from "../application/obligation-impact.usecase";

export function obligationImpactRoutes(
  view: PackAccessView,
  impact: Pick<ObligationImpact, "preview">,
): Hono<PackGuardVars> {
  const r = new Hono<PackGuardVars>();
  r.get("/obligations/:id/impact", packGuard(view, "contracts", "read"), async (c) => {
    const id = parseWith(z.uuid(), c.req.param("id"));
    const q = parseQuery(c, ObligationImpactQuerySchema);
    const u = c.get("user");
    try {
      return c.json(await impact.preview({ tenantId: u.tenantId, userId: u.userId }, id, q));
    } catch (e) {
      if (!(e instanceof ImpactFail)) throw e;
      if (e.kind === "not_found") throw appError("NOT_FOUND");
      throw new AppError("OBLIGATION_DONE", LEDGER_ERRORS.OBLIGATION_DONE, "Đợt này đã xong");
    }
  });
  return r;
}
