// HUB-FR-128 · P-c1 §1.2 · khối kết quả tự sửa ở trang run (chat-web). Gate "Kiểm <stage>" đã nhúng khối cho người kiểm ⇒ không lặp lại.
import type { ProcessRunFullView, StageView } from "@ai/contracts/chat";
import { fetchAttachmentContent } from "~/features/attachments/api";
import { AutofixResult } from "../../shared/autofix/AutofixResult";

const inGate = (view: ProcessRunFullView, idx: number): boolean =>
  view.my_tasks.some(
    (t) => t.kind === "review" && t.status === "open" && t.can_act && t.stage_idx === idx,
  );

export function StageAutofix({ view, stage }: { view: ProcessRunFullView; stage: StageView }) {
  if (!stage.autofix || inGate(view, stage.idx)) return null;
  return <AutofixResult view={stage.autofix} load={fetchAttachmentContent} />;
}
