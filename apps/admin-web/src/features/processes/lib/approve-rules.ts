// CR-125 · x3 · MỘT nơi cho mặc định và luật của node Duyệt (Từ chối / Trả lại): trước đây ô "Nếu từ chối" mặc định là "Bước tiếp theo" ⇒ HĐ bị từ chối
// vẫn đi tiếp mà không ai báo. Mặc định mới: Từ chối ⇒ node "Kết thúc · Từ chối"; Trả lại ⇒ quay về bước duyệt đứng trước (`backTo`).
// Cảnh báo (không chặn) khi Từ chối / Trả lại trỏ tới bước sau mà KHÔNG phải node Kết thúc. Hàm thuần.
import type { StageDraft } from "./draft-types";

const isApprove = (s: StageDraft): boolean => s.executor === "approve";
const isEnd = (s: StageDraft): boolean => s.outcome !== undefined;

/** Bước (0-based) của node Kết thúc có kết quả "rejected" (đầu tiên theo bước); không có ⇒ null. */
export const rejectEndStep = (stages: readonly StageDraft[]): number | null =>
  stages
    .filter((s) => s.outcome === "rejected")
    .reduce<number | null>((m, s) => (m === null || s.step < m ? s.step : m), null);

/**
 * Mặc định của node Duyệt `uid`: `reject` còn trống ⇒ Kết thúc · Từ chối (nếu đứng SAU bước này); `back` ⇒ Trả lại về bước duyệt đứng ngay trước
 * (chỉ khi chưa chọn). Không phải node Duyệt / không có gì để đặt ⇒ trả nguyên mảng.
 */
export function approveDefaults(
  stages: readonly StageDraft[],
  uid: string,
  o: { back: boolean },
): StageDraft[] {
  const s = stages.find((x) => x.uid === uid);
  if (!s || !isApprove(s)) return [...stages];
  const cur = s.approve ?? { reject: null, ret: null };
  const end = rejectEndStep(stages);
  const reject = cur.reject ?? (end !== null && end > s.step ? end : null);
  const prev = stages
    .filter((x) => isApprove(x) && x.step < s.step)
    .reduce<number | null>((m, x) => (m === null || x.step > m ? x.step : m), null);
  const backTo = o.back && s.backTo.length === 0 && prev !== null ? [prev] : s.backTo;
  if (reject === cur.reject && backTo === s.backTo) return [...stages];
  return stages.map((x) => (x.uid === uid ? { ...x, approve: { ...cur, reject }, backTo } : x));
}

export type ApproveWarning = { uid: string; name: string; field: "reject" | "ret" };

/** Từ chối / Trả lại trỏ tới bước SAU không có node Kết thúc ⇒ HĐ vẫn đi tiếp ("chắc chưa?"). */
export function approveWarnings(stages: readonly StageDraft[]): ApproveWarning[] {
  return stages.filter(isApprove).flatMap((s) =>
    (["reject", "ret"] as const).flatMap((field) => {
      const to = s.approve?.[field];
      const continues = typeof to === "number" && !stages.some((o) => o.step === to && isEnd(o));
      return continues ? [{ uid: s.uid, name: s.name || s.key, field }] : [];
    }),
  );
}
