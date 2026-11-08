// cr125-fix-escalate-kick · Luật GỐC 3: kick ngay sau khi tạo lượt lỗi thì KHÔNG nuốt im lặng. Log `process-kick-failed` kèm run id +
// mã lỗi, và lượt chưa bắt đầu bước nào (mọi stage `pending`) ⇒ "Cần xử lý" `start_failed` (mã lỗi ở `stage_runs.last_error_code` của
// bước đầu — thẻ/chi tiết lượt nói "không khởi động được — <lý do>", Thử lại / Huỷ). Lượt đã chạy bước nào thì giữ nguyên (vòng nền nhặt).
import { withHubScope } from "@ai/db/hub-scope";
import { sql } from "drizzle-orm";
import { safeErrorFields } from "../../../lib/errors";
import type { ProcessDepsCore } from "./start.service";

/** Mã máy ngắn của lỗi kick: mã AppError, hoặc SQLSTATE/constraint của Postgres (cả khi drizzle bọc ở `cause`), hoặc tên lỗi. */
export function kickErrorCode(err: unknown): string {
  const x = (err ?? {}) as {
    code?: unknown;
    constraint_name?: unknown;
    cause?: unknown;
    name?: unknown;
  };
  const c = (x.cause ?? {}) as { code?: unknown; constraint_name?: unknown };
  const pg = (o: { code?: unknown; constraint_name?: unknown }) =>
    typeof o.code === "string"
      ? typeof o.constraint_name === "string"
        ? `${o.code}:${o.constraint_name}`
        : o.code
      : null;
  return (pg(c) ?? pg(x) ?? (typeof x.name === "string" ? x.name : "unknown")).slice(0, 120);
}

/** Kick lượt vừa tạo; lỗi ⇒ log có mã + đánh dấu "không khởi động được" (nếu chưa bước nào chạy). Không ném. */
export async function kickOrFlag(d: ProcessDepsCore, runId: string): Promise<void> {
  try {
    await d.launcher.kick(runId);
  } catch (err) {
    const code = kickErrorCode(err);
    d.log.warn("process-kick-failed", { run_id: runId, code, ...safeErrorFields(err) });
    await markStartFailed(d, runId, code).catch((e: unknown) =>
      d.log.warn("process-start-failed-mark-failed", { run_id: runId, ...safeErrorFields(e) }),
    );
  }
}

/** 2 câu, system scope: chỉ khi lượt `running` và chưa stage nào chạy (`pending`/`queued`) — CAS trong câu, không khoá dài. */
async function markStartFailed(d: ProcessDepsCore, runId: string, code: string): Promise<void> {
  const decision = JSON.stringify({
    reason: "start_failed",
    code,
    options: ["add_attempt", "cancel"],
    at: d.now().toISOString(),
  });
  await withHubScope(d.db, { kind: "system" }, async (tx) => {
    const [r] = await tx.execute<{ tenant_id: string; idx: number }>(sql`update hub.process_runs pr
        set status = 'needs_decision', updated_at = now(),
          decision = ${decision}::jsonb || jsonb_build_object('stage_idx', coalesce(pr.current_stage_idx, 0))
      where pr.id = ${runId} and pr.status = 'running'
        and not exists (select 1 from hub.stage_runs s where s.process_run_id = pr.id and s.tenant_id = pr.tenant_id
          and s.status not in ('pending', 'queued'))
      returning pr.tenant_id::text as tenant_id, coalesce(pr.current_stage_idx, 0)::int as idx`);
    if (!r) return;
    await tx.execute(sql`update hub.stage_runs set status = 'needs_decision', last_error_code = ${code},
        updated_at = now()
      where process_run_id = ${runId} and tenant_id = ${r.tenant_id}::uuid and stage_idx = ${r.idx}`);
  });
}
