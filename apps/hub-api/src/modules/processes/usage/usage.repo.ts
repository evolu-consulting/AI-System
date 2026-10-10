// HUB-FR-116 · HUB-FR-117 · PF4 · đọc usage của một process run (plan §6). Chạy trong tx scope `system` SAU khi quyền đã
// được kiểm ở scope `user` (run_steps RLS chủ run; usage_logs không RLS). Mọi câu lọc `tenant_id` tường minh + khoá vào
// `process_run_id`. Không log nội dung.
import type { Tx } from "@ai/db";
import { sql } from "drizzle-orm";
import type { StageMeta, UsageRow } from "./usage.rules";

type RawRow = {
  runId: string;
  stageRunId: string;
  stageIdx: number;
  teamRunId: string | null;
  stepId: string | null;
  role: string;
  memberKey: string | null;
  agentKey: string;
  agentName: string | null;
  model: string | null;
  input: number;
  output: number;
  cacheRead: number | null;
  cacheWrite: number | null;
  latencyMs: number | null;
  at: Date | string;
};

/**
 * Σ `usage_logs` của mọi `hub.runs` có `process_run_id = runId` (plan §6: `runs_process_run_idx` → `usage_logs_run_idx`).
 * `LEFT JOIN run_steps` lấy role/member_key (N4), `LEFT JOIN agents` lấy tên hiển thị; `JOIN stage_runs` lấy `stage_idx`.
 */
export async function loadUsageRows(tx: Tx, tenantId: string, runId: string): Promise<UsageRow[]> {
  const rows = await tx.execute<RawRow>(sql`
    select
      ul.run_id as "runId",
      r.stage_run_id as "stageRunId",
      sr.stage_idx as "stageIdx",
      r.team_run_id as "teamRunId",
      ul.step_id as "stepId",
      coalesce(s.detail->>'role', 'agent') as role,
      s.detail->>'member_key' as "memberKey",
      coalesce(ag.key, 'agent') as "agentKey",
      coalesce(ag.name->>'vi', ag.key) as "agentName",
      ul.model as model,
      ul.input_tokens as input,
      ul.output_tokens as output,
      ul.cache_read_tokens as "cacheRead",
      ul.cache_write_tokens as "cacheWrite",
      ul.latency_ms as "latencyMs",
      ul.at as at
    from hub.usage_logs ul
    join hub.runs r on r.id = ul.run_id and r.process_run_id = ${runId}::uuid and r.tenant_id = ${tenantId}::uuid
    join hub.stage_runs sr on sr.id = r.stage_run_id and sr.tenant_id = ${tenantId}::uuid
    left join hub.run_steps s on s.id = ul.step_id and s.tenant_id = ${tenantId}::uuid
    left join hub.agents ag on ag.id = ul.agent_id
    where ul.tenant_id = ${tenantId}::uuid
    order by sr.stage_idx, ul.at, ul.id`);
  return rows.map((r) => ({
    runId: r.runId,
    stageRunId: r.stageRunId,
    stageIdx: Number(r.stageIdx),
    teamRunId: r.teamRunId,
    stepId: r.stepId,
    role: (r.role === "plan" || r.role === "member" ? r.role : "agent") as UsageRow["role"],
    memberKey: r.memberKey,
    agentKey: r.agentKey,
    agentName: r.agentName,
    model: r.model,
    input: Number(r.input),
    output: Number(r.output),
    cacheRead: r.cacheRead === null ? null : Number(r.cacheRead),
    cacheWrite: r.cacheWrite === null ? null : Number(r.cacheWrite),
    latencyMs: r.latencyMs === null ? null : Number(r.latencyMs),
    at: new Date(r.at),
  }));
}

type RawStage = {
  stageIdx: number;
  name: string;
  attempts: number;
  asksCount: number;
};
type RawTeamRun = {
  id: string;
  stageIdx: number;
  attempt: number;
  mode: string;
  status: string;
  stopReason: string | null;
  activeMs: number;
};

async function queryStageRows(tx: Tx, tenantId: string, runId: string) {
  return await tx.execute<RawStage>(sql`
    select
      sr.stage_idx as "stageIdx",
      coalesce(pr.snapshot->'stages'->(sr.stage_idx::int)->>'name', 'Stage ' || sr.stage_idx) as name,
      sr.attempt as attempts,
      sr.asks_count as "asksCount"
    from hub.stage_runs sr
    join hub.process_runs pr on pr.id = sr.process_run_id and pr.tenant_id = sr.tenant_id
    where sr.process_run_id = ${runId}::uuid and sr.tenant_id = ${tenantId}::uuid
    order by sr.stage_idx`);
}

async function queryTeamRows(tx: Tx, tenantId: string, runId: string) {
  return await tx.execute<RawTeamRun>(sql`
    select
      tr.id as id,
      sr.stage_idx as "stageIdx",
      tr.attempt as attempt,
      tr.mode as mode,
      tr.status as status,
      tr.stop_reason as "stopReason",
      tr.active_ms as "activeMs"
    from hub.team_runs tr
    join hub.stage_runs sr on sr.id = tr.stage_run_id and sr.tenant_id = tr.tenant_id
    where tr.process_run_id = ${runId}::uuid and tr.tenant_id = ${tenantId}::uuid
    order by sr.stage_idx, tr.attempt`);
}

function groupTeamRunsByStage(teamRows: Iterable<RawTeamRun>) {
  const byStage = new Map<number, StageMeta["teamRuns"][number][]>();
  for (const t of teamRows) {
    const idx = Number(t.stageIdx);
    const list = byStage.get(idx) ?? [];
    list.push({
      id: t.id,
      attempt: Number(t.attempt),
      mode: t.mode,
      status: t.status,
      stopReason: t.stopReason,
      activeMs: Number(t.activeMs),
    });
    byStage.set(idx, list);
  }
  return byStage;
}

/** Siêu dữ liệu stage + team_run của run (một stage ⇒ một `StageMeta`, team_run gắn theo `stage_idx`). */
export async function loadStageMetas(
  tx: Tx,
  tenantId: string,
  runId: string,
): Promise<StageMeta[]> {
  const stageRows = await queryStageRows(tx, tenantId, runId);
  const byStage = groupTeamRunsByStage(await queryTeamRows(tx, tenantId, runId));
  return stageRows.map((s) => {
    const idx = Number(s.stageIdx);
    return {
      stageIdx: idx,
      name: s.name,
      attempts: Number(s.attempts),
      asksCount: Number(s.asksCount),
      teamRuns: byStage.get(idx) ?? [],
    };
  });
}
