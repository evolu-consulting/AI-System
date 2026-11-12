// CR-127 · cờ + chuẩn bị bản nháp theo loại quy trình (tách từ ProcessEditorPage).

import type { LibraryDef } from "../library-api";
import { isCompanyFlow } from "./company-copy";
import type { DefDraft } from "./def-form";
import { hasTrigger } from "./flow-def";
import { ensureEnds } from "./outline-edit";
import type { EndOutcomes } from "./outline-ends";
import { normalizeSlotStages } from "./slot-canvas";

/** CR-105 · def có khe + người xem là platform_admin ⇒ editor thư viện (Canvas|Form, xuất bản, gán…). */
export const libraryOf = (def: unknown, isPlatform: boolean): LibraryDef | null =>
  isPlatform &&
  ((def as LibraryDef | undefined)?.slot || hasTrigger(def)) &&
  !isCompanyFlow(def as LibraryDef | undefined) // CR-123 FR-10: bản của công ty không phải mẫu Thư viện ⇒ không có "Xuất bản"
    ? (def as LibraryDef)
    : null;
export const isReadOnlyDef = (def: { is_template?: boolean } | undefined, isPlatform: boolean) =>
  !!def?.is_template && !isPlatform;
/** Canvas thư viện: chuẩn hoá dạng `s0 → route → s1..sn → finalize` trước khi kiểm + lưu (Hub `fromStages`). */
export const prepareLibraryDraft = (d: DefDraft): DefDraft => ({
  ...d,
  stages: normalizeSlotStages(d.stages),
});
/** CR-127 · U2 · quy trình theo sự kiện: luôn có Hoàn tất + đích Từ chối / Trả lại trước khi lưu (spec §8.1). */
export const prepareEnds =
  (ends?: EndOutcomes) =>
  (d: DefDraft): DefDraft => ({
    ...d,
    stages: ensureEnds(d.stages, ends) ?? d.stages,
  });
export const prepareFor = (lib: LibraryDef | null) =>
  lib && !hasTrigger(lib) ? prepareLibraryDraft : undefined;
export const slotExtra = (lib: LibraryDef | null) => (lib ? { slot: lib.slot } : undefined);
/** Danh mục tool để kiểm ở máy khách: mẫu Thư viện ⇒ vắng (không kiểm). */
export const catalogOf = <T>(lib: unknown, tools: T): T | undefined => (lib ? undefined : tools);
