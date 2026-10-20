// nav-v2 · Tổng quan: luật thuần (không React, không đọc đồng hồ). Chỉ dùng dữ liệu/API sẵn có: việc cần xử lý (my-work), facets trạng thái
// hợp đồng, danh sách HĐ sắp hết hiệu lực, đối tác ở mức CHÚ Ý (`band = watch`). Quyền xem (RLS) do các API tự lọc.
import type { ContractFacets, ContractListRow, ContractStatus, PartnerRow } from "@ai/contracts";

/** "Cần xử lý" hiện tối đa bấy nhiêu việc, phần còn lại sau "Xem thêm". */
export const WORK_PREVIEW = 6;
/** "Sắp hết hiệu lực" hiện tối đa bấy nhiêu HĐ. */
export const EXPIRING_MAX = 3;
/** Truy vấn danh sách HĐ sắp hết hiệu lực nhất (`GET /contracts`). */
export const EXPIRING_QS = `status=expiring&sort=end_date&dir=asc&page=1&page_size=${EXPIRING_MAX}`;

export const CONTRACT_GROUPS = ["pending", "active", "done"] as const;
export type ContractGroup = (typeof CONTRACT_GROUPS)[number];

const GROUP_OF: Record<ContractStatus, ContractGroup> = {
  needs_review: "pending",
  extracting: "pending",
  extract_failed: "pending",
  active: "active",
  expiring: "active",
  expired: "done",
  renewed: "done",
  terminated: "done",
  rejected: "done",
};

/** Số hợp đồng theo nhóm trạng thái (từ facets cả tenant mà người dùng thấy) và tổng. */
export function groupCounts(f: ContractFacets | undefined): {
  total: number;
  counts: Record<ContractGroup, number>;
} {
  const counts: Record<ContractGroup, number> = { pending: 0, active: 0, done: 0 };
  for (const s of f?.status ?? []) counts[GROUP_OF[s.v]] += s.n;
  return { total: counts.pending + counts.active + counts.done, counts };
}

/** Số ngày từ `today` tới `end` (cả hai `YYYY-MM-DD`, lịch thuần): ≥ 0 còn n ngày, < 0 đã quá; thiếu ngày ⇒ null. */
export function daysLeft(end: string | null | undefined, today: string | null | undefined) {
  if (!end || !today) return null;
  const at = (s: string) => {
    const [y, m, d] = s.split("-").map(Number) as [number, number, number];
    return Date.UTC(y, m - 1, d);
  };
  return Math.round((at(end) - at(today)) / 86_400_000);
}

/** Tên đối tác của HĐ (bên kia mình): HĐ bán ⇒ bên mua, còn lại ⇒ bên bán (rồi bên kia nếu trống). */
export const counterparty = (r: Pick<ContractListRow, "direction" | "seller" | "buyer">): string =>
  (r.direction === "sale" ? (r.buyer ?? r.seller) : (r.seller ?? r.buyer)) ?? "";

/** Đối tác cần xem lại = mức CHÚ Ý, điểm thấp lên trước (cùng điểm: theo tên). */
export function partnersToReview(rows: readonly PartnerRow[] | undefined): PartnerRow[] {
  return (rows ?? [])
    .filter((p) => p.band === "watch")
    .sort((a, b) => (a.score ?? 0) - (b.score ?? 0) || a.name.localeCompare(b.name, "vi"));
}
