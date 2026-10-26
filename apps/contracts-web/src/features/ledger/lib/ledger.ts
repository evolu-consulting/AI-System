// HD7-FR-12 · luật thuần của khối "Ghi việc" — port `mgmt-app/web/src/pages/partners/PartnerLog.tsx:14-41,70-75`: câu đọc một dòng
// sổ (`said`), dòng "Quá hạn" đã được trả lời, 15 dòng gần nhất, việc khác theo vai, số ngày trễ khi ghi.
import { type PartnerEvent, type PartnerRole, SEVERE_EVENT_TYPES } from "@ai/contracts";
import { vnd } from "~/components/shared/format";
import { todayIso } from "~/features/contract-deadline/lib/deadline";

type T = (k: string, o?: Record<string, unknown>) => string;
const viDate = (iso: string) => iso.slice(0, 10).split("-").reverse().join("/");

/** Ngày lịch hôm nay của máy (mgmt `dayPlus(0)`). */
export const today = (): string => todayIso();

/** Việc khác ngoài đợt: loại, vai được ghi, có hỏi số ngày trễ không. */
export const OTHER: { type: string; roles: PartnerRole[]; late?: boolean }[] = [
  { type: "delivered", roles: ["supplier"], late: true },
  { type: "complaint", roles: ["customer", "supplier"] },
  { type: "appointment_kept", roles: ["customer", "supplier"] },
  { type: "appointment_missed", roles: ["customer", "supplier"] },
];
export const otherKinds = (role: PartnerRole) => OTHER.filter((k) => k.roles.includes(role));

const WORDS = new Set([
  "received",
  "paid",
  "delivered",
  "postponed",
  "reminded",
  "complaint",
  "appointment_kept",
  "appointment_missed",
  "cks_renewed",
  "cks_lapsed",
  "manual_adjust",
  "rating",
  "no_delivery",
  "fraud",
]);

/** U2 · R39: việc nghiêm trọng (cờ đỏ) — gỡ chỉ quản lý. */
export const isSevere = (type: string): boolean =>
  (SEVERE_EVENT_TYPES as readonly string[]).includes(type);

/** `said`: một dòng sổ đọc thành câu (dòng quá hạn nói ai chưa trả/giao, đợt mấy, bao nhiêu, hạn ngày nào). */
export function said(e: PartnerEvent, t: T, answered = false): string {
  const L = (k: string, o?: Record<string, unknown>) => t(`contracts.ledger.${k}`, o);
  const money = e.amount ? L("money", { v: vnd(e.amount) }) : "";
  return e.type === "overdue" ? overdueSaid(e, L, money, answered) : plainSaid(e, L, money);
}

/** Dòng "Quá hạn": ai chưa trả/giao, đợt mấy, bao nhiêu, hạn ngày nào, đã xử lý chưa. */
function overdueSaid(e: PartnerEvent, L: T, money: string, answered: boolean): string {
  const who =
    e.party_late === false
      ? L("overdueWePay")
      : e.kind === "delivery"
        ? L("overdueNotDelivered")
        : L("overdueCustomer");
  return [
    `${L("overdue", { who })}${e.seq ? L("overdueSeq", { seq: e.seq }) : ""}`,
    money,
    e.due_date ? L("due", { date: viDate(e.due_date) }) : "",
    answered ? L("answered") : "",
  ]
    .filter(Boolean)
    .join(" · ");
}

function lateWord(e: PartnerEvent, L: T): string {
  if (e.days_late) return L("lateDays", { n: e.days_late });
  return e.days_late === 0 ? L("onTime") : "";
}

function plainSaid(e: PartnerEvent, L: T, money: string): string {
  const late = lateWord(e, L);
  return [
    WORDS.has(e.type) ? L(`word.${e.type}`) : e.type,
    e.type === "postponed" && e.to ? L("movedTo", { date: viDate(e.to) }) : "",
    ["received", "paid", "delivered"].includes(e.type) ? late : "",
    money,
    e.type === "rating" && e.value != null ? L("ratingValue", { v: e.value }) : "",
  ]
    .filter(Boolean)
    .join(" · ");
}

/** Dòng "Quá hạn" được coi là đã xử lý khi đợt của nó đã thu/trả/giao hoặc được hẹn lại (chưa huỷ). */
export function answeredSet(all: readonly PartnerEvent[]): Set<string | null> {
  return new Set(
    all
      .filter((e) => !e.voided && ["received", "paid", "delivered", "postponed"].includes(e.type))
      .map((e) => e.obligation_id),
  );
}

/** 15 dòng mới nhất; trên trang HĐ chỉ dòng của HĐ đó hoặc không gắn HĐ. */
export function recentOf(all: readonly PartnerEvent[], contractId?: string): PartnerEvent[] {
  return all
    .filter((e) => !contractId || e.contract_id === contractId || !e.contract_id)
    .slice()
    .reverse()
    .slice(0, 15);
}

/** Có nút Huỷ: người ghi được, chưa huỷ, không phải dòng hệ thống / chấm điểm / CKS; cờ đỏ chỉ quản lý (`admin`). */
export const voidable = (e: PartnerEvent, write: boolean, admin = false) =>
  write &&
  !e.voided &&
  e.source !== "system" &&
  e.type !== "rating" &&
  !e.type.startsWith("cks_") &&
  (!isSevere(e.type) || admin);

/** "trễ N ngày" khi ghi trả: số ngày từ hạn tới ngày trả (mgmt làm tròn theo 86 400 000 ms). */
export const lateBy = (at: string, due: string): number =>
  Math.round((Date.parse(at) - Date.parse(due)) / 864e5);

/** Lỗi API ⇒ câu tiếng Việt theo mã; lạ ⇒ câu chung. */
export const LEDGER_ERRORS = [
  "OBLIGATION_DONE",
  "POSTPONE_DATE",
  "EVENT_SYSTEM",
  "EVENT_TYPE",
  "ADJUST_INVALID",
  "SEVERE_REASON",
  "PACK_FORBIDDEN",
  "NOT_FOUND",
];
