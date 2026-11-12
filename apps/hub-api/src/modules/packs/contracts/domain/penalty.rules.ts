// CR-127 · X4 · spec §6 "Phạt", BR-56 — luật THUẦN (không DB, không giờ): phạt ước tính của một mốc trễ theo điều khoản AI trích (`penalty_terms`).
// Ước tính chỉ để người phụ trách tham khảo (không lưu, không tự trừ tiền); quyết định thật (Ghi vào công nợ / Miễn phạt) ở `penalty.usecase`.
// Số nguyên đồng, làm tròn xuống; tỷ lệ tính bằng BigInt (rate 4 số lẻ ⇒ không sai số số thực).
import { daysBetween } from "./exec-request.rules";

export type PenaltyTerm = {
  id: string;
  /** Bên PHẠT: `ours` = mình bị phạt (mình trễ), `partner` = đối tác bị phạt. */
  party: "ours" | "partner";
  trigger: "late_delivery" | "late_payment" | "other";
  rate_pct: number | null;
  basis: "per_day_of_value" | "per_day_of_milestone" | "fixed";
  cap_pct: number | null;
  cap_amount: number | null;
};
export type LateMilestone = {
  kind: string;
  /** Việc của ai (bên phải làm mốc) = bên trễ. */
  owner: "ours" | "partner";
  status: string;
  due_date: string;
  done_at: string | null;
  amount: number | null;
};
export type PenaltyEstimate = {
  term_id: string;
  basis: PenaltyTerm["basis"];
  days: number;
  /** Số tiền sau trần (đồng). */
  amount: number;
  /** Số tiền trước trần. */
  uncapped: number;
  /** Trần áp dụng (đồng); null ⇒ không có trần. */
  cap: number | null;
  capped: boolean;
  /** `receive`: đối tác trễ ⇒ mình được phạt (thu); `pay`: mình trễ ⇒ mình chịu (trả). */
  direction: "receive" | "pay";
};

/** Trần số tiền một dòng công nợ (khớp `MoneySchema` của sổ: ≤ 10^15). */
export const PENALTY_MAX = 1_000_000_000_000_000;

/** Mốc còn tính phạt? (đang mở hoặc đã xong, không phải mốc phạt). */
export const penaltyApplies = (m: Pick<LateMilestone, "kind" | "status">): boolean =>
  m.kind !== "penalty" && (m.status === "open" || m.status === "done");

/** Số ngày trễ: mốc đang mở ⇒ tới `today`; mốc đã xong ⇒ tới ngày xong. Không trễ ⇒ 0. */
export function lateDays(m: LateMilestone, today: string): number {
  if (!penaltyApplies(m)) return 0;
  const end = m.status === "done" ? (m.done_at ?? m.due_date) : today;
  return Math.max(0, daysBetween(m.due_date, end));
}

const TRIGGER_OF: Record<string, PenaltyTerm["trigger"]> = {
  delivery: "late_delivery",
  payment: "late_payment",
};

/** Điều khoản áp cho mốc: đúng bên bị phạt; ưu tiên đúng loại (giao/thanh toán), kế đó `other`. Nhiều điều khoản cùng bậc ⇒ cái đứng trước. */
export function termFor(terms: readonly PenaltyTerm[], m: LateMilestone): PenaltyTerm | null {
  const own = terms.filter((t) => t.party === m.owner);
  const exact = TRIGGER_OF[m.kind];
  return (
    (exact ? own.find((t) => t.trigger === exact) : undefined) ??
    own.find((t) => t.trigger === "other") ??
    null
  );
}

/** `base × pct% × mult` làm tròn xuống, pct 4 số lẻ. */
function pctOf(base: number, pct: number, mult: number): number {
  const bp = BigInt(Math.round(pct * 10_000));
  const v = (BigInt(Math.trunc(base)) * bp * BigInt(Math.trunc(mult))) / 1_000_000n;
  return v > BigInt(PENALTY_MAX) ? PENALTY_MAX : Number(v);
}

/** Số tiền trước trần + trần của một điều khoản; null ⇒ thiếu cơ sở tính. */
function raw(
  term: PenaltyTerm,
  base: number | null,
  days: number,
): { uncapped: number; cap: number | null } | null {
  if (term.basis === "fixed")
    return term.cap_amount === null ? null : { uncapped: term.cap_amount, cap: term.cap_amount };
  if (term.rate_pct === null || !base || base <= 0) return null;
  const capPct = term.cap_pct === null ? null : pctOf(base, term.cap_pct, 1);
  const cap = capPct === null ? term.cap_amount : Math.min(term.cap_amount ?? capPct, capPct);
  return { uncapped: pctOf(base, term.rate_pct, days), cap };
}

/**
 * Phạt ước tính của MỘT mốc trễ. `contractValue` = giá trị HĐ (cơ sở `per_day_of_value`). null khi: không trễ, không có điều khoản, thiếu cơ sở
 * tính (mốc không có số tiền / HĐ không giá trị), hoặc kết quả 0.
 * - `per_day_of_value`: giá trị HĐ × tỷ lệ% × số ngày; `per_day_of_milestone`: số tiền mốc × tỷ lệ% × số ngày; `fixed`: mức cố định = `cap_amount`.
 * - Trần: `cap_pct` theo CÙNG cơ sở với cách tính, `cap_amount` tuyệt đối; có cả hai ⇒ lấy số nhỏ hơn.
 */
export function penaltyEstimate(
  terms: readonly PenaltyTerm[],
  m: LateMilestone,
  contractValue: number | null,
  today: string,
): PenaltyEstimate | null {
  const days = lateDays(m, today);
  const term = days > 0 ? termFor(terms, m) : null;
  if (!term) return null;
  const r = raw(term, term.basis === "per_day_of_value" ? contractValue : m.amount, days);
  if (!r) return null;
  const amount = r.cap === null ? r.uncapped : Math.min(r.uncapped, r.cap);
  if (amount <= 0) return null;
  return {
    term_id: term.id,
    basis: term.basis,
    days,
    amount,
    uncapped: r.uncapped,
    cap: r.cap,
    capped: amount < r.uncapped,
    direction: m.owner === "partner" ? "receive" : "pay",
  };
}

/** Vì sao KHÔNG có phạt ước tính (gọi khi `penaltyEstimate` = null): chưa trễ / chưa có điều khoản khớp / điều khoản thiếu số (tỷ lệ, mức cố định, hoặc mốc/HĐ không có số tiền làm cơ sở). */
export type NoEstimateReason = "not_late" | "no_term" | "missing_amount";
export function noEstimateReason(
  terms: readonly PenaltyTerm[],
  m: LateMilestone,
  today: string,
): NoEstimateReason {
  if (lateDays(m, today) === 0) return "not_late";
  return termFor(terms, m) ? "missing_amount" : "no_term";
}
