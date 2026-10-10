// HUB-FR-117 · AC-H34 · C5 · Q4 · PF4 · gom token thuần `usage_logs` → `ProcessRunUsage` (plan §6, plan-contract §2, §7).
// Thuần, không I/O. Nguồn số là `rows` (Σ `usage_logs` của mọi `hub.runs` có `process_run_id`); `stages` = siêu dữ liệu
// stage_runs + team_runs (attempt, asks_count, tên, các team_run). `summary` (người xem `task`, HUB-BR-25): giữ `totals`
// từng stage nhưng `team_runs=[]`, `calls=[]` — không lộ chi tiết từng lần gọi.
import type { ProcessRunUsage, TokenTotals, UsageCall } from "@ai/contracts/chat";
import { USAGE_STAGE_CALLS_MAX, USAGE_TEAM_CALLS_MAX } from "@ai/contracts/chat";

/** Một lần gọi agent = một `usage_logs` (join `run_steps` cho role/member_key, `hub.runs` cho stage/team). */
export type UsageRow = {
  runId: string;
  stageRunId: string;
  stageIdx: number;
  teamRunId: string | null;
  stepId: string | null;
  role: "agent" | "plan" | "member";
  memberKey: string | null;
  agentKey: string;
  /** Tên hiển thị agent (join `hub.agents`); vắng ⇒ dùng `agentKey` (test luật thuần không cần tên). */
  agentName?: string | null;
  model: string | null;
  input: number;
  output: number;
  cacheRead: number | null;
  cacheWrite: number | null;
  latencyMs: number | null;
  at: Date;
};

/** Siêu dữ liệu một stage của run (stage_runs + team_runs của nó). `name` lấy từ snapshot định nghĩa. */
export type StageMeta = {
  stageIdx: number;
  name: string;
  attempts: number;
  asksCount: number;
  teamRuns: readonly {
    id: string;
    attempt: number;
    mode: string;
    status: string;
    stopReason: string | null;
    activeMs: number;
  }[];
};

const n = (v: number | null): number => v ?? 0;

/** `calls` = số dòng gộp (một lần gọi ⇒ 1). */
function totalsOf(rows: readonly UsageRow[]): TokenTotals {
  let input = 0;
  let output = 0;
  let cacheRead = 0;
  let cacheWrite = 0;
  for (const r of rows) {
    input += r.input;
    output += r.output;
    cacheRead += n(r.cacheRead);
    cacheWrite += n(r.cacheWrite);
  }
  return {
    input,
    output,
    cache_read: cacheRead,
    cache_write: cacheWrite,
    total: input + output + cacheRead + cacheWrite,
    calls: rows.length,
  };
}

function callOf(r: UsageRow): UsageCall {
  const input = r.input;
  const output = r.output;
  const cacheRead = n(r.cacheRead);
  const cacheWrite = n(r.cacheWrite);
  return {
    step_id: r.stepId,
    role: r.role,
    member_key: r.memberKey,
    agent: { key: r.agentKey, name: r.agentName ?? r.agentKey },
    model: r.model,
    tokens: {
      input,
      output,
      cache_read: cacheRead,
      cache_write: cacheWrite,
      total: input + output + cacheRead + cacheWrite,
      calls: 1,
    },
    latency_ms: r.latencyMs,
    at: new Date(r.at).toISOString(),
  };
}

/**
 * Dựng `ProcessRunUsage`. `totals` ở mọi mức là Σ các khoản token của các dòng liên quan (AC-H34). Dòng thuộc một
 * team_run (`teamRunId`) rơi vào `team_runs[].calls`; dòng không thuộc team_run rơi vào `stage.calls`; cả hai đều cộng vào
 * `stage.totals`. Danh sách lần gọi bị cắt (`USAGE_STAGE_CALLS_MAX`/`USAGE_TEAM_CALLS_MAX`) nhưng `totals.calls` giữ đủ (Q4).
 * `processRunId` do service truyền (luật thuần không cần ⇒ mặc định rỗng).
 */
export function buildUsage(
  rows: readonly UsageRow[],
  stages: readonly StageMeta[],
  detail: "full" | "summary",
  processRunId = "",
): ProcessRunUsage {
  const full = detail === "full";
  return {
    process_run_id: processRunId,
    detail,
    totals: totalsOf(rows),
    stages: stages.map((m) => {
      const stageRows = rows.filter((r) => r.stageIdx === m.stageIdx);
      const directRows = stageRows.filter((r) => r.teamRunId === null);
      return {
        stage_idx: m.stageIdx,
        name: m.name,
        totals: totalsOf(stageRows),
        attempts: m.attempts,
        asks_count: m.asksCount,
        team_runs: full
          ? m.teamRuns.map((tr) => {
              const trRows = stageRows.filter((r) => r.teamRunId === tr.id);
              return {
                id: tr.id,
                attempt: tr.attempt,
                mode: tr.mode as TokenMode,
                status: tr.status as TeamStatus,
                stop_reason: tr.stopReason,
                active_ms: tr.activeMs,
                totals: totalsOf(trRows),
                calls: trRows.slice(0, USAGE_TEAM_CALLS_MAX).map(callOf),
              };
            })
          : [],
        calls: full ? directRows.slice(0, USAGE_STAGE_CALLS_MAX).map(callOf) : [],
      };
    }),
  };
}

// Mô tả hẹp cho TS: giá trị thật đã bị ràng buộc CHECK ở DB (team_runs_mode_ck / team_runs_status_ck).
type TokenMode = ProcessRunUsage["stages"][number]["team_runs"][number]["mode"];
type TeamStatus = ProcessRunUsage["stages"][number]["team_runs"][number]["status"];
