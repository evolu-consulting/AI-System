// HD4-FR-01…03 · HD4-FR-07 · D4-03 · D4-06: hạn chót, trạng thái theo ngày, mốc nhắc và nội dung nhắc — port `remind.py`
// (`status_for`, `due`, `_message`) + `project.py:56-61` (`compute_deadline`). Thuần, lớp 1: không đọc đồng hồ (`now`, `tz` truyền vào).
import { addDays, atLocal, daysBetween, localDate } from "./local-time.rules";
import type { ContractStatus } from "./status.rules";

/** Mốc nhắc (ngày trước hạn), lớn → nhỏ (intake câu 6, `settings.remind_days`). */
export const REMIND_MILESTONES = [60, 30, 7, 1, 0] as const;
/** Giờ nhắc ở múi tenant (`settings.remind_hour`). */
export const REMIND_TIME = "08:00";
/** Ngưỡng `expiring` = mốc lớn nhất (`max(milestones())`). */
export const EXPIRING_DAYS = REMIND_MILESTONES[0];
export const CONFIRMED_STATUSES: readonly ContractStatus[] = [
  "active",
  "expiring",
  "expired",
  "renewed",
  "terminated",
];
const NOTICE_MAX = 3650;

/** ≡ SQL `contracts.deadline_of`: `end_date − notice_days`; notice không phải số nguyên 0…3650 ⇒ 0; phụ lục/thiếu ngày ⇒ null. */
export function deadlineOf(kind: string, endDate: string | null, notice: unknown): string | null {
  if (kind !== "contract" || endDate === null) return null;
  const n =
    typeof notice === "number"
      ? notice
      : typeof notice === "string" && /^-?\d{1,18}$/.test(notice)
        ? Number(notice)
        : 0;
  return addDays(endDate, -(Number.isInteger(n) && n >= 0 && n <= NOTICE_MAX ? n : 0));
}

export type DateFacts = {
  status: ContractStatus;
  kind: string;
  outcome: string | null;
  endDate: string | null;
  deadline: string | null;
};

/** `status_for`: chỉ HĐ đã duyệt; còn lại giữ nguyên. */
export function statusOn(c: DateFacts, today: string): ContractStatus {
  if (c.kind !== "contract" || !CONFIRMED_STATUSES.includes(c.status)) return c.status;
  if (c.outcome === "renewed") return "renewed";
  if (c.outcome === "not_renewed" || c.outcome === "replaced") return "terminated";
  if (c.endDate !== null && today > c.endDate) return "expired";
  if (c.deadline !== null && daysBetween(today, c.deadline) <= EXPIRING_DAYS) return "expiring";
  return "active";
}

export type DueContract = DateFacts & {
  id: string;
  ownerUserId: string | null;
  number: string | null;
  direction: string | null;
  seller: string | null;
  buyer: string | null;
  value: number | null;
  autoRenew: boolean | null;
};
export type ReminderMsg = {
  milestone: number;
  deadline: string;
  userId: string;
  title: string;
  body: string;
  link: string;
};
export type ReminderPlan = {
  id: string;
  status: ContractStatus;
  changed: boolean;
  nextAt: Date | null;
  reminder: ReminderMsg | null;
};

const minDate = (xs: Date[]): Date | null =>
  xs.length ? xs.reduce((a, b) => (b.getTime() < a.getTime() ? b : a)) : null;

/** Một HĐ trong lô: trạng thái mới, mốc gửi (nhỏ nhất đã tới — `due()`), thời điểm việc kế tiếp (`remind_at`). */
export function planReminder(c: DueContract, now: Date, tz: string): ReminderPlan {
  const today = localDate(now, tz);
  const status = statusOn(c, today);
  const future: Date[] = [];
  const t = now.getTime();
  const later = (d: Date) => d.getTime() > t && future.push(d);
  const final = status === "renewed" || status === "terminated" || c.kind !== "contract";
  if (!final && CONFIRMED_STATUSES.includes(status)) {
    if (status === "active" && c.deadline)
      later(atLocal(addDays(c.deadline, -EXPIRING_DAYS), "00:00", tz));
    if (status !== "expired" && c.endDate) later(atLocal(addDays(c.endDate, 1), "00:00", tz));
  }
  let reminder: ReminderMsg | null = null;
  if (!final && c.outcome === null && c.ownerUserId && c.deadline) {
    const at = REMIND_MILESTONES.map(
      (m) => [m, atLocal(addDays(c.deadline as string, -m), REMIND_TIME, tz)] as const,
    );
    const reached = at.filter(([, d]) => d.getTime() <= t).map(([m]) => m);
    for (const [, d] of at) later(d);
    if (reached.length) {
      const m = Math.min(...reached);
      reminder = {
        milestone: m,
        deadline: c.deadline,
        userId: c.ownerUserId,
        ...messageOf(c, daysBetween(today, c.deadline)),
      };
    }
  }
  return { id: c.id, status, changed: status !== c.status, nextAt: minDate(future), reminder };
}

const cut = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
export const viDate = (iso: string | null) => (iso ? iso.split("-").reverse().join("/") : "—");
const money = (v: number | null) =>
  v === null ? "—" : `${String(Math.trunc(v)).replace(/\B(?=(\d{3})+(?!\d))/g, ".")} đ`;

/** `_partner`: bên mua của HĐ bán, bên bán của HĐ mua; chưa rõ phía ⇒ cả hai. */
export function partnerOf(c: Pick<DueContract, "direction" | "seller" | "buyer">): string {
  const s = c.seller || "—";
  const b = c.buyer || "—";
  return c.direction === "sale" ? b : c.direction === "purchase" ? s : `${s} → ${b}`;
}

/** `_message` (readiness #5: cắt độ dài theo CHECK `hub.notifications` — tiêu đề ≤ 200, thân ≤ 2000). */
export function messageOf(
  c: DueContract,
  left: number,
): { title: string; body: string; link: string } {
  const number = cut(c.number || "—", 80);
  const when = left < 0 ? `quá ${-left} ngày` : left === 0 ? "hôm nay" : `còn ${left} ngày`;
  const auto = c.autoRenew === null ? "—" : c.autoRenew ? "có" : "không";
  const title = cut(`Hợp đồng ${number} — hạn chót hành động ${viDate(c.deadline)}`, 200);
  const body = cut(
    `Hợp đồng ${number} với ${cut(partnerOf(c), 120)} cần được xử lý (${when}).\n` +
      `Hạn chót hành động: ${viDate(c.deadline)} (hết hạn ${viDate(c.endDate)}).\n` +
      `Tự động gia hạn: ${auto}. Giá trị: ${money(c.value)}.`,
    2000,
  );
  return { title, body, link: `/contracts/${c.id}` };
}
