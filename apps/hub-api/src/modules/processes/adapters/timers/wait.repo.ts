// HUB-FR-144 · PD-R13/R15 · K1/K3 · plan §4.6 bước 1 · `WaitRepo` gắn tx + `tenantId` của hàng run đã khoá: ngày gốc của
// stage `wait_until` (input `date` của run / field của output HIỆN HÀNH stage nguồn) + `expires_at` trong MỘT câu; ghi stage
// `waiting_timer`. MỌI câu lọc `tenant_id`. Người gọi đã khoá run (thứ tự run → stage → timer, plan §6).
import type { Tx } from "@ai/db";
import { sql } from "drizzle-orm";
import type { WaitRepo, WaitSource } from "../../application/timers/wait.ports";

type BaseRow = { base: string | null; expires_at: string | Date | null };

/** Biểu thức ngày gốc (một giá trị) theo nguồn — tham số hoá, văn bản câu cố định theo loại nguồn. */
const baseExpr = (src: WaitSource) =>
  src.kind === "input"
    ? sql`(select v->>'value' from jsonb_array_elements(
          case when jsonb_typeof(r.inputs) = 'array' then r.inputs else '[]'::jsonb end) v
        where v->>'key' = ${src.key} and v->>'type' = 'date' limit 1)`
    : sql`(select o.fields->>${src.field} from hub.stage_runs s
          join hub.process_outputs o on o.id = s.current_output_id and o.tenant_id = s.tenant_id
        where s.process_run_id = r.id and s.tenant_id = r.tenant_id and s.stage_idx = ${src.stageIdx}
          and jsonb_typeof(o.fields) = 'object'
        limit 1)`;

export function waitRepo(tx: Tx, tenantId: string): WaitRepo {
  return {
    async loadBase(runId, src) {
      const [r] = await tx.execute<BaseRow>(sql`
        select ${baseExpr(src)} as base, r.expires_at
        from hub.process_runs r where r.id = ${runId} and r.tenant_id = ${tenantId}`);
      const exp = r?.expires_at ?? null;
      return {
        base: r?.base ?? null,
        expiresAt: exp === null ? null : exp instanceof Date ? exp : new Date(exp),
      };
    },
    async markWaiting(stageRunId, now) {
      const at = now.toISOString();
      await tx.execute(sql`
        update hub.stage_runs set status = 'waiting_timer', current_run_id = null,
          started_at = coalesce(started_at, ${at}::timestamptz), updated_at = ${at}::timestamptz
        where id = ${stageRunId} and tenant_id = ${tenantId}`);
    },
  };
}
