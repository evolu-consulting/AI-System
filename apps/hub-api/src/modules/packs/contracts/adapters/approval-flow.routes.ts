// CR-105 L4 · `GET /pack/contracts/approval-flow` CHỈ ĐỌC (quyền gói `read`): quy trình đang dùng của tenant (gán ⇒ mặc định của khe).
// Không còn `PUT /approval-flow` (route không tồn tại ⇒ 404; quy trình sửa ở ai-admin). CR-146: trả MỌI flow Bật (`{items}`), chưa có ⇒ `items: []`.
// Cùng file: `GET /groups` (tên phòng ban) + `GET /dify-workflows`.
import {
  ApprovalFlowGroupMembersQuerySchema,
  ApprovalFlowRoleAssignSchema,
} from "@ai/contracts/pack-contracts";
import { Hono } from "hono";
import type { AuthUser } from "../../../../lib/auth.middleware";
import { type PackAccessView, type PackGuardVars, packGuard } from "../../kit/public";
import type { listDifyWorkflows, readCurrentFlows } from "../application/approval-flow.usecase";
import type { assignFlowRole, groupMembersPage } from "../application/approval-flow-roles.usecase";

const KEY = "contracts";
export type ApprovalFlowRoutesDeps = {
  read: ReturnType<typeof readCurrentFlows>;
  difyWorkflows: ReturnType<typeof listDifyWorkflows>;
  /** S3b · Group của tenant (`GET /groups`). */
  groups?: (tenantId: string) => Promise<{ id: string; name: string }[]>;
  /** CR-182 · giao việc theo vai; `isAdmin` = «quản trị công ty» (Q15): tenant_admin ∨ quyền `admin` gói Sổ Hợp Tác. Vắng ⇒ route không có. */
  assignRole?: ReturnType<typeof assignFlowRole>;
  isAdmin?: (user: AuthUser) => Promise<boolean>;
  /** CR-182 · thành viên một nhóm (tải dần) cho khung giao việc. Vắng ⇒ route 404. */
  groupMembers?: ReturnType<typeof groupMembersPage>;
};
const who = (u: AuthUser) => ({ userId: u.userId, tenantId: u.tenantId });

export function approvalFlowRoutes(
  view: PackAccessView,
  d: ApprovalFlowRoutesDeps,
): Hono<PackGuardVars> {
  const r = new Hono<PackGuardVars>();
  r.get("/approval-flow", packGuard(view, KEY, "read"), async (c) => {
    const user = c.get("user");
    // CR-182 · `can_edit` cùng luật PUT /roles (Q15); vắng `isAdmin` ⇒ false.
    const [flows, canEdit] = await Promise.all([
      d.read(who(user)),
      d.isAdmin ? d.isAdmin(user) : false,
    ]);
    return c.json({ ...flows, can_edit: canEdit });
  });
  // CR-182 · BR-G1: CHỈ quản trị công ty sửa giao việc (người thường 403, kể cả có quyền ghi gói); BR-G3: audit ở dịch vụ giao việc.
  r.put("/approval-flow/roles", packGuard(view, KEY, "read"), async (c) => {
    const user = c.get("user");
    if (!d.assignRole || !d.isAdmin) return c.json({ error: { code: "NOT_FOUND" } }, 404);
    if (!(await d.isAdmin(user))) return c.json({ error: { code: "FORBIDDEN" } }, 403);
    const p = ApprovalFlowRoleAssignSchema.safeParse(await c.req.json().catch(() => null));
    if (!p.success) return c.json({ error: { code: "VALIDATION_ERROR" } }, 400);
    return c.json(await d.assignRole({ ...who(user), role: user.role, isAdmin: true }, p.data));
  });
  // S3b · tên phòng ban cho UI luồng: scope tenant của token, ai đọc được gói đều gọi được.
  r.get("/groups", packGuard(view, KEY, "read"), async (c) =>
    c.json(d.groups ? await d.groups(c.get("user").tenantId) : []),
  );
  // CR-182 · thành viên của MỘT nhóm trong công ty (avatar + chức vụ lấy ở `GET /people?ids=`); ai đọc được gói đều gọi được.
  r.get("/groups/:id/members", packGuard(view, KEY, "read"), async (c) => {
    const q = ApprovalFlowGroupMembersQuerySchema.safeParse(c.req.query());
    const id = c.req.param("id");
    if (!q.success || !/^[0-9a-f-]{36}$/i.test(id))
      return c.json({ error: { code: "VALIDATION_ERROR" } }, 400);
    const out = d.groupMembers
      ? await d.groupMembers(who(c.get("user")), id, q.data.offset, q.data.limit)
      : null;
    return out ? c.json(out) : c.json({ error: { code: "NOT_FOUND" } }, 404);
  });
  // cf-dify · workflow Dify chọn được cho bước Dify: người sửa luồng (quyền gói `admin`), scope tenant của token.
  r.get("/dify-workflows", packGuard(view, KEY, "admin"), async (c) =>
    c.json(await d.difyWorkflows(who(c.get("user")))),
  );
  return r;
}
