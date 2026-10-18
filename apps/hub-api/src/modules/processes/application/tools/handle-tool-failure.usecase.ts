// HUB-FR-146 · HUB-BR-12 · AC-H44 · PD2-R05 · D2-13 · plan-d2 §4 bước 4 `failed`: lời gọi tool lỗi ⇒ thử lại (stage
// `waiting_timer` + hẹn `retry`, backoff 30 s/2'/8', tối đa 3 — CÙNG `scheduleRetry` của job agent) hay quyết
// (`tool_failed` / `retry_exhausted`). Tool `side_effect` đã gửi ⇒ KHÔNG gọi lại (S4). Trong tx người gọi, run + stage ĐÃ
// khoá; `state` lấy từ `loadCall` (stage vẫn `running` của cùng hub run ⇒ bộ đếm không đổi giữa hai tx — đỡ một câu).
import type { RetryDecision, RetryState } from "../../domain/runs/retry.rules";
import { type ToolFailure, toolFailureDecision } from "../../domain/tools/tool-run.rules";
import type { TxRepos } from "../ports";
import { scheduleRetry } from "../runs/handle-job-failure.usecase";

export type ToolFailureIn = {
  runId: string;
  stageRunId: string;
  failure: ToolFailure;
  sideEffect: boolean;
  state: RetryState;
};

export async function handleToolFailure(
  r: Pick<TxRepos, "retry" | "timers">,
  f: ToolFailureIn,
  now: Date,
): Promise<RetryDecision> {
  const dec = toolFailureDecision({ f: f.failure, sideEffect: f.sideEffect, state: f.state, now });
  if (dec.kind !== "retry") return dec;
  const x = {
    runId: f.runId,
    stageRunId: f.stageRunId,
    state: f.state,
    lastErrorCode: f.failure.code,
  };
  await scheduleRetry(r, x, dec, now);
  return dec;
}
