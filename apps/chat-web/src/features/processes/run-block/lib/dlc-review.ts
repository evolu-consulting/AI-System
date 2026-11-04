// platform/gd0_dlc_fix · duyệt bước DLC ngay trong chat (chỉ quy trình gói `dlc`, key `dlc-*`). Luật thuần, không gọi API.
// Từ chối = `fail` + quay lại bước ĐÃ CẤU HÌNH cho điểm duyệt đó (`back_to_steps`, lấy bước gần nhất); không cấu hình ⇒ làm lại
// chính bước vừa duyệt. Các chỗ duyệt khác (ReviewTaskCard, admin-web) giữ nguyên.
import type {
  DecisionOption,
  ProcessRunFullView,
  ProcessRunView,
  StageView,
} from "@ai/contracts/chat";

const DLC_KEY_PREFIX = "dlc-";

export const isDlcProcess = (key: string): boolean => key.startsWith(DLC_KEY_PREFIX);

export type DlcReviewTarget = {
  taskId: string;
  stage: StageView;
  outputId: string | null;
  /** Bước quay lại khi Từ chối (0-based); vắng ⇒ làm lại chính bước đang duyệt. */
  backToStep?: number;
  /** Tên các giai đoạn của bước sẽ chạy lại khi Từ chối. */
  backStepName: string;
};

const stepOf = (s: StageView): number => s.step ?? s.idx;

function namesOfStep(view: ProcessRunFullView, step: number): string {
  return view.stages
    .filter((s) => stepOf(s) === step)
    .map((s) => s.name)
    .join(", ");
}

/** Bước quay lại gần nhất được cấu hình (lớn nhất trong `back_to_steps`); rỗng ⇒ vắng. */
export function rejectStepOf(stage: StageView): number | undefined {
  return stage.back_to_steps.length > 0 ? Math.max(...stage.back_to_steps) : undefined;
}

export type DlcDecisionTarget = { stageIdx: number; options: DecisionOption[] };

/** Quyết định đang mở của run DLC `needs_decision` mà người xem được quyết (`can_decide`); không ⇒ `null`. */
export function dlcDecisionTarget(view: ProcessRunView | undefined): DlcDecisionTarget | null {
  if (view?.access !== "full" || !isDlcProcess(view.process.key)) return null;
  const d = view.decision;
  if (view.status !== "needs_decision" || !d?.can_decide || d.options.length === 0) return null;
  return { stageIdx: d.stage_idx, options: d.options };
}

/** Điểm duyệt đang mở của run DLC (task `review` mở), hoặc `null` khi không có / không xem được đầy đủ. */
export function dlcReviewTarget(view: ProcessRunView | undefined): DlcReviewTarget | null {
  if (view?.access !== "full" || !isDlcProcess(view.process.key)) return null;
  const mine = view.my_tasks.find((t) => t.kind === "review" && t.status === "open");
  const open = mine ?? view.open_tasks.find((t) => t.kind === "review");
  if (!open) return null;
  const stage = view.stages[open.stage_idx];
  if (!stage) return null;
  const backToStep = rejectStepOf(stage);
  const step = backToStep ?? stepOf(stage);
  return {
    taskId: open.id,
    stage,
    outputId: stage.current_output_id,
    ...(backToStep === undefined ? {} : { backToStep }),
    backStepName: namesOfStep(view, step) || stage.name,
  };
}
