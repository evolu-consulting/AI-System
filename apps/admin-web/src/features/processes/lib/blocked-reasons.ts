// CR-127 · Luật GỐC 3: thanh lưu nói vì sao nút bị tắt.
/** Lý do cụ thể của các lỗi đang chặn Lưu: giá trị lỗi là khoá i18n ⇒ dịch, bỏ trùng, tối đa 3 câu. */
export function blockedReasons(
  errors: Record<string, string>,
  t: (key: string, opts?: Record<string, unknown>) => string,
): string[] {
  const out = new Set<string>();
  for (const v of Object.values(errors)) {
    if (v) out.add(t(v, { defaultValue: v }));
    if (out.size >= 3) break;
  }
  return [...out];
}
