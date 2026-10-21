// HD4-FR-02 · HD4-FR-03 · ngày lịch / giờ tường theo múi IANA của tenant ⇒ instant UTC. Thuần, lớp 1 (Intl + Date.UTC), không đọc
// đồng hồ. Cùng thuật toán `processes/domain/timers/due-at.rules.ts` (module khác không import chéo — nợ gộp vào lib chung).
const DAY_MS = 86_400_000;
const fmts = new Map<string, Intl.DateTimeFormat>();
function fmt(tz: string): Intl.DateTimeFormat {
  let f = fmts.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    fmts.set(tz, f);
  }
  return f;
}
function wall(ms: number, tz: string) {
  const o: Record<string, number> = {};
  for (const p of fmt(tz).formatToParts(new Date(ms)))
    if (p.type !== "literal") o[p.type] = Number(p.value);
  return o as {
    year: number;
    month: number;
    day: number;
    hour: number;
    minute: number;
    second: number;
  };
}
function offsetAt(ms: number, tz: string): number {
  const p = wall(ms, tz);
  return (
    Date.UTC(p.year, p.month - 1, p.day, p.hour % 24, p.minute, p.second) -
    Math.floor(ms / 1000) * 1000
  );
}
const pad = (n: number, w = 2) => String(n).padStart(w, "0");

/** Ngày lịch `YYYY-MM-DD` của `now` ở múi `tz`. */
export function localDate(now: Date, tz: string): string {
  const p = wall(now.getTime(), tz);
  return `${pad(p.year, 4)}-${pad(p.month)}-${pad(p.day)}`;
}

/** Ngày + n ngày (lịch thuần). */
export function addDays(iso: string, n: number): string {
  const [y, m, d] = iso.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

/** Số ngày từ `a` tới `b` (b − a). */
export function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DAY_MS);
}

/** Giờ tường `date` + `HH:MM` ở `tz` ⇒ instant. Lùi giờ (lặp) ⇒ lần đầu; khe tiến giờ ⇒ offset trước chuyển. */
export function atLocal(date: string, time: string, tz: string): Date {
  // Lô 100 HĐ dùng chung ít ngày/mốc ⇒ nhớ kết quả (Intl.formatToParts đắt; HD4-NFR-01). Thuần: cùng đầu vào ⇒ cùng kết quả.
  const key = `${date}|${time}|${tz}`;
  let ms = memo.get(key);
  if (ms === undefined) {
    if (memo.size > 50_000) memo.clear();
    ms = computeAtLocal(date, time, tz);
    memo.set(key, ms);
  }
  return new Date(ms);
}
const memo = new Map<string, number>();

function computeAtLocal(date: string, time: string, tz: string): number {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  const [hh, mm] = time.split(":").map(Number) as [number, number];
  const g = Date.UTC(y, m - 1, d, hh, mm);
  const cands = [g - offsetAt(g - DAY_MS, tz), g - offsetAt(g + DAY_MS, tz)];
  const ok = cands.filter((c) => {
    const p = wall(c, tz);
    return p.year === y && p.month === m && p.day === d && p.hour % 24 === hh && p.minute === mm;
  });
  return ok.length ? Math.min(...ok) : (cands[0] as number);
}

/** Mui gio mac dinh cua goi khi nen tang chua cap mui gio tenant (khong import module config cua hub). */
export const DEFAULT_TENANT_TZ = "Asia/Ho_Chi_Minh";
