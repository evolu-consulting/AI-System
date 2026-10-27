// CR-097 K1 · HD-FR-104 · Luật 4c: SQL "Mở lại" trong tx `PackUow` (role `contracts_rw`, RLS FORCE + luật thấy M1) + `tenant_id` tường
// minh. MỘT câu văn bản hằng: khoá hàng → (đang khoá, được phép) mở lượt duyệt cấp 1 khi `approval_on()` và chưa có lượt sống → UPDATE
// về `needs_review` + bỏ `locked_*`/`confirmed_*` + gắn lượt mới + version+1 → event `reopened` (+ `approval_started` khi mở lượt).
// CR-101a: được phép = owner gói (`admin`, route tính từ cache quyền) HOẶC người phụ trách (`owner_user_id = actor`) — trùng `canReopen`.
// HĐ chưa khoá / không được phép ⇒ không ghi gì.
import type { Tx } from "@ai/db";
import { sql } from "drizzle-orm";
import type { ReopenRepo, ReopenRepoOut } from "../application/reopen-contract.usecase";

export function reopenRepo(tx: Tx, tenantId: string): { reopen: ReopenRepo } {
  const t = tenantId;
  return {
    reopen: {
      reopen: async (id, reason, actor, admin): Promise<ReopenRepoOut> => {
        const [r] = await tx.execute<{
          found: boolean;
          locked: boolean;
          version: number | null;
          draft: boolean;
          owner: string | null;
        }>(sql`with
          -- CR-097 K2: chuỗi đang có nháp cập nhật ⇒ không mở lại bản hiện hành (bỏ nháp trước); bản đã bị thay ⇒ trigger 0049 (409).
          c as (select k.id, k.status, k.locked_at is not null as locked, k.owner_user_id::text as owner,
              (${admin}::boolean or k.owner_user_id is not distinct from ${actor}::uuid) as allowed,
              exists (select 1 from contracts.contracts v
              where v.tenant_id = k.tenant_id and v.root_id = k.root_id and v.version_no > k.version_no
                and v.superseded_at is null) as draft
            from contracts.contracts k where k.id = ${id}::uuid and k.tenant_id = ${t}::uuid for update of k),
          a as (insert into contracts.approvals (tenant_id, contract_id, status, started_by)
            select ${t}::uuid, c.id, 'level1', ${actor}::uuid from c
            where c.allowed and c.locked and not c.draft and contracts.approval_on() and not exists (
              select 1 from contracts.approvals x
              where x.tenant_id = ${t}::uuid and x.contract_id = c.id and x.status in ('extracting', 'level1', 'level2'))
            returning id, contract_id),
          u as (update contracts.contracts k set status = 'needs_review', locked_at = null, locked_by = null,
              confirmed_at = null, confirmed_by = null, run_id = coalesce((select a.id from a), k.run_id),
              version = k.version + 1, updated_at = now()
            from c where k.id = c.id and k.tenant_id = ${t}::uuid and c.allowed and c.locked and not c.draft
            returning k.id, k.version, c.status as prev),
          e as (insert into contracts.contract_events (tenant_id, contract_id, type, actor_user_id, data)
            select ${t}::uuid, u.id, 'reopened', ${actor}::uuid, jsonb_build_object('reason', ${reason}::text,
              'from_status', u.prev, 'run_id', (select a.id::text from a)) from u
            union all
            select ${t}::uuid, a.contract_id, 'approval_started', ${actor}::uuid,
              jsonb_build_object('run_id', a.id::text, 'reopened', true) from a)
          select exists (select 1 from c) as found, coalesce((select locked from c), false) as locked,
            (select version from u) as version, coalesce((select draft from c), false) as draft,
            (select owner from c) as owner`);
        return {
          found: r?.found === true,
          locked: r?.locked === true,
          version: r?.version ?? null,
          draft: r?.draft === true,
          owner: r?.owner ?? null,
        };
      },
    },
  };
}
