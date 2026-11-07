// CR-125 · x1 · "Chờ bạn": số HĐ chờ CHÍNH người xem — ký + duyệt — từ MỘT đọc (`GET /my-work`: `signing[]` + `approvals[]`, cùng
// nguồn với trang "Chờ tôi duyệt" và danh sách dưới thẻ). Thuần.
import type { MyWorkOut, MyWorkSign } from "@ai/contracts/pack-contracts";

export type Waiting = { sign: number; approve: number; total: number };

export function waitingOf(d: Pick<MyWorkOut, "approvals" | "signing"> | undefined): Waiting {
  const sign = d?.signing?.length ?? 0;
  const approve = d?.approvals?.length ?? 0;
  return { sign, approve, total: sign + approve };
}

/** Tên HĐ của dòng ký: "số · tên"; thiếu cả hai ⇒ chuỗi rỗng (UI dùng chữ mặc định). */
export const signTitle = (s: Pick<MyWorkSign, "contract_number" | "contract_title">): string =>
  [s.contract_number, s.contract_title].filter((x) => x && x.trim() !== "").join(" · ");

/** Chữ trên số đỏ của thanh dưới: 0 ⇒ không hiện; trên 99 ⇒ "99+". */
export const waitingBadge = (n: number): string | null =>
  !Number.isFinite(n) || n <= 0 ? null : n > 99 ? "99+" : String(Math.floor(n));
