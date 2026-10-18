// HUB-FR-110 · HUB-FR-114 · HUB-FR-143 · D9 · PD-R08 · T7s/T7b · adapter: vòng đời hàng `hub.team_runs` (vào lại stage
// nhóm theo `teamResumePlan`, tạm dừng chờ thử lại, đóng run nhóm). Bộ đếm/giới hạn vẫn ở `runs/team-counters`; scope system.
import type { Tx } from "@ai/db";
import { withHubScope } from "@ai/db/hub-scope";
import { sql } from "drizzle-orm";
import type { TeamRunRepo } from "../../application/ports";
import { teamResumePlan } from "../../domain/runs/team-retry.rules";
import type { TeamRunStatus } from "../../domain/types";
import type { TeamDeps } from "../../runs/team-load";

/** Bước kế hoạch đã lưu (`team_runs.plan`) — chỉ cần `member` để dựng lại danh sách chạy. */
export type SavedStep = { member: string };
/** `retry` ⇒ vào lại sau hẹn thử lại (PD-R08): lượt gọi đầu (parallel: cả lượt) không đếm `calls`. */
export type EnsuredRun = {
  id: string;
  resume: boolean;
  retry: boolean;
  cursor: number;
  plan: SavedStep[] | null;
};
type CurRow = {
  id: string;
  status: TeamRunStatus;
  cursor: number;
  segment_started_at: Date | string | null;
  plan: SavedStep[] | null;
};

/**
 * HUB-FR-110 · PD-R08 · team_run của (stage, attempt) khi (re)vào stage nhóm, theo `teamResumePlan`: `resume_answer` ⇒
 * set running + trả `cursor`; `resume_retry` ⇒ `segment_started_at = now` (Clock), giữ cursor/plan/calls; `new` ⇒ dùng lại
 * hàng `running` (nếu có) hoặc tạo mới (bộ đếm 0). Scope system (RLS T).
 */
export async function ensureTeamRun(
  d: TeamDeps,
  p: {
    tenantId: string;
    procRunId: string;
    stageId: string;
    attempt: number;
    teamId: string;
    mode: string;
  },
): Promise<EnsuredRun> {
  const at = d.now().toISOString(); // Clock — cùng đồng hồ với limitReason (không dùng now() SQL)
  return withHubScope(d.db, { kind: "system" }, async (tx) => {
    const [cur] = await tx.execute<CurRow>(sql`select id, status, cursor, segment_started_at, plan
      from hub.team_runs where stage_run_id = ${p.stageId} and attempt = ${p.attempt}
      order by started_at desc limit 1`);
    const how = teamResumePlan(
      cur
        ? {
            status: cur.status,
            segmentStartedAt: cur.segment_started_at ? new Date(cur.segment_started_at) : null,
            cursor: Number(cur.cursor),
          }
        : null,
    );
    if (cur && how !== "new") {
      const seg =
        how === "resume_answer"
          ? sql`status = 'running', segment_started_at = ${at}::timestamptz`
          : sql`segment_started_at = ${at}::timestamptz`;
      await tx.execute(sql`update hub.team_runs set ${seg} where id = ${cur.id}`);
      const retry = how === "resume_retry";
      return {
        id: cur.id,
        resume: true,
        retry,
        cursor: Number(cur.cursor),
        plan: cur.plan ?? null,
      };
    }
    if (cur?.status === "running")
      return { id: cur.id, resume: false, retry: false, cursor: Number(cur.cursor), plan: null };
    const id = crypto.randomUUID();
    await tx.execute(sql`insert into hub.team_runs (id, tenant_id, stage_run_id, process_run_id, attempt,
        team_id, mode, status, segment_started_at)
      values (${id}, ${p.tenantId}, ${p.stageId}, ${p.procRunId}, ${p.attempt}, ${p.teamId},
        ${p.mode}, 'running', ${at}::timestamptz)`);
    return { id, resume: false, retry: false, cursor: 0, plan: null };
  });
}

/**
 * #195 · đầu ra các thành viên (không phải lead `plan`) đã xong của team_run, theo thứ tự hoàn tất — MỘT câu (join
 * jobs→runs→run_steps), để dựng lại bản nháp gộp khi vào lại stage nhóm. Lượt hỏi (`need_input`) bị loại.
 */
export async function doneMemberOutputs(
  tx: Tx,
  teamRunId: string,
): Promise<{ agent_id: string; text: string }[]> {
  const rows = await tx.execute<{
    agent_id: string;
    text: string;
  }>(sql`select j.agent_id::text as agent_id,
      j.result->'result'->>'text' as text
    from hub.jobs j
    join hub.runs r on r.id = j.run_id
    join hub.run_steps rs on rs.id = j.step_id
    where r.team_run_id = ${teamRunId} and j.status = 'succeeded' and j.result->>'kind' = 'agent_result'
      and coalesce(j.result->'result'->>'status', 'done') <> 'need_input'
      and coalesce(rs.detail->>'role', 'member') <> 'plan' and j.agent_id is not null
    order by j.finished_at, j.created_at`);
  return [...rows].filter((o) => typeof o.text === "string");
}

/** Chốt thời gian chạy của đoạn hiện tại vào `active_ms` (dùng khi đóng/tạm dừng run nhóm). */
export async function flushActive(tx: Tx, teamRunId: string, now: Date): Promise<void> {
  await tx.execute(sql`update hub.team_runs set active_ms = active_ms + case when segment_started_at is null
      then 0 else greatest(0, floor(extract(epoch from (${now.toISOString()}::timestamptz - segment_started_at)) * 1000))::int end,
      segment_started_at = null where id = ${teamRunId}`);
}

/** Đóng run nhóm: chốt `active_ms` rồi đặt `set` + `finished_at` — một tx. */
export async function endRun(
  d: TeamDeps,
  teamRunId: string,
  set: ReturnType<typeof sql>,
): Promise<void> {
  await withHubScope(d.db, { kind: "system" }, async (tx) => {
    await flushActive(tx, teamRunId, d.now());
    await tx.execute(
      sql`update hub.team_runs set ${set}, finished_at = now() where id = ${teamRunId}`,
    );
  });
}

/** Một câu: chốt `active_ms` + `failed`/`member_failed` + `finished_at` (chỉ hàng còn `running`). */
const failSql = (
  teamRunId: string,
  tenant: ReturnType<typeof sql>,
  now: Date,
) => sql`update hub.team_runs
  set active_ms = active_ms + case when segment_started_at is null then 0
      else greatest(0, floor(extract(epoch from (${now.toISOString()}::timestamptz - segment_started_at)) * 1000))::int end,
    segment_started_at = null, status = 'failed', stop_reason = 'member_failed', finished_at = now()
  where id = ${teamRunId} and status = 'running'${tenant}`;

/** T7b · run nhóm mồ côi (tx quy trình bỏ vì run đã kết thúc/đua): đóng `failed` như trước (trong tx người gọi). */
export async function failTeamRunTx(tx: Tx, teamRunId: string, now = new Date()): Promise<void> {
  await tx.execute(failSql(teamRunId, sql``, now));
}

/** T7b · `TeamRunRepo` gắn tx + `tenantId` (mọi câu lọc `(id, tenant_id)`); người gọi đã khoá run → stage. */
export function teamRunRepo(tx: Tx, tenantId: string): TeamRunRepo {
  return {
    async pauseForRetry(teamRunId, cursor, now) {
      const at = now.toISOString();
      await tx.execute(sql`update hub.team_runs set active_ms = active_ms + case
          when segment_started_at is null then 0
          else greatest(0, floor(extract(epoch from (${at}::timestamptz - segment_started_at)) * 1000))::int end,
        segment_started_at = null, cursor = ${Math.max(cursor, 0)}
        where id = ${teamRunId} and tenant_id = ${tenantId} and status = 'running'`);
    },
    async markFailed(teamRunId, now) {
      await tx.execute(failSql(teamRunId, sql` and tenant_id = ${tenantId}`, now));
    },
  };
}
