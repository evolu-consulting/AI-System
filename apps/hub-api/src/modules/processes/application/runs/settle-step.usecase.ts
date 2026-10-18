// HUB-FR-106 · HUB-FR-146 · HUB-BR-38(a) · P-b2 plan §3.3–3.4 (D2/D4) · P-d2 T19s (tách từ `runs/step-persist.ts`, không đổi
// hành vi; plan-d2 §3, §7, D2-16): join bước trên trạng thái SAU ghi — mọi stage của bước done ⇒ bước kế `queued` (hoặc run
// `done`); còn lại ⇒ `process_runs.status = runStatusOf(bước)`. `current_stage_idx` luôn = stage nhỏ nhất của bước hiện tại.
// Chạy TRONG tx đã khoá `process_runs` FOR UPDATE. Số câu: 2 đọc + 1 (wait/finish) hoặc 2 (next_step) — như trước tách.
// T19 chèn rẽ nhánh MỘT chỗ: nhánh `next_step` dưới đây.
import {
  firstIdxOfStep,
  runStatusOf,
  stageIdxsOfStep,
  statusForRun,
  stepJoin,
} from "../../domain/runs/step.rules";
import type { ProcessRunStatus } from "../../domain/types";
import type { StepRepo } from "../ports";

/** Kết quả sau ghi: `process_runs.status/current_step/current_stage_idx` mới. */
export type StepOutcome = {
  kind: "wait" | "next_step" | "finish";
  status: ProcessRunStatus;
  step: number;
  stageIdx: number;
};
export type StepRepos = { steps: StepRepo };

export async function settleStep(r: StepRepos, runId: string): Promise<StepOutcome | null> {
  const load = await r.steps.loadJoin(runId);
  if (!load) return null;
  const { steps, step, statuses } = load;
  const j = stepJoin({ steps, step, statuses });
  if (j.kind === "next_step") {
    const next = firstIdxOfStep(steps, j.step);
    await r.steps.queueStep(runId, { idxs: j.queue, step: j.step, first: next });
    return { kind: "next_step", status: "running", step: j.step, stageIdx: next };
  }
  const first = firstIdxOfStep(steps, step);
  if (j.kind === "finish") {
    await r.steps.finish(runId, first);
    return { kind: "finish", status: "done", step, stageIdx: first };
  }
  // PD-R15 · loại hẹn suy từ executor (stage `wait_until` không bao giờ thử lại; stage khác không hẹn `wait_until`).
  const kindOf = (i: number) => (load.executorKinds[i] === "wait_until" ? "wait_until" : "retry");
  const agg = runStatusOf(
    stageIdxsOfStep(steps, step).map((i) => statusForRun(statuses.get(i) ?? "pending", kindOf(i))),
  );
  const status: ProcessRunStatus = agg === "step_done" ? "running" : agg;
  await r.steps.setStatus(runId, status, first);
  return { kind: "wait", status, step, stageIdx: first };
}
