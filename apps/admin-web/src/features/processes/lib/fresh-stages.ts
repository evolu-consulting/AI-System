// dlc-engine · dựng giai đoạn MỚI cho Canvas quy trình thư viện (bước DLC / bước duyệt mang `slot` ngay khi thêm). Tách riêng để
// `dlc-slot` / `slot-canvas` không phụ thuộc `stage-convert` (tránh vòng import).
import type { DlcStepTemplate } from "@ai/contracts/hub-admin";
import { dlcOf, freeDlcKey, isDlcStep, newDlcSlot } from "./dlc-slot";
import { dlcSlotFromTemplate } from "./dlc-template";
import type { StageDraft } from "./draft-types";
import { defaultReviewSlot, defaultSlotOf } from "./slot-canvas";
import { emptyStage, nextUid } from "./stage-convert";

/** dlc-engine · bước duyệt mới của khe: stage trống mang `slot` bước duyệt mặc định ngay (không nối với bước DLC; khe hợp đồng
 *  dựng lại khung route khi lưu). */
export const freshReviewStage = (): StageDraft => ({
  ...emptyStage(),
  slotRaw: defaultReviewSlot(""),
});

/** CR-121 D-6b · bước Thông báo / Chờ tới mới của khe: stage trống mang `slot` mặc định (khung route dựng lại khi lưu). */
export const freshSlotStage = (kind: "notify" | "wait_until", name: string): StageDraft => ({
  ...emptyStage(),
  name,
  slotRaw: defaultSlotOf(kind, name),
});

/**
 * Giai đoạn mới cho bước DLC (thêm cuối): khung stage lấy từ bước DLC có sẵn (executor `dlc-step` hợp lệ để Hub nhận), `slot` = bước
 * trống hoặc chép từ bước mẫu `tpl` của thư viện (dlc-step-library; tên = tên mẫu, quay lại phân giải theo các bước đứng trước).
 */
export function freshDlcStage(
  stages: readonly StageDraft[],
  name: string,
  tpl?: DlcStepTemplate,
): StageDraft {
  const tmpl = stages.find(isDlcStep);
  const key = freeDlcKey(stages);
  const slot = tpl ? dlcSlotFromTemplate(tpl, key, stages.filter(isDlcStep).map(dlcOf)) : null;
  const base: StageDraft = tmpl
    ? { ...tmpl }
    : { ...emptyStage(), executor: "tool", tool: { ...emptyStage().tool, key: "dlc-step" } };
  const { uiY: _y, uiX: _x, ...rest } = base;
  return {
    ...rest,
    uid: nextUid(),
    key,
    keyAuto: false,
    name: slot?.name ?? name,
    after: slot?.gate ? "review" : "auto",
    backTo: [],
    branch: [],
    slotRaw: (slot ?? newDlcSlot(key, name)) as unknown as Record<string, unknown>,
  };
}
