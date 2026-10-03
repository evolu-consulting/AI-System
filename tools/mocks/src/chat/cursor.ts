// CHAT-AC-19 · cursor opaque + phân trang keyset của mock chat (plan C1 §2.4 E5, E10, E11).
// Cursor = base64url(JSON `[số, chuỗi]`) — khoá của phần tử cuối trang trước; client không được hiểu nội dung.

export type PageKey = readonly [number, string];
export type Paged<T> = { items: T[]; next: string | null };

const KEY_STR_MAX = 64;

export function encodeCursor(key: PageKey): string {
  return Buffer.from(JSON.stringify(key), "utf8").toString("base64url");
}

/** Cursor hỏng/lạ → null (route trả 400 `VALIDATION_ERROR`). */
export function decodeCursor(raw: string): PageKey | null {
  let v: unknown;
  try {
    v = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (!Array.isArray(v) || v.length !== 2) return null;
  const [n, s] = v as unknown[];
  if (typeof n !== "number" || !Number.isSafeInteger(n)) return null;
  if (typeof s !== "string" || s.length > KEY_STR_MAX) return null;
  if (encodeCursor([n, s]) !== raw) return null;
  return [n, s];
}

export function compareKeys(a: PageKey, b: PageKey): number {
  if (a[0] !== b[0]) return a[0] < b[0] ? -1 : 1;
  return a[1] === b[1] ? 0 : a[1] < b[1] ? -1 : 1;
}

/**
 * Một trang từ danh sách ĐÃ sắp theo `dir`: bỏ phần tử tới hết `after` (tính theo chiều `dir`), lấy `limit`.
 * `next` = cursor của phần tử cuối trang nếu còn phần tử sau nó.
 */
export function paginate<T>(
  sorted: readonly T[],
  keyOf: (t: T) => PageKey,
  opts: { after: PageKey | undefined; limit: number; dir: "asc" | "desc" },
): Paged<T> {
  const sign = opts.dir === "asc" ? 1 : -1;
  const { after } = opts;
  const rest = after ? sorted.filter((t) => compareKeys(keyOf(t), after) * sign > 0) : sorted;
  const items = rest.slice(0, opts.limit);
  const last = items.at(-1);
  const next = rest.length > opts.limit && last !== undefined ? encodeCursor(keyOf(last)) : null;
  return { items, next };
}
