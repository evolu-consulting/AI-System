// I1 · đọc giá trị thô của bản ghi mgmt-app một cách phòng thủ (không ném): chuỗi cắt độ dài, ngày ISO, số nguyên, tiền.
// Tiền mgmt-app = số nguyên đồng (int Python). KHÔNG làm tròn: giá trị không nguyên ⇒ null + vấn đề MONEY_NOT_INT (đối soát
// tổng tiền sẽ lệch và báo ra, không im lặng). Thuần.

export type Issue = { entity: string; ref: string; code: string };

export const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/** NUL / surrogate lẻ ⇒ Postgres từ chối cả lô; bỏ ký tự hỏng ở biên. */
const clean = (s: string): string =>
  s
    .split(String.fromCharCode(0))
    .join("")
    .replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, "");

/** Chuỗi đã trim, cắt `max` ký tự (theo code point); rỗng ⇒ null. */
export function str(v: unknown, max = 10_000): string | null {
  if (typeof v === "number" || typeof v === "boolean") v = String(v);
  if (typeof v !== "string") return null;
  const s = clean(v).trim();
  if (!s) return null;
  const cps = Array.from(s);
  return cps.length > max ? cps.slice(0, max).join("") : s;
}

/** `YYYY-MM-DD` (lấy 10 ký tự đầu của ISO datetime); sai dạng ⇒ null. */
export function day(v: unknown): string | null {
  const s = typeof v === "string" ? v.trim().slice(0, 10) : "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const d = new Date(`${s}T00:00:00Z`);
  return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== s ? null : s;
}

/** Thời điểm ISO hợp lệ (giữ múi giờ gốc dưới dạng UTC ISO) hoặc null. */
export function ts(v: unknown): string | null {
  if (typeof v !== "string" || !v.trim()) return null;
  const d = new Date(v.trim());
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** Số nguyên trong [min, max]; ngoài khoảng / không nguyên ⇒ null. */
export function int(v: unknown, min = -(2 ** 31), max = 2 ** 31 - 1): number | null {
  const n = typeof v === "string" && /^-?\d+$/.test(v.trim()) ? Number(v.trim()) : v;
  return typeof n === "number" && Number.isInteger(n) && n >= min && n <= max ? n : null;
}

/** Số thực hữu hạn trong [min, max] hoặc null. */
export function num(v: unknown, min = -1e15, max = 1e15): number | null {
  const n = typeof v === "string" && v.trim() !== "" ? Number(v) : v;
  return typeof n === "number" && Number.isFinite(n) && n >= min && n <= max ? n : null;
}

/** jsonb từ chối `\u0000` trong chuỗi (22P05) ⇒ bỏ ở biên cho mọi giá trị JSON chép nguyên văn. */
export const jsonSafe = <T>(v: T): T =>
  v === undefined ? v : (JSON.parse(JSON.stringify(v).replaceAll("\\u0000", "")) as T);

export const bool = (v: unknown): boolean => v === true;

/** Tiền đồng: số nguyên 0…10¹⁵ (BR-1). Có giá trị mà không hợp lệ ⇒ null + vấn đề (không làm tròn). */
export function money(v: unknown, issues: Issue[], entity: string, ref: string): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "string" && /^\d+$/.test(v.trim()) ? Number(v.trim()) : v;
  if (typeof n === "number" && Number.isSafeInteger(n) && n >= 0 && n <= 1e15) return n;
  issues.push({ entity, ref, code: "MONEY_NOT_INT" });
  return null;
}

export const lowerEmail = (v: unknown): string | null => str(v, 320)?.toLowerCase() ?? null;

/** `org|tax:0123` / `org|name:abc` (id công ty mgmt) ⇒ phần sau `|`. */
export const partyPart = (companyId: string | null): string | null =>
  companyId
    ? companyId.includes("|")
      ? companyId.slice(companyId.indexOf("|") + 1)
      : companyId
    : null;

/** ≡ `mgmt-app signed/parse.py::norm_serial` ≡ `normSerial` của HD9: hex hoa, bỏ khoảng trắng/`:`, bỏ 0 đầu. */
export function serialKey(v: unknown): string | null {
  const s = str(v, 200)
    ?.toUpperCase()
    .replace(/[\s:.-]/g, "");
  if (!s || !/^[0-9A-F]+$/.test(s)) return s ? s.slice(0, 100) : null;
  return (s.replace(/^0+/, "") || "0").slice(0, 100);
}
