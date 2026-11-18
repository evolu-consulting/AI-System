// CR-182 · BR-G1/G3 · giao việc theo vai: MỘT transaction scope người dùng gồm hàm DEFINER `hub.role_assign` (đòi cờ quản trị công ty) + audit
// `role_assigned` (ai, lúc nào, TRƯỚC và SAU). Quyền «quản trị công ty» (Q15) đã kiểm ở route TRƯỚC khi gọi. Lỗi DB ⇒ lỗi nghiệp vụ.
import type { Role } from "@ai/contracts/common";
import { roleKeysOf } from "@ai/contracts/flow";
import { withHubScope } from "@ai/db/hub-scope";
import { sql } from "drizzle-orm";
import type { Db } from "../../../lib/db";
import { AppError, appError } from "../../../lib/errors";
import { dbHubAudit, type HubAuditWriter } from "../../../lib/hub-audit";
import { flowRowOf } from "../library/flow-preview.repo";
import { assignRole, type RoleAssignResult, setCompanyAdmin } from "./roles.repo";

export type RoleAssignInput = {
  flowId: string;
  roleKey: string;
  groupId: string | null;
  userId: string | null;
};
/** `isAdmin` = kết quả kiểm «quản trị công ty» (Q15) ở route: service KHÔNG tự tin cờ, thiếu ⇒ 403. */
export type RoleActor = { tenantId: string; userId: string; role: string; isAdmin: boolean };

function pgCode(err: unknown): string | null {
  let e: unknown = err;
  for (let i = 0; e && typeof e === "object" && i < 5; i++) {
    const c = (e as { code?: unknown }).code;
    if (typeof c === "string" && /^[0-9A-Z]{5}$/.test(c)) return c;
    e = (e as { cause?: unknown }).cause;
  }
  return null;
}

export async function assignRoleAudited(
  db: Db,
  who: RoleActor,
  i: RoleAssignInput,
  audit: HubAuditWriter = dbHubAudit,
): Promise<RoleAssignResult> {
  if (!who.isAdmin) throw appError("FORBIDDEN");
  try {
    return await withHubScope(
      db,
      { kind: "user", tenantId: who.tenantId, userId: who.userId },
      async (tx) => {
        // BR-G1/#3 · vai phải có trong quy trình (không giao «vai ma»); cờ quản trị chỉ đặt SAU chỗ kiểm Q15 và gỡ ngay sau lệnh ghi.
        const flow = await flowRowOf(tx, who.tenantId, i.flowId);
        if (!flow) throw appError("NOT_FOUND");
        if (!roleKeysOf(Array.isArray(flow.stages) ? flow.stages : []).includes(i.roleKey))
          throw new AppError("ROLE_KEY_UNKNOWN", 422, "Role not in this process");
        await setCompanyAdmin(tx, true);
        const r = await assignRole(tx, i);
        await setCompanyAdmin(tx, false);
        const [u] = await tx.execute<{ username: string }>(
          sql`select username from admin.users where id = ${who.userId}::uuid and tenant_id = ${who.tenantId}::uuid`,
        );
        await audit.insert(tx, {
          tenantId: who.tenantId,
          actorId: who.userId,
          actorUsername: u?.username ?? null,
          actorRole: who.role as Role,
          action: "role_assigned",
          entity: "process_def",
          entityId: i.flowId,
          entityName: i.roleKey,
          hubConfigVersion: null,
          before: { role_key: i.roleKey, ...r.before },
          after: { role_key: i.roleKey, ...r.after },
          summary: {},
        });
        return r;
      },
    );
  } catch (e) {
    const c = pgCode(e);
    if (c === "P0002") throw appError("NOT_FOUND");
    if (c === "42501") throw appError("FORBIDDEN");
    if (c === "22023") throw new AppError("ROLE_ASSIGN_INVALID", 422, "Invalid assignee");
    throw e;
  }
}
