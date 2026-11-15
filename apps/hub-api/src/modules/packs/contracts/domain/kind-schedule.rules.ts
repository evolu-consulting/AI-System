// CR-152 · Lớp 1 (không I/O): bộ mốc tự sinh của «Nhượng quyền» / «Thỏa thuận hợp tác» + phép tính phí / chia tiền theo kỳ.
// Tiền = số nguyên đồng; % qua BigInt (làm tròn nửa lên tới đồng). Ngày `YYYY-MM-DD` (UTC thuần, không múi giờ).
import {
  KIND_PERIODS_MAX,
  KIND_PERIODS_OPEN_ENDED,
  type Period,
} from "@ai/contracts/pack-contracts";
import type { KindDealKey, Terms } from "./kind-terms.rules";
import { directionOfKind } from "./kind-terms.rules";

export type PeriodUnit = "month" | "quarter" | "year";
export type KindPeriod = { key: string; label: string; start: string; end: string };
export type KindMilestoneRole = "initial" | "report" | "fee" | "settle" | "renewal";
export type KindMilestone = {
  role: KindMilestoneRole;
  /** Loại BA của mốc: thu / trả phí, hoặc `other` (báo cáo / đối soát), `renewal`. */
  kind: "collect" | "pay" | "other" | "renewal";
  title: string;
  due_date: string;
  owner: "ours" | "partner";
  direction: "pay" | "receive";
  amount: number | null;
  period_key: string | null;
};

/** Hạn mặc định (ngày sau mốc): báo cáo doanh thu 5, thu/trả phí và đối soát 10, phí ban đầu 5 sau ngày hiệu lực. */
export const REPORT_DUE_DAYS = 5;
export const FEE_DUE_DAYS = 10;
export const INITIAL_FEE_DUE_DAYS = 5;
/** Nhắc gia hạn: trước ngày hết hạn `notice_days` (mặc định 60) ngày. */
export const RENEWAL_DEFAULT_DAYS = 60;
const MONEY_MAX = 1_000_000_000_000_000;

const t0 = (iso: string): number => Date.parse(`${iso}T00:00:00Z`);
const iso = (ms: number): string => new Date(ms).toISOString().slice(0, 10);
export const addDays = (d: string, n: number): string => iso(t0(d) + n * 86_400_000);
const pad = (n: number) => String(n).padStart(2, "0");
/** Ngày cuối tháng `m` (1..12) của năm `y`. */
const lastDay = (y: number, m: number): string => iso(Date.UTC(y, m, 0));

/** Kỳ lịch chứa ngày `d`. */
function calendarPeriod(d: string, unit: PeriodUnit): KindPeriod {
  const y = Number(d.slice(0, 4));
  const m = Number(d.slice(5, 7));
  if (unit === "month")
    return {
      key: `${y}-${pad(m)}`,
      label: `tháng ${m}/${y}`,
      start: `${y}-${pad(m)}-01`,
      end: lastDay(y, m),
    };
  if (unit === "quarter") {
    const q = Math.floor((m - 1) / 3) + 1;
    const m1 = q * 3 - 2;
    return {
      key: `${y}-Q${q}`,
      label: `quý ${q}/${y}`,
      start: `${y}-${pad(m1)}-01`,
      end: lastDay(y, m1 + 2),
    };
  }
  return { key: `${y}`, label: `năm ${y}`, start: `${y}-01-01`, end: `${y}-12-31` };
}

/** Khoá kỳ ⇒ kỳ lịch (nhãn + ngày đầu/cuối), cắt theo hiệu lực HĐ; khoá sai ⇒ null. */
export function periodOfKey(
  key: string,
  start: string | null,
  end: string | null,
): KindPeriod | null {
  const m = /^(\d{4})(?:-(0[1-9]|1[0-2]|Q([1-4])))?$/.exec(key);
  if (!m) return null;
  const y = m[1] as string;
  const p = !m[2]
    ? calendarPeriod(`${y}-01-01`, "year")
    : m[3]
      ? calendarPeriod(`${y}-${pad(Number(m[3]) * 3 - 2)}-01`, "quarter")
      : calendarPeriod(`${y}-${m[2]}-01`, "month");
  return {
    ...p,
    start: start && start > p.start ? start : p.start,
    end: end && end < p.end ? end : p.end,
  };
}

/** Chuỗi kỳ từ `start` tới `end` (kỳ đầu/cuối cắt theo hiệu lực). Không có `end` ⇒ `KIND_PERIODS_OPEN_ENDED` kỳ; trần `KIND_PERIODS_MAX`. */
export function periodsOf(start: string, end: string | null, unit: PeriodUnit): KindPeriod[] {
  const cap = end === null ? KIND_PERIODS_OPEN_ENDED : KIND_PERIODS_MAX;
  const out: KindPeriod[] = [];
  let cur = start;
  while (out.length < cap && (end === null || cur <= end)) {
    const p = calendarPeriod(cur, unit);
    out.push({
      ...p,
      start: p.start < start ? start : p.start,
      end: end !== null && p.end > end ? end : p.end,
    });
    cur = addDays(p.end, 1);
  }
  return out;
}

/** `figure × pct%` làm tròn nửa lên tới đồng (pct tối đa 2 chữ số thập phân). */
export function pctOf(figure: number, pct: number): number {
  return Number((BigInt(figure) * BigInt(Math.round(pct * 100)) + 5_000n) / 10_000n);
}

const num = (v: unknown): number | null => (typeof v === "number" ? v : null);

/**
 * Phí của một kỳ nhượng quyền: (cố định HOẶC % doanh thu) + phí quảng cáo % doanh thu. Chưa có doanh thu mà cần ⇒ null
 * (riêng cố định + quảng cáo: tạm = phần cố định, cập nhật khi ghi doanh thu).
 */
export function franchiseFee(t: Terms, revenue: number | null): number | null {
  const ad = num(t.ad_fee_pct) ?? 0;
  const base =
    t.fee_basis === "fixed"
      ? (num(t.fee_fixed) ?? 0)
      : revenue === null
        ? null
        : pctOf(revenue, num(t.fee_pct) ?? 0);
  if (base === null) return null;
  return Math.min(base + (revenue !== null && ad > 0 ? pctOf(revenue, ad) : 0), MONEY_MAX);
}

/** Phần chia của Hợp tác: phần mình theo %, phần đối tác = phần còn lại (tổng đúng từng đồng). */
export function coopShares(figure: number, ourPct: number): { ours: number; partner: number } {
  const ours = Math.min(pctOf(figure, ourPct), figure);
  return { ours, partner: figure - ours };
}

/** Nhượng quyền cần mốc «Báo cáo doanh thu» khi phí theo % doanh thu hoặc có phí quảng cáo %. */
export const needsRevenueReport = (t: Terms): boolean =>
  t.fee_basis === "revenue_pct" || (num(t.ad_fee_pct) ?? 0) > 0;

export type KindScheduleIn = {
  deal: KindDealKey;
  terms: Terms;
  start: string | null;
  end: string | null;
  signed: string | null;
  noticeDays: number | null;
  today: string;
};

/** Bộ mốc tự sinh khi HĐ có hiệu lực (một lần, theo tập). */
export function kindMilestones(c: KindScheduleIn): KindMilestone[] {
  const from = c.start ?? c.signed ?? c.today;
  const out: KindMilestone[] = [];
  if (c.deal === "franchise") out.push(...franchiseMilestones(c, from));
  else if (c.terms.split_basis === "profit" || c.terms.split_basis === "revenue")
    out.push(...cooperationMilestones(c, from));
  if (c.end) {
    const due = addDays(c.end, -(c.noticeDays ?? RENEWAL_DEFAULT_DAYS));
    out.push({
      role: "renewal",
      kind: "renewal",
      title: "Nhắc gia hạn",
      due_date: due < from ? from : due,
      owner: "ours",
      direction: directionOfKind(c.deal, c.terms) === "purchase" ? "pay" : "receive",
      amount: null,
      period_key: null,
    });
  }
  return out;
}

function franchiseMilestones(c: KindScheduleIn, from: string): KindMilestone[] {
  const t = c.terms;
  const buy = directionOfKind("franchise", t) === "purchase"; // mình là bên nhận quyền ⇒ mình trả
  const money = buy ? ("pay" as const) : ("collect" as const);
  const direction = buy ? ("pay" as const) : ("receive" as const);
  const owner = buy ? ("ours" as const) : ("partner" as const);
  const verb = buy ? "Trả" : "Thu";
  const out: KindMilestone[] = [];
  const initial = num(t.initial_fee);
  if (initial !== null && initial > 0)
    out.push({
      role: "initial",
      kind: money,
      title: `${verb} phí nhượng quyền ban đầu`,
      due_date: addDays(from, INITIAL_FEE_DUE_DAYS),
      owner,
      direction,
      amount: initial,
      period_key: null,
    });
  const unit: PeriodUnit = t.period === "quarter" ? "quarter" : "month";
  const report = needsRevenueReport(t);
  for (const p of periodsOf(from, c.end, unit)) {
    if (report)
      out.push({
        role: "report",
        kind: "other",
        title: `Báo cáo doanh thu ${p.label}`,
        due_date: addDays(p.end, REPORT_DUE_DAYS),
        owner: buy ? "ours" : "partner",
        direction,
        amount: null,
        period_key: p.key,
      });
    out.push({
      role: "fee",
      kind: money,
      title: `${verb} phí nhượng quyền ${p.label}`,
      due_date: addDays(p.end, FEE_DUE_DAYS),
      owner,
      direction,
      amount: franchiseFee(t, null),
      period_key: p.key,
    });
  }
  return out;
}

function cooperationMilestones(c: KindScheduleIn, from: string): KindMilestone[] {
  const unit = (c.terms.settle_period as PeriodUnit | undefined) ?? "quarter";
  const what = c.terms.split_basis === "profit" ? "lợi nhuận" : "doanh thu";
  return periodsOf(from, c.end, unit).map((p) => ({
    role: "settle" as const,
    kind: "other" as const,
    title: `Đối soát ${what} ${p.label}`,
    due_date: addDays(p.end, FEE_DUE_DAYS),
    owner: "ours" as const,
    direction: "receive" as const,
    amount: null,
    period_key: p.key,
  }));
}

/** Hàng mốc có `period_key` (đọc từ `contracts.obligations`). */
export type PeriodRow = {
  id: string;
  period_key: string;
  /** `payment` = mốc thu/trả phí; `other` = mốc báo cáo doanh thu / đối soát. */
  kind: string;
  status: "open" | "done" | "cancelled";
  due_date: string;
  amount: number | null;
  period_figure: number | null;
};

/** Gộp mốc theo kỳ ⇒ danh sách kỳ để hiển thị (theo thứ tự kỳ). Phần chia chỉ tính khi hợp tác đã ghi số kỳ. */
export function buildPeriods(
  c: { deal: KindDealKey; terms: Terms; start: string | null; end: string | null },
  rows: readonly PeriodRow[],
): Period[] {
  const by = new Map<string, PeriodRow[]>();
  for (const r of rows) by.set(r.period_key, [...(by.get(r.period_key) ?? []), r]);
  const ourPct = num(c.terms.our_share_pct);
  const out: Period[] = [];
  for (const key of [...by.keys()].sort()) {
    const p = periodOfKey(key, c.start, c.end);
    if (!p) continue;
    const rs = by.get(key) ?? [];
    const rep = rs.find((r) => r.kind === "other" && r.status !== "cancelled");
    const fee = rs.find((r) => r.kind === "payment" && r.status !== "cancelled");
    const ms = (r: PeriodRow | undefined) =>
      r ? { id: r.id, due_date: r.due_date, status: r.status, amount: r.amount } : null;
    const figure = rep?.period_figure ?? null;
    const shares =
      c.deal === "cooperation" && figure !== null && ourPct !== null
        ? coopShares(figure, ourPct)
        : null;
    out.push({
      key,
      label: p.label,
      period_start: p.start,
      period_end: p.end,
      figure,
      figure_kind:
        c.deal === "cooperation" && c.terms.split_basis === "profit" ? "profit" : "revenue",
      report: ms(rep),
      fee: ms(fee),
      our_share: shares?.ours ?? null,
      partner_share: shares?.partner ?? null,
    });
  }
  return out;
}
