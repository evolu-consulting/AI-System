// CR-122 · E2b · node Duyệt độc lập: khi người quyết task của stage `approve`, ghi field `decision` vào output hiện hành CÙNG tx
// (đã khoá run, task vừa đóng compare-and-set ⇒ bấm 2 lần chỉ một lần ghi). Từ chối/Trả lại có đích (`reject_step`/`return_step`)
// ⇒ quyết như Đạt để join bước rẽ tới đích (luật rẽ suy từ executor ở `step.repo`); không đích ⇒ giữ hành vi cổng cũ.
import type { ReviewDecisionRequest } from "@ai/contracts/chat";
import type { Tx } from "@ai/db";
import { sql } from "drizzle-orm";

type ApproveDef = {
  executor: { kind: string; reject_step?: number | null; return_step?: number | null };
};

/** Luật thuần: quyết định nghiệp vụ + kết quả cổng thực chạy. Stage không phải Duyệt ⇒ null. */
export function approveOutcomeOf(
  def: ApproveDef | undefined,
  result: ReviewDecisionRequest["result"],
): {
  decision: "approved" | "rejected" | "returned";
  gate: ReviewDecisionRequest["result"];
} | null {
  const e = def?.executor;
  if (e?.kind !== "approve") return null;
  if (result === "pass") return { decision: "approved", gate: "pass" };
  if (result === "reject")
    return { decision: "rejected", gate: typeof e.reject_step === "number" ? "pass" : "reject" };
  return { decision: "returned", gate: typeof e.return_step === "number" ? "pass" : "fail" };
}

/**
 * Stage Duyệt ⇒ ghi `fields.decision` (+ người quyết) vào output hiện hành (1 câu) và trả yêu cầu cổng thực chạy; stage khác ⇒ `b`.
 * Gọi SAU khi đã kiểm quyền/luật trên `b` gốc (Từ chối vẫn bắt buộc góp ý).
 */
export async function approveDecide(
  tx: Tx,
  p: {
    tenantId: string;
    outputId: string | null;
    def: ApproveDef | undefined;
    v: { userId: string };
  },
  b: ReviewDecisionRequest,
): Promise<ReviewDecisionRequest> {
  const o = approveOutcomeOf(p.def, b.result);
  if (!o) return b;
  if (p.outputId) {
    const fields = { decision: o.decision, decided_by: p.v.userId };
    await tx.execute(sql`update hub.process_outputs
        set fields = coalesce(fields, '{}'::jsonb) || ${JSON.stringify(fields)}::jsonb
        where id = ${p.outputId} and tenant_id = ${p.tenantId}`);
  }
  if (o.gate === b.result) return b;
  // Rẽ theo bước: bỏ `back_to_step` (không quay lại), giữ góp ý để lịch sử ghi lý do.
  return { result: o.gate, ...(b.feedback ? { feedback: b.feedback } : {}) };
}
