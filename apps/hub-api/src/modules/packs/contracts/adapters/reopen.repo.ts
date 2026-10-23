// CR-097 K1 · HD-FR-104 · Luật 4c: SQL "Mở lại" trong tx `PackUow` (role `contracts_rw`, RLS FORCE + luật thấy M1) + `tenant_id` tường
// minh. MỘT câu văn bản hằng: khoá hàng → (đang khoá) mở lượt duyệt cấp 1 khi `approval_on()` và chưa có lượt sống → UPDATE về
// `needs_review` + bỏ `locked_*`/`confirmed_*` + gắn lượt mới + version+1 → event `reopened` (+ `approval_started` khi mở lượt).
// HĐ chưa khoá ⇒ không ghi gì (trả `locked: false`).
import type { Tx } from "@ai/db";
import { sql } from "drizzle-orm";
import type { ReopenRepo, ReopenRepoOut } from "../application/reopen-contract.usecase";

export function reopenRepo(tx: Tx, tenantId: string): { reopen: ReopenRepo } {
  const t = tenantId;
  return {
    reopen: {
      reopen: async (id, reason, actor): Promise<ReopenRepoOut> => {
        const [r] = await tx.execute<{
          found: boolean;
          locked: boolean;
          version: number | null;
        }>(sql`with
          c as (select id, status, locked_at is not null as locked from contracts.contracts
            where id = ${id}::uuid and tenant_id = ${t}::uuid for update),
          a as (insert into contracts.approvals (tenant_id, contract_id, status, started_by)
            select ${t}::uuid, c.id, 'level1', ${actor}::uuid from c
            where c.locked and contracts.approval_on() and not exists (select 1 from contracts.approvals x
              where x.tenant_id = ${t}::uuid and x.contract_id = c.id and x.status in ('extracting', 'level1', 'level2'))
            returning id, contract_id),
          u as (update contracts.contracts k set status = 'needs_review', locked_at = null, locked_by = null,
              confirmed_at = null, confirmed_by = null, run_id = coalesce((select a.id from a), k.run_id),
              version = k.version + 1, updated_at = now()
            from c where k.id = c.id and k.tenant_id = ${t}::uuid and c.locked
            returning k.id, k.version, c.status as prev),
          e as (insert into contracts.contract_events (tenant_id, contract_id, type, actor_user_id, data)
            select ${t}::uuid, u.id, 'reopened', ${actor}::uuid, jsonb_build_object('reason', ${reason}::text,
              'from_status', u.prev, 'run_id', (select a.id::text from a)) from u
            union all
            select ${t}::uuid, a.contract_id, 'approval_started', ${actor}::uuid,
              jsonb_build_object('run_id', a.id::text, 'reopened', true) from a)
          select exists (select 1 from c) as found, coalesce((select locked from c), false) as locked,
            (select version from u) as version`);
        return {
          found: r?.found === true,
          locked: r?.locked === true,
          version: r?.version ?? null,
        };
      },
    },
  };
}
