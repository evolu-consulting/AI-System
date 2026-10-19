// HUB-FR-146 · PD2-R09 · T18-perf · khoá stage + đầu run (MỘT câu) và audit `tool_call` của `ToolStageRepo`; tách khỏi
// `tool-stage.repo.ts` để giữ trần 200 dòng adapter (PD-A03).
import type { Tx } from "@ai/db";
import { sql } from "drizzle-orm";
import type { ToolCallAudit } from "../../application/tools/tool.ports";
import type { StageRowIdx } from "../../runs/step-persist";
import type { RunHead } from "../../runs/team-runner";
export type LockedRow = StageRowIdx & { head: RunHead };
type LockRaw = Omit<StageRowIdx, "stage_idx"> & {
  stage_idx: number | string;
  r_tenant_id: string;
  r_started_by: string;
  r_status: string;
  r_current_stage_idx: number;
  r_input: string;
  r_snapshot: RunHead["snapshot"];
};

/**
 * MỘT câu (T18-perf): `for update of s` hàng stage + đầu run (`headOf`) cùng lúc. Gọi SAU `runs.lock` (thứ tự khoá run →
 * stage giữ nguyên; run đã khoá nên đầu run đọc ở đây là bản mới nhất).
 */
export async function lockStageWithHead(
  tx: Tx,
  tenantId: string,
  stageRunId: string,
): Promise<LockedRow | null> {
  const [s] = await tx.execute<LockRaw>(sql`select s.id, s.stage_idx, s.status, s.attempt,
      s.attempt_limit, s.asks_count, s.ask_limit, s.current_output_id, s.current_run_id,
      r.tenant_id as r_tenant_id, r.started_by as r_started_by, r.status as r_status,
      r.current_stage_idx as r_current_stage_idx, r.input as r_input, r.snapshot as r_snapshot
    from hub.stage_runs s join hub.process_runs r on r.id = s.process_run_id and r.tenant_id = s.tenant_id
    where s.id = ${stageRunId} and s.tenant_id = ${tenantId} for update of s`);
  if (!s) return null;
  const { r_tenant_id, r_started_by, r_status, r_current_stage_idx, r_input, r_snapshot, ...st } =
    s;
  const head: RunHead = {
    tenant_id: r_tenant_id,
    started_by: r_started_by,
    status: r_status,
    current_stage_idx: r_current_stage_idx,
    input: r_input,
    snapshot: r_snapshot,
  };
  return { ...st, stage_idx: Number(st.stage_idx), head };
}

/** PD2-R09 · audit `tool_call` — actor = người bắt đầu (gọi bằng danh tính họ, S1); `summary` chỉ id/mã/thời gian. */
export async function insertAudit(tx: Tx, tenantId: string, x: ToolCallAudit): Promise<void> {
  const summary = {
    run_id: x.runId,
    stage_run_id: x.stageRunId,
    tool_key: x.toolKey,
    started_by: x.startedBy,
    status: x.status,
    code: x.code,
    ms: x.ms,
  };
  await tx.execute(sql`insert into hub.audit_log (tenant_id, actor_id, actor_role, action, entity, entity_id,
      entity_name, summary)
    values (${tenantId}::uuid, ${x.startedBy}::uuid, null, 'tool_call', 'process_run', ${x.runId}::uuid,
      ${x.toolKey.slice(0, 200)}, ${JSON.stringify(summary)}::jsonb)`);
}
