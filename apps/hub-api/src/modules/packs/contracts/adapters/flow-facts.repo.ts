// CR-121 D-1 · dữ kiện HIỆN TẠI của HĐ cho điều kiện bước mở rộng (rẽ `contracts-route` + kiểm lại `contracts-finalize`). Hai nguồn,
// mỗi nguồn MỘT câu văn bản hằng + `tenant_id` tường minh (Luật 4c), chỉ đọc khi mẫu chụp có điều kiện dùng tới (`factNeedsOf`):
// - `new_partner` (schema gói, tx `PackUow` role `contracts_rw`): HĐ chưa có khoá đối tác ⇒ null (chưa có dữ liệu); có ⇒ true khi
//   KHÔNG có HĐ nào khác cùng `partner_key` đã được duyệt (`confirmed_at`) — index `contracts_partner_key_idx (tenant_id, partner_key)`.
// - `creator_departments` (schema admin, scope system hub — role gói không đọc `admin.*`): mã Group phòng ban của người bắt đầu lượt
//   + mọi phòng cha (`admin.departments.parent_group_id`, CTE đệ quy như `ROUTE_SLOT_SQL`) ⇒ "tính cả phòng con". Chạy NGOÀI tx gói
//   (không giữ hai kết nối cùng lúc).
import type { Db, Tx } from "@ai/db";
import { withHubScope } from "@ai/db/hub-scope";
import { sql } from "drizzle-orm";
import type { CreatorDepartments, FlowFactsRepo } from "../application/approval-engine.ports";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Câu `new_partner` (xuất cho test đếm/kế hoạch). */
export const NEW_PARTNER_SQL = (tid: string, contractId: string) => sql`
  select (c.partner_key is not null) as has_partner,
    not exists (select 1 from contracts.contracts o
      where o.tenant_id = c.tenant_id and o.partner_key = c.partner_key and o.partner_key is not null
        and o.kind = 'contract' and o.id <> c.id and o.confirmed_at is not null) as fresh
  from contracts.contracts c where c.id = ${contractId}::uuid and c.tenant_id = ${tid}::uuid`;

export function flowFactsRepo(tx: Tx, tid: string): FlowFactsRepo {
  return {
    async newPartner(contractId) {
      const [r] = await tx.execute<{ has_partner: boolean; fresh: boolean }>(
        NEW_PARTNER_SQL(tid, contractId),
      );
      return r?.has_partner ? r.fresh === true : null;
    },
  };
}

/** Câu phòng ban (mã Group) của user + phòng cha (xuất cho test đếm). */
export const CREATOR_DEPARTMENTS_SQL = (tenantId: string, userId: string) => sql`
  with recursive anc(id) as (
    select m.group_id from admin.group_members m
      join admin.departments dp on dp.group_id = m.group_id and dp.tenant_id = m.tenant_id
    where m.tenant_id = ${tenantId}::uuid and m.user_id = ${userId}::uuid
    union
    select dp.parent_group_id from anc join admin.departments dp on dp.group_id = anc.id
    where dp.tenant_id = ${tenantId}::uuid and dp.parent_group_id is not null)
  select coalesce(array_agg(g.key order by g.key), '{}') as keys
  from anc join admin.groups g on g.id = anc.id and g.tenant_id = ${tenantId}::uuid`;

/** Nguồn Group của duyệt engine + `creatorDepartments` (giữ prototype nguồn gốc — phương thức lớp vẫn gọi được). */
export function withCreatorDepartments<G extends object>(groups: G, db: Db) {
  return Object.assign(Object.create(groups) as G, {
    creatorDepartments: creatorDepartmentsOf(db),
  });
}

export function creatorDepartmentsOf(db: Db): CreatorDepartments {
  return async (tenantId, userId) => {
    if (!UUID.test(tenantId) || !UUID.test(userId)) return [];
    const [r] = await withHubScope(db, { kind: "system" }, (tx) =>
      tx.execute<{ keys: string[] | null }>(CREATOR_DEPARTMENTS_SQL(tenantId, userId)),
    );
    return r?.keys ?? [];
  };
}
