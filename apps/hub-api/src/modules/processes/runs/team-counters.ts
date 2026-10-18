// HUB-FR-114 · HUB-FR-115 · HUB-FR-116 · D9 · §3.3 · PF1 · bộ đếm + trạng thái `team_runs` (SQL tương đối để giá trị
// test cắm qua SQL cộng dồn đúng); giới hạn calls/tokens/active_ms + no_change. Không log nội dung.
import type { DecisionReason } from "@ai/contracts/chat";
import type { Tx } from "@ai/db";
import { withHubScope } from "@ai/db/hub-scope";
import { sql } from "drizzle-orm";
import { endRun, flushActive } from "../adapters/runs/team-run.repo";
import { type TeamLimits, teamLimitHit } from "../core/limits.rules";
import { assembleSections } from "./team.rules";
import type { TeamDeps, TeamMemberRow } from "./team-load";

/** Nháp ban đầu: attempt 1 rỗng; làm lại ⇒ các mục đã chốt của output trước. */
export async function initialDraft(
  d: TeamDeps,
  stage: { attempt: number; current_output_id: string | null },
  members: TeamMemberRow[],
): Promise<Map<string, string>> {
  if (stage.attempt <= 1 || !stage.current_output_id) return new Map();
  const [o] = await withHubScope(d.db, { kind: "system" }, (tx) =>
    tx.execute<{ content: string }>(
      sql`select content from hub.process_outputs where id = ${stage.current_output_id}`,
    ),
  );
  if (!o) return new Map();
  return assembleSections(
    new Map(),
    o.content,
    members.flatMap((m) => m.sections),
  ).next;
}

export type Counters = {
  calls: number;
  tokens: number;
  active_ms: number;
  segment_started_at: Date | string | null;
};

/**
 * Tạo `team_runs` (trong tx NGƯỜI GỌI, scope user) + trả id — launcher gọi để gán `runs.team_run_id` lúc INSERT run điều
 * phối (0015 chỉ cho UPDATE cột vòng đời `runs`, không được UPDATE `team_run_id`). Trùng (stage,attempt) ⇒ dùng lại.
 */
export async function createTeamRun(
  tx: Tx,
  p: {
    tenantId: string;
    procRunId: string;
    stageRunId: string;
    attempt: number;
    teamId: string;
    mode: string;
  },
): Promise<string> {
  const [cur] = await tx.execute<{ id: string }>(sql`select id from hub.team_runs
    where stage_run_id = ${p.stageRunId} and attempt = ${p.attempt}
      and status in ('running', 'waiting_answer') order by started_at desc limit 1`);
  if (cur) return cur.id;
  const id = crypto.randomUUID();
  await tx.execute(sql`insert into hub.team_runs (id, tenant_id, stage_run_id, process_run_id, attempt,
      team_id, mode, status, segment_started_at)
    values (${id}, ${p.tenantId}, ${p.stageRunId}, ${p.procRunId}, ${p.attempt}, ${p.teamId},
      ${p.mode}, 'running', now())`);
  return id;
}

export const LIMIT_REASON: Record<"calls" | "tokens" | "time", DecisionReason> = {
  calls: "team_calls",
  tokens: "team_tokens",
  time: "team_time",
};
const STOP_OF: Record<string, string> = {
  team_calls: "calls",
  team_tokens: "tokens",
  team_time: "time",
  team_no_change: "no_change",
};

async function readCounters(d: TeamDeps, teamRunId: string): Promise<Counters | null> {
  const [r] = await withHubScope(d.db, { kind: "system" }, (tx) =>
    tx.execute<Counters>(sql`select tr.calls, tr.active_ms, tr.segment_started_at,
      (tr.tokens + coalesce((select sum(ul.input_tokens + ul.output_tokens
          + coalesce(ul.cache_read_tokens, 0) + coalesce(ul.cache_write_tokens, 0))
        from hub.usage_logs ul join hub.runs rr on rr.id = ul.run_id and rr.tenant_id = ul.tenant_id
        where rr.team_run_id = tr.id), 0))::int as tokens
      from hub.team_runs tr where tr.id = ${teamRunId}`),
  );
  return r ?? null;
}

/** Giới hạn TRƯỚC lần gọi (calls→tokens→time); null = chưa chạm. `tokens` = cột (nền) + Σ usage_logs của team-run. */
export async function limitReason(
  d: TeamDeps,
  teamRunId: string,
  limits: TeamLimits,
): Promise<DecisionReason | null> {
  const r = await readCounters(d, teamRunId);
  if (!r) return null;
  const seg = r.segment_started_at ? new Date(r.segment_started_at).getTime() : null;
  const live = Number(r.active_ms) + (seg ? Math.max(0, d.now().getTime() - seg) : 0);
  const hit = teamLimitHit(
    { calls: Number(r.calls), tokens: Number(r.tokens), activeMs: live },
    limits,
  );
  return hit ? LIMIT_REASON[hit] : null;
}

/** `tokens` tính từ usage_logs (readCounters) nên chỉ cộng `calls` (`n` lượt — parallel một câu cho cả lượt, T7b). */
export async function addCall(d: TeamDeps, teamRunId: string, n: number): Promise<void> {
  await withHubScope(d.db, { kind: "system" }, (tx) =>
    tx.execute(sql`update hub.team_runs set calls = calls + ${n} where id = ${teamRunId}`),
  );
}

/** hash bản ghép; trùng 2 lần liền ⇒ same_count ≥ 2 (no_change). */
export async function hashSame(d: TeamDeps, teamRunId: string, hash: string): Promise<number> {
  const [r] = await withHubScope(d.db, { kind: "system" }, (tx) =>
    tx.execute<{ same_count: number }>(sql`update hub.team_runs
      set same_count = case when last_hash = ${hash} then same_count + 1 else 1 end, last_hash = ${hash}
      where id = ${teamRunId} returning same_count`),
  );
  return Number(r?.same_count ?? 1);
}

export const markLimit = (d: TeamDeps, teamRunId: string, reason: DecisionReason): Promise<void> =>
  endRun(d, teamRunId, sql`status = 'limit', stop_reason = ${STOP_OF[reason] ?? "no_change"}`);
export const markDone = (d: TeamDeps, teamRunId: string): Promise<void> =>
  endRun(d, teamRunId, sql`status = 'done'`);

export async function markWaiting(d: TeamDeps, teamRunId: string, cursor: number): Promise<void> {
  await withHubScope(d.db, { kind: "system" }, async (tx) => {
    await flushActive(tx, teamRunId);
    await tx.execute(sql`update hub.team_runs set status = 'waiting_answer', cursor = ${cursor}
      where id = ${teamRunId}`);
  });
}

export async function savePlan(d: TeamDeps, teamRunId: string, steps: unknown): Promise<void> {
  await withHubScope(d.db, { kind: "system" }, (tx) =>
    tx.execute(
      sql`update hub.team_runs set plan = ${JSON.stringify(steps)}::jsonb where id = ${teamRunId}`,
    ),
  );
}
