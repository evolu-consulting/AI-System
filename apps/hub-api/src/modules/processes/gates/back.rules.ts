// HUB-FR-118 · HUB-BR-38(d) · AC-PB2-06/07 · P-b2 plan §2, D7–D8 · luật thuần "Quay lại bước X": kiểm đầu vào, trần vòng
// quay lại của run, kế hoạch reset `stage_runs`. Thuần: không I/O (hiệu ứng DB ở `back.effects.ts`).
import type { StageRunStatus } from "@ai/contracts/chat";

/**
 * Kiểm quyết định duyệt có/không `back_to_step` (góp ý kiểm TRƯỚC đích — RB-01). `pass` + đích ⇒ BACK_TARGET_INVALID;
 * `fail` + đích ∉ `after.back_to_steps` (hoặc ≥ bước của stage) ⇒ BACK_TARGET_INVALID; `fail` không đích ⇒ ok (làm lại như cũ).
 */
export function backDecisionCheck(
  b: { result: "pass" | "fail"; feedback?: string; back_to_step?: number },
  stage: { step: number; backToSteps: readonly number[] },
): "ok" | "FEEDBACK_REQUIRED" | "BACK_TARGET_INVALID" {
  if (b.back_to_step === undefined) return "ok";
  if (b.result === "pass") return "BACK_TARGET_INVALID";
  if (!b.feedback || b.feedback.trim().length === 0) return "FEEDBACK_REQUIRED";
  const t = b.back_to_step;
  return t < stage.step && stage.backToSteps.includes(t) ? "ok" : "BACK_TARGET_INVALID";
}

/** D8 · còn được quay lại: `backRounds < backLimit`. */
export function backAllowed(run: { backRounds: number; backLimit: number }): boolean {
  return run.backRounds < run.backLimit;
}

/** Số vòng quay lại còn lại: `max(0, backLimit − backRounds)`. */
export function backRoundsLeft(run: { backRounds: number; backLimit: number }): number {
  return Math.max(0, run.backLimit - run.backRounds);
}

export type BackReset = {
  idx: number;
  status: "queued" | "pending";
  round: number;
  feedback: string | null;
};

/**
 * D7 · reset khi quay lại bước `target`: stage bước = target ⇒ `queued` + góp ý; bước > target ⇒ `pending`, góp ý null;
 * `round + 1` chỉ cho stage đã từng chạy (status ≠ `pending`). Stage bước < target không có phần tử. Trả theo idx tăng dần.
 */
export function backResetPlan(p: {
  steps: readonly number[];
  target: number;
  feedback: string;
  stages: readonly { idx: number; status: StageRunStatus; round: number }[];
}): BackReset[] {
  return [...p.stages]
    .sort((a, b) => a.idx - b.idx)
    .flatMap((s): BackReset[] => {
      const step = p.steps[s.idx];
      if (step === undefined || step < p.target) return [];
      const round = s.status === "pending" ? s.round : s.round + 1;
      return step === p.target
        ? [{ idx: s.idx, status: "queued", round, feedback: p.feedback }]
        : [{ idx: s.idx, status: "pending", round, feedback: null }];
    });
}
