// CR-105 L4 · `GET /pack/contracts/approval-flow` CHỈ ĐỌC (quyền gói `read`): quy trình đang dùng của tenant (gán ⇒ mặc định của khe).
// Không còn `PUT /approval-flow` (route không tồn tại ⇒ 404; quy trình sửa ở ai-admin). Chưa có bản áp được ⇒ 404 `NOT_FOUND`.
// Cùng file: `GET /groups` (tên phòng ban) + `GET /dify-workflows`.
import { Hono } from "hono";
import type { AuthUser } from "../../../../lib/auth.middleware";
import { appError } from "../../../../lib/errors";
import {
  type PackAccessView,
  type PackGuardVars,
  packGuard,
} from "../../kit/adapters/pack-guard.middleware";
import type { listDifyWorkflows, readCurrentFlow } from "../application/approval-flow.usecase";

const KEY = "contracts";
export type ApprovalFlowRoutesDeps = {
  read: ReturnType<typeof readCurrentFlow>;
  difyWorkflows: ReturnType<typeof listDifyWorkflows>;
  /** S3b · Group của tenant (`GET /groups`). */
  groups?: (tenantId: string) => Promise<{ id: string; name: string }[]>;
};
const who = (u: AuthUser) => ({ userId: u.userId, tenantId: u.tenantId });

export function approvalFlowRoutes(
  view: PackAccessView,
  d: ApprovalFlowRoutesDeps,
): Hono<PackGuardVars> {
  const r = new Hono<PackGuardVars>();
  r.get("/approval-flow", packGuard(view, KEY, "read"), async (c) => {
    const cur = await d.read(who(c.get("user")));
    if (!cur) throw appError("NOT_FOUND");
    return c.json(cur);
  });
  // S3b · tên phòng ban cho UI luồng: scope tenant của token, ai đọc được gói đều gọi được.
  r.get("/groups", packGuard(view, KEY, "read"), async (c) =>
    c.json(d.groups ? await d.groups(c.get("user").tenantId) : []),
  );
  // cf-dify · workflow Dify chọn được cho bước Dify: người sửa luồng (quyền gói `admin`), scope tenant của token.
  r.get("/dify-workflows", packGuard(view, KEY, "admin"), async (c) =>
    c.json(await d.difyWorkflows(who(c.get("user")))),
  );
  return r;
}
