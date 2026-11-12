// CR-127 · U2e · node «Xác nhận mốc» (contracts.milestone-confirm): engine đọc cấu hình từ khối `after` kiểu review của bước
// (phòng / người / Cần / Hạn / Nhắc). View-model THUẦN: nhận biết node + patch giữ nguyên hình contract (không thêm trường).
import { dueToValueOf, needOf, whoPatch, whoValueOf } from "./approve-panel";
import type { StageDraft } from "./draft-types";

export const MILESTONE_NODE_KEY = "contracts.milestone-confirm";

export const isMilestone = (s: Pick<StageDraft, "node">): boolean => s.node === MILESTONE_NODE_KEY;

/** Chọn «Ai xác nhận»: "" ⇒ để trống (engine giao cho người phụ trách hợp đồng); `u:<id>` ⇒ người; còn lại ⇒ phòng. */
export function milestoneWhoPatch(
  s: Pick<StageDraft, "review">,
  v: string,
  groupPatch: (id: string) => Partial<StageDraft>,
): Partial<StageDraft> {
  if (v === "") {
    const { approverUserId: _drop, ...rest } = s.review ?? {};
    return { ...groupPatch(""), groupId: "", after: "review", review: rest };
  }
  return whoPatch(s, v, groupPatch);
}

/** Chữ tóm tắt trên khối sơ đồ: "<ai> · <hạn>" (vắng ai ⇒ nhãn mặc định). */
export function milestoneSummary(
  s: Pick<StageDraft, "escalate">,
  who: string | undefined,
  l: { owner: string; due: (n: number) => string },
): string {
  const h = s.escalate.on ? Number(s.escalate.afterH) : 0;
  return [who ?? l.owner, ...(h > 0 ? [l.due(h)] : [])].join(" · ");
}

export { dueToValueOf, needOf, whoValueOf };
