// CR-125 · «Quy trình con» — pha chốt trong `finishWait` (vòng hẹn giờ, tx `system(tenant)`, run cha → stage → hẹn đã khoá): đọc kết quả lượt
// con (MỘT câu) ⇒ output bước cha (.md + `outcome` + `sub_<trường>`), hoặc lượt con lỗi ⇒ trả stage về hàng đợi để launcher mở «Cần xử lý»
// (`tool_failed`, cần deps đầy đủ), hoặc chưa kết thúc (hẹn lạc) ⇒ bỏ qua.
import type { Tx } from "@ai/db";
import { childSettle, subFields } from "../../domain/runs/subprocess.rules";
import { waitOutputMd } from "../../domain/timers/due-at.rules";
import { childResult } from "./subprocess.repo";

export type SubprocessOut =
  | { kind: "out"; md: string; fields: Record<string, string | number> }
  | { kind: "requeue" }
  | { kind: "skip" };

const TEXT = {
  done: "Quy trình con đã hoàn tất.",
  rejected: "Quy trình con kết thúc: bị từ chối.",
  cancelled: "Quy trình con đã bị huỷ.",
} as const;

export async function subprocessWaitOut(
  tx: Tx,
  tenantId: string,
  x: { stage: { id: string; attempt: number; round: number }; name: string },
): Promise<SubprocessOut> {
  const r = await childResult(tx, tenantId, x.stage);
  if (!r) return { kind: "skip" };
  const st = childSettle({
    status: r.status,
    endOutcome: r.end_outcome,
    lastDecision: r.last_decision,
  });
  if (!st) return { kind: "skip" };
  if (st.kind === "failed") return { kind: "requeue" };
  return {
    kind: "out",
    md: waitOutputMd(x.name, TEXT[st.outcome]),
    fields: { ...subFields(r.fields ?? {}), outcome: st.outcome },
  };
}
