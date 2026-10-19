// W1 · "Việc của tôi" · luật thuần của màn (port thẻ đầu trợ lý mgmt-app `digest.py`: "Trễ n ngày / Hôm nay / Còn n ngày", "Khách hẹn
// lại" gợi ý +7 ngày, "Nhắc lại sau" gợi ý 09:00 ngày mai). Không đọc đồng hồ: ngày "hôm nay" do máy chủ trả về (`today`).
import type { MyWorkItem, MyWorkKind } from "@ai/contracts";
import { ApiError } from "@ai/web-kit/http";

type T = (key: string, o?: Record<string, unknown>) => string;

export const FILTERS = ["all", "followup", "obligation", "deadline", "reminder"] as const;
export type Filter = (typeof FILTERS)[number];

export const GROUPS = ["late", "today", "upcoming"] as const;
export type Group = (typeof GROUPS)[number];
export const groupOf = (i: Pick<MyWorkItem, "days">): Group =>
  i.days > 0 ? "late" : i.days === 0 ? "today" : "upcoming";

/** `YYYY-MM-DD` + n ngày (lịch thuần, không dính múi giờ máy). */
export function addDays(iso: string, n: number): string {
  const [y, m, d] = iso.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

export const filterItems = (items: readonly MyWorkItem[], f: Filter): MyWorkItem[] =>
  f === "all" ? [...items] : items.filter((i) => i.kind === f);

export function countByKind(items: readonly MyWorkItem[]): Record<Filter, number> {
  const n: Record<Filter, number> = {
    all: items.length,
    followup: 0,
    obligation: 0,
    deadline: 0,
    reminder: 0,
  };
  for (const i of items) n[i.kind as MyWorkKind] += 1;
  return n;
}

/** Nhãn mức gấp: key i18n + số ngày. */
export function whenOf(i: Pick<MyWorkItem, "days">): { key: "late" | "today" | "left"; n: number } {
  if (i.days > 0) return { key: "late", n: i.days };
  return i.days === 0 ? { key: "today", n: 0 } : { key: "left", n: -i.days };
}

/** Khoá i18n tiêu đề một việc (`contracts.work.title.<key>`). */
export function titleKey(
  i: Pick<MyWorkItem, "kind" | "direction" | "subject" | "customer_id">,
): string {
  if (i.kind === "obligation") return i.direction === "receive" ? "receive" : "pay";
  if (i.kind === "followup") {
    if (!i.customer_id) return "followupGeneric"; // hẹn nhắc chung: tiêu đề do máy chủ đặt
    return i.subject === "renewal" ? "followupRenewal" : "followupCustomer";
  }
  return i.kind;
}

/** "Khách hẹn lại": mặc định 7 ngày sau hạn hiện tại hoặc sau hôm nay (cái nào muộn hơn) — `digest.py: later`. */
export const defaultPostpone = (i: Pick<MyWorkItem, "due">, today: string): string =>
  addDays(i.due > today ? i.due : today, 7);

/** "Nhắc lại sau": 09:00 ngày mai theo giờ tenant (`digest.py: tomorrow`). */
export const defaultSnooze = (today: string): string => `${addDays(today, 1)}T09:00`;

/** Ngày hẹn mới phải sau hạn hiện tại (máy chủ cũng kiểm — 422 `POSTPONE_DATE`). */
export const postponeOk = (to: string, i: Pick<MyWorkItem, "due">): boolean =>
  /^\d{4}-\d{2}-\d{2}$/.test(to) && to > i.due;

/** `YYYY-MM-DDTHH:mm` hợp lệ (giờ 00–23, phút 00–59). */
export const snoozeOk = (v: string): boolean =>
  /^\d{4}-\d{2}-\d{2}T([01]\d|2[0-3]):[0-5]\d$/.test(v);

/** "2026-10-20T08:30" → "08:30 20/10". */
export const atLabel = (at: string): string =>
  `${at.slice(11, 16)} ${at.slice(8, 10)}/${at.slice(5, 7)}`;

const KNOWN = new Set([
  "OBLIGATION_DONE",
  "POSTPONE_DATE",
  "CONTRACT_NOT_CONFIRMED",
  "VALIDATION_ERROR",
  "NOT_FOUND",
  "PACK_FORBIDDEN",
]);
/** Câu lỗi theo mã API (không hiện thông điệp thô của máy chủ); mất mạng / khác ⇒ câu chung. */
export function workErrorText(e: unknown, t: T): string {
  if (e instanceof ApiError) {
    if (KNOWN.has(e.code)) return t(`contracts.work.errors.${e.code}`);
    if (e.code === "NETWORK_ERROR") return t("contracts.errors.network");
  }
  return t("contracts.errors.unknown");
}
