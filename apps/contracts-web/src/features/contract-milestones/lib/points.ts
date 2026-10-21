// GAP-D2 · #15 · mockup `msDelta`: điểm uy tín (+/−) của MỘT mốc đã xác nhận, hiện bên phải mốc ở dòng thời gian. Mốc của đối tác:
// đúng/sớm hạn ⇒ cộng theo loại mốc; trễ do đối tác ⇒ trừ (trừ thêm mỗi ngày trễ quá 3 ngày ân hạn, sàn −15); trễ do mình ⇒ 0 (không
// trừ đối tác); trễ chưa rõ lỗi ⇒ chưa tính. Mốc của mình ⇒ ghi vào "Uy tín của mình". Chỉ là hiển thị — điểm thật do máy chủ tính.
import type { Milestone } from "@ai/contracts";
import { daysBetween, type MilestoneKind } from "./timeline";

/** [đúng hạn, trễ] theo loại mốc (mockup `CRITV`: giao/serial/thu tiền/hỗ trợ). Loại không góp điểm ⇒ vắng. */
const BASE: Partial<Record<MilestoneKind, readonly [number, number]>> = {
  delivery: [2, -6],
  serial: [1, -4],
  collect: [2, -5],
  commission: [2, -5],
  pay: [2, -5],
  other: [1, -4],
};
export const GRACE_DAYS = 3;
export const FLOOR = -15;

export type MilestonePoints =
  | { kind: "pts"; value: number }
  | { kind: "mine" }
  | { kind: "pending" };

export function milestonePoints(
  m: Pick<Milestone, "kind" | "owner" | "confirmed" | "due_date" | "done_at" | "fault">,
): MilestonePoints | null {
  if (!m.confirmed || !m.done_at) return null;
  if (m.owner === "ours") return { kind: "mine" };
  const base = BASE[m.kind];
  if (!base) return null;
  const late = daysBetween(m.due_date, m.done_at);
  if (late <= 0) return { kind: "pts", value: base[0] };
  if (m.fault === "ours") return { kind: "pts", value: 0 };
  if (m.fault !== "partner") return { kind: "pending" };
  return { kind: "pts", value: Math.max(FLOOR, base[1] - Math.max(0, late - GRACE_DAYS)) };
}

/** "+2" / "−6" / "0" (dấu trừ chuẩn U+2212 để thẳng hàng, đọc được bằng trình đọc màn hình). */
export const signed = (v: number): string => (v > 0 ? `+${v}` : v < 0 ? `−${-v}` : "0");
