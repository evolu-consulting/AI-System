// ADM-FR-04, ADM-FR-01 · định dạng giờ/ngày hiển thị (giờ trình duyệt, 24h).

export type Translate = (key: string, params?: Record<string, string | number>) => string;

const pad = (n: number) => String(n).padStart(2, "0");
const MINUTE = 60_000;

/** `HH:MM` theo giờ địa phương. */
export function formatClock(value: Date | string | number): string {
  const d = new Date(value);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function startOfDay(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

/**
 * "Đăng nhập gần nhất": Vừa xong (< 1 phút) / {n} phút trước (< 60) / Hôm nay HH:MM / Hôm qua HH:MM / dd/MM/yyyy.
 * `iso` rỗng → chuỗi rỗng (nơi gọi hiển thị badge "Chưa đăng nhập").
 */
export function formatLastLogin(iso: string | null, now: Date, t: Translate): string {
  if (!iso) return "";
  const at = new Date(iso);
  const diff = now.getTime() - at.getTime();
  if (diff < MINUTE) return t("format.lastLogin.now");
  if (diff < 60 * MINUTE) return t("format.lastLogin.minutes", { n: Math.floor(diff / MINUTE) });
  const time = formatClock(at);
  const today = startOfDay(now);
  const day = startOfDay(at);
  if (day === today) return t("format.lastLogin.today", { time });
  // Lùi 12 giờ từ 00:00 hôm nay để tránh lệch khi ngày có giờ mùa hè.
  if (day === startOfDay(new Date(today - 12 * 60 * MINUTE))) {
    return t("format.lastLogin.yesterday", { time });
  }
  return `${pad(at.getDate())}/${pad(at.getMonth() + 1)}/${at.getFullYear()}`;
}
