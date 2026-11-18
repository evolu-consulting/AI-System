// CR-182 · R2 · đọc giao việc theo vai (`hub.process_role_assignments`, 0159) và điền vào stage bằng `withRoles` (thuần, ở contracts).
// Mọi điểm giải vai gọi `applyRoles` / `applyRolesMany`: số câu SQL CỐ ĐỊNH (0 nếu stage không có vai, 1 cho cả lô), lọc `tenant_id` tường minh
// (+ RLS đọc theo tenant). Ghi (`assignRole`) chỉ qua hàm DEFINER `hub.role_assign` — hàm đòi cờ `app.company_admin` (route đặt SAU khi kiểm Q15).
import {
  hasSignerRole,
  ONDOC_PROVIDER,
  type RoleAssignment,
  roleKeysOf,
  signerRoleOf,
  type WithRolesOut,
  withRoles,
} from "@ai/contracts/flow";
import type { Tx } from "@ai/db";
import { sql } from "drizzle-orm";
import { AppError } from "../../../lib/errors";

/** Người/nhóm được giao còn hợp lệ: nhóm còn ở công ty, người còn dùng được (active, chưa bị khoá). Hết hợp lệ ⇒ coi như CHƯA giao. */
export const VALID_ASSIGNEE = sql`and (a.group_id is null or exists (select 1 from admin.groups g
    where g.id = a.group_id and g.tenant_id = a.tenant_id))
  and (a.user_id is null or exists (select 1 from admin.users u
    where u.id = a.user_id and u.tenant_id = a.tenant_id and u.active and not u.locked_by_tenant))`;

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
    await tx.execute<Row>(sql`select a.flow_id::text as flow_id, a.role_key, a.group_id::text as group_id,
      a.user_id::text as user_id
    from hub.process_role_assignments a
    where a.tenant_id = ${tenantId}::uuid
      and a.flow_id = any(array(select jsonb_array_elements_text(${JSON.stringify([...new Set(flowIds)])}::jsonb))::uuid[])
      ${VALID_ASSIGNEE}`);
  for (const r of rows) {
    const list = out.get(r.flow_id) ?? [];
    list.push({ role_key: r.role_key, group_id: r.group_id, user_id: r.user_id });
    out.set(r.flow_id, list);
  }
  return out;
}

/**
 * CR-182 · R3 · công ty BẬT «ký trên tài liệu» (`on_doc_enabled`, đọc qua hàm DEFINER `hub.sig_settings_of` (hub_rw không SELECT bảng))? Chỉ hỏi khi có bước Ký dùng vai (MỘT câu, lọc tenant);
 * không có ⇒ false, 0 SQL. Chưa lưu thiết lập ⇒ mặc định TẮT.
 */
export async function onDocOf(
  tx: Tx,
  tenantId: string,
  stageLists: readonly (readonly unknown[])[],
): Promise<boolean> {
  if (!stageLists.some(hasSignerRole)) return false;
  const [r] = await tx.execute<{
    on: boolean;
  }>(
    sql`select coalesce((select s.on_doc_enabled from hub.sig_settings_of(${tenantId}::uuid) s), false) as on`,
  );
  return r?.on === true;
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
  const ondoc = await onDocOf(tx, tenantId, [stages]);
  return withRoles(stages, m.get(flowId) ?? [], { ondoc });
}

/** Giải vai cho nhiều quy trình (một câu cho cả lô). Giữ thứ tự đầu vào. */
export async function applyRolesMany(
  tx: Tx,
  tenantId: string,
  flows: readonly { flowId: string; stages: readonly unknown[] }[],
): Promise<WithRolesOut[]> {
  const need = new Set(flows.filter((f) => roleKeysOf(f.stages).length > 0).map((f) => f.flowId));
  const m = await loadRoleAssignments(tx, tenantId, [...need]);
  const ondoc = await onDocOf(
    tx,
    tenantId,
    flows.map((f) => f.stages),
  );
  return flows.map((f) =>
    need.has(f.flowId)
      ? withRoles(f.stages, m.get(f.flowId) ?? [], { ondoc })
      : { stages: [...f.stages], unassigned: [] },
  );
}

export type RoleAssignResult = {
  before: { group_id: string | null; user_id: string | null };
  after: { group_id: string | null; user_id: string | null };
};

/** Đặt cờ quản trị công ty (SET LOCAL) — CHỈ `assignRoleAudited` gọi, ngay sau chỗ kiểm Q15 (`isAdmin`). */
export const setCompanyAdmin = (tx: Tx, on: boolean) =>
  tx.execute(sql`select set_config('app.company_admin', ${on ? "1" : ""}, true)`);

/** Giao / đổi / bỏ giao một vai (cờ `app.company_admin` đã đặt). Lỗi DB: 42501 / 22023 / P0002 (xem 0159). */
export async function assignRole(
  tx: Tx,
  i: { flowId: string; roleKey: string; groupId: string | null; userId: string | null },
): Promise<RoleAssignResult> {
  const [r] = await tx.execute<{
    before_group: string | null;
    before_user: string | null;
    after_group: string | null;
    after_user: string | null;
  }>(sql`select before_group::text as before_group, before_user::text as before_user,
      after_group::text as after_group, after_user::text as after_user
    from hub.role_assign(${i.flowId}::uuid, ${i.roleKey}::text, ${i.groupId}::uuid, ${i.userId}::uuid)`);
  if (!r) throw new Error("role_assign: không trả dòng");
  return {
    before: { group_id: r.before_group, user_id: r.before_user },
    after: { group_id: r.after_group, user_id: r.after_user },
  };
}

/**
 * Giải vai lúc bắt đầu lượt (ảnh chụp). Còn vai CHẶN chưa giao ⇒ từ chối mở lượt (mở tay hay từ sự kiện): ném `ROLE_UNASSIGNED` (422, kèm tên vai);
 * bộ điều phối đổi thành lý do `FLOW_GROUP_MISSING:<khoá vai>` ⇒ HĐ dừng chờ «Chưa giao người», giao xong thì Mở lại.
 */
export async function resolveRunRoles(
  tx: Tx,
  tenantId: string,
  def: { id: string; stages: readonly unknown[] },
): Promise<WithRolesOut> {
  const rr = await applyRoles(tx, tenantId, def.id, def.stages);
  const blocked = rr.unassigned.filter((x) => x.blocking);
  if (blocked.length > 0)
    throw new AppError(
      "ROLE_UNASSIGNED",
      422,
      `Role not assigned: ${[...new Set(blocked.map((x) => x.label))].slice(0, 5).join(", ")}`,
      {
        roles: [...new Set(blocked.map((x) => x.role_key))].slice(0, 5),
        labels: [...new Set(blocked.map((x) => x.label))].slice(0, 5),
      },
    );
  return rr;
}

/** `resolveRunRoles` trả cả def (đường mở lượt: mọi nơi dùng chung một luật). */
export async function withRolesDef<D extends { id: string; stages: unknown[] }>(
  tx: Tx,
  tenantId: string,
  def: D,
): Promise<D> {
  return { ...def, stages: (await resolveRunRoles(tx, tenantId, def)).stages };
}

/**
 * Soát #9 · công ty TẮT «ký trên tài liệu» giữa lượt mà bản chụp bước Ký còn `provider = ondoc` (đặt lúc bắt đầu lượt khi còn bật) ⇒ trả `provider`
 * của def (hằng, khác `ondoc`). Def không có `provider` ⇒ giữ nguyên (nợ: TECH-DEBT). THUẦN.
 */
export function restoreProvider<S>(stage: S, o: { ondoc: boolean; defProvider: string | null }): S {
  if (o.ondoc || !o.defProvider || o.defProvider === ONDOC_PROVIDER || signerRoleOf(stage) === null)
    return stage;
  const e = (stage as { executor: { args?: Record<string, unknown> } }).executor;
  const cur = (e.args?.provider as { value?: unknown } | undefined)?.value;
  if (cur !== ONDOC_PROVIDER) return stage;
  return {
    ...stage,
    executor: { ...e, args: { ...e.args, provider: { from: "const", value: o.defProvider } } },
  };
}

/**
 * BR-G2 · KHI MỞ bước: giải lại vai theo giao việc HIỆN TẠI và ghi đè bản chụp của run (`group_id` / `approver_user_id` / `company_signers`):
 * bước CHƯA tới lượt dùng người mới; bước đang chờ (đã mở) không qua đây ⇒ giữ người cũ. Vai chưa giao lúc này ⇒ giữ giá trị đã giải lúc bắt đầu lượt.
 * Stage không có vai ⇒ trả nguyên, 0 SQL. Gọi trong tx đã khoá run.
 */
export async function refreshStageRoles<S>(
  tx: Tx,
  tenantId: string,
  runId: string,
  stage: S,
  idx: number,
): Promise<S> {
  if (roleKeysOf([stage]).length === 0) return stage;
  // `provider` của def tại bước này (chỉ khi bước đó vẫn là CÙNG vai người ký) — để khôi phục khi công ty tắt «ký trên tài liệu» (#9); cùng câu, không thêm round-trip.
  const [r] = await tx.execute<{
    def_id: string | null;
    def_provider: string | null;
  }>(sql`select p.process_def_id::text as def_id,
      (select d.stages -> ${idx}::int #>> '{executor,args,provider,value}' from hub.process_defs d
        where d.id = p.process_def_id and (d.tenant_id = p.tenant_id or d.tenant_id is null) and jsonb_typeof(d.stages) = 'array'
          and d.stages -> ${idx}::int #>> '{executor,args,signer_role,value}' = ${signerRoleOf(stage)}::text) as def_provider
    from hub.process_runs p where p.id = ${runId}::uuid and p.tenant_id = ${tenantId}::uuid`);
  if (!r?.def_id) return stage;
  const m = await loadRoleAssignments(tx, tenantId, [r.def_id]);
  const ondoc = await onDocOf(tx, tenantId, [[stage]]);
  const next = restoreProvider(
    withRoles([stage], m.get(r.def_id) ?? [], { keepUnassigned: true, ondoc }).stages[0] as S,
    { ondoc, defProvider: r.def_provider },
  );
  if (JSON.stringify(next) === JSON.stringify(stage)) return stage;
  await tx.execute(sql`update hub.process_runs set snapshot = jsonb_set(snapshot, array['stages', ${String(idx)}::text],
      ${JSON.stringify(next)}::jsonb) where id = ${runId}::uuid and tenant_id = ${tenantId}::uuid`);
  return next;
}
