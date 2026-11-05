// e2e/_kit · hậu tố duy nhất + tên dữ liệu riêng của một spec (thuần, không phụ thuộc Playwright; test: unique.test.ts).

let seq = 0;

/** Hậu tố duy nhất trong và giữa các lượt chạy (thời gian base36 + số thứ tự + ngẫu nhiên), chỉ [a-z0-9], 8–12 ký tự. */
export function uniqueSuffix(): string {
  seq += 1;
  const t = Date.now().toString(36).slice(-6);
  const r = Math.floor(Math.random() * 36 ** 2)
    .toString(36)
    .padStart(2, "0");
  return `${t}${seq.toString(36)}${r}`;
}

/** Tên dữ liệu riêng của spec: `e2e-<prefix>-<suffix>` (khoá/username hợp lệ: chữ thường, số, gạch ngang). */
export function uniqueKey(prefix: string, suffix: string = uniqueSuffix()): string {
  const p = prefix
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `e2e-${p}-${suffix}`;
}
