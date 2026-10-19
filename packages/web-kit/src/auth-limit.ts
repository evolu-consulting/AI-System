// L1b (TECH-DEBT #224, L1) · đọc `details` lỗi giới hạn đăng nhập của admin-api cho câu báo trên trang Đăng nhập:
// 423 `TEMP_LOCKED {until}` ⇒ giờ mở khoá HH:MM (giờ trình duyệt); 429 `RATE_LIMITED {retry_after_s}` ⇒ số phút chờ.

const pad = (n: number) => String(n).padStart(2, "0");

/** `details.until` (ISO) ⇒ "HH:MM" giờ trình duyệt; thiếu/hỏng ⇒ null. */
export function lockUntilClock(details: unknown): string | null {
  const until = (details as { until?: unknown } | null | undefined)?.until;
  if (typeof until !== "string") return null;
  const d = new Date(until);
  return Number.isNaN(d.getTime()) ? null : `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Phút chờ (làm tròn lên, ≥ 1) từ `details.retry_after_s`, rồi header `Retry-After`; không có ⇒ `fallbackS`. */
export function retryMinutes(details: unknown, retryAfter?: number, fallbackS = 60): number {
  const raw = (details as { retry_after_s?: unknown } | null | undefined)?.retry_after_s;
  const s =
    typeof raw === "number" && Number.isFinite(raw) && raw > 0
      ? raw
      : retryAfter && retryAfter > 0
        ? retryAfter
        : fallbackS;
  return Math.max(1, Math.ceil(s / 60));
}
