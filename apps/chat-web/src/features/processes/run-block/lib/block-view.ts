// CHAT-AC-52/53 · plan-frontend-thread §4 + plan-frontend §6: dẫn xuất thuần từ `ProcessRunFullView` cho khối/thanh trạng thái.
import type { ProcessRunFullView } from "@ai/contracts/chat";
import type { StageStripItem } from "../../shared/components/StageStrip";

export type BlockAction = "review" | "answer" | "decide";

/** Thanh giai đoạn: tên + trạng thái mỗi giai đoạn (chạy xong ⇒ toàn `done`, StageStrip tô xanh). */
export function stageItems(view: ProcessRunFullView): StageStripItem[] {
  return view.stages.map((s) => ({ idx: s.idx, name: s.name, status: s.status }));
}

/** Nút mở thread ở khối timeline (chỉ assignee): review → "Kiểm ngay", ask → "Trả lời", decision/`can_decide` → "Quyết định". */
export function myActions(view: ProcessRunFullView): BlockAction[] {
  const acts = new Set<BlockAction>();
  for (const task of view.my_tasks) {
    if (task.status !== "open") continue;
    if (task.kind === "review") acts.add("review");
    else if (task.kind === "ask") acts.add("answer");
    else if (task.kind === "decision") acts.add("decide");
  }
  if (view.decision?.can_decide) acts.add("decide");
  return (["review", "answer", "decide"] as const).filter((a) => acts.has(a));
}

/** Giai đoạn hiện tại (để dựng dòng "Đang chạy · Giai đoạn n/t · tên" và chip Làm lại/Hỏi lại). */
export function currentStage(view: ProcessRunFullView) {
  return view.stages.find((s) => s.idx === view.current_stage_idx);
}
