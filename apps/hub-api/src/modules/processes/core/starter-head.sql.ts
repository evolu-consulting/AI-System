// CR-139 · Q1 · phân giải «Trưởng phòng của người đề xuất» KHI MỞ việc duyệt — bản SQL của `pickStarterHead`
// (domain/tasks/starter-head.rules). MỘT câu: CTE đệ quy leo `admin.departments.parent_group_id` từ mọi phòng của
// `process_runs.started_by` (CÙNG tenant của run), chọn trưởng gần nhất ≠ người gửi còn dùng được, rồi GHI kết quả vào snapshot
// run `stages[i].after.approver_user_id` (không ai ⇒ gỡ khoá đó). Mọi chỗ đọc cửa duyệt (`headGateSql`/`approverSql`, `assertHeadGate`,
// `can_act`, hộp việc, uỷ quyền, Nhận việc) đọc snapshot ⇒ tự đúng, không sửa từng nơi. Run đã khoá bởi người gọi (mở việc).
import type { Tx } from "@ai/db";
import { sql } from "drizzle-orm";
import { STARTER_HEAD_MAX_DEPTH } from "../domain/tasks/starter-head.rules";

/** Câu phân giải + ghi (xuất cho test đếm/đọc). */
export const STARTER_HEAD_SQL = (tenantId: string, stageRunId: string) => sql`
  with recursive b as (
    select pr.id, pr.tenant_id, pr.started_by, s.stage_idx from hub.stage_runs s
    join hub.process_runs pr on pr.id = s.process_run_id and pr.tenant_id = s.tenant_id
    where s.id = ${stageRunId}::uuid and s.tenant_id = ${tenantId}::uuid),
  up(group_id, depth) as (
    select m.group_id, 0 from b
    join admin.group_members m on m.tenant_id = b.tenant_id and m.user_id = b.started_by
    join admin.departments dp on dp.group_id = m.group_id and dp.tenant_id = m.tenant_id
    union
    select dp.parent_group_id, up.depth + 1 from up
    join admin.departments dp on dp.group_id = up.group_id and dp.tenant_id = ${tenantId}::uuid
    where dp.parent_group_id is not null and up.depth < ${STARTER_HEAD_MAX_DEPTH}),
  pick as (
    select d.head_user_id as head from up cross join b
    join admin.departments d on d.group_id = up.group_id and d.tenant_id = b.tenant_id
    join admin.users u on u.id = d.head_user_id and u.tenant_id = b.tenant_id and u.active and not u.locked_by_tenant
    where d.head_user_id <> b.started_by
    order by up.depth, up.group_id limit 1),
  upd as (
    update hub.process_runs pr set snapshot = case when (select head from pick) is null
        then pr.snapshot #- array['stages', b.stage_idx::text, 'after', 'approver_user_id']
        else jsonb_set(pr.snapshot, array['stages', b.stage_idx::text, 'after', 'approver_user_id'],
          to_jsonb((select head from pick)::text)) end
    from b where pr.id = b.id and pr.tenant_id = b.tenant_id
      and pr.snapshot->'stages'->(b.stage_idx::int)->'after'->>'approver_mode' = 'starter_head'
    returning pr.id)
  select (select head::text from pick) as head, (select count(*) from upd)::int as n`;

/** Người duyệt đã chọn (đã ghi vào snapshot) hoặc null = không có trưởng phòng nào (`STARTER_HEAD_MISSING`). */
export async function resolveStarterHead(
  tx: Tx,
  tenantId: string,
  stageRunId: string,
): Promise<string | null> {
  const [r] = await tx.execute<{ head: string | null; n: number }>(
    STARTER_HEAD_SQL(tenantId, stageRunId),
  );
  return r && r.n > 0 ? r.head : null;
}
