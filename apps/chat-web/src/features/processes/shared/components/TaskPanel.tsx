// CR-056 · P-a FD7: `TaskPanel` rẽ theo `TaskDetail.kind` — review → ReviewTaskCard (PF1), ask → AskTaskCard (PF2),
// decision → DecisionCard (PF1). Dùng ở `/runs/$id` và thẻ DM (inline); trong thread `ProcessThreadMessage` gọi thẻ trực tiếp.
import { lazy, Suspense } from "react";
import type { TaskCardProps } from "../types";

const ReviewTaskCard = lazy(() =>
  import("../../run-block/components/ReviewTaskCard").then((m) => ({ default: m.ReviewTaskCard })),
);
const DecisionCard = lazy(() =>
  import("../../run-block/components/DecisionCard").then((m) => ({ default: m.DecisionCard })),
);
const AskTaskCard = lazy(() =>
  import("../../ask/components/AskTaskCard").then((m) => ({ default: m.AskTaskCard })),
);

export function TaskPanel(props: TaskCardProps) {
  const { kind } = props.task;
  return (
    <Suspense fallback={null}>
      {kind === "review" && <ReviewTaskCard {...props} />}
      {kind === "ask" && <AskTaskCard {...props} />}
      {kind === "decision" && <DecisionCard {...props} />}
    </Suspense>
  );
}
