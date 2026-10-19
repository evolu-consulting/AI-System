// HD8-FR-01 · HD8-FR-02 · port NGUYÊN `mgmt-app/api/app/scoring/engine.py`: sổ đối tác + cấu hình + hôm nay (+ vài sự thật từ HĐ)
// ⇒ điểm 0–100, mức, lý do. Làm tròn = `round()` của Python (nửa về chẵn trên giá trị nhị phân đúng) qua `pyRound` của HD9 (D8-02);
// mọi phép tính giữ đúng thứ tự toán hạng của mgmt để ra cùng số double. Ngày = chuỗi ISO `YYYY-MM-DD`, so sánh chuỗi như mgmt.
import { pyRound } from "../cks/domain/prices.rules";
import { addDays, daysBetween } from "./local-time.rules";
import type { Criterion, Role, Rules } from "./scoring-config.rules";

export type Band = "good" | "fair" | "watch";
/** Một dòng sổ như mgmt đọc (khoá trong `data` đã trải phẳng). */
export type Ev = {
  type: string;
  at: string;
  voided?: boolean;
  days_late?: number | null;
  obligation_id?: string | null;
  party_late?: boolean;
  due_date?: string;
  kind?: string;
  delta?: number | null;
  criterion?: string;
  value?: number;
  rated_at?: string | null;
  days_before_expiry?: number | null;
  with_us?: boolean;
  by?: string | null;
};
export type Facts = {
  contracts?: number;
  first_start?: string | null;
  price_gap_pct?: number | null;
};
type Crit = {
  value: number | null;
  detail: string | null;
  on?: number;
  total?: number;
  count?: number;
  postponed?: number;
  by?: string | null;
  at?: string;
};
type W = [Ev, number];
export type Breakdown = Record<string, Crit & { label: string }>;
export type ScoreOut = {
  score: number | null;
  band: Band | null;
  reason: string;
  breakdown: Breakdown;
  adjust: number;
  event_count: number;
};

const SETTLED = new Set(["paid", "received", "delivered"]);

export function band(score: number | null, rules: Rules): Band | null {
  if (score === null) return null;
  return score >= rules.good_from ? "good" : score >= rules.fair_from ? "fair" : "watch";
}

/** `_clamp`: `int(round(max(lo, min(hi, x))))`. */
export const clamp = (x: number, lo = 0, hi = 100): number =>
  pyRound(Math.max(lo, Math.min(hi, x)));

export const windowStart = (rules: Rules, today: string): string =>
  addDays(today, -pyRound(rules.window_months * 30.44));

function inWindow(events: readonly Ev[], rules: Rules, today: string): W[] {
  const start = windowStart(rules, today);
  const recent = addDays(today, -pyRound(rules.recency_months * 30.44));
  const out: W[] = [];
  for (const e of events) {
    if (e.voided || e.at < start || e.at > today) continue;
    out.push([e, rules.recency_boost && e.at >= recent ? 2.0 : 1.0]);
  }
  return out;
}

const sum = (xs: readonly number[]) => xs.reduce((s, x) => s + x, 0);

function onTime(rows: readonly W[], label: string, unit: string): Crit {
  if (!rows.length) return { value: null, detail: null };
  const w = sum(rows.map(([, x]) => x));
  const on = sum(rows.filter(([e]) => !e.days_late).map(([, x]) => x));
  const lateDays = sum(rows.map(([e, x]) => (e.days_late || 0) * x)) / w;
  const nOn = rows.filter(([e]) => !e.days_late).length;
  const n = rows.length;
  return {
    value: clamp((100 * on) / w - 2 * lateDays),
    detail: `${label} ${nOn}/${n} ${unit}`,
    on: nOn,
    total: n,
  };
}

/** `_pending_overdue`: dòng "Quá hạn" chưa ai trả lời ⇒ dòng trễ, lớn dần theo ngày. */
function pendingOverdue(win: readonly W[], today: string): W[] {
  const settled = new Set(win.filter(([e]) => SETTLED.has(e.type)).map(([e]) => e.obligation_id));
  const moved = win.filter(([e]) => e.type === "postponed").map(([e]) => [e.obligation_id, e.at]);
  const out: W[] = [];
  for (const [e, x] of win) {
    if (e.type !== "overdue" || !e.party_late || settled.has(e.obligation_id)) continue;
    if (moved.some(([o, at]) => o === e.obligation_id && (at as string) >= e.at)) continue;
    const days = daysBetween(e.due_date as string, today);
    out.push([{ ...e, days_late: Math.max(1, days) }, x]);
  }
  return out;
}

function renewal(renew: readonly W[]): Crit {
  if (!renew.length) return { value: null, detail: null };
  const vals = renew.map(([e]) =>
    e.type === "cks_lapsed" || !(e.with_us ?? true)
      ? 0
      : (e.days_before_expiry || 0) >= 0
        ? 100
        : Math.max(0, 100 + 10 * (e.days_before_expiry as number)),
  );
  return {
    value: clamp(sum(vals) / vals.length),
    detail: `${renew.length} lần gia hạn chữ ký số`,
  };
}

function tenure(facts: Facts, today: string): Crit {
  const first = facts.first_start;
  if (!first) return { value: null, detail: null };
  const years = Math.max(0.0, daysBetween(first, today) / 365);
  const renewals = Math.max(0, (facts.contracts || 1) - 1);
  return {
    value: clamp(40 + 20 * years + 10 * renewals),
    detail: `Hợp tác ${Math.trunc(years)} năm, gia hạn ${renewals} lần`,
  };
}

function priceCrit(gap: number | null | undefined): Crit {
  if (gap === null || gap === undefined) return { value: null, detail: null };
  return {
    value: clamp(100 - 5 * gap),
    detail: gap <= 0 ? "Giá rẻ nhất" : `Đắt hơn ${pyRound(gap, 1).toFixed(1)}%`,
  };
}

function criteria(
  win: readonly W[],
  role: Role,
  facts: Facts,
  today: string,
): Record<string, Crit> {
  const of = (...types: string[]) => win.filter(([e]) => types.includes(e.type));
  const out: Record<string, Crit> = {};
  const pending = pendingOverdue(win, today);
  if (role === "customer")
    out.payment_on_time = onTime(
      [...of("received"), ...pending.filter(([e]) => e.kind !== "delivery")],
      "Thanh toán đúng hạn",
      "đợt",
    );
  else
    out.delivery_on_time = onTime(
      [...of("delivered"), ...pending.filter(([e]) => e.kind === "delivery")],
      "Giao đúng hạn",
      "lần",
    );
  out.cks_renewal = renewal(of("cks_renewed", "cks_lapsed"));
  const reminded = of("reminded").length;
  const dealings = of("received", "paid", "delivered", "postponed", "reminded").length > 0;
  const per = reminded / Math.max(1, facts.contracts || 1);
  out.reminders = {
    value: dealings ? clamp(100 - 15 * per) : null,
    detail: `Phải nhắc ${reminded} lần`,
    count: reminded,
  };
  const kept = of("appointment_kept").length;
  const moved = of("postponed", "appointment_missed").length;
  out.appointments = {
    value: kept + moved ? clamp((100 * kept) / (kept + moved)) : null,
    detail: `Giữ hẹn ${kept}/${kept + moved} lần`,
    postponed: of("postponed").length,
  };
  out.tenure = tenure(facts, today);
  const complaints = of("complaint").length;
  out.complaints = {
    value: dealings || complaints ? clamp(100 - 25 * complaints) : null,
    detail: `${complaints} lần khiếu nại`,
  };
  if (role === "supplier") out.price = priceCrit(facts.price_gap_pct);
  return out;
}

function reason(score: number | null, role: Role, crit: Record<string, Crit>, b: Band | null) {
  if (score === null) return "Chưa đủ dữ liệu để chấm";
  if (role === "supplier") {
    const d = crit.delivery_on_time ?? { value: null, detail: null };
    if (d.total) {
      const late = d.total - (d.on as number);
      return late / d.total <= 0.05
        ? `Giao đúng hạn ${d.on}/${d.total} lần`
        : `Giao trễ ${late}/${d.total} lần`;
    }
    return "Chưa có lần giao nào";
  }
  const nag = crit.reminders?.count ?? 0;
  const moved = crit.appointments?.postponed ?? 0;
  if (b === "watch" || nag + moved >= 5)
    return `Phải nhắc thanh toán ${nag} lần, dời hẹn ${moved} lần`;
  return crit.payment_on_time?.detail || "Chưa có đợt thanh toán nào";
}

const viDay = (iso: string) => iso.slice(0, 10).split("-").reverse().join("/");

/** `_rated`: lần chấm tay mới nhất trong khoảng tính (theo `at`, rồi `rated_at`). */
function rated(win: readonly W[], key: string): Crit {
  const rows = win
    .map(([e]) => e)
    .filter((e) => e.type === "rating" && e.criterion === key)
    .sort((a, b) => cmp(a.at, b.at) || cmp(a.rated_at ?? "", b.rated_at ?? ""));
  const e = rows.at(-1);
  if (!e) return { value: null, detail: null };
  return {
    value: clamp(e.value as number),
    detail: `Chấm tay ${e.value}/100 ngày ${viDay(e.at)}`,
    by: e.by ?? null,
    at: e.at,
  };
}

/** So chuỗi theo điểm mã như Python (không theo locale). */
export const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

const NOT_DEALINGS = new Set(["manual_adjust", "rating", "overdue"]);

/** `engine.score`. `cfg.criteria` đã chuẩn hoá (`normalise`). */
export function score(
  events: readonly Ev[],
  cfg: { criteria: readonly Criterion[]; rules: Rules },
  today: string,
  role: Role,
  facts: Facts = {},
): ScoreOut {
  const { rules } = cfg;
  const win = inWindow(events, rules, today);
  const counted = win.filter(([e]) => !NOT_DEALINGS.has(e.type));
  const crit = criteria(win, role, facts, today);
  for (const c of cfg.criteria) if (c.kind === "manual") crit[c.key] = rated(win, c.key);
  const on = cfg.criteria.filter(
    (c) => c.enabled && c.weight > 0 && (crit[c.key]?.value ?? null) !== null,
  );
  let adjust = 0;
  if (rules.manual_adjust) {
    const d = sum(win.filter(([e]) => e.type === "manual_adjust").map(([e]) => e.delta || 0));
    adjust = Math.max(-10, Math.min(10, d));
  }
  const ratedAny = on.some((c) => c.kind === "manual");
  let value: number | null = null;
  if (!((counted.length < rules.min_events && !ratedAny) || !on.length)) {
    const total = sum(on.map((c) => c.weight));
    value = clamp(sum(on.map((c) => (crit[c.key]?.value as number) * c.weight)) / total + adjust);
  }
  const b = band(value, rules);
  const breakdown: Breakdown = {};
  for (const c of cfg.criteria)
    breakdown[c.key] = { ...(crit[c.key] ?? { value: null, detail: null }), label: c.label };
  return {
    score: value,
    band: b,
    reason: reason(value, role, crit, b),
    breakdown,
    adjust,
    event_count: counted.length,
  };
}
