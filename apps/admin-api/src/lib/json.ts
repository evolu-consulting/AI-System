// ADM-FR-30, ADM-FR-20 · so sánh sâu dữ liệu jsonb (M2-R25: không đổi gì → không tăng version). Hàm thuần.

/** JSON chuẩn hoá: khoá object sắp tăng dần, mảng giữ thứ tự; `undefined` trong object bị bỏ như JSON.stringify. */
export function canonicalJson(v: unknown): string {
  return JSON.stringify(v, (_k, x) =>
    x && typeof x === "object" && !Array.isArray(x)
      ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
      : x,
  );
}

export const sameJson = (a: unknown, b: unknown): boolean => canonicalJson(a) === canonicalJson(b);

/** Hai mảng id cùng tập (không thứ tự, bỏ trùng). */
export function sameIdSet(a: readonly string[], b: readonly string[]): boolean {
  const sa = new Set(a);
  const sb = new Set(b);
  return sa.size === sb.size && [...sa].every((x) => sb.has(x));
}
