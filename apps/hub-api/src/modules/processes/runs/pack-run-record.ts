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

/** Hàm của `PackRunsPort` (gom một chỗ để `pack-runs.ts` không phình). */
export const packRecordPort = (d: ProcessDeps) => ({
  recordOf: (tenantId: string, runId: string, pack: string) =>
    packRecordOfRun(d, tenantId, runId, pack),
  linkOnce: (tenantId: string, runId: string, pack: string, create: () => Promise<string>) =>
    linkPackRecordOnce(d, tenantId, runId, pack, create),
});
