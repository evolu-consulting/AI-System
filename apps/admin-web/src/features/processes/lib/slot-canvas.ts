// CR-105 · B2: Canvas của quy trình thư viện (khe `contracts.approval`) — chuẩn hoá danh sách stage trước khi lưu để Hub `fromStages`
// dựng lại `slot_body`: dạng bắt buộc `s0 → route → s1..sn → finalize` (mỗi bước người dùng một stage gọi `contracts-route` kèm cổng
// review, `step` đúng `engineStepOf`, `slot` mang bước). Thêm/xoá/đổi chỗ bước trên canvas ⇒ đánh lại khoá/bước; stage mới (chưa có
// `slot`) thành bước duyệt mặc định; nhánh/quay lại do Hub biên dịch lại nên xoá ở đây (tránh luật nhánh sai sau khi đổi số bước).
import { isDlcStep, normalizeDlcStages } from "./dlc-slot";
import type { StageDraft } from "./draft-types";

/** `step` của stage engine cho bước người dùng thứ `i` (bước 0 chạy trước, route ở bước 1, các bước sau +1). */
export const engineStepOf = (i: number): number => (i === 0 ? 0 : i + 1);

/** Bước duyệt mới (phòng ban theo mã còn trống ⇒ Hub báo khi lưu/xuất bản). */
export const defaultReviewSlot = (name: string): Record<string, unknown> => ({
  kind: "review",
  name,
  department_group_key: null,
  department_group_id: null,
  escalate_group_key: null,
  escalate_group_id: null,
  head_only: false,
  due_h: 72,
  remind_every_h: null,
  exclude_starter: false,
  when: null,
});

/** CR-121 D-6b · bước Thông báo / Chờ tới mới (giá trị mặc định như Form: `newNotify` / `newWait`). */
export const defaultSlotOf = (
  kind: "notify" | "wait_until",
  name: string,
): Record<string, unknown> =>
  kind === "notify"
    ? {
        kind,
        name,
        to: { creator: true, owner: false, group_key: null },
        channels: ["bell"],
        title: "",
        body: "",
      }
    : { kind, name, from: "end_date", offset_days: 0, time: "09:00" };

export function normalizeSlotStages(stages: readonly StageDraft[]): StageDraft[] {
  // dlc-engine · khe DLC (hoặc sơ đồ có bước DLC lẫn vào ⇒ `KIND_MIX` chặn lưu): không có nút hệ thống route/finalize.
  if (stages.some(isDlcStep)) return normalizeDlcStages(stages);
  // CR-127 Z3b: khe duyệt kiểu cũ (`s0 → route → s1..sn → finalize`) đã gỡ ⇒ không còn dựng lại khung route/finalize.
  return [...stages];
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const KEY_PAIRS: readonly [string, string][] = [
  ["department_group_id", "department_group_key"],
  ["escalate_group_id", "escalate_group_key"],
];

/**
 * Def thư viện chỉ dùng MÃ phòng ban. Bản seed (hub 0069) để mã ở chỗ `*_group_id` của `stage.slot` ⇒ chuyển sang `*_group_key` khi nạp
 * (id kiểu uuid không hợp lệ ở def thư viện ⇒ bỏ) để Form/Canvas thấy đúng và Hub không báo GROUP_ID_IN_LIBRARY.
 */
export function repairSlot(slot: Record<string, unknown>): Record<string, unknown> {
  const out = { ...slot };
  for (const [idK, keyK] of KEY_PAIRS) {
    const id = out[idK];
    if (typeof id !== "string" || id === "") continue;
    if (!out[keyK] && !UUID.test(id)) out[keyK] = id;
    out[idK] = null;
  }
  return out;
}
