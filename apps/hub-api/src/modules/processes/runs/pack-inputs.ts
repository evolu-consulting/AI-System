// CR-121 F-5 · `PackRunsPort.updateInputs`: gói cập nhật input run theo dữ liệu bản ghi đã xác nhận/sửa (vd số/tên/giá trị HĐ cho mẫu
// Thông báo, ngày cho Chờ tới). Tách khỏi `pack-runs.ts` (trần 400 dòng).
import { withHubScope } from "@ai/db/hub-scope";
import { sql } from "drizzle-orm";
import type { ProcessDeps } from "../core/ports";
import { UUID } from "./pack-runs-view";

const SYS = { kind: "system" as const };
const OPEN = `{running,waiting_review,waiting_answer,needs_decision,waiting_timer}`;
/** Khoá input phiên bản bản ghi gói (CAS của `updateInputs`); không khai ở def, chỉ Hub ghi. */
export const PACK_INPUT_VERSION_KEY = "pack-record-version";

/**
 * MỘT câu, chỉ run CÒN MỞ gắn đúng (gói, bản ghi) của tenant; compare-and-set theo `version` của bản ghi (lưu ở input
 * `pack-record-version`): bản cũ hơn / bằng bản đã ghi ⇒ không ghi (đua hai lần xác nhận không để bản cũ đè bản mới). Thay theo
 * khoá (khoá khác giữ nguyên). Điều kiện rẽ KHÔNG đọc input (gói dựng dữ kiện từ bản ghi hiện tại mỗi lần rẽ) ⇒ không đổi bước đã chạy.
 */
export async function updatePackInputs(
  d: Pick<ProcessDeps, "db">,
  r: { tenantId: string; runId: string; pack: string; recordId: string; version: number },
  patch: readonly { type: string; key: string; text?: string; value?: string }[],
): Promise<boolean> {
  if (![r.runId, r.tenantId, r.recordId].every((x) => UUID.test(x))) return false;
  if (!Number.isSafeInteger(r.version)) return false;
  const all = [...patch, { type: "text", key: PACK_INPUT_VERSION_KEY, text: String(r.version) }];
  const keys = JSON.stringify(all.map((p) => p.key));
  const res = await withHubScope(d.db, SYS, (tx) =>
    tx.execute(sql`update hub.process_runs r set inputs = (
        select coalesce(jsonb_agg(z.e order by z.o), '[]'::jsonb) from (
          select x.e, x.o from jsonb_array_elements(coalesce(r.inputs, '[]'::jsonb)) with ordinality x(e, o)
          where not ((x.e->>'key') in (select jsonb_array_elements_text(${keys}::text::jsonb)))
          union all
          select y.e, 100000 + y.o from jsonb_array_elements(${JSON.stringify(all)}::text::jsonb)
            with ordinality y(e, o)) z)
      where r.id = ${r.runId} and r.tenant_id = ${r.tenantId} and r.pack_key = ${r.pack}
        and r.pack_record_id = ${r.recordId} and r.status = any(${OPEN}::text[])
        and coalesce((select (e->>'text')::bigint from jsonb_array_elements(coalesce(r.inputs, '[]'::jsonb)) e
          where e->>'key' = ${PACK_INPUT_VERSION_KEY} limit 1), -1) < ${r.version}`),
  );
  return res.count === 1;
}
