// esign-flow · "Gửi lại" bước Ký số khi cần quyết: POST /contracts/:id/approval/esign-resend (guard `write` trước; người phụ trách HĐ
// hoặc owner gói — `admin` từ cache quyền, 0 SQL). Kết quả `{ result: sent | needs_decision }`; không có bước cần quyết ⇒ 409.
import { Hono } from "hono";
import { z } from "zod";
import { AppError, appError } from "../../../../lib/errors";
import { parseWith } from "../../../../lib/http";
import {
  type PackAccessView,
  type PackGuardVars,
  packAccessInput,
  packGuard,
} from "../../kit/adapters/pack-guard.middleware";
import { checkPackAccess } from "../../kit/domain/pack-access.rules";
import type { EsignFlow } from "../application/esign-flow.usecase";

const KEY = "contracts";

export function esignFlowRoutes(view: PackAccessView, f: EsignFlow): Hono<PackGuardVars> {
  const r = new Hono<PackGuardVars>();
  const write = packGuard(view, KEY, "write");
  r.post("/contracts/:id/approval/esign-resend", write, async (c) => {
    const id = parseWith(z.uuid(), c.req.param("id"));
    const u = c.get("user");
    const i = await packAccessInput(view, KEY, u);
    const admin = checkPackAccess({ ...i, grantedGroupIds: i.grantedByAction.admin }) === "ok";
    const out = await f.resend({ tenantId: u.tenantId, userId: u.userId }, id, admin);
    if (out === "not_found") throw appError("NOT_FOUND");
    if (out === "forbidden") throw new AppError("ESIGN_FLOW_FORBIDDEN", 403, "Not contract owner");
    if (out === "not_needed" || out === "none")
      throw new AppError("ESIGN_FLOW_NOT_NEEDED", 409, "E-sign step needs no decision");
    return c.json({ result: out });
  });
  return r;
}
