// CR-127 R1 #3 · tách từ approval-engine-card.rules.ts: kế hoạch hành động duyệt (Duyệt/Từ chối/Làm lại/Trả lại).
import {
  type EngineCardInput,
  engineCardView,
  openStep,
  stageAt,
} from "./approval-engine-card.rules";

export type EngineAction = "approve" | "reject" | "redo" | "return";
export type EngineErrorCode =
  | "APPROVAL_NOT_OPEN"
  | "NOT_REVIEWER"
  | "STARTER_CANNOT_REVIEW"
  | "FEEDBACK_REQUIRED";
export type EnginePlan =
  | { kind: "error"; code: EngineErrorCode }
  | { kind: "pass"; taskId: string; finalizes: boolean }
  | { kind: "fail_back"; taskId: string; backTo: number }
  /** CR-124 · q6 · lượt flow theo sự kiện (`from_run`) mà stage KHÔNG có đích lùi: Trả lại = quyết `fail` không `back_to_step` — nhánh «Trả lại» do chính stage Duyệt quyết (`return_step`). */
  | { kind: "fail_flow"; taskId: string }
  | { kind: "reject"; taskId: string }
  | { kind: "redo"; taskId: string; reextract: boolean };

export const hasText = (s: string | null | undefined) => typeof s === "string" && s.trim() !== "";
export const err = (code: EngineErrorCode): EnginePlan => ({ kind: "error", code });

/** Hành động ⇒ kế hoạch (đã kiểm: bước mở có task, quyền `can_act`, lý do, Trả lại không ở bước soạn). */
export function planEngineAct(
  i: EngineCardInput & {
    action: EngineAction;
    feedback: string | null | undefined;
    hasSource: boolean;
    /** CR-127 · E4 · ý kiến của bằng chứng cũng là lý do hợp lệ của Trả lại/Từ chối (một nơi nhập ý kiến). */
    evidenceNote?: string | null | undefined;
  },
): EnginePlan {
  const card = engineCardView(i);
  const open = openStep(card.steps);
  const task = open ? stageAt(i.sv, open.idx)?.task : null;
  if (i.approval.status !== "level1" || !open || !task) return err("APPROVAL_NOT_OPEN");
  if (!task.can_act)
    return err(card.block_reason === "starter" ? "STARTER_CANNOT_REVIEW" : "NOT_REVIEWER");
  if (i.action !== "approve" && !hasText(i.feedback) && !hasText(i.evidenceNote))
    return err("FEEDBACK_REQUIRED");
  if (i.action === "approve")
    return { kind: "pass", taskId: task.id, finalizes: card.finalizes_on_approve };
  if (i.action === "reject") return { kind: "reject", taskId: task.id };
  if (i.action === "redo") return { kind: "redo", taskId: task.id, reextract: i.hasSource };
  if (card.from_run) {
    // Lượt flow theo sự kiện: bước 0 là stage thật. Stage có đích lùi (`back_to_steps`) ⇒ lùi về đó; không ⇒ nhánh Trả lại của stage.
    const back = stageAt(i.sv, open.idx)?.back_to_steps?.[0];
    return typeof back === "number"
      ? { kind: "fail_back", taskId: task.id, backTo: back }
      : { kind: "fail_flow", taskId: task.id };
  }
  // Bước 0 của thẻ máy cũ là bước soạn (không có nơi để trả về); các bước sau lùi về bước soạn 0.
  return open.idx === 0
    ? err("APPROVAL_NOT_OPEN")
    : { kind: "fail_back", taskId: task.id, backTo: 0 };
}
