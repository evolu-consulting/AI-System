// HUB-FR-147 · PD2-R14 · P-d2: tham số câu Nhật ký "Rẽ nhánh: tới bước {step} (luật {rule})" — `to_step` 0-based ⇒ hiển thị +1.
import type { HistoryItem } from "@ai/contracts/chat";

export function branchParams(h: Pick<HistoryItem, "kind" | "to_step" | "rule">): {
  step?: number;
  rule?: number;
} {
  if (h.kind !== "branch") return {};
  return { step: (h.to_step ?? 0) + 1, rule: h.rule ?? 1 };
}
