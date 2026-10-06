// HUB-FR-72 · định dạng hiển thị dùng chung (giờ trình duyệt).
const pad = (n: number) => String(n).padStart(2, "0");

/** ISO → HH:MM giờ trình duyệt; không đọc được → chuỗi rỗng. */
export function formatClock(iso: unknown): string {
  if (typeof iso !== "string") return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
