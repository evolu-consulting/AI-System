// dlc-engine · dựng giai đoạn MỚI cho Canvas quy trình thư viện (bước DLC / bước duyệt mang `slot` ngay khi thêm). Tách riêng để
// `dlc-slot` / `slot-canvas` không phụ thuộc `stage-convert` (tránh vòng import).
import { freeDlcKey, isDlcStep, newDlcSlot } from "./dlc-slot";
import type { StageDraft } from "./draft-types";
import { defaultReviewSlot } from "./slot-canvas";
import { emptyStage, nextUid } from "./stage-convert";

/** dlc-engine · bước duyệt mới của khe: stage trống mang `slot` bước duyệt mặc định ngay (không nối với bước DLC; khe hợp đồng
 *  dựng lại khung route khi lưu). */
export const freshReviewStage = (): StageDraft => ({
  ...emptyStage(),
  slotRaw: defaultReviewSlot(""),
});

/** Giai đoạn mới cho bước DLC: khung stage lấy từ bước DLC có sẵn (executor `dlc-step` hợp lệ để Hub nhận), `slot` = bước mới. */
export function freshDlcStage(stages: readonly StageDraft[], name: string): StageDraft {
  const tmpl = stages.find(isDlcStep);
  const key = freeDlcKey(stages);
  const base: StageDraft = tmpl
    ? { ...tmpl }
    : { ...emptyStage(), executor: "tool", tool: { ...emptyStage().tool, key: "dlc-step" } };
  const { uiY: _y, ...rest } = base;
  return {
    ...rest,
    uid: nextUid(),
    key,
    keyAuto: false,
    name,
    after: "auto",
    backTo: [],
    branch: [],
    slotRaw: newDlcSlot(key, name) as unknown as Record<string, unknown>,
  };
}
