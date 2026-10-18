// HUB-FR-110 · HUB-FR-114 · D9 · T7s · adapter: vòng đời hàng `hub.team_runs` (vào lại stage nhóm, đóng run nhóm). SQL
// giữ nguyên từ `runs/team-counters` (bộ đếm/giới hạn vẫn ở đó); scope system, RLS T.
import type { Tx } from "@ai/db";
import { withHubScope } from "@ai/db/hub-scope";
import { sql } from "drizzle-orm";
import type { TeamDeps } from "../../runs/team-load";

export type EnsuredRun = { id: string; resume: boolean; cursor: number };
/**
 * HUB-FR-110 · team_run của (stage, attempt) khi (re)vào stage nhóm: `waiting_answer` ⇒ resume (set running + trả `cursor`
 * để chạy tiếp đúng thành viên đã hỏi); `running` ⇒ dùng lại; không có ⇒ tạo mới (bộ đếm 0). Scope system (RLS T).
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
  return withHubScope(d.db, { kind: "system" }, async (tx) => {
    const [cur] = await tx.execute<{ id: string; status: string; cursor: number }>(sql`select id,
      status, cursor from hub.team_runs where stage_run_id = ${p.stageId} and attempt = ${p.attempt}
      order by started_at desc limit 1`);
    if (cur && (cur.status === "running" || cur.status === "waiting_answer")) {
      const resume = cur.status === "waiting_answer";
      if (resume)
        await tx.execute(sql`update hub.team_runs set status = 'running', segment_started_at = now()
          where id = ${cur.id}`);
      return { id: cur.id, resume, cursor: Number(cur.cursor) };
    }
    const id = crypto.randomUUID();
    await tx.execute(sql`insert into hub.team_runs (id, tenant_id, stage_run_id, process_run_id, attempt,
        team_id, mode, status, segment_started_at)
      values (${id}, ${p.tenantId}, ${p.stageId}, ${p.procRunId}, ${p.attempt}, ${p.teamId},
        ${p.mode}, 'running', now())`);
    return { id, resume: false, cursor: 0 };
  });
}

/** Chốt thời gian chạy của đoạn hiện tại vào `active_ms` (dùng khi đóng/tạm dừng run nhóm). */
export async function flushActive(tx: Tx, teamRunId: string): Promise<void> {
  await tx.execute(sql`update hub.team_runs set active_ms = active_ms + case when segment_started_at is null
      then 0 else greatest(0, (extract(epoch from (now() - segment_started_at)) * 1000)::int) end,
      segment_started_at = null where id = ${teamRunId}`);
}

/** Đóng run nhóm: chốt `active_ms` rồi đặt `set` + `finished_at` — một tx. */
export async function endRun(
  d: TeamDeps,
  teamRunId: string,
  set: ReturnType<typeof sql>,
): Promise<void> {
  await withHubScope(d.db, { kind: "system" }, async (tx) => {
    await flushActive(tx, teamRunId);
    await tx.execute(
      sql`update hub.team_runs set ${set}, finished_at = now() where id = ${teamRunId}`,
    );
  });
}

export const markFailed = (d: TeamDeps, teamRunId: string): Promise<void> =>
  endRun(d, teamRunId, sql`status = 'failed', stop_reason = 'member_failed'`);
