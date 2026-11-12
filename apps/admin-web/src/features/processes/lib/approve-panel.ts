// CR-127 · U2 · view-model THUẦN của panel bước Duyệt (spec §8.1): Ai duyệt (phòng HOẶC người) · Cần · Hạn · Quá hạn chuyển cho · Bằng chứng.
import type { StageDraft } from "./draft-types";

type Review = NonNullable<StageDraft["review"]>;
type Esc = StageDraft["escalate"];

/** Cần: ghi rõ ở `review.need`; chưa ghi ⇒ suy từ `head_only` cũ, không có ⇒ một người nhận việc. */
export const needOf = (s: Pick<StageDraft, "review">): "one" | "head" | "all" =>
  s.review?.need ?? (s.review?.headOnly ? "head" : "one");

/** Giá trị ô «Ai duyệt»: `u:<id>` khi chọn người, ngược lại giá trị phòng. */
export const whoValueOf = (s: Pick<StageDraft, "review">, groupValue: string): string =>
  s.review?.approverUserId ? `u:${s.review.approverUserId}` : groupValue;

/** Chọn người (`u:<id>`) ⇒ bỏ phòng; chọn phòng ⇒ bỏ người. `groupPatch` = patch phòng của `useApproverField`. */
export function whoPatch(
  s: Pick<StageDraft, "review">,
  v: string,
  groupPatch: (id: string) => Partial<StageDraft>,
): Partial<StageDraft> {
  const { approverUserId: _drop, ...rest } = s.review ?? {};
  if (v.startsWith("u:"))
    return { groupId: "", after: "review", review: { ...rest, approverUserId: v.slice(2) } };
  return { ...groupPatch(v), after: "review", review: rest as Review };
}

/** Giá trị ô «Quá hạn chuyển cho»: `u:<id>` | `g:<id>` | "" (chưa chọn). */
export const dueToValueOf = (e: Esc): string =>
  e.userId ? `u:${e.userId}` : e.groupId ? `g:${e.groupId}` : "";

/** Nhập Hạn: trống ⇒ tắt chuyển cấp; có số ⇒ bật (giữ nơi chuyển đã chọn). */
export const withDue = (e: Esc, hours: string): Esc =>
  hours.trim() === "" ? { ...e, on: false } : { ...e, on: true, afterH: hours };

/** Chọn nơi chuyển: người ⇒ `userId`, phòng ⇒ `groupId` (đúng một). */
export const withDueTo = (e: Esc, v: string): Esc =>
  v.startsWith("u:")
    ? { on: true, afterH: e.afterH, groupId: "", userId: v.slice(2) }
    : { on: true, afterH: e.afterH, groupId: v.slice(2) };
