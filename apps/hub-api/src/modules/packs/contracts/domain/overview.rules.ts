// V2-K · BA v2 §3.4 TQ-02 · §4.1 · §5.4 · §6 "Doanh thu, hoa hồng theo kỳ": luật thuần của Tổng quan — kỳ (Tháng này / Quý này /
// 12 tháng) + kỳ trước cùng độ dài, 12 cột tháng, gom số theo tháng ⇒ 4 con số + % so kỳ trước + dòng theo nhóm SP. Mọi kỳ là hợp các
// THÁNG lịch nên câu SQL chỉ gom theo tháng (24 tháng tới hết kỳ) và lớp này cộng lại. Ngày = `YYYY-MM-DD` (lịch tenant), tháng =
// `YYYY-MM`. Tiền = số nguyên đồng (≤ 10¹⁵/tháng, cộng 24 tháng vẫn trong số nguyên an toàn của JS). Lớp 1: không I/O.

export const OVERVIEW_PERIODS = ["month", "quarter", "12m"] as const;
export type OverviewPeriod = (typeof OVERVIEW_PERIODS)[number];
export const OVERVIEW_GROUPS = ["service", "goods", "referral"] as const;
export type OverviewGroup = (typeof OVERVIEW_GROUPS)[number];
/** Số cột tháng của biểu đồ theo nhóm. */
export const OVERVIEW_MONTHS = 12;

export type PeriodRange = {
  from: string;
  to: string;
  prev_from: string;
  prev_to: string;
};
export type OverviewRange = PeriodRange & {
  /** Đầu cửa sổ đọc = sớm hơn trong (cột đầu biểu đồ, đầu kỳ trước). */
  window_from: string;
  /** 12 tháng của biểu đồ, kết thúc ở tháng cuối kỳ. */
  months: string[];
};

/** Một tháng gom từ SQL (tiền đồng). `profit`/`cost_missing` chỉ có nghĩa cho tháng thuộc kỳ hiện tại + kỳ trước. */
export type MonthRow = {
  m: string;
  rev_exp: number;
  rev_act: number;
  comm_exp: number;
  comm_act: number;
  profit: number;
  cost_missing: boolean;
  service: number;
  goods: number;
};

export type Figure = {
  expected: number;
  actual: number;
  /** Dự kiến − thực nhận (≥ 0): "chưa thu" / "chưa nhận". */
  outstanding: number;
  prev_actual: number;
  /** % thực nhận so với kỳ trước (null khi kỳ trước = 0). */
  change_pct: number | null;
};
export type GroupRow = {
  group: OverviewGroup;
  /** Dịch vụ/Hàng hoá = doanh thu dự kiến; Giới thiệu = hoa hồng dự kiến. */
  basis: "revenue_expected" | "commission_expected";
  total: number;
  prev_total: number;
  change_pct: number | null;
  months: { month: string; value: number }[];
};
export type OverviewOut = OverviewRange & {
  period: OverviewPeriod;
  today: string;
  revenue: Figure;
  gross_profit: {
    amount: number;
    /** (lãi gộp − hoa hồng) ÷ doanh thu dự kiến × 100, 1 chữ số thập phân; null khi doanh thu dự kiến = 0. */
    margin_pct: number | null;
    prev_amount: number;
    change_pct: number | null;
    /** Có HĐ bán trong kỳ chưa đủ giá vốn (dòng chưa gắn SP / đặt theo khách) ⇒ lãi gộp có thể cao hơn thực. */
    cost_missing: boolean;
  };
  commission: Figure;
  stock_held: { value: number };
  groups: GroupRow[];
};

const pad = (n: number) => String(n).padStart(2, "0");
const ym = (y: number, m0: number): string => {
  const d = new Date(Date.UTC(y, m0, 1));
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}`;
};
/** Tháng `YYYY-MM` + n tháng. */
export function addMonths(month: string, n: number): string {
  const [y, m] = month.split("-").map(Number) as [number, number];
  return ym(y, m - 1 + n);
}
const firstDay = (month: string) => `${month}-01`;
const lastDay = (month: string) => {
  const [y, m] = month.split("-").map(Number) as [number, number];
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
};

/** Tháng đầu + số tháng của kỳ chứa `today`: tháng lịch · quý lịch · 12 tháng gần nhất (gồm tháng này). */
function periodMonths(today: string, p: OverviewPeriod): { start: string; n: number } {
  const month = today.slice(0, 7);
  if (p === "month") return { start: month, n: 1 };
  if (p === "12m") return { start: addMonths(month, -11), n: 12 };
  const [y, m] = month.split("-").map(Number) as [number, number];
  return { start: ym(y, Math.floor((m - 1) / 3) * 3), n: 3 };
}

export function overviewRange(today: string, p: OverviewPeriod): OverviewRange {
  const { start, n } = periodMonths(today, p);
  const end = addMonths(start, n - 1);
  const chart = addMonths(end, -(OVERVIEW_MONTHS - 1));
  const prevStart = addMonths(start, -n);
  return {
    from: firstDay(start),
    to: lastDay(end),
    prev_from: firstDay(prevStart),
    prev_to: lastDay(addMonths(start, -1)),
    // Luật 4c: chỉ đọc tháng cần — 12 cột biểu đồ ∪ kỳ trước (Tháng/Quý: 12 tháng; 12 tháng: 24).
    window_from: firstDay(prevStart < chart ? prevStart : chart),
    months: Array.from({ length: OVERVIEW_MONTHS }, (_, i) =>
      addMonths(end, i - (OVERVIEW_MONTHS - 1)),
    ),
  };
}

/** % thay đổi a so với b, 1 chữ số thập phân; b = 0 ⇒ null (không chia cho 0). */
export function pctChange(a: number, b: number): number | null {
  if (b === 0) return null;
  return Math.round(((a - b) / Math.abs(b)) * 1000) / 10;
}

type Sum = Omit<MonthRow, "m" | "cost_missing"> & { cost_missing: boolean };
const ZERO: Sum = {
  rev_exp: 0,
  rev_act: 0,
  comm_exp: 0,
  comm_act: 0,
  profit: 0,
  cost_missing: false,
  service: 0,
  goods: 0,
};
/** Cộng các tháng trong [from, to] (so chuỗi `YYYY-MM`). */
export function sumMonths(rows: readonly MonthRow[], from: string, to: string): Sum {
  const a = from.slice(0, 7);
  const b = to.slice(0, 7);
  const s = { ...ZERO };
  for (const r of rows) {
    if (r.m < a || r.m > b) continue;
    s.rev_exp += r.rev_exp;
    s.rev_act += r.rev_act;
    s.comm_exp += r.comm_exp;
    s.comm_act += r.comm_act;
    s.profit += r.profit;
    s.service += r.service;
    s.goods += r.goods;
    s.cost_missing ||= r.cost_missing;
  }
  return s;
}

const figure = (exp: number, act: number, prevAct: number): Figure => ({
  expected: exp,
  actual: act,
  outstanding: Math.max(0, exp - act),
  prev_actual: prevAct,
  change_pct: pctChange(act, prevAct),
});

const GROUP_OF: Record<OverviewGroup, (s: Sum) => number> = {
  service: (s) => s.service,
  goods: (s) => s.goods,
  referral: (s) => s.comm_exp,
};

function groupRows(rows: readonly MonthRow[], r: OverviewRange): GroupRow[] {
  const byMonth = new Map(rows.map((x) => [x.m, x]));
  return OVERVIEW_GROUPS.map((g) => {
    const total = GROUP_OF[g](sumMonths(rows, r.from, r.to));
    const prev = GROUP_OF[g](sumMonths(rows, r.prev_from, r.prev_to));
    return {
      group: g,
      basis: g === "referral" ? "commission_expected" : "revenue_expected",
      total,
      prev_total: prev,
      change_pct: pctChange(total, prev),
      months: r.months.map((month) => {
        const x = byMonth.get(month);
        return { month, value: x ? GROUP_OF[g]({ ...ZERO, ...x }) : 0 };
      }),
    };
  });
}

/**
 * TQ-02: 4 con số của kỳ + % so kỳ trước + 12 cột theo nhóm. Doanh thu / hoa hồng: % theo THỰC NHẬN (mockup); lãi gộp tính trên
 * doanh thu DỰ KIẾN (BA §5.4) — gồm hoa hồng dự kiến (toàn bộ là lãi), biên % = phần lãi bán hàng ÷ doanh thu dự kiến.
 */
export function buildOverview(
  rows: readonly MonthRow[],
  stockValue: number,
  today: string,
  period: OverviewPeriod,
): OverviewOut {
  const r = overviewRange(today, period);
  const cur = sumMonths(rows, r.from, r.to);
  const prev = sumMonths(rows, r.prev_from, r.prev_to);
  const salesProfit = cur.profit - cur.comm_exp;
  return {
    period,
    today,
    ...r,
    revenue: figure(cur.rev_exp, cur.rev_act, prev.rev_act),
    gross_profit: {
      amount: cur.profit,
      margin_pct: cur.rev_exp === 0 ? null : Math.round((salesProfit / cur.rev_exp) * 1000) / 10,
      prev_amount: prev.profit,
      change_pct: pctChange(cur.profit, prev.profit),
      cost_missing: cur.cost_missing,
    },
    commission: figure(cur.comm_exp, cur.comm_act, prev.comm_act),
    stock_held: { value: stockValue },
    groups: groupRows(rows, r),
  };
}
