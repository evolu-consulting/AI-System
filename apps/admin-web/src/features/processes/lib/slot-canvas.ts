// CR-105 · B2: Canvas của quy trình thư viện (khe `contracts.approval`) — chuẩn hoá danh sách stage trước khi lưu để Hub `fromStages`
// dựng lại `slot_body`: dạng bắt buộc `s0 → route → s1..sn → finalize` (mỗi bước người dùng một stage gọi `contracts-route` kèm cổng
// review, `step` đúng `engineStepOf`, `slot` mang bước). Thêm/xoá/đổi chỗ bước trên canvas ⇒ đánh lại khoá/bước; stage mới (chưa có
// `slot`) thành bước duyệt mặc định; nhánh/quay lại do Hub biên dịch lại nên xoá ở đây (tránh luật nhánh sai sau khi đổi số bước).
import type { StageDraft } from "./draft-types";
import { isSlotStep, isSystemStage } from "./system-nodes";

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

const isTool = (s: StageDraft, key: string): boolean => isSystemStage(s) && s.tool.key === key;
const isRouteTool = (s: StageDraft): boolean =>
  s.executor === "tool" && s.tool.key === "contracts-route";

function uniqueKey(want: unknown, taken: Set<string>, i: number): string {
  let k = typeof want === "string" && want !== "" ? want : `s${i}`;
  while (taken.has(k)) k = `${k}x`;
  taken.add(k);
  return k;
}

export function normalizeSlotStages(stages: readonly StageDraft[]): StageDraft[] {
  const route = stages.find((s) => isTool(s, "contracts-route"));
  const finalize = stages.find((s) => isTool(s, "contracts-finalize"));
  const user = stages.filter((s) => !isSystemStage(s));
  const tmpl = user.find(isSlotStep);
  if (!route || !finalize || !tmpl) return [...stages];
  const taken = new Set<string>();
  const steps = user.map((s, i): StageDraft => {
    // Stage mới (kể cả đã gõ `slotRaw` ở form bước nhưng executor còn trống) ⇒ lấy khung stage từ bước mẫu; Dify giữ nguyên.
    const keep = isSlotStep(s) && (s.slotRaw?.kind === "dify" || isRouteTool(s));
    const base = keep ? s : { ...tmpl, uid: s.uid, uiY: s.uiY };
    const slot = {
      ...(isSlotStep(s) ? s.slotRaw : defaultReviewSlot(s.name)),
      name: s.name,
    } as Record<string, unknown>;
    slot.key = uniqueKey(slot.key, taken, i);
    if (i === 0 && slot.kind === "review") slot.when = null; // bước đầu luôn chạy
    return {
      ...base,
      name: s.name,
      key: `s${i}`,
      step: engineStepOf(i),
      backTo: i === 0 ? [] : [0],
      branch: [],
      slotRaw: slot,
    };
  });
  const [first, ...rest] = steps;
  if (!first) return [...stages];
  const sys = (s: StageDraft, step: number): StageDraft => ({ ...s, step, backTo: [], branch: [] });
  return [{ ...first, step: 0 }, sys(route, 1), ...rest, sys(finalize, engineStepOf(steps.length))];
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
