// HUB-FR-106 · HUB-FR-146 · HUB-FR-147 · HUB-BR-38(a,e) · P-b2 plan §3.3–3.4 (D2/D4) · P-d2 T19s/T19 (plan-d2 §3, §7, D2-16):
// join bước trên trạng thái SAU ghi — mọi stage của bước done/skipped ⇒ bước kế `queued` (hoặc run `done`); còn lại ⇒
// `process_runs.status = runStatusOf(bước)`. `current_stage_idx` luôn = stage nhỏ nhất của bước hiện tại.
// Chạy TRONG tx đã khoá `process_runs` FOR UPDATE. Số câu: 2 đọc + 1 (wait/finish) hoặc 2 (next_step).
// T19 · PD2-R13/R14 · rẽ nhánh chèn MỘT chỗ (nhánh `next_step`): bước hiện tại có đúng một stage có `after.branch` ⇒ +1 câu
// đọc `fields`; luật khớp (đánh giá trong bộ nhớ) ⇒ +3 câu theo tập (nhảy stage, huỷ hẹn, audit + thread) — không phụ
// thuộc số bước bị nhảy (plan-d2 §9, PD2-P04).
import { evaluateBranch, skippedStages } from "../../domain/branch/branch.rules";
import {
  firstIdxOfStep,
  runStatusOf,
  stageIdxsOfStep,
  statusForRun,
  stepJoin,
} from "../../domain/runs/step.rules";
import type { ProcessRunStatus } from "../../domain/types";
import type { StepJoinLoad, StepRepo } from "../ports";

/** Kết quả sau ghi: `process_runs.status/current_step/current_stage_idx` mới. */
export type StepOutcome = {
  kind: "wait" | "next_step" | "finish";
  status: ProcessRunStatus;
  step: number;
  stageIdx: number;
};
export type StepRepos = { steps: StepRepo };

/** PD2-R13 · bước đích nếu stage đứng một mình của `step` có luật rẽ nhánh khớp; ngược lại `null` (đi bước kế). */
async function branchTarget(
  r: StepRepos,
  runId: string,
  load: StepJoinLoad,
): Promise<{ gotoStep: number; rule: number; stageIdx: number } | null> {
  const idxs = stageIdxsOfStep(load.steps, load.step);
  const idx = idxs[0];
  if (idx === undefined || idxs.length !== 1) return null;
  const rules = load.branches[idx] ?? [];
  if (rules.length === 0) return null;
  const hit = evaluateBranch(rules, await r.steps.currentFields(runId, idx));
  // Phòng thủ (luật lưu def đã chặn): đích phải là bước có thật SAU bước hiện tại.
  if (!hit || hit.gotoStep <= load.step || firstIdxOfStep(load.steps, hit.gotoStep) < 0)
    return null;
  return { ...hit, stageIdx: idx };
}

/** Khớp ⇒ stage bước (step, goto) ⇒ `skipped` + huỷ hẹn của chúng + sự kiện `branch`; trả bước đích. */
async function takeBranch(r: StepRepos, runId: string, load: StepJoinLoad): Promise<number | null> {
  const b = await branchTarget(r, runId, load);
  if (!b) return null;
  const ids = await r.steps.skipStages(runId, skippedStages(load.steps, load.step, b.gotoStep));
  // T19-perf · hai câu ghi độc lập gửi liền (pipeline); Postgres chạy theo thứ tự gửi ⇒ khoá hẹn vẫn trước (plan-d2 §8).
  await Promise.all([
    r.steps.cancelTimers(runId, ids),
    r.steps.branchEvent(runId, {
      stageIdx: b.stageIdx,
      fromStep: load.step,
      toStep: b.gotoStep,
      rule: b.rule,
    }),
  ]);
  return b.gotoStep;
}

export async function settleStep(r: StepRepos, runId: string): Promise<StepOutcome | null> {
  const load = await r.steps.loadJoin(runId);
  if (!load) return null;
  const { steps, step, statuses } = load;
  const j = stepJoin({ steps, step, statuses });
  if (j.kind === "next_step") {
    const goto = await takeBranch(r, runId, load);
    const to = goto ?? j.step;
    const idxs = goto === null ? j.queue : stageIdxsOfStep(steps, goto);
    const next = firstIdxOfStep(steps, to);
    await r.steps.queueStep(runId, { idxs, step: to, first: next });
    return { kind: "next_step", status: "running", step: to, stageIdx: next };
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
