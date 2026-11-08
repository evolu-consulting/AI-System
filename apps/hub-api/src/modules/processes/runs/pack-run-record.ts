// CR-125 · cr125-contract-from-step · gắn / đọc bản ghi gói của MỘT lượt chạy (`hub.process_runs.pack_key/pack_record_id`) cho node «Tạo hợp đồng
// từ hồ sơ»: lượt bắt đầu từ phiếu / Quy trình con chưa có HĐ ⇒ tạo HĐ rồi gắn để Ký số + tín hiệu `esign.*` (`signalPackEvent`) tìm đúng lượt.
// Scope system, lọc `tenant_id` tường minh (một công ty không gắn / đọc được lượt của công ty khác). Gắn chỉ khi lượt CHƯA có bản ghi
// (trigger 0058 cấm đổi bản ghi đã gắn); lượt đã gắn ⇒ không ghi, trả false.
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

export async function attachPackRecord(
  d: ProcessDeps,
  tenantId: string,
  runId: string,
  ref: PackRunRef,
): Promise<boolean> {
  if (!UUID.test(tenantId) || !UUID.test(runId) || !UUID.test(ref.record_id)) return false;
  if (!PACK_KEY.test(ref.pack)) return false;
  const rows = await withHubScope(d.db, { kind: "system" }, (tx) =>
    tx.execute<{ id: string }>(sql`update hub.process_runs set pack_key = ${ref.pack},
        pack_record_id = ${ref.record_id}::uuid
      where id = ${runId}::uuid and tenant_id = ${tenantId}::uuid and pack_key is null returning id`),
  );
  return rows.length > 0;
}

/** Hai hàm của `PackRunsPort` (gom một chỗ để `pack-runs.ts` không phình). */
export const packRecordPort = (d: ProcessDeps) => ({
  recordOf: (tenantId: string, runId: string, pack: string) =>
    packRecordOfRun(d, tenantId, runId, pack),
  attachRecord: (tenantId: string, runId: string, ref: PackRunRef) =>
    attachPackRecord(d, tenantId, runId, ref),
});
