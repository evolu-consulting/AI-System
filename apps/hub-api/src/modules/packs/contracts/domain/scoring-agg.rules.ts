// HD8-FR-02 · HD8-NFR-01: đầu vào engine điểm uy tín đã GOM theo (đối tác, vai) — bản TS chuẩn của câu gom SQL (`partners-data.repo.ts`).
// Engine mgmt (`engine.py`) chỉ dùng: đếm/tổng theo loại trong khoảng tính, tách "gần đây" (trọng số 2) và "cũ" (1); đợt quá hạn treo;
// lần chấm tay mới nhất mỗi tiêu chí. Mọi tổng có trọng số là tổng số NGUYÊN (1/2 × số ngày) ⇒ cộng theo thứ tự nào cũng ra cùng
// số double ⇒ gom trước rồi tính ≡ tính trên từng dòng (test parity ngẫu nhiên SQL ↔ TS ở `HD8/agg-parity.int.test.ts`).

import { pyRound } from "../cks/domain/prices.rules";
import { isIsoDate } from "./ledger.rules";
import { addDays, daysBetween } from "./local-time.rules";
import type { Role } from "./scoring-config.rules";

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
  /** Giá trị JSON tuỳ ý (sổ cũ có chuỗi) — đọc theo truthiness của Python như mgmt `e.get("with_us", True)`. */
  with_us?: unknown;
  by?: string | null;
};
/** `bool(x)` của Python trên giá trị JSON: false/null/0/""/[]/{} ⇒ sai; còn lại (kể cả chuỗi "false") ⇒ đúng. */
export function pyTruthy(v: unknown): boolean {
  if (Array.isArray(v)) return v.length > 0;
  if (v !== null && typeof v === "object") return Object.keys(v).length > 0;
  return Boolean(v);
}
/** Một nhóm dòng trễ/đúng hạn: số dòng, số dòng đúng hạn, tổng ngày trễ. */
export type Bucket = { n: number; on: number; late: number };
export type Rated = { value: number; at: string; by: string | null };
export type Agg = {
  /** Dòng đã xong của vai (khách: `received`, NCC: `delivered`) — [cũ, gần đây]. */
  set: [Bucket, Bucket];
  /** Dòng "Quá hạn" chưa ai trả lời, đúng loại của vai — [cũ, gần đây]; ngày trễ = max(1, hôm nay − hạn). */
  pend: [Bucket, Bucket];
  renew_n: number;
  renew_sum: number;
  reminded: number;
  dealings: boolean;
  kept: number;
  missed: number;
  postponed: number;
  complaints: number;
  adjust: number;
  counted: number;
  rated: Record<string, Rated>;
};
/** Ranh giới khoảng tính của một vai: `start` ≤ at ≤ `today`; `recent` = mốc "gần đây". */
export type Window = { start: string; recent: string; today: string };

const SETTLED = new Set(["paid", "received", "delivered"]);
const NOT_COUNTED = new Set(["manual_adjust", "rating", "overdue"]);
const DEALINGS = new Set(["received", "paid", "delivered", "postponed", "reminded"]);

/** `window_start` + mốc gần đây (`round(m × 30,44)` ngày, `round` của Python). */
export const windowOf = (
  r: { window_months: number; recency_months: number },
  today: string,
): Window => ({
  start: addDays(today, -pyRound(r.window_months * 30.44)),
  recent: addDays(today, -pyRound(r.recency_months * 30.44)),
  today,
});

export const emptyBucket = (): Bucket => ({ n: 0, on: 0, late: 0 });
export const emptyAgg = (): Agg => ({
  set: [emptyBucket(), emptyBucket()],
  pend: [emptyBucket(), emptyBucket()],
  renew_n: 0,
  renew_sum: 0,
  reminded: 0,
  dealings: false,
  kept: 0,
  missed: 0,
  postponed: 0,
  complaints: 0,
  adjust: 0,
  counted: 0,
  rated: {},
});

/** Điểm một lần gia hạn CKS (`engine._criteria`): mất/không qua mình 0; đúng hạn 100; trễ trừ 10/ngày. */
export function renewValue(e: Ev): number {
  if (e.type === "cks_lapsed" || !pyTruthy(e.with_us === undefined ? true : e.with_us)) return 0;
  const d = e.days_before_expiry || 0;
  return d >= 0 ? 100 : Math.max(0, 100 + 10 * d);
}

/** Dòng "Quá hạn" chưa được trả lời (`_pending_overdue`) trong cùng nhóm (đối tác, vai). */
function pending(win: readonly Ev[]): Ev[] {
  const settled = new Set(
    win.filter((e) => SETTLED.has(e.type)).map((e) => e.obligation_id ?? null),
  );
  const moved = win.filter((e) => e.type === "postponed");
  return win.filter(
    (e) =>
      e.type === "overdue" &&
      e.party_late &&
      !settled.has(e.obligation_id ?? null) &&
      !moved.some((m) => (m.obligation_id ?? null) === (e.obligation_id ?? null) && m.at >= e.at),
  );
}

function addRow(b: Bucket, late: number | null | undefined): void {
  b.n += 1;
  if (!late) b.on += 1;
  b.late += late || 0;
}

/** `_rated`: lần chấm mới nhất theo (`at`, `rated_at`); trùng cả hai ⇒ dòng sau (sort ổn định của Python). */
function laterRating(had: Ev | undefined, e: Ev): boolean {
  if (!had) return true;
  if (e.at !== had.at) return e.at > had.at;
  return (e.rated_at ?? "") >= (had.rated_at ?? "");
}
function countType(a: Agg, e: Ev): void {
  if (DEALINGS.has(e.type)) a.dealings = true;
  if (e.type === "reminded") a.reminded += 1;
  else if (e.type === "appointment_kept") a.kept += 1;
  else if (e.type === "appointment_missed") a.missed += 1;
  else if (e.type === "complaint") a.complaints += 1;
  if (e.type === "postponed") a.postponed += 1;
  if (e.type === "manual_adjust") a.adjust += e.delta || 0;
  if (e.type === "cks_renewed" || e.type === "cks_lapsed") {
    a.renew_n += 1;
    a.renew_sum += renewValue(e);
  }
}

/** Dòng quá hạn treo đúng loại của vai (khách: không phải giao hàng; NCC: giao hàng); trễ = max(1, hôm nay − hạn). */
function addPending(a: Agg, win: readonly Ev[], w: Window, role: Role): void {
  for (const e of pending(win)) {
    if ((role === "supplier") !== (e.kind === "delivery")) continue;
    const b = a.pend[e.at >= w.recent ? 1 : 0] as Bucket;
    b.n += 1;
    // hạn thiếu/sai dạng ⇒ trễ 1 ngày (≡ SQL `greatest(1, null)`; review HD78 #5 — trước ra NaN)
    b.late +=
      e.due_date && isIsoDate(e.due_date) ? Math.max(1, daysBetween(e.due_date, w.today)) : 1;
  }
}

/** Gom dòng sổ của MỘT (đối tác, vai) theo khoảng tính — định nghĩa chuẩn mà câu SQL phải khớp. */
export function aggregate(events: readonly Ev[], w: Window, role: Role): Agg {
  const a = emptyAgg();
  const win = events.filter((e) => !e.voided && e.at >= w.start && e.at <= w.today);
  const own = role === "customer" ? "received" : "delivered";
  const ratings = new Map<string, Ev>();
  for (const e of win) {
    const i = e.at >= w.recent ? 1 : 0;
    if (!NOT_COUNTED.has(e.type)) a.counted += 1;
    if (e.type === own) addRow(a.set[i] as Bucket, e.days_late);
    if (e.type === "rating" && laterRating(ratings.get(e.criterion as string), e))
      ratings.set(e.criterion as string, e);
    countType(a, e);
  }
  addPending(a, win, w, role);
  for (const [k, e] of ratings)
    a.rated[k] = { value: e.value as number, at: e.at, by: e.by ?? null };
  return a;
}

/** Một nhóm SQL (đối tác, vai, loại, gần đây): số dòng, số đúng hạn (trễ 0/null), tổng ngày trễ, tổng chỉnh tay. */
export type Group = {
  type: string;
  nw: boolean;
  n: number;
  on: number;
  late: number;
  delta: number;
};

/**
 * Cộng một nhóm vào `Agg` — đúng như `aggregate()` cộng từng dòng (trừ chấm tay, quá hạn, gia hạn CKS: đi đường riêng). Mọi tổng là
 * số nguyên ⇒ cộng theo nhóm ≡ cộng theo dòng.
 */
export function addGroup(a: Agg, g: Group, role: Role): void {
  if (g.type === (role === "customer" ? "received" : "delivered")) {
    const b = a.set[g.nw ? 1 : 0] as Bucket;
    b.n += g.n;
    b.on += g.on;
    b.late += g.late;
  }
  if (!NOT_COUNTED.has(g.type)) a.counted += g.n;
  if (DEALINGS.has(g.type) && g.n > 0) a.dealings = true;
  if (g.type === "reminded") a.reminded += g.n;
  else if (g.type === "appointment_kept") a.kept += g.n;
  else if (g.type === "appointment_missed") a.missed += g.n;
  else if (g.type === "complaint") a.complaints += g.n;
  else if (g.type === "postponed") a.postponed += g.n;
  else if (g.type === "manual_adjust") a.adjust += g.delta;
}
