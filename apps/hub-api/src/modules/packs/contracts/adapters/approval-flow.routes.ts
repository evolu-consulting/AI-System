// contract-flow S2 · `GET|PUT /pack/contracts/approval-flow`: đọc (quyền gói `read`) mẫu luồng duyệt đã lưu hoặc mẫu mặc định
// (`is_default`); lưu (quyền gói `admin`, guard TRƯỚC đọc thân ⇒ không phải admin 403, 0 SQL): 400 thân sai, 422
// `APPROVAL_FLOW_INVALID` (`details.issues`), 422 `APPROVAL_GROUP_MISSING`, 409 `VERSION_CONFLICT` (`details.current`).
import {
  APPROVAL_FLOW_ERRORS,
  ApprovalFlowPutSchema,
  CONTRACT_APPROVAL_ERRORS,
} from "@ai/contracts";
import { Hono } from "hono";
import type { AuthUser } from "../../../../lib/auth.middleware";
import { AppError, appError } from "../../../../lib/errors";
import { parseWith, readJson } from "../../../../lib/http";
import {
  type PackAccessView,
  type PackGuardVars,
  packGuard,
} from "../../kit/adapters/pack-guard.middleware";
import type { readApprovalFlow, saveApprovalFlow } from "../application/approval-flow.usecase";

const KEY = "contracts";
export type ApprovalFlowRoutesDeps = {
  read: ReturnType<typeof readApprovalFlow>;
  save: ReturnType<typeof saveApprovalFlow>;
  /** S3b · Group của tenant (`GET /groups`). */
  groups?: (tenantId: string) => Promise<{ id: string; name: string }[]>;
};
const who = (u: AuthUser) => ({ userId: u.userId, tenantId: u.tenantId });

export function approvalFlowRoutes(
  view: PackAccessView,
  d: ApprovalFlowRoutesDeps,
): Hono<PackGuardVars> {
  const r = new Hono<PackGuardVars>();
  r.get("/approval-flow", packGuard(view, KEY, "read"), async (c) =>
    c.json(await d.read(who(c.get("user")))),
  );
  // S3b · tên phòng ban cho UI luồng: scope tenant của token, ai đọc được gói đều gọi được.
  r.get("/groups", packGuard(view, KEY, "read"), async (c) =>
    c.json(d.groups ? await d.groups(c.get("user").tenantId) : []),
  );
  r.put("/approval-flow", packGuard(view, KEY, "admin"), async (c) => {
    const b = parseWith(ApprovalFlowPutSchema, await readJson(c));
    const out = await d.save(who(c.get("user")), b);
    if (out.kind === "ok") return c.json(out.flow);
    if (out.kind === "conflict") throw appError("VERSION_CONFLICT", { current: out.current });
    if (out.kind === "group_missing")
      throw new AppError(
        "APPROVAL_GROUP_MISSING",
        CONTRACT_APPROVAL_ERRORS.APPROVAL_GROUP_MISSING,
        "Approval group not found",
      );
    throw new AppError(
      "APPROVAL_FLOW_INVALID",
      APPROVAL_FLOW_ERRORS.APPROVAL_FLOW_INVALID,
      "Approval flow is invalid",
      { issues: out.issues },
    );
  });
  return r;
}
