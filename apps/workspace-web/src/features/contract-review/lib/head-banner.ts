// CR-127 · U5 · BR-35…40 · M10: dữ liệu cho MỘT băng lý do ở đầu trang — ai trả lại / từ chối, nói gì, lúc nào; đang chờ bước nào. Thuần.
import type { ContractDetail } from "@ai/contracts/pack-contracts";

export type LastDecision = {
  action: "return" | "reject" | "withdraw";
  by: string | null;
  at: string;
  note: string | null;
};

const text = (v: unknown): string | null =>
  typeof v === "string" && v.trim() !== "" ? v.trim() : null;

/** Quyết định gần nhất làm HĐ về DRAFT / REJECT (sự kiện mới nhất trước). `events` do hub trả mới → cũ hoặc cũ → mới: tự tìm theo `at`. */
// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: CR-127 U5 — luật hiển thị gom một chỗ, tách sau khi UI đóng băng
export function lastDecision(events: ContractDetail["events"]): LastDecision | null {
  const sorted = [...events].sort((a, b) => b.at.localeCompare(a.at) || b.id - a.id);
  for (const e of sorted) {
    const d = e.data as { action?: unknown; feedback?: unknown; note?: unknown; reason?: unknown };
    const action =
      e.type === "returned" || (e.type === "stage_decided" && d.action === "return")
        ? "return"
        : e.type === "rejected" || (e.type === "stage_decided" && d.action === "reject")
          ? "reject"
          : e.type === "withdrawn"
            ? "withdraw"
            : null;
    if (action)
      return {
        action,
        by: e.actor_user_id,
        at: e.at,
        note: text(d.feedback) ?? text(d.note) ?? text(d.reason),
      };
  }
  return null;
}

/** "Còn N giờ" tới hạn bước đang chờ; null khi không có hạn / đã quá hạn ⇒ `{ over: true }`. */
export function hoursLeft(
  dueAt: string | null | undefined,
  now = Date.now(),
): { hours: number; over: boolean } | null {
  if (!dueAt) return null;
  const ms = Date.parse(dueAt) - now;
  if (Number.isNaN(ms)) return null;
  return { hours: Math.max(0, Math.ceil(ms / 3_600_000)), over: ms < 0 };
}
