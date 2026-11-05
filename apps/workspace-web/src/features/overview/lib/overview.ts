// nav-v2 · Tổng quan: luật thuần (không React, không đọc đồng hồ). Chỉ dùng dữ liệu/API sẵn có: việc cần xử lý (my-work), facets trạng thái
// hợp đồng, danh sách HĐ sắp hết hiệu lực, đối tác ở mức CHÚ Ý (`band = watch`). Quyền xem (RLS) do các API tự lọc.
import type {
  BizProductRow,
  ContractFacets,
  ContractListRow,
  ContractStatus,
  OverviewGroupRow,
  OverviewPeriod,
  TodoItem,
} from "@ai/contracts";

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

// ---------- V2-N · Tổng quan nối dữ liệu V2-K / V2-E / V2-J1 (thuần) ----------

export const PERIODS: readonly OverviewPeriod[] = ["month", "quarter", "12m"];
/** Số tháng của kỳ (cột đậm của biểu đồ nhóm = N tháng cuối). */
export const PERIOD_MONTHS: Record<OverviewPeriod, number> = { month: 1, quarter: 3, "12m": 12 };

/** Tiền gọn kiểu mockup: ≥ 1 tỷ "1,25 tỷ", ≥ 1 triệu "236,0 tr", còn lại số đồng. */
export function moneyShort(v: number): string {
  if (v >= 1e9) return `${(v / 1e9).toFixed(2).replace(".", ",")} tỷ`;
  if (v >= 1e6) return `${(v / 1e6).toFixed(1).replace(".", ",")} tr`;
  return `${Math.round(v).toLocaleString("vi-VN")}đ`;
}

/** % thực nhận trên dự kiến, làm tròn, kẹp 0..100 cho thanh; dự kiến 0 ⇒ 0. */
export const pctOf = (actual: number, expected: number): number =>
  expected > 0 ? Math.min(100, Math.max(0, Math.round((actual / expected) * 100))) : 0;

/** Mũi tên so kỳ trước: null ⇒ không hiện (kỳ trước = 0). */
export function changeView(pct: number | null | undefined): { up: boolean; n: number } | null {
  if (pct == null) return null;
  return { up: pct >= 0, n: Math.abs(Math.round(pct)) };
}

/** Chiều cao cột (%) của một nhóm: cao nhất = 100, có giá trị tối thiểu 6, trống 2 (mockup). */
export function barHeights(values: readonly number[]): number[] {
  const mx = Math.max(0, ...values) || 1;
  return values.map((v) => Math.max(v > 0 ? 6 : 2, (v / mx) * 100));
}

/** Cột thứ i có thuộc kỳ hiện tại không (N tháng cuối của 12 cột). */
export const inPeriod = (i: number, total: number, period: OverviewPeriod): boolean =>
  i >= total - PERIOD_MONTHS[period];

/** "2026-10" → "T10". */
export const monthLabel = (m: string): string => `T${Number(m.slice(5, 7))}`;

export const GROUP_ORDER: Record<OverviewGroupRow["group"], number> = {
  service: 0,
  goods: 1,
  referral: 2,
};

/** Nhãn thời hạn của một việc: trễ n ngày / hôm nay / còn n ngày / không hiện (đánh giá, thiếu file...). */
export function todoWhen(
  i: Pick<TodoItem, "kind" | "days">,
): { key: "late" | "today" | "left"; n: number } | null {
  if (i.kind === "overdue") return { key: "late", n: Math.abs(i.days) };
  if (["due_soon", "contract_expiring", "customers_expiring", "commission"].includes(i.kind)) {
    if (i.days < 0) return { key: "late", n: -i.days };
    return i.days === 0 ? { key: "today", n: 0 } : { key: "left", n: i.days };
  }
  return null;
}

export type TodoTarget =
  | { to: "/contracts/$id"; id: string }
  | { to: "/products"; sp: string; ht?: string }
  | { to: "/partners"; party?: string }
  | null;

/** Bấm một việc ⇒ mở đúng chỗ: SP (khách/hoa hồng/gia hạn có SP), đối tác (đánh giá), còn lại HĐ. */
export function todoTarget(i: TodoItem): TodoTarget {
  if (i.kind === "rating_quarter") return { to: "/partners" };
  if (i.kind === "rating")
    return { to: "/partners", ...(i.party_key ? { party: i.party_key } : {}) };
  if (i.kind === "customers_expiring" && i.product_id)
    return { to: "/products", sp: i.product_id, ht: "users" };
  if (i.kind === "market_price" && i.product_id)
    return { to: "/products", sp: i.product_id, ht: "suppliers" };
  if ((i.kind === "commission" || i.kind === "renewal_contact") && i.product_id)
    return { to: "/products", sp: i.product_id };
  return i.contract_id ? { to: "/contracts/$id", id: i.contract_id } : null;
}

/** Việc có thể "Đã xong"? Chỉ Liên hệ mời gia hạn (đóng hẹn nhắc); còn lại chỉ "Bỏ qua". */
export const todoCanDone = (i: Pick<TodoItem, "kind">): boolean => i.kind === "renewal_contact";

export const SUGGEST_COLS = [
  { key: "buy", tone: "ok", items: ["buy", "push"] },
  { key: "hold", tone: "grey", items: ["hold", "keep"] },
  { key: "dump", tone: "late", items: ["dump", "stop"] },
] as const;

/** "Sản phẩm: nên làm gì": chia SP có điểm vào 3 cột theo đề xuất, điểm cao lên trước. */
export function suggestColumns(rows: readonly BizProductRow[] | undefined) {
  const scored = (rows ?? []).filter((p) => p.business.score != null && p.business.suggestion);
  return SUGGEST_COLS.map((c) => ({
    ...c,
    rows: scored
      .filter((p) => (c.items as readonly string[]).includes(p.business.suggestion as string))
      .sort((a, b) => (b.business.score ?? 0) - (a.business.score ?? 0)),
  }));
}
