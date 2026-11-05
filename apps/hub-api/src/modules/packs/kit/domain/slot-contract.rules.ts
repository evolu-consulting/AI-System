// CR-120 §2 · ADR-0036 · FLOW-FR-01 · kiểm lúc khởi động (thuần): mỗi khe khai báo trong manifest app phải có `SlotSpec` (đăng ký lúc
// mount gói) và — khi flow runtime bật — `FlowSlotAdapter`. Thiếu ⇒ danh sách lỗ hổng (log error + ops-watch; KHÔNG chặn boot).
/** Phần manifest cần (cùng hình `AppManifest` của `@ai/contracts`; domain chỉ dùng builtin). */
type ManifestSlots = { key: string; slots: readonly { key: string }[] };

export type SlotContractGap = { app: string; slot: string; missing: "spec" | "adapter" };

export function slotContractGaps(
  manifests: readonly ManifestSlots[],
  specKeys: ReadonlySet<string>,
  /** null ⇒ runtime tắt, không kiểm adapter. */
  adapterKeys: ReadonlySet<string> | null,
): SlotContractGap[] {
  const out: SlotContractGap[] = [];
  for (const m of manifests) {
    for (const s of m.slots) {
      if (!specKeys.has(s.key)) out.push({ app: m.key, slot: s.key, missing: "spec" });
      if (adapterKeys && !adapterKeys.has(s.key))
        out.push({ app: m.key, slot: s.key, missing: "adapter" });
    }
  }
  return out;
}
