// CR-120 §2 · FLOW-FR-03 · tab "Quy trình" liệt kê MỌI khe app khai báo trong manifest (kể cả khe hub chưa có hàng `process_slots`
// ⇒ cảnh báo thiếu), rồi tới khe hub có mà manifest không khai báo. Thứ tự: theo manifest.
import type { AppSlotDecl } from "@ai/contracts";

export type SlotRow<V> = { key: string; decl: AppSlotDecl | null; view: V | null };

export function slotRows<V extends { slot: { slot: string } }>(
  decls: readonly AppSlotDecl[],
  views: readonly V[],
): SlotRow<V>[] {
  const byKey = new Map(views.map((v) => [v.slot.slot, v]));
  const declared = new Set(decls.map((d) => d.key));
  return [
    ...decls.map((d) => ({ key: d.key, decl: d, view: byKey.get(d.key) ?? null })),
    ...views
      .filter((v) => !declared.has(v.slot.slot))
      .map((v) => ({ key: v.slot.slot, decl: null, view: v })),
  ];
}
