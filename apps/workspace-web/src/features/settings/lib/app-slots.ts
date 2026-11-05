// CR-120 §2 · FLOW-FR-03 · Cài đặt › Ứng dụng & quy trình: MỌI khe app khai báo trong manifest (kể cả khe công ty chưa có — cảnh báo),
// rồi tới khe năng lực có mà manifest không khai báo. `present` = năng lực (hub) có khe này cho công ty.
import { type AppSlotDecl, getAppManifest } from "@ai/contracts/app-manifest";

export type PaneSlot = { key: string; decl: AppSlotDecl | null; present: boolean };

export function paneSlots(appKey: string, capSlots: readonly { slot: string }[]): PaneSlot[] {
  const decls = getAppManifest(appKey)?.slots ?? [];
  const have = new Set(capSlots.map((s) => s.slot));
  const declared = new Set(decls.map((d) => d.key));
  return [
    ...decls.map((d) => ({ key: d.key, decl: d, present: have.has(d.key) })),
    ...capSlots
      .filter((s) => !declared.has(s.slot))
      .map((s) => ({ key: s.slot, decl: null, present: true })),
  ];
}
