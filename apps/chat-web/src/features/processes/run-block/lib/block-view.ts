// CHAT-AC-52/53 · plan-frontend-thread §4 + plan-frontend §6: dẫn xuất thuần từ `ProcessRunFullView` cho khối/thanh trạng thái.
import type { OpenTask, ProcessRunFullView } from "@ai/contracts/chat";
import type { StageStripBack, StageStripItem } from "../../shared/components/StageStrip";

export type BlockAction = "review" | "answer" | "decide";

/** Thanh giai đoạn: tên + trạng thái mỗi giai đoạn (chạy xong ⇒ toàn `done`, StageStrip tô xanh). */
export function stageItems(view: ProcessRunFullView): StageStripItem[] {
  return view.stages.map((s) => ({
    idx: s.idx,
    name: s.name,
    status: s.status,
    step: s.step,
    round: s.round,
  }));
}

/** P-b2 · vệt quay lại dưới thanh: sự kiện mới nhất + "đã hết lượt" (`back_rounds ≥ back_limit > 0`). `undefined` ⇒ không vẽ. */
export function backTrail(view: ProcessRunFullView): StageStripBack | undefined {
  const events = view.back_events ?? [];
  const last = events.at(-1);
  const spent = (view.back_limit ?? 0) > 0 && (view.back_rounds ?? 0) >= (view.back_limit ?? 0);
  if (!last && !spent) return undefined;
  return {
    step: last ? last.to_step + 1 : undefined,
    count: events.length,
    max: spent ? view.back_limit : undefined,
  };
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

/** Việc đang mở KHÔNG phải của tôi (khối timeline hiện `TaskWaitingNote` "Đang chờ … " một dòng cho người khác). */
export function waitingOpenTasks(view: ProcessRunFullView): OpenTask[] {
  const mine = new Set(view.my_tasks.map((t) => t.id));
  return view.open_tasks.filter(
    (o) => !mine.has(o.id) && !(o.kind === "decision" && view.decision?.can_decide),
  );
}
