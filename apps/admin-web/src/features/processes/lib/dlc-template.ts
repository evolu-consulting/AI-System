// dlc-step-library · chép BƯỚC DLC MẪU (thư viện `/dlc-step-templates`) thành bước của Canvas khe `dlc.*`: mọi thuộc tính lấy từ
// mẫu, khoá bước mới, "Chưa đạt ⇒" của mẫu phân giải theo các bước đứng trước (mẫu không biết khoá bước của từng quy trình). Thuần.
import type { DlcStepTemplate } from "@ai/contracts/hub-admin";
import type { DlcSlot } from "./dlc-slot";

/**
 * Đích quay lại của mẫu ⇒ `gate.back_to`: `self`/null ⇒ [] (engine chạy lại chính bước), `prev` ⇒ bước ngay trước, <việc> ⇒ bước
 * GẦN NHẤT đứng trước làm việc đó; không có bước phù hợp ⇒ [] (admin nối tay trên canvas / form).
 */
export function resolveRejectTo(rejectTo: string | null, before: readonly DlcSlot[]): string[] {
  if (rejectTo === null || rejectTo === "self") return [];
  const back = [...before].reverse();
  const hit = rejectTo === "prev" ? back[0] : back.find((b) => b.action === rejectTo);
  return hit ? [hit.key] : [];
}

/** Bước DLC chép từ mẫu (`before` = các bước DLC đứng trước chỗ chèn). */
export function dlcSlotFromTemplate(
  tpl: DlcStepTemplate,
  key: string,
  before: readonly DlcSlot[],
): DlcSlot {
  return {
    kind: "dlc",
    key,
    name: tpl.name,
    action: tpl.action,
    agent_key: tpl.agent_key,
    instruction: tpl.instruction,
    gate: tpl.gate_group
      ? { group_key: tpl.gate_group, back_to: resolveRejectTo(tpl.reject_to, before) }
      : null,
    max_rounds: tpl.max_rounds,
    timeout_min: tpl.timeout_min,
  };
}
