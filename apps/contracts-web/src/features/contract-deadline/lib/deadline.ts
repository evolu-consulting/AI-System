// HD4-FR-02 · HD4-AC08: luật trình bày thẻ hạn chót (port cm-web `ui.tsx:92-105` `Deadline`). Thuần, `today` truyền vào.
import type { ContractDetail } from "@ai/contracts";

export const HANDLED_OUTCOMES = ["renewed", "not_renewed", "negotiating", "replaced"] as const;
export type Outcome = (typeof HANDLED_OUTCOMES)[number];
const CONFIRMED = new Set(["active", "expiring", "expired", "renewed", "terminated"]);

/** Thẻ chỉ hiện với HĐ đã duyệt (mgmt-app `confirmed && <Card>`). */
export const showsDeadline = (c: Pick<ContractDetail, "status" | "kind">): boolean =>
  c.kind === "contract" && CONFIRMED.has(c.status);

/** Ngày hôm nay `YYYY-MM-DD` theo giờ máy người xem (như mgmt-app `daysUntil`). */
export const todayIso = (now = new Date()): string =>
  `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;

export function daysUntil(iso: string | null, today: string): number | null {
  if (!iso) return null;
  return Math.round(
    (Date.parse(`${iso}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000,
  );
}

export const viDate = (iso: string): string => iso.split("-").reverse().join("/");

/** Khoá i18n + tông cho "còn N ngày" (quá hạn đỏ, ≤ 30 vàng, còn lại mờ). */
export function leftOf(left: number): {
  key: "overdue" | "today" | "left";
  n: number;
  tone: string;
} {
  if (left < 0) return { key: "overdue", n: -left, tone: "text-late" };
  if (left === 0) return { key: "today", n: 0, tone: "text-soon" };
  return { key: "left", n: left, tone: left <= 30 ? "text-soon" : "font-normal text-dim" };
}
