// CR-125 · cr125-run-attachments · luật THUẦN: lấy id tệp từ giá trị người dùng điền (id đơn, hoặc danh sách nối ", " của phiếu «Tạo yêu cầu»).
const UUID_G = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

/** Tối đa id mỗi lần liên kết (trần danh sách phiếu là 20; dư để gộp nhiều ô). */
export const RUN_FILES_MAX = 50;

/** Mọi uuid xuất hiện trong các chuỗi `values` (chữ thường, không trùng, theo thứ tự gặp, ≤ `RUN_FILES_MAX`). Giá trị không phải chuỗi bị bỏ. */
export function uuidsIn(values: Iterable<unknown>): string[] {
  const out = new Set<string>();
  for (const v of values) {
    if (typeof v !== "string") continue;
    for (const m of v.match(UUID_G) ?? []) {
      out.add(m.toLowerCase());
      if (out.size >= RUN_FILES_MAX) return [...out];
    }
  }
  return [...out];
}

/** Mảng uuid → literal mảng Postgres (tham số hoá, ép `::uuid[]` ở câu); id đã qua `uuidsIn`. */
export const uuidArrayLiteral = (ids: readonly string[]): string => `{${ids.join(",")}}`;
