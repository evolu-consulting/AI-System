// HUB-FR-144 · P-d1 · PD-R21: ghi chú chờ kiểm có thêm nhóm chuyển cấp hay không. Thuần.
export function reviewWaitVariant(o: { escalatedGroup?: string | null }): "plain" | "escalated" {
  return o.escalatedGroup ? "escalated" : "plain";
}
