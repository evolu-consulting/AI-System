// CR-125 · cr125-contract-from-step · gắn / đọc bản ghi gói của MỘT lượt chạy (`hub.process_runs.pack_key/pack_record_id`) cho node «Tạo hợp đồng
// từ hồ sơ»: lượt bắt đầu từ phiếu / Quy trình con chưa có HĐ ⇒ tạo HĐ rồi gắn để Ký số + tín hiệu `esign.*` (`signalPackEvent`) tìm đúng lượt.
// Scope system, lọc `tenant_id` tường minh (một công ty không gắn / đọc được lượt của công ty khác). `linkPackRecordOnce` KHOÁ hàng lượt
// (FOR UPDATE) quanh «đã gắn? → tạo → gắn» ⇒ hai lời gọi đồng thời chỉ tạo MỘT bản ghi (trigger 0058 cấm đổi bản ghi đã gắn).
import { withHubScope } from "@ai/db/hub-scope";
import { sql } from "drizzle-orm";
import type { PackRunRef } from "../../packs/kit/public";
import type { ProcessDeps } from "../core/ports";
import { UUID } from "./pack-runs-view";

const PACK_KEY = /^[a-z][a-z0-9-]{0,39}$/;

export async function packRecordOfRun(
  d: ProcessDeps,
  tenantId: string,
  runId: string,
  pack: string,
): Promise<string | null> {
  if (!UUID.test(tenantId) || !UUID.test(runId) || !PACK_KEY.test(pack)) return null;
  const rows = await withHubScope(d.db, { kind: "system" }, (tx) =>
    tx.execute<{
      record_id: string;
    }>(sql`select pack_record_id::text as record_id from hub.process_runs
      where id = ${runId}::uuid and tenant_id = ${tenantId}::uuid and pack_key = ${pack}`),
  );
  return rows[0]?.record_id ?? null;
}

/** Gắn MỘT bản ghi cho lượt: khoá hàng lượt; đã gắn `pack` ⇒ trả bản ghi đó (`created:false`); chưa ⇒ chạy `create` (còn giữ khoá) rồi gắn.
 *  `create` ném ⇒ rollback, không gắn gì. Lượt đã gắn bản ghi của gói khác ⇒ ném (không đè). */
export async function linkPackRecordOnce(
  d: ProcessDeps,
  tenantId: string,
  runId: string,
  pack: string,
  create: () => Promise<string>,
): Promise<{ record_id: string; created: boolean }> {
  if (!UUID.test(tenantId) || !UUID.test(runId) || !PACK_KEY.test(pack))
    throw new Error("linkPackRecordOnce: tham số không hợp lệ");
  return withHubScope(d.db, { kind: "system" }, async (tx) => {
    const [r] = await tx.execute<{ pack_key: string | null; record_id: string | null }>(
      sql`select pack_key, pack_record_id::text as record_id from hub.process_runs
        where id = ${runId}::uuid and tenant_id = ${tenantId}::uuid for update`,
    );
    if (!r) throw new Error("RUN_NOT_FOUND");
    if (r.pack_key !== null) {
      if (r.pack_key !== pack || !r.record_id) throw new Error("RUN_RECORD_CONFLICT");
      return { record_id: r.record_id, created: false };
    }
    const id = await create();
    await tx.execute(sql`update hub.process_runs set pack_key = ${pack}, pack_record_id = ${id}::uuid
      where id = ${runId}::uuid and tenant_id = ${tenantId}::uuid and pack_key is null`);
    return { record_id: id, created: true };
  });
}

/** CR-140 · ngữ cảnh bước (xem `PackRunsPort.stepContext`): cây lượt = gốc + mọi lượt con; người làm bước trước = người đóng việc gần nhất
 *  của lượt (`review_tasks.decided_by`), vắng ⇒ `stage_runs.passed_by` gần nhất. MỘT câu (CTE đệ quy theo `parent_run_id`). */
export async function packStepContext(
  d: ProcessDeps,
  tenantId: string,
  runId: string,
  pack: string,
  node: string,
): Promise<{ records: string[]; actor: string | null; hasNode: boolean }> {
  if (!UUID.test(tenantId) || !UUID.test(runId) || !PACK_KEY.test(pack))
    return { records: [], actor: null, hasNode: false };
  const [r] = await withHubScope(d.db, { kind: "system" }, (tx) =>
    tx.execute<{
      records: string[] | null;
      actor: string | null;
      has_node: boolean;
    }>(sql`with recursive
      up as (select id, parent_run_id from hub.process_runs where id = ${runId}::uuid and tenant_id = ${tenantId}::uuid
        union all select p.id, p.parent_run_id from hub.process_runs p join up on p.id = up.parent_run_id
          where p.tenant_id = ${tenantId}::uuid),
      tree as (select id from up where parent_run_id is null
        union all select c.id from hub.process_runs c join tree on c.parent_run_id = tree.id
          where c.tenant_id = ${tenantId}::uuid)
      select (select array_agg(distinct r.pack_record_id::text) from hub.process_runs r
          where r.tenant_id = ${tenantId}::uuid and r.id in (select id from tree)
            and r.pack_key = ${pack} and r.pack_record_id is not null) as records,
        coalesce(
          (select t.decided_by::text from hub.review_tasks t where t.tenant_id = ${tenantId}::uuid
            and t.process_run_id = ${runId}::uuid and t.status = 'closed' and t.decided_by is not null
            order by t.decided_at desc nulls last, t.id limit 1),
          (select s.passed_by::text from hub.stage_runs s where s.tenant_id = ${tenantId}::uuid
            and s.process_run_id = ${runId}::uuid and s.passed_by is not null order by s.passed_at desc nulls last limit 1)) as actor,
        exists (select 1 from hub.process_runs r, jsonb_array_elements(r.snapshot -> 'stages') st
          where r.id = ${runId}::uuid and r.tenant_id = ${tenantId}::uuid and st ->> 'node' = ${node}) as has_node`),
  );
  return { records: r?.records ?? [], actor: r?.actor ?? null, hasNode: r?.has_node ?? false };
}

/** Hàm của `PackRunsPort` (gom một chỗ để `pack-runs.ts` không phình). */
export const packRecordPort = (d: ProcessDeps) => ({
  recordOf: (tenantId: string, runId: string, pack: string) =>
    packRecordOfRun(d, tenantId, runId, pack),
  linkOnce: (tenantId: string, runId: string, pack: string, create: () => Promise<string>) =>
    linkPackRecordOnce(d, tenantId, runId, pack, create),
  stepContext: (tenantId: string, runId: string, pack: string, node: string) =>
    packStepContext(d, tenantId, runId, pack, node),
});
