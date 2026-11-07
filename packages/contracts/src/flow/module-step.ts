// CR-123 · u6 · FLOW3-FR-14 · MỘT nguồn dựng dòng "node module" (Ký số = gửi + chờ gộp một) cho FlowView: hub (thẻ chính) và web (dự phòng
// khi runtime tắt) cùng gọi. Dòng mang `outcome` (Đang chờ / Đã ký / Từ chối / Hết hạn) và `signer` (tên người / phòng ký).
import type { FlowStepView } from "./view";

type Base = Omit<Extract<FlowStepView, { kind: "esign" }>, "kind" | "esign" | "assignee">;

export function moduleFlowStep(
  base: Base,
  outcome: NonNullable<FlowStepView["outcome"]>,
  signer?: string | null,
  node?: string | null,
): FlowStepView {
  return {
    ...base,
    outcome,
    ...(signer ? { signer } : {}),
    ...(node ? { module_node: node } : {}),
    kind: "esign",
    assignee: { kind: "system" },
    esign: { provider_status: "sent", reason: null, can_resend: false, reminded_at: null },
  };
}
