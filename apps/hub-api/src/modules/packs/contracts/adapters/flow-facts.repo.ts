// CR-121 D-1 · dữ kiện HIỆN TẠI của HĐ cho điều kiện bước mở rộng (rẽ `contracts-route` + kiểm lại `contracts-finalize`). Hai nguồn,
// mỗi nguồn MỘT câu văn bản hằng + `tenant_id` tường minh (Luật 4c), chỉ đọc khi mẫu chụp có điều kiện dùng tới (`factNeedsOf`):
// - `new_partner` (schema gói, tx `PackUow` role `contracts_rw`): HĐ chưa có khoá đối tác ⇒ null (chưa có dữ liệu); có ⇒ true khi
//   KHÔNG có HĐ nào khác cùng `partner_key` đã được duyệt (`confirmed_at`) — index `contracts_partner_key_idx (tenant_id, partner_key)`.
// - `creator_departments` (schema admin, scope system hub — role gói không đọc `admin.*`): mã Group phòng ban của người bắt đầu lượt
//   + mọi phòng cha (`admin.departments.parent_group_id`, CTE đệ quy như `ROUTE_SLOT_SQL`) ⇒ "tính cả phòng con". Chạy NGOÀI tx gói
//   (không giữ hai kết nối cùng lúc).
import type { Db, Tx } from "@ai/db";
import { sql } from "drizzle-orm";
import { creatorDepartmentsOf } from "../../kit/public";
import type { FlowFactsRepo } from "../application/approval-engine.ports";

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

export { CREATOR_DEPARTMENTS_SQL, creatorDepartmentsOf } from "../../kit/public";

/** Nguồn Group của duyệt engine + `creatorDepartments` (giữ prototype nguồn gốc — phương thức lớp vẫn gọi được). */
export function withCreatorDepartments<G extends object>(groups: G, db: Db) {
  return Object.assign(Object.create(groups) as G, {
    creatorDepartments: creatorDepartmentsOf(db),
  });
}
