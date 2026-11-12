// CR-127 K5 · BR-36b · spec §3 "Phiên bản": v(n+1) vào DONE ⇒ mốc `open` của MỌI bản trước chưa bị thay trong chuỗi chuyển
// `contract_id` sang v(n+1) (giữ id — nên mốc giữ nguyên lịch sử, dòng giao hàng `milestone_items`, yêu cầu chờ duyệt `exec_requests`);
// mốc đã xong / huỷ / thay và mọi giao dịch (`transactions`, `stock_moves`) ở lại v(n). Chuyển HỆ THỐNG (không qua API sửa mốc — khoá K4).
// MỘT câu CTE hằng (Luật 4c), chạy TRƯỚC câu đổi trạng thái của cổng (`contract-state.repo`): trigger `contracts_k2_supersede` (AFTER) khi
// đó chỉ còn đánh dấu "đã thay" — không còn mốc mở để huỷ. Điều kiện khoá/CAS y hệt câu đổi trạng thái (cùng `status = from`, `run_id`,
// `extra`) và khoá hàng HĐ `FOR UPDATE` ⇒ không chuyển khi cổng sẽ từ chối. Không phải bản mới của chuỗi (`supersedes_id` null) ⇒ 0 hàng.
import type { Tx } from "@ai/db";
import { type SQL, sql } from "drizzle-orm";

export type MoveMilestonesInput = {
  contractId: string;
  from: string;
  runId?: string | null;
  extra?: SQL;
  actorId?: string | null;
};

/** Trả số mốc đã chuyển. */
export async function moveOpenMilestones(
  tx: Tx,
  tid: string,
  i: MoveMilestonesInput,
): Promise<number> {
  const [r] = await tx.execute<{ n: number }>(sql`with
    nw as (select c.id, c.tenant_id, c.root_id, c.version_no from contracts.contracts c
      where c.id = ${i.contractId}::uuid and c.tenant_id = ${tid}::uuid and c.supersedes_id is not null
        and c.superseded_at is null and c.doc_type <> 'deal' and c.status = ${i.from}
        and (${i.runId ?? null}::uuid is null or c.run_id = ${i.runId ?? null}::uuid)
        and ${i.extra ?? sql`true`}
      for update of c),
    old as (select p.id from contracts.contracts p join nw on p.tenant_id = nw.tenant_id and p.root_id = nw.root_id
      where p.version_no < nw.version_no and p.superseded_at is null),
    mv as (update contracts.obligations o set contract_id = nw.id, updated_at = now()
      from nw where o.tenant_id = nw.tenant_id and o.status = 'open' and o.contract_id in (select id from old)
      returning o.id),
    mi as (update contracts.milestone_items m set contract_id = nw.id
      from nw where m.tenant_id = nw.tenant_id and m.milestone_id in (select id from mv)
      returning m.milestone_id),
    rq as (update contracts.exec_requests x set contract_id = nw.id
      from nw where x.tenant_id = nw.tenant_id and x.status = 'pending' and x.obligation_id in (select id from mv)
      returning x.id),
    ev as (insert into contracts.contract_events (tenant_id, contract_id, type, actor_user_id, data)
      select nw.tenant_id, nw.id, 'milestones_moved', ${i.actorId ?? null}::uuid,
        jsonb_build_object('from', (select coalesce(jsonb_agg(old.id), '[]'::jsonb) from old),
          'moved', (select count(*) from mv), 'items', (select count(*) from mi),
          'requests', (select count(*) from rq), 'version_no', nw.version_no)
      from nw where exists (select 1 from mv))
    select (select count(*) from mv)::int as n`);
  return r?.n ?? 0;
}
