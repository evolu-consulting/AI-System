// nav-v2 · V2-N · Tổng quan: dữ liệu giả cho `/overview` (không chứa test). Cần xử lý (`GET /my-work/todo`, 8 việc để thử "6 việc + Xem thêm 2"), `GET /overview`, `GET /business/products`,
// danh sách HĐ sắp hết hiệu lực (`GET /contracts?status=expiring…`) và đối tác (`GET /partners`, có mức CHÚ Ý) — hình = contract hub.
import { listAsHub } from "./dataset-list";
import { partnersAsHub } from "./dataset-partners";

export const TODAY = "2026-10-18";
const CID = "c1000000-0000-4000-8000-000000000011";
const todo = (o: Record<string, unknown> & { key: string }) => ({
  days: 0,
  due: TODAY,
  title: null,
  sub: null,
  party: null,
  party_key: null,
  amount: null,
  direction: null,
  count: null,
  contract_id: null,
  product_id: null,
  milestone_id: null,
  followup_id: null,
  ...o,
});

/** 8 việc `GET /my-work/todo` (V2-K, máy chủ đã sắp): 2 quá hạn, 3 có hạn gần, 1 đánh giá, 1 đánh giá quý, 1 thiếu file. */
export const TODO = [
  todo({
    key: "milestone:o1:2026-10-15",
    kind: "overdue",
    days: -3,
    due: "2026-10-15",
    title: "Thu tiền Khách An",
    sub: "HĐ bán 2026",
    contract_id: CID,
  }),
  todo({
    key: "milestone:o2:2026-10-17",
    kind: "overdue",
    days: -1,
    due: "2026-10-17",
    title: "Trả tiền NCC Bình",
    sub: "HĐ mua 2026",
    contract_id: CID,
  }),
  todo({
    key: "milestone:o3:2026-10-20",
    kind: "due_soon",
    days: 2,
    due: "2026-10-20",
    title: "Giao hàng đợt 2",
    sub: "HĐ bán 2026",
    contract_id: CID,
  }),
  todo({
    key: "customers_expiring:p1:2026-11-01",
    kind: "customers_expiring",
    days: 14,
    due: "2026-11-01",
    title: "Chữ ký số 1 năm",
    sub: "3 khách sắp hết hạn",
    count: 3,
    product_id: "p1",
  }),
  todo({
    key: "commission:o9:2026-10-10",
    kind: "commission",
    days: -8,
    due: "2026-10-10",
    title: "Nhận hoa hồng HĐ giới thiệu",
    contract_id: CID,
    product_id: "p1",
  }),
  todo({
    key: "rating:c9:2026-10-01",
    kind: "rating",
    days: 0,
    due: "2026-10-01",
    title: "Đánh giá Bếp Việt",
    sub: "HĐ đã xong",
    party: "Bếp Việt",
    party_key: "bep-viet",
    contract_id: CID,
  }),
  todo({
    key: "rating_quarter:u:2026-10-01",
    kind: "rating_quarter",
    due: "2026-10-01",
    title: "Đánh giá 2 đối tác sau quý 3/2026",
    sub: "Bếp Việt, VPP Hồng Hà",
    count: 2,
  }),
  todo({
    key: "missing_file:c8:2026-10-05",
    kind: "missing_file",
    due: "2026-10-05",
    title: "Chưa có file hợp đồng",
    sub: "Hợp đồng nhập tay",
    contract_id: CID,
  }),
];

export const todoAsHub = (items: unknown[] = TODO) => ({
  today: TODAY,
  items,
  counts: { total: items.length, overdue: 2 },
  truncated: false,
});

const fig = (expected: number, actual: number, prev: number, pct: number | null) => ({
  expected,
  actual,
  outstanding: Math.max(0, expected - actual),
  prev_actual: prev,
  change_pct: pct,
});
const months = Array.from(
  { length: 12 },
  (_, i) => `${i < 3 ? 2025 : 2026}-${String(((i + 9) % 12) + 1).padStart(2, "0")}`,
);
const series = (vals: number[]) => months.map((month, i) => ({ month, value: vals[i] ?? 0 }));

/** `GET /overview?period=` (V2-K): 4 con số + 3 nhóm × 12 cột. */
export const overviewAsHub = (period = "month") => ({
  period,
  today: TODAY,
  from: "2026-10-01",
  to: "2026-10-31",
  prev_from: "2026-09-01",
  prev_to: "2026-09-30",
  window_from: "2025-10-01",
  months,
  revenue: fig(236_000_000, 118_000_000, 100_000_000, 18),
  gross_profit: {
    amount: 52_000_000,
    margin_pct: 22,
    prev_amount: 60_000_000,
    change_pct: -13,
    cost_missing: false,
  },
  commission: fig(12_000_000, 4_000_000, 0, null),
  stock_held: { value: 1_250_000_000 },
  groups: [
    {
      group: "service",
      basis: "revenue_expected",
      total: 90_000_000,
      prev_total: 80_000_000,
      change_pct: 13,
      months: series([0, 5, 9, 4, 8, 6, 7, 3, 9, 5, 4, 9].map((n) => n * 10_000_000)),
    },
    {
      group: "goods",
      basis: "revenue_expected",
      total: 146_000_000,
      prev_total: 100_000_000,
      change_pct: 46,
      months: series([3, 4, 2, 6, 5, 7, 6, 8, 5, 9, 7, 14].map((n) => n * 10_000_000)),
    },
    {
      group: "referral",
      basis: "commission_expected",
      total: 12_000_000,
      prev_total: 0,
      change_pct: null,
      months: series([0, 0, 1, 0, 2, 0, 0, 1, 0, 0, 0, 12].map((n) => n * 1_000_000)),
    },
  ],
});

const biz = (
  id: string,
  name: string,
  score: number | null,
  suggestion: string | null,
  reason: string,
) => ({
  id,
  name,
  unit: null,
  group: "goods",
  kind: "stock",
  held: { qty: 0, unit: null, expires_on: null },
  sold_12m: 0,
  sold_3m: 0,
  business: { score, suggestion, reason, factors: [] },
});
/** `GET /business/products` (V2-J1): 2 SP nên đẩy/mua, 1 giữ, 1 xả, 1 chưa có điểm. */
export const bizListAsHub = () => ({
  items: [
    biz("p1", "Chữ ký số 1 năm", 82, "buy", "Bán nhanh, tồn thấp"),
    biz("p2", "Token USB", 74, "push", "Biên tốt"),
    biz("p3", "Hoá đơn điện tử", 55, "hold", "Ổn định"),
    biz("p4", "Phần mềm kế toán", 30, "dump", "Tồn lâu"),
    biz("p5", "SP mới", null, null, ""),
  ],
  counts: { all: 5, service: 0, goods: 5, referral: 0 },
});
/** `GET /contracts?…`: truy vấn `status=expiring` ⇒ chỉ HĐ sắp hết hiệu lực; còn lại ⇒ cả danh sách. */
export function contractsListAsHub(search: URLSearchParams) {
  const all = listAsHub();
  if (!search.getAll("status").includes("expiring")) return all;
  const items = all.items.filter((r) => r.status === "expiring");
  return { ...all, items, total: items.length };
}

/** `GET /reputation/partners?role=all` của bộ chung (Bếp Việt ở mức CHÚ Ý). */
export const partnersForOverview = (search: URLSearchParams) =>
  partnersAsHub("/reputation/partners", search);
