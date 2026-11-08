// CR-125 · «Quy trình con» — pha chốt trong `finishWait` (vòng hẹn giờ, tx `system(tenant)`, run cha → stage → hẹn đã khoá): đọc kết quả lượt
// con (MỘT câu) ⇒ output bước cha (.md + `outcome` + `sub_<trường>`); lượt con không còn (bị xoá) ⇒ đầu ra `cancelled` + `reason`; lượt
// con lỗi ⇒ trả stage về hàng đợi để launcher mở «Cần xử lý» (`tool_failed`, cần deps đầy đủ); còn chạy ⇒ ghi hẹn canh kế rồi bỏ qua.
// Chốt hai lần không xảy ra: `fireTimer` chỉ chốt khi stage còn `waiting_timer` (đã khoá), chốt xong stage `done` ⇒ hẹn sau bị bỏ.
import type { Tx } from "@ai/db";
import { childSettle, subFields } from "../../domain/runs/subprocess.rules";
import { waitOutputMd } from "../../domain/timers/due-at.rules";
import { armWatch, childResult } from "../runs/subprocess.repo";

export type SubprocessOut =
  | { kind: "out"; md: string; fields: Record<string, string | number> }
  | { kind: "requeue" }
  | { kind: "skip" };

const TEXT = {
  done: "Quy trình con đã hoàn tất.",
  rejected: "Quy trình con kết thúc: bị từ chối.",
  cancelled: "Quy trình con đã bị huỷ.",
  missing: "Không còn lượt chạy của quy trình con; coi như đã huỷ.",
} as const;
/** `reason` của đầu ra `cancelled` khi lượt con không còn. */
export const CHILD_MISSING = "child_missing";

export async function subprocessWaitOut(
  tx: Tx,
  tenantId: string,
  x: {
    runId: string;
    stage: { id: string; attempt: number; round: number };
    name: string;
    now: Date;
  },
): Promise<SubprocessOut> {
  const r = await childResult(tx, tenantId, x.stage);
  if (!r)
    return {
      kind: "out",
      md: waitOutputMd(x.name, TEXT.missing),
      fields: { outcome: "cancelled", reason: CHILD_MISSING },
    };
  const st = childSettle({
    status: r.status,
    endOutcome: r.end_outcome,
    lastDecision: r.last_decision,
  });
  if (!st) {
    await armWatch(tx, tenantId, { runId: x.runId, stage: x.stage, now: x.now, dueNow: false });
    return { kind: "skip" };
  }
  if (st.kind === "failed") return { kind: "requeue" };
  return {
    kind: "out",
    md: waitOutputMd(x.name, TEXT[st.outcome]),
    fields: { ...subFields(r.fields ?? {}), outcome: st.outcome },
  };
}
