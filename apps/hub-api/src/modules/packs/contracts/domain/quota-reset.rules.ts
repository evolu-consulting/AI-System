// HD-FR-08 · D-06 · plan §1 (`UPLOAD_QUOTA.details.resets_at`): thời điểm bộ đếm ngày được làm mới = 00:00 ngày kế theo múi
// `timeZone` (tenant: múi tenant; toàn hệ thống: UTC). Thuần (Intl, không phụ thuộc TZ tiến trình).
import { uploadDay } from "./upload.rules";

const fmts = new Map<string, Intl.DateTimeFormat>();
function fmt(timeZone: string): Intl.DateTimeFormat {
  let f = fmts.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    fmts.set(timeZone, f);
  }
  return f;
}

/** Lệch (ms) của `timeZone` so với UTC tại thời điểm `atMs` (giờ tường − UTC). */
function offsetMs(atMs: number, timeZone: string): number {
  const parts = fmt(timeZone).formatToParts(new Date(atMs));
  const n = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  const wall = Date.UTC(n("year"), n("month") - 1, n("day"), n("hour"), n("minute"), n("second"));
  return wall - Math.floor(atMs / 1000) * 1000;
}

/** 00:00 của ngày kế (theo `uploadDay(now, timeZone)`) ở múi `timeZone`, dạng `Date` UTC. */
export function nextDayStart(now: Date, timeZone: string): Date {
  const [y, m, d] = uploadDay(now, timeZone).split("-").map(Number) as [number, number, number];
  const wall = Date.UTC(y, m - 1, d + 1);
  const first = wall - offsetMs(wall, timeZone);
  return new Date(wall - offsetMs(first, timeZone));
}
