// CR-127 · U5 · ngày dùng chung của màn HĐ (thay `contract-deadline/lib/deadline.ts` đã gỡ): hôm nay theo giờ máy người xem + số ngày chênh.
export const todayIso = (now = new Date()): string =>
  `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;

/** Số ngày từ `today` tới `iso` (âm = đã qua); thiếu ngày ⇒ null. */
export function daysUntil(iso: string | null, today: string): number | null {
  if (!iso) return null;
  return Math.round(
    (Date.parse(`${iso}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000,
  );
}
