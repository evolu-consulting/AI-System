// CR-125 · x8 · luật thuần của bộ chọn ngày tiếng Việt: lưới tháng (thứ Hai là ngày đầu tuần), tên tháng tiếng Việt, đọc dd/mm/yyyy.
// Hiển thị ngày = `viDate` (format.ts) — MỘT bộ định dạng; ở đây chỉ có phép tính trên chuỗi ISO yyyy-mm-dd (không đụng múi giờ máy).

export const VI_MONTHS = [
  "Tháng 1",
  "Tháng 2",
  "Tháng 3",
  "Tháng 4",
  "Tháng 5",
  "Tháng 6",
  "Tháng 7",
  "Tháng 8",
  "Tháng 9",
  "Tháng 10",
  "Tháng 11",
  "Tháng 12",
] as const;
/** Thứ Hai đứng đầu tuần. */
export const VI_WEEKDAYS = ["T2", "T3", "T4", "T5", "T6", "T7", "CN"] as const;

const p2 = (n: number): string => String(n).padStart(2, "0");
export const isoOf = (y: number, m0: number, d: number): string => `${y}-${p2(m0 + 1)}-${p2(d)}`;

/** ISO yyyy-mm-dd ⇒ dd/mm/yyyy (một bộ định dạng cho cả ô ngày lẫn `viDate`). */
export const isoToVi = (iso: string): string => iso.slice(0, 10).split("-").reverse().join("/");

/** Ngày có thật (28/29/30/31 đúng tháng, năm 1900–2999). */
function real(y: number, m0: number, d: number): boolean {
  if (y < 1900 || y > 2999 || m0 < 0 || m0 > 11 || d < 1) return false;
  return d <= new Date(Date.UTC(y, m0 + 1, 0)).getUTCDate();
}

/** "30/09/2027" · "3/9/2027" · "30-09-2027" · "2027-09-30" ⇒ ISO; sai/không có thật ⇒ null. */
export function parseDate(text: string): string | null {
  const s = text.trim();
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s);
  const vi = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(s);
  const [y, m, d] = iso
    ? [iso[1], iso[2], iso[3]].map(Number)
    : vi
      ? [vi[3], vi[2], vi[1]].map(Number)
      : [];
  if (y === undefined || m === undefined || d === undefined) return null;
  return real(y, m - 1, d) ? isoOf(y, m - 1, d) : null;
}

export type Cell = { iso: string; day: number; inMonth: boolean };

/** 6 tuần × 7 ngày của tháng `m0` (0–11), tuần bắt đầu thứ Hai. */
export function monthGrid(year: number, m0: number): Cell[][] {
  const first = new Date(Date.UTC(year, m0, 1));
  const lead = (first.getUTCDay() + 6) % 7; // T2 = 0 … CN = 6
  const start = Date.UTC(year, m0, 1 - lead);
  return Array.from({ length: 6 }, (_, w) =>
    Array.from({ length: 7 }, (_, i) => {
      const d = new Date(start + (w * 7 + i) * 86_400_000);
      return {
        iso: isoOf(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()),
        day: d.getUTCDate(),
        inMonth: d.getUTCMonth() === m0,
      };
    }),
  );
}

export function addMonths(year: number, m0: number, n: number): { year: number; m0: number } {
  const t = year * 12 + m0 + n;
  return { year: Math.floor(t / 12), m0: ((t % 12) + 12) % 12 };
}

/** `iso` nằm trong [min, max] (so chuỗi ISO — đúng thứ tự thời gian). */
export const inRange = (iso: string, min?: string, max?: string): boolean =>
  (!min || iso >= min) && (!max || iso <= max);

/** Ngày hôm nay theo giờ Việt Nam (ISO). */
export const todayVn = (now: Date = new Date()): string =>
  now.toLocaleDateString("en-CA", { timeZone: "Asia/Ho_Chi_Minh" });
