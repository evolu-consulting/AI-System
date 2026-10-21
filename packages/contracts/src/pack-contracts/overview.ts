// V2-K · BA v2 §3.4 TQ-01/TQ-02 · §4.1 · §5.4 · §5.9: contract zod của Tổng quan — `GET /pack/contracts/overview?period=` (4 con số +
// % so kỳ trước + 12 cột theo nhóm SP) và Cần xử lý 8 nguồn `GET /pack/contracts/my-work/todo`, `POST /pack/contracts/my-work/todo/dismiss`.
// Chỉ đếm cái người dùng THẤY (RLS M1). Tiền = số nguyên đồng.
import { z } from "zod";

export const OVERVIEW_PERIODS = ["month", "quarter", "12m"] as const;
export type OverviewPeriod = (typeof OVERVIEW_PERIODS)[number];
export const OVERVIEW_GROUPS = ["service", "goods", "referral"] as const;
export type OverviewGroup = (typeof OVERVIEW_GROUPS)[number];
export const OverviewQuerySchema = z.strictObject({
  period: z.enum(OVERVIEW_PERIODS).default("month"),
});

export type OverviewFigure = {
  expected: number;
  actual: number;
  outstanding: number;
  prev_actual: number;
  change_pct: number | null;
};
export type OverviewGroupRow = {
  group: OverviewGroup;
  basis: "revenue_expected" | "commission_expected";
  total: number;
  prev_total: number;
  change_pct: number | null;
  months: { month: string; value: number }[];
};
export type OverviewOut = {
  period: OverviewPeriod;
  today: string;
  from: string;
  to: string;
  prev_from: string;
  prev_to: string;
  window_from: string;
  months: string[];
  revenue: OverviewFigure;
  gross_profit: {
    amount: number;
    margin_pct: number | null;
    prev_amount: number;
    change_pct: number | null;
    cost_missing: boolean;
  };
  commission: OverviewFigure;
  stock_held: { value: number };
  groups: OverviewGroupRow[];
};

export const TODO_KINDS = [
  "overdue",
  "due_soon",
  "contract_expiring",
  "customers_expiring",
  "renewal_contact",
  "commission",
  "rating",
  "rating_quarter",
  "missing_file",
  // price-scout · "Giá thị trường thay đổi" (cảnh báo của lượt dò giá theo lịch).
  "market_price",
] as const;
export type TodoKind = (typeof TODO_KINDS)[number];
export const TODO_ACTIONS = ["skip", "done"] as const;
export type TodoAction = (typeof TODO_ACTIONS)[number];
export const TODO_SOURCE_MAX = 100;
export const TODO_MAX = 300;

export const TodoQuerySchema = z.strictObject({});
export const TodoDismissSchema = z.strictObject({
  key: z.string().min(1).max(120),
  action: z.enum(TODO_ACTIONS),
});
export type TodoDismiss = z.infer<typeof TodoDismissSchema>;

export type TodoItem = {
  key: string;
  kind: TodoKind;
  days: number;
  due: string;
  title: string | null;
  sub: string | null;
  party: string | null;
  party_key: string | null;
  amount: number | null;
  direction: "pay" | "receive" | null;
  count: number | null;
  contract_id: string | null;
  product_id: string | null;
  milestone_id: string | null;
  followup_id: string | null;
};
export type TodoOut = {
  today: string;
  items: TodoItem[];
  counts: { total: number; overdue: number };
  truncated: boolean;
};
