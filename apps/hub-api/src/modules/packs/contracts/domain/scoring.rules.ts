// HD8-FR-01 · HD8-FR-02 · port NGUYÊN `mgmt-app/api/app/scoring/engine.py`: sổ đối tác + cấu hình + hôm nay (+ vài sự thật từ HĐ)
// ⇒ điểm 0–100, mức, lý do. Làm tròn = `round()` của Python (nửa về chẵn trên giá trị nhị phân đúng) qua `pyRound` của HD9 (D8-02);
// mọi phép tính giữ đúng thứ tự toán hạng của mgmt để ra cùng số double. Hai tầng (HD8-NFR-01): `aggregate` (dòng sổ ⇒ đếm/tổng
// theo (đối tác, vai), ≡ câu gom SQL) rồi `scoreAgg` (công thức). `score(events)` = `scoreAgg(aggregate(events))` — test parity mgmt.
import { pyRound } from "../cks/domain/prices.rules";
import { daysBetween } from "./local-time.rules";
import { type Agg, aggregate, type Bucket, type Ev, windowOf } from "./scoring-agg.rules";
import type { Criterion, Role, Rules } from "./scoring-config.rules";

export type { Agg, Ev };
export type Band = "good" | "fair" | "watch";
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
export type Breakdown = Record<string, Crit & { label: string }>;
export type ScoreOut = {
  score: number | null;
  band: Band | null;
  reason: string;
  breakdown: Breakdown;
  adjust: number;
  event_count: number;
};
type Cfg = { criteria: readonly Criterion[]; rules: Rules };
/** Ngày tính + vai + vài sự thật từ HĐ (vắng ⇒ `{}`). */
export type ScoreAt = { today: string; role: Role; facts?: Facts };

export function band(score: number | null, rules: Rules): Band | null {
  if (score === null) return null;
  return score >= rules.good_from ? "good" : score >= rules.fair_from ? "fair" : "watch";
}

/** `_clamp`: `int(round(max(lo, min(hi, x))))`. */
export const clamp = (x: number, lo = 0, hi = 100): number =>
  pyRound(Math.max(lo, Math.min(hi, x)));

export const windowStart = (rules: Rules, today: string): string => windowOf(rules, today).start;

/** `_on_time` trên nhóm [cũ, gần đây] của dòng đã xong + dòng quá hạn treo; `wn` = trọng số dòng gần đây (2 khi ưu tiên). */
function onTime(
  set: readonly Bucket[],
  pend: readonly Bucket[],
  wn: number,
  { label, unit }: { label: string; unit: string },
): Crit {
  const [so, sn] = set as [Bucket, Bucket];
  const [po, pn] = pend as [Bucket, Bucket];
  const n = so.n + sn.n + po.n + pn.n;
  if (!n) return { value: null, detail: null };
  const w = so.n + po.n + wn * (sn.n + pn.n);
  const on = so.on + wn * sn.on;
  const lateDays = (so.late + po.late + wn * (sn.late + pn.late)) / w;
  const nOn = so.on + sn.on;
  return {
    value: clamp((100 * on) / w - 2 * lateDays),
    detail: `${label} ${nOn}/${n} ${unit}`,
    on: nOn,
    total: n,
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

function criteria(a: Agg, at: Required<ScoreAt>, wn: number): Record<string, Crit> {
  const { role, facts, today } = at;
  const out: Record<string, Crit> = {};
  if (role === "customer")
    out.payment_on_time = onTime(a.set, a.pend, wn, { label: "Thanh toán đúng hạn", unit: "đợt" });
  else out.delivery_on_time = onTime(a.set, a.pend, wn, { label: "Giao đúng hạn", unit: "lần" });
  out.cks_renewal = a.renew_n
    ? { value: clamp(a.renew_sum / a.renew_n), detail: `${a.renew_n} lần gia hạn chữ ký số` }
    : { value: null, detail: null };
  const per = a.reminded / Math.max(1, facts.contracts || 1);
  out.reminders = {
    value: a.dealings ? clamp(100 - 15 * per) : null,
    detail: `Phải nhắc ${a.reminded} lần`,
    count: a.reminded,
  };
  const moved = a.postponed + a.missed;
  out.appointments = {
    value: a.kept + moved ? clamp((100 * a.kept) / (a.kept + moved)) : null,
    detail: `Giữ hẹn ${a.kept}/${a.kept + moved} lần`,
    postponed: a.postponed,
  };
  out.tenure = tenure(facts, today);
  out.complaints = {
    value: a.dealings || a.complaints ? clamp(100 - 25 * a.complaints) : null,
    detail: `${a.complaints} lần khiếu nại`,
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

/** `_rated`: lần chấm tay mới nhất trong khoảng tính (đã chọn ở bước gom). */
function rated(a: Agg, key: string): Crit {
  const e = a.rated[key];
  if (!e) return { value: null, detail: null };
  return {
    value: clamp(e.value),
    detail: `Chấm tay ${e.value}/100 ngày ${viDay(e.at)}`,
    by: e.by,
    at: e.at,
  };
}

/** So chuỗi theo điểm mã như Python (không theo locale). */
export const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** Công thức `engine.score` trên đầu vào đã gom. `cfg.criteria` đã chuẩn hoá (`normalise`). */
export function scoreAgg(a: Agg, cfg: Cfg, at: ScoreAt): ScoreOut {
  const { today, role, facts = {} } = at;
  const { rules } = cfg;
  const crit = criteria(a, { role, facts, today }, rules.recency_boost ? 2 : 1);
  for (const c of cfg.criteria) if (c.kind === "manual") crit[c.key] = rated(a, c.key);
  const on = cfg.criteria.filter(
    (c) => c.enabled && c.weight > 0 && (crit[c.key]?.value ?? null) !== null,
  );
  const adjust = rules.manual_adjust ? Math.max(-10, Math.min(10, a.adjust)) : 0;
  const ratedAny = on.some((c) => c.kind === "manual");
  let value: number | null = null;
  if (!((a.counted < rules.min_events && !ratedAny) || !on.length)) {
    const total = on.reduce((s, c) => s + c.weight, 0);
    const sum = on.reduce((s, c) => s + (crit[c.key]?.value as number) * c.weight, 0);
    value = clamp(sum / total + adjust);
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
    event_count: a.counted,
  };
}

/** `engine.score` trên từng dòng sổ (= gom TS rồi `scoreAgg`). */
export function score(events: readonly Ev[], cfg: Cfg, at: ScoreAt): ScoreOut {
  return scoreAgg(aggregate(events, windowOf(cfg.rules, at.today), at.role), cfg, at);
}
