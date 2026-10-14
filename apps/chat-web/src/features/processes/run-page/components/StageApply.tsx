// HUB-FR-129 · P-c2 §1.3 · khối "Kết quả áp bản sửa" ở trang run (chat-web) cho stage có `apply`; diff/đích lấy từ stage tự sửa liền trước.
import type { ProcessRunFullView, StageView } from "@ai/contracts/chat";
import { fetchAttachmentContent } from "~/features/attachments/api";
import { LazyApplyResult } from "../../shared/apply/lazy";

export function StageApply({ view, stage }: { view: ProcessRunFullView; stage: StageView }) {
  if (!stage.apply) return null;
  // FC11 · tự sửa mã đứng liền trước stage Áp; run cũ/fixture đặt cả hai trên cùng stage ⇒ ưu tiên chính nó.
  const af = stage.autofix ?? view.stages.find((s) => s.idx === stage.idx - 1)?.autofix;
  return (
    <LazyApplyResult
      view={stage.apply}
      base={af?.apply_base ?? null}
      diffFile={af?.diff_file ?? null}
      load={fetchAttachmentContent}
    />
  );
}
