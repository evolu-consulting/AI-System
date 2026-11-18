// CR-182 · R2 · đọc giao việc theo vai (`hub.process_role_assignments`, 0159) và điền vào stage bằng `withRoles` (thuần, ở contracts).
// Mọi điểm giải vai gọi `applyRoles` / `applyRolesMany`: số câu SQL CỐ ĐỊNH (0 nếu stage không có vai, 1 cho cả lô), lọc `tenant_id` tường minh
// (+ RLS đọc theo tenant). Ghi (`assignRole`) chỉ qua hàm DEFINER `hub.role_assign` — hàm đòi cờ `app.company_admin` (route đặt SAU khi kiểm Q15).
import { type RoleAssignment, roleKeysOf, type WithRolesOut, withRoles } from "@ai/contracts/flow";
import type { Tx } from "@ai/db";
import { sql } from "drizzle-orm";
import { AppError } from "../../../lib/errors";

type Row = { flow_id: string; role_key: string; group_id: string | null; user_id: string | null };

/** Giao việc của nhiều quy trình MỘT câu (`flow_id = any(...)`); rỗng ⇒ không truy vấn. */
export async function loadRoleAssignments(
  tx: Tx,
  tenantId: string,
  flowIds: readonly string[],
): Promise<Map<string, RoleAssignment[]>> {
  const out = new Map<string, RoleAssignment[]>();
  if (flowIds.length === 0) return out;
  const rows =
    await tx.execute<Row>(sql`select flow_id::text as flow_id, role_key, group_id::text as group_id,
      user_id::text as user_id
    from hub.process_role_assignments
    where tenant_id = ${tenantId}::uuid
      and flow_id = any(array(select jsonb_array_elements_text(${JSON.stringify([...new Set(flowIds)])}::jsonb))::uuid[])`);
  for (const r of rows) {
    const list = out.get(r.flow_id) ?? [];
    list.push({ role_key: r.role_key, group_id: r.group_id, user_id: r.user_id });
    out.set(r.flow_id, list);
  }
  return out;
}

/** Giải vai cho MỘT quy trình. Stage không có vai ⇒ trả nguyên, không truy vấn. */
export async function applyRoles(
  tx: Tx,
  tenantId: string,
  flowId: string,
  stages: readonly unknown[],
): Promise<WithRolesOut> {
  if (roleKeysOf(stages).length === 0) return { stages: [...stages], unassigned: [] };
  const m = await loadRoleAssignments(tx, tenantId, [flowId]);
  return withRoles(stages, m.get(flowId) ?? []);
}

/** Giải vai cho nhiều quy trình (một câu cho cả lô). Giữ thứ tự đầu vào. */
export async function applyRolesMany(
  tx: Tx,
  tenantId: string,
  flows: readonly { flowId: string; stages: readonly unknown[] }[],
): Promise<WithRolesOut[]> {
  const need = flows.filter((f) => roleKeysOf(f.stages).length > 0).map((f) => f.flowId);
  const m = await loadRoleAssignments(tx, tenantId, need);
  return flows.map((f) =>
    need.includes(f.flowId)
      ? withRoles(f.stages, m.get(f.flowId) ?? [])
      : { stages: [...f.stages], unassigned: [] },
  );
}

export type RoleAssignResult = {
  before: { group_id: string | null; user_id: string | null };
  after: { group_id: string | null; user_id: string | null };
};

/** Giao / đổi / bỏ giao một vai. CHỈ gọi sau khi route đã kiểm quyền quản trị công ty (Q15). Lỗi DB: 42501 / 22023 / P0002 (xem 0159). */
export async function assignRole(
  tx: Tx,
  i: { flowId: string; roleKey: string; groupId: string | null; userId: string | null },
): Promise<RoleAssignResult> {
  await tx.execute(sql`select set_config('app.company_admin', '1', true)`);
  const [r] = await tx.execute<{
    before_group: string | null;
    before_user: string | null;
    after_group: string | null;
    after_user: string | null;
  }>(sql`select before_group::text as before_group, before_user::text as before_user,
      after_group::text as after_group, after_user::text as after_user
    from hub.role_assign(${i.flowId}::uuid, ${i.roleKey}::text, ${i.groupId}::uuid, ${i.userId}::uuid)`);
  await tx.execute(sql`select set_config('app.company_admin', '', true)`);
  if (!r) throw new Error("role_assign: không trả dòng");
  return {
    before: { group_id: r.before_group, user_id: r.before_user },
    after: { group_id: r.after_group, user_id: r.after_user },
  };
}

/**
 * Giải vai lúc bắt đầu lượt (ảnh chụp: lượt đang chạy giữ người cũ, BR-G2). Lượt mở từ sự kiện mà còn vai CHẶN chưa giao ⇒ ném
 * `ROLE_UNASSIGNED` (422; bộ điều phối đổi thành lý do `FLOW_GROUP_MISSING:<khoá vai>` ⇒ HĐ dừng chờ «Chưa giao người», giao xong thì Mở lại).
 */
export async function resolveRunRoles(
  tx: Tx,
  tenantId: string,
  def: { id: string; stages: readonly unknown[] },
  fromEvent: boolean,
): Promise<WithRolesOut> {
  const rr = await applyRoles(tx, tenantId, def.id, def.stages);
  const blocked = rr.unassigned.filter((x) => x.blocking);
  if (fromEvent && blocked.length > 0)
    throw new AppError("ROLE_UNASSIGNED", 422, "Role not assigned", {
      roles: [...new Set(blocked.map((x) => x.role_key))].slice(0, 5),
    });
  return rr;
}
