// CR-127 K6 · BR-07 · spec §2.1: lịch tính lại HIỆU LỰC theo ngày (thay "hạn chót hành động" + chuông cứng HD4 — D6). Thuần, lớp 1:
// không đọc đồng hồ (`now`, `tz` truyền vào). Hiệu lực = `effectOf` (một nguồn, `effect.rules`); file này chỉ cho biết bao giờ phải tính lại
// (đầu ngày bắt đầu / ngày vào ngưỡng "Sắp hết hạn" / ngày sau hết hạn). Nhắc người dùng đi qua quy trình `contract.expiring` (E6/K6).
import { type ContractEffect, type EffectOutcome, effectOf, noticeDaysOf } from "./effect.rules";
import { addDays, atLocal, localDate } from "./local-time.rules";

export type DateFacts = {
  status: string;
  kind: string;
  outcome: EffectOutcome | null;
  startDate: string | null;
  endDate: string | null;
  /** Giá trị thô `fields.notice_days.value` (số / chuỗi số); sai/thiếu ⇒ 30 (`noticeDaysOf`). */
  noticeDays?: unknown;
};

/** Hiệu lực theo ngày — chỉ HĐ (không phụ lục) ở DONE; bản đã bị thay không vào lô (claim lọc `superseded_at is null`). */
export function effectOn(c: DateFacts, today: string): ContractEffect | null {
  if (c.kind !== "contract") return null;
  return effectOf({ ...c, superseded: false }, today);
}

export type DueContract = DateFacts & { id: string };
export type ReminderPlan = {
  id: string;
  /** Hiệu lực tính lại (ghi bằng `refresh_effect`, không ghi `status`). */
  effect: ContractEffect | null;
  /** Lần tính lại kế tiếp (đầu ngày địa phương); null = không còn việc (kết cục cuối / hết hạn / không DONE). */
  nextAt: Date | null;
};

const minDate = (xs: Date[]): Date | null =>
  xs.length ? xs.reduce((a, b) => (b.getTime() < a.getTime() ? b : a)) : null;

/** Một HĐ trong lô: hiệu lực hôm nay + thời điểm hiệu lực đổi kế tiếp (`remind_at`). */
export function planReminder(c: DueContract, now: Date, tz: string): ReminderPlan {
  const today = localDate(now, tz);
  const effect = effectOn(c, today);
  const final = effect === null || effect === "renewed" || effect === "terminated";
  const future: Date[] = [];
  const later = (day: string) => {
    const d = atLocal(day, "00:00", tz);
    if (d.getTime() > now.getTime()) future.push(d);
  };
  if (!final) {
    if (effect === "not_started" && c.startDate) later(c.startDate);
    if (effect !== "expired" && c.endDate) {
      later(addDays(c.endDate, -noticeDaysOf(c.noticeDays)));
      later(addDays(c.endDate, 1));
    }
  }
  return { id: c.id, effect, nextAt: minDate(future) };
}
