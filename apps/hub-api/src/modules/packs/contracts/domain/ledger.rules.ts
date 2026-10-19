// HD7-FR-01…09 · HD7 plan §2 · D7-04 · D7-16: luật thuần của sổ thanh toán — port `mgmt-app/api/app/ledger/obligations.py`
// (`counterparty`, `settle`, `undo`), `overdue.py` (`sweep`), `contracts/schedule.py::_sane`. Lớp 1: không I/O, không đồng hồ.
// Tiền = số nguyên đồng (≤ 10¹⁵, an toàn JS — không phép chia/nhân thực); ngày = chuỗi `YYYY-MM-DD` (lịch thuần, HD4 `local-time`).
import { foldVi } from "./fold.rules";
import { addDays, daysBetween } from "./local-time.rules";

/** Trần tiền một đợt/sự kiện (bigint đồng, = CHECK của migration 0008). */
export const MONEY_MAX = 1_000_000_000_000_000;
export const OBLIGATION_KINDS = ["payment", "delivery"] as const;
export type ObligationKind = (typeof OBLIGATION_KINDS)[number];
export type Direction = "pay" | "receive";
export type PartnerRole = "customer" | "supplier";
export type ObligationStatus = "open" | "done" | "cancelled" | "replaced";

/** Đối tác = `tax:<chữ số MST>` | `name:<fold(tên)>` | null (≡ SQL `contracts.party_key`). */
export function partyKey(
  name: string | null | undefined,
  tax: string | null | undefined,
): string | null {
  const digits = (tax ?? "").replace(/[^0-9]/g, "");
  if (digits) return `tax:${digits}`;
  const f = foldVi(name ?? "");
  return f ? `name:${f}` : null;
}

export type PartyFields = {
  buyer_name?: string | null;
  buyer_tax_id?: string | null;
  supplier_name?: string | null;
  supplier_tax_id?: string | null;
};
/** `obligations.counterparty`: bán ⇒ bên mua trả mình (receive, khách hàng); còn lại ⇒ mình trả bên bán (pay, NCC). */
export function counterparty(direction: string | null, f: PartyFields) {
  const sale = direction === "sale";
  const name = (sale ? f.buyer_name : f.supplier_name) ?? null;
  const tax = (sale ? f.buyer_tax_id : f.supplier_tax_id) ?? null;
  return {
    party: partyKey(name, tax),
    direction: (sale ? "receive" : "pay") as Direction,
    role: (sale ? "customer" : "supplier") as PartnerRole,
    name,
  };
}

export const roleOf = (d: Direction): PartnerRole => (d === "receive" ? "customer" : "supplier");

/** Trễ bao nhiêu ngày khi xong ngày `at` cho hạn `due`: max(0, at − due). */
export const daysLate = (at: string, due: string): number => Math.max(0, daysBetween(due, at));

/** Loại sự kiện khi xong đợt: giao hàng ⇒ delivered; thu ⇒ received; trả ⇒ paid. */
export function settledType(kind: ObligationKind, d: Direction): "delivered" | "received" | "paid" {
  if (kind === "delivery") return "delivered";
  return d === "receive" ? "received" : "paid";
}

/** `overdue.sweep`: dòng ghi ngày hạn + 1; lỗi của đối tác khi khách nợ tiền hoặc NCC nợ hàng (mình trễ ⇒ không tính họ). */
export function overdueOf(o: { due_date: string; direction: Direction; kind: ObligationKind }) {
  const receive = o.direction === "receive";
  return {
    at: addDays(o.due_date, 1),
    role: roleOf(o.direction),
    party_late: (receive && o.kind === "payment") || (!receive && o.kind === "delivery"),
  };
}

export type UndoEvent = { type: string; was?: string | null; to?: string | null };
export type UndoTarget = {
  status: ObligationStatus | "open" | "done";
  due_date: string;
  postpones: number;
  reminders: number;
};
export type UndoPatch =
  | { reopen: true }
  | { due_date: string; postpones: number; clearPostponed: boolean }
  | { reminders: number };

/** `obligations.undo`: sự kiện bị huỷ hoàn lại việc nó làm với đợt — chỉ khi đợt vẫn như lúc nó để lại; khác ⇒ null. */
export function undoOf(e: UndoEvent, ob: UndoTarget): UndoPatch | null {
  if (["paid", "received", "delivered"].includes(e.type))
    return ob.status === "done" ? { reopen: true } : null;
  if (e.type === "postponed") {
    if (!e.was || ob.status === "done" || ob.due_date !== e.to) return null;
    const n = Math.max(0, ob.postpones - 1);
    return { due_date: e.was, postpones: n, clearPostponed: n === 0 };
  }
  if (e.type === "reminded") return { reminders: Math.max(0, ob.reminders - 1) };
  return null;
}

const ISO = /^(\d{4})-(\d{2})-(\d{2})$/;
/** Ngày lịch có thật (năm ≥ 1, tháng/ngày hợp lệ, năm nhuận) — như `date.fromisoformat`. */
export function isIsoDate(s: string): boolean {
  const m = ISO.exec(s);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (y < 1 || mo < 1 || mo > 12 || d < 1) return false;
  return d <= new Date(Date.UTC(y, mo, 0)).getUTCDate(); // ngày 0 của tháng sau = ngày cuối tháng `mo`
}

/** `schedule._sane`: lịch AI đọc chỉ được tin khi mọi ngày hợp lệ, mọi tiền > 0 và tổng lệch giá trị ≤ max(1000, giá trị // 1000). */
export function saneSchedule(
  plan: readonly { due_date: string; amount: number }[],
  total: number | null | undefined,
): boolean {
  if (!plan.length || !total) return false;
  if (!plan.every((i) => isIsoDate(i.due_date))) return false;
  if (!plan.every((i) => Number.isSafeInteger(i.amount) && i.amount > 0)) return false;
  const sum = plan.reduce((s, i) => s + BigInt(i.amount), 0n);
  const t = BigInt(total);
  const diff = sum > t ? sum - t : t - sum;
  const tol = t / 1000n > 1000n ? t / 1000n : 1000n; // chia nguyên như `//` (t > 0)
  return diff <= tol;
}
